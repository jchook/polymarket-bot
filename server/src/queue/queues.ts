import { Queue } from "bullmq";

export interface MarketIngestionJob {
  tag?: string;
  pageSize?: number;
  maxPages?: number;
}

export const marketIngestionQueue = new Queue<MarketIngestionJob>(
  "market-ingestion",
  {
    connection: {
      host: "redis",
      port: 6379,
    },
  },
);
