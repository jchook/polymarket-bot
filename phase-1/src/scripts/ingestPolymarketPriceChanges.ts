import { RealTimeDataClient } from "@polymarket/real-time-data-client";
import dotenv from "dotenv";
import { db } from "../db";
import {
  type BestBook,
  type PriceChangesEvent,
  processPmPriceChangesEvent,
} from "../pipeline/pmPriceChanges";
import { handleUnifiedEvent } from "../pipeline/unifiedEventConsumer";

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

const TARGET_ASSETS = (process.env.TARGET_ASSETS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const FILTERS = TARGET_ASSETS.length > 0 ? TARGET_ASSETS.join(",") : undefined;

const STALE_MS = Number(process.env.BEST_BOOK_STALE_MS ?? 5_000);

const bestBooks = new Map<string, BestBook>();

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
    targetAssets: TARGET_ASSETS,
    staleMs: STALE_MS,
    onBestBookUpdated: async (assetId, book, mid, exchangeTs) => {
      await handleUnifiedEvent({
        kind: "pmBook",
        assetId,
        conditionId: event.conditionId,
        bestAsk: book.bestAsk,
        bestBid: book.bestBid,
        mid,
        exchangeTs,
        ingestTs,
      });
    },
  });
}

new RealTimeDataClient({
  onConnect: (client) => {
    client.subscribe({
      subscriptions: [
        {
          topic: "clob_market",
          type: "price_changes",
          filters: FILTERS,
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
}).connect();
