import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../db/schema";
import { spotPrices } from "../db/schema";

type Database = NodePgDatabase<typeof schema>;

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
  db: Database;
  productIds: string[];
  staleMs: number;
  onSpotPrice?: (
    productId: string,
    baseAsset: string | undefined,
    quoteAsset: string | undefined,
    mid: number | undefined,
    exchangeTs: number,
    ingestTs: number,
  ) => void | Promise<void>;
};

export async function processCoinbaseTicker(
  msg: CoinbaseTickerMessage,
  opts: CoinbaseProcessorOptions,
) {
  const { db, productIds, staleMs } = opts;
  const productId = msg.product_id;
  if (!productId || !productIds.includes(productId)) return;

  const [baseAsset, quoteAsset] = productId.split("-");

  const ts = msg.time ? Date.parse(msg.time) : Date.now();
  const ingestTs = Date.now();
  if (!Number.isFinite(ts) || ingestTs - ts > staleMs) return;

  const bestBid = msg.best_bid ? Number(msg.best_bid) : undefined;
  const bestAsk = msg.best_ask ? Number(msg.best_ask) : undefined;
  const mid =
    bestBid && bestAsk
      ? (bestBid + bestAsk) / 2
      : msg.price
        ? Number(msg.price)
        : undefined;

  if (opts.onSpotPrice) {
    await opts.onSpotPrice(productId, baseAsset, quoteAsset, mid, ts, ingestTs);
  }

  await db
    .insert(spotPrices)
    .values({
      exchange: "coinbase",
      productId,
      baseAsset: baseAsset ?? null,
      quoteAsset: quoteAsset ?? null,
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
