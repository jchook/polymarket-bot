import { db } from "../db";
import { dislocationSignals } from "../db/schema";
import type { DislocationSignal } from "../features/dislocation";
import type { TraderState } from "../health/stateMachine";

export async function persistSignals(
  runId: string,
  entries: Array<{
    signal: DislocationSignal;
    state: TraderState;
    ctx: PipelineContext;
    dtMs?: number;
    orderingCollision?: boolean;
  }>,
) {
  if (entries.length === 0) return;
  const rows = entries.map(
    ({ signal, state, ctx, dtMs, orderingCollision }) => ({
      runId,
      conditionId: ctx.conditionId ?? "unknown",
      assetId: ctx.assetId ?? "unknown",
      exchangeTs: new Date(signal.exchangeTs),
      ingestTs: new Date(signal.ingestTs),
      dtMs: dtMs ?? null,
      pmMid: signal.pmMid?.toString() ?? null,
      expectedProb: signal.expectedProb?.toString() ?? null,
      deltaSpd: signal.deltaSPD?.toString() ?? null,
      state,
      featuresVersion: ctx.featuresVersion ?? null,
      betaVersion: ctx.betaVersion ?? null,
      orderingCollision: orderingCollision ?? false,
      raw: signal,
    }),
  );

  await db
    .insert(dislocationSignals)
    .values(rows)
    .catch((err) => {
      console.error("Failed to persist dislocation signals", err);
    });
}
import type { PipelineContext } from "./intentSink";
