import { eq } from "drizzle-orm";
import { clobClient } from "../clients/polymarketClob";
import { db } from "../db";
import { marketOutcomes, markets, orderbookSnapshots } from "../db/schema";

type Outcome = {
  conditionId: string;
  outcomeIndex: number;
  tokenId: string;
  outcomeName: string;
  title: string;
  marketSlug: string | null;
};

type OrderbookBest = {
  bestBidPrice: number | null;
  bestBidSize: number | null;
  bestAskPrice: number | null;
  bestAskSize: number | null;
};

type BookWithOutcome = Outcome & {
  book: Awaited<ReturnType<typeof clobClient.getOrderBook>>;
  best: OrderbookBest;
};

type ArbOpportunity = {
  conditionId: string;
  title: string;
  marketSlug: string | null;
  outcomes: Array<
    OrderbookBest & {
      tokenId: string;
      outcomeName: string;
      outcomeIndex: number;
    }
  >;
  totalAsk: number;
  margin: number;
};

const toNumber = (value?: string | null) =>
  value === undefined || value === null ? null : Number(value);

const toNumericString = (value: number | null) =>
  value === null || Number.isNaN(value) ? null : value.toString();

async function fetchActiveBinaryOutcomes(): Promise<Outcome[][]> {
  const rows = await db
    .select({
      conditionId: markets.conditionId,
      title: markets.title,
      marketSlug: markets.marketSlug,
      outcomeIndex: marketOutcomes.outcomeIndex,
      tokenId: marketOutcomes.tokenId,
      outcomeName: marketOutcomes.outcomeName,
    })
    .from(markets)
    .innerJoin(
      marketOutcomes,
      eq(marketOutcomes.conditionId, markets.conditionId),
    )
    .where(eq(markets.resolved, false));

  const grouped = new Map<string, Outcome[]>();
  for (const row of rows) {
    if (!row.tokenId) continue;
    const list = grouped.get(row.conditionId) ?? [];
    list.push(row);
    grouped.set(row.conditionId, list);
  }

  return Array.from(grouped.values()).filter(
    (outcomes) => outcomes.length === 2,
  );
}

function getBestPrices(
  book: Awaited<ReturnType<typeof clobClient.getOrderBook>>,
): OrderbookBest {
  const bestBid = book.bids?.[0];
  const bestAsk = book.asks?.[0];
  return {
    bestBidPrice: toNumber(bestBid?.price),
    bestBidSize: toNumber(bestBid?.size),
    bestAskPrice: toNumber(bestAsk?.price),
    bestAskSize: toNumber(bestAsk?.size),
  };
}

async function fetchOrderbooksWithConcurrency(
  outcomes: Outcome[][],
  concurrency: number,
): Promise<BookWithOutcome[][]> {
  const flatOutcomes = outcomes.flat();
  const results: Array<BookWithOutcome | undefined> = new Array(
    flatOutcomes.length,
  );
  let index = 0;

  const workers = Array.from({
    length: Math.min(concurrency, flatOutcomes.length),
  }).map(async () => {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const currentIndex = index++;
      if (currentIndex >= flatOutcomes.length) break;
      const outcome = flatOutcomes[currentIndex];
      const book = await clobClient.getOrderBook(outcome.tokenId);
      results[currentIndex] = {
        ...outcome,
        book,
        best: getBestPrices(book),
      };
    }
  });

  await Promise.all(workers);

  const byCondition = new Map<string, BookWithOutcome[]>();
  for (const item of results) {
    if (!item) continue;
    const list = byCondition.get(item.conditionId) ?? [];
    list.push(item);
    byCondition.set(item.conditionId, list);
  }

  return outcomes.map(
    (pair) => byCondition.get(pair[0]?.conditionId ?? "") ?? [],
  );
}

async function saveSnapshots(rows: BookWithOutcome[], timestamp: Date) {
  if (!rows.length) return;
  const inserts = rows.map((row) => ({
    conditionId: row.conditionId,
    outcomeIndex: row.outcomeIndex,
    exchange: "polymarket",
    timestamp,
    bestBidPrice: toNumericString(row.best.bestBidPrice),
    bestBidSize: toNumericString(row.best.bestBidSize),
    bestAskPrice: toNumericString(row.best.bestAskPrice),
    bestAskSize: toNumericString(row.best.bestAskSize),
    midPrice:
      row.best.bestBidPrice !== null && row.best.bestAskPrice !== null
        ? toNumericString((row.best.bestBidPrice + row.best.bestAskPrice) / 2)
        : null,
    spread:
      row.best.bestBidPrice !== null && row.best.bestAskPrice !== null
        ? toNumericString(row.best.bestAskPrice - row.best.bestBidPrice)
        : null,
    rawOrderbook: row.book,
  }));

  await db.insert(orderbookSnapshots).values(inserts).onConflictDoNothing();
}

function findArbs(pairs: BookWithOutcome[][]): ArbOpportunity[] {
  const opportunities: ArbOpportunity[] = [];
  for (const pair of pairs) {
    if (pair.length !== 2) continue;
    const [first, second] = pair;
    if (
      first.best.bestAskPrice === null ||
      second.best.bestAskPrice === null ||
      Number.isNaN(first.best.bestAskPrice) ||
      Number.isNaN(second.best.bestAskPrice)
    ) {
      continue;
    }

    const totalAsk = first.best.bestAskPrice + second.best.bestAskPrice;
    const margin = 1 - totalAsk;
    if (margin <= 0) continue;

    opportunities.push({
      conditionId: first.conditionId,
      title: first.title,
      marketSlug: first.marketSlug,
      outcomes: [
        {
          ...first.best,
          tokenId: first.tokenId,
          outcomeName: first.outcomeName,
          outcomeIndex: first.outcomeIndex,
        },
        {
          ...second.best,
          tokenId: second.tokenId,
          outcomeName: second.outcomeName,
          outcomeIndex: second.outcomeIndex,
        },
      ],
      totalAsk,
      margin,
    });
  }
  return opportunities.sort((a, b) => b.margin - a.margin);
}

async function main() {
  const concurrency = process.env.ARB_CONCURRENCY
    ? Number(process.env.ARB_CONCURRENCY)
    : 6;
  const persistSnapshots = process.env.STORE_SNAPSHOTS === "true";

  const outcomes = await fetchActiveBinaryOutcomes();
  if (!outcomes.length) {
    console.log("No active binary markets found.");
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

  const books = await fetchOrderbooksWithConcurrency(outcomes, concurrency);

  if (persistSnapshots) {
    await saveSnapshots(books.flat(), timestamp);
  }

  const opportunities = findArbs(books);

  if (!opportunities.length) {
    console.log("No arbitrage opportunities detected (YES+NO >= $1).");
    return;
  }

  console.log(
    `Found ${opportunities.length} markets with YES+NO ask < $1 (timestamp=${timestamp.toISOString()})`,
  );
  for (const opp of opportunities) {
    const [first, second] = opp.outcomes;
    console.log(
      [
        opp.margin.toFixed(4).padStart(8),
        opp.totalAsk.toFixed(4).padStart(7),
        opp.title,
        `(slug: ${opp.marketSlug ?? "n/a"})`,
        `A${first.outcomeIndex} ask=${first.bestAskPrice?.toFixed(4)} (${first.outcomeName})`,
        `B${second.outcomeIndex} ask=${second.bestAskPrice?.toFixed(4)} (${second.outcomeName})`,
      ].join(" | "),
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
