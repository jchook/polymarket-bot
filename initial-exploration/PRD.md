## CODEX INTELLIGENCE PRD

### Project: GABA-LAB — Polymarket Data + Backtesting Engine

---

### 0. Mission

Build a **TypeScript** system that:

1. Uses `@polymarket/clob-client` + Polymarket Data API to:

   * Fetch and persist **BTC 15-minute Polymarket markets**, **orderbook/price history**, and **per-trader trades** (especially gabagool).
   * Ingest **BTC spot price history** from an external exchange API.
2. Provides a **backtesting engine** where:

   * A strategy function runs on historical data.
   * Fees and latency are **explicit parameters** of the simulation.
   * Strategy P&L can be **compared directly** against gabagool’s P&L on the same markets.
3. Is designed so that **the same strategy code** can later be used in a **live-execution runner** that actually trades via `ClobClient`—but live trading is *not* implemented in this phase.

---

### 1. Scope

#### In scope

* **Read-only** integration with Polymarket:

  * `@polymarket/clob-client` public methods for markets, orderbooks, prices, trades, and fees.
  * Polymarket **Data API** for user & global trades and activity (`/trades`, `/activity`).
  * Gamma API for additional market metadata (event titles, tags, BTC markets).
* **External BTC price feed**: pluggable HTTP adapter (e.g. Coinbase/Binance), historized in DB.
* **Postgres (recommended) schema** for:

  * Markets & outcomes.
  * Orderbook/price snapshots.
  * Trades (global + per address).
  * BTC price candles/ticks.
  * Backtest runs and simulated orders.
* **Backtester**:

  * Time-stepped simulation using historical snapshots.
  * Strategy interface that can be used identically in:

    * backtest mode,
    * (later) live trading mode.
  * Explicit parameters for:

    * **Trading fees** (per-trade / per-profit / CLOB fee bps).
    * **Latency** (strategy decision delay + order placement/ack delay).
* **Basic CLI tools**:

  * Run ingestors idempotently.
  * Run a backtest and print summary vs. gabagool’s realized P&L.

#### Out of scope (for this PRD)

* Placing real orders (L1/L2 authenticated trading).
* Web UI / dashboards.
* Fancy ML/AI decision logic; strategies are simple TS functions.

---

### 2. Key Requirements

#### 2.1 Data to capture

1. **Market metadata**

   * Condition ID, slug, title, event, resolution time.
   * Outcomes and token IDs.
   * Tags/category (crypto/BTC; 15-minute windows).
   * From Gamma + CLOB `getMarkets`/`getMarket`.

2. **Orderbook / price history**

   * For each BTC 15-min market and each outcome:

     * Timestamp (server time from CLOB).
     * Best bid/ask, mid, spread, last trade price.
     * Optional depth (top N levels) if needed later.
   * Using CLOB public methods: `getOrderBook`, `getPricesHistory`, `getMidpoint`, `getSpread`.

3. **Trades**

   * **Global trades** for relevant markets:

     * taker, maker addresses, size, price, side, timestamp, trade ID, market ID, outcome.
     * From CLOB trades endpoint (or `getMarketTradesEvents`) or Data API `/trades`.
   * **User-level trades**:

     * For gabagool’s wallet address via `https://data-api.polymarket.com/trades?proxyWallet=...` or `/activity`.

4. **Resolutions**

   * Market resolution status and winning outcome:

     * From Gamma / CLOB market object `winner` flags.

5. **BTC spot prices**

   * Normalize as OHLCV or tick-level series:

     * timestamp, price, source, symbol.
   * Pluggable source; for now assume generic REST feed with configurable URL.

6. **Fee & CLOB parameters**

   * Fee rates (bps) from CLOB `getFeeRateBps()` (if non-zero for specific venues) and Polymarket docs / config.
   * Tick sizes, neg-risk flags from `getTickSize()` / `getNegRisk()` per market.

> Note: Polymarket’s international site currently advertises **no trading fees**; fees may exist in specific integrations (e.g. Metamask, US CLOB). System must treat fees as **configurable parameters**, not hard-coded.

---

### 3. Architecture Overview

#### 3.1 Components

1. **PolymarketClient (read-only)**

   * Thin wrapper over `@polymarket/clob-client` public methods:

     * `getMarkets`, `getMarket`, `getOrderBook(s)`, `getPricesHistory`, `getFeeRateBps`, `getMarketTradesEvents`, `getServerTime`.

2. **PolymarketDataApiClient**

   * HTTP client for `https://data-api.polymarket.com` core endpoints:

     * `/trades` (global/user trades), `/activity`, `/positions` (optional).

3. **GammaClient**

   * HTTP client for Gamma markets API:

     * `getMarkets`, `getEvents`, filters for crypto/BTC markets.

4. **BtcPriceFeed**

   * Interface:

     * `getHistoricalCandles(since, until, granularity)` → candles.
     * `getTicks(since, until)` → optional tick data.

5. **Ingestor services**

   * **MarketIngestor**: discover new BTC 15-min markets, insert/update metadata.
   * **PriceIngestor**: poll and store orderbook/price snapshots for tracked markets.
   * **TradeIngestor**:

     * `GlobalTradeIngestor` for full market trades.
     * `UserTradeIngestor` for gabagool’s wallet.
   * **BTCPriceIngestor**: store BTC candles/ticks from price feed.

6. **Storage layer**

   * Postgres via **Drizzle ORM** (`drizzle-orm/node-postgres` + `pg`):

     * Schema defined in TS using `pgTable` / column helpers.
     * **Convention:** camelCase property names in code, explicit snake_case table/column names in DB (e.g., `bestBidPrice` → `best_bid_price`) to keep TS ergonomics while matching DB standards.
     * Migrations generated/applied via `drizzle-kit`; migrations are committed to the repo.
     * Enforced uniqueness for idempotency (e.g. unique constraints on trade IDs, snapshot keys).

#### 3.2 Persistence conventions

* All persistent entities are modeled with Drizzle.
* DB tables/columns are stored as **snake_case**; TS interfaces and query builders remain **camelCase**. Use explicit column names in Drizzle definitions to guarantee the mapping (no implicit camel→snake conversion).
* Drizzle schemas should map camelCase property names to snake_case column names so query results are already camelCase (no manual post-processing).
* `drizzle.config.ts` includes Postgres connection info and migration folder; `npm run db:migrate` / `npm run db:generate` scripts wrap `drizzle-kit`.

#### 3.3 Operational & reliability conventions

* **Canonical time source:** Prefer CLOB server time for orderbook/trade timestamps; record local ingestion time separately. Normalize all stored timestamps to timestamptz.
* **Idempotency & corrections:** Unique constraints per table plus per-source “watermark” (last_seen_timestamp or last_trade_id). If an upstream correction/reorg is detected (duplicate with mismatched payload), log and overwrite the row.
* **Rate limits & backoff:** Backoff with jitter on 429/5xx; respect documented limits for CLOB/Data/Gamma; cap concurrent requests per host.
* **Scheduling:** Default poll intervals defined per ingestor (e.g., price 1–5s configurable) with random jitter to avoid burstiness.
* **Config & secrets:** All API base URLs, wallets, intervals, and keys come from env/config; dev vs prod profiles documented.
* **Observability:** Structured logs with counts per run (snapshots/trades ingested, skipped duplicates), lag metrics (now – latest timestamp per source), and CLI exit codes for automation.

7. **Backtest engine**

   * **Timeline builder**: merges snapshots + trades into a sequence of “events” for each market.
   * **Strategy runner**: executes a strategy function per event.
   * **Fill simulation**: given latency & fee model, computes fills & P&L.

8. **Strategy interface**

   * Pure function (no side effects) that:

     * Takes state (positions, prices, orderbook view, time, params).
     * Returns **desired orders** in an abstract format.
   * Same interface will later be used by live execution runner.

9. **CLI**

   * `gaba-lab ingest ...`
   * `gaba-lab backtest --strategy=gaba_pair_arb --compare=gabagool`

---

### 4. Data Model (DB Schema Sketch)

Assume Postgres; types simplified for PRD.

**Naming:** Tables/columns in DB use snake_case; Drizzle schemas expose camelCase fields to application code via explicit column naming.

#### 4.1 Markets

`markets`

* `condition_id` (PK, text)
* `slug` (text)
* `title` (text)
* `event_slug` (text)
* `category` (text) – e.g. “crypto”
* `underlying_symbol` (text) – “BTC-USD”
* `window_start` (timestamptz)
* `window_end` (timestamptz)
* `resolution_time` (timestamptz, nullable)
* `resolved` (bool)
* `winning_outcome_index` (int, nullable)
* `raw_metadata` (jsonb)

`market_outcomes`

* `id` (PK)
* `condition_id` (FK → markets)
* `outcome_index` (int)
* `outcome_name` (text) – “YES” / “NO”
* `token_id` (text) – CLOB token ID.

#### 4.2 Prices / orderbooks

`orderbook_snapshots`

* `id` (PK)
* `condition_id` (FK)
* `outcome_index` (int)
* `timestamp` (timestamptz)
* `best_bid_price` (numeric)
* `best_bid_size` (numeric)
* `best_ask_price` (numeric)
* `best_ask_size` (numeric)
* `mid_price` (numeric, nullable)
* `spread` (numeric, nullable)
* `raw_orderbook` (jsonb, optional top N)

Unique index: `(condition_id, outcome_index, timestamp)` to make ingestion idempotent.

`price_history` (optional simplified)

* `id` (PK)
* `condition_id`
* `outcome_index`
* `timestamp`
* `price` (numeric)
* `side` (“BID”/“ASK” / “TRADE_MID” etc)
* Unique `(condition_id, outcome_index, timestamp, side)`.

#### 4.3 Trades

`trades` (global)

* `trade_id` (PK, text) – from CLOB/Data API
* `condition_id` (FK)
* `outcome_index` (int)
* `taker` (text)
* `maker` (text)
* `side` (“BUY”/“SELL” from taker’s perspective)
* `price` (numeric)
* `size` (numeric)
* `timestamp` (timestamptz)
* `tx_hash` (text, nullable)
* `raw` (jsonb)

`user_trades` (denormalized view around specific wallets)

* `id` (PK)
* `trade_id` (FK → trades)
* `wallet` (text)
* `role` (“TAKER”/“MAKER”)
* `side` (“BUY”/“SELL” from user’s POV)
* `price`, `size`, `timestamp`

#### 4.4 BTC prices

`btc_prices`

* `id` (PK)
* `timestamp` (timestamptz)
* `exchange` (text)
* `symbol` (text, e.g. “BTC-USD”)
* `open`, `high`, `low`, `close` (numeric)
* `volume` (numeric)
* Unique index `(timestamp, exchange, symbol)`.

#### 4.5 Backtests

`backtest_runs`

* `id` (PK, uuid)
* `strategy_name` (text)
* `params` (jsonb)
* `market_filter` (jsonb)
* `fee_model` (jsonb)
* `latency_model` (jsonb)
* `started_at`, `finished_at` (timestamptz)
* `pnl_total` (numeric)
* `pnl_vs_gabagool` (numeric, nullable)
* `notes` (text)

`backtest_orders`

* `id` (PK, uuid)
* `run_id` (FK → backtest_runs)
* `condition_id`
* `outcome_index`
* `timestamp_decision` (timestamptz)
* `timestamp_execution` (timestamptz)
* `side` (“BUY”/“SELL”)
* `size_requested` (numeric)
* `size_filled` (numeric)
* `price_effective` (numeric)
* `fees_paid` (numeric)
* `role` (“TAKER”/“MAKER”/“MIXED”)
* `pnl_contribution` (numeric)

`user_pnl_snapshots` (optional, for gabagool vs strategy)

* `id` (PK)
* `wallet` (text)
* `condition_id`
* `realized_pnl` (numeric)
* `unrealized_pnl` (numeric, nullable)
* `timestamp` (timestamptz)

#### 4.6 Indexing, retention, partitioning

* Indexes: ensure `(condition_id, timestamp)` for snapshots/trades, `(condition_id, outcome_index, timestamp)` for orderbooks, and per-wallet indexes for user_trades.
* Partitioning/TTLs: consider time-based partitioning for high-volume tables (orderbook_snapshots, price_history); optionally TTL/downsample older snapshots to coarser intervals while keeping trades intact.
* Volume expectations recorded per ingestor (poll interval × markets × outcomes) to size retention and disk.

---

### 5. Ingestion Design

All ingestors must be **idempotent** and safe to re-run.

#### 5.1 MarketIngestor

* Use Gamma `getMarkets`/`getEvents` and/or CLOB `getMarkets`:

  * Filter for markets where:

    * category/tag = crypto,
    * underlying asset = BTC,
    * time window ≈ 15 minutes (via metadata naming convention or resolution/expiry times).
* Upsert into `markets` and `market_outcomes`.
* Run periodically (e.g., every minute or via CLI batch).

#### 5.2 PriceIngestor

* For each **active** tracked market:

  * Periodically (e.g., every 1–5 seconds configurable) call:

    * `getOrderBooks()` or `getOrderBook(tokenId)` for YES/NO.
    * Optionally `getMidpoint`, `getSpread`.
  * Insert/UPSERT into `orderbook_snapshots` (one row per outcome).
* Ensure we use **server time** where possible (`getServerTime()`) to reduce clock skew impact.

#### 5.3 TradeIngestor

* Use Data API `/trades`:

  * For gabagool:

    * `GET /trades?proxyWallet=<gabagool_wallet>&limit=N&before=<timestamp>` paginated backwards.
  * For specific markets:

    * `GET /trades?conditionId=<id>` paginated.
* Normalize into `trades` and `user_trades` tables.
* Maintain a per-wallet, per-market `last_seen_timestamp` to avoid re-fetching large ranges; still idempotent due to unique `trade_id`.

#### 5.4 BTCPriceIngestor

* Use some `BtcPriceFeed` adapter:

  * Poll and store candles covering the union of:

    * time windows in tracked Polymarket BTC markets,
    * plus optional buffer before/after.
* Handle gaps/outliers: retries with backoff, drop/flag obvious outliers, and log missing intervals for backfill.

#### 5.5 Pagination & resumption

* Data API trades: paginate backward via `before` with `limit`; persist `last_seen_timestamp`/`last_trade_id` per wallet and per market to resume without gaps.
* Gamma/CLOB: use documented cursors/offsets; cap backfill windows to avoid unbounded scans.
* Maintain backfill windows (e.g., 24–72h) and allow CLI override for deep history.

#### 5.6 Idempotency, duplicates, corrections

* Unique constraints enforce idempotency. On duplicate with differing payload, overwrite and log “corrected” to detect upstream replays/reorgs.
* Track per-source ingestion watermarks and emit ingestion lag metrics (now minus latest upstream timestamp).

#### 5.7 Time normalization

* Prefer server-provided timestamps (CLOB) over local clocks; store ingestion_time separately.
* Normalize all persisted times to timestamptz; ensure cross-source joins align on UTC.

---

### 6. Backtesting Engine

#### 6.1 Strategy interface

```ts
type MarketState = {
  now: Date;
  conditionId: string;
  outcomes: {
    index: number;
    bestBid?: { price: number; size: number };
    bestAsk?: { price: number; size: number };
    midPrice?: number;
  }[];
  recentTrades: TradeEvent[];   // short rolling window
  btcPrice?: number;
  myPositions: PositionState[]; // per outcome
};

type StrategyContext = {
  feeModel: FeeModelConfig;
  latencyModel: LatencyModelConfig;
  params: Record<string, unknown>;
};

type StrategyOrderIntent = {
  conditionId: string;
  outcomeIndex: number;
  side: "BUY" | "SELL";
  size: number;
  limitPrice: number;
  timeInForce: "GTC" | "FOK" | "GTD";
};

type StrategyFn = (state: MarketState, ctx: StrategyContext) => StrategyOrderIntent[];
```

* The **same `StrategyFn`** will be used:

  * In backtests (with historical snapshots).
  * Later in live mode (wired to real `ClobClient` execution).

#### 6.2 Event timeline & stepping

For each market:

1. Load:

   * `orderbook_snapshots` within time interval.
   * `trades` for that market.
   * BTC prices for that window.
2. Construct a sorted event stream:

   * `PRICE_SNAPSHOT` events (from snapshots).
   * `TRADE` events (from trade table).
3. For each event:

   * Build `MarketState` view at that time (last snapshot before/at event, plus recent trades, plus BTC price).
   * Pass to `StrategyFn`.
   * For each returned order intent:

     * Simulate **order placement and fills** with latency & fees (see below).
   * Update simulated positions and P&L.

#### 6.3 Latency model

Represent as config:

```ts
type LatencyModelConfig = {
  decisionDelayMs: number;      // delay from event -> strategy decision
  orderPlacementDelayMs: number;// decision -> order reaching book
  minLatencyJitterMs?: number;
  maxLatencyJitterMs?: number;
};
```

Simulation:

* If event at time `t_event`, decision at `t_decision = t_event + decisionDelay`.
* Order reaches book at `t_exec = t_decision + orderPlacementDelay + jitter`.
* Fill price:

  * Find snapshot/trade nearest to `t_exec`.
  * For **marketable orders** (e.g. buy at or above best ask):

    * Fill at best ask (or better, by walking depth if modeling).
  * For non-marketable limit orders:

    * Assume “resting order that only fills when crossed”; approximate by checking later snapshots/trades.

We can start simple (no partial fills, best-price only) with a clear TODO for improved depth modeling.

#### 6.4 Fee model

Represent as config:

```ts
type FeeModelConfig = {
  takerFeeBps: number;          // e.g. 0 or 1
  makerFeeBps: number;          // usually 0
  profitFeeRate: number;        // e.g. 0, 0.02 for 2% on net winnings
};
```

* Trade-level fee:
  `fee_trade = notional * (role === "TAKER" ? takerFeeBps : makerFeeBps) / 10_000`.
* Resolution-level fee: if `profitFeeRate > 0`, apply on net positive P&L per market.

Values can be:

* Fetched from `getFeeRateBps()` if nonzero for the venue.
* Overridden via config for specific scenarios (e.g. simulating 2% resolution fees mentioned by some third-party analyses).

#### 6.5 P&L and comparison to gabagool

Per market:

* Simulated strategy:

  * Track positions in YES/NO.
  * At resolution:

    * Payout for winning outcome shares = `qty_win * 1`.
    * Return collateral from losing side = 0.
    * Realized P&L = payouts – total cost – resolution fees (if configured).
* Gabagool:

  * Use `user_trades` + resolution outcome.
  * Reconstruct his positions & realized P&L using same fee model.

Store:

* Per-market P&L for strategy vs gabagool.
* Aggregated stats:

  * Hit rate (markets where strategy > 0 & gabagool > 0 etc).
  * Average P&L per trade / per market.

#### 6.6 Simulation fidelity & reproducibility

* Depth modeling v1: single best bid/ask, no partial fills; mark TODO for multi-level depth and partial fills. Marketable orders fill at top-of-book; non-marketable rest until crossed.
* Reproducibility: latency jitter and any randomness must be seeded for repeatable runs.
* Determinism: StrategyFn should be pure/deterministic given inputs; avoid external side effects. Historical context windows should be bounded (fixed-length buffers) to cap memory.
* Fee sources: prefer `getFeeRateBps()` when available; allow CLI/config overrides per run (taker/maker/profit fees) and document assumption used in each backtest output.

#### 6.7 Latency & HFT validation

* **Latency surfaces:** track and simulate the full chain—(a) market data arrival → strategy signal, (b) signal → decision, (c) decision → order send/ack, (d) ack → fill completion. Persist these as metrics per backtest run (`latency_model` + observed simulated lags) and surface p50/p95/p99 in reports.
* **Configurable ranges:** latency knobs accept fixed, uniform, or lognormal distributions with bounded min/max; profiles should cover LAN-grade (5–20ms), regional (20–80ms), and degraded (80–300ms+) to mirror realistic internet conditions.
* **HFT ingestion cadence:** stress test ingest + simulator with synthetic streams at 50–200ms book updates and bursty trade events to ensure no event loss, correct ordering, and stable memory use.
* **Fill realism:** when `t_exec` lands between snapshots, allow a “stale book” penalty option (e.g., slip to next best price) to model message delay; toggled via config for robustness sweeps.
* **E2E harness:** add a repeatable load test that replays a short high-velocity window (e.g., 5–10 min of BTC markets) at 1×, 2×, and 5× speed, measuring simulated fill latency and P&L drift across latency profiles. Fails if event-to-fill simulation exceeds configured max or produces non-deterministic P&L under fixed seeds.

---

### 7. Implementation Plan (Phased)

#### Phase 1 – Skeleton & Clients

* Set up TS project:

  * `pnpm` / `npm`, linting, basic config.
* Implement:

  * `PolymarketClient` using `@polymarket/clob-client` in public mode.
  * `PolymarketDataApiClient` (axios/fetch-based).
  * `GammaClient`.
  * Drizzle setup (`drizzle.config.ts`, `pg` client) and initial DB migrations for schema with snake_case tables/columns.

#### Phase 2 – Ingestion

* Implement `MarketIngestor`:

  * Identify and tag BTC 15-min markets.
* Implement `PriceIngestor`:

  * Periodic snapshot of orderbook/mid prices.
* Implement `TradeIngestor`:

  * For:

    * gabagool wallet (address configured),
    * markets of interest.
* Implement `BTCPriceIngestor`.

All with idempotent UPSERT logic and simple CLI entry points.

#### Phase 3 – Backtester core

* Implement:

  * `StrategyFn` interface & types.
  * Base **pair-arb strategy** prototype (for testing).
  * Event timeline builder.
  * Simple latency & fee model.
  * Fill simulation (single-level depth, marketable orders only initially).
  * Latency profile config (fixed + jitter distributions) and reporting of simulated p50/p95 event-to-fill times.
* Implement backtest CLI:

  * Choose markets/time window.
  * Run strategy.
  * Output summary P&L.

#### Phase 4 – Gabagool comparison & polish

* Implement gabagool P&L reconstruction.
* Add comparison output:

  * Per-market and aggregate.
* Add config profiles for:

  * “zero trading fee” (current Polymarket international).
  * “2% profit fee” scenario (for robustness).
  * Latency profiles: LAN, regional, degraded (see 6.7), selectable via CLI flags.
* Add a few assertions/tests around:

  * Pair-cost math (`avgYES + avgNO`),
  * Profit formula.
  * Latency simulation consistency (fixed seed yields stable event-to-fill metrics across runs).

#### Testing & fixtures (expectations)

* Ingestion: fixtures covering duplicate trades/orderbooks ensure UPSERTs remain idempotent and corrections overwrite safely.
* Backtester: unit tests for fee math, P&L, latency timing; seeded runs to guarantee determinism. Add a short synthetic high-velocity fixture (dense book updates/trades) to validate ordering and latency profile sweeps.
* Fixtures can be checked in (redacted) for small snapshot/trade windows to keep tests hermetic.

---

### 8. Risks & Notes

* **Data completeness:**
  Relying on Polymarket’s CLOB + Data API; if historical limits or rate limits bite, need pagination and possibly off-chain archives (Kaggle datasets, etc.) as fallbacks.
* **Latency approximation:**
  We can’t know gabagool’s actual latency; we’ll treat latency as knobs in simulation and explore ranges.
* **Fee ambiguity:**
  Public docs for the international site say no trading fees; third-party sites mention 2% profit fees historically. We make the fee model fully configurable and document assumptions for each backtest.
* **Upstream schema drift:**
  Track assumptions about CLOB/Data API response shapes; log/alert on unexpected fields or missing keys to catch breaking changes early.

---

If you want, next step I can take this PRD and concretize it into a **project layout** (directories, key TS files, and the exact `PolymarketClient` wrapper API) so you can scaffold the repo and start implementing ingestors immediately.
