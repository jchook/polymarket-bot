import { type ConnectionOptions, type Job, Worker } from "bullmq";
import {
  type ListMarketsParams,
  type Market,
  listGammaMarkets,
} from "../../clients/polymarketData";
import { db } from "../../db";
import { marketOutcomes, markets } from "../../db/schema";
import type { MarketIngestionJob } from "../queues";
import { parseDate, parseStringArray, toNumericString } from "./utils";

const connection: ConnectionOptions = {
  host: process.env.REDIS_HOST ?? "redis",
  port: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : 6379,
};

async function upsertMarket(
  market: Market,
  exchange: string,
): Promise<{ resolved: boolean }> {
  const conditionId =
    market.conditionId ||
    (market as Record<string, string | undefined>).condition_id;
  if (!conditionId) return { resolved: false };

  const outcomes = parseStringArray(
    (market as Record<string, string | null | undefined>).shortOutcomes ??
      (market as Record<string, string | null | undefined>).outcomes,
  );
  const tokens = parseStringArray(
    (market as Record<string, string | null | undefined>).clobTokenIds,
  );

  const primaryEvent =
    (market as Record<string, { id?: string; slug?: string }[] | undefined>)
      .events?.[0];

  const tagsRaw = (market as Record<string, unknown>).tags;
  const tags =
    Array.isArray(tagsRaw) && tagsRaw.length
      ? tagsRaw
      : undefined;

  const resolved = Boolean(market.closed ?? false);

  const marketInsert: typeof markets.$inferInsert = {
    conditionId,
    exchange,
    eventId:
      primaryEvent?.id ??
      (market as Record<string, string | undefined>).eventId ??
      (market as Record<string, string | undefined>).event_id ??
      null,
    eventSlug:
      primaryEvent?.slug ??
      (market as Record<string, string | undefined>).eventSlug ??
      (market as Record<string, string | undefined>).event_slug ??
      null,
    marketSlug: market.slug ?? null,
    title: market.question ?? market.slug ?? "",
    category: market.category ?? null,
    underlyingSymbol: null,
    windowStart:
      parseDate(
        (market as Record<string, string | null | undefined>).startDateIso ??
          market.startDate ??
          null,
      ) ?? new Date(),
    windowEnd:
      parseDate(
        (market as Record<string, string | null | undefined>).endDateIso ??
          market.endDate ??
          null,
      ) ?? new Date(),
    resolutionTime: parseDate(
      (market as Record<string, string | null | undefined>).umaEndDateIso ??
        null,
    ),
    resolved,
    winningOutcomeIndex: null,
    negRisk: false,
    tags: tags ?? null,
    volume24h: toNumericString(
      (market as Record<string, unknown>).volume24hr ??
        (market as Record<string, unknown>).volume24hrClob,
    ),
    volumeAllTime: toNumericString(
      (market as Record<string, unknown>).volume ??
        (market as Record<string, unknown>).volumeClob ??
        (market as Record<string, unknown>).volumeNum,
    ),
    openInterest: toNumericString(
      (market as Record<string, unknown>).openInterest,
    ),
    liquidity: toNumericString(
      (market as Record<string, unknown>).liquidity ??
        (market as Record<string, unknown>).liquidityClob ??
        (market as Record<string, unknown>).liquidityNum,
    ),
    rawMetadata: market as object,
  };

  await db
    .insert(markets)
    .values(marketInsert)
    .onConflictDoUpdate({
      target: markets.conditionId,
      set: {
        eventId: marketInsert.eventId,
        eventSlug: marketInsert.eventSlug,
        marketSlug: marketInsert.marketSlug,
        title: marketInsert.title,
        category: marketInsert.category,
        resolutionTime: marketInsert.resolutionTime,
        resolved: marketInsert.resolved,
        winningOutcomeIndex: marketInsert.winningOutcomeIndex,
        negRisk: marketInsert.negRisk,
        tags: marketInsert.tags,
        volume24h: marketInsert.volume24h,
        volumeAllTime: marketInsert.volumeAllTime,
        openInterest: marketInsert.openInterest,
        liquidity: marketInsert.liquidity,
        rawMetadata: marketInsert.rawMetadata,
      },
    });

  const rows = outcomes.map((name, idx) => ({
    conditionId,
    outcomeIndex: idx,
    outcomeName: name ?? `Outcome ${idx}`,
    tokenId: tokens[idx] ?? "",
  }));

  if (rows.length) {
    for (const row of rows) {
      await db
        .insert(marketOutcomes)
        .values(row)
        .onConflictDoUpdate({
          target: [marketOutcomes.conditionId, marketOutcomes.outcomeIndex],
          set: {
            outcomeName: row.outcomeName,
            tokenId: row.tokenId,
          },
        });
    }
  }

  return { resolved };
}

async function handleIngestionJob(job: Job<MarketIngestionJob>): Promise<void> {
  const pageSize = job.data.pageSize ?? 100;
  const maxPages = job.data.maxPages ?? 100;
  const baseParams: ListMarketsParams = {
    limit: pageSize,
    offset: 0,
    closed: job.data.closed,
    condition_ids: job.data.conditionIds,
  };

  let totalProcessed = 0;
  let pagesFetched = 0;
  let resolvedCount = 0;

  for (let page = 0; page < maxPages; page++) {
    const params = { ...baseParams, offset: page * pageSize };
    await job.log(
      `Fetching markets page=${page + 1}, offset=${params.offset}, pageSize=${pageSize}, closed=${params.closed ?? "any"}`,
    );
    const marketsList = await listGammaMarkets(params);
    if (!marketsList.length) break;
    pagesFetched += 1;
    for (const market of marketsList) {
      const { resolved } = await upsertMarket(
        market,
        job.data.exchange ?? "polymarket",
      );
      totalProcessed += 1;
      if (resolved) resolvedCount += 1;
    }
    await job.updateProgress({
      page: page + 1,
      processed: totalProcessed,
      pagesFetched,
      resolved: resolvedCount,
    });
    if (marketsList.length < pageSize) break;
  }

  await job.log(
    `Market ingestion complete. pagesFetched=${pagesFetched}, marketsProcessed=${totalProcessed}, resolved=${resolvedCount}, open=${totalProcessed - resolvedCount}`,
  );
  await job.updateProgress({
    completed: true,
    pagesFetched,
    processed: totalProcessed,
    resolved: resolvedCount,
  });
}

export const marketIngestionWorker = new Worker<MarketIngestionJob>(
  "market-ingestion",
  handleIngestionJob,
  {
    connection,
    concurrency: 5,
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { count: 2000 },
  },
);

marketIngestionWorker.on("failed", (job, err) => {
  console.error(`Market ingestion job ${job?.id} failed: ${err.message}`);
});

marketIngestionWorker.on("ready", () => {
  console.log("Market ingestion worker ready");
});
