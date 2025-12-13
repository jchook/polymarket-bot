// Canonical replay envelope; exchangeTs is the ordering key. recvTs is observability only.
import type { UnifiedEvent } from "../pipeline/unifiedEventConsumer";

export type ReplayEvent = UnifiedEvent & {
  arrivalOrdinal?: number;
};

export const KIND_PRIORITY: Record<ReplayEvent["kind"], number> = {
  pmBook: 0,
  spot: 1,
};
