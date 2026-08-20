import { estimateNoiseCnel } from "../data/ambientNoise";
import { NEIGHBORHOOD_LIVABILITY } from "../data/neighborhoodLivability";
import { SOUTH_BAY_COASTLINE } from "../data/southBayCoastline";
import type { SafetyTractsFile } from "../data/safetyTiers";
import type { AirQualityTractsFile } from "../hooks/useAirQualityTracts";
import type { Anchor, AnchorId, Criteria, Listing } from "../types";
import { estimateDriveMinutes, haversineKm } from "./geo";
import {
  pointInIsochrone,
  pointInRing,
  type IsochroneMap,
} from "./isochrone";

/** South Bay coverage for the suitability raster (lat/lng). */
export const SUITABILITY_BOUNDS = {
  south: 33.705,
  /** West enough for Santa Monica / Pacific Palisades shoreline */
  west: -118.58,
  north: 34.08,
  east: -118.235,
} as const;

export type SuitabilityBoundsLiteral = [
  [number, number],
  [number, number],
];

export interface HeatmapOceanSample {
  lat: number;
  lng: number;
  score: number;
}

/** Per-cell geographic context (independent of slider thresholds). */
export interface HeatmapCellBase {
  lat: number;
  lng: number;
  noiseCnel: number;
  safetyScore: number;
  walkIndex: number;
  airQualityScore: number;
  oceanProxy: number;
  driveMins: Record<AnchorId, number>;
}

export interface SuitabilityRaster {
  url: string;
  bounds: SuitabilityBoundsLiteral;
  cols: number;
  rows: number;
  /** Mean score of cells ≥ 55 — useful for empty-state hints */
  peakMean: number;
}

const DEFAULT_COLS = 160;
const DEFAULT_ROWS = 120;

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function nearestCoastKm(lat: number, lng: number): number {
  let best = Infinity;
  for (const [clng, clat] of SOUTH_BAY_COASTLINE) {
    best = Math.min(best, haversineKm(lat, lng, clat, clng));
  }
  return best;
}

/**
 * Address-local ocean score: exact nearest listing viewshed within maxKm.
 * Returns null when no listing is close enough (no broad coast wash).
 */
export function addressLocalOceanScore(
  lat: number,
  lng: number,
  samples: HeatmapOceanSample[],
  maxKm = 0.11,
): number | null {
  let best: HeatmapOceanSample | null = null;
  let bestD = Infinity;
  for (const s of samples) {
    const d = haversineKm(lat, lng, s.lat, s.lng);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  if (!best || bestD > maxKm) return null;
  return best.score;
}

/** Soft ocean/sunset openness for suitability cells — address-local first. */
export function oceanProxyAt(
  lat: number,
  lng: number,
  samples: HeatmapOceanSample[],
): number {
  const local = addressLocalOceanScore(lat, lng, samples, 0.18);
  if (local != null) return local;

  // Far from any measured lot: weak coast-only hint (not a neighborhood smear)
  const coastKm = nearestCoastKm(lat, lng);
  return Math.round(clamp((1 - coastKm / 7.5) * 35, 0, 35));
}

type NbRing = {
  safetyScore: number;
  walkIndex: number;
  ring: [number, number][];
};

const NEIGHBORHOOD_RINGS: NbRing[] = NEIGHBORHOOD_LIVABILITY.map((n) => ({
  safetyScore: n.safetyScore,
  walkIndex: n.walkFallback,
  ring: n.polygon.map(([la, ln]) => [ln, la] as [number, number]),
}));

type TractRing = {
  safetyScore: number;
  rings: [number, number][][];
};

type AirRing = {
  airQualityScore: number;
  rings: [number, number][][];
};

function tractRings(tracts: SafetyTractsFile): TractRing[] {
  return tracts.features.map((f) => {
    const g = f.geometry;
    const rings =
      g.type === "Polygon"
        ? [g.coordinates[0] as [number, number][]]
        : (g.coordinates as [number, number][][][]).map((poly) => poly[0]);
    return { safetyScore: f.properties.safetyScore, rings };
  });
}

function airRings(air: AirQualityTractsFile): AirRing[] {
  return air.tracts
    .filter((t) => t.airQualityScore != null)
    .map((t) => ({
      airQualityScore: t.airQualityScore as number,
      // rings are [lat, lng][]; pointInRing expects [lng, lat]
      rings: t.rings.map((ring) =>
        ring.map(([lat, lng]) => [lng, lat] as [number, number]),
      ),
    }));
}

function livabilityAt(
  lat: number,
  lng: number,
  tracts: TractRing[] | null,
): { safetyScore: number; walkIndex: number } {
  let walkIndex = 11;
  for (const n of NEIGHBORHOOD_RINGS) {
    if (pointInRing(lng, lat, n.ring)) {
      walkIndex = n.walkIndex;
      if (!tracts) {
        return { safetyScore: n.safetyScore, walkIndex };
      }
      break;
    }
  }

  if (tracts) {
    for (const t of tracts) {
      if (t.rings.some((ring) => pointInRing(lng, lat, ring))) {
        return { safetyScore: t.safetyScore, walkIndex };
      }
    }
  }

  for (const n of NEIGHBORHOOD_RINGS) {
    if (pointInRing(lng, lat, n.ring)) {
      return { safetyScore: n.safetyScore, walkIndex: n.walkIndex };
    }
  }
  return { safetyScore: 62, walkIndex: 10 };
}

function airAt(lat: number, lng: number, tracts: AirRing[] | null): number {
  if (tracts) {
    for (const t of tracts) {
      if (t.rings.some((ring) => pointInRing(lng, lat, ring))) {
        return t.airQualityScore;
      }
    }
  }
  return 35;
}

export function oceanSamplesFromListings(
  listings: Listing[],
): HeatmapOceanSample[] {
  const out: HeatmapOceanSample[] = [];
  for (const l of listings) {
    const ov = l.analysis?.oceanViewshed;
    if (!ov || typeof ov.score100 !== "number") continue;
    if ((ov.nearestCoastKm ?? 99) > 8) continue;
    if (/too far inland|unavailable|pending rebake/i.test(ov.summary || "")) {
      continue;
    }
    out.push({ lat: l.lat, lng: l.lng, score: ov.score100 });
  }
  return out;
}

/**
 * Build cell geography once when listings / tracts change.
 * Drive minutes use the Euclidean South Bay model (fast); isochrone
 * membership is applied later when polygons are ready.
 */
export function buildHeatmapBase(
  listings: Listing[],
  tracts: SafetyTractsFile | null,
  anchors: Anchor[],
  airTracts: AirQualityTractsFile | null = null,
  cols = DEFAULT_COLS,
  rows = DEFAULT_ROWS,
): HeatmapCellBase[] {
  const { south, west, north, east } = SUITABILITY_BOUNDS;
  const samples = oceanSamplesFromListings(listings);
  const tractIndex = tracts ? tractRings(tracts) : null;
  const airIndex = airTracts ? airRings(airTracts) : null;
  const cells: HeatmapCellBase[] = new Array(cols * rows);

  for (let row = 0; row < rows; row++) {
    const lat = north - ((row + 0.5) / rows) * (north - south);
    for (let col = 0; col < cols; col++) {
      const lng = west + ((col + 0.5) / cols) * (east - west);
      const liv = livabilityAt(lat, lng, tractIndex);
      const driveMins = {} as Record<AnchorId, number>;
      for (const a of anchors) {
        driveMins[a.id] = estimateDriveMinutes(lat, lng, a.lat, a.lng);
      }
      cells[row * cols + col] = {
        lat,
        lng,
        noiseCnel: estimateNoiseCnel(lat, lng),
        safetyScore: liv.safetyScore,
        walkIndex: liv.walkIndex,
        airQualityScore: airAt(lat, lng, airIndex),
        oceanProxy: oceanProxyAt(lat, lng, samples),
        driveMins,
      };
    }
  }
  return cells;
}

function scoreDriveComponent(
  cell: HeatmapCellBase,
  criteria: Criteria,
  anchors: Anchor[],
  isochrones?: IsochroneMap,
): number {
  if (!anchors.length) return 70;
  const havePolys =
    !!isochrones && anchors.every((a) => !!isochrones[a.id]);
  let sum = 0;
  let insideCount = 0;

  for (const a of anchors) {
    const limit = criteria.driveMinutes[a.id];
    const mins = cell.driveMins[a.id] ?? 99;
    const inside = havePolys
      ? pointInIsochrone(cell.lat, cell.lng, isochrones![a.id])
      : mins <= limit;

    if (inside) {
      insideCount += 1;
      // Prefer being comfortably inside the limit
      const headroom = havePolys
        ? clamp(1 - mins / Math.max(limit * 1.15, 1), 0, 1)
        : clamp(1 - mins / Math.max(limit, 1), 0, 1);
      sum += 55 + headroom * 45;
    } else {
      const over = havePolys
        ? Math.max(0, mins - limit)
        : mins - limit;
      sum += clamp(35 - over * 2.5, 0, 35);
    }
  }

  let score = sum / anchors.length;
  if (criteria.requireWithinAllIsochrones && insideCount < anchors.length) {
    score *= 0.35;
  }
  return score;
}

/**
 * Location-only suitability 0–100 using the same blended signals as
 * listing scoring (drives, noise, safety, walk, ocean openness).
 * Home-specific gates (price, beds, garage) are intentionally omitted.
 */
export function scoreHeatmapCell(
  cell: HeatmapCellBase,
  criteria: Criteria,
  anchors: Anchor[],
  isochrones?: IsochroneMap,
): number {
  const drive = scoreDriveComponent(cell, criteria, anchors, isochrones);

  let noise: number;
  if (cell.noiseCnel <= criteria.maxNoiseCnel) {
    noise = 70 + clamp((criteria.maxNoiseCnel - cell.noiseCnel) / 20, 0, 1) * 30;
  } else {
    noise = clamp(
      55 - (cell.noiseCnel - criteria.maxNoiseCnel) * 4,
      0,
      55,
    );
  }

  let safety: number;
  if (cell.safetyScore >= criteria.minSafetyScore) {
    safety =
      60 +
      clamp(
        (cell.safetyScore - criteria.minSafetyScore) /
          Math.max(100 - criteria.minSafetyScore, 1),
        0,
        1,
      ) *
        40;
  } else {
    safety = clamp(
      (cell.safetyScore / Math.max(criteria.minSafetyScore, 1)) * 50,
      0,
      50,
    );
  }

  let walk: number;
  if (
    cell.walkIndex >= criteria.walkMin &&
    cell.walkIndex <= criteria.walkMax
  ) {
    walk = 85;
  } else if (cell.walkIndex < criteria.walkMin) {
    walk = clamp(
      50 * (cell.walkIndex / Math.max(criteria.walkMin, 1)),
      0,
      50,
    );
  } else {
    const over = cell.walkIndex - criteria.walkMax;
    walk = clamp(55 - over * 8, 0, 55);
  }

  const minView = criteria.minOceanViewshed ?? 0;
  let ocean: number;
  if (minView > 0) {
    if (cell.oceanProxy >= minView) {
      ocean =
        55 +
        clamp((cell.oceanProxy - minView) / Math.max(100 - minView, 1), 0, 1) *
          45;
    } else {
      ocean = clamp((cell.oceanProxy / minView) * 40, 0, 40);
    }
  } else {
    ocean = 40 + cell.oceanProxy * 0.35;
  }

  const minAir = criteria.minAirQualityScore ?? 0;
  let air: number;
  if (minAir > 0) {
    if (cell.airQualityScore >= minAir) {
      air =
        60 +
        clamp(
          (cell.airQualityScore - minAir) / Math.max(100 - minAir, 1),
          0,
          1,
        ) *
          40;
    } else {
      air = clamp(
        (cell.airQualityScore / Math.max(minAir, 1)) * 45,
        0,
        45,
      );
    }
  } else {
    air = 40 + cell.airQualityScore * 0.4;
  }

  // Weights mirror location-ish parts of scoreListing
  const oceanW = minView > 0 ? 0.26 : 0.11;
  const driveW = 0.26;
  const noiseW = 0.13;
  const safetyW = 0.14;
  const walkW = 0.13;
  const airW = minAir > 0 ? 0.14 : 0.08;
  const rest = driveW + noiseW + safetyW + walkW + oceanW + airW;
  const score =
    (drive * driveW +
      noise * noiseW +
      safety * safetyW +
      walk * walkW +
      ocean * oceanW +
      air * airW) /
    rest;

  return clamp(score, 0, 100);
}

/** Sequential colormap: cool → amber → brand green (best). */
export function suitabilityRgba(score: number): [number, number, number, number] {
  const t = clamp(score / 100, 0, 1);
  // Stronger alpha so “best areas” read clearly over the basemap
  const a = Math.round(clamp((t - 0.18) / 0.82, 0, 1) * 235);

  let r: number;
  let g: number;
  let b: number;
  if (t < 0.45) {
    const u = t / 0.45;
    r = Math.round(120 + u * 70);
    g = Math.round(130 + u * 20);
    b = Math.round(140 - u * 40);
  } else if (t < 0.7) {
    const u = (t - 0.45) / 0.25;
    r = Math.round(190 - u * 80);
    g = Math.round(150 + u * 40);
    b = Math.round(100 - u * 40);
  } else {
    const u = (t - 0.7) / 0.3;
    r = Math.round(110 - u * 99);
    g = Math.round(190 - u * 80);
    b = Math.round(60 + u * 19);
  }
  return [r, g, b, a];
}

export function paintSuitabilityHeatmap(
  cells: HeatmapCellBase[],
  criteria: Criteria,
  anchors: Anchor[],
  isochrones: IsochroneMap | undefined,
  cols = DEFAULT_COLS,
  rows = DEFAULT_ROWS,
): SuitabilityRaster {
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return {
      url: "",
      bounds: [
        [SUITABILITY_BOUNDS.south, SUITABILITY_BOUNDS.west],
        [SUITABILITY_BOUNDS.north, SUITABILITY_BOUNDS.east],
      ],
      cols,
      rows,
      peakMean: 0,
    };
  }

  const img = ctx.createImageData(cols, rows);
  let peakSum = 0;
  let peakN = 0;

  for (let i = 0; i < cells.length; i++) {
    const score = scoreHeatmapCell(cells[i], criteria, anchors, isochrones);
    if (score >= 55) {
      peakSum += score;
      peakN += 1;
    }
    const [r, g, b, a] = suitabilityRgba(score);
    const px = i * 4;
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

/**
 * Ocean/sunset openness colormap: blocked (dark slate, still visible) →
 * usable teal → open green. Low scores stay opaque so every analyzed address
 * reads on the map — we do not hide blocked lots or wash them into neighbors.
 */
export function oceanViewshedRgba(
  score: number,
): [number, number, number, number] {
  const t = clamp(score / 100, 0, 1);
  // Blocked lots: visible dark slate; open wedge: stronger teal/green
  const a = Math.round(95 + t * 130);

  let r: number;
  let g: number;
  let b: number;
  if (t < 0.35) {
    const u = t / 0.35;
    r = Math.round(55 + u * 55);
    g = Math.round(65 + u * 70);
    b = Math.round(78 + u * 55);
  } else if (t < 0.6) {
    const u = (t - 0.35) / 0.25;
    r = Math.round(110 - u * 40);
    g = Math.round(135 + u * 35);
    b = Math.round(133 - u * 25);
  } else {
    const u = (t - 0.6) / 0.4;
    r = Math.round(70 - u * 59);
    g = Math.round(170 - u * 30);
    b = Math.round(108 - u * 40);
  }
  return [r, g, b, a];
}

/**
 * Address-local ocean/sunset overlay: each pixel uses the nearest listing’s
 * DEM LOS score only when within ~110 m — no neighborhood-wide IDW wash.
 */
export function paintOceanViewshedHeatmap(
  listings: Listing[],
  cols = 360,
  rows = 270,
): SuitabilityRaster {
  const { south, west, north, east } = SUITABILITY_BOUNDS;
  const samples = oceanSamplesFromListings(listings);
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

  const img = ctx.createImageData(cols, rows);
  let peakSum = 0;
  let peakN = 0;
  /** ~110 m in degrees at South Bay latitude */
  const maxKm = 0.11;

  for (let row = 0; row < rows; row++) {
    const lat = north - ((row + 0.5) / rows) * (north - south);
    for (let col = 0; col < cols; col++) {
      const lng = west + ((col + 0.5) / cols) * (east - west);
      const score = addressLocalOceanScore(lat, lng, samples, maxKm);
      const px = (row * cols + col) * 4;
      if (score == null) {
        img.data[px] = 0;
        img.data[px + 1] = 0;
        img.data[px + 2] = 0;
        img.data[px + 3] = 0;
        continue;
      }
      if (score >= 35) {
        peakSum += score;
        peakN += 1;
      }
      const [r, g, b, a] = oceanViewshedRgba(score);
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
    peakMean: peakN ? peakSum / peakN : 0,
  };
}
