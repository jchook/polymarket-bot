import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { eq, and, gte, lte, inArray } from "drizzle-orm";
import { db, marketMetadata, pmPriceChanges, spotPrices, simulatedTrades } from "../db";
import { sortEvents } from "../replay/sorter";
import type { ReplayEvent } from "../replay/types";

dotenv.config();

type BookState = {
  bestBid?: number;
  bestAsk?: number;
  mid?: number;
};

type OrderSide = "BUY" | "SELL";

type SimOrder = {
  id: string;
  assetId: string;
  price: number;
  size: number;
  side: OrderSide;
  placedAt: number;
  remaining: number;
  settlementDueAt: number | null;
  failed: boolean;
};

type Position = {
  inventory: number;
  pending: number; // unsettled
  mark: number;
};

type StrategyParams = {
  insideTicks: number;
  orderSize: number;
  inventoryCap: number;
  latencyMinMs: number;
  latencyMaxMs: number;
  failProb: number;
  feeBps: number;
};

const DEFAULT_PARAMS: StrategyParams = {
  insideTicks: 0,
  orderSize: 1,
  inventoryCap: 100,
  latencyMinMs: 200,
  latencyMaxMs: 1200,
  failProb: 0.01,
  feeBps: 0,
};

type MarketConfig = {
  conditionId: string;
  assetIds: string[];
  tickSize: number;
  minOrderSize: number;
};

function num(x: unknown): number | undefined {
  if (x === null || x === undefined) return undefined;
  const n = Number(x);
  return Number.isFinite(n) ? n : undefined;
}

async function loadMarkets(limit: number): Promise<MarketConfig[]> {
  const rows = await db
    .select({
      conditionId: marketMetadata.conditionId,
      assetIdUp: marketMetadata.assetIdUp,
      assetIdDown: marketMetadata.assetIdDown,
      tickSize: marketMetadata.tickSize,
      minOrderSize: marketMetadata.minOrderSize,
    })
    .from(marketMetadata)
    .limit(limit);

  return rows
    .filter((r) => r.conditionId && r.assetIdUp && r.assetIdDown)
    .map((r) => ({
      conditionId: r.conditionId,
      assetIds: [r.assetIdUp as string, r.assetIdDown as string],
      tickSize: Number(r.tickSize ?? 0.01),
      minOrderSize: Number(r.minOrderSize ?? 1),
    }));
}

async function loadEvents(
  markets: MarketConfig,
  startMs: number,
  endMs: number,
): Promise<ReplayEvent[]> {
  const pmRows = await db
    .select({
      conditionId: pmPriceChanges.conditionId,
      assetId: pmPriceChanges.assetId,
      bestBid: pmPriceChanges.bestBid,
      bestAsk: pmPriceChanges.bestAsk,
      midPrice: pmPriceChanges.midPrice,
      timestamp: pmPriceChanges.timestamp,
    })
    .from(pmPriceChanges)
    .where(
      and(
        eq(pmPriceChanges.conditionId, markets.conditionId),
        inArray(pmPriceChanges.assetId, markets.assetIds),
        gte(pmPriceChanges.timestamp, new Date(startMs)),
        lte(pmPriceChanges.timestamp, new Date(endMs)),
      ),
    );

  const spotRows = await db
    .select({
      productId: spotPrices.productId,
      midPrice: spotPrices.midPrice,
      bestBid: spotPrices.bestBid,
      bestAsk: spotPrices.bestAsk,
      timestamp: spotPrices.timestamp,
    })
    .from(spotPrices)
    .where(
      and(
        gte(spotPrices.timestamp, new Date(startMs)),
        lte(spotPrices.timestamp, new Date(endMs)),
      ),
    );

  const events: ReplayEvent[] = [];
  pmRows.forEach((row, idx) => {
    const ts = row.timestamp?.getTime();
    if (!ts) return;
    events.push({
      kind: "pmBook",
      conditionId: row.conditionId ?? undefined,
      assetId: row.assetId ?? undefined,
      exchangeTs: ts,
      ingestTs: ts,
      arrivalOrdinal: idx,
      bestBid: num(row.bestBid),
      bestAsk: num(row.bestAsk),
      mid: num(row.midPrice),
    } as ReplayEvent);
  });

  spotRows.forEach((row, idx) => {
    const ts = row.timestamp?.getTime();
    if (!ts) return;
  events.push({
    kind: "spot",
    productId: row.productId ?? undefined,
    exchangeTs: ts,
    ingestTs: ts,
    arrivalOrdinal: idx,
    mid: num(row.midPrice),
    bestBid: num(row.bestBid),
    bestAsk: num(row.bestAsk),
  } as ReplayEvent);
});

  return sortEvents(events);
}

function randomLatency(params: StrategyParams) {
  const span = params.latencyMaxMs - params.latencyMinMs;
  return params.latencyMinMs + Math.random() * span;
}

function maybeFail(params: StrategyParams) {
  return Math.random() < params.failProb;
}

async function backtestMarket(
  market: MarketConfig,
  events: ReplayEvent[],
  params: StrategyParams,
  runId: string,
) {
  const positions: Record<string, Position> = {};
  market.assetIds.forEach((a) => {
    positions[a] = { inventory: 0, pending: 0, mark: 0.5 };
  });
  const defaultPosition = (): Position => ({ inventory: 0, pending: 0, mark: 0.5 });
  const orders: SimOrder[] = [];
  const pendingSettlements: SimOrder[] = [];
  const tradesToPersist: Array<{
    conditionId: string;
    assetId: string;
    side: OrderSide;
    price: number;
    size: number;
    timestamp: number;
    latencyMs: number;
    failed: boolean;
  }> = [];

  const feeMultiplier = 1 - params.feeBps / 10000;

  function placeOrder(side: OrderSide, assetId: string, price: number, size: number, now: number) {
    const inv = positions[assetId] ?? { inventory: 0, pending: 0, mark: 0.5 };
    const projected =
      side === "BUY" ? inv.inventory + inv.pending + size : inv.inventory + inv.pending - size;
    if (Math.abs(projected) > params.inventoryCap) {
      return;
    }
    const order: SimOrder = {
      id: randomUUID(),
      assetId,
      price,
      size,
      side,
      placedAt: now,
      remaining: size,
      settlementDueAt: null,
      failed: false,
    };
    orders.push(order);
  }

  function settleOrders(now: number) {
    for (const pending of [...pendingSettlements]) {
      if (pending.settlementDueAt && pending.settlementDueAt <= now) {
        const inv = positions[pending.assetId] ?? defaultPosition();
        positions[pending.assetId] = inv;
        if (!pending.failed) {
          if (pending.side === "BUY") {
            inv.inventory += pending.size;
          } else {
            inv.inventory -= pending.size;
          }
        }
        inv.pending -= pending.size;
        const idx = pendingSettlements.findIndex((o) => o.id === pending.id);
        if (idx >= 0) pendingSettlements.splice(idx, 1);
      }
    }
  }

  function simulateFills(book: BookState, now: number) {
    for (const order of [...orders]) {
      if (order.remaining <= 0) continue;
      if (order.side === "BUY") {
        if (book.bestAsk !== undefined && book.bestAsk <= order.price) {
          const fillSize = order.remaining;
          const latency = randomLatency(params);
          const failed = maybeFail(params);
          order.remaining = 0;
          order.settlementDueAt = now + latency;
          order.failed = failed;
          const inv = positions[order.assetId] ?? defaultPosition();
          positions[order.assetId] = inv;
          inv.pending += fillSize;
          pendingSettlements.push(order);
          tradesToPersist.push({
            conditionId: market.conditionId,
            assetId: order.assetId,
            side: "BUY",
            price: order.price * feeMultiplier,
            size: fillSize,
            timestamp: now,
            latencyMs: latency,
            failed,
          });
        }
      } else {
        if (book.bestBid !== undefined && book.bestBid >= order.price) {
          const fillSize = order.remaining;
          const latency = randomLatency(params);
          const failed = maybeFail(params);
          order.remaining = 0;
          order.settlementDueAt = now + latency;
          order.failed = failed;
          const inv = positions[order.assetId] ?? defaultPosition();
          positions[order.assetId] = inv;
          inv.pending += fillSize;
          pendingSettlements.push(order);
          tradesToPersist.push({
            conditionId: market.conditionId,
            assetId: order.assetId,
            side: "SELL",
            price: order.price * feeMultiplier,
            size: fillSize,
            timestamp: now,
            latencyMs: latency,
            failed,
          });
        }
      }
    }
    // remove filled orders
    for (let i = orders.length - 1; i >= 0; i -= 1) {
      const ord = orders[i];
      if (!ord) continue;
      if (ord.remaining <= 0) orders.splice(i, 1);
    }
  }

  const books: Record<string, BookState> = {};
  let lastPmTs = 0;
  let lastSpotTs: number | null = null;

  for (const ev of events) {
    settleOrders(ev.exchangeTs);

    if (ev.kind === "pmBook") {
      const key = ev.assetId ?? "";
      const book = books[key] ?? {};
      if (ev.bestBid !== undefined) book.bestBid = ev.bestBid;
      if (ev.bestAsk !== undefined) book.bestAsk = ev.bestAsk;
      const mid = ev.mid;
      if (mid !== undefined && mid !== null) {
        book.mid = mid;
        const inv = positions[key] ?? defaultPosition();
        inv.mark = mid;
        positions[key] = inv;
      }
      books[key] = book;
      lastPmTs = ev.exchangeTs;

      // quoting logic
      const tick = market.tickSize || 0.01;
      const insideTicks = params.insideTicks;

      if (book.bestBid !== undefined) {
        const price = Math.max(
          market.minOrderSize * tick,
          book.bestBid + insideTicks * tick,
        );
        placeOrder("BUY", ev.assetId ?? "", price, params.orderSize, ev.exchangeTs);
      }
      if (book.bestAsk !== undefined) {
        const price = Math.max(
          market.minOrderSize * tick,
          book.bestAsk - insideTicks * tick,
        );
        placeOrder("SELL", ev.assetId ?? "", price, params.orderSize, ev.exchangeTs);
      }

      simulateFills(book, ev.exchangeTs);
    }

    if (ev.kind === "spot") {
      lastSpotTs = ev.exchangeTs;
    }
  }

  // settle remaining
  settleOrders(lastPmTs + params.latencyMaxMs + 10);

  // persist trades
  if (tradesToPersist.length > 0) {
    const rows = tradesToPersist.map((t) => ({
      runId,
      conditionId: t.conditionId,
      assetId: t.assetId,
      side: t.side,
      price: t.price.toString(),
      size: t.size.toString(),
      fees: null,
      slippage: null,
      timestamp: new Date(t.timestamp),
      metadata: {
        latencyMs: t.latencyMs,
        failed: t.failed,
      },
    }));
    await db.insert(simulatedTrades).values(rows);
  }

  // PnL: mark-to-market using latest marks
  let cash = 0;
  let mtm = 0;
  for (const row of tradesToPersist) {
    const signed = row.side === "BUY" ? -row.price * row.size : row.price * row.size;
    if (!row.failed) cash += signed;
  }
  for (const [assetId, pos] of Object.entries(positions)) {
    mtm += pos.inventory * pos.mark;
  }

  const pnl = cash + mtm;

  console.log(
    JSON.stringify({
      runId,
      conditionId: market.conditionId,
      assets: market.assetIds,
      trades: tradesToPersist.length,
      cash,
      mtm,
      pnl,
      inventory: Object.fromEntries(
        Object.entries(positions).map(([k, v]) => [k, v.inventory]),
      ),
    }),
  );
}

async function main() {
  const runId = process.env.RUN_ID || randomUUID();
  const hours = Number(process.env.HOURS ?? 1);
  const now = Date.now();
  const endMs = now;
  const startMs = endMs - hours * 60 * 60 * 1000;

  const params: StrategyParams = {
    insideTicks: Number(process.env.MM_INSIDE_TICKS ?? DEFAULT_PARAMS.insideTicks),
    orderSize: Number(process.env.MM_ORDER_SIZE ?? DEFAULT_PARAMS.orderSize),
    inventoryCap: Number(process.env.MM_INVENTORY_CAP ?? DEFAULT_PARAMS.inventoryCap),
    latencyMinMs: Number(process.env.MM_LATENCY_MIN_MS ?? DEFAULT_PARAMS.latencyMinMs),
    latencyMaxMs: Number(process.env.MM_LATENCY_MAX_MS ?? DEFAULT_PARAMS.latencyMaxMs),
    failProb: Number(process.env.MM_FAIL_PROB ?? DEFAULT_PARAMS.failProb),
    feeBps: Number(process.env.MM_FEE_BPS ?? DEFAULT_PARAMS.feeBps),
  };

  const targetCondition = process.env.CONDITION_ID;
  let markets: MarketConfig[] = [];
  if (targetCondition) {
    const m = await db
      .select({
        conditionId: marketMetadata.conditionId,
        assetIdUp: marketMetadata.assetIdUp,
        assetIdDown: marketMetadata.assetIdDown,
        tickSize: marketMetadata.tickSize,
        minOrderSize: marketMetadata.minOrderSize,
      })
      .from(marketMetadata)
      .where(eq(marketMetadata.conditionId, targetCondition))
      .limit(1);
    if (m.length === 0) {
      throw new Error(`Condition ${targetCondition} not found in marketMetadata`);
    }
    const m0 = m[0]!;
    markets = [
      {
        conditionId: m0.conditionId as string,
        assetIds: [m0.assetIdUp as string, m0.assetIdDown as string],
        tickSize: Number(m0.tickSize ?? 0.01),
        minOrderSize: Number(m0.minOrderSize ?? 1),
      },
    ];
  } else {
    markets = await loadMarkets(4);
  }

  if (markets.length === 0) {
    throw new Error("No markets found to backtest");
  }

  for (const market of markets) {
    const events = await loadEvents(market, startMs, endMs);
    if (events.length === 0) {
      console.warn(`No events for market ${market.conditionId}`);
      continue;
    }
    await backtestMarket(market, events, params, runId);
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
