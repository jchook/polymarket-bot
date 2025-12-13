import type { IntentSink, PipelineContext } from "../pipeline/intentSink";
import { handleUnifiedEvent } from "../pipeline/unifiedEventConsumer";
import { sortEvents } from "./sorter";
import type { ReplayEvent } from "./types";

// Invariant: Replay uses the same unified consumer as live. No branching or special handling allowed.
export async function replayEvents(
  events: ReplayEvent[],
  sink: IntentSink,
  ctx: PipelineContext = { mode: "backtest" },
) {
  // Stabilize arrivalOrdinal if not provided to make ordering deterministic.
  const withOrdinal = events.map((ev, idx) => ({
    ...ev,
    arrivalOrdinal: ev.arrivalOrdinal ?? idx,
  }));

  const ordered = sortEvents(withOrdinal);
  let lastExchangeTs = -Infinity;
  for (const ev of ordered) {
    if (ev.exchangeTs < lastExchangeTs) {
      throw new Error(
        `Non-monotonic exchangeTs detected: ${ev.exchangeTs} after ${lastExchangeTs}`,
      );
    }
    lastExchangeTs = ev.exchangeTs;
    await handleUnifiedEvent(ev, sink, ctx);
  }
}
