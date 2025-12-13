import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { listGammaMarkets } from "../clients/polymarketData";
import { db, marketMetadata } from "../db";
import type { Market } from "polymarket-data";
import { logger } from "../lib/logger";

const ASSET = "btc";
const WINDOW_SECONDS = 15 * 60;

function ceilToInterval(epochSeconds: number, intervalSeconds: number): number {
  return Math.ceil(epochSeconds / intervalSeconds) * intervalSeconds;
}

function buildSlugs(
  now: Date,
  windowsAhead: number,
  windowSeconds: number,
): string[] {
  const epochSeconds = Math.floor(now.getTime() / 1000);
  const currentEnd = ceilToInterval(epochSeconds, windowSeconds);
  const slugs: string[] = [];
  for (let i = 0; i < windowsAhead; i += 1) {
    const endTs = currentEnd + i * windowSeconds;
    slugs.push(`${ASSET}-updown-15m-${endTs}`);
  }
  return slugs;
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

export type MarketDescriptor = {
  conditionId: string;
  assetIds: string[];
  tickSize: number;
  minOrderSize: number;
  negRisk: boolean;
  tags?: Record<string, unknown>;
};

export class MarketCatalog {
  private refreshMs: number;
  private windowsAhead: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private state: Map<string, MarketDescriptor> = new Map();
  private listeners: Array<(markets: MarketDescriptor[]) => void> = [];
  private log = logger("catalog");

  constructor(options?: { refreshMs?: number; windowsAhead?: number }) {
    this.refreshMs = options?.refreshMs ?? 60_000;
    this.windowsAhead = options?.windowsAhead ?? 4;
  }

  getActiveMarkets(): MarketDescriptor[] {
    return Array.from(this.state.values());
  }

  getActiveAssetIds(): string[] {
    const ids = new Set<string>();
    for (const m of this.state.values()) {
      m.assetIds.forEach((a) => ids.add(a));
    }
    return Array.from(ids);
  }

  onUpdate(listener: (markets: MarketDescriptor[]) => void) {
    this.listeners.push(listener);
  }

  private notify() {
    const snapshot = this.getActiveMarkets();
    this.listeners.forEach((l) => l(snapshot));
  }

  async start() {
    await this.refresh();
    this.timer = setInterval(() => {
      void this.refresh().catch((err) =>
        console.error("MarketCatalog refresh failed", err)
      );
    }, this.refreshMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async refresh() {
    const runId = randomUUID();
    const slugs = buildSlugs(new Date(), this.windowsAhead, WINDOW_SECONDS);
    const bySlug = await this.fetchBySlugs(slugs);
    const markets =
      bySlug.length > 0 ? bySlug : await this.fetchActiveBtcFallback();

    const nextState: Map<string, MarketDescriptor> = new Map();
    for (const entry of markets) {
      const descriptor = await this.upsertMarket(entry.slug, entry.market);
      if (descriptor) {
        nextState.set(descriptor.conditionId, descriptor);
      }
    }
    this.state = nextState;
    this.notify();
    this.log(
      "active %o",
      {
        runId,
        activeConditions: this.getActiveMarkets().map((m) => m.conditionId),
      },
    );
  }

  private async fetchBySlugs(slugs: string[]) {
    const found: Array<{ slug: string; market: Market }> = [];
    for (const slug of slugs) {
      const markets = await listGammaMarkets({ slug: [slug] });
      if (markets.length > 0 && markets[0]) {
        found.push({ slug, market: markets[0] });
      }
    }
    return found;
  }

  private async fetchActiveBtcFallback() {
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

  private async upsertMarket(slug: string, market: Market) {
    const conditionId = getConditionId(market);
    const tokenIds = getTokenIds(market);
    if (!conditionId || tokenIds.length < 2) {
      console.warn(`Skipping slug ${slug}: missing condition or tokenIds`);
      return null;
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
    if (existing.length === 0) {
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
    }

    return {
      conditionId,
      assetIds: [assetIdUp, assetIdDown],
      tickSize: Number(tickSize ?? 0.01),
      minOrderSize: Number(minOrderSize ?? 1),
      negRisk,
      tags: { slug },
    };
  }
}
