// Invariant: FeatureEngine must only be called through the unified consumer for live and replay.
import { RollingEMA, RollingWindowAnchor, RollingWindowStd } from "./rolling";

export type FeatureConfig = {
  anchorWindowMs: number;
  emaFastHalfLifeMs: number;
  emaSlowHalfLifeMs: number;
  volWindowMs: number;
  expectedIntervalMs: number;
};

export type FeatureValues = {
  x1?: number; // ln(S_t / S_anchor)
  emaFast?: number;
  emaSlow?: number;
  vol?: number;
  spot?: number;
  ts: number;
};

export class FeatureEngine {
  private anchor: RollingWindowAnchor;
  private emaFast: RollingEMA;
  private emaSlow: RollingEMA;
  private vol: RollingWindowStd;
  private latest: FeatureValues | null = null;

  constructor(private readonly config: FeatureConfig) {
    this.anchor = new RollingWindowAnchor(config.anchorWindowMs);
    this.emaFast = new RollingEMA(
      config.emaFastHalfLifeMs,
      config.expectedIntervalMs,
    );
    this.emaSlow = new RollingEMA(
      config.emaSlowHalfLifeMs,
      config.expectedIntervalMs,
    );
    this.vol = new RollingWindowStd(config.volWindowMs);
  }

  update(spot: number, exchangeTs: number): FeatureValues {
    const anchor = this.anchor.update(spot, exchangeTs);
    const emaFast = this.emaFast.update(spot);
    const emaSlow = this.emaSlow.update(spot);
    const vol = this.vol.update(Math.log(spot), exchangeTs);

    const x1 = anchor ? Math.log(spot / anchor) : undefined;

    this.latest = {
      x1,
      emaFast,
      emaSlow,
      vol,
      spot,
      ts: exchangeTs,
    };

    return this.latest;
  }

  getLatest(): FeatureValues | null {
    return this.latest;
  }
}
