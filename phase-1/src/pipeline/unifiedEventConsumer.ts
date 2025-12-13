// Invariant: All live and replay processing must flow through this consumer. No alternate feature
// or Δ_SPD computation paths are allowed.
import { randomUUID } from "node:crypto";
import {
  type BetaParams,
  type DislocationSignal,
  computeDislocation,
} from "../features/dislocation";
import { type FeatureConfig, FeatureEngine } from "../features/featureEngine";
import {
  INITIAL_STATE,
  type TraderState,
  makeHealthSnapshot,
  nextState,
} from "../health/stateMachine";
import {
  getBestBookState,
  getSpotState,
  setBestBookState,
  setSpotState,
} from "../state/hotState";
import { logger } from "../lib/logger";
import type { IntentSink, PipelineContext } from "./intentSink";
import type { BestBook } from "./pmPriceChanges";

export type SpotTickEvent = {
  kind: "spot";
  productId: string;
  baseAsset?: string;
  quoteAsset?: string;
  mid?: number | null;
  exchangeTs: number;
  ingestTs: number;
};

export type PmBookEvent = {
  kind: "pmBook";
  assetId: string;
  conditionId?: string;
  bestBid?: number;
  bestAsk?: number;
  mid?: number | null;
  exchangeTs: number;
  ingestTs: number;
};

export type UnifiedEvent = SpotTickEvent | PmBookEvent;

export type OrderIntent = {
  intentId: string;
  runId: string;
  conditionId: string;
  assetId: string;
  side: "BUY" | "SELL";
  price: number;
  size: number;
  createdTs: number;
  reason: "DELTA_SPD" | "MM_REBALANCE";
};

export type PipelineOutput = {
  features?: ReturnType<FeatureEngine["update"]>;
  dislocation?: DislocationSignal | null;
  intent?: OrderIntent | null;
  state: TraderState;
  orderingCollision?: boolean;
  dtMs?: number | null;
};

const defaultFeatureConfig: FeatureConfig = {
  anchorWindowMs: Number(process.env.FEATURE_ANCHOR_MS ?? 60_000),
  emaFastHalfLifeMs: Number(process.env.FEATURE_EMA_FAST_MS ?? 10_000),
  emaSlowHalfLifeMs: Number(process.env.FEATURE_EMA_SLOW_MS ?? 60_000),
  volWindowMs: Number(process.env.FEATURE_VOL_MS ?? 120_000),
  expectedIntervalMs: Number(process.env.FEATURE_INTERVAL_MS ?? 1_000),
};

const featureEngines = new Map<string, FeatureEngine>();
const betaParams: BetaParams = (process.env.BETA_PARAMS ?? "")
  .split(",")
  .map((n) => Number(n.trim()))
  .filter((n) => Number.isFinite(n));
const betaIsZero = betaParams.length === 0 || betaParams.every((b) => b === 0);
let currentState: TraderState = INITIAL_STATE;
let lastEventTs: number | null = null;
let lastEventKind: UnifiedEvent["kind"] | null = null;
let collisionCount = 0;
const log = logger("pipeline");

type Position = {
  inventory: number;
  pending: number;
  lastIntentId?: string;
  lastUnwindIntentId?: string;
  lastUnwindTs?: number;
};

const positions: Map<string, Position> = new Map(); // key = conditionId|assetId
const runId = process.env.RUN_ID || randomUUID();
const intentThreshold = Number(process.env.INTENT_DELTA_THRESHOLD ?? 0.01);
const inventoryCap = Number(process.env.INTENT_INVENTORY_CAP ?? 100);
const orderSize = Number(process.env.INTENT_ORDER_SIZE ?? 1);
const unwindStartFrac = Number(process.env.UNWIND_START_FRAC ?? 0.5);
const unwindAggressiveFrac = Number(process.env.UNWIND_AGGRESSIVE_FRAC ?? 0.8);
const unwindMinEdgeTicks = Number(process.env.UNWIND_MIN_EDGE_TICKS ?? 1);
const unwindCooldownMs = Number(process.env.UNWIND_COOLDOWN_MS ?? 500);
const defaultTickSize = Number(process.env.UNWIND_TICK_SIZE ?? 0.01);

export type FillEvent = {
  intentId: string;
  conditionId: string;
  assetId: string;
  side: "BUY" | "SELL";
  filledSize: number;
  price: number;
  timestamp: number;
  partial: boolean;
};

export type FailEvent = {
  intentId: string;
  conditionId: string;
  assetId: string;
  side: "BUY" | "SELL";
  size: number;
  timestamp: number;
  reason?: string;
};

function positionKey(conditionId?: string, assetId?: string) {
  return `${conditionId ?? "unknown"}|${assetId ?? "unknown"}`;
}

function signed(side: "BUY" | "SELL", size: number) {
  return side === "BUY" ? size : -size;
}

function roundDownToTick(price: number, tick: number) {
  return Math.floor(price / tick) * tick;
}

function roundUpToTick(price: number, tick: number) {
  return Math.ceil(price / tick) * tick;
}

function assertPositionInvariant(pos: Position, cap: number) {
  if (Math.abs(pos.inventory) > cap + 1e-6) {
    throw new Error("Inventory cap violated");
  }
  if (Math.abs(pos.pending) > cap + 1e-6) {
    throw new Error("Pending cap violated");
  }
}

function getEngine(key: string): FeatureEngine {
  let engine = featureEngines.get(key);
  if (!engine) {
    engine = new FeatureEngine(defaultFeatureConfig);
    featureEngines.set(key, engine);
  }
  return engine;
}

export async function handleUnifiedEvent(
  event: UnifiedEvent,
  sink?: IntentSink,
  ctx: PipelineContext = { mode: "live" },
): Promise<PipelineOutput> {
  if (
    betaIsZero &&
    ctx.mode === "live" &&
    process.env.ALLOW_ZERO_BETA !== "true"
  ) {
    console.warn(
      "BETA_PARAMS not set or zero; staying out of RUNNING. Set ALLOW_ZERO_BETA=true to override.",
    );
  }

  if (event.kind === "spot") {
    return handleSpot(event, sink, ctx);
  }

  return handlePmBook(event, sink, ctx);
}

async function handleSpot(
  event: SpotTickEvent,
  sink?: IntentSink,
  ctx: PipelineContext = { mode: "live" },
): Promise<PipelineOutput> {
  if (!event.mid || event.mid <= 0) {
    const health = makeHealthSnapshot({
      exchangeTs: event.exchangeTs,
      ingestTs: event.ingestTs,
      spotAgeMs: undefined,
      pmAgeMs: undefined,
      featuresReady: false,
    });
    const prevState = currentState;
    currentState = nextState(currentState, health);
    maybeLogTransition(prevState, currentState, health, betaBlocked(ctx));
    const output = {
      features: undefined,
      dislocation: null,
      intent: null,
      state: currentState,
      orderingCollision: detectCollision(event),
    };
    sink?.handle(output, ctx);
    return output;
  }

  await setSpotState({
    productId: event.productId,
    baseAsset: event.baseAsset,
    quoteAsset: event.quoteAsset,
    mid: event.mid,
    updatedAt: event.exchangeTs,
  });

  const engine = getEngine(event.productId);
  const features = engine.update(event.mid, event.exchangeTs);

  const health = makeHealthSnapshot({
    exchangeTs: event.exchangeTs,
    ingestTs: event.ingestTs,
    spotAgeMs: 0,
    pmAgeMs: undefined,
    featuresReady: featuresReady(features),
  });
  const prevState = currentState;
  currentState = nextState(currentState, health);

  if (betaIsZero && ctx.mode === "live" && currentState === "RUNNING") {
    // prevent RUNNING when beta is zero and override not set
    currentState = "WARMING";
  }
  maybeLogTransition(prevState, currentState, health, betaBlocked(ctx));

  logFeatures(event.productId, features, currentState);
  const output = {
    features,
    dislocation: null,
    intent: null,
    state: currentState,
    orderingCollision: detectCollision(event),
  };
  sink?.handle(output, ctx);
  return output;
}

async function handlePmBook(
  event: PmBookEvent,
  sink?: IntentSink,
  ctx: PipelineContext = { mode: "live" },
): Promise<PipelineOutput> {
  const book: BestBook = {
    bestBid: event.bestBid,
    bestAsk: event.bestAsk,
    updatedAt: event.exchangeTs,
  };
  await setBestBookState(event.assetId, {
    ...book,
    mid: event.mid ?? null,
  });

  // Strategy placeholder: need spot to compute Δ_SPD
  const spot = getSpotState(process.env.SPOT_PRODUCT_ID ?? "BTC-USD");
  if (!spot || !spot.mid) {
    const health = makeHealthSnapshot({
      exchangeTs: event.exchangeTs,
      ingestTs: event.ingestTs,
      spotAgeMs: undefined,
      pmAgeMs: 0,
      featuresReady: false,
    });
    const prevState = currentState;
    currentState = nextState(currentState, health);
    if (betaIsZero && ctx.mode === "live" && currentState === "RUNNING") {
      currentState = "WARMING";
    }
    maybeLogTransition(prevState, currentState, health, betaBlocked(ctx));
    const output = {
      features: undefined,
      dislocation: null,
      intent: null,
      state: currentState,
      orderingCollision: detectCollision(event),
    };
    sink?.handle(output, ctx);
    return output;
  }

  const engine = getEngine(spot.productId);
  const features =
    engine.getLatest() ?? engine.update(spot.mid, event.exchangeTs);

  let dislocation: DislocationSignal | null = null;
  if (event.mid !== null && event.mid !== undefined) {
    dislocation = computeDislocation(
      features,
      event.mid,
      betaParams,
      event.exchangeTs,
      event.ingestTs,
    );
  } else {
    dislocation = null;
  }

  const pmState = getBestBookState(event.assetId);
  const spotAgeMs =
    spot.updatedAt !== undefined
      ? Math.max(0, event.exchangeTs - spot.updatedAt)
      : undefined;
  const pmAgeMs =
    pmState?.updatedAt !== undefined
      ? Math.max(0, event.exchangeTs - pmState.updatedAt)
      : 0;
  const dtMs =
    spot.updatedAt !== undefined
      ? Math.max(-1, event.exchangeTs - spot.updatedAt)
      : null;

  const health = makeHealthSnapshot({
    exchangeTs: event.exchangeTs,
    ingestTs: event.ingestTs,
    spotAgeMs,
    pmAgeMs,
    featuresReady: featuresReady(features),
  });
  const prevState = currentState;
  currentState = nextState(currentState, health);

  if (betaIsZero && ctx.mode === "live" && currentState === "RUNNING") {
    currentState = "WARMING";
  }
  maybeLogTransition(prevState, currentState, health, betaBlocked(ctx));

  const intent = maybeEmitIntent(event, dislocation, ctx);
  const unwindIntent = intent ? null : maybeEmitUnwindIntent(event);

  const output = {
    features,
    dislocation,
    intent: intent ?? unwindIntent,
    state: currentState,
    orderingCollision: detectCollision(event),
    dtMs,
  };
  logPmAndFeatures(event, features, dislocation, currentState, intent);
  sink?.handle(output, ctx);
  return output;
}

function logFeatures(
  productId: string,
  features: ReturnType<FeatureEngine["update"]>,
  state: TraderState,
) {
  // Minimal sink placeholder; replace with intent emission.
  console.log("features", { productId, state, ...features });
}

function logPmAndFeatures(
  event: PmBookEvent,
  features: ReturnType<FeatureEngine["update"]> | undefined,
  dislocation: DislocationSignal | null,
  state: TraderState,
  intent?: OrderIntent | null,
) {
  log("pm_event %o", {
    assetId: event.assetId,
    mid: event.mid,
    bestBid: event.bestBid,
    bestAsk: event.bestAsk,
    exchangeTs: event.exchangeTs,
    ingestTs: event.ingestTs,
    features,
    dislocation,
    state,
    intent,
  });
}

function featuresReady(features: ReturnType<FeatureEngine["update"]>): boolean {
  return (
    features.x1 !== undefined &&
    features.emaFast !== undefined &&
    features.emaSlow !== undefined &&
    features.vol !== undefined
  );
}

function detectCollision(event: UnifiedEvent): boolean {
  let collision = false;
  if (lastEventTs !== null && lastEventTs === event.exchangeTs) {
    if (lastEventKind && lastEventKind !== event.kind) {
      collision = true;
      collisionCount += 1;
    }
  }
  lastEventTs = event.exchangeTs;
  lastEventKind = event.kind;
  return collision;
}

function betaBlocked(ctx: PipelineContext) {
  return (
    betaIsZero && ctx.mode === "live" && process.env.ALLOW_ZERO_BETA !== "true"
  );
}

function maybeLogTransition(
  prev: TraderState,
  next: TraderState,
  health: ReturnType<typeof makeHealthSnapshot>,
  betaBlock: boolean,
) {
  if (prev === next) return;
  const causes: string[] = [];
  if (!health.spotFresh) causes.push("spotStale");
  if (!health.pmFresh) causes.push("pmStale");
  if (!health.featuresReady) causes.push("featuresInvalid");
  if (!health.latencyOk) causes.push("clockSkewBad");
  if (betaBlock) causes.push("betaBlocked");
  log("state_transition %o", {
    from: prev,
    to: next,
    causes,
    exchangeTs: health.exchangeTs,
    ingestTs: health.ingestTs,
    latencyMs: health.latencyMs,
    collisionCount,
  });
}

function maybeEmitIntent(
  event: PmBookEvent,
  dislocation: DislocationSignal | null,
  ctx: PipelineContext,
): OrderIntent | null {
  void ctx;
  if (!dislocation) return null;
  if (currentState !== "RUNNING") return null;
  if (!event.conditionId || !event.assetId) return null;
  if (dislocation.deltaSPD === undefined) return null;
  if (event.bestBid === undefined || event.bestAsk === undefined) return null;

  const delta = dislocation.deltaSPD;
  if (Math.abs(delta) < intentThreshold) return null;

  const key = positionKey(event.conditionId, event.assetId);
  const pos = positions.get(key) ?? { inventory: 0, pending: 0 };

  const side: "BUY" | "SELL" = delta > 0 ? "BUY" : "SELL";
  const projected =
    side === "BUY"
      ? pos.inventory + pos.pending + orderSize
      : pos.inventory + pos.pending - orderSize;
  if (Math.abs(projected) > inventoryCap) return null;

  const price = side === "BUY" ? event.bestBid : event.bestAsk;
  const intentKey = [
    event.conditionId,
    event.assetId,
    side,
    price.toFixed(4),
    orderSize,
  ].join("|");

  if (pos.pending !== 0 && pos.lastIntentId === intentKey) {
    return null;
  }

  const intent: OrderIntent = {
    intentId: intentKey,
    runId,
    conditionId: event.conditionId,
    assetId: event.assetId,
    side,
    price,
    size: orderSize,
    createdTs: event.exchangeTs,
    reason: "DELTA_SPD",
  };

  pos.lastIntentId = intentKey;
  pos.pending += side === "BUY" ? orderSize : -orderSize;
  positions.set(key, pos);
  return intent;
}

function maybeEmitUnwindIntent(event: PmBookEvent): OrderIntent | null {
  if (currentState !== "RUNNING") return null;
  if (!event.conditionId || !event.assetId) return null;
  if (event.bestBid === undefined || event.bestAsk === undefined) return null;

  const key = positionKey(event.conditionId, event.assetId);
  const pos = positions.get(key) ?? { inventory: 0, pending: 0 };
  const exposure = pos.inventory + pos.pending;
  const absExposure = Math.abs(exposure);
  if (absExposure < inventoryCap * unwindStartFrac) return null;

  const now = event.exchangeTs;
  if (pos.lastUnwindTs && now - pos.lastUnwindTs < unwindCooldownMs) return null;

  const side: "BUY" | "SELL" = exposure > 0 ? "SELL" : "BUY";
  let size = Math.min(orderSize, absExposure);
  if (absExposure >= inventoryCap * unwindAggressiveFrac) {
    size = Math.min(orderSize * 2, absExposure);
  }

  // avoid overshoot across zero
  if (side === "SELL" && exposure - size < 0) size = exposure;
  if (side === "BUY" && exposure + size > 0) size = -exposure;
  if (size <= 0) return null;

  const tickSize = defaultTickSize;
  const edge = unwindMinEdgeTicks * tickSize;
  let price: number;
  if (side === "SELL") {
    price = Math.max(event.bestAsk, event.bestBid + edge);
    price = roundUpToTick(price, tickSize);
  } else {
    price = Math.min(event.bestBid, event.bestAsk - edge);
    price = roundDownToTick(price, tickSize);
  }

  const intentKey = [
    event.conditionId,
    event.assetId,
    "UNWIND",
    side,
    price.toFixed(6),
    size.toFixed(6),
  ].join("|");

  if (pos.pending !== 0 && pos.lastUnwindIntentId === intentKey) return null;

  const intent: OrderIntent = {
    intentId: intentKey,
    runId,
    conditionId: event.conditionId,
    assetId: event.assetId,
    side,
    price,
    size,
    createdTs: now,
    reason: "MM_REBALANCE",
  };

  pos.lastUnwindIntentId = intentKey;
  pos.lastUnwindTs = now;
  pos.pending += side === "BUY" ? size : -size;
  positions.set(key, pos);
  return intent;
}

export function applyFillEvent(ev: FillEvent) {
  const key = positionKey(ev.conditionId, ev.assetId);
  const pos = positions.get(key);
  if (!pos) return;
  const s = signed(ev.side, ev.filledSize);
  pos.pending -= s;
  pos.inventory += s;
  if (Math.abs(pos.pending) < 1e-9) {
    pos.pending = 0;
    pos.lastIntentId = undefined;
    pos.lastUnwindIntentId = undefined;
  }
  positions.set(key, pos);
  assertPositionInvariant(pos, inventoryCap);
}

export function applyFailEvent(ev: FailEvent) {
  const key = positionKey(ev.conditionId, ev.assetId);
  const pos = positions.get(key);
  if (!pos) return;
  const s = signed(ev.side, ev.size);
  pos.pending -= s;
  if (Math.abs(pos.pending) < 1e-9) pos.pending = 0;
  pos.lastIntentId = undefined;
  pos.lastUnwindIntentId = undefined;
  positions.set(key, pos);
  assertPositionInvariant(pos, inventoryCap);
}
