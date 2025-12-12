import { z } from "zod";

export const MarketIngestionRequest = z
  .object({
    tag: z.string().optional(),
    slugs: z.array(z.string().min(1)).optional(),
    closed: z
      .boolean()
      .optional()
      .describe("Fetch closed markets (default: false)"),
    conditionIds: z
      .array(z.string().min(1))
      .optional()
      .describe("Restrict ingestion to specific condition IDs"),
    exchange: z
      .string()
      .optional()
      .describe("Exchange name label (default: polymarket)"),
    pageSize: z
      .number()
      .int()
      .min(1)
      .max(500)
      .optional()
      .describe("Gamma API page size"),
    maxPages: z
      .number()
      .int()
      .min(1)
      .max(2000)
      .optional()
      .describe("Maximum number of pages to fetch"),
  })
  .openapi({
    ref: "MarketIngestionRequest",
    description: "Parameters for market ingestion from Gamma",
  });

export const OrderbookIngestionRequest = z
  .object({
    conditionIds: z.array(z.string().min(1)).optional(),
    exchange: z
      .string()
      .optional()
      .describe("Exchange label (default polymarket)"),
    concurrency: z.number().int().min(1).max(20).optional(),
  })
  .openapi({
    ref: "OrderbookIngestionRequest",
    description: "Parameters for orderbook ingestion",
  });

export const TradeIngestionRequest = z
  .object({
    conditionIds: z.array(z.string().min(1)).optional(),
    wallet: z.string().optional(),
    exchange: z.string().optional(),
    startAfter: z.string().optional(),
  })
  .openapi({
    ref: "TradeIngestionRequest",
    description: "Parameters for trade ingestion",
  });

export const IntraArbQuery = z
  .object({
    conditionIds: z.array(z.string()).optional(),
    exchange: z.string().optional(),
    threshold: z
      .number()
      .optional()
      .describe("Minimum margin (e.g. 0.0 for any arb)"),
    matcher: z
      .string()
      .optional()
      .describe("Market matcher name (heuristic, heuristic-v1, etc.)"),
  })
  .openapi({
    ref: "IntraArbQuery",
    description: "Query parameters for intra-event arb detection",
  });

export const IntraArbOutcome = z.object({
  conditionId: z.string(),
  outcomeIndex: z.number(),
  outcomeName: z.string(),
  exchange: z.string(),
  bestAskPrice: z.number().nullable(),
  bestAskSize: z.number().nullable(),
  bestBidPrice: z.number().nullable(),
  bestBidSize: z.number().nullable(),
});

export const IntraArbResult = z.object({
  matcherName: z.string(),
  matcherKey: z.string(),
  conditionIds: z.array(z.string()),
  conditionId: z.string(),
  title: z.string(),
  marketSlug: z.string().nullable(),
  margin: z.number(),
  totalAsk: z.number(),
  timestamp: z.string().describe("ISO timestamp of snapshot"),
  outcomes: z.array(IntraArbOutcome),
});

export const Health = z
  .object({
    status: z.literal("ok"),
  })
  .openapi({
    ref: "Health",
    description: "Health check",
  });
