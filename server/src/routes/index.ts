import type { App } from "../app";
import { ConfigSchema, config } from "../app/config";
import { getVersionString } from "../app/meta";
import { marketIngestionQueue } from "../queue/queues";
import { Health, MarketIngestionRequest } from "./schema";

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
      await marketIngestionQueue.add("ingest-markets", req.body ?? {});
      return res.status(202).send(req.body ?? {});
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
}
