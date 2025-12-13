Master TODO (checklist of cohesive units of work):

- [x] Database/timeseries: Decide Postgres vs Postgres+Timescale; define schemas for spot_prices (base/quote), pm_price_changes (with best bid/ask), derived_features, simulated_trades, strategy_params (β, thresholds), and market_metadata (conditionId → assetIds, tick sizes, etc.).
- [ ] Redis/state layer: Stand up namespaces for latest best-book per asset, EMAs/vol, coordination queues; enforce low-latency access and eviction/TTL for stale books.
- [x] Polymarket ingest: Implement `clob_market.price_changes` client with per-asset best-book cache (bid/ask/ts/hash), filters for target assets, persistence, and optional `agg_orderbook` if needed.
- [x] Coinbase ingest: Implement Advanced Trade WS (`ticker`/`level2` for BTC-USD) with `heartbeats`, split high-volume topics across connections, stale-tick rejection, auto-reconnect/resubscribe, and persistence.
- [ ] Feature pipeline: Build shared rolling calculators (ln(S_t/S_{t-60s}), EMA fast/slow, rolling vol, optional window anchor) for live + backtest; keep state in-memory/Redis.
- [ ] Unified event pipeline: One event-driven path (ingest → features → Δ_SPD → trade intents) with pluggable sources (websocket vs replay) and sinks (orders vs simulated fills) to keep backtests faithful to live behavior.
- [ ] Δ_SPD model fitter: Materialize training rows with aligned pm/spot timestamps (store dt_ms), clamp q_t, apply liquidity weights, ridge regularization; persist β/version/λ in strategy_params; provide hot-reload path.
- [ ] Strategy/execution: Compute Δ_SPD with dynamic thresholds (spread-aware), inventory/risk caps, book-relative limit/IOC pricing, cancel/replace cadence, circuit-breakers; wire to order gateway.
- [ ] Backtester: Replay joined historical streams, apply latency/slippage/queueing jitter and partial fills, record simulated_trades and PnL/metrics; configurable fee/slippage/latency params.
- [ ] Observability/time sync: Enforce NTP/monotonic clocks; log exchange_ts vs receive_ts; alerts for heartbeat/data silence; dashboards for missing bid/ask %, dt_ms histogram, spread distribution, gap counters.
- [ ] MarketCatalog scheduling: add exact 15m boundary handoff (switch activeConditions at window rollovers via timer; keep periodic safety refresh).
