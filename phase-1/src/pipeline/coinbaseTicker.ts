import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { btcSpotTicks } from "../db/schema";

export type CoinbaseTickerMessage = {
  type: "ticker";
  product_id: string;
  price?: string;
  best_bid?: string;
  best_ask?: string;
  time?: string;
  last_size?: string;
};

export type CoinbaseProcessorOptions = {
  db: NodePgDatabase;
  productIds: string[];
  staleMs: number;
};

export async function processCoinbaseTicker(
  msg: CoinbaseTickerMessage,
  opts: CoinbaseProcessorOptions,
) {
  const { db, productIds, staleMs } = opts;
  const productId = msg.product_id;
  if (!productId || !productIds.includes(productId)) return;

  const ts = msg.time ? Date.parse(msg.time) : Date.now();
  if (!Number.isFinite(ts) || Date.now() - ts > staleMs) return;

  const bestBid = msg.best_bid ? Number(msg.best_bid) : undefined;
  const bestAsk = msg.best_ask ? Number(msg.best_ask) : undefined;
  const mid =
    bestBid && bestAsk
      ? (bestBid + bestAsk) / 2
      : msg.price
        ? Number(msg.price)
        : undefined;

  await db
    .insert(btcSpotTicks)
    .values({
      exchange: "coinbase",
      productId,
      bestBid: bestBid?.toString() ?? null,
      bestAsk: bestAsk?.toString() ?? null,
      midPrice: mid?.toString() ?? null,
      tradePrice: msg.price ?? null,
      tradeSize: msg.last_size ?? null,
      timestamp: new Date(ts),
      raw: msg,
    })
    .catch((err) => console.error("Failed to persist Coinbase tick", err));
}
