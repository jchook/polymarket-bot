import { randomUUID } from "node:crypto";
import type { IntentSink, PipelineContext } from "./intentSink";
import type { PipelineOutput } from "./unifiedEventConsumer";
import { db, simulatedTrades } from "../db";

export type SimParams = {
  latencyMinMs: number;
  latencyMaxMs: number;
  failProb: number;
  feeBps: number;
};

const DEFAULT_SIM_PARAMS: SimParams = {
  latencyMinMs: 200,
  latencyMaxMs: 1200,
  failProb: 0.01,
  feeBps: 0,
};

export class SimulatedExecutionSink implements IntentSink {
  private runId: string;
  private params: SimParams;
  private entries: Array<{
    conditionId: string;
    assetId: string;
    price: number;
    size: number;
    side: "BUY" | "SELL";
    timestamp: number;
    latencyMs: number;
    failed: boolean;
  }> = [];

  constructor(runId?: string, params: Partial<SimParams> = {}) {
    this.runId = runId ?? randomUUID();
    this.params = { ...DEFAULT_SIM_PARAMS, ...params };
  }

  handle(output: PipelineOutput, ctx: PipelineContext) {
    // Placeholder: if/when intents are emitted, map them here.
    // Currently only dislocation signals are emitted; no order intents yet.
    // We record nothing until an intent exists.
    void ctx;
    void output;
  }

  recordFill(args: {
    conditionId: string;
    assetId: string;
    side: "BUY" | "SELL";
    price: number;
    size: number;
    timestamp: number;
  }) {
    const latency =
      this.params.latencyMinMs +
      Math.random() * (this.params.latencyMaxMs - this.params.latencyMinMs);
    const failed = Math.random() < this.params.failProb;
    this.entries.push({
      ...args,
      price: args.price * (1 - this.params.feeBps / 10_000),
      latencyMs: latency,
      failed,
    });
  }

  async flushToDb() {
    if (this.entries.length === 0) return;
    const rows = this.entries.map((e) => ({
      runId: this.runId,
      conditionId: e.conditionId,
      assetId: e.assetId,
      side: e.side,
      price: e.price.toString(),
      size: e.size.toString(),
      fees: null,
      slippage: null,
      timestamp: new Date(e.timestamp),
      metadata: { latencyMs: e.latencyMs, failed: e.failed },
    }));
    await db.insert(simulatedTrades).values(rows);
    this.entries = [];
  }
}
