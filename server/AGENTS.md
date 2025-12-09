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

## Commands (justfile)

- `just db generate` / `just db migrate` – Drizzle migrations (docker compose).
- `just up` – start stack via docker-compose.
- `just sh` – shell into app container.
- `just logs` – tail docker logs.
- `just lint` / `just test` – if defined in justfile.
- Env samples: see `.env.defaults` (DATABASE_URL/POSTGRES_*, GAMMA_BASE_URL, Redis, etc.).

## Ingestion (markets)

- SDK: `polymarket-data` `listGammaMarkets` used in `src/queue/workers.ts`.
- Job params (BullMQ): `tag?`, `pageSize?`, `maxPages?`, `closed?`, `conditionIds?`, `exchange?` (defaults to `polymarket`).
- Enqueue via script envs (set before `bun run ingest:markets`):
  - `MARKET_TAG`, `MARKET_PAGE_SIZE`, `MARKET_MAX_PAGES`, `MARKET_CLOSED=true`, `MARKET_CONDITION_IDS=...` (comma-separated), `MARKET_EXCHANGE=...`.
- Idempotency: DB uniques + upserts; reruns are safe.

## Dashboard

- Bull Board: `/v1/admin/queues` (same app process).

## Next big rocks

- Generate/apply migration for new `exchange` columns if not already done.
- Add clients for Data API trades/activity and CLOB orderbook snapshots; add trade/price/BTC ingestors.
- Backtester: event timeline, latency/fee modeling, strategy runner, CLI surface.
