import { type Job, Worker } from "bullmq";
import { ingestTrades } from "../../ingestors/tradeIngestor";
import type { TradeIngestionJob } from "../queues";
import { redisConnection } from "../connection";

async function handleTradeJob(job: Job<TradeIngestionJob>): Promise<void> {
  const conditionIds = job.data.conditionIds ?? [];
  const wallet = job.data.wallet?.toLowerCase();
  const exchange = job.data.exchange ?? "polymarket";
  const startAfter = job.data.startAfter ? new Date(job.data.startAfter) : undefined;
  const delayMs = job.data.delayMs ?? 200;

  await job.log(
    `Trade ingestion start count=${conditionIds.length} wallet=${wallet ?? "all"} exchange=${exchange} startAfter=${startAfter?.toISOString() ?? "none"} delayMs=${delayMs}`,
  );

  const res = await ingestTrades({
    conditionIds,
    wallet,
    exchange,
    startAfter,
    delayMs,
  });

  await job.updateProgress({ completed: true, tradesInserted: res?.tradesInserted ?? 0 });
  await job.log(`Trade ingestion complete tradesInserted=${res?.tradesInserted ?? 0}`);
}

export const tradeIngestionWorker = new Worker<TradeIngestionJob>(
  "trade-ingestion",
  handleTradeJob,
  {
    connection: redisConnection,
    concurrency: 2,
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { count: 2000 },
  },
);

tradeIngestionWorker.on("failed", (job, err) => {
  console.error(`Trade ingestion job ${job?.id} failed: ${err.message}`);
});

tradeIngestionWorker.on("ready", () => {
  console.log("Trade ingestion worker ready");
});
