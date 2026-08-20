import { NEIGHBORHOOD_LIVABILITY } from "../data/neighborhoodLivability";
import type { Listing } from "../types";
import { haversineKm } from "./geo";
import { pointInRing } from "./isochrone";
import {
  SUITABILITY_BOUNDS,
  type SuitabilityRaster,
} from "./suitabilityHeatmap";

type WalkRing = {
  name: string;
  walkIndex: number;
  ring: [number, number][];
  /** Ring centroid for nearest-neighborhood fill outside polygons */
  lat: number;
  lng: number;
};

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * EPA walk 1–20 → rgba. Higher walk = cooler blue-green; lower = warm sand.
 * Strong alpha so the continuous wash reads clearly on the light basemap.
 */
export function walkIndexRgba(
  walkIndex: number,
): [number, number, number, number] {
  const t = clamp((walkIndex - 1) / 19, 0, 1);
  const a = Math.round(175 + t * 55);
  let r: number;
  let g: number;
  let b: number;
  if (t < 0.35) {
    const u = t / 0.35;
    r = Math.round(170 - u * 30);
    g = Math.round(130 - u * 15);
    b = Math.round(85 + u * 25);
  } else if (t < 0.65) {
    const u = (t - 0.35) / 0.3;
    r = Math.round(140 - u * 80);
    g = Math.round(115 + u * 50);
    b = Math.round(110 + u * 30);
  } else {
    const u = (t - 0.65) / 0.35;
    r = Math.round(60 - u * 30);
    g = Math.round(165 - u * 35);
    b = Math.round(140 + u * 45);
  }
  return [r, g, b, a];
}

/** Mean EPA walk per neighborhood from listings; fall back to seed walkFallback. */
function buildWalkRings(listings: Listing[]): WalkRing[] {
  const sum = new Map<string, number>();
  const count = new Map<string, number>();
  for (const l of listings) {
    const w = l.analysis?.walkIndex;
    if (w == null || !Number.isFinite(w)) continue;
    const name = l.neighborhood || l.city;
    sum.set(name, (sum.get(name) || 0) + w);
    count.set(name, (count.get(name) || 0) + 1);
  }

  return NEIGHBORHOOD_LIVABILITY.map((n) => {
    const c = count.get(n.name) || 0;
    const walkIndex =
      c >= 3 ? Math.round(((sum.get(n.name) || 0) / c) * 10) / 10 : n.walkFallback;
    let lat = 0;
    let lng = 0;
    for (const [la, ln] of n.polygon) {
      lat += la;
      lng += ln;
    }
    const m = Math.max(1, n.polygon.length);
    return {
      name: n.name,
      walkIndex,
      ring: n.polygon.map(([la, ln]) => [ln, la] as [number, number]),
      lat: lat / m,
      lng: lng / m,
    };
  });
}

function walkAt(lat: number, lng: number, rings: WalkRing[]): number {
  for (const n of rings) {
    if (pointInRing(lng, lat, n.ring)) return n.walkIndex;
  }
  // Outside drawn rings (ocean / gaps): nearest neighborhood centroid
  let best = rings[0]?.walkIndex ?? 10;
  let bestD = Infinity;
  for (const n of rings) {
    const d = haversineKm(lat, lng, n.lat, n.lng);
    if (d < bestD) {
      bestD = d;
      best = n.walkIndex;
    }
  }
  return best;
}

/**
 * Continuous walkability surface across the South Bay bounds.
 * Neighborhood EPA averages (or fallbacks) fill the whole metro — not
 * address-only spots.
 */
export function paintWalkabilityHeatmap(
  listings: Listing[],
  cols = 220,
  rows = 165,
): SuitabilityRaster {
  const { south, west, north, east } = SUITABILITY_BOUNDS;
  const rings = buildWalkRings(listings);
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

  for (let row = 0; row < rows; row++) {
    const lat = north - ((row + 0.5) / rows) * (north - south);
    for (let col = 0; col < cols; col++) {
      const lng = west + ((col + 0.5) / cols) * (east - west);
      const walk = walkAt(lat, lng, rings);
      const score100 = clamp((walk / 20) * 100, 0, 100);
      if (walk >= 10.5) {
        peakSum += score100;
        peakN += 1;
      }
      const [r, g, b, a] = walkIndexRgba(walk);
      const px = (row * cols + col) * 4;
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
