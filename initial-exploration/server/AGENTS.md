## Project Overview

- Goal: Build a Polymarket data ingestor + backtesting engine focused on BTC 15m markets. Use Drizzle + Postgres for storage, Polymarket Gamma/Data APIs for sources (`polymarket-data` SDK), and BullMQ for ingestion. Target: high-speed, efficient arbitrage/backtesting with idempotent data pipelines; later real-time via `@polymarket/real-time-data-client`.
- Priorities: correctness, idempotency (unique constraints + upserts), camelCase in code → snake_case in DB, low-latency ingestion, reproducible backtests, multi-exchange readiness (schema has `exchange` columns).
- Structure:
  - `src/db/` – Drizzle schema/relations/db client (snake_case tables/cols). Migrations live in `drizzle/`.
- `src/queue/` – BullMQ queues/workers (market ingestion), Bull Board adapter.
- `src/routes/` – Fastify endpoints (ingestion enqueue, health, meta); Bull Board mounted at `/v1/admin/queues`.
- `src/app/` – Fastify app/config/bootstrap.
- `src/worker.ts` – Worker entrypoint (ingestion).
- `src/scripts/enqueueMarketIngest.ts` – Enqueue a market-ingestion job via env vars.
- `src/scripts/ingestCryptoMarkets.ts` – Targeted BTC/ETH 15m/1h market enqueue via slug derivation.
- `src/scripts/enqueueBtcPriceIngest.ts` – Enqueue BTC price backfill job.
- `src/scripts/enqueueTradeIngest.ts` – Enqueue trade ingestion job.
- `src/scripts/backfillGabagoolTrades.ts` – Build BTC/ETH 15m/1h slugs over a date range, resolve conditionIds, enqueue market + gabagool trade ingestion.

## Commands (justfile)

- `just db generate` / `just db migrate` – Drizzle migrations (docker compose).
- `just up` – start stack via docker-compose.
- `just sh` – shell into app container.
- `just logs` – tail docker logs.
- `just lint` / `just test` – if defined in justfile.
- Env samples: see `.env.defaults` (DATABASE_URL/POSTGRES_*, GAMMA_BASE_URL, Redis, etc.).

## Ingestion (markets)

- SDK: `polymarket-data` `listGammaMarkets` used in `src/queue/workers.ts`.
- Job params (BullMQ): `tag?`, `slugs?`, `pageSize?`, `maxPages?`, `closed?`, `conditionIds?`, `exchange?` (defaults to `polymarket`).
- Enqueue via script envs (set before `bun run ingest:markets`):
  - `MARKET_TAG`, `MARKET_PAGE_SIZE`, `MARKET_MAX_PAGES`, `MARKET_CLOSED=true`, `MARKET_CONDITION_IDS=...` (comma-separated), `MARKET_EXCHANGE=...`.
- Idempotency: DB uniques + upserts; reruns are safe.

## Targeted crypto ingestion

- Script `bun run src/scripts/ingestCryptoMarkets.ts` computes current/next BTC/ETH 15m/1h slugs and enqueues a market ingest using those slugs. Optional env: `CRYPTO_EXCHANGE` label passed through to ingestion.

## BTC price ingestion

- Queue name: `btc-price-ingestion` (BullMQ worker).
- Script `bun run src/scripts/enqueueBtcPriceIngest.ts` accepts envs:
  - `PRICE_SYMBOL` (default `BTCUSDT`)
  - `PRICE_EXCHANGE` (label, default `binance`)
  - `PRICE_START_ISO` / `PRICE_END_ISO` (optional ISO timestamps; default start = latest+interval or last 12h, end=now)
  - `PRICE_INTERVAL_MS` (default `900000` = 15m; allowed: 1m,3m,5m,15m,30m)
  - `PRICE_PROVIDER` (`bitstamp` default; `binance` also supported)

## Trade ingestion

- Queue name: `trade-ingestion` (BullMQ worker).
- Script `bun run src/scripts/enqueueTradeIngest.ts` envs:
  - `TRADE_CONDITION_IDS` (comma-separated; required)
  - `TRADE_WALLET` (optional; lowercased in worker; records `user_trades` for matching maker/taker)
  - `TRADE_EXCHANGE` (label; default `polymarket`)
  - `TRADE_START_AFTER` (optional ISO timestamp to skip older trades)
  - `TRADE_DELAY_MS` (optional per-condition delay; default 200ms)
- Uses CLOB `getMarketTradesEvents`; upserts into `trades` and `user_trades`, with per-condition watermarks in `trade_watermarks`.

### Gabagool backfill helper
- Script `bun run src/scripts/backfillGabagoolTrades.ts` envs:
  - `GABA_WALLET` (required)
  - `GABA_START_ISO` / `GABA_END_ISO` (required; ISO timestamps in ET range to cover)
  - Builds slugs for BTC/ETH 15m/1h over the range, resolves conditionIds via Gamma, enqueues market ingest for those conditionIds, then enqueues trade ingest for the wallet.

## Dashboard

- Bull Board: `/v1/admin/queues` (same app process).

## Next big rocks

- Generate/apply migration for new `exchange` columns if not already done.
- Add clients for Data API trades/activity and CLOB orderbook snapshots; add trade/price/BTC ingestors.
- Backtester: event timeline, latency/fee modeling, strategy runner, CLI surface.
