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
import { MarketCatalog } from "./marketCatalog";

dotenv.config();

type PriceChangesMessage = {
  topic: "clob_market";
  type: "price_changes";
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
  const targetAssets =
    options.targetAssets && options.targetAssets.length > 0
      ? options.targetAssets
      : undefined;

  const bestBooks = new Map<string, BestBook>();
  const client = new RealTimeDataClient({
    onConnect: (c) => {
      const filters = currentFilters();
      c.subscribe({
        subscriptions: [
          {
            topic: "clob_market",
            type: "price_changes",
            filters,
          },
        ],
      });
    },
    onMessage: (_client, msg) => {
      if (msg.topic !== "clob_market" || msg.type !== "price_changes") return;
      void handlePriceChanges(msg as PriceChangesMessage).catch((err) => {
        console.error("Failed to persist price_change", err);
      });
    },
    onStatusChange: (status) =>
      console.log(new Date().toISOString(), "PM price_changes status:", status),
  });

  const currentFilters = () => {
    const assets = targetAssets ?? catalog.getActiveAssetIds();
    return assets.length > 0 ? assets.join(",") : undefined;
  };

  const resubscribe = (assets: string[]) => {
    const filters = assets.length > 0 ? assets.join(",") : undefined;
    client.subscribe({
      subscriptions: [
        {
          topic: "clob_market",
          type: "price_changes",
          filters,
        },
      ],
    });
  };

  async function handlePriceChanges(msg: PriceChangesMessage) {
    const tsMs = Number(msg.payload.t);
    const ingestTs = Date.now();
    const event: PriceChangesEvent = {
      conditionId: msg.payload.m,
      timestampMs: Number.isFinite(tsMs) ? tsMs : ingestTs,
      ingestTs,
      changes: msg.payload.pc,
    };

    await processPmPriceChangesEvent(event, {
      db,
      bestBooks,
      targetAssets,
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
    if (targetAssets) return; // manual override, do not resubscribe
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
