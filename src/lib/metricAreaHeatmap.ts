/**
 * Continuous area metric washes (any location in the region — on-sale or not).
 * Optionally hard-clips to the union of drive-time isochrones.
 */
import { estimateNoiseCnel } from "../data/ambientNoise";
import type { SafetyTractsFile } from "../data/safetyTiers";
import type { AirQualityTractsFile } from "../hooks/useAirQualityTracts";
import type { Anchor, Listing } from "../types";
import { haversineKm } from "./geo";
import {
  pointInAnyIsochrone,
  type IsochroneMap,
} from "./isochrone";
import { quietScoreFromCnel, type MapMetricLayer } from "./mapMetrics";
import { scoreRgba, type RgbaFn } from "./addressHeatmap";
import {
  buildHeatmapBase,
  oceanProxyAt,
  oceanSamplesFromListings,
  oceanViewshedRgba,
  SUITABILITY_BOUNDS,
  type HeatmapCellBase,
  type SuitabilityRaster,
} from "./suitabilityHeatmap";
import { walkIndexRgba } from "./walkHeatmap";

const AREA_COLS = 200;
const AREA_ROWS = 150;

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function paintCells(
  cells: HeatmapCellBase[],
  scoreOf: (c: HeatmapCellBase) => number,
  rgba: RgbaFn,
  anchors: Anchor[],
  isochrones: IsochroneMap | undefined,
  cols: number,
  rows: number,
): SuitabilityRaster {
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext("2d");
  const empty = (): SuitabilityRaster => ({
    url: "",
    bounds: [
      [SUITABILITY_BOUNDS.south, SUITABILITY_BOUNDS.west],
      [SUITABILITY_BOUNDS.north, SUITABILITY_BOUNDS.east],
    ],
    cols,
    rows,
    peakMean: 0,
  });
  if (!ctx) return empty();

  const clip =
    isochrones &&
    anchors.some((a) => !!isochrones[a.id])
      ? (lat: number, lng: number) =>
          pointInAnyIsochrone(lat, lng, anchors, isochrones!)
      : null;

  const img = ctx.createImageData(cols, rows);
  let peakSum = 0;
  let peakN = 0;

  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    const px = i * 4;
    if (clip && !clip(c.lat, c.lng)) {
      img.data[px + 3] = 0;
      continue;
    }
    const score = clamp(scoreOf(c), 0, 100);
    if (score >= 55) {
      peakSum += score;
      peakN += 1;
    }
    const [r, g, b, a] = rgba(score);
    img.data[px] = r;
    img.data[px + 1] = g;
    img.data[px + 2] = b;
    img.data[px + 3] = a;
  }

  ctx.putImageData(img, 0, 0);
  return {
    url: canvas.toDataURL("image/png"),
    bounds: [
      [SUITABILITY_BOUNDS.south, SUITABILITY_BOUNDS.west],
      [SUITABILITY_BOUNDS.north, SUITABILITY_BOUNDS.east],
    ],
    cols,
    rows,
    peakMean: peakN ? peakSum / peakN : 0,
  };
}

/** Quiet score 0–100 → rgba (reuse score greens; louder = lower score). */
function quietRgba(score: number): [number, number, number, number] {
  return scoreRgba(score);
}

/**
 * IDW condition surface from listing text scores — best available area model
 * when no tract condition layer exists.
 */
function conditionScoreAt(
  lat: number,
  lng: number,
  samples: { lat: number; lng: number; score: number }[],
): number {
  if (!samples.length) return 55;
  let wSum = 0;
  let vSum = 0;
  let nearest = Infinity;
  let nearestScore = 55;
  for (const s of samples) {
    const d = haversineKm(lat, lng, s.lat, s.lng);
    if (d < nearest) {
      nearest = d;
      nearestScore = s.score;
    }
    if (d > 2.5) continue;
    const w = 1 / (d * d + 0.04);
    wSum += w;
    vSum += w * s.score;
  }
  if (wSum > 0) {
    const idw = vSum / wSum;
    const t = clamp(1 - nearest / 1.8, 0, 1);
    return nearestScore * t + idw * (1 - t);
  }
  return nearestScore;
}

export type AreaMetricId = Exclude<MapMetricLayer, "off" | "suitability">;

/**
 * Paint a continuous South Bay wash for a metric. When isochrones are ready,
 * pixels outside the union of any drive-time polygon are transparent.
 */
export function paintAreaMetricHeatmap(
  metric: AreaMetricId,
  listings: Listing[],
  anchors: Anchor[],
  safetyTracts: SafetyTractsFile | null,
  airTracts: AirQualityTractsFile | null,
  isochrones: IsochroneMap | undefined,
): SuitabilityRaster {
  const cells = buildHeatmapBase(
    listings,
    safetyTracts,
    anchors,
    airTracts,
    AREA_COLS,
    AREA_ROWS,
  );

  if (metric === "safety") {
    return paintCells(
      cells,
      (c) => c.safetyScore,
      scoreRgba,
      anchors,
      isochrones,
      AREA_COLS,
      AREA_ROWS,
    );
  }

  if (metric === "air") {
    return paintCells(
      cells,
      (c) => c.airQualityScore,
      scoreRgba,
      anchors,
      isochrones,
      AREA_COLS,
      AREA_ROWS,
    );
  }

  if (metric === "walk") {
    return paintCells(
      cells,
      (c) => clamp((c.walkIndex / 20) * 100, 0, 100),
      (score) => walkIndexRgba((score / 100) * 19 + 1),
      anchors,
      isochrones,
      AREA_COLS,
      AREA_ROWS,
    );
  }

  if (metric === "noise") {
    // Recompute quiet score from continuous noise model (already in cells)
    return paintCells(
      cells,
      (c) => quietScoreFromCnel(c.noiseCnel),
      quietRgba,
      anchors,
      isochrones,
      AREA_COLS,
      AREA_ROWS,
    );
  }

  if (metric === "ocean") {
    const oceanSamples = oceanSamplesFromListings(listings);
    return paintCells(
      cells,
      (c) => oceanProxyAt(c.lat, c.lng, oceanSamples),
      (score) => {
        const [r, g, b] = oceanViewshedRgba(score);
        // Stronger area wash alpha than listing dots
        const a = Math.round(110 + clamp(score / 100, 0, 1) * 100);
        return [r, g, b, a];
      },
      anchors,
      isochrones,
      AREA_COLS,
      AREA_ROWS,
    );
  }

  // condition — IDW from listing condition scores
  const condSamples: { lat: number; lng: number; score: number }[] = [];
  for (const l of listings) {
    const s = l.analysis?.condition?.score100;
    if (typeof s === "number") {
      condSamples.push({ lat: l.lat, lng: l.lng, score: s });
    }
  }
  return paintCells(
    cells,
    (c) => conditionScoreAt(c.lat, c.lng, condSamples),
    scoreRgba,
    anchors,
    isochrones,
    AREA_COLS,
    AREA_ROWS,
  );
}

/** Convenience: continuous quiet wash using ambient model only (no base cells). */
export function paintNoiseAreaDirect(
  anchors: Anchor[],
  isochrones: IsochroneMap | undefined,
  cols = AREA_COLS,
  rows = AREA_ROWS,
): SuitabilityRaster {
  const { south, west, north, east } = SUITABILITY_BOUNDS;
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return {
      url: "",
      bounds: [
        [south, west],
        [north, east],
      ],
      cols,
      rows,
      peakMean: 0,
    };
  }
  const clip =
    isochrones && anchors.some((a) => !!isochrones[a.id])
      ? (lat: number, lng: number) =>
          pointInAnyIsochrone(lat, lng, anchors, isochrones!)
      : null;
  const img = ctx.createImageData(cols, rows);
  for (let row = 0; row < rows; row++) {
    const lat = north - ((row + 0.5) / rows) * (north - south);
    for (let col = 0; col < cols; col++) {
      const lng = west + ((col + 0.5) / cols) * (east - west);
      const px = (row * cols + col) * 4;
      if (clip && !clip(lat, lng)) {
        img.data[px + 3] = 0;
        continue;
      }
      const quiet = quietScoreFromCnel(estimateNoiseCnel(lat, lng));
      const [r, g, b, a] = quietRgba(quiet);
      img.data[px] = r;
      img.data[px + 1] = g;
      img.data[px + 2] = b;
      img.data[px + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
  return {
    url: canvas.toDataURL("image/png"),
    bounds: [
      [south, west],
      [north, east],
    ],
    cols,
    rows,
    peakMean: 0,
  };
}
