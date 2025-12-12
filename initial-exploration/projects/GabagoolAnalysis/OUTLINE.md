Below is a self-contained design doc you can drop into a repo (e.g. `docs/gabagool-research.md`). It focuses on **clarity + completeness**, not bloat.

---

# Gabagool Arb Research Stack

*Design & Implementation Guide (TypeScript + Postgres + Polymarket Realtime)*

## 1. Objectives

1. **Record Gabagool’s trading footprint** on Polymarket BTC/ETH “Up or Down” markets:

   * All trades (fills), especially on:

     * 1-hour markets (e.g. `BTC Up or Down - Dec 10, 1PM ET`)
     * 15-minute slice markets (e.g. `BTC Up or Down - Dec 10, 1:45PM–2:00PM ET`)
2. **Enrich each trade** with:

   * Real-time orderbook state at trade time.
   * BTC / ETH spot price and recent movement.
   * Market metadata (start/end time, duration type).
3. **Store everything in Postgres**, with:

   * Idempotent backfills.
   * Clean schema for later analysis and CSV export.
4. **Prepare for the future**:

   * Strategy modules for backtesting.
   * Realtime execution as a full arb bot.

We’ll use:

* `@polymarket/clob-client` – limit/order, trades, and historical data (CLOB).
* `@polymarket/real-time-data-client` – realtime orderbook / market updates.
* A separate crypto price feed (e.g. Binance/Bitstamp websockets or a price aggregator) for BTC/ETH spot.

---

## 2. High-Level Architecture

### 2.1 Components

1. **Ingestion Service**

   * Subscribes to Polymarket realtime feeds.
   * Listens for:

     * fills (user trades),
     * orderbook updates,
     * market metadata updates.
   * Listens to BTC/ETH spot via external price feed.
   * Writes to Postgres.

2. **Backfill Service**

   * Uses `@polymarket/clob-client` and historical APIs (and/or dumps) to:

     * Fetch past trades by user,
     * Fetch historical orderbook snapshots if available,
     * Fetch market metadata.
   * Upserts into the same Postgres tables.

3. **Analysis Layer**

   * SQL + a small TypeScript/Node CLI to export CSV.
   * Later: strategy modules and backtesting engine.

---

## 3. Data Model (Postgres)

Below are core tables; adjust naming to taste.

### 3.1 `markets`

Represents a single Polymarket contract (e.g. BTC 1h Up/Down).

```sql
CREATE TABLE markets (
  id TEXT PRIMARY KEY,          -- Polymarket market id / ticker / clob_id
  slug TEXT NOT NULL,           -- human-friendly name
  underlying TEXT NOT NULL,     -- 'BTC' | 'ETH'
  direction_type TEXT NOT NULL, -- 'UP_DOWN'
  duration_type TEXT NOT NULL,  -- '15m' | '1h'
  side_count INT NOT NULL,      -- usually 2
  start_ts TIMESTAMPTZ NOT NULL,
  end_ts   TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 3.2 `trades`

Represents **Gabagool’s (or any user’s)** individual fills.

```sql
CREATE TABLE trades (
  id TEXT PRIMARY KEY,        -- trade id from CLOB
  market_id TEXT NOT NULL REFERENCES markets(id),
  user_address TEXT NOT NULL, -- user / trader address
  side TEXT NOT NULL,         -- 'UP' | 'DOWN'
  direction TEXT NOT NULL,    -- 'BUY' | 'SELL'
  price NUMERIC(10,4) NOT NULL,
  size NUMERIC(20,8) NOT NULL,  -- shares
  notional NUMERIC(20,8) NOT NULL, -- price * size
  ts_exchange TIMESTAMPTZ NOT NULL, -- from Polymarket
  ts_ingested TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 3.3 `orderbook_snapshots`

We snapshot the orderbook **around each trade** (or at frequent intervals).

```sql
CREATE TABLE orderbook_snapshots (
  id BIGSERIAL PRIMARY KEY,
  market_id TEXT NOT NULL REFERENCES markets(id),
  ts TIMESTAMPTZ NOT NULL,  -- when we observed the book
  bid_price NUMERIC(10,4),
  ask_price NUMERIC(10,4),
  bid_size NUMERIC(20,8),
  ask_size NUMERIC(20,8),
  bid_ask_spread NUMERIC(10,4),
  imbalance_ratio NUMERIC(10,4), -- (bid_size - ask_size) / (bid_size + ask_size)
  raw_book JSONB NOT NULL        -- full depth if needed
);
```

### 3.4 `spot_prices`

Spot BTC/ETH prices from an exchange.

```sql
CREATE TABLE spot_prices (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,           -- 'BTCUSDT', 'ETHUSDT', etc.
  ts TIMESTAMPTZ NOT NULL,
  price NUMERIC(20,8) NOT NULL
);

CREATE INDEX ON spot_prices (symbol, ts);
```

### 3.5 `trade_enrichment`

Derived “factor” table linking trades to spot/orderbook context.

```sql
CREATE TABLE trade_enrichment (
  trade_id TEXT PRIMARY KEY REFERENCES trades(id),
  spot_price NUMERIC(20,8),
  spot_price_60s_ago NUMERIC(20,8),
  spot_price_300s_ago NUMERIC(20,8),
  distance_from_interval_open NUMERIC(20,8),
  candle_open_price NUMERIC(20,8),
  candle_break_pct NUMERIC(10,4),
  ob_snapshot_id BIGINT REFERENCES orderbook_snapshots(id),
  minutes_until_resolution NUMERIC(10,4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

This table is populated by offline jobs that:

* Look up the nearest `spot_prices` before trade time.
* Determine candle open from `spot_prices` at market start.
* Link to the nearest `orderbook_snapshots`.

---

## 4. Ingestion with `@polymarket/real-time-data-client`

### 4.1 Setup

Install dependencies:

```bash
npm install @polymarket/real-time-data-client @polymarket/clob-client pg
```

You’ll also need a Postgres driver (`pg`), plus your preferred migration / ORM (Drizzle, Prisma, etc.), but the doc keeps it generic.

### 4.2 Connecting to Realtime

Pseudo-code sketch (TypeScript):

```ts
import { RealTimeDataClient } from "@polymarket/real-time-data-client";
import { Message } from "@polymarket/real-time-data-client/dist/model";

async function main() {
  const client = new RealTimeDataClient({
    onMessage: (message: Message): void => {
      if (message.topic === "activity" && message.type === "trades") {
        handleTradeUpdate(message.payload);
      }
      if (message.topic === "orderbook" && message.type === "agg_orderbook") {
        handleOrderBookUpdate(message.payload);
      }
    },
    onConnect: (c) => {
      c.subscribe({
        subscriptions: [
          { topic: "activity", type: "trades" },
          { topic: "orderbook", type: "agg_orderbook" }, // AggOrderbook stream per README
        ],
      });
    },
  });

  await client.connect();
}

main().catch(console.error);
```

The exact subscription APIs may differ slightly depending on the library version, but the structure is:

* Connect.
* Subscribe to trades and orderbook for given markets.
* Handle the callbacks and persist.

### 4.3 Handling Orderbook Updates

We want “latest book” snapshots keyed by `marketId` so we can attach them to trades.

```ts
type OrderBookState = {
  bestBid?: number;
  bestAsk?: number;
  bidSize?: number;
  askSize?: number;
  lastUpdated: Date;
  raw: any;
};

const bookCache = new Map<string, OrderBookState>();

async function handleOrderBookUpdate(marketId: string, update: any) {
  // Adapt this to the actual shape of `update`
  const bestBid = update.bestBid;
  const bestAsk = update.bestAsk;
  const bidSize = update.bestBidSize;
  const askSize = update.bestAskSize;

  const spread =
    bestBid != null && bestAsk != null ? bestAsk - bestBid : null;

  const imbalance =
    bidSize != null &&
    askSize != null &&
    bidSize + askSize > 0
      ? (bidSize - askSize) / (bidSize + askSize)
      : null;

  const state: OrderBookState = {
    bestBid,
    bestAsk,
    bidSize,
    askSize,
    lastUpdated: new Date(),
    raw: update,
  };

  bookCache.set(marketId, state);

  // Optional: persist periodic snapshots (e.g. every N seconds or on trades)
}
```

You can choose:

* **“on every update”** snapshot – more data, more precision.
* **“only when a trade occurs”** snapshot – less data, but aligns with our analysis objective and keeps DB small.

For now, we’ll snapshot **when trades occur** (using the cached best bid/ask).

---

### 4.4 Handling Trade Updates (Realtime)

We’ll filter for **Gabagool’s address** and store those trades.

```ts
const GABAGOOL_ADDRESS = process.env.GABAGOOL_ADDRESS?.toLowerCase();

async function handleTradeUpdate(marketId: string, trade: any) {
  // Adapt to actual trade object shape
  const user = (trade.maker || trade.taker)?.toLowerCase(); // depending on API
  if (!user || user !== GABAGOOL_ADDRESS) return;

  const side = trade.side;      // 'buy'/'sell' or 0/1 etc
  const price = Number(trade.price);
  const size = Number(trade.size);
  const tradeId = trade.id;
  const tsExchange = new Date(trade.timestamp * 1000); // if seconds

  // Start a DB transaction to insert trade and snapshot atomically
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Ensure market row exists
    await upsertMarket(client, marketId, trade.marketMetadata);

    // 2. Insert trade (idempotent)
    await client.query(
      `
      INSERT INTO trades (
        id, market_id, user_address,
        side, direction, price, size, notional, ts_exchange
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (id) DO NOTHING
      `,
      [
        tradeId,
        marketId,
        user,
        normalizeSide(trade),      // 'UP'/'DOWN'
        normalizeDirection(trade), // 'BUY'/'SELL'
        price,
        size,
        price * size,
        tsExchange,
      ]
    );

    // 3. Attach an orderbook snapshot using cached state
    const state = bookCache.get(marketId);
    let snapshotId: number | null = null;

    if (state) {
      const res = await client.query(
        `
        INSERT INTO orderbook_snapshots (
          market_id, ts,
          bid_price, ask_price,
          bid_size, ask_size,
          bid_ask_spread, imbalance_ratio,
          raw_book
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING id
        `,
        [
          marketId,
          new Date(), // observation time
          state.bestBid,
          state.bestAsk,
          state.bidSize,
          state.askSize,
          state.bestBid != null && state.bestAsk != null
            ? state.bestAsk - state.bestBid
            : null,
          state.bidSize != null &&
          state.askSize != null &&
          state.bidSize + state.askSize > 0
            ? (state.bidSize - state.askSize) /
              (state.bidSize + state.askSize)
            : null,
          state.raw,
        ]
      );
      snapshotId = res.rows[0].id;
    }

    // 4. Seed an empty enrichment row; we'll fill later in a batch job
    await client.query(
      `
      INSERT INTO trade_enrichment (trade_id, ob_snapshot_id)
      VALUES ($1, $2)
      ON CONFLICT (trade_id) DO NOTHING
      `,
      [tradeId, snapshotId]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error handling trade update', err);
  } finally {
    client.release();
  }
}
```

This gives you:

* All of Gabagool’s trades as they occur.
* Orderbook state attached at trade time.
* Ready for later enrichment.

---

## 5. BTC/ETH Spot Feed

You can use any websocket feed (Binance, Coinbase, Bitstamp). Pseudocode:

```ts
import WebSocket from 'ws';

function startSpotFeed(symbol: string) {
  const ws = new WebSocket('wss://example-exchange/ws');

  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'subscribe', symbol }));
  });

  ws.on('message', async (data) => {
    const msg = JSON.parse(data.toString());
    const price = Number(msg.price);
    const ts = new Date(msg.ts || Date.now());

    await pool.query(
      `
      INSERT INTO spot_prices (symbol, ts, price)
      VALUES ($1,$2,$3)
      `,
      [symbol, ts, price]
    );
  });
}
```

Run:

```ts
startSpotFeed('BTCUSDT');
startSpotFeed('ETHUSDT');
```

Later enrichment will use `spot_prices` to compute:

* `spot_price` at trade time.
* `spot_price_60s_ago`, `spot_price_300s_ago`.
* Candle opens and break percentage.

---

## 6. Backfilling Historical Trades with `@polymarket/clob-client`

For historical analysis (e.g., last 30–90 days of Gabagool trades), use `@polymarket/clob-client` or Polymarket’s REST/gamma APIs.

### 6.1 Initial Setup

```ts
import { ClobClient } from '@polymarket/clob-client';

const clobClient = new ClobClient({
  apiKey: process.env.POLYMARKET_API_KEY,
  // endpoint, env, etc.
});
```

### 6.2 Fetch Historical Trades by User

Exactly API signatures may differ, but typical pattern:

```ts
async function backfillTradesForUser(address: string, since?: Date) {
  let cursor: string | undefined;

  while (true) {
    const resp = await clobClient.getTradesByUser({
      address,
      cursor,
      limit: 100,
      // maybe a time filter if available
    });

    if (!resp.trades.length) break;

    for (const t of resp.trades) {
      await upsertHistoricalTrade(t);
    }

    if (!resp.nextCursor) break;
    cursor = resp.nextCursor;
  }
}

async function upsertHistoricalTrade(t: any) {
  const marketId = t.marketId;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await upsertMarket(client, marketId, t.marketMetadata);

    await client.query(
      `
      INSERT INTO trades (
        id, market_id, user_address,
        side, direction, price, size, notional, ts_exchange
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (id) DO NOTHING
      `,
      [
        t.id,
        marketId,
        t.user.toLowerCase(),
        normalizeSide(t),
        normalizeDirection(t),
        Number(t.price),
        Number(t.size),
        Number(t.price) * Number(t.size),
        new Date(t.timestamp * 1000),
      ]
    );

    // We probably *can't* get exact historical orderbook snapshots easily,
    // so you can leave orderbook_snapshots NULL for backfilled trades
    await client.query(
      `
      INSERT INTO trade_enrichment (trade_id)
      VALUES ($1)
      ON CONFLICT (trade_id) DO NOTHING
      `,
      [t.id]
    );

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('backfill error', e);
  } finally {
    client.release();
  }
}
```

This uses `ON CONFLICT DO NOTHING` to ensure **idempotent backfills**.

---

## 7. Enrichment Job (Spot & Candle Factors)

Once trades & spot prices are loaded, we run a batch job to fill `trade_enrichment` fields.

### 7.1 Enriching Spot Context

Conceptually:

```ts
async function enrichTradesBatch(limit = 1000) {
  const client = await pool.connect();
  try {
    const { rows: unenriched } = await client.query(
      `
      SELECT t.id, t.ts_exchange, m.underlying, m.start_ts, m.end_ts
      FROM trades t
      JOIN markets m ON m.id = t.market_id
      JOIN trade_enrichment e ON e.trade_id = t.id
      WHERE e.spot_price IS NULL
      LIMIT $1
      `,
      [limit]
    );

    for (const row of unenriched) {
      const { id: tradeId, ts_exchange, underlying, start_ts } = row;

      const symbol = underlying === 'BTC' ? 'BTCUSDT' : 'ETHUSDT';

      const spotNow = await findNearestSpotPrice(symbol, ts_exchange);
      const spot60sAgo = await findNearestSpotPrice(
        symbol,
        new Date(new Date(ts_exchange).getTime() - 60_000)
      );
      const spot300sAgo = await findNearestSpotPrice(
        symbol,
        new Date(new Date(ts_exchange).getTime() - 300_000)
      );

      const candleOpen = await findNearestSpotPrice(symbol, start_ts);

      const distanceFromOpen =
        spotNow && candleOpen ? spotNow.price - candleOpen.price : null;

      const candleBreakPct =
        distanceFromOpen && candleOpen && candleOpen.price !== 0
          ? (distanceFromOpen / candleOpen.price) * 100
          : null;

      await client.query(
        `
        UPDATE trade_enrichment
        SET
          spot_price = $1,
          spot_price_60s_ago = $2,
          spot_price_300s_ago = $3,
          distance_from_interval_open = $4,
          candle_open_price = $5,
          candle_break_pct = $6
        WHERE trade_id = $7
        `,
        [
          spotNow?.price ?? null,
          spot60sAgo?.price ?? null,
          spot300sAgo?.price ?? null,
          distanceFromOpen,
          candleOpen?.price ?? null,
          candleBreakPct,
          tradeId,
        ]
      );
    }
  } finally {
    client.release();
  }
}

async function findNearestSpotPrice(symbol: string, ts: Date) {
  const { rows } = await pool.query(
    `
    SELECT price, ts
    FROM spot_prices
    WHERE symbol = $1 AND ts <= $2
    ORDER BY ts DESC
    LIMIT 1
    `,
    [symbol, ts]
  );
  if (!rows.length) return null;
  return rows[0];
}
```

Run this periodically (cron / worker) until everything is enriched.

---

## 8. Exporting CSV for Strategy Reverse Engineering

Now you can generate a CSV with exactly the factors we previously discussed.

Example export query:

```sql
SELECT
  t.id AS trade_id,
  t.market_id,
  m.slug,
  m.duration_type,
  t.side,
  t.direction,
  t.price,
  t.size,
  t.notional,
  t.ts_exchange,
  e.spot_price,
  e.spot_price_60s_ago,
  e.spot_price_300s_ago,
  e.distance_from_interval_open,
  e.candle_open_price,
  e.candle_break_pct,
  e.minutes_until_resolution,
  s.bid_price,
  s.ask_price,
  s.bid_ask_spread,
  s.imbalance_ratio
FROM trades t
JOIN markets m ON m.id = t.market_id
JOIN trade_enrichment e ON e.trade_id = t.id
LEFT JOIN orderbook_snapshots s ON s.id = e.ob_snapshot_id
WHERE t.user_address = :gabagool
ORDER BY t.ts_exchange;
```

Use a small Node script to run this query, stream the rows, and write to `gabagool_trades.csv`.

From there, you can feed it into:

* Python / R
* DuckDB
* or just ask me to analyze patterns like:

  * threshold on `candle_break_pct`,
  * distribution of `minutes_until_resolution`,
  * asymmetry between 15m and 1h market selection.

---

## 9. Future: Strategy Modules & Live Arb Bot

Once Gabagool’s empirical rules emerge (e.g. “buy DOWN on 15m slice when candle_break_pct < –0.35% and minutes_until_resolution < 12”), you can encapsulate them in **strategy modules**:

```ts
type StrategyContext = {
  market: MarketRow;
  orderBook: OrderBookState;
  spotNow: number;
  spotHistory: SpotWindow;
};

type StrategyDecision =
  | { action: 'NOOP' }
  | { action: 'BUY'; side: 'UP'|'DOWN'; size: number; maxPrice: number }
  | { action: 'SELL'; side: 'UP'|'DOWN'; size: number; minPrice: number };

type Strategy = (ctx: StrategyContext) => StrategyDecision;
```

Then you can:

* Plug strategies into backtesting (replaying historical tick/trade/spot events from DB).
* Plug them into realtime loop:

  * Listen to Polymarket data,
  * Construct `StrategyContext`,
  * Call `strategy(ctx)`,
  * If non-NOOP, send CLOB orders via `@polymarket/clob-client`.

---

## 10. Summary

This design gives you:

1. **Realtime footprint** of Gabagool trades with associated orderbook snapshots.
2. **Backfilled history** using CLOB/historical endpoints.
3. **Spot price and candle context**, capturing exactly the signals an arb bot would use.
4. **Idempotent Postgres schema** that supports:

   * iterative backfill,
   * enrichment jobs,
   * clean CSV exports for reverse engineering.
5. A clear path from **data → analysis → strategy modules → full arb bot**.

If you’d like, next step I can:

* Propose exact Drizzle schemas and a `justfile` to run ingestion/backfill/enrichment, or
* Design the backtesting engine layout to replay these events deterministically.
