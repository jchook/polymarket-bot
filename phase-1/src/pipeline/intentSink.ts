import type { DislocationSignal } from "../features/dislocation";
import { persistSignals } from "./signalPersistence";
import type { PipelineOutput } from "./unifiedEventConsumer";

export type PipelineContext = {
  mode: "live" | "backtest" | "collect";
  featuresVersion?: string;
  betaVersion?: string;
  conditionId?: string;
  assetId?: string;
};

export interface IntentSink {
  handle(output: PipelineOutput, ctx: PipelineContext): Promise<void> | void;
}

export class LiveIntentSink implements IntentSink {
  handle(output: PipelineOutput, ctx: PipelineContext) {
    // Placeholder: log only. Execution wiring comes later.
    if (output.dislocation) {
      console.log("live_dislocation", { ctx, dislocation: output.dislocation });
    }
  }
}

export class BacktestIntentSink implements IntentSink {
  private entries: Array<{
    signal: DislocationSignal;
    state: PipelineOutput["state"];
    ctx: PipelineContext;
    orderingCollision?: boolean;
    dtMs?: number;
  }> = [];
  private states: Set<string> = new Set();
  private runId: string;

  constructor(runId: string) {
    this.runId = runId;
  }

  handle(output: PipelineOutput, ctx: PipelineContext) {
    // Persist signals even if intent is null.
    if (output.dislocation) {
      this.entries.push({
        signal: output.dislocation,
        state: output.state,
        ctx,
        orderingCollision: output.orderingCollision,
        dtMs: output.dtMs ?? undefined,
      });
    }
    // Intent handling will evolve to simulated fills later.
    this.states.add(output.state);
  }

  getSignals(): DislocationSignal[] {
    return this.entries.map((e) => e.signal);
  }

  getStates(): Set<string> {
    return this.states;
  }

  getEntries() {
    return this.entries;
  }

  async flushToDb() {
    if (this.entries.length === 0) return;
    await persistSignals(this.runId, this.entries);
  }
}

export class CollectIntentSink implements IntentSink {
  private entries: Array<{
    signal: DislocationSignal;
    state: PipelineOutput["state"];
    ctx: PipelineContext;
    dtMs?: number;
    orderingCollision?: boolean;
  }> = [];
  private runId: string;

  constructor(runId: string) {
    this.runId = runId;
  }

  handle(output: PipelineOutput, ctx: PipelineContext) {
    if (output.dislocation) {
      this.entries.push({
        signal: output.dislocation,
        state: output.state,
        ctx,
        orderingCollision: output.orderingCollision,
        dtMs: output.dtMs ?? undefined,
      });
    }
  }

  async flushToDb() {
    if (this.entries.length === 0) return;
    await persistSignals(this.runId, this.entries);
    this.entries = [];
  }
}
