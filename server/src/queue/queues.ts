import { Queue } from "bullmq";

const redisHost = process.env.REDIS_HOST ?? "redis";
const redisPort = process.env.REDIS_PORT
  ? Number(process.env.REDIS_PORT)
  : 6379;

function attachQueueLogging<T>(queue: Queue<T>, name: string) {
  queue.on("error", (err) => {
    console.error(`[queue:${name}] redis error`, err);
  });
  queue.on("waiting", (jobId) => {
    console.log(`[queue:${name}] job waiting id=${jobId}`);
  });
  queue.on("active", (job) => {
    console.log(`[queue:${name}] job active id=${job.id}`);
  });
  queue.on("failed", (job, err) => {
    console.error(
      `[queue:${name}] job failed id=${job?.id} err=${err.message}`,
    );
  });
  return queue;
}

export interface MarketIngestionJob {
  tag?: string;
  slugs?: string[];
  pageSize?: number;
  maxPages?: number;
  closed?: boolean; // when undefined, Gamma returns all; set to false for open-only or true for resolved
  conditionIds?: string[];
  exchange?: string; // defaults to polymarket
}

export const marketIngestionQueue = new Queue<MarketIngestionJob>(
  "market-ingestion",
  {
    connection: {
      host: redisHost,
      port: redisPort,
    },
  },
);
attachQueueLogging(marketIngestionQueue, "market-ingestion");

export interface OrderbookIngestionJob {
  conditionIds?: string[];
  exchange?: string;
  concurrency?: number;
}

export const orderbookIngestionQueue = new Queue<OrderbookIngestionJob>(
  "orderbook-ingestion",
  {
    connection: {
      host: redisHost,
      port: redisPort,
    },
  },
);
attachQueueLogging(orderbookIngestionQueue, "orderbook-ingestion");
