import { Worker, type ConnectionOptions, type Job } from "bullmq";
import { db } from "../db";
import { marketOutcomes, markets } from "../db/schema";
import type { MarketIngestionJob } from "./queues";

type GammaMarket = {
  conditionId?: string;
  slug?: string;
  title?: string;
  outcomes?: string[];
  tokens?: string[];
  startDate?: string;
  endDate?: string;
  closeDate?: string;
  resolutionTime?: string;
  resolved?: boolean;
  winningOutcome?: number;
  volume24hr?: string | number;
  volume?: string | number;
  openInterest?: string | number;
  liquidity?: string | number;
  category?: string;
};

type GammaEvent = {
  id?: string;
  slug?: string;
  negRisk?: boolean;
  tags?: unknown;
  markets?: GammaMarket[];
  startDate?: string;
  endDate?: string;
};

const connection: ConnectionOptions = {
  host: "redis",
  port: 6379,
};

const GAMMA_BASE_URL =
  process.env.GAMMA_BASE_URL || "https://gamma-api.polymarket.com";

const parseDate = (value?: string | null) => (value ? new Date(value) : null);

const toNumericString = (value: string | number | undefined | null) =>
  value === undefined || value === null ? null : String(value);

async function upsertMarket(
  event: GammaEvent,
  market: GammaMarket,
): Promise<void> {
  const conditionId =
    market.conditionId ||
    (market as Record<string, string | undefined>).condition_id;
  if (!conditionId) return;

  const marketInsert: typeof markets.$inferInsert = {
    conditionId,
    eventId: event.id ?? null,
    eventSlug: event.slug ?? null,
    marketSlug: market.slug ?? null,
    title: market.title ?? "",
    category: market.category ?? null,
    underlyingSymbol: null,
    windowStart:
      parseDate(market.startDate ?? event.startDate ?? null) ?? new Date(),
    windowEnd:
      parseDate(market.endDate ?? market.closeDate ?? event.endDate ?? null) ??
      new Date(),
    resolutionTime: parseDate(market.resolutionTime ?? null),
    resolved: market.resolved ?? false,
    winningOutcomeIndex: market.winningOutcome ?? null,
    negRisk: event.negRisk ?? false,
    tags: event.tags ?? null,
    volume24h: toNumericString(market.volume24hr),
    volumeAllTime: toNumericString(market.volume),
    openInterest: toNumericString(market.openInterest),
    liquidity: toNumericString(market.liquidity),
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

  const outcomes = market.outcomes ?? [];
  const tokens = market.tokens ?? [];
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
}

async function fetchGammaEventsPage(
  offset: number,
  limit: number,
  tag?: string,
): Promise<GammaEvent[]> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
    withMarkets: "true",
  });
  if (tag) params.set("tag", tag);
  const url = `${GAMMA_BASE_URL}/events?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Gamma API error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { events?: GammaEvent[] };
  return data?.events ?? [];
}

async function handleIngestionJob(job: Job<MarketIngestionJob>): Promise<void> {
  const pageSize = job.data.pageSize ?? 100;
  const maxPages = job.data.maxPages ?? 100;
  let offset = 0;
  let page = 0;

  // basic idempotency: rely on DB unique constraints + upsert
  while (page < maxPages) {
    const events = await fetchGammaEventsPage(offset, pageSize, job.data.tag);
    if (!events.length) break;

    for (const event of events) {
      for (const market of event.markets ?? []) {
        await upsertMarket(event, market);
      }
    }

    offset += events.length;
    page += 1;
    if (events.length < pageSize) break; // last page
  }
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
