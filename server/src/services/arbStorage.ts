import { db } from "../db";
import { arbOpportunities, arbOpportunityLegs } from "../db/schema";

export type ArbLegInput = {
  conditionId: string;
  outcomeIndex: number;
  outcomeName: string;
  exchange: string;
  title?: string | null;
  marketSlug?: string | null;
  bestAskPrice: number | null;
  bestAskSize: number | null;
  bestBidPrice: number | null;
  bestBidSize: number | null;
};

export type ArbOpportunityInput = {
  matcherName: string;
  matcherKey: string;
  kind: string;
  margin: number;
  totalAsk: number;
  thresholdUsed?: number | null;
  timestamp: Date;
  legs: ArbLegInput[];
  metadata?: Record<string, unknown>;
};

const toNumericString = (value: number | null | undefined) =>
  value === undefined || value === null || Number.isNaN(value)
    ? null
    : value.toString();

export async function saveArbOpportunities(
  arbs: ArbOpportunityInput[],
): Promise<void> {
  if (!arbs.length) return;

  const inserted = await db
    .insert(arbOpportunities)
    .values(
      arbs.map((arb) => ({
        matcherName: arb.matcherName,
        matcherKey: arb.matcherKey,
        kind: arb.kind,
        margin: toNumericString(arb.margin),
        totalAsk: toNumericString(arb.totalAsk),
        legCount: arb.legs.length,
        thresholdUsed: toNumericString(arb.thresholdUsed),
        timestamp: arb.timestamp,
        metadata: arb.metadata ?? null,
      })),
    )
    .returning({ id: arbOpportunities.id });

  const legRows = inserted.flatMap((row, idx) =>
    arbs[idx].legs.map((leg) => ({
      opportunityId: row.id,
      conditionId: leg.conditionId,
      outcomeIndex: leg.outcomeIndex,
      exchange: leg.exchange,
      title: leg.title ?? null,
      marketSlug: leg.marketSlug ?? null,
      outcomeName: leg.outcomeName,
      bestAskPrice: toNumericString(leg.bestAskPrice),
      bestAskSize: toNumericString(leg.bestAskSize),
      bestBidPrice: toNumericString(leg.bestBidPrice),
      bestBidSize: toNumericString(leg.bestBidSize),
    })),
  );

  if (legRows.length) {
    await db.insert(arbOpportunityLegs).values(legRows);
  }
}
