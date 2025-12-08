import { z } from "zod";

export const MarketIngestionRequest = z
  .object({
    tag: z.string().optional(),
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

export const Health = z
  .object({
    status: z.literal("ok"),
  })
  .openapi({
    ref: "Health",
    description: "Health check",
  });
