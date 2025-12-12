import dotenv from "dotenv";
import { RealTimeDataClient } from "@polymarket/real-time-data-client";
import { db } from "../db";
import {
  processPmPriceChangesEvent,
  type PriceChangesEvent,
  type BestBook,
} from "../pipeline/pmPriceChanges";

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

const STALE_MS = Number(process.env.BEST_BOOK_STALE_MS ?? 5_000);

const bestBooks = new Map<string, BestBook>();

async function handlePriceChanges(msg: PriceChangesMessage) {
  const tsMs = Number(msg.payload.t);
  const event: PriceChangesEvent = {
    conditionId: msg.payload.m,
    timestampMs: Number.isFinite(tsMs) ? tsMs : Date.now(),
    changes: msg.payload.pc,
  };

  await processPmPriceChangesEvent(event, {
    db,
    bestBooks,
    targetAssets: TARGET_ASSETS,
    staleMs: STALE_MS,
  });
}

new RealTimeDataClient({
  onConnect: (client) => {
    client.subscribe({
      subscriptions: [
        {
          topic: "clob_market",
          type: "price_changes",
          filters: TARGET_ASSETS,
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
