import { airQualityColor } from "./airQuality";

/** Map toolbar: view one scoring metric at a time. */
export type MapMetricLayer =
  | "off"
  | "safety"
  | "air"
  | "walk"
  | "ocean"
  | "sunset"
  | "condition"
  | "noise"
  | "suitability";

export const MAP_METRIC_OPTIONS: { id: MapMetricLayer; label: string }[] = [
  { id: "off", label: "Off" },
  { id: "safety", label: "Safety" },
  { id: "air", label: "Air quality" },
  { id: "walk", label: "Walkability" },
  { id: "ocean", label: "Ocean view" },
  { id: "sunset", label: "Sunset view" },
  { id: "condition", label: "Condition" },
  { id: "noise", label: "Quiet (noise)" },
  { id: "suitability", label: "Best areas" },
];

/** Quieter → higher. 40 CNEL ≈ 100, 80 CNEL ≈ 0. */
export function quietScoreFromCnel(cnel: number): number {
  return Math.max(0, Math.min(100, ((80 - cnel) / 40) * 100));
}

/** Shared green→amber→red scale for 0–100 metric scores on the map. */
export function metricScoreColor(score: number | null | undefined): string {
  return airQualityColor(score);
}

export function metricLayerTitle(layer: MapMetricLayer): string {
  return MAP_METRIC_OPTIONS.find((o) => o.id === layer)?.label ?? "Metric";
}
