# Project Objective

The objective of this project is to build a deterministic, low-latency trading
system that exploits short-horizon price dislocations between real-time crypto
spot markets and Polymarket prediction markets, with a specific focus on
microstructure-driven mean reversion rather than directional prediction. The
system is designed so that live trading and historical backtesting share the
exact same event pipeline, feature computation, and decision logic, ensuring
that simulated results faithfully reflect live behavior. Emphasis is placed on
time-correct processing, explicit state management, and conservative gating so
that the system only trades when signal validity and data integrity are
provably sound, prioritizing correctness, explainability, and risk control over
raw trade frequency.

# Tech stack

- Docker used to host postgres (Drizzle) + redis + app
- Package manager: `bun`
- Prepend `just` over direct interactions, to execute in the correct env:
  - `just bun biome lint --fix`
  - `just bun biome format`
  - `just bun tsc`

# Key Internet APIs

- Coinbase Exchange WS Feed (https://help.coinbase.com/en/developer-platform/websocket-feeds/exchange)
- Polymarket real-time data WS (https://github.com/Polymarket/real-time-data-client)

