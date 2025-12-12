import dotenv from "dotenv";
import { RealTimeDataClient } from "@polymarket/real-time-data-client";
import { db } from "../db";
import {
  markets,
  trades,
  userTrades,
  tradeRoleEnum,
  tradeSideEnum,
} from "../db/schema";
import { eq } from "drizzle-orm";

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
    console.warn(`Trade missing conditionId; skipping payload: ${JSON.stringify(payload).slice(0, 200)}`);
    return;
  }

  const marketKnown = await db
    .select({ conditionId: markets.conditionId })
    .from(markets)
    .where(eq(markets.conditionId, conditionId))
    .limit(1);
  if (!marketKnown.length) {
    console.warn(
      `Skipping trade for unknown conditionId=${conditionId}; ingest markets first.`,
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

  const wallet = payload.proxyWallet?.toLowerCase();
  const tradeId =
    payload.transactionHash ??
    `${payload.conditionId}-${payload.timestamp}-${payload.proxyWallet}`;

  await db
    .insert(trades)
    .values({
      tradeId,
      conditionId,
      outcomeIndex,
      exchange: "polymarket",
      taker: wallet ?? null,
      maker: null,
      side,
      price: payload.price.toString(),
      size: payload.size.toString(),
      timestamp: ts,
      txHash: payload.transactionHash ?? null,
      raw: payload,
    })
    .onConflictDoNothing();

  if (wallet) {
    await db
      .insert(userTrades)
      .values({
        tradeId,
        wallet,
        exchange: "polymarket",
        role: "taker" as (typeof tradeRoleEnum.enumValues)[number],
        side,
        price: payload.price.toString(),
        size: payload.size.toString(),
        timestamp: ts,
      })
      .onConflictDoNothing();
  }

  console.log(
    [
      "stored",
      conditionId,
      `side=${payload.side}`,
      `size=${payload.size}`,
      `px=${payload.price}`,
      wallet ? `wallet=${wallet}` : "",
      ts.toISOString(),
    ]
      .filter(Boolean)
      .join(" | "),
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
  onStatusChange: (status) => console.log("Connection status:" + status),
}).connect();
