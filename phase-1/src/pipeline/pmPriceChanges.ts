import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { pmPriceChanges, tradeSideEnum } from "../db/schema";

export type PriceChange = {
  a: string; // asset_id
  h?: string; // hash
  p: string; // price
  s: "BUY" | "SELL";
  si: string; // size
  ba?: string; // best ask
  bb?: string; // best bid
};

export type PriceChangesEvent = {
  conditionId: string;
  timestampMs: number;
  changes: PriceChange[];
};

export type BestBook = {
  bestBid?: number;
  bestAsk?: number;
  updatedAt: number;
  hash?: string;
};

export type PmProcessorOptions = {
  db: NodePgDatabase;
  bestBooks: Map<string, BestBook>;
  targetAssets: string[];
  staleMs: number;
};

function updateBestBook(
  cache: Map<string, BestBook>,
  assetId: string,
  change: PriceChange,
  ts: number,
): BestBook {
  const current = cache.get(assetId) ?? { updatedAt: 0 };
  const bestBid = change.bb ? Number(change.bb) : current.bestBid;
  const bestAsk = change.ba ? Number(change.ba) : current.bestAsk;
  const next: BestBook = {
    bestBid,
    bestAsk,
    updatedAt: ts,
    hash: change.h ?? current.hash,
  };
  cache.set(assetId, next);
  return next;
}

function computeMid(book: BestBook, ts: number, staleMs: number): number | null {
  const isStale = ts - book.updatedAt > staleMs;
  if (!book.bestBid || !book.bestAsk || isStale) return null;
  return (book.bestBid + book.bestAsk) / 2;
}

export async function processPmPriceChangesEvent(
  event: PriceChangesEvent,
  opts: PmProcessorOptions,
) {
  const { db, bestBooks, targetAssets, staleMs } = opts;
  const ts = Number.isFinite(event.timestampMs) ? event.timestampMs : Date.now();

  for (const change of event.changes) {
    const assetId = change.a;
    if (targetAssets.length > 0 && !targetAssets.includes(assetId)) continue;

    const book = updateBestBook(bestBooks, assetId, change, ts);
    const mid = computeMid(book, ts, staleMs);

    await db
      .insert(pmPriceChanges)
      .values({
        conditionId: event.conditionId,
        assetId,
        hash: change.h ?? null,
        side:
          change.s === "BUY"
            ? tradeSideEnum.enumValues[0]
            : tradeSideEnum.enumValues[1],
        price: change.p ?? null,
        size: change.si ?? null,
        bestBid: change.bb ?? book.bestBid?.toString() ?? null,
        bestAsk: change.ba ?? book.bestAsk?.toString() ?? null,
        midPrice: mid ? mid.toString() : null,
        timestamp: new Date(ts),
        raw: change,
      })
      .onConflictDoNothing();
  }
}
