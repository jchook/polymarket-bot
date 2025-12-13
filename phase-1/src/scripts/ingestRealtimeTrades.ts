import { RealTimeDataClient } from "@polymarket/real-time-data-client";
import dotenv from "dotenv";
import { db } from "../db";
import { realtimeTrades, tradeSideEnum } from "../db/schema";

dotenv.config();

type TradePayload = {
  asset: string; // token id
  bio?: string;
  conditionId: string;
  eventSlug?: string;
  icon?: string;
  name?: string;
  outcome: string;
  outcomeIndex: number;
  price: number;
  profileImage?: string;
  proxyWallet: string; // user address
  pseudonym?: string;
  side: "BUY" | "SELL";
  size: number;
  slug?: string;
  timestamp: number;
  title?: string;
  transactionHash?: string;
};

const TARGET_WALLET = process.env.TARGET_WALLET?.toLowerCase();

function toTimestamp(payload: TradePayload): Date {
  const ts = payload.timestamp ?? Math.floor(Date.now() / 1000);
  return ts > 2_000_000_000 ? new Date(ts) : new Date(ts * 1000);
}

async function persistTrade(payload: TradePayload) {
  const conditionId = payload.conditionId;
  if (!conditionId) {
    console.warn(
      `Trade missing conditionId; skipping payload: ${JSON.stringify(payload).slice(0, 200)}`,
    );
    return;
  }

  const outcomeIndex = Number.isFinite(payload.outcomeIndex)
    ? payload.outcomeIndex
    : 0;

  const ts = toTimestamp(payload);
  const side =
    payload.side === "BUY"
      ? tradeSideEnum.enumValues[0]
      : tradeSideEnum.enumValues[1];

  await db
    .insert(realtimeTrades)
    .values({
      conditionId,
      outcomeIndex,
      side,
      price: payload.price.toString(),
      size: payload.size.toString(),
      timestamp: ts,
      transactionHash: payload.transactionHash ?? null,
      proxyWallet: payload.proxyWallet?.toLowerCase() ?? null,
      raw: payload,
    })
    .onConflictDoNothing();

  console.log(
    [
      payload.side,
      payload.outcome,
      `${payload.size}x`,
      `@${payload.price}`,
      payload.slug,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

new RealTimeDataClient({
  onConnect: (client) => {
    client.subscribe({
      subscriptions: [
        {
          topic: "activity",
          type: "trades",
        },
      ],
    });
  },
  onMessage: (_client, msg) => {
    if (msg.topic !== "activity" || msg.type !== "trades") return;
    const t = msg.payload as TradePayload;
    const wallet = t.proxyWallet?.toLowerCase();
    if (TARGET_WALLET && wallet !== TARGET_WALLET) return;
    void persistTrade(t).catch((err) => {
      console.error("Failed to persist trade", err);
    });
  },
  onStatusChange: (status) => console.log(`Connection status:${status}`),
}).connect();
