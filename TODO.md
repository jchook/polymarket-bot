## TODO

- [ ] Repo setup
  - [ ] Add `drizzle.config.ts`, env sample with Postgres URL, and package scripts (`db:generate`, `db:migrate`).
  - [ ] Wire `pg` client + Drizzle init helper (camelCase in code → snake_case in DB via explicit column names).
  - [ ] Add basic lint/test scripts and CI placeholder.

- [ ] Schema & migrations (Drizzle)
  - [x] Define tables for markets, market_outcomes, orderbook_snapshots, price_history (optional), trades, user_trades, btc_prices, backtest_runs, backtest_orders, user_pnl_snapshots.
  - [x] Markets table fields include: `condition_id`, `event_id`, `event_slug`, `market_slug`, `neg_risk` (bool), `tags` (jsonb/array), `volume_24h`/`volume_all_time`/`open_interest`/`liquidity` (numeric, nullable), plus existing window/resolution metadata and `raw_metadata`.
  - [x] Market outcomes store `token_id`, `outcome_index`, `outcome_name` (exact from Gamma), FK to markets.
  - [x] Include indexes/uniques: snapshots `(condition_id, outcome_index, timestamp)`, trades `trade_id` PK, user_trades per wallet, btc_prices `(timestamp, exchange, symbol)`, backtest tables FKs.
  - [ ] Generate initial migration from schema; consider partition/TTL plan for high-volume tables (snapshots/price_history).

- [ ] Clients
  - [ ] PolymarketClient (CLOB public): markets, orderbooks, prices, trades/events, fee rate, server time.
  - [ ] PolymarketDataApiClient: `/trades`, `/activity` with pagination helpers and rate-limit/backoff.
  - [ ] GammaClient: markets/events filterable for BTC 15m.
  - [ ] BtcPriceFeed interface + first adapter (e.g., Coinbase/Binance REST candles).

- [ ] Ingestors (idempotent, jittered scheduling)
  - [ ] MarketIngestor: discover/update BTC 15m markets + outcomes; upsert metadata.
  - [ ] PriceIngestor: poll orderbook/mid snapshots; store with server time; enforce unique constraint.
  - [ ] TradeIngestor:
    - [ ] Global trades per market via Data API.
    - [ ] User trades for gabagool wallet.
    - [ ] Persist last_seen watermark per scope; handle corrections/duplicates.
  - [ ] BTCPriceIngestor: poll candles/ticks covering market windows; flag gaps/outliers for backfill.
  - [ ] Shared: backoff/jitter, structured logs, ingestion lag metrics.

- [ ] Backtester core
  - [ ] Event timeline builder (snapshots + trades + BTC price).
  - [ ] StrategyFn types/context; ensure deterministic/pure.
  - [ ] Latency model (decision + placement + jitter) and seeded RNG.
  - [ ] Fill simulation v1 (top-of-book only, marketable vs resting).
  - [ ] Fee model (taker/maker/profit) with overrides; document assumptions per run.
  - [ ] P&L computation per market; comparison vs gabagool reconstructed positions.

- [ ] CLI
  - [ ] `gaba-lab ingest ...` commands per ingestor with config flags.
  - [ ] `gaba-lab backtest --strategy=... --compare=gabagool` outputting summary + assumptions used (fees/latency).

- [ ] Observability & testing
  - [ ] Structured logging + metrics counters (ingested, duplicates, corrections, lag).
  - [ ] Tests: ingestion idempotency fixtures; fee/P&L math; latency timing determinism; strategy harness smoke test.
  - [ ] Small fixture data (redacted) for hermetic tests.

- [ ] Docs
  - [ ] README/PRD pointers, config instructions (env vars, profiles), and usage examples for ingestors/backtests.
