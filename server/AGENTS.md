## Project Overview

- Goal: Build a Polymarket data ingestor + backtesting engine focused on BTC 15m markets. Use Drizzle + Postgres for storage, Gamma/CLOB/Data APIs for sources, and BullMQ workers for ingestion. Target: high-speed, efficient arbitrage/backtesting with idempotent data pipelines.
- Priorities: correctness of historical data, idempotency, camelCase → snake_case mapping, low-latency ingestion, and reproducible backtests.
- Structure:
  - `src/db/` – Drizzle schema + relations + db client.
  - `src/queue/` – BullMQ queues/workers and Bull Board adapter.
  - `src/routes/` – Fastify endpoints (ingestion enqueue, health/meta).
  - `src/app/` – Fastify app config/bootstrap.
  - `src/worker.ts` – worker entrypoint for ingestion.
  - `drizzle/` – generated migrations (run `just db migrate`).

## Just Tasks (common)

- `just db generate` – Generate Drizzle migration from schema.
- `just db migrate` – Apply migrations to the database.
- `just dev` or `just server` – Run the Fastify API (if defined).
- `just worker` – Run the BullMQ worker (if defined).
- `just lint` / `just test` – Lint/tests if present.

> Check `justfile` for the exact task names; these are the typical targets in this repo. If missing, add them alongside drizzle scripts in `package.json`.
