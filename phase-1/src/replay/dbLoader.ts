import { and, gte, lte, inArray } from "drizzle-orm";
import { db, pmPriceChanges, spotPrices, marketMetadata } from "../db";
import { sortEvents } from "./sorter";
import type { ReplayEvent } from "./types";

export type EventStreamOptions = {
  startMs: number;
  endMs: number;
  conditionIds?: string[];
  productIds?: string[];
  chunkSize?: number;
};

// Stream UnifiedEvents from DB in chunks to keep memory usage bounded.
export async function* streamEvents(
  opts: EventStreamOptions,
): AsyncGenerator<ReplayEvent[], void, void> {
  const chunkSize = opts.chunkSize ?? 5_000;
  const { startMs, endMs } = opts;

  const markets =
    opts.conditionIds && opts.conditionIds.length > 0
      ? await db
          .select({
            conditionId: marketMetadata.conditionId,
            assetIdUp: marketMetadata.assetIdUp,
            assetIdDown: marketMetadata.assetIdDown,
          })
          .from(marketMetadata)
          .where(inArray(marketMetadata.conditionId, opts.conditionIds))
      : await db
          .select({
            conditionId: marketMetadata.conditionId,
            assetIdUp: marketMetadata.assetIdUp,
            assetIdDown: marketMetadata.assetIdDown,
          })
          .from(marketMetadata)
          .limit(100);

  const assetIds = Array.from(
    new Set(
      markets
        .flatMap((m) => [m.assetIdUp, m.assetIdDown])
        .filter((a): a is string => Boolean(a)),
    ),
  );

  let offset = 0;
  while (true) {
    const pmRows = await db
      .select({
        conditionId: pmPriceChanges.conditionId,
        assetId: pmPriceChanges.assetId,
        bestBid: pmPriceChanges.bestBid,
        bestAsk: pmPriceChanges.bestAsk,
        midPrice: pmPriceChanges.midPrice,
        timestamp: pmPriceChanges.timestamp,
      })
      .from(pmPriceChanges)
      .where(
        and(
          inArray(pmPriceChanges.assetId, assetIds),
          gte(pmPriceChanges.timestamp, new Date(startMs)),
          lte(pmPriceChanges.timestamp, new Date(endMs)),
        ),
      )
      .limit(chunkSize)
      .offset(offset);

    const spotRows = await db
      .select({
        productId: spotPrices.productId,
        midPrice: spotPrices.midPrice,
        bestBid: spotPrices.bestBid,
        bestAsk: spotPrices.bestAsk,
        timestamp: spotPrices.timestamp,
      })
      .from(spotPrices)
      .where(
        and(
          inArray(spotPrices.productId, opts.productIds ?? ["BTC-USD"]),
          gte(spotPrices.timestamp, new Date(startMs)),
          lte(spotPrices.timestamp, new Date(endMs)),
        ),
      )
      .limit(chunkSize)
      .offset(offset);

    offset += chunkSize;
    if (pmRows.length === 0 && spotRows.length === 0) break;

    const events: ReplayEvent[] = [];
    pmRows.forEach((row, idx) => {
      const ts = row.timestamp?.getTime();
      if (!ts) return;
      events.push({
        kind: "pmBook",
        conditionId: row.conditionId ?? undefined,
        assetId: row.assetId ?? undefined,
        exchangeTs: ts,
        ingestTs: ts,
        arrivalOrdinal: idx,
        bestBid: num(row.bestBid),
        bestAsk: num(row.bestAsk),
        mid: num(row.midPrice),
      } as ReplayEvent);
    });

    spotRows.forEach((row, idx) => {
      const ts = row.timestamp?.getTime();
      if (!ts) return;
      events.push({
        kind: "spot",
        productId: row.productId ?? undefined,
        exchangeTs: ts,
        ingestTs: ts,
        arrivalOrdinal: idx,
        mid: num(row.midPrice),
        bestBid: num(row.bestBid),
        bestAsk: num(row.bestAsk),
      } as ReplayEvent);
    });

    yield sortEvents(events);
  }
}

function num(x: unknown): number | undefined {
  if (x === null || x === undefined) return undefined;
  const n = Number(x);
  return Number.isFinite(n) ? n : undefined;
}
