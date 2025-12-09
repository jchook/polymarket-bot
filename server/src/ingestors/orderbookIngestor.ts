import { and, eq, inArray } from "drizzle-orm";
import { clobClient } from "../clients/polymarketClob";
import { db } from "../db";
import { marketOutcomes, markets, orderbookSnapshots } from "../db/schema";

type OutcomeRow = {
  conditionId: string;
  outcomeIndex: number;
  outcomeName: string;
  tokenId: string;
};

export type OrderbookIngestConfig = {
  conditionIds?: string[];
  exchange?: string;
  concurrency?: number;
};

const toNumber = (value?: string | null) =>
  value === undefined || value === null ? null : Number(value);

const toNumericString = (value: number | null) =>
  value === null || Number.isNaN(value) ? null : value.toString();

async function loadOutcomes(
  conditionIds?: string[],
): Promise<Record<string, OutcomeRow[]>> {
  const where = conditionIds?.length
    ? and(inArray(markets.conditionId, conditionIds), eq(markets.resolved, false))
    : eq(markets.resolved, false);

  const rows = await db
    .select({
      conditionId: markets.conditionId,
      outcomeIndex: marketOutcomes.outcomeIndex,
      outcomeName: marketOutcomes.outcomeName,
      tokenId: marketOutcomes.tokenId,
    })
    .from(markets)
    .innerJoin(
      marketOutcomes,
      eq(marketOutcomes.conditionId, markets.conditionId),
    )
    .where(where);

  return rows.reduce<Record<string, OutcomeRow[]>>((acc, row) => {
    if (!row.tokenId) return acc;
    acc[row.conditionId] = acc[row.conditionId] ?? [];
    acc[row.conditionId].push(row);
    return acc;
  }, {});
}

async function fetchOrderbooks(
  outcomes: OutcomeRow[],
  concurrency: number,
): Promise<
  {
    outcome: OutcomeRow;
    bestBidPrice: number | null;
    bestBidSize: number | null;
    bestAskPrice: number | null;
    bestAskSize: number | null;
    raw: unknown;
  }[]
> {
  const results: Array<
    | {
        outcome: OutcomeRow;
        bestBidPrice: number | null;
        bestBidSize: number | null;
        bestAskPrice: number | null;
        bestAskSize: number | null;
        raw: unknown;
      }
    | undefined
  > = new Array(outcomes.length);

  let idx = 0;
  const workers = Array.from({ length: Math.min(concurrency, outcomes.length) }).map(
    async () => {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const current = idx++;
        if (current >= outcomes.length) break;
        const outcome = outcomes[current];
        const book = await clobClient.getOrderBook(outcome.tokenId);
        const bestBid = book.bids?.[0];
        const bestAsk = book.asks?.[0];
        results[current] = {
          outcome,
          bestBidPrice: toNumber(bestBid?.price),
          bestBidSize: toNumber(bestBid?.size),
          bestAskPrice: toNumber(bestAsk?.price),
          bestAskSize: toNumber(bestAsk?.size),
          raw: book,
        };
      }
    },
  );

  await Promise.all(workers);
  return results.filter(Boolean) as NonNullable<typeof results[number]>[];
}

export async function ingestOrderbooks({
  conditionIds,
  exchange = "polymarket",
  concurrency = 6,
}: OrderbookIngestConfig = {}) {
  const outcomesByCondition = await loadOutcomes(conditionIds);
  const allOutcomes = Object.values(outcomesByCondition).flat();
  if (!allOutcomes.length) {
    console.log("No unresolved outcomes found for orderbook ingestion.");
    return;
  }

  const serverTime = await clobClient.getServerTime();
  const timestampRaw =
    typeof serverTime === "string" ? Number(serverTime) : serverTime;
  const timestamp = Number.isFinite(timestampRaw)
    ? new Date(
        timestampRaw > 2_000_000_000 ? timestampRaw : timestampRaw * 1000,
      )
    : new Date();

  const books = await fetchOrderbooks(allOutcomes, concurrency);

  const inserts = books.map((b) => ({
    conditionId: b.outcome.conditionId,
    outcomeIndex: b.outcome.outcomeIndex,
    exchange,
    timestamp,
    bestBidPrice: toNumericString(b.bestBidPrice),
    bestBidSize: toNumericString(b.bestBidSize),
    bestAskPrice: toNumericString(b.bestAskPrice),
    bestAskSize: toNumericString(b.bestAskSize),
    midPrice:
      b.bestBidPrice !== null && b.bestAskPrice !== null
        ? toNumericString((b.bestBidPrice + b.bestAskPrice) / 2)
        : null,
    spread:
      b.bestBidPrice !== null && b.bestAskPrice !== null
        ? toNumericString(b.bestAskPrice - b.bestBidPrice)
        : null,
    rawOrderbook: b.raw,
  }));

  if (inserts.length) {
    await db.insert(orderbookSnapshots).values(inserts).onConflictDoNothing();
  }

  console.log(
    `Orderbook ingestion complete. outcomes=${allOutcomes.length}, snapshots_saved=${inserts.length}, timestamp=${timestamp.toISOString()}`,
  );
}
