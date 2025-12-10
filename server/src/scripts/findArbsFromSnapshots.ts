import { fetchLatestSnapshots } from "../services/arbSnapshotService";
import { findIntraArbs } from "../services/arbDetector";
import { getMatcher } from "../services/marketMatcher";
import { saveArbOpportunities } from "../services/arbStorage";

async function main() {
  const conditionIds = process.env.ARB_CONDITION_IDS
    ? process.env.ARB_CONDITION_IDS.split(",").map((s) => s.trim())
    : undefined;
  const exchange = process.env.ARB_EXCHANGE ?? "polymarket";
  const threshold = process.env.ARB_MARGIN_THRESHOLD
    ? Number(process.env.ARB_MARGIN_THRESHOLD)
    : 0;
  const matcherName = process.env.ARB_MATCHER;
  const persistArbs = process.env.STORE_ARBS === "true";
  const matcher = getMatcher(matcherName);

  const snapshots = await fetchLatestSnapshots({ conditionIds, exchange });
  const arbs = findIntraArbs(snapshots, threshold, matcher);

  if (!arbs.length) {
    console.log(
      "No intra-event arbitrage candidates found from latest snapshots.",
    );
    return;
  }

  if (persistArbs) {
    await saveArbOpportunities(
      arbs.map((arb) => ({
        matcherName: arb.matcherName,
        matcherKey: arb.matcherKey,
        kind: "intra-event",
        margin: arb.margin,
        totalAsk: arb.totalAsk,
        thresholdUsed: threshold,
        timestamp: arb.timestamp,
        metadata: { source: "findArbsFromSnapshots" },
        legs: arb.outcomes.map((o) => ({
          conditionId: o.conditionId,
          outcomeIndex: o.outcomeIndex,
          outcomeName: o.outcomeName,
          exchange: o.exchange,
          title: arb.title,
          marketSlug: arb.marketSlug,
          bestAskPrice: o.bestAskPrice,
          bestAskSize: o.bestAskSize,
          bestBidPrice: o.bestBidPrice,
          bestBidSize: o.bestBidSize,
        })),
      })),
    );
  }

  console.log(
    `Found ${arbs.length} intra-event arb candidates (threshold=${threshold})`,
  );
  for (const arb of arbs) {
    const formattedOutcomes = arb.outcomes
      .map(
        (o, idx) =>
          `O${idx} ask=${o.bestAskPrice !== null ? o.bestAskPrice.toFixed(4) : "n/a"} (${o.outcomeName} @${o.exchange})`,
      )
      .join(" | ");
    console.log(
      [
        arb.margin.toFixed(4).padStart(8),
        arb.totalAsk.toFixed(4).padStart(7),
        arb.title,
        `(slug: ${arb.marketSlug ?? "n/a"})`,
        formattedOutcomes,
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
