// Deterministic ordering for replay: sort by exchangeTs ascending, then fixed priority:
// pmBook before spot when timestamps are equal, then arrivalOrdinal to stabilize file/chunk ordering.
import { KIND_PRIORITY, type ReplayEvent } from "./types";

export function sortEvents(events: ReplayEvent[]): ReplayEvent[] {
  return [...events].sort((a, b) => {
    if (a.exchangeTs !== b.exchangeTs) return a.exchangeTs - b.exchangeTs;
    const pa = KIND_PRIORITY[a.kind] ?? 99;
    const pb = KIND_PRIORITY[b.kind] ?? 99;
    if (pa !== pb) return pa - pb;
    const oa = a.arrivalOrdinal ?? 0;
    const ob = b.arrivalOrdinal ?? 0;
    return oa - ob;
  });
}
