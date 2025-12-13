### Math for emitting order intents

Assume you have, at time (t) for a given `(conditionId, assetId)`:

* PM best bid/ask: (bb_t, ba_t)
* PM mid: (m_t = \frac{bb_t + ba_t}{2})
* PM spread: (\text{spr}_t = ba_t - bb_t)
* Spot features (x_t = [1, x1_t, x2_t, x3_t, \dots])
* Strategy coefficients (\beta) (optional; if not fit yet, use (\beta=0) ⇒ (p^{exp}_t=0.5))

**Expected probability (UP fair value):**
[
z_t = \beta^\top x_t
]
[
p^{exp}_t = \sigma(z_t)=\frac{1}{1+e^{-z_t}}
]

**Dislocation (your Δ_SPD):**
[
\Delta_t = p^{exp}_t - m_t
]

Interpretation:

* (\Delta_t > 0): UP is underpriced ⇒ desire to **BUY** (or suppress sells)
* (\Delta_t < 0): UP is overpriced ⇒ desire to **SELL** (or buy DOWN, depending on which asset you’re computing against)

---

#### A. Convert Δ into an intent direction

Define entry/exit thresholds (in probability points, i.e. dollars in ([0,1])):

* (\delta_{\text{enter}} > 0)
* (\delta_{\text{exit}} \in (0, \delta_{\text{enter}}))

State machine per `(conditionId, assetId)`:

* If **flat/neutral** and (\Delta_t \ge \delta_{\text{enter}}) ⇒ enter **LONG** intent (BUY)
* If **flat/neutral** and (\Delta_t \le -\delta_{\text{enter}}) ⇒ enter **SHORT** intent (SELL)
* If **long** and (\Delta_t \le \delta_{\text{exit}}) ⇒ exit long (SELL to flatten)
* If **short** and (\Delta_t \ge -\delta_{\text{exit}}) ⇒ exit short (BUY to flatten)

This hysteresis prevents “chatter” when Δ hovers near zero.

---

#### B. Choose limit price (micro-MM / conservative)

Let tick size be ( \tau ) (from `marketMetadata.tickSize`).

Conservative “crossing-only” (fills only when crossed later):

* BUY intent price: (p^{buy}_t = bb_t)
* SELL intent price: (p^{sell}_t = ba_t)

More aggressive (inside-spread) if spread allows:

* If (\text{spr}_t \ge 2\tau):

  * (p^{buy}_t = bb_t + \tau)
  * (p^{sell}_t = ba_t - \tau)
    Else fall back to top-of-book.

This produces realistic “maker-ish” intents without assuming free fills.

---

#### C. Size (inventory-aware)

Let:

* `inv_t` = current filled inventory (shares)
* `pend_t` = pending (reserved by prior intents)
* `cap` = inventory cap (shares)
* `base` = base order size (shares)

Available capacity:
[
c_t = \max(0, cap - (inv_t + pend_t))
]

Size rule (simple):
[
s_t = \min(base,; c_t)
]

Size rule (scale with dislocation):
[
s_t = \min\left(c_t,; base \cdot \text{clip}\left(\frac{|\Delta_t|}{\delta_{\text{enter}}},; 1,; s_{\max}\right)\right)
]
Where (s_{\max}) is a multiplier cap (e.g. 3–5×).

If (s_t = 0), emit no intent.

---

#### D. Fees/slippage placeholders (for sim only)

For Polymarket CLOB you’ll model:

* fee rate (f) (if applicable)
* slippage from execution model

But for intent emission math you only need the side/price/size.

---

### Avoiding duplicate order intents (exact rule)

You need two layers: **idempotency** and **hysteresis / cooldown**.

#### 1) Idempotency key (exact construction)

Define an **intent epoch** (E_t) that changes only when it should be “meaningfully new”. Minimal:

[
E_t = \left\lfloor \frac{\text{exchangeTs}_t}{W} \right\rfloor
]
Where (W) is a cooldown window, e.g. 500–1500 ms.

Then define:

[
\text{intentId} = \text{hash}(
conditionId ;|; assetId ;|; side ;|; price ;|; size ;|; E_t
)
]

Dedup rule:

* Maintain `lastIntentId` per `(conditionId, assetId)` in hot state.
* If new `intentId == lastIntentId` **and** the previous intent is still pending (or not expired), **skip emission**.

This prevents “same order spam” when multiple PM price_change events arrive inside a short interval.

#### 2) Hysteresis prevents oscillation spam

Without hysteresis, Δ will jitter around the threshold and you’ll emit alternating intents.

Use:

* enter threshold (\delta_{\text{enter}})
* exit threshold (\delta_{\text{exit}})

and keep a per-asset “position mode” (NEUTRAL/LONG/SHORT). You only emit when you *transition* modes.

That alone kills most duplication.

#### 3) Cooldown + replacement rule (minimal)

Cooldown:

* Do not emit more than one intent per `(conditionId, assetId)` per `W` ms unless it is an **exit**.

Replacement (optional, but still minimal):

* If you emit a new intent with different price/size/side while an older one is pending:

  * mark older intent as “superseded” in state
  * in simulated sink: treat superseded as canceled (or expire it)
  * in live sink later: this becomes cancel/replace

For MVP: you can simply *skip* replacements and wait for pending to clear.

---

### Putting it together: intent emission gate (math → boolean)

For each `(conditionId, assetId)` event at time (t):

1. Compute (m_t, \Delta_t)
2. Determine desired mode transition using hysteresis
3. Compute side, price (p_t), size (s_t)
4. Gate:

   * (state = RUNNING)
   * (s_t > 0)
   * idempotency not duplicated
   * pending/inventory caps satisfied
5. Emit `OrderIntent`

That’s the exact math and the exact dedupe mechanics.

If you want, I can translate this into a single `emitIntentIfNeeded(...)` TypeScript function that plugs into your UnifiedEventConsumer and uses your `marketMetadata` tickSize/minOrderSize + your hotState inventory/pending.

