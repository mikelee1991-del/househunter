import { estimateNoiseCnel } from "../data/laxNoise";
import { NEIGHBORHOOD_LIVABILITY } from "../data/neighborhoodLivability";
import { SOUTH_BAY_COASTLINE } from "../data/southBayCoastline";
import type { SafetyTractsFile } from "../data/safetyTiers";
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
  west: -118.485,
  north: 33.985,
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

/** Soft ocean/sunset openness without running DEM rays for every cell. */
export function oceanProxyAt(
  lat: number,
  lng: number,
  samples: HeatmapOceanSample[],
): number {
  const coastKm = nearestCoastKm(lat, lng);
  const coastScore = clamp((1 - coastKm / 7.5) * 100, 0, 100);

  let wSum = 0;
  let sSum = 0;
  for (const s of samples) {
    const d = haversineKm(lat, lng, s.lat, s.lng);
    if (d > 2.8) continue;
    const w = 1 / (d * d + 0.08);
    wSum += w;
    sSum += w * s.score;
  }
  const idw = wSum > 0 ? sSum / wSum : coastScore * 0.5;
  return Math.round(idw * 0.7 + coastScore * 0.3);
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

export function oceanSamplesFromListings(
  listings: Listing[],
): HeatmapOceanSample[] {
  const out: HeatmapOceanSample[] = [];
  for (const l of listings) {
    const score = l.analysis?.oceanViewshed?.score100;
    if (typeof score === "number") {
      out.push({ lat: l.lat, lng: l.lng, score });
    } else if (l.oceanView) {
      out.push({ lat: l.lat, lng: l.lng, score: 70 });
    }
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
  cols = DEFAULT_COLS,
  rows = DEFAULT_ROWS,
): HeatmapCellBase[] {
  const { south, west, north, east } = SUITABILITY_BOUNDS;
  const samples = oceanSamplesFromListings(listings);
  const tractIndex = tracts ? tractRings(tracts) : null;
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

  // Weights mirror location-ish parts of scoreListing
  const oceanW = minView > 0 ? 0.28 : 0.12;
  const driveW = 0.28;
  const noiseW = 0.14;
  const safetyW = 0.16;
  const walkW = 0.14;
  const rest = driveW + noiseW + safetyW + walkW + oceanW;
  const score =
    (drive * driveW +
      noise * noiseW +
      safety * safetyW +
      walk * walkW +
      ocean * oceanW) /
    rest;

  return clamp(score, 0, 100);
}

/** Sequential colormap: faint cool → amber → brand green (best). */
export function suitabilityRgba(score: number): [number, number, number, number] {
  const t = clamp(score / 100, 0, 1);
  // Alpha ramps so weak areas barely tint the basemap
  const a = Math.round(clamp((t - 0.28) / 0.72, 0, 1) * 195);

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
