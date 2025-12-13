import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { eq } from "drizzle-orm";
import { db, marketMetadata } from "../db";
import { listGammaMarkets } from "../clients/polymarketData";
import type { Market } from "polymarket-data";

dotenv.config();

const ASSET = "btc";
const WINDOW_SECONDS = 15 * 60;
const WINDOWS_AHEAD = Number(process.env.MARKET_WINDOWS_AHEAD ?? 4);

function ceilToInterval(epochSeconds: number, intervalSeconds: number): number {
  return Math.ceil(epochSeconds / intervalSeconds) * intervalSeconds;
}

function buildSlugs(now: Date): string[] {
  const epochSeconds = Math.floor(now.getTime() / 1000);
  const currentEnd = ceilToInterval(epochSeconds, WINDOW_SECONDS);
  const slugs: string[] = [];
  for (let i = 0; i < WINDOWS_AHEAD; i += 1) {
    const endTs = currentEnd + i * WINDOW_SECONDS;
    slugs.push(`${ASSET}-updown-15m-${endTs}`);
  }
  return slugs;
}

async function upsertMarket(slug: string, market: Market): Promise<boolean> {
  const conditionId = getConditionId(market);
  const tokenIds = getTokenIds(market);
  if (!conditionId || tokenIds.length < 2) {
    console.warn(`Skipping slug ${slug}: missing condition or tokenIds`);
    return false;
  }
  const assetIdUp = tokenIds[0]!;
  const assetIdDown = tokenIds[1]!;
  const tickSize = market.tickSize ?? market.tick_size ?? null;
  const minOrderSize = market.minOrderSize ?? market.min_order_size ?? null;
  const negRisk = Boolean(market.negRisk ?? market.neg_risk ?? false);

  const existing = await db
    .select({ conditionId: marketMetadata.conditionId })
    .from(marketMetadata)
    .where(eq(marketMetadata.conditionId, conditionId));
  if (existing.length > 0) return true;

  const row: typeof marketMetadata.$inferInsert = {
    conditionId,
    assetIdUp,
    assetIdDown,
    tickSize: tickSize ? tickSize.toString() : null,
    minOrderSize: minOrderSize ? minOrderSize.toString() : null,
    negRisk,
    tags: { slug },
  };

  await db.insert(marketMetadata).values(row).onConflictDoNothing();

  return true;
}

async function fetchBySlugs(slugs: string[]) {
  const found: Array<{ slug: string; market: Market }> = [];
  for (const slug of slugs) {
    const markets = await listGammaMarkets({ slug: [slug] });
    if (markets.length > 0 && markets[0]) {
      found.push({ slug, market: markets[0] });
    }
  }
  return found;
}

async function fetchActiveBtc() {
  const markets = await listGammaMarkets({ limit: 200 });
  return markets
    .filter(
      (m) =>
        (m.slug?.toLowerCase().includes("btc") ||
          m.question?.toLowerCase().includes("bitcoin")) &&
        m.slug?.toLowerCase().includes("up"),
    )
    .map((m) => ({ slug: m.slug ?? "unknown", market: m }));
}

function getConditionId(market: Market): string | undefined {
  if (market.conditionId) return market.conditionId;
  const alt = (market as Record<string, unknown>)["condition_id"];
  return typeof alt === "string" ? alt : undefined;
}

function getTokenIds(market: Market): string[] {
  const tokenIds = typeof market.clobTokenIds === "string"
    ? JSON.parse(market.clobTokenIds)
    : market.clobTokenIds;
  if (Array.isArray(tokenIds)) {
    return tokenIds.filter((t): t is string => typeof t === "string");
  }
  return [];
}

async function main() {
  const runId = randomUUID();
  const slugs = buildSlugs(new Date());
  const successes: string[] = [];
  const failures: string[] = [];

  const bySlug = await fetchBySlugs(slugs);
  for (const entry of bySlug) {
    console.log(`Processing slug ${entry.slug} with conditionId ${entry.market.conditionId}`);
    const ok = await upsertMarket(entry.slug, entry.market);
    if (ok) successes.push(entry.slug);
  }

  if (successes.length === 0) {
    const active = await fetchActiveBtc();
    for (const entry of active) {
      const ok = await upsertMarket(entry.slug, entry.market);
      if (ok) successes.push(entry.slug);
    }
  }

  console.log(
    JSON.stringify({
      runId,
      successes,
      failures,
    }),
  );
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
