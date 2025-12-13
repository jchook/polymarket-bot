import { RealTimeDataClient } from "@polymarket/real-time-data-client";
import dotenv from "dotenv";
import { db } from "../db";
import type { IntentSink, PipelineContext } from "../pipeline/intentSink";
import {
  type BestBook,
  type PriceChangesEvent,
  processPmPriceChangesEvent,
} from "../pipeline/pmPriceChanges";
import { handleUnifiedEvent } from "../pipeline/unifiedEventConsumer";
import { logger } from "../lib/logger";
import { MarketCatalog } from "./marketCatalog";

dotenv.config();

type PriceChangesMessage = {
  topic: "clob_market";
  type: "price_change";
  payload: {
    m: string; // conditionId
    pc: PriceChangesEvent["changes"];
    t: string; // ms timestamp
  };
};

export type PolymarketFeedHandle = {
  stop: () => void;
};

export function startPolymarketPriceFeed(options: {
  catalog: MarketCatalog;
  targetAssets?: string[];
  staleMs: number;
  sink?: IntentSink;
  ctx: PipelineContext;
}): PolymarketFeedHandle {
  const { catalog, staleMs, sink, ctx } = options;
  const log = logger("pm");
  const targetAssets =
    options.targetAssets && options.targetAssets.length > 0
      ? options.targetAssets
      : null;

  const bestBooks = new Map<string, BestBook>();
  const client = new RealTimeDataClient({
    onConnect: (c) => {
      const filters = currentFilters();
      c.subscribe({
        subscriptions: [
          {
            topic: "clob_market",
            type: "price_change",
            filters,
          },
        ],
      });
    },
    onMessage: (_client, msg) => {
      if (msg.topic !== "clob_market" || msg.type !== "price_change") return;
      void handlePriceChanges(msg as PriceChangesMessage).catch((err) => {
        console.error("Failed to persist price_change", err);
      });
    },
    onStatusChange: (status) => log("status %s %s", new Date().toISOString(), status),
  });

  const currentFilters = () => {
    const assets =
      targetAssets && targetAssets.length > 0
        ? targetAssets
        : catalog.getActiveAssetIds();
    return assets.length > 0 ? JSON.stringify(assets) : undefined;
  };

  const resubscribe = (assets: string[]) => {
    const filters = assets.length > 0 ? JSON.stringify(assets) : undefined;
    client.subscribe({
      subscriptions: [
        {
          topic: "clob_market",
          type: "price_change",
          filters,
        },
      ],
    });
  };

  async function handlePriceChanges(msg: PriceChangesMessage) {
    const tsMs = Number(msg.payload.t);
    const ingestTs = Date.now();
    const changes = Array.isArray(msg.payload.pc)
      ? msg.payload.pc
      : [];
    if (changes.length === 0) {
      console.warn("Skipping price_change with no price_changes array", {
        topic: msg.topic,
        type: msg.type,
        payloadKeys: Object.keys(msg.payload || {}),
      });
      return;
    }
    const event: PriceChangesEvent = {
      conditionId: msg.payload.m,
      timestampMs: Number.isFinite(tsMs) ? tsMs : ingestTs,
      ingestTs,
      changes,
    };

    await processPmPriceChangesEvent(event, {
      db,
      bestBooks,
      targetAssets: targetAssets ?? [],
      staleMs,
      onBestBookUpdated: async (assetId, book, mid, exchangeTs) => {
        await handleUnifiedEvent(
          {
            kind: "pmBook",
            assetId,
            conditionId: event.conditionId,
            bestAsk: book.bestAsk,
            bestBid: book.bestBid,
            mid,
            exchangeTs,
            ingestTs,
          },
          sink,
          {
            ...ctx,
            conditionId: event.conditionId,
            assetId,
          },
        );
      },
    });
  }

  catalog.onUpdate((markets) => {
    if (targetAssets && targetAssets.length > 0) return; // manual override, do not resubscribe
    const assets = markets.flatMap((m) => m.assetIds);
    resubscribe(assets);
  });

  client.connect();

  return {
    stop: () => {
      try {
        client.disconnect?.();
      } catch (err) {
        console.error("Failed to close Polymarket WS", err);
      }
    },
  };
}
