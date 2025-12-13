// Invariant: All live and replay processing must flow through this consumer. No alternate feature
// or Δ_SPD computation paths are allowed.
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

export type TradeIntent = {
  kind: "noop";
};

export type PipelineOutput = {
  features?: ReturnType<FeatureEngine["update"]>;
  dislocation?: DislocationSignal | null;
  intent?: TradeIntent | null;
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

  const output = {
    features,
    dislocation,
    intent: null,
    state: currentState,
    orderingCollision: detectCollision(event),
    dtMs,
  };
  logPmAndFeatures(event, features, dislocation, currentState);
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
) {
  console.log("pm_event", {
    assetId: event.assetId,
    mid: event.mid,
    bestBid: event.bestBid,
    bestAsk: event.bestAsk,
    exchangeTs: event.exchangeTs,
    ingestTs: event.ingestTs,
    features,
    dislocation,
    state,
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
  console.log("state_transition", {
    from: prev,
    to: next,
    causes,
    exchangeTs: health.exchangeTs,
    ingestTs: health.ingestTs,
    latencyMs: health.latencyMs,
    collisionCount,
  });
}
