import { Queue } from "bullmq";

export interface MarketIngestionJob {
  tag?: string;
  pageSize?: number;
  maxPages?: number;
  closed?: boolean;
  conditionIds?: string[];
  exchange?: string; // defaults to polymarket
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
