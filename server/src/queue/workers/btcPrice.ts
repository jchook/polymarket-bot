import { type Job, Worker } from "bullmq";
import { ingestBtcPrices } from "../../ingestors/btcPriceIngestor";
import type { BtcPriceIngestionJob } from "../queues";
import { redisConnection } from "../connection";

async function handleBtcPriceJob(job: Job<BtcPriceIngestionJob>): Promise<void> {
  const symbol = job.data.symbol ?? "BTCUSDT";
  const exchange = job.data.exchange ?? "binance";
  const intervalMs = job.data.intervalMs;
  const start = job.data.start ? new Date(job.data.start) : undefined;
  const end = job.data.end ? new Date(job.data.end) : undefined;

  await job.log(
    `BTC price ingestion start symbol=${symbol} exchange=${exchange} intervalMs=${intervalMs} start=${start?.toISOString() ?? "auto"} end=${end?.toISOString() ?? "now"}`,
  );

  const { inserted, batches } = await ingestBtcPrices({
    symbol,
    exchange,
    start,
    end,
    intervalMs,
  });

  await job.updateProgress({ completed: true, inserted, batches });
  await job.log(
    `BTC price ingestion complete inserted=${inserted} batches=${batches}`,
  );
}

export const btcPriceIngestionWorker = new Worker<BtcPriceIngestionJob>(
  "btc-price-ingestion",
  handleBtcPriceJob,
  {
    connection: redisConnection,
    concurrency: 2,
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { count: 2000 },
  },
);

btcPriceIngestionWorker.on("failed", (job, err) => {
  console.error(`BTC price ingestion job ${job?.id} failed: ${err.message}`);
});

btcPriceIngestionWorker.on("ready", () => {
  console.log("BTC price ingestion worker ready");
});
