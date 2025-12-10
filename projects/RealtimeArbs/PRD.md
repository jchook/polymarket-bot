# RealtimeArbs PRD (draft)

## Goal
Exploit fleeting arbitrage opportunities by consuming Polymarket real-time feeds (`@polymarket/real-time-data-client`) and reacting to price changes faster than batch snapshotting. v0 focuses on intra-market (YES/NO) for fast-moving, formulaic markets (e.g., BTC Up/Down 15m); keep the matcher pluggable so we can expand to inter-market and cross-venue later.

## Approach (v0)
- Subscribe to `PriceChange` (and optionally `MarketCreate`) for a scoped set of conditionIds or discoverable templates (BTC Up/Down 15m series that roll every 15m).
- Maintain an in-memory/top-of-book state per outcome; recompute arb checks on each price update with minimal latency between receipt and signal emission.
- Surface arbs via low-latency channels: stdout/logs initially (debug), with hooks for webhook/Redis pub/sub later.
- Persist detected arbs (and their legs/prices/timestamps) for audit/debugging.

## Architecture
- **Realtime client**: `@polymarket/real-time-data-client` WS connection; pluggable reconnection/backoff; auth optional if needed.
- **Market discovery**: Poll Gamma/Data API (or real-time MarketCreate) for new BTC Up/Down 15m markets; auto-enroll new conditionIds into the subscription list. Make template/tag matching configurable (BTC, ETH, etc.).
- **State cache**: Minimal per-outcome book cache (best bid/ask/size, last update time); prune/age-out stale data; initial warm-up from baseline snapshot to avoid cold start.
- **Arb detector**: Multi-leg (2+ legs) intra-event calculator: margin = 1 - sum(bestAsk_i); configurable min margin (default 1.5%) and optional liquidity/fee/slippage filters.
- **Matchers**: Swappable grouping strategy (heuristic by eventSlug/title/conditionId now; embeddings later).
- **Outputs**: log/JSON feed; optional webhook; DB persistence mirroring `arb_opportunities`/`arb_opportunity_legs`.
- **Ops**: metrics on connection status, message rate, lag, arbs found, errors.

## Config
- Scope: conditionIds list plus template/tag filters (e.g., BTC Up/Down 15m, ETH variants), exchange label, matcher name.
- Thresholds: min margin (default 1.5%, configurable), min liquidity, max data age before ignoring stale quotes, fee/slippage assumptions.
- Transport: WS URL, reconnect/backoff, heartbeat/timeout.
- Output: enable persistence, webhook URL, log verbosity.

## Open risks / considerations
- WS reliability and reconnection churn; need replay or initial snapshot to avoid cold start.
- PriceChange depth/fields sufficiency vs needing full orderbook diffs.
- Stale data gaps when no events arrive; must guard against acting on outdated quotes.
- Fee/slippage modeling for realistic arbs.
- Cross-venue expansion will need other real-time sources and alignment.

## Milestones (proposed)
1) Prototype: connect, subscribe to PriceChange for a handful of BTC Up/Down 15m markets, log top-of-book updates.
2) Realtime arb loop: maintain best bid/ask cache, detect intra-market arbs (>=1.5% margin), log candidates.
3) Discovery: auto-detect new rolling BTC Up/Down 15m markets and subscribe dynamically (configurable to include ETH, etc.).
4) Persistence + webhook: write arbs to DB and optionally push webhooks/Redis.
5) Hardening: reconnection/backoff, metrics, stale-data guards, thresholds.
6) Matching upgrade: embeddings/vector matcher for cross-market/cross-venue suggestions.
