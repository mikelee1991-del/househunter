import { HIGHWAY_CORRIDORS, type HighwayClass } from "./highwayCorridors";
import {
  estimateAirportNoiseCnel,
  LAX_NOISE_POLYGONS,
  type NoiseBand,
  type NoisePolygon,
} from "./laxNoise";

export { LAX_NOISE_POLYGONS, type NoiseBand, type NoisePolygon };
export { HIGHWAY_CORRIDORS };

const EARTH_M = 6_371_000;

function toRad(d: number) {
  return (d * Math.PI) / 180;
}

/** Local equirectangular meters from a reference point. */
function toLocalM(lat: number, lng: number, refLat: number, refLng: number) {
  const x = toRad(lng - refLng) * Math.cos(toRad(refLat)) * EARTH_M;
  const y = toRad(lat - refLat) * EARTH_M;
  return { x, y };
}

function distPointToSegmentM(
  lat: number,
  lng: number,
  aLng: number,
  aLat: number,
  bLng: number,
  bLat: number,
): number {
  const refLat = (aLat + bLat) / 2;
  const refLng = (aLng + bLng) / 2;
  const p = toLocalM(lat, lng, refLat, refLng);
  const a = toLocalM(aLat, aLng, refLat, refLng);
  const b = toLocalM(bLat, bLng, refLat, refLng);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1) {
    return Math.hypot(p.x - a.x, p.y - a.y);
  }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const qx = a.x + t * dx;
  const qy = a.y + t * dy;
  return Math.hypot(p.x - qx, p.y - qy);
}

function minDistToCorridorM(
  lat: number,
  lng: number,
  coords: [number, number][],
): number {
  let best = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const [aLng, aLat] = coords[i];
    const [bLng, bLat] = coords[i + 1];
    best = Math.min(
      best,
      distPointToSegmentM(lat, lng, aLng, aLat, bLng, bLat),
    );
  }
  return best;
}

/**
 * Soft-ground-ish FHWA-style falloff from a near-road reference.
 * Freeway ref ≈ 72 CNEL at 15 m; coastal arterial ≈ 66.
 * ~4.5 dB per doubling of distance (soft ground).
 */
function cnelFromDistanceM(distM: number, klass: HighwayClass): number {
  const refAt15 = klass === "freeway" ? 72 : 66;
  const d = Math.max(distM, 8);
  const doublings = Math.log2(d / 15);
  const level = refAt15 - 4.5 * doublings;
  if (level < 48) return 0; // below ambient floor — ignore
  return Math.round(Math.min(78, level));
}

/** Loudest highway corridor CNEL contribution at a point (0 if far). */
export function estimateHighwayNoiseCnel(lat: number, lng: number): number {
  let max = 0;
  for (const road of HIGHWAY_CORRIDORS) {
    const distM = minDistToCorridorM(lat, lng, road.coordinates);
    if (distM > 1200) continue;
    max = Math.max(max, cnelFromDistanceM(distM, road.klass));
  }
  return max;
}

export type NoiseDominantSource = "airport" | "highway" | "ambient";

export function noiseBreakdown(lat: number, lng: number): {
  airport: number;
  highway: number;
  total: number;
  dominant: NoiseDominantSource;
} {
  const airport = estimateAirportNoiseCnel(lat, lng);
  const highway = estimateHighwayNoiseCnel(lat, lng);
  const total = Math.max(airport, highway);
  let dominant: NoiseDominantSource = "ambient";
  if (total <= 42) dominant = "ambient";
  else if (highway >= airport) dominant = "highway";
  else dominant = "airport";
  return { airport, highway, total, dominant };
}

/**
 * Combined ambient noise screening (airport CNEL contours + highway corridors).
 * Uses the louder source — typical land-use screening practice.
 */
export function estimateNoiseCnel(lat: number, lng: number): number {
  return noiseBreakdown(lat, lng).total;
}
