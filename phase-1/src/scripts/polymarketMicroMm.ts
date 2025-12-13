import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import {
  CollectIntentSink,
  LiveIntentSink,
  type PipelineContext,
} from "../pipeline/intentSink";
import { startCoinbaseFeed } from "../services/coinbaseFeed";
import { MarketCatalog } from "../services/marketCatalog";
import { startPolymarketPriceFeed } from "../services/polymarketPriceFeed";
import { logger } from "../lib/logger";

dotenv.config();

const MODE = (process.env.MODE ?? "collect").toLowerCase();
const RUN_ID = process.env.RUN_ID || randomUUID();

const PRODUCT_IDS = (process.env.COINBASE_PRODUCTS || "BTC-USD")
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);
const WS_URL =
  process.env.COINBASE_WS_URL || "wss://advanced-trade-ws.coinbase.com";
const STALE_MS = Number(process.env.COINBASE_STALE_MS ?? 3_000);
const BEST_BOOK_STALE_MS = Number(process.env.BEST_BOOK_STALE_MS ?? 5_000);
const MARKET_REFRESH_MS = Number(process.env.MARKET_REFRESH_MS ?? 60_000);
const MARKET_WINDOWS_AHEAD = Number(process.env.MARKET_WINDOWS_AHEAD ?? 4);
const TARGET_ASSETS = (process.env.TARGET_ASSETS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

async function main() {
  const mode: PipelineContext["mode"] =
    MODE === "live" ? "live" : MODE === "backtest" ? "backtest" : "collect";
  if (mode === "backtest") {
    throw new Error(
      'Use "bun run backtest:polymarket:micro-mm" for DB replay; MODE=backtest is not supported in this entrypoint.',
    );
  }
  const log = logger("orchestrator");
  const baseCtx: PipelineContext = {
    mode,
    featuresVersion: process.env.FEATURES_VERSION,
    betaVersion: process.env.BETA_VERSION,
  };

  const catalog = new MarketCatalog({
    refreshMs: MARKET_REFRESH_MS,
    windowsAhead: MARKET_WINDOWS_AHEAD,
  });
  await catalog.start();

  const sink = mode === "live" ? new LiveIntentSink() : new CollectIntentSink(RUN_ID);

  const coinbaseHandle = startCoinbaseFeed({
    productIds: PRODUCT_IDS,
    staleMs: STALE_MS,
    wsUrl: WS_URL,
    sink,
    ctx: baseCtx,
  });

  const polymarketHandle = startPolymarketPriceFeed({
    catalog,
    targetAssets: TARGET_ASSETS,
    staleMs: BEST_BOOK_STALE_MS,
    sink,
    ctx: baseCtx,
  });

  const shutdown = async (signal: string) => {
    console.warn(`Received ${signal}, shutting down...`);
    coinbaseHandle.stop();
    polymarketHandle.stop();
    if (hasFlush(sink)) {
      await sink.flushToDb().catch((err) => console.error("Failed to flush sink", err));
    }
    catalog.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  log(
    "startup %o",
    {
      runId: RUN_ID,
      mode,
      productIds: PRODUCT_IDS,
      targetAssets: TARGET_ASSETS.length > 0 ? TARGET_ASSETS : "dynamic",
      marketRefreshMs: MARKET_REFRESH_MS,
    },
  );
}

function hasFlush(
  sink: LiveIntentSink | CollectIntentSink,
): sink is CollectIntentSink {
  return typeof (sink as CollectIntentSink).flushToDb === "function";
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
