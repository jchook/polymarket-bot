type Sample = { ts: number; value: number };

export class RollingEMA {
  private alpha: number;
  private current: number | null = null;

  constructor(halfLifeMs: number, intervalMs: number) {
    // alpha derived from half-life, assuming roughly regular interval
    const lambda = Math.log(2) / halfLifeMs;
    this.alpha = 1 - Math.exp(-lambda * intervalMs);
  }

  update(value: number): number {
    if (this.current === null) {
      this.current = value;
    } else {
      this.current = this.alpha * value + (1 - this.alpha) * this.current;
    }
    return this.current;
  }

  get(): number | null {
    return this.current;
  }
}

export class RollingWindowAnchor {
  private readonly windowMs: number;
  private readonly samples: Sample[] = [];

  constructor(windowMs: number) {
    this.windowMs = windowMs;
  }

  update(value: number, ts: number): number | null {
    this.samples.push({ value, ts });
    this.prune(ts);
    const anchor = this.samples[0];
    return anchor ? anchor.value : null;
  }

  private prune(now: number) {
    const cutoff = now - this.windowMs;
    while (this.samples.length > 0) {
      const head = this.samples[0];
      if (head && head.ts < cutoff) {
        this.samples.shift();
      } else {
        break;
      }
    }
  }
}

export class RollingWindowStd {
  private readonly windowMs: number;
  private readonly samples: Sample[] = [];

  constructor(windowMs: number) {
    this.windowMs = windowMs;
  }

  update(value: number, ts: number): number {
    this.samples.push({ value, ts });
    this.prune(ts);
    return this.computeStd();
  }

  private prune(now: number) {
    const cutoff = now - this.windowMs;
    while (this.samples.length > 0) {
      const head = this.samples[0];
      if (head && head.ts < cutoff) {
        this.samples.shift();
      } else {
        break;
      }
    }
  }

  private computeStd(): number {
    const n = this.samples.length;
    if (n === 0) return 0;
    const total = this.samples.reduce((acc, s) => acc + s.value, 0);
    const mean = total / n;
    const variance =
      this.samples.reduce((acc, s) => acc + (s.value - mean) ** 2, 0) / n;
    return Math.sqrt(variance);
  }
}
