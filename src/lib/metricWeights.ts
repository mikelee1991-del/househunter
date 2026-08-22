import type { MetricWeights } from "../types";

/** Relative importance of each Best-areas / location signal (any positive scale). */
export const DEFAULT_METRIC_WEIGHTS: MetricWeights = {
  drive: 22,
  noise: 12,
  safety: 13,
  walk: 14,
  ocean: 26,
  air: 7,
};

export const METRIC_WEIGHT_META: {
  id: keyof MetricWeights;
  label: string;
  hint: string;
}[] = [
  { id: "drive", label: "Commute / drive", hint: "Inside your place isochrones" },
  { id: "ocean", label: "Ocean / sunset", hint: "GIS viewshed openness" },
  { id: "walk", label: "Walkability", hint: "EPA-style walk index" },
  { id: "safety", label: "Safety", hint: "Neighborhood crime index" },
  { id: "noise", label: "Quiet", hint: "Away from LAX / freeways" },
  { id: "air", label: "Air quality", hint: "CalEnviroScreen burden" },
];

/** Normalize to fractions that sum to 1 (zeros allowed; all-zero → defaults). */
export function normalizeMetricWeights(raw: MetricWeights): MetricWeights {
  const keys = Object.keys(DEFAULT_METRIC_WEIGHTS) as (keyof MetricWeights)[];
  let sum = 0;
  const clipped: MetricWeights = { ...DEFAULT_METRIC_WEIGHTS };
  for (const k of keys) {
    const v = typeof raw[k] === "number" && Number.isFinite(raw[k]) ? raw[k] : 0;
    clipped[k] = Math.max(0, v);
    sum += clipped[k];
  }
  if (sum <= 0) return normalizeMetricWeights(DEFAULT_METRIC_WEIGHTS);
  const out = { ...clipped };
  for (const k of keys) out[k] = clipped[k] / sum;
  return out;
}

export function metricWeightPercent(
  weights: MetricWeights,
  id: keyof MetricWeights,
): number {
  const n = normalizeMetricWeights(weights);
  return Math.round(n[id] * 100);
}

export function mergeMetricWeights(raw: unknown): MetricWeights {
  const base = { ...DEFAULT_METRIC_WEIGHTS };
  if (!raw || typeof raw !== "object") return base;
  const rec = raw as Record<string, unknown>;
  for (const k of Object.keys(base) as (keyof MetricWeights)[]) {
    const v = rec[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      base[k] = Math.max(0, Math.min(100, v));
    }
  }
  return base;
}
