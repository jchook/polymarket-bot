Below is a **birds-eye execution map** for
`bun run live:polymarket:micro-mm`
written as an **operator / systems manager view**, not code-level detail. This is about *ordering, invariants, pauses, and failure behavior* so you get **performance, consistency, and safety**.

I’ll describe:

1. Process boot sequence (what starts, in what order)
2. The steady-state hot path (what runs on every event)
3. Where pauses / gating occur (and why)
4. Failure & degradation modes (spot down, PM down, Redis down)
5. Why this structure avoids drift and bad trades

---

## 1. Process boot sequence (critical ordering)

When you run:

```
bun run live:polymarket:micro-mm
```

**Nothing trades immediately.** The system must *prove readiness* first.

### Phase 0 — configuration & immutables

Executed synchronously, blocking:

1. Load env + config

   * target markets / assetIds
   * bankroll + risk caps
   * latency thresholds
2. Load **strategy_params**

   * β coefficients
   * threshold config
   * version hash
3. Instantiate core singletons:

   * `HotState`
   * `FeatureEngine`
   * `UnifiedEventConsumer`
   * `IntentSink (live mode)`

If any of these fail → **hard exit**.
No partial startup.

---

### Phase 1 — state warm-up (no trading yet)

Executed in parallel, but **gated**:

1. Connect Redis (optional)

   * If Redis fails → log + continue (in-memory fallback)
2. Start Coinbase WS
3. Start Polymarket WS
4. Start liveness monitors (heartbeats)

The system now enters **WARMING** state.

---

### Phase 2 — readiness gating (this is crucial)

Trading is **disabled** until all are true:

* ✅ At least one **fresh BTC spot tick**
* ✅ At least one **fresh PM best book** for each target asset
* ✅ FeatureEngine has produced a **valid feature vector**
* ✅ Time skew within tolerance (e.g. |spot_ts − pm_ts| < 250ms)

Only when all gates pass does the system transition to:

> **RUNNING (TRADE-ELIGIBLE)**

Until then:

* events are processed
* features are computed
* **intents are suppressed**

This avoids:

* trading on half-initialized EMAs
* phantom Δ_SPD at startup

---

## 2. Steady-state hot path (what runs per event)

Once RUNNING, every incoming event follows the **same path**.

### Event flow (single threaded or serialized queue)

```
WebSocket Event
   ↓
Normalize → UnifiedEvent
   ↓
UnifiedEventConsumer
   ↓
HotState update
   ↓
FeatureEngine.update(exchangeTs)
   ↓
Δ_SPD computation
   ↓
Strategy decision
   ↓
IntentSink (live)
```

### Important properties

* **No blocking I/O** in this path
* No Redis round-trips required
* No DB writes required
* Everything is in-process memory

DB writes (logging, metrics) happen **off the hot path**.

---

## 3. Where execution pauses (and why)

This is where most trading systems fail. Yours should pause **intentionally**.

---

### A. Spot feed pauses (Coinbase down / stale)

**Detected by:**

* no spot tick > TTL (e.g. 3s)
* heartbeat silent

**Behavior:**

* System transitions to **DEGRADED**
* UnifiedEventConsumer continues processing PM events
* FeatureEngine **does not advance**
* Δ_SPD = undefined
* Strategy emits **no intents**

➡️ Trading pauses automatically
➡️ No need to stop the process

When spot resumes:

* EMAs resume naturally
* System transitions back to RUNNING

---

### B. Polymarket feed pauses

**Detected by:**

* no PM book update > TTL
* heartbeat silent

**Behavior:**

* System transitions to **DEGRADED**
* Spot ticks still processed
* FeatureEngine continues updating spot-side features
* Δ_SPD suppressed due to missing `q_t`

➡️ No trades
➡️ No corrupted state

---

### C. Redis unavailable

**Detected by:**

* connection error or timeout

**Behavior:**

* HotState silently switches to in-memory
* No pause in trading
* Warning logged once

Redis is **not in the critical path**, so this is safe.

---

### D. Feature invalidation (time skew / stale joins)

If:

* PM ts and spot ts drift beyond tolerance
* missing anchor / EMA uninitialized

Then:

* FeatureEngine returns `invalid`
* Δ_SPD suppressed
* Strategy does nothing

This prevents “math looks right but time is wrong” trades.

---

## 4. Failure & degradation modes (explicit)

Here’s a compact table.

| Failure                 | Result       | Trading        |
| ----------------------- | ------------ | -------------- |
| Coinbase WS down        | DEGRADED     | ❌ paused       |
| PM WS down              | DEGRADED     | ❌ paused       |
| Redis down              | RUNNING      | ✅ continues    |
| FeatureEngine invalid   | DEGRADED     | ❌ paused       |
| DB down                 | RUNNING      | ✅ continues    |
| Clock skew detected     | DEGRADED     | ❌ paused       |
| Strategy params missing | STARTUP FAIL | ❌ never starts |

Key rule:

> **If signal correctness is uncertain, do nothing.**

---

## 5. Why this structure works (manager view)

### Single pipeline invariant

* Live and backtest use **identical execution order**
* Only the **event source** changes
* Same pauses happen in replay

### No hidden state

* All decisions flow from explicit events
* No background timers deciding trades
* No polling loops

### Natural throttling

* If data slows → fewer events → fewer decisions
* No artificial sleeps required

### Debuggability

You can answer:

* “Why didn’t it trade?”
* “Why did it pause?”
* “What exact data was missing?”

without guesswork.

---

## 6. Mental model (keep this in your head)

Think of the bot as:

> **A deterministic event machine that occasionally emits intents — and defaults to silence.**

Silence is success.
Trades are the exception.

---

## 7. If you want next

I can:

* draw this as a one-page ASCII or Mermaid diagram
* give you a **state machine definition** (`STARTING → WARMING → RUNNING → DEGRADED`)
* define exact TTL / timing constants
* review whether your current code already matches this or needs adjustments

Send the next CODEX diff or ask for one of the above.

