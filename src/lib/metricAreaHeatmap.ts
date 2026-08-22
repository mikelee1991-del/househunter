/**
 * Continuous area metric washes (any location in the region — on-sale or not).
 * Optionally hard-clips to the union of drive-time isochrones.
 *
 * Caches the expensive tract PIP grid + painted rasters so switching map
 * metrics stays responsive.
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
  sunsetProxyAt,
  sunsetSamplesFromListings,
  SUITABILITY_BOUNDS,
  type HeatmapCellBase,
  type SuitabilityRaster,
} from "./suitabilityHeatmap";
import { walkIndexRgba } from "./walkHeatmap";

/**
 * Neighborhood-readable grid over SUITABILITY_BOUNDS (~40×32 km).
 * 280×210 ≈ 145–155 m cells — block/tract edges stay sharp without freezing
 * metric switches (paint cache still keys on dims).
 */
const AREA_COLS = 280;
const AREA_ROWS = 210;

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

type BaseCacheEntry = {
  key: string;
  cells: HeatmapCellBase[];
};
let baseCache: BaseCacheEntry | null = null;

const paintCache = new Map<string, SuitabilityRaster>();
const PAINT_CACHE_MAX = 12;

function listingsFingerprint(listings: Listing[]): string {
  // Cheap identity: count + first/last id + generated analysis stamp
  if (!listings.length) return "0";
  const a = listings[0];
  const b = listings[listings.length - 1];
  return `${listings.length}:${a.id}:${b.id}`;
}

function anchorsFingerprint(anchors: Anchor[]): string {
  return anchors.map((a) => `${a.id}:${a.lat.toFixed(4)},${a.lng.toFixed(4)}`).join("|");
}

function isoFingerprint(
  anchors: Anchor[],
  isochrones: IsochroneMap | undefined,
): string {
  if (!isochrones) return "none";
  return anchors
    .map((a) => {
      const f = isochrones[a.id];
      if (!f) return `${a.id}:0`;
      const rings = f.geometry?.coordinates;
      const n = Array.isArray(rings) ? JSON.stringify(rings).length : 0;
      return `${a.id}:${n}`;
    })
    .join("|");
}

export function getCachedHeatmapBase(
  listings: Listing[],
  anchors: Anchor[],
  safetyTracts: SafetyTractsFile | null,
  airTracts: AirQualityTractsFile | null,
): HeatmapCellBase[] {
  const key = [
    listingsFingerprint(listings),
    anchorsFingerprint(anchors),
    safetyTracts?.generatedAt ?? "no-s",
    safetyTracts?.features?.length ?? 0,
    airTracts?.generatedAt ?? "no-a",
    airTracts?.tractCount ?? airTracts?.tracts?.length ?? 0,
    AREA_COLS,
    AREA_ROWS,
  ].join("::");

  if (baseCache?.key === key) return baseCache.cells;

  const cells = buildHeatmapBase(
    listings,
    safetyTracts,
    anchors,
    airTracts,
    AREA_COLS,
    AREA_ROWS,
  );
  baseCache = { key, cells };
  return cells;
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

  // Precompute clip mask once (Valhalla PIP is expensive per cell)
  let clipMask: Uint8Array | null = null;
  if (isochrones && anchors.some((a) => !!isochrones[a.id])) {
    clipMask = new Uint8Array(cells.length);
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      clipMask[i] = pointInAnyIsochrone(c.lat, c.lng, anchors, isochrones)
        ? 1
        : 0;
    }
  }

  const img = ctx.createImageData(cols, rows);
  let peakSum = 0;
  let peakN = 0;

  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    const px = i * 4;
    if (clipMask && !clipMask[i]) {
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

function quietRgba(score: number): [number, number, number, number] {
  return scoreRgba(score);
}

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

function paintKey(
  metric: AreaMetricId,
  listings: Listing[],
  anchors: Anchor[],
  safetyTracts: SafetyTractsFile | null,
  airTracts: AirQualityTractsFile | null,
  isochrones: IsochroneMap | undefined,
): string {
  return [
    metric,
    listingsFingerprint(listings),
    anchorsFingerprint(anchors),
    safetyTracts?.generatedAt ?? "no-s",
    airTracts?.generatedAt ?? "no-a",
    isoFingerprint(anchors, isochrones),
  ].join("::");
}

/**
 * Paint a continuous South Bay wash for a metric. When isochrones are ready,
 * pixels outside the union of any drive-time polygon are transparent.
 * Results are memoized so revisiting a metric is instant.
 */
export function paintAreaMetricHeatmap(
  metric: AreaMetricId,
  listings: Listing[],
  anchors: Anchor[],
  safetyTracts: SafetyTractsFile | null,
  airTracts: AirQualityTractsFile | null,
  isochrones: IsochroneMap | undefined,
): SuitabilityRaster {
  const key = paintKey(
    metric,
    listings,
    anchors,
    safetyTracts,
    airTracts,
    isochrones,
  );
  const hit = paintCache.get(key);
  if (hit) return hit;

  const cells = getCachedHeatmapBase(
    listings,
    anchors,
    safetyTracts,
    airTracts,
  );

  let raster: SuitabilityRaster;

  if (metric === "safety") {
    raster = paintCells(
      cells,
      (c) => c.safetyScore,
      scoreRgba,
      anchors,
      isochrones,
      AREA_COLS,
      AREA_ROWS,
    );
  } else if (metric === "air") {
    raster = paintCells(
      cells,
      (c) => c.airQualityScore,
      scoreRgba,
      anchors,
      isochrones,
      AREA_COLS,
      AREA_ROWS,
    );
  } else if (metric === "walk") {
    raster = paintCells(
      cells,
      (c) => clamp((c.walkIndex / 20) * 100, 0, 100),
      (score) => walkIndexRgba((score / 100) * 19 + 1),
      anchors,
      isochrones,
      AREA_COLS,
      AREA_ROWS,
    );
  } else if (metric === "noise") {
    raster = paintCells(
      cells,
      (c) => quietScoreFromCnel(c.noiseCnel),
      quietRgba,
      anchors,
      isochrones,
      AREA_COLS,
      AREA_ROWS,
    );
  } else if (metric === "ocean") {
    const oceanSamples = oceanSamplesFromListings(listings);
    raster = paintCells(
      cells,
      (c) => oceanProxyAt(c.lat, c.lng, oceanSamples),
      (score) => {
        const [r, g, b] = oceanViewshedRgba(score);
        const a = Math.round(110 + clamp(score / 100, 0, 1) * 100);
        return [r, g, b, a];
      },
      anchors,
      isochrones,
      AREA_COLS,
      AREA_ROWS,
    );
  } else if (metric === "sunset") {
    const sunsetSamples = sunsetSamplesFromListings(listings);
    raster = paintCells(
      cells,
      (c) => sunsetProxyAt(c.lat, c.lng, sunsetSamples),
      (score) => {
        const [r, g, b] = oceanViewshedRgba(score);
        const a = Math.round(110 + clamp(score / 100, 0, 1) * 100);
        return [r, g, b, a];
      },
      anchors,
      isochrones,
      AREA_COLS,
      AREA_ROWS,
    );
  } else {
    const condSamples: { lat: number; lng: number; score: number }[] = [];
    for (const l of listings) {
      const s = l.analysis?.condition?.score100;
      if (typeof s === "number") {
        condSamples.push({ lat: l.lat, lng: l.lng, score: s });
      }
    }
    raster = paintCells(
      cells,
      (c) => conditionScoreAt(c.lat, c.lng, condSamples),
      scoreRgba,
      anchors,
      isochrones,
      AREA_COLS,
      AREA_ROWS,
    );
  }

  if (paintCache.size >= PAINT_CACHE_MAX) {
    const first = paintCache.keys().next().value;
    if (first) paintCache.delete(first);
  }
  paintCache.set(key, raster);
  return raster;
}

/** Warm the shared base grid off the critical path (e.g. after tracts load). */
export function prefetchHeatmapBase(
  listings: Listing[],
  anchors: Anchor[],
  safetyTracts: SafetyTractsFile | null,
  airTracts: AirQualityTractsFile | null,
): void {
  if (!listings.length) return;
  if (!safetyTracts && !airTracts) return;
  getCachedHeatmapBase(listings, anchors, safetyTracts, airTracts);
}

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
