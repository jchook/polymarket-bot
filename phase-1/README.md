# Inventory-bounded mean-reversion micro-MM strategy

As long as BTC chop is high and the Polymarket book is thin, the edge is enormous.

Speed is the moat: every decision, system, and deployment choice must minimize latency, especially on remote signal ingestion and order placement/cancel/closure. Optimize for microseconds where possible; correctness assumes low latency by default.

Yeah, this makes solid sense overall. Let’s tighten it into a concrete architecture, then I’ll give you:

1. A quick review + suggested tweaks (DB, streams, architecture)
2. A formal spec for Δ_SPD
3. A regression method to fit β
4. TypeScript sketches to wire it all together

---

## Implementation plan (latency-first)

* Market metadata: Canonical table mapping conditionId → assetIds (UP/DOWN), tickSize, minOrderSize, negRisk, and other params.
* Ingest: Polymarket `clob_market.price_changes` with per-asset best book cache (bid/ask/ts/hash, invalidate stale), optional `agg_orderbook` if needed. Coinbase Advanced Trade WS (`ticker`/`level2` for BTC-USD) with `heartbeats`, split high-volume products across connections, drop stale ticks (>3s).
* State: Redis/in-memory for latest book state, EMAs, rolling vol; avoid cross-region hops.
* Features: Rolling anchors (e.g., ln(S_t / S_{t-60s})), EMA fast/slow, rolling vol; optional window-start anchor if reliable. Keep calculations in-memory.
* Δ_SPD thresholds: Dynamic by liquidity: δ_enter = max(0.01, 2*spread); δ_exit = max(0.005, spread); position caps 1–2% bankroll per side; max 3 legs inventory per market.
* Regression fitter: Clamp q_t to [0.001, 0.999], weight by liquidity (e.g., 1/(spread^2+ε)), ridge regularization, align rows where |dt_ms| ≤ 250ms and store pm_ts/spot_ts/dt_ms.
* Backtest realism: Fees, dynamic slippage (≥ spread), latency 200–400ms + queueing jitter 50–150ms, partial fills with size-at-price, cancel/replace delays.
* Execution: Limits relative to book (BUY at min(bestAsk, q_t + maxPaySlippage); SELL at max(bestBid, q_t - maxPaySlippage)); IOC/maker with 1s cancel/replace; circuit-breakers on price divergence or signal flip.
* Observability/time: Enforce NTP/monotonic clocks; log exchange_ts vs receive_ts; dashboards for missing bid/ask %, dt_ms histograms, spreads, gap counters; alert on heartbeat/data silence >5s.
* Unified pipeline: Same event-driven code paths for ingest → feature calc → Δ_SPD → trade intents in both backtest (replay from storage) and live (websockets); only the event source/sink swaps.

---

## 1. Review + improvements to your plan

### Databases

* **Postgres**: absolutely fine as the canonical store.
* **Redis**: great for:

  * holding latest ticks / EMAs / orderbooks for real-time decisions
  * job queues (BullMQ-style if you want)
* **Timeseries layer**:

  * You don’t *have* to add another DB.
  * If you want nicer time-bucketed queries, **TimescaleDB on top of Postgres** is the sweet spot:

    * same infra, same client, hypertables for `btc_spot_ticks`, `pm_price_changes`, etc.
  * Only reach for ClickHouse/Influx/QuestDB if you later hit serious scale or latency pain.

So: **Postgres (+Timescale) + Redis** is exactly what I’d recommend.

---

### Streams to ingest

You already have:

* ✅ `realtimeTrades` for a specific wallet

You want to add:

1. **Polymarket price stream(s)**

   * `clob_market.price_changes` (per asset_id)
   * optionally `clob_market.agg_orderbook` for full depth + mid prices

2. **Coinbase BTC spot**

   * Websocket for live trades or best bid/ask
   * You’ll store:

     * timestamp
     * best_bid
     * best_ask
     * mid
     * maybe trade price & size

3. **Derived series**

   * On the fly (in Redis) and/or materialized in Postgres:

     * Δ_spot (change since window start)
     * spot_momentum (fast vs slow EMA)
     * spot_vol (rolling volatility)

Then:

* Backtester joins `pm_price_changes` and `btc_spot_ticks` on time (within some tolerance)
* Strategy modules compute Δ_SPD and simulated trades
* When ready, live bot consumes from Redis or direct websockets and hits Polymarket CLOB.

---

## 2. Formal spec for Δ_SPD

Let’s nail this down as math.

### 2.1. Variables

For a given market (e.g. BTC UP in a 15-min window), at time `t`:

* `S_t` = BTC spot price at time `t`
* `S_0` = BTC spot at market window start (or some anchor time)
* `q_t` = Polymarket UP **mid-price** at time `t` (from best bid/ask)
* `x1_t` = normalized spot change

  * e.g. `x1_t = ln(S_t / S_0)`
* `x2_t` = spot momentum

  * e.g. `x2_t = EMA_fast(S)_t – EMA_slow(S)_t`
* `x3_t` = local spot volatility

  * e.g. rolling std dev of `ln(S_i / S_{i-1})` over last N seconds
* `X_t = (1, x1_t, x2_t, x3_t, …)` feature vector (1 for intercept)

Define the **logit** function:

* `logit(p) = ln(p / (1 - p))`
* `σ(z) = 1 / (1 + e^(−z))` (logistic / inverse logit)

### 2.2. Model

We model the **true implied probability** of UP at time `t` as:

[
\text{logit}(p^{\text{expected}}_t) = \beta_0 + \beta_1 x1_t + \beta_2 x2_t + \beta_3 x3_t + \dots
]

Equivalently:

[
p^{\text{expected}}_t = \sigma(\beta_0 + \beta_1 x1_t + \beta_2 x2_t + \beta_3 x3_t + \dots)
]

Where:

* `q_t` is the **observed** PM UP mid-price
* `p_expected_t` is what our model thinks it *should* be, given BTC microstructure

### 2.3. Dislocation indicator Δ_SPD

Define:

[
\Delta_{\text{SPD}}(t) = p^{\text{expected}}_t - q_t
]

Interpretation:

* `Δ_SPD(t) > 0`: PM UP is **underpriced** vs spot → buy UP
* `Δ_SPD(t) < 0`: PM UP is **overpriced** vs spot → sell/short UP (or buy DOWN)

You’ll enforce thresholds:

* enter buy if `Δ_SPD(t) ≥ +δ_enter`
* enter sell if `Δ_SPD(t) ≤ −δ_enter`
* possibly exit if `|Δ_SPD(t)|` crosses back through a smaller `δ_exit`

---

## 3. Regression to fit β coefficients

You want to **fit β** so that the model’s `p_expected_t` tracks `q_t` historically.

### 3.1. Data construction

From your recorded data, build a training row for each time `t`:

* `q_t` = mid price of UP at t (e.g. `(best_bid + best_ask)/2`)
* `y_t = logit(q_t)`  (this is your regression target)
* `x1_t = ln(S_t / S_0)`
* `x2_t = EMA_fast(S)_t – EMA_slow(S)_t`
* `x3_t = spot_vol_t`
* etc.

Now your regression problem is:

[
y_t = \beta_0 + \beta_1 x1_t + \beta_2 x2_t + \beta_3 x3_t + \dots + \epsilon_t
]

This is a **plain linear regression** in `y_t` vs the `x`’s; we use the logit transform to respect the (0,1) bounds.

After fitting β:

* `p_expected_t = σ(β · X_t)`
* `Δ_SPD(t) = p_expected_t − q_t`

### 3.2. Implementation options

#### Option A – Do it in Postgres (simple & nice)

You can start with 1–2 features and use Postgres’ `regr_slope`/`regr_intercept` to sanity-check:

```sql
SELECT
  regr_intercept(logit_q, x1) AS beta0,
  regr_slope(logit_q, x1)     AS beta1
FROM (
  SELECT
    ln(q_t / (1 - q_t)) AS logit_q,
    ln(spot_price / spot_price_start) AS x1
  FROM training_rows
) s;
```

For multiple features, you’ll likely:

* Export training rows to your TS layer and do OLS there; or
* Use a more advanced PG extension / Timescale analytics.

#### Option B – OLS in TypeScript

Define:

* `X` = matrix of shape (N rows, d features including intercept)
* `Y` = vector of length N (`logit_q`)

Estimate:

[
\beta = (X^T X)^{-1} X^T Y
]

You can implement the small linear algebra yourself (dimensions will be tiny) or pull a lightweight numeric lib.

Pseudo-TS (conceptual):

```ts
type Row = {
  logitQ: number;
  x: number[]; // [1, x1, x2, x3...]
};

// compute beta via normal equations
function fitBeta(rows: Row[]): number[] {
  const d = rows[0].x.length;
  const xtx = Array.from({ length: d }, () => Array(d).fill(0));
  const xty = Array(d).fill(0);

  for (const { logitQ, x } of rows) {
    for (let i = 0; i < d; i++) {
      xty[i] += x[i] * logitQ;
      for (let j = 0; j < d; j++) {
        xtx[i][j] += x[i] * x[j];
      }
    }
  }

  // Solve xtx * beta = xty (e.g. Gaussian elimination)
  return solveLinearSystem(xtx, xty);
}
```

Then `beta` is persisted (e.g. in a `strategy_params` table) and loaded by the live bot.

---

## 4. TypeScript wiring: ingesting and computing Δ_SPD

### 4.1. Ingest: Polymarket price changes

You’ll switch from `activity/trades` to `clob_market/price_changes` with filters.

Rough sketch:

```ts
import { RealTimeDataClient } from "@polymarket/real-time-data-client";
import { db } from "../db";
import { pmPriceChanges } from "../db/schema"; // define this

type PriceChange = {
  a: string;       // asset_id
  h: string;       // hash
  p: string;       // price
  s: "BUY" | "SELL";
  si: string;      // size
  ba: string;      // best_ask
  bb: string;      // best_bid
};

type PriceChangesMessage = {
  topic: "clob_market";
  type: "price_changes";
  payload: {
    m: string;           // conditionId
    pc: PriceChange[];
    t: string;           // ms timestamp
  };
};

const TARGET_ASSETS = (process.env.TARGET_ASSETS ?? "").split(",");

new RealTimeDataClient({
  onConnect: client => {
    client.subscribe({
      subscriptions: [
        {
          topic: "clob_market",
          type: "price_changes",
          // filters: token ids (asset_ids) you care about
          filters: TARGET_ASSETS,
        },
      ],
    });
  },
  onMessage: (_client, msg) => {
    if (msg.topic !== "clob_market" || msg.type !== "price_changes") return;

    const { m: conditionId, pc, t } = msg.payload as PriceChangesMessage["payload"];
    const ts = new Date(Number(t));

    for (const change of pc) {
      const bestBid = Number(change.bb);
      const bestAsk = Number(change.ba);
      const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : Number(change.p);

      void db.insert(pmPriceChanges)
        .values({
          conditionId,
          assetId: change.a,
          hash: change.h,
          side: change.s,
          price: change.p,
          size: change.si,
          bestBid: change.bb,
          bestAsk: change.ba,
          midPrice: mid.toString(),
          timestamp: ts,
        })
        .onConflictDoNothing()
        .catch(err => console.error("Failed to persist price_change", err));
    }
  },
  onStatusChange: status => console.log("PM RTD status:", status),
}).connect();
```

---

### 4.2. Ingest: Coinbase BTC spot (sketch)

You’ll connect to Coinbase via their websocket and persist ticks:

```ts
import WebSocket from "ws";
import { db } from "../db";
import { btcSpotTicks } from "../db/schema";

const COINBASE_WS_URL = process.env.COINBASE_WS_URL!;

const ws = new WebSocket(COINBASE_WS_URL);

ws.on("open", () => {
  // send subscription message per Coinbase's current spec
  ws.send(JSON.stringify({
    type: "subscribe",
    channels: [{ name: "ticker", product_ids: ["BTC-USD"] }],
  }));
});

ws.on("message", (data: WebSocket.RawData) => {
  const msg = JSON.parse(data.toString());
  if (msg.type !== "ticker") return;

  const ts = new Date(msg.time);
  const bestBid = Number(msg.best_bid ?? msg.bid ?? msg.price);
  const bestAsk = Number(msg.best_ask ?? msg.ask ?? msg.price);
  const mid = (bestBid + bestAsk) / 2;

  void db.insert(btcSpotTicks)
    .values({
      exchange: "coinbase",
      productId: "BTC-USD",
      bestBid: bestBid.toString(),
      bestAsk: bestAsk.toString(),
      midPrice: mid.toString(),
      timestamp: ts,
    })
    .catch(err => console.error("Failed to persist BTC spot", err));
});
```

(You’ll adapt this to Coinbase’s exact spec – this is just the shape.)

---

### 4.3. Real-time Δ_SPD module

Assume you:

* Load `beta` from DB at startup
* Maintain rolling EMAs/vol in memory
* Maintain the latest PM mid for the UP asset

Then:

```ts
type Beta = number[];

interface FeatureState {
  s0: number;      // BTC at window start
  spotNow: number;
  emaFast: number;
  emaSlow: number;
  vol: number;     // rolling vol estimate
}

function logit(p: number): number {
  return Math.log(p / (1 - p));
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

function buildFeatures(state: FeatureState): number[] {
  const x1 = Math.log(state.spotNow / state.s0);          // ln(S_t / S_0)
  const x2 = state.emaFast - state.emaSlow;               // momentum
  const x3 = state.vol;                                   // volatility
  return [1, x1, x2, x3];                                 // intercept first
}

function computeExpectedProb(beta: Beta, state: FeatureState): number {
  const x = buildFeatures(state);
  let z = 0;
  for (let i = 0; i < beta.length; i++) z += beta[i] * x[i];
  return sigmoid(z);
}

function computeDislocation(
  beta: Beta,
  state: FeatureState,
  q_t: number, // PM mid
) {
  const pExpected = computeExpectedProb(beta, state);
  const deltaSPD = pExpected - q_t;
  return { pExpected, deltaSPD };
}
```

Your live bot loop becomes:

1. On BTC tick → update `FeatureState` (spot, EMAs, vol).
2. On PM price change → recompute `q_t`, compute `Δ_SPD`.
3. If `Δ_SPD` exceeds thresholds and inventory limits allow, send orders.

---

### 4.4. Backtesting

Use the same code path but driven by historical DB reads instead of websockets:

1. Query a joined stream ordered by timestamp:

   * BTC ticks (downsampled to your resolution)
   * PM price changes / mid prices
2. Replay them in order, feeding into the same `FeatureState` + `computeDislocation` + strategy logic.
3. Record hypothetical trades to a `simulated_trades` table and compute PnL.

This keeps the backtester and live bot **identical** except for the data source.

---

## 5. Does your original plan make sense?

Yes, it’s exactly the right shape. The main refinements I’d suggest are:

* Use **Timescale** on top of Postgres if you want comfy time-bucketing and rollups.
* Treat Redis as the **state + coordination layer** (latest ticks, EMAs, job queues).
* Make Δ_SPD a first-class, formally defined indicator:

  * logit-linear regression
  * fitted β stored in DB
  * used identically in backtest + live

If you’d like, next we can:

* Design the **Postgres schema** for all these tables (ticks, price_changes, features, simulated_trades, strategy_params), or
* Sketch a **backtest runner** that streams from Postgres using cursors and yields PnL stats.
