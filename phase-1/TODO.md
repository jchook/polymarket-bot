High-level TODO outline based on README guidance:

- Database layer: Decide on Postgres vs Postgres+Timescale; create schemas for btc_spot_ticks, pm_price_changes, derived_features, simulated_trades, and strategy_params (stores β and thresholds).
- Caching/state: Stand up Redis namespaces for latest ticks, EMAs/vol, and coordination queues (e.g., BullMQ) if needed.
- Polymarket ingest: Implement websocket client for `clob_market.price_changes` (and optional `agg_orderbook`), persist mid/bid/ask with filters for target assets.
- Coinbase ingest: Add websocket client for BTC-USD ticker/trades with heartbeat/reconnect; persist bid/ask/mid ticks.
- Feature computation: Build rolling EMA/volatility calculator sharing logic for live and backtest; define S0/window reset rules.
- Δ_SPD model: Implement regression fitter over historical joins (logit(q_t) vs features), persist β to DB, and load into runtime.
- Strategy logic: Compute Δ_SPD in real time, apply enter/exit thresholds, inventory/risk controls, and emit normalized trade intents.
- Backtester: Replay joined historical streams, feed shared feature/strategy pipeline, and record PnL/metrics with configurable fee/slippage assumptions.
- Ops/monitoring: Add basic logging/alerts for feed liveness, DB/Redis health, and strategy anomalies; supply env/config templates.
- Market metadata: Create canonical table mapping conditionId → assetIds, tickSize, minOrderSize, negRisk flags, etc.
- Time sync: Enforce NTP/monotonic timestamps; record exchange timestamp vs receive timestamp for alignment metrics.
- Data quality: Build dashboard/metrics for missing bid/ask %, dt_ms histogram between PM and spot, spread distribution, and feed gap counters.
