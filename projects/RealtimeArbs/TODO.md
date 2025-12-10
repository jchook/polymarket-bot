# RealtimeArbs TODO (v0)

## Status
- Phase: Planning → Implementation kickoff
- Scope: Intra-market arbs (YES/NO) on rolling BTC Up/Down 15m markets (configurable templates for BTC/ETH), real-time via `@polymarket/real-time-data-client`.

## Milestones / Tasks
- [ ] Wire real-time client: connect, subscribe to PriceChange for scoped conditionIds/templates, heartbeat/reconnect.
- [ ] Baseline snapshot warmup: pull current best bid/ask for subscribed markets on startup to avoid cold start.
- [ ] Discovery loop: detect new BTC Up/Down 15m markets (and other configured templates) and auto-subscribe.
- [ ] In-memory state: maintain best bid/ask per outcome with stale-age pruning.
- [ ] Arb detector loop: multi-leg intra-market check (sum(bestAsk) < 1), configurable margin threshold (default 1.5%), optional fee/slippage hooks.
- [ ] Output/logging: log arbs with timestamps/margins; structure for future webhook/Redis.
- [ ] Persistence: optionally store arbs to `arb_opportunities`/`arb_opportunity_legs` (feature flag).
- [ ] Config surface: env/config for matcher name, templates/tags, min margin, stale age, heartbeat/backoff, persistence toggle.
- [ ] Metrics/health: basic counters/logs for connection status, message rate, arbs found.
- [ ] Tests/fixtures: unit for matcher grouping and arb math; small fixture for price updates.

## Progress notes
- Initial realtime script (`server/src/scripts/realtimeArbs.ts`) wired with price-change subscription, state cache, matcher-based arb detection, logging, and optional persistence. Env: `REALTIME_CONDITION_IDS`, `REALTIME_MIN_MARGIN` (default 0.015), `REALTIME_MATCHER`, `REALTIME_STORE_ARBS`, `REALTIME_STALE_MS`.

## Open questions
- Preferred discovery source for rolling markets: periodic Gamma/Data poll vs RT MarketCreate subscription?
- Any minimum liquidity filter to pair with margin? What’s acceptable stale age before discarding quotes?
- For persistence, should we de-dup arbs within a short window (e.g., by matcherKey+timestamp bucket)?
