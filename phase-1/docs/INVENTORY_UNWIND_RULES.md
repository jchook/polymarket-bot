# Inventory unwind rule: when to emit opposite-side MM trades

You want an exit / unwind mechanism that:

* doesn’t require predicting resolution,
* realizes profits from mean reversion/spread,
* prevents inventory from drifting to the cap,
* avoids “thrash” (rapid buy/sell oscillation),
* works with your **pending** and **failure/latency** model.

There are two unwind styles. Start with **A**, then add **B** if needed.

---

## A) Quote-to-unwind rule (micro-MM, conservative and robust)

### Key idea

If you are holding inventory, you place **passive** orders on the opposite side at a price that:

* captures at least `minEdge` (ticks)
* uses current top-of-book, not mid
* obeys caps and avoids duplicates
* respects a cooldown so you don’t spam

### Definitions

Per (conditionId, assetId), at PM tick time ( t ):

* `I = inventory` (signed)
* `P = pending` (signed)
* `E = I + P` (effective exposure)
* `bestBid`, `bestAsk`
* `spread = bestAsk - bestBid`
* `tickSize` (from `marketMetadata`)
* `minEdgeTicks` (env param, e.g. 1–2)
* `unwindStartFrac` (start unwinding when |E| exceeds fraction of cap, e.g. 0.5)
* `unwindAggressiveFrac` (more aggressive when |E| exceeds, e.g. 0.8)
* `cooldownMs` (e.g. 250–1000ms per asset)

### Rule

Trigger unwind eligibility when:

[
|E| \ge C \cdot \text{unwindStartFrac}
]

Then:

* If `E > 0` (net long), emit a **SELL** intent (reduce long)
* If `E < 0` (net short), emit a **BUY** intent (reduce short)

### Price selection (passive)

Let `edge = minEdgeTicks * tickSize`.

If reducing a long (SELL):

* target price = `max(bestAsk, bestBid + edge)`
  (ensures you’re not dumping at the bid unless the book is tight)

If reducing a short (BUY):

* target price = `min(bestBid, bestAsk - edge)`
  (ensures you’re not paying the ask unless tight)

Then tick-round:

* SELL price → round **up** to nearest tick
* BUY price → round **down** to nearest tick

### Size selection

Let base unwind size be:

[
S = \min(\text{orderSize}, |E|)
]

If `|E| >= C * unwindAggressiveFrac`, increase size:

[
S = \min(\text{orderSize} \cdot 2, |E|)
]

(Keep it simple; don’t pyramid early.)

### Emit conditions (anti-thrash)

Emit only if:

* cooldown satisfied (`now - lastUnwindEmitTs >= cooldownMs`)
* not duplicate intentKey
* projected exposure doesn’t cross past 0 (avoid flipping):

  * if SELL unwind: ensure `E - S >= 0`
  * if BUY unwind: ensure `E + S <= 0`

This prevents “unwind overshoot”.

---

## B) Δ-based unwind rule (smarter, optional)

This adds: only unwind if the dislocation no longer supports your position.

Let ( \Delta ) be Δ_SPD.

* If you are long (E>0) and ( \Delta \le \delta_{\text{exit}} ) → unwind
* If you are short (E<0) and ( \Delta \ge -\delta_{\text{exit}} ) → unwind

Where `δ_exit` < `δ_enter` (hysteresis).

This reduces churn and aligns unwind with “signal mean reversion”.

You can combine A + B:

* **A controls risk** (caps)
* **B improves PnL** (don’t exit too early)

MVP: implement **A only** and add B later.

---

# TypeScript: `maybeEmitUnwindIntent(...)`

This is a sibling to `maybeEmitIntent` and should be called in `handlePmBook` **after** entry intent logic. Entry has priority.

Assumptions:

* You’ve got `tickSize` accessible (lookup `marketMetadata` in hot state cache or DB cache).
* You store `lastUnwindIntentKey` and `lastUnwindTs` per position (or in a map).

```ts
type UnwindConfig = {
  inventoryCap: number;
  orderSize: number;
  tickSize: number;
  minEdgeTicks: number;        // 1 or 2
  unwindStartFrac: number;     // 0.5
  unwindAggressiveFrac: number;// 0.8
  cooldownMs: number;          // 500
};

function roundDownToTick(price: number, tick: number) {
  return Math.floor(price / tick) * tick;
}
function roundUpToTick(price: number, tick: number) {
  return Math.ceil(price / tick) * tick;
}

type Position2 = Position & {
  lastUnwindIntentId?: string;
  lastUnwindTs?: number;
};

function maybeEmitUnwindIntent(
  event: PmBookEvent,
  pos: Position2,
  cfg: UnwindConfig,
  ctx: PipelineContext,
): OrderIntent | null {
  if (currentState !== "RUNNING") return null;
  if (!event.conditionId) return null;
  if (event.bestBid == null || event.bestAsk == null) return null;

  const E = pos.inventory + pos.pending;
  const absE = Math.abs(E);

  if (absE < cfg.inventoryCap * cfg.unwindStartFrac) return null;

  const now = event.exchangeTs;
  if (pos.lastUnwindTs && now - pos.lastUnwindTs < cfg.cooldownMs) return null;

  // Determine unwind direction (opposite side)
  const side: "BUY" | "SELL" = E > 0 ? "SELL" : "BUY";

  // Choose size without flipping past zero
  let size = Math.min(cfg.orderSize, absE);
  if (absE >= cfg.inventoryCap * cfg.unwindAggressiveFrac) {
    size = Math.min(cfg.orderSize * 2, absE);
  }
  // Prevent overshoot across zero:
  if (side === "SELL" && E - size < 0) size = E;         // E positive here
  if (side === "BUY" && E + size > 0) size = -E;         // E negative here, so -E positive
  if (size <= 0) return null;

  const edge = cfg.minEdgeTicks * cfg.tickSize;

  // Passive pricing that aims to collect at least `edge`
  let price: number;
  if (side === "SELL") {
    // sell to reduce long
    price = Math.max(event.bestAsk, event.bestBid + edge);
    price = roundUpToTick(price, cfg.tickSize);
  } else {
    // buy to reduce short
    price = Math.min(event.bestBid, event.bestAsk - edge);
    price = roundDownToTick(price, cfg.tickSize);
  }

  const intentKey = [
    event.conditionId,
    event.assetId,
    "UNWIND",
    side,
    price.toFixed(6),
    size.toFixed(6),
  ].join("|");

  // dedupe while there is still pending unwind exposure
  if (pos.pending !== 0 && pos.lastUnwindIntentId === intentKey) return null;

  const intent: OrderIntent = {
    intentId: intentKey,
    runId,
    conditionId: event.conditionId,
    assetId: event.assetId,
    side,
    price,
    size,
    createdTs: now,
    reason: "MM_REBALANCE",
  };

  pos.lastUnwindIntentId = intentKey;
  pos.lastUnwindTs = now;
  // reserve pending in same signed convention
  pos.pending += side === "BUY" ? size : -size;

  return intent;
}
```

### How to integrate cleanly

In `handlePmBook`:

1. compute `dislocation`
2. try `entryIntent = maybeEmitIntent(...)`
3. if entryIntent emitted → return it (don’t unwind in same tick)
4. else → try `unwindIntent = maybeEmitUnwindIntent(...)`

This keeps behavior stable.

---

# Practical defaults to start with (reasonable MVP)

* `INTENT_DELTA_THRESHOLD` (δ_enter): **0.006**
* `UNWIND_START_FRAC`: **0.5**
* `UNWIND_AGGRESSIVE_FRAC`: **0.8**
* `UNWIND_MIN_EDGE_TICKS`: **1**
* `UNWIND_COOLDOWN_MS`: **500**
* `ORDER_SIZE`: keep small (1–5 shares) until you validate fill realism

---

# One important note about UP/DOWN pairing

Right now you’re emitting intents per `assetId`. For these markets, you typically have two assets (UP and DOWN). For unwind you should:

* unwind **the same asset** you’re holding exposure in (most direct)
* later: consider *pair-aware unwind* (use the complementary asset to reduce delta exposure when one side is illiquid)

MVP: single-asset unwind as above.

