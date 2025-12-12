import z from "zod";
import type { App } from "../app";
import { ConfigSchema, config } from "../app/config";
import { getVersionString } from "../app/meta";
import {
  marketIngestionQueue,
  orderbookIngestionQueue,
  tradeIngestionQueue,
} from "../queue/queues";
import {
  Health,
  IntraArbQuery,
  IntraArbResult,
  MarketIngestionRequest,
  OrderbookIngestionRequest,
  TradeIngestionRequest,
} from "./schema";
import { fetchLatestSnapshots } from "../services/arbSnapshotService";
import { findIntraArbs } from "../services/arbDetector";
import { getMatcher } from "../services/marketMatcher";

export function withV1(app: App) {
  app.route({
    method: "POST",
    url: "/ingest/markets",
    schema: {
      description: "Queue a market ingestion job (Gamma markets/events)",
      tags: ["Ingestion"],
      body: MarketIngestionRequest,
      response: {
        202: MarketIngestionRequest,
      },
    },
    handler: async (req, res) => {
      const payload = req.body ?? {};
      await marketIngestionQueue.add("ingest-markets", payload);
      return res.status(202).send(payload);
    },
  });

  app.route({
    method: "POST",
    url: "/ingest/orderbooks",
    schema: {
      description: "Queue an orderbook ingestion job",
      tags: ["Ingestion"],
      body: OrderbookIngestionRequest,
      response: {
        202: OrderbookIngestionRequest,
      },
    },
    handler: async (req, res) => {
      const payload = req.body ?? {};
      await orderbookIngestionQueue.add("ingest-orderbooks", payload);
      return res.status(202).send(payload);
    },
  });

  app.route({
    method: "POST",
    url: "/ingest/trades",
    schema: {
      description: "Queue a trade ingestion job",
      tags: ["Ingestion"],
      body: TradeIngestionRequest,
      response: {
        202: TradeIngestionRequest,
      },
    },
    handler: async (req, res) => {
      const payload = req.body ?? {};
      await tradeIngestionQueue.add("ingest-trades", payload);
      return res.status(202).send(payload);
    },
  });

  app.route({
    method: "GET",
    url: "/health",
    schema: {
      description: "Health check",
      tags: ["Meta"],
      response: {
        200: Health,
      },
    },
    handler: async () => ({ status: "ok" as const }),
  });

  app.route({
    method: "GET",
    url: "/meta/info",
    schema: {
      description: "Get API version and configuration",
      tags: ["Meta"],
      response: {
        200: ConfigSchema,
      },
    },
    handler: async () => {
      if (!config.version) {
        config.version = await getVersionString();
      }
      return config;
    },
  });

  app.route({
    method: "GET",
    url: "/arbs/intra",
    schema: {
      description:
        "Get intra-event (same market) arbitrage candidates from latest snapshots",
      tags: ["Meta"],
      querystring: IntraArbQuery,
      response: {
        200: z.array(IntraArbResult),
      },
    },
    handler: async (req) => {
      const conditionIds = req.query.conditionIds;
      const exchange = req.query.exchange ?? "polymarket";
      const threshold = req.query.threshold ?? 0;
      const matcher = getMatcher(req.query.matcher);
      const snapshots = await fetchLatestSnapshots({ conditionIds, exchange });
      const arbs = findIntraArbs(snapshots, threshold, matcher);
      return arbs.map((arb) => ({
        ...arb,
        timestamp: arb.timestamp.toISOString(),
      }));
    },
  });
}
