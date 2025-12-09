import type { LatestSnapshot } from "./arbSnapshotService";

export type IntraEventArb = {
  conditionId: string;
  title: string;
  marketSlug: string | null;
  margin: number;
  totalAsk: number;
  outcomes: Array<{
    outcomeIndex: number;
    outcomeName: string;
    bestAskPrice: number | null;
    bestAskSize: number | null;
    bestBidPrice: number | null;
    bestBidSize: number | null;
  }>;
  timestamp: Date;
};

export function findIntraArbs(
  snapshots: LatestSnapshot[],
  threshold = 0,
): IntraEventArb[] {
  const grouped = snapshots.reduce<Record<string, LatestSnapshot[]>>(
    (acc, row) => {
      acc[row.conditionId] = acc[row.conditionId] ?? [];
      acc[row.conditionId].push(row);
      return acc;
    },
    {},
  );

  const candidates: IntraEventArb[] = [];
  for (const rows of Object.values(grouped)) {
    if (rows.length !== 2) continue;
    const [a, b] = rows;
    if (a.bestAskPrice === null || b.bestAskPrice === null) continue;
    const totalAsk = a.bestAskPrice + b.bestAskPrice;
    const margin = 1 - totalAsk;
    if (margin <= threshold) continue;
    candidates.push({
      conditionId: a.conditionId,
      title: a.title,
      marketSlug: a.marketSlug,
      margin,
      totalAsk,
      outcomes: [
        {
          outcomeIndex: a.outcomeIndex,
          outcomeName: a.outcomeName,
          bestAskPrice: a.bestAskPrice,
          bestAskSize: a.bestAskSize,
          bestBidPrice: a.bestBidPrice,
          bestBidSize: a.bestBidSize,
        },
        {
          outcomeIndex: b.outcomeIndex,
          outcomeName: b.outcomeName,
          bestAskPrice: b.bestAskPrice,
          bestAskSize: b.bestAskSize,
          bestBidPrice: b.bestBidPrice,
          bestBidSize: b.bestBidSize,
        },
      ],
      timestamp: a.timestamp > b.timestamp ? a.timestamp : b.timestamp,
    });
  }

  return candidates.sort((x, y) => y.margin - x.margin);
}
