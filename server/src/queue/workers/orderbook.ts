import { type ConnectionOptions, Worker } from "bullmq";
import { ingestOrderbooks } from "../../ingestors/orderbookIngestor";
import type { OrderbookIngestionJob } from "../queues";

const connection: ConnectionOptions = {
  host: process.env.REDIS_HOST ?? "redis",
  port: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : 6379,
};

async function handleOrderbookJob(job: { data: OrderbookIngestionJob }) {
  await job.log(
    `Orderbook ingestion start conditionIds=${job.data.conditionIds?.join(",") ?? "all"} exchange=${job.data.exchange ?? "polymarket"} concurrency=${job.data.concurrency ?? 6}`,
  );
  try {
    await ingestOrderbooks({
      conditionIds: job.data.conditionIds,
      exchange: job.data.exchange,
      concurrency: job.data.concurrency,
    });
    await job.updateProgress({ completed: true });
    await job.log("Orderbook ingestion completed successfully");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await job.log(`Orderbook ingestion failed: ${message}`);
    throw err;
  }
}

export const orderbookIngestionWorker = new Worker<OrderbookIngestionJob>(
  "orderbook-ingestion",
  handleOrderbookJob,
  {
    connection,
    concurrency: 5,
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { count: 2000 },
  },
);

orderbookIngestionWorker.on("failed", (job, err) => {
  console.error(`Orderbook ingestion job ${job?.id} failed: ${err.message}`);
});

orderbookIngestionWorker.on("ready", () => {
  console.log("Orderbook ingestion worker ready");
});
