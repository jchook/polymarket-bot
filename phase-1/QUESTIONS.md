Open questions drawn from README review and proposed architecture:

- Data stack: Stick with Postgres + Redis initially or enable TimescaleDB extensions now for hypertables/continuous aggregates?
- Polymarket coverage: Which condition_ids/asset_ids to subscribe to; do we need depth via `agg_orderbook` or just price_changes mid-prices?
- Coinbase feed: Use best bid/ask or trades; acceptable staleness/heartbeat thresholds and reconnect policy?
- Feature anchors: How is S0 defined per market (window start, listing time, rolling reset) and how long is the anchor window?
- Feature params: What EMA lengths, volatility lookback, and any additional factors (e.g., order book imbalance) go into X_t?
- Δ_SPD thresholds: What enter/exit deltas, inventory caps, and risk/position sizing rules govern trading decisions?
- Regression data: Which historical horizon to train on, sampling cadence, and how to handle gaps/outliers/time alignment between PM and BTC?
- Model lifecycle: Where/how are β coefficients stored/versioned in the DB and how frequently are they refit/validated?
- Backtest realism: What fee/slippage assumptions, clock skew tolerance, and latency modeling should be baked into simulations?
- Execution rules: Which order types are allowed (limit vs market), cancel/replace cadence, and safeguards for stuck/partially filled orders?
