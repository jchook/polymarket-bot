This is actually **on track**, not off course — but it needs **one firm consolidation step** so you don’t drift into framework-building instead of trading.

Below is a **tight reconciliation** of:

* what you already have,
* what CODEX is proposing,
* and the **minimum concrete work** required to reach *live test with simulated fills*.

I’ll do this in three parts:

1. **Reality check**: what is already correct and should NOT be reworked
2. **What is genuinely missing** (boiled down to 3 primitives)
3. **CODEX INTELLIGENCE DIRECTIVE — NEXT EXECUTABLE SLICE** (checklist, minimal)

---

## 1. Reality check: you are architecturally correct already

You and CODEX have already made the *right* high-level decisions:

### ✅ UnifiedEvent pipeline — correct

* Multiple **sources** (DB replay, PM WS, Coinbase WS)
* One **UnifiedEventHandler**
* Multiple **sinks** (signal logging, simulated execution, live execution)

This is the *right abstraction*. Do **not** undo this.

### ✅ Hot state concept — correct

* FeatureEngine state
* Inventory / pending
* Last intent emitted
* All colocated in one place

This is exactly how real trading systems work.

### ✅ Δ_SPD + signal generation — correct

You are past the hard math. Signals are valid.

---

## 2. What is actually missing (strip away the ceremony)

Despite the long list, you are missing **only three real things**:

### MISSING #1 — Intent emission (pure function)

Right now you have:

> *signal exists → log it*

You need:

> *signal exists → maybe emit intent*

This is a **pure decision function**, not infrastructure.

---

### MISSING #2 — Execution sink that turns intents into fills

You already log simulated trades manually.

You now need:

* a sink that accepts **OrderIntent**
* applies **latency / failure / partial fill**
* writes to `simulated_trades`
* emits **FillEvent** back into the pipeline

This is *not* a full matching engine — it’s a probabilistic executor.

---

### MISSING #3 — Position & pending tracking in hot state

This is what prevents:

* duplicate orders
* runaway inventory
* nonsense backtests

It can be **very small and local**.

---

Everything else (catalog boundary scheduling, regression, fingerprints, etc.) is **strictly optional** for now.

---

## 3. CODEX INTELLIGENCE DIRECTIVE

### Operation: LIVE TEST (SIMULATED EXECUTION)

This is the **only directive that should be executed next**.

---

### 🎯 Objective

Enable **MODE=test** where the *real-time pipeline* emits **order intents**, routes them to a **simulated execution sink**, records fills in `simulated_trades`, and updates positions — without changing data sources.

---

## PHASE A — Define OrderIntent (MANDATORY)

**Create a single canonical type. No variants.**

```ts
type OrderIntent = {
  intentId: string;           // idempotency key
  runId: string;
  conditionId: string;
  assetId: string;
  side: "BUY" | "SELL";
  price: number;
  size: number;
  createdTs: number;
  reason: "DELTA_SPD" | "MM_REBALANCE";
};
```

☑ IntentId = hash(conditionId + assetId + side + price + size + intentEpoch)

---

## PHASE B — Emit intents inside UnifiedEventConsumer (CRITICAL)

**Where:** exactly where you currently log `dislocationSignals`

### Decision logic (MVP, no cleverness)

```ts
if (
  state === "RUNNING" &&
  Math.abs(deltaSPD) >= threshold &&
  inventory + pending < inventoryCap &&
  !isDuplicateIntent(intentKey)
) {
  emitIntent(...)
}
```

☑ No retries
☑ No cancels yet
☑ One intent per asset per threshold crossing

---

## PHASE C — Extend hot state (SMALL)

Add **only this** to hot state (or Redis later):

```ts
positions: {
  [conditionId_assetId]: {
    inventory: number;
    pending: number;
    lastIntentId?: string;
  };
}
```

Rules:

* On intent emit → pending += size
* On fill → pending -= filledSize; inventory += filledSize
* On fail → pending -= size
* Duplicate intentId → skip

☑ This logic lives **only** in UnifiedEventConsumer
☑ Sinks do not invent orders

---

## PHASE D — SimulatedExecutionSink (FOCUSED)

### Input

* OrderIntent

### Behavior

1. Sample **latency**

   * e.g. `U(200ms, 1200ms)`
2. Sample **failure**

   * e.g. `p_fail = 1% + 2% * (spread / tickSize)`
3. If success:

   * sample fill size (full or partial)
   * write row to `simulated_trades`
4. Emit **FillEvent** back to UnifiedEventConsumer

```ts
type FillEvent = {
  intentId: string;
  conditionId: string;
  assetId: string;
  filledSize: number;
  price: number;
  fees: number;
  timestamp: number;
};
```

☑ This mirrors real exchange behavior
☑ This is where realism belongs

---

## PHASE E — MODE=test switch (TRIVIAL)

In orchestrator:

```ts
if (MODE === "test") {
  sink = SimulatedExecutionSink;
} else if (MODE === "live") {
  sink = LiveExecutionSink;
}
```

☑ Same pipeline
☑ Same sources
☑ Same strategy
☑ Only sink differs

---

## PHASE F — Reset hot state between runs (DO THIS ONCE)

On:

* backtest start
* test start

Reset:

* FeatureEngine
* positions
* pending
* lastIntentId

This guarantees:

* no phantom inventory
* sane comparisons

---

## PHASE G — Stop here

**Do NOT**:

* add cancels yet
* add replacement logic
* add regression
* add market rollover scheduling

You will already be able to:

* run live WS feeds
* see intents
* see simulated fills
* compute rolling PnL

---

## Final clarity check

You are **one abstraction away** from simulated live trading:

> **Signal → Intent → Simulated Fill → Position Update**

Everything else is noise until that loop exists.

If you want next, I can:

* write the **exact intent emission code block** for your UnifiedEventConsumer, or
* design the **SimulatedExecutionSink** with realistic latency/failure curves, or
* help you define **inventory caps + thresholds** that won’t blow up.

Say which one you want — and only one.

