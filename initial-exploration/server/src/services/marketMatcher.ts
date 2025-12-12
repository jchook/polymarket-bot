import type { LatestSnapshot } from "./arbSnapshotService";

export type SnapshotGroup = {
  key: string;
  snapshots: LatestSnapshot[];
};

export interface MarketMatcher {
  name: string;
  match: (snapshots: LatestSnapshot[]) => SnapshotGroup[];
}

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const deriveKey = (snapshot: LatestSnapshot) => {
  const candidates = [
    snapshot.eventSlug,
    snapshot.marketSlug,
    snapshot.title,
  ]
    .filter(Boolean)
    .map((v) => normalize(v as string))
    .filter((v) => v.length > 0);

  return (
    candidates[0] ?? `${snapshot.exchange}:${snapshot.conditionId}` ?? "unknown"
  );
};

const heuristicMatcher: MarketMatcher = {
  name: "heuristic-v1",
  match: (snapshots: LatestSnapshot[]) => {
    const grouped = new Map<string, LatestSnapshot[]>();
    for (const snapshot of snapshots) {
      const key = deriveKey(snapshot);
      const list = grouped.get(key) ?? [];
      list.push(snapshot);
      grouped.set(key, list);
    }
    return Array.from(grouped.entries()).map(([key, snaps]) => ({
      key,
      snapshots: snaps,
    }));
  },
};

export function getMatcher(name?: string): MarketMatcher {
  if (!name) return heuristicMatcher;
  const normalized = name.toLowerCase();
  if (normalized === "heuristic" || normalized === "heuristic-v1") {
    return heuristicMatcher;
  }
  // Default fallback until embeddings/vector matcher is added.
  return heuristicMatcher;
}
