import { type ConnectionOptions, type Job, Worker } from "bullmq";
import {
  type ListMarketsParams,
  type Market,
  listGammaMarkets,
  getGammaEventBySlug,
} from "../../clients/polymarketData";
import { clobClient } from "../../clients/polymarketClob";
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

  const primaryEvent = (
    market as Record<string, { id?: string; slug?: string }[] | undefined>
  ).events?.[0];

  const tagsRaw = (market as Record<string, unknown>).tags;
  const tags = Array.isArray(tagsRaw) && tagsRaw.length ? tagsRaw : undefined;

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
  if (job.data.slugs && job.data.slugs.length) {
    await job.log(
      `Slugs provided; fetching via Gamma events: count=${job.data.slugs.length}`,
    );
    let processed = 0;
    let resolvedCount = 0;

    for (const slug of job.data.slugs) {
      try {
        const event = await getGammaEventBySlug(slug);
        const marketsArr = (event as Record<string, unknown>).markets;
        if (!Array.isArray(marketsArr) || !marketsArr.length) {
          await job.log(`No markets found for slug=${slug}`);
          continue;
        }
        await job.log(
          `Fetched ${marketsArr.length} markets for slug=${slug}`,
        );
        for (const market of marketsArr) {
          const { resolved } = await upsertMarket(
            market as Market,
            job.data.exchange ?? "polymarket",
          );
          processed += 1;
          if (resolved) resolvedCount += 1;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await job.log(`Failed to fetch/upsert markets for slug=${slug}: ${msg}`);
      }
    }

    await job.updateProgress({
      completed: true,
      processed,
      resolved: resolvedCount,
      via: "gamma-slug",
    });
    await job.log(
      `Slug-based ingestion complete. processed=${processed}, resolved=${resolvedCount}`,
    );
    return;
  }

  if (job.data.conditionIds && job.data.conditionIds.length) {
    await job.log(
      `ConditionIds provided; fetching individually via CLOB: count=${job.data.conditionIds.length}`,
    );
    let processed = 0;
    let resolvedCount = 0;
    for (const conditionId of job.data.conditionIds) {
      try {
        const market = await clobClient.getMarket(conditionId);
        const mappedSlug = job.data.slugByCondition?.[conditionId];
        if (mappedSlug) {
          const m = market as Record<string, unknown>;
          // Backfill slugs when CLOB response lacks them
          if (!m.slug) m.slug = mappedSlug;
          if (!m.eventSlug) m.eventSlug = mappedSlug;
          if (!m.event_slug) m.event_slug = mappedSlug;
          if (!m.marketSlug) m.marketSlug = mappedSlug;
        }
        const { resolved } = await upsertMarket(
          market as Market,
          job.data.exchange ?? "polymarket",
        );
        processed += 1;
        if (resolved) resolvedCount += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await job.log(
          `Failed to fetch/upsert market conditionId=${conditionId}: ${msg}`,
        );
      }
    }
    await job.updateProgress({
      completed: true,
      processed,
      resolved: resolvedCount,
      via: "clob",
    });
    await job.log(
      `ConditionId ingestion complete via CLOB. processed=${processed}, resolved=${resolvedCount}`,
    );
    return;
  }

  const pageSize = job.data.pageSize ?? 100;
  const maxPages = job.data.maxPages ?? 100;
  const baseParams: ListMarketsParams = {
    limit: pageSize,
    offset: 0,
    closed: job.data.closed,
    condition_ids: job.data.conditionIds,
  };

  await job.log(
    `Starting market ingestion with params=${JSON.stringify({
      condition_ids: baseParams.condition_ids,
      tag: job.data.tag,
      closed: baseParams.closed,
      pageSize,
      maxPages,
    })}`,
  );

  let totalProcessed = 0;
  let pagesFetched = 0;
  let resolvedCount = 0;

  for (let page = 0; page < maxPages; page++) {
    const params = { ...baseParams, offset: page * pageSize };
    await job.log(
      `Fetching markets page=${page + 1}, offset=${params.offset}, pageSize=${pageSize}, closed=${params.closed ?? "any"}`,
    );
    const marketsList = await listGammaMarkets(params);
    await job.log(
      `Fetched ${marketsList.length} markets on page ${page + 1} (condition_ids=${params.condition_ids?.join(",") ?? "all"})`,
    );
    if (!marketsList.length) {
      await job.log("No markets returned; stopping pagination");
      break;
    }
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
