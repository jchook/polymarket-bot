# Arb Finder TODO

## Status at a glance
- **Phase**: Planning → Implementation kickoff
- **Last updated**: 2025-02-24
- **Owner**: ?

## Milestones / Steps
- [ ] **Market/Event ingestion (Arb scope)**: ensure open markets ingested; include event linkage, tags, fee/tick if available; CLI/queue params for `closed=false`/scope.
- [ ] **Book snapshot ingestor**: configurable cadence + jitter/backoff; scope by conditionIds/tags; persist to `orderbook_snapshots`; track lag/errors.
- [x] **Intra-event arb detector (DB-backed)**: use latest snapshots; margin/liquidity thresholds; ranking/output format; CLI/worker. `fetchLatestSnapshots` in `server/src/services/arbSnapshotService.ts` pulls the latest per outcome; `findArbsFromSnapshots` uses it.
- [ ] **Cross-venue matcher (baseline)**: heuristic string/slug/tag matching between venues; fee assumptions configurable; outputs candidate pairs. Heuristic matcher scaffolded (`marketMatcher`, `ARB_MATCHER`), but venue-specific pairing still needed.
- [x] **Arb persistence**: store detected arbs + legs in DB for later review/analytics. Tables added (`arb_opportunities`, `arb_opportunity_legs`) and `saveArbOpportunities` used in `findArbsFromSnapshots` (guarded by `STORE_ARBS`).
- [ ] **Embeddings + pgvector**: generate/store embeddings over market/event text; NN search for candidate pairs.
- [ ] **LLM re-rank/verify**: validate cross-venue semantic match and outcome direction; annotate confidence.
- [ ] **Alerting/output**: CLI/JSON feed; optional webhook; include timestamp, legs, prices, margin, liquidity.
- [ ] **Observability**: counters, lag, errors, arb counts; dashboards or logs consumable in BullBoard/Grafana.
- [ ] **Tests/fixtures**: ingestion idempotency, arb math, matcher sanity; small fixture data.

## Active questions / assumptions
- Which second venue is first target after Polymarket (Limitless?) and what are the API limits/auth?
- Fee/slippage assumptions per venue (taker/maker, profit fees).
- Embedding model choice and vector dim; storage budget.
- Desired cadence/latency for arb surfacing (near-real-time vs periodic batch).
- Book depth: are top-of-book snapshots sufficient, or do we need deeper depth for liquidity estimates?
- Alerting channel: slack/webhook/email? What noise threshold is acceptable?

## Current issues / blockers
- Need network access for live market/book pulls; mock/fixture path if offline.
- Event linkage completeness varies by venue; may need explicit event fetch.

## Next immediate tasks (implementation kickoff)
- [x] Define BookIngestor worker interface: cadence envs, scope filters, jitter/backoff, and output schema for progress logs.
- [x] Add CLI command to enqueue book ingestion for a scope (conditionIds/tags/all).
- [x] Add DB query for “latest snapshot per outcome” to feed the intra-event arb detector. Implemented as `fetchLatestSnapshots` in `server/src/services/arbSnapshotService.ts`; consumed by `findArbsFromSnapshots`.
- [ ] Sketch output JSON shape for arb detector (intra-event) and wiring to a CLI script.
- [ ] Generate Drizzle migration for `arb_opportunities` + `arb_opportunity_legs` tables.
