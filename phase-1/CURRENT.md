Current focus: analysis-only phase (no execution).

- [ ] Wire backtest runner to real historical PM + spot event dumps (preserve exchangeTs, unified replay).
- [ ] Run a small slice (single condition/asset, ~30–90m), flush dislocation_signals; verify determinism (row counts/fingerprints).
- [ ] Generate signal-quality report for a runId: Δ_SPD distro (overall/RUNNING), RUNNING vs DEGRADED %, dt_ms skew, spread vs |Δ_SPD|, short-horizon response/corr/mean-reversion, collision rates.
- [ ] Stability splits: by day/regime (vol, spread) and β version.
- [ ] Produce report artifacts (summary.md, tables, plots) per runId.
- Guardrails: no execution/sizing/threshold changes; live/replay share unified consumer; exchangeTs is ordering truth; keep collision measurement only.
