import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import dotenv from "dotenv";
import { BacktestIntentSink } from "../pipeline/intentSink";
import type { UnifiedEvent } from "../pipeline/unifiedEventConsumer";
import { replayEvents } from "../replay/harness";
import { sortEvents } from "../replay/sorter";

dotenv.config();

async function main() {
  const runId = process.env.RUN_ID || randomUUID();
  const inputFile = process.env.INPUT_FILE;
  const conditionId = process.env.CONDITION_ID || "unknown";
  const assetId = process.env.ASSET_ID || "unknown";
  const featuresVersion = process.env.FEATURES_VERSION || "v0";
  const betaVersion = process.env.BETA_VERSION || "v0";

  if (!inputFile) {
    throw new Error("INPUT_FILE env required (JSON array of UnifiedEvent)");
  }

  const sink = new BacktestIntentSink(runId);
  const ctx = {
    mode: "backtest" as const,
    conditionId,
    assetId,
    featuresVersion,
    betaVersion,
  };

  const startedAt = Date.now();
  let events: UnifiedEvent[] = [];
  try {
    const raw = await readFile(inputFile, "utf-8");
    events = JSON.parse(raw) as UnifiedEvent[];
  } catch (err) {
    console.error("Failed to load events", err);
    process.exit(1);
  }

  // Sanity: first/last exchangeTs and counts by kind
  const orderedPreview = sortEvents(
    events.map((ev, idx) => ({ ...ev, arrivalOrdinal: idx })),
  );
  const firstTs = orderedPreview[0]?.exchangeTs;
  const lastTs = orderedPreview[orderedPreview.length - 1]?.exchangeTs;
  const counts = orderedPreview.reduce<Record<string, number>>((acc, ev) => {
    acc[ev.kind] = (acc[ev.kind] || 0) + 1;
    return acc;
  }, {});
  console.log(
    JSON.stringify({
      runId,
      eventCount: events.length,
      firstExchangeTs: firstTs,
      lastExchangeTs: lastTs,
      counts,
    }),
  );

  const shutdown = async (signal: string) => {
    console.warn(`Received ${signal}, flushing signals...`);
    await sink.flushToDb();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await replayEvents(events, sink, ctx);

  await sink.flushToDb();
  const finishedAt = Date.now();
  const hash = createHash("md5");
  const orderedForHash = sortEvents(
    events.map((ev, idx) => ({ ...ev, arrivalOrdinal: idx })),
  );
  hash.update(
    orderedForHash
      .map(
        (ev) =>
          `${ev.exchangeTs}:${ev.kind}:${"conditionId" in ev ? (ev as any).conditionId ?? "" : ""}:${"assetId" in ev ? (ev as any).assetId ?? "" : ""}:${ev.ingestTs ?? ""}:${"productId" in ev ? (ev as any).productId ?? "" : ""}`,
      )
      .join(","),
  );
  console.log(
    JSON.stringify({
      runId,
      conditionId,
      assetId,
      featuresVersion,
      betaVersion,
      startedAt,
      finishedAt,
      eventCount: events.length,
      eventHash: hash.digest("hex"),
    }),
  );
}

void main();
