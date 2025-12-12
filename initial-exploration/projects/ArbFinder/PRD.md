# Arb Finder PRD

## Goal
Continuously detect and surface arbitrage opportunities across prediction markets. Two primary flavors:
- **Intra-event (same market)**: binary YES/NO (or mutually exclusive outcomes) where best-ask prices sum < 1.00, enabling symmetric buy of underpriced legs. Empirically underpriced (sum < 1) gaps are rare; we should surface them aggressively (“hawk mode”) when they appear.
- **Cross-venue (cross-exchange)**: comparable markets on different exchanges (e.g., Polymarket YES at 0.70 vs Limitless NO at 0.20) where combined legs create edge. Future strategies may extend this (e.g., baskets, time spreads, conditional arbs).

## Scope (v1 focus)
- Ingest and store market metadata, outcomes, and orderbook snapshots from supported venues.
- Compute and rank intra-event arbs from stored snapshots.
- Prepare data foundation for cross-venue matching (events/markets, embeddings, pgvector), but allow a simple baseline matcher first.
- Alert/report opportunities; do not place trades.

## Definitions
- **Market**: A tradable condition with one or more outcomes (binary or multi). Identified by `conditionId` (Polymarket) or venue-specific id.
- **Event**: Grouping/semantic wrapper for one or more markets (e.g., “BTC 15m candle”, “US Election 2024”). Used for cross-venue matching.
- **Snapshot**: Orderbook/midpoint capture at a specific time per outcome.
- **Opportunity**: A ranked arb candidate with supporting book prices and metadata.

## Inputs & Ingestion
- **Venues** (initial): Polymarket CLOB; (future) Limitless/others.
- **Market metadata**: conditionId, slug/title, category/tags, event linkage (event id/slug), negRisk flag, fee rates/tick sizes if available.
- **Outcomes**: token ids, names, outcome index.
- **Orderbook snapshots**: best bid/ask, sizes, mid, spread, raw top-of-book; server time preferred.
- **Events**: If provided by venue, ingest `eventId`/`eventSlug` and attributes to aid cross-venue matching.
- **Embeddings (future)**: LLM-generated vectors over market/event text (title, description, tags) stored in pgvector for similarity search.

## Components
1) **Book Ingestor**
   - Poll orderbooks for active markets/outcomes on a cadence (configurable; e.g., 1–5s).
   - Store snapshots in `orderbook_snapshots` keyed by conditionId/outcomeIndex/timestamp; idempotent via unique constraints.
   - Track ingestion lag and errors; jitter/backoff on failures.
2) **Market/Event Ingestor**
   - Fetch markets (and events if available) and upsert into `markets`, `market_outcomes`, and `events` (if added).
   - Maintain resolved/archived flags; keep tags and event linkage.
3) **Arb Finder (Intra-event)**
   - Pull latest snapshot per condition (or a rolling window) from DB.
   - For binary markets: compute `ask0 + ask1`; flag if < 1.00 (configurable threshold, e.g., < 0.995).
   - For multi-outcome neg-risk sets: generalize to sum of best-asks over mutually exclusive outcomes.
   - Rank by margin and liquidity (min of available size across legs).
4) **Arb Finder (Cross-venue, staged)**
   - **Baseline**: text/slug heuristics to map similar markets across venues (exact/normalized string match on title/slug/tags).
   - **LLM embeddings (pgvector)**: generate embeddings over market/event text; nearest-neighbor search to propose pairs.
   - **LLM re-rank/verify**: prompt to confirm semantic equivalence and direction (which outcome aligns with YES/NO).
   - Compute cross-venue edge using best-asks/bids per leg; include fees.
5) **Outputs**
   - Ranked list/JSON feed with: condition ids, titles, venue(s), legs with prices/sizes, margin, timestamp, and reasoning (for cross-venue matches).
   - Optional alerts (log/CLI for now; webhook later).

## Data Model (adds)
- `events` table (if not present): `id`, `slug`, `title`, `description`, `category`, `tags`, `start/end`, `raw`.
- `markets` should store `eventId`, `eventSlug`, `exchange`, `negRisk`, `tags`, fee/tick if available.
- `orderbook_snapshots` already holds per-outcome books; ensure indexes on `(condition_id, outcome_index, timestamp)`.
- `embeddings` (future): `vector` column on `markets`/`events` text for pgvector similarity.

## Algorithms & Ranking
- **Intra-event**: margin = 1 - (askYes + askNo); liquidity score = min(askSizeYes, askSizeNo); filter by threshold margin/liquidity. Underpriced sums are rare—bias alerts to trigger on any margin > 0 with higher priority (“hawk mode”).
- **Cross-venue**: margin = 1 - (askLegA + askLegB) or (bid/ask combos depending on direction); adjust for venue fees and slippage assumptions.
- **Deduping**: group by conditionId (intra) or matched pair key (cross-venue).

## Operational Concerns
- Configurable scopes: specific conditionIds, tags, venues.
- Cadence knobs: ingestion frequency vs. load; timeout/backoff; retry budget.
- Observability: counts ingested, lag (now - server time), duplicates skipped, errors by venue, arb candidates found.
- Idempotency: DB uniques for snapshots; safe UPSERTs for markets/events.

## Open Questions
- Which cross-venue(s) to prioritize after Polymarket? What APIs and rate limits?
- Fee/slippage assumptions per venue; how to parameterize quickly.
- Embedding model choice and refresh cadence; storage size for vectors.
- Alerting channels and thresholds for noise vs. actionability.
