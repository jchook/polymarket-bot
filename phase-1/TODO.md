Master TODO (checklist of cohesive units of work):

- [x] Database/timeseries: Decide Postgres vs Postgres+Timescale; define schemas for spot_prices (base/quote), pm_price_changes (with best bid/ask), derived_features, simulated_trades, strategy_params (β, thresholds), and market_metadata (conditionId → assetIds, tick sizes, etc.).
- [ ] Redis/state layer: Stand up namespaces for latest best-book per asset, EMAs/vol, coordination queues; enforce low-latency access and eviction/TTL for stale books.
- [x] Polymarket ingest: Implement `clob_market.price_changes` client with per-asset best-book cache (bid/ask/ts/hash), filters for target assets, persistence, and optional `agg_orderbook` if needed.
- [x] Coinbase ingest: Implement Advanced Trade WS (`ticker`/`level2` for BTC-USD) with `heartbeats`, split high-volume topics across connections, stale-tick rejection, auto-reconnect/resubscribe, and persistence.
- [ ] Feature pipeline: Build shared rolling calculators (ln(S_t/S_{t-60s}), EMA fast/slow, rolling vol, optional window anchor) for live + backtest; keep state in-memory/Redis.
- [x] Unified event pipeline: One event-driven path (ingest → features → Δ_SPD → trade intents) with pluggable sources (websocket vs replay) and sinks (orders vs simulated fills) to keep backtests faithful to live behavior.
- [ ] Δ_SPD model fitter: Materialize training rows with aligned pm/spot timestamps (store dt_ms), clamp q_t, apply liquidity weights, ridge regularization; persist β/version/λ in strategy_params; provide hot-reload path.
- [ ] Strategy/execution: Emit trade intents from dislocation signals with thresholds, inventory/risk caps, book-relative limit/IOC pricing, cancel/replace cadence, circuit-breakers; wire to order gateway.
- [ ] Backtester: Stream DB events into unified pipeline (chunked), apply latency/slippage/queueing jitter and partial fills via simulated sink, record simulated_trades and PnL/metrics; configurable fee/slippage/latency params.
- [ ] Observability/time sync: Enforce NTP/monotonic clocks; log exchange_ts vs receive_ts; alerts for heartbeat/data silence; dashboards for missing bid/ask %, dt_ms histogram, spread distribution, gap counters.
- [ ] MarketCatalog scheduling: add exact 15m boundary handoff (switch activeConditions at window rollovers via timer; keep periodic safety refresh).
- [ ] Test trading mode: Add MODE=test in orchestrator; use live feeds + unified pipeline but route intents to simulated execution sink (latency/failure/fee), reset hot state between runs for determinism.
- [ ] Intent emission: Add OrderIntent type and emit intents in UnifiedEventConsumer from dislocation + thresholds/inventory caps; prevent duplicates with intentId.
- [ ] Simulated execution sink: Consume intents, apply latency/failure/partial fill, persist simulated_trades, emit fill events to update positions/pending.
- [ ] MODE=test wiring: Orchestrator switch to simulated sink; reset hot state on start.
