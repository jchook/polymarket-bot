import type { FeatureValues } from "./featureEngine";

export type BetaParams = number[];

export type DislocationSignal = {
  expectedProb: number;
  pmMid: number;
  deltaSPD: number;
  exchangeTs: number;
  ingestTs: number;
};

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

function buildFeatureVector(features: FeatureValues): number[] | null {
  if (
    features.x1 === undefined ||
    features.emaFast === undefined ||
    features.emaSlow === undefined ||
    features.vol === undefined
  ) {
    return null;
  }
  const x2 = features.emaFast - features.emaSlow;
  const x3 = features.vol;
  return [1, features.x1, x2, x3];
}

export function computeDislocation(
  features: FeatureValues,
  pmMid: number,
  beta: BetaParams,
  exchangeTs: number,
  ingestTs: number,
): DislocationSignal | null {
  if (!Number.isFinite(pmMid)) return null;
  const x = buildFeatureVector(features);
  if (!x) return null;

  const coef = new Array(x.length).fill(0);
  for (let i = 0; i < x.length && i < beta.length; i++) {
    coef[i] = beta[i];
  }
  let z = 0;
  for (let i = 0; i < x.length; i++) {
    const ci = coef[i];
    const xi = x[i];
    if (ci === undefined || xi === undefined) continue;
    z += ci * xi;
  }
  const expectedProb = sigmoid(z);
  const deltaSPD = expectedProb - pmMid;

  return { expectedProb, pmMid, deltaSPD, exchangeTs, ingestTs };
}
