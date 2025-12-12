import dotenv from "dotenv";
import { PriceChange, RealTimeClient } from "@polymarket/real-time-data-client";
import { clobClient } from "../clients/polymarketClob";
import { fetchLatestSnapshots, type LatestSnapshot } from "../services/arbSnapshotService";
import { findIntraArbs } from "../services/arbDetector";
import { getMatcher } from "../services/marketMatcher";
import { saveArbOpportunities } from "../services/arbStorage";

dotenv.config();

type MarketConfig = {
  conditionIds: Set<string>;
  minMargin: number;
  matcherName?: string;
  persist: boolean;
  staleMs: number;
};

type OutcomeKey = string;

type OutcomeState = {
  conditionId: string;
  outcomeIndex: number;
  outcomeName: string;
  exchange: string;
  bestBidPrice: number | null;
  bestAskPrice: number | null;
  bestBidSize: number | null;
  bestAskSize: number | null;
  title?: string | null;
  marketSlug?: string | null;
  timestamp: Date;
};

const now = () => new Date();

function parseConfig(): MarketConfig {
  const conditionIds = new Set(
    process.env.REALTIME_CONDITION_IDS
      ? process.env.REALTIME_CONDITION_IDS.split(",").map((s) => s.trim()).filter(Boolean)
      : [],
  );
  const minMargin = process.env.REALTIME_MIN_MARGIN
    ? Number(process.env.REALTIME_MIN_MARGIN)
    : 0.015;
  const matcherName = process.env.REALTIME_MATCHER;
  const persist = process.env.REALTIME_STORE_ARBS === "true";
  const staleMs = process.env.REALTIME_STALE_MS ? Number(process.env.REALTIME_STALE_MS) : 30_000;

  return { conditionIds, minMargin, matcherName, persist, staleMs };
}

function keyForOutcome(conditionId: string, outcomeIndex: number): OutcomeKey {
  return `${conditionId}:${outcomeIndex}`;
}

function applyPriceChange(
  state: Map<OutcomeKey, OutcomeState>,
  event: PriceChange & { conditionId: string; outcomeIndex: number; outcomeName: string },
  staleMs: number,
) {
  const key = keyForOutcome(event.conditionId, event.outcomeIndex);
  const prev = state.get(key);
  const timestamp = new Date(event.timestamp ?? Date.now());
  // ignore older data
  if (prev && prev.timestamp.getTime() > timestamp.getTime()) return;

  state.set(key, {
    conditionId: event.conditionId,
    outcomeIndex: event.outcomeIndex,
    outcomeName: event.outcomeName,
    exchange: "polymarket",
    bestBidPrice: event.bestBid ? Number(event.bestBid.price) : null,
    bestAskPrice: event.bestAsk ? Number(event.bestAsk.price) : null,
    bestBidSize: event.bestBid ? Number(event.bestBid.size) : null,
    bestAskSize: event.bestAsk ? Number(event.bestAsk.size) : null,
    timestamp,
  });

  // prune stale entries (best-effort)
  const cutoff = Date.now() - staleMs;
  for (const [k, v] of state.entries()) {
    if (v.timestamp.getTime() < cutoff) {
      state.delete(k);
    }
  }
}

async function warmStart(
  conditionIds: string[],
  matcherName: string | undefined,
  state: Map<OutcomeKey, OutcomeState>,
) {
  if (!conditionIds.length) return;
  const snapshots = await fetchLatestSnapshots({
    conditionIds,
    exchange: "polymarket",
  });
  for (const snap of snapshots) {
    state.set(keyForOutcome(snap.conditionId, snap.outcomeIndex), {
      conditionId: snap.conditionId,
      outcomeIndex: snap.outcomeIndex,
      outcomeName: snap.outcomeName,
      exchange: snap.exchange,
      bestBidPrice: snap.bestBidPrice,
      bestAskPrice: snap.bestAskPrice,
      bestBidSize: snap.bestBidSize,
      bestAskSize: snap.bestAskSize,
      title: snap.title,
      marketSlug: snap.marketSlug ?? undefined,
      timestamp: snap.timestamp,
    });
  }
  console.log(
    `Warm start loaded ${snapshots.length} latest snapshots for matcher=${matcherName ?? "default"}`,
  );
}

function stateToSnapshots(state: Map<OutcomeKey, OutcomeState>): LatestSnapshot[] {
  return Array.from(state.values()).map((o) => ({
    conditionId: o.conditionId,
    outcomeIndex: o.outcomeIndex,
    outcomeName: o.outcomeName,
    exchange: o.exchange,
    title: o.title ?? "",
    marketSlug: o.marketSlug ?? null,
    eventSlug: null,
    tokenId: "", // not available in PriceChange payload; optional for matching
    bestBidPrice: o.bestBidPrice,
    bestBidSize: o.bestBidSize,
    bestAskPrice: o.bestAskPrice,
    bestAskSize: o.bestAskSize,
    timestamp: o.timestamp,
  }));
}

async function detectAndMaybePersist(
  state: Map<OutcomeKey, OutcomeState>,
  matcherName: string | undefined,
  minMargin: number,
  persist: boolean,
) {
  const matcher = getMatcher(matcherName);
  const snapshots = stateToSnapshots(state);
  const arbs = findIntraArbs(snapshots, minMargin, matcher);
  if (!arbs.length) return;

  for (const arb of arbs) {
    const legs = arb.outcomes
      .map(
        (o, idx) =>
          `O${idx} ask=${o.bestAskPrice !== null ? o.bestAskPrice.toFixed(4) : "n/a"} (${o.outcomeName})`,
      )
      .join(" | ");
    console.log(
      [
        `${now().toISOString()}`,
        `arb margin=${arb.margin.toFixed(4)}`,
        `totalAsk=${arb.totalAsk.toFixed(4)}`,
        `matcher=${arb.matcherName}`,
        arb.title,
        legs,
      ].join(" | "),
    );
  }

  if (persist) {
    await saveArbOpportunities(
      arbs.map((arb) => ({
        matcherName: arb.matcherName,
        matcherKey: arb.matcherKey,
        kind: "intra-event-realtime",
        margin: arb.margin,
        totalAsk: arb.totalAsk,
        thresholdUsed: minMargin,
        timestamp: arb.timestamp,
        metadata: { source: "realtime-arbs" },
        legs: arb.outcomes.map((o) => ({
          conditionId: o.conditionId,
          outcomeIndex: o.outcomeIndex,
          outcomeName: o.outcomeName,
          exchange: o.exchange,
          title: arb.title,
          marketSlug: arb.marketSlug,
          bestAskPrice: o.bestAskPrice,
          bestAskSize: o.bestAskSize,
          bestBidPrice: o.bestBidPrice,
          bestBidSize: o.bestBidSize,
        })),
      })),
    );
  }
}

async function main() {
  const config = parseConfig();
  if (!config.conditionIds.size) {
    console.error(
      "No conditionIds provided. Set REALTIME_CONDITION_IDS (comma-separated) to scope subscriptions.",
    );
    process.exit(1);
  }

  const state = new Map<OutcomeKey, OutcomeState>();

  await warmStart(Array.from(config.conditionIds), config.matcherName, state);

  const client = new RealTimeClient({ debug: false });

  client.on("open", () => {
    console.log("Realtime connection opened");
    client.subscribePriceChanges(Array.from(config.conditionIds));
  });

  client.on("close", (code: number, reason: Buffer) => {
    console.warn(`Realtime connection closed code=${code} reason=${reason.toString()}`);
  });

  client.on("error", (err: Error) => {
    console.error("Realtime error", err);
  });

  client.on("price_change", async (event: PriceChange) => {
    if (!event.conditionId || event.outcomeIndex === undefined) return;
    applyPriceChange(
      state,
      {
        conditionId: event.conditionId,
        outcomeIndex: event.outcomeIndex,
        outcomeName: event.outcomeName ?? `Outcome ${event.outcomeIndex}`,
        bestAsk: event.bestAsk,
        bestBid: event.bestBid,
        timestamp: event.timestamp,
        price: event.price,
      },
      config.staleMs,
    );
    await detectAndMaybePersist(
      state,
      config.matcherName,
      config.minMargin,
      config.persist,
    );
  });

  await client.connect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
