import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { BacktestIntentSink } from "../pipeline/intentSink";
import { SimulatedExecutionSink } from "../pipeline/simulatedExecutionSink";
import type { PipelineContext } from "../pipeline/intentSink";
import { replayEvents } from "../replay/harness";
import { streamEvents } from "../replay/dbLoader";

dotenv.config();

async function main() {
  const runId = process.env.RUN_ID || randomUUID();
  const hours = Number(process.env.HOURS ?? 1);
  const now = Date.now();
  const endMs = Number(process.env.END_MS ?? now);
  const startMs = Number(process.env.START_MS ?? endMs - hours * 60 * 60 * 1000);
  const conditionIds = (process.env.CONDITION_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const productIds = (process.env.COINBASE_PRODUCTS || "BTC-USD")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  const backtestSink = new BacktestIntentSink(runId);
  const simSink = new SimulatedExecutionSink(runId, {
    latencyMinMs: Number(process.env.BT_LATENCY_MIN_MS ?? 200),
    latencyMaxMs: Number(process.env.BT_LATENCY_MAX_MS ?? 1200),
    failProb: Number(process.env.BT_FAIL_PROB ?? 0.01),
    feeBps: Number(process.env.BT_FEE_BPS ?? 0),
  });

  const ctx: PipelineContext = {
    mode: "backtest",
    featuresVersion: process.env.FEATURES_VERSION || "v0",
    betaVersion: process.env.BETA_VERSION || "v0",
  };

  for await (const chunk of streamEvents({
    startMs,
    endMs,
    conditionIds,
    productIds,
  })) {
    await replayEvents(chunk, backtestSink, ctx);
    // SimulatedExecutionSink currently records when intents exist; placeholder for now.
  }

  await backtestSink.flushToDb();
  await simSink.flushToDb();

  console.log(
    JSON.stringify({
      runId,
      startMs,
      endMs,
      conditionIds: conditionIds.length > 0 ? conditionIds : "all",
      productIds,
    }),
  );
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
