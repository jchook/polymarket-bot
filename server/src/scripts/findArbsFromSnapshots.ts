import { fetchLatestSnapshots } from "../services/arbSnapshotService";
import { findIntraArbs } from "../services/arbDetector";

async function main() {
  const conditionIds = process.env.ARB_CONDITION_IDS
    ? process.env.ARB_CONDITION_IDS.split(",").map((s) => s.trim())
    : undefined;
  const exchange = process.env.ARB_EXCHANGE ?? "polymarket";
  const threshold = process.env.ARB_MARGIN_THRESHOLD
    ? Number(process.env.ARB_MARGIN_THRESHOLD)
    : 0;

  const snapshots = await fetchLatestSnapshots({ conditionIds, exchange });
  const arbs = findIntraArbs(snapshots, threshold);

  if (!arbs.length) {
    console.log("No intra-event arbitrage candidates found from latest snapshots.");
    return;
  }

  console.log(
    `Found ${arbs.length} intra-event arb candidates (threshold=${threshold})`,
  );
  for (const arb of arbs) {
    const [o1, o2] = arb.outcomes;
    console.log(
      [
        arb.margin.toFixed(4).padStart(8),
        arb.totalAsk.toFixed(4).padStart(7),
        arb.title,
        `(slug: ${arb.marketSlug ?? "n/a"})`,
        `A${o1.outcomeIndex} ask=${o1.bestAskPrice?.toFixed(4)} (${o1.outcomeName})`,
        `B${o2.outcomeIndex} ask=${o2.bestAskPrice?.toFixed(4)} (${o2.outcomeName})`,
        `ts=${arb.timestamp.toISOString()}`,
      ].join(" | "),
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
