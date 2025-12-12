import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { marketOutcomes, markets, orderbookSnapshots } from "../db/schema";

export type LatestSnapshot = {
  conditionId: string;
  title: string;
  marketSlug: string | null;
  eventSlug: string | null;
  exchange: string;
  outcomeIndex: number;
  outcomeName: string;
  tokenId: string;
  bestBidPrice: number | null;
  bestBidSize: number | null;
  bestAskPrice: number | null;
  bestAskSize: number | null;
  timestamp: Date;
};

export type LatestSnapshotFilter = {
  conditionIds?: string[];
  exchange?: string;
};

export async function fetchLatestSnapshots({
  conditionIds,
  exchange = "polymarket",
}: LatestSnapshotFilter = {}): Promise<LatestSnapshot[]> {
  const baseWhere = [
    eq(markets.resolved, false),
    eq(orderbookSnapshots.exchange, exchange),
  ];
  const where =
    conditionIds && conditionIds.length
      ? and(...baseWhere, inArray(markets.conditionId, conditionIds))
      : and(...baseWhere);

  // get the latest timestamp per (conditionId, outcomeIndex)
  const latestPerOutcome = db.$with("latest_per_outcome").as(
    db
      .select({
        conditionId: orderbookSnapshots.conditionId,
        outcomeIndex: orderbookSnapshots.outcomeIndex,
        maxTs: sql`max(${orderbookSnapshots.timestamp})`.as("max_ts"),
      })
      .from(orderbookSnapshots)
      .innerJoin(
        markets,
        eq(orderbookSnapshots.conditionId, markets.conditionId),
      )
      .where(where)
      .groupBy(orderbookSnapshots.conditionId, orderbookSnapshots.outcomeIndex),
  );

  const rows = await db
    .with(latestPerOutcome)
    .select({
      conditionId: markets.conditionId,
      title: markets.title,
      marketSlug: markets.marketSlug,
      eventSlug: markets.eventSlug,
      outcomeIndex: orderbookSnapshots.outcomeIndex,
      outcomeName: marketOutcomes.outcomeName,
      tokenId: marketOutcomes.tokenId,
      exchange: orderbookSnapshots.exchange,
      bestBidPrice: orderbookSnapshots.bestBidPrice,
      bestBidSize: orderbookSnapshots.bestBidSize,
      bestAskPrice: orderbookSnapshots.bestAskPrice,
      bestAskSize: orderbookSnapshots.bestAskSize,
      timestamp: orderbookSnapshots.timestamp,
    })
    .from(orderbookSnapshots)
    .innerJoin(
      latestPerOutcome,
      and(
        eq(orderbookSnapshots.conditionId, latestPerOutcome.conditionId),
        eq(orderbookSnapshots.outcomeIndex, latestPerOutcome.outcomeIndex),
        eq(orderbookSnapshots.timestamp, latestPerOutcome.maxTs),
      ),
    )
    .innerJoin(
      marketOutcomes,
      and(
        eq(orderbookSnapshots.conditionId, marketOutcomes.conditionId),
        eq(orderbookSnapshots.outcomeIndex, marketOutcomes.outcomeIndex),
      ),
    )
    .innerJoin(markets, eq(orderbookSnapshots.conditionId, markets.conditionId))
    .where(where)
    .orderBy(
      desc(orderbookSnapshots.timestamp),
      markets.conditionId,
      orderbookSnapshots.outcomeIndex,
    );

  return rows.map((r) => ({
    ...r,
    exchange: r.exchange,
    bestBidPrice: r.bestBidPrice ? Number(r.bestBidPrice) : null,
    bestBidSize: r.bestBidSize ? Number(r.bestBidSize) : null,
    bestAskPrice: r.bestAskPrice ? Number(r.bestAskPrice) : null,
    bestAskSize: r.bestAskSize ? Number(r.bestAskSize) : null,
  }));
}
