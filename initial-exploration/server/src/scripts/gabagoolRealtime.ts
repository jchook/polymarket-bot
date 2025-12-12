import dotenv from "dotenv";
import { RealTimeDataClient } from "@polymarket/real-time-data-client";
import { clobClient } from "../clients/polymarketClob";
import { db } from "../db";
import {
  marketOutcomes,
  markets,
  orderbookSnapshots,
  trades,
  userTrades,
} from "../db/schema";
import { tradeRoleEnum, tradeSideEnum } from "../db/schema";
import { and, eq, inArray } from "drizzle-orm";

dotenv.config();

type TradePayload = {
  asset_id: string;
  fee_rate_bps: string;
  id: string;
  last_update: string;
  maker_address: string;
  maker_orders: Array<{
    asset_id: string;
    price: string;
    matched_amount: string;
    maker_address: string;
  }>;
  market: string;
  match_time: string;
  outcome: string;
  owner: string; // taker address (uuid in docs; address in practice)
  price: string;
  side: "BUY" | "SELL";
  size: string;
  status: string;
  taker_order_id: string;
  transaction_hash?: string;
};

type OrderbookState = {
  bestBidPrice: number | null;
  bestAskPrice: number | null;
  bestBidSize: number | null;
  bestAskSize: number | null;
  raw: unknown;
};

const TARGET_WALLET =
  process.env.GABAGOOL_ADDRESS?.toLowerCase() ??
  "0x6031b6eed1c97e853c6e0f03ad3ce3529351f96d";

const UNDERLYINGS =
  process.env.GABAGOOL_UNDERLYINGS?.split(",").map((s) => s.trim().toUpperCase()) ??
  ["BTC", "ETH"];

const DURATIONS = new Set(["15M", "1H"]);

const toNumber = (value?: string | null) =>
  value === undefined || value === null ? null : Number(value);

async function loadTargetMarkets(): Promise<
  Array<{
    conditionId: string;
    title: string;
  }>
> {
  const rows = await db
    .select({
      conditionId: markets.conditionId,
      title: markets.title,
    })
    .from(markets)
    .where(
      and(
        inArray(markets.underlyingSymbol, UNDERLYINGS),
        eq(markets.resolved, false),
      ),
    );

  // Filter by title heuristic for "Up or Down" and duration
  return rows.filter((row) => {
    const title = row.title.toUpperCase();
    const isUpDown = title.includes("UP") && title.includes("DOWN");
    const durationMatched = Array.from(DURATIONS).some((d) => title.includes(d));
    return isUpDown && durationMatched;
  });
}

async function fetchOrderbook(assetId: string): Promise<OrderbookState> {
  try {
    const book = await clobClient.getOrderBook(assetId);
    const bestBid = book.bids?.[0];
    const bestAsk = book.asks?.[0];
    return {
      bestBidPrice: toNumber(bestBid?.price),
      bestAskPrice: toNumber(bestAsk?.price),
      bestBidSize: toNumber(bestBid?.size),
      bestAskSize: toNumber(bestAsk?.size),
      raw: book,
    };
  } catch (err) {
    console.warn(`Failed to fetch orderbook for asset ${assetId}`, err);
    return {
      bestBidPrice: null,
      bestAskPrice: null,
      bestBidSize: null,
      bestAskSize: null,
      raw: null,
    };
  }
}

async function upsertTrade(
  payload: TradePayload,
  ob: OrderbookState,
  outcomeIndex: number,
) {
  const timestamp = new Date(Number(payload.match_time) * 1000);
  await db.insert(trades).values({
    tradeId: payload.id,
    conditionId: payload.market,
    outcomeIndex,
    exchange: "polymarket",
    taker: payload.owner?.toLowerCase() ?? null,
    maker: payload.maker_address?.toLowerCase() ?? null,
    side: payload.side === "BUY" ? tradeSideEnum.enumValues[0] : tradeSideEnum.enumValues[1],
    price: payload.price,
    size: payload.size,
    timestamp,
    txHash: payload.transaction_hash ?? null,
    raw: payload,
  }).onConflictDoNothing();

  const legs: Array<{
    wallet: string;
    role: "TAKER" | "MAKER";
  }> = [];
  if (payload.owner) {
    legs.push({ wallet: payload.owner.toLowerCase(), role: "TAKER" });
  }
  if (payload.maker_address) {
    legs.push({ wallet: payload.maker_address.toLowerCase(), role: "MAKER" });
  }

  for (const leg of legs) {
    await db.insert(userTrades).values({
      tradeId: payload.id,
      wallet: leg.wallet,
      exchange: "polymarket",
      role: leg.role as (typeof tradeRoleEnum.enumValues)[number],
      side: payload.side === "BUY" ? tradeSideEnum.enumValues[0] : tradeSideEnum.enumValues[1],
      price: payload.price,
      size: payload.size,
      timestamp,
    }).onConflictDoNothing();
  }

  await db.insert(orderbookSnapshots).values({
    conditionId: payload.market,
    outcomeIndex,
    exchange: "polymarket",
    timestamp,
    bestBidPrice: ob.bestBidPrice?.toString() ?? null,
    bestBidSize: ob.bestBidSize?.toString() ?? null,
    bestAskPrice: ob.bestAskPrice?.toString() ?? null,
    bestAskSize: ob.bestAskSize?.toString() ?? null,
    midPrice:
      ob.bestBidPrice !== null && ob.bestAskPrice !== null
        ? ((ob.bestBidPrice + ob.bestAskPrice) / 2).toString()
        : null,
    spread:
      ob.bestBidPrice !== null && ob.bestAskPrice !== null
        ? (ob.bestAskPrice - ob.bestBidPrice).toString()
        : null,
    rawOrderbook: ob.raw,
  }).onConflictDoNothing();
}

async function handleTrade(payload: TradePayload) {
  const maker = payload.maker_address?.toLowerCase();
  const taker = payload.owner?.toLowerCase();
  if (maker !== TARGET_WALLET && taker !== TARGET_WALLET) return;

  // Map asset_id to outcomeIndex / conditionId
  const outcome = await db
    .select({
      outcomeIndex: marketOutcomes.outcomeIndex,
      conditionId: marketOutcomes.conditionId,
      outcomeName: marketOutcomes.outcomeName,
    })
    .from(marketOutcomes)
    .where(eq(marketOutcomes.tokenId, payload.asset_id))
    .limit(1);

  const outcomeIndex = outcome[0]?.outcomeIndex ?? 0;
  const ob = await fetchOrderbook(payload.asset_id);

  await upsertTrade(payload, ob, outcomeIndex);

  console.log(
    [
      new Date(Number(payload.match_time) * 1000).toISOString(),
      payload.market,
      `outcome=${payload.outcome}`,
      `side=${payload.side}`,
      `price=${payload.price}`,
      `size=${payload.size}`,
      `role=${maker === TARGET_WALLET ? "MAKER" : "TAKER"}`,
    ].join(" | "),
  );
}

async function main() {
  console.log(`Starting Gabagool realtime ingestion for ${TARGET_WALLET}`);
  const targets = await loadTargetMarkets();
  if (!targets.length) {
    console.warn("No target markets found in DB for BTC/ETH Up or Down 15m/1h.");
  } else {
    console.log(`Tracking ${targets.length} markets`, targets.map((t) => t.conditionId));
  }

  const client = new RealTimeDataClient({
    onMessage: (msg) => {
      if (msg.topic === "activity" && msg.type === "trades" && msg.payload) {
        void handleTrade(msg.payload as TradePayload);
      }
    },
    onConnect: (c) => {
      // subscribe to trades; filtering by market is not documented so filter client-side
      c.subscribe({
        subscriptions: [
          {
            topic: "activity",
            type: "trades",
          },
        ],
      });
    },
  });

  await client.connect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
