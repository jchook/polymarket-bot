import type { LatestSnapshot } from "./arbSnapshotService";
import type { MarketMatcher } from "./marketMatcher";
import { getMatcher } from "./marketMatcher";

export type IntraEventArbOutcome = {
  conditionId: string;
  outcomeIndex: number;
  outcomeName: string;
  exchange: string;
  bestAskPrice: number | null;
  bestAskSize: number | null;
  bestBidPrice: number | null;
  bestBidSize: number | null;
};

export type IntraEventArb = {
  matcherName: string;
  matcherKey: string;
  conditionIds: string[];
  conditionId: string;
  title: string;
  marketSlug: string | null;
  margin: number;
  totalAsk: number;
  outcomes: IntraEventArbOutcome[];
  timestamp: Date;
};

export function findIntraArbs(
  snapshots: LatestSnapshot[],
  threshold = 0,
  matcher?: MarketMatcher,
): IntraEventArb[] {
  const activeMatcher = matcher ?? getMatcher();
  const groups = activeMatcher.match(snapshots);

  const candidates: IntraEventArb[] = [];
  for (const group of groups) {
    if (group.snapshots.length < 2) continue;
    const bestAskPrices = group.snapshots.map((s) => s.bestAskPrice);
    if (bestAskPrices.some((p) => p === null || Number.isNaN(p))) continue;
    const totalAsk = bestAskPrices.reduce(
      (acc, price) => acc + (price ?? 0),
      0,
    );
    const margin = 1 - totalAsk;
    if (margin <= threshold) continue;
    const timestamp = group.snapshots.reduce(
      (latest, row) => (row.timestamp > latest ? row.timestamp : latest),
      group.snapshots[0]?.timestamp ?? new Date(),
    );
    const title =
      group.snapshots.find((s) => s.title)?.title ??
      group.snapshots[0]?.title ??
      "";
    const marketSlug =
      group.snapshots.find((s) => s.marketSlug)?.marketSlug ??
      group.snapshots[0]?.marketSlug ??
      null;
    candidates.push({
      matcherName: activeMatcher.name,
      matcherKey: group.key,
      conditionIds: Array.from(
        new Set(group.snapshots.map((s) => s.conditionId)),
      ),
      conditionId: group.snapshots[0]?.conditionId ?? "",
      title,
      marketSlug,
      margin,
      totalAsk,
      outcomes: group.snapshots.map((s) => ({
        conditionId: s.conditionId,
        outcomeIndex: s.outcomeIndex,
        outcomeName: s.outcomeName,
        exchange: s.exchange,
        bestAskPrice: s.bestAskPrice,
        bestAskSize: s.bestAskSize,
        bestBidPrice: s.bestBidPrice,
        bestBidSize: s.bestBidSize,
      })),
      timestamp,
    });
  }

  return candidates.sort((x, y) => y.margin - x.margin);
}
