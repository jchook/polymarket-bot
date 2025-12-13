// Invariant: Trader state machine is shared between live and replay; no other state gating paths exist.
export type TraderState = "STARTING" | "WARMING" | "RUNNING" | "DEGRADED";

export const INITIAL_STATE: TraderState = "STARTING";

export type HealthSnapshot = {
  exchangeTs: number;
  ingestTs: number;
  latencyMs: number;
  spotAgeMs?: number;
  pmAgeMs?: number;
  featuresReady: boolean;
  dataFresh: boolean;
  spotFresh: boolean;
  pmFresh: boolean;
  latencyOk: boolean;
};

const MAX_LATENCY_MS = Number(process.env.HEALTH_MAX_LATENCY_MS ?? 1_500);
const MAX_STALE_MS = Number(process.env.HEALTH_MAX_STALE_MS ?? 5_000);

export function makeHealthSnapshot(args: {
  exchangeTs: number;
  ingestTs: number;
  spotAgeMs?: number;
  pmAgeMs?: number;
  featuresReady: boolean;
}): HealthSnapshot {
  const latencyMs = Math.max(0, args.ingestTs - args.exchangeTs);
  const spotFresh =
    args.spotAgeMs === undefined || args.spotAgeMs <= MAX_STALE_MS;
  const pmFresh = args.pmAgeMs === undefined || args.pmAgeMs <= MAX_STALE_MS;
  const latencyOk = latencyMs <= MAX_LATENCY_MS;

  return {
    exchangeTs: args.exchangeTs,
    ingestTs: args.ingestTs,
    latencyMs,
    spotAgeMs: args.spotAgeMs,
    pmAgeMs: args.pmAgeMs,
    featuresReady: args.featuresReady,
    dataFresh: spotFresh && pmFresh && latencyOk,
    spotFresh,
    pmFresh,
    latencyOk,
  };
}

export function nextState(
  prev: TraderState,
  health: HealthSnapshot,
): TraderState {
  const healthOk = health.dataFresh && health.featuresReady;

  switch (prev) {
    case "STARTING":
      return healthOk ? "WARMING" : "STARTING";
    case "WARMING":
      return healthOk ? "RUNNING" : "STARTING";
    case "RUNNING":
      return healthOk ? "RUNNING" : "DEGRADED";
    case "DEGRADED":
      return healthOk ? "RUNNING" : "DEGRADED";
    default:
      return "STARTING";
  }
}
