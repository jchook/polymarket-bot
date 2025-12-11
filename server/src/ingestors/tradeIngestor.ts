import { and, asc, eq, inArray } from "drizzle-orm";
import { clobClient } from "../clients/polymarketClob";
import { db } from "../db";
import {
  markets,
  trades,
  tradeWatermarks,
  userTrades,
  tradeRoleEnum,
  tradeSideEnum,
} from "../db/schema";

type MarketTradeEvent = {
  id?: string;
  tradeId?: string;
  condition_id?: string;
  market?: string;
  outcome?: number | string;
  side?: "BUY" | "SELL" | string;
  price?: string | number;
  size?: string | number;
  maker?: string;
  maker_address?: string;
  taker?: string;
  taker_address?: string;
  takerOrderId?: string;
  makerOrders?: Array<{
    maker_address?: string;
    price?: string | number;
    matched_amount?: string | number;
  }>;
  transaction_hash?: string;
  timestamp?: number;
  created_at?: string;
};

type MarketTradesResponse =
  | {
      data?: MarketTradeEvent[];
      next_cursor?: string | null;
      count?: number;
    }
  | MarketTradeEvent[]
  | undefined;

export type TradeIngestConfig = {
  conditionIds: string[];
  wallet?: string;
  exchange?: string;
  startAfter?: Date;
  delayMs?: number;
};

function unwrapTrades(resp: MarketTradesResponse): MarketTradeEvent[] {
  if (!resp) return [];
  if (Array.isArray(resp)) return resp;
  if (Array.isArray(resp.data)) return resp.data;
  return [];
}

const toNumber = (v: string | number | undefined): number | null => {
  if (v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const toDate = (ts?: number | string): Date | null => {
  if (ts === undefined) return null;
  if (typeof ts === "number") {
    // assume seconds if small
    return ts > 2_000_000_000 ? new Date(ts) : new Date(ts * 1000);
  }
  const n = Number(ts);
  if (Number.isFinite(n)) {
    return n > 2_000_000_000 ? new Date(n) : new Date(n * 1000);
  }
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
};

async function loadWatermarks(conditionIds: string[], wallet?: string) {
  if (!conditionIds.length) return {};
  const rows = await db
    .select()
    .from(tradeWatermarks)
    .where(
      and(
        inArray(tradeWatermarks.conditionId, conditionIds),
        wallet
          ? eq(tradeWatermarks.wallet, wallet)
          : eq(tradeWatermarks.scope, "global"),
      ),
    );
  const map: Record<string, { lastTimestamp?: Date; lastTradeId?: string }> =
    {};
  for (const row of rows) {
    map[row.conditionId] = {
      lastTimestamp: row.lastTimestamp ?? undefined,
      lastTradeId: row.lastTradeId ?? undefined,
    };
  }
  return map;
}

async function saveWatermark(
  conditionId: string,
  payload: { lastTimestamp?: Date; lastTradeId?: string },
  wallet?: string,
) {
  await db
    .insert(tradeWatermarks)
    .values({
      conditionId,
      wallet,
      scope: wallet ? "wallet" : "global",
      lastTimestamp: payload.lastTimestamp ?? null,
      lastTradeId: payload.lastTradeId ?? null,
    })
    .onConflictDoUpdate({
      target: [
        tradeWatermarks.scope,
        tradeWatermarks.conditionId,
        tradeWatermarks.wallet,
      ],
      set: {
        lastTimestamp: payload.lastTimestamp ?? null,
        lastTradeId: payload.lastTradeId ?? null,
        updatedAt: new Date(),
      },
    });
}

function normalizeTrade(raw: MarketTradeEvent, conditionId: string) {
  const tradeId = raw.tradeId ?? raw.id ?? raw.takerOrderId ?? null;
  const outcomeIndex = Number(
    typeof raw.outcome === "string" ? Number(raw.outcome) : raw.outcome ?? 0,
  );
  const price = toNumber(raw.price);
  const size = toNumber(raw.size);
  const ts =
    toDate(raw.timestamp) ?? toDate(raw.created_at ?? undefined) ?? new Date();
  const maker = (raw.maker_address ?? raw.maker)?.toLowerCase() ?? null;
  const taker = (raw.taker_address ?? raw.taker)?.toLowerCase() ?? null;
  const sideRaw = (raw.side ?? "").toString().toUpperCase();
  const side =
    sideRaw === "BUY"
      ? tradeSideEnum.enumValues[0]
      : sideRaw === "SELL"
        ? tradeSideEnum.enumValues[1]
        : tradeSideEnum.enumValues[0];
  return {
    tradeId,
    conditionId,
    outcomeIndex,
    side,
    price,
    size,
    timestamp: ts,
    maker,
    taker,
    txHash: raw.transaction_hash ?? null,
    raw,
  };
}

async function upsertTrades(
  rows: ReturnType<typeof normalizeTrade>[],
  wallet?: string,
  exchange = "polymarket",
) {
  if (!rows.length) return { tradesInserted: 0, userTradesInserted: 0 };

  await db.transaction(async (tx) => {
    for (const row of rows) {
      if (!row.tradeId) continue;
      await tx
        .insert(trades)
        .values({
          tradeId: row.tradeId,
          conditionId: row.conditionId,
          outcomeIndex: row.outcomeIndex,
          exchange,
          taker: row.taker,
          maker: row.maker,
          side: row.side as (typeof tradeSideEnum.enumValues)[number],
          price: row.price?.toString() ?? "0",
          size: row.size?.toString() ?? "0",
          timestamp: row.timestamp,
          txHash: row.txHash ?? null,
          raw: row.raw,
        })
        .onConflictDoNothing();

      if (wallet) {
        const walletLc = wallet.toLowerCase();
        const roles: Array<{
          wallet: string;
          role: (typeof tradeRoleEnum.enumValues)[number];
        }> = [];
        if (row.maker?.toLowerCase() === walletLc) {
          roles.push({ wallet: walletLc, role: "maker" });
        }
        if (row.taker?.toLowerCase() === walletLc) {
          roles.push({ wallet: walletLc, role: "taker" });
        }
        for (const r of roles) {
          await tx
            .insert(userTrades)
            .values({
              tradeId: row.tradeId,
              wallet: r.wallet,
              exchange,
              role: r.role,
              side: row.side as (typeof tradeSideEnum.enumValues)[number],
              price: row.price?.toString() ?? "0",
              size: row.size?.toString() ?? "0",
              timestamp: row.timestamp,
            })
            .onConflictDoNothing();
        }
      }
    }
  });

  return {
    tradesInserted: rows.length,
    userTradesInserted: wallet ? rows.length : 0,
  };
}

export async function ingestTrades({
  conditionIds,
  wallet,
  exchange = "polymarket",
  startAfter,
  delayMs = 0,
}: TradeIngestConfig) {
  if (!conditionIds.length) {
    console.log("No conditionIds provided for trade ingestion.");
    return;
  }

  const marketRows = await db
    .select({ conditionId: markets.conditionId })
    .from(markets)
    .where(inArray(markets.conditionId, conditionIds));
  const knownConditions = marketRows.map((m) => m.conditionId);
  if (!knownConditions.length) {
    console.warn("No known markets found for provided conditionIds.");
    return;
  }

  const watermarks = await loadWatermarks(knownConditions, wallet);
  let totalTrades = 0;
  for (const conditionId of knownConditions) {
    console.log(
      `Fetching trades for condition=${conditionId} wallet=${wallet ?? "all"} watermarkTs=${watermarks[conditionId]?.lastTimestamp?.toISOString() ?? "none"}`,
    );
    const watermark = watermarks[conditionId];
    const resp = (await clobClient.getMarketTradesEvents(
      conditionId,
    )) as MarketTradesResponse;
    const events = unwrapTrades(resp);
    console.log(
      `Raw events len=${events.length} condition=${conditionId} respKeys=${Object.keys(resp ?? {}).join(",")} sample=${events[0] ? JSON.stringify(events[0]).slice(0, 200) : "none"}`,
    );
    const normalized = events.map((e) => normalizeTrade(e, conditionId)).filter((t) => t.tradeId);

    normalized.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    const fetchedCount = normalized.length;
    const minTs = fetchedCount
      ? normalized[0].timestamp.toISOString()
      : "n/a";
    const maxTs = fetchedCount
      ? normalized[normalized.length - 1].timestamp.toISOString()
      : "n/a";

    const filtered = normalized.filter((t) => {
      if (startAfter && t.timestamp <= startAfter) return false;
      if (watermark?.lastTimestamp && t.timestamp <= watermark.lastTimestamp) {
        return false;
      }
      return true;
    });

    const { tradesInserted } = await upsertTrades(filtered, wallet, exchange);
    totalTrades += tradesInserted;
    console.log(
      `condition=${conditionId} fetched=${fetchedCount} inserted=${tradesInserted} skipped=${fetchedCount - filtered.length} tsRange=[${minTs},${maxTs}]`,
    );

    if (filtered.length) {
      const last = filtered[filtered.length - 1];
      await saveWatermark(conditionId, {
        lastTimestamp: last.timestamp,
        lastTradeId: last.tradeId ?? undefined,
      }, wallet);
    }
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return { tradesInserted: totalTrades };
}
