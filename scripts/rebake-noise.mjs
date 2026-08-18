#!/usr/bin/env node
/**
 * Rebake listing.noiseCnel with combined airport + highway model.
 *
 *   node scripts/rebake-noise.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const LISTINGS = join(ROOT, "public", "data", "listings.json");

// Inline a minimal port of ambientNoise for Node (avoid TS import).
// Keep in sync with src/data/ambientNoise.ts + highwayCorridors.ts + laxNoise.ts

const LAX_NOISE_POLYGONS = [
  {
    cnel: 65,
    coordinates: [
      [-118.52, 33.955], [-118.48, 33.965], [-118.42, 33.97], [-118.36, 33.968],
      [-118.30, 33.96], [-118.26, 33.95], [-118.24, 33.935], [-118.25, 33.92],
      [-118.28, 33.91], [-118.34, 33.905], [-118.40, 33.902], [-118.46, 33.905],
      [-118.50, 33.915], [-118.52, 33.93], [-118.52, 33.955],
    ],
  },
  {
    cnel: 70,
    coordinates: [
      [-118.48, 33.95], [-118.44, 33.958], [-118.40, 33.96], [-118.35, 33.958],
      [-118.31, 33.95], [-118.29, 33.938], [-118.30, 33.925], [-118.34, 33.918],
      [-118.39, 33.915], [-118.44, 33.918], [-118.47, 33.928], [-118.48, 33.94],
      [-118.48, 33.95],
    ],
  },
  {
    cnel: 75,
    coordinates: [
      [-118.45, 33.945], [-118.42, 33.95], [-118.39, 33.95], [-118.36, 33.945],
      [-118.345, 33.935], [-118.35, 33.925], [-118.38, 33.92], [-118.42, 33.92],
      [-118.445, 33.928], [-118.45, 33.938], [-118.45, 33.945],
    ],
  },
];

const HIGHWAYS = [
  { klass: "freeway", coordinates: [[-118.442,34.02],[-118.418,33.99],[-118.396,33.96],[-118.378,33.93],[-118.368,33.90],[-118.358,33.87],[-118.348,33.84],[-118.338,33.81],[-118.325,33.78],[-118.310,33.75],[-118.295,33.72],[-118.280,33.70]] },
  { klass: "freeway", coordinates: [[-118.430,33.932],[-118.400,33.930],[-118.370,33.929],[-118.340,33.928],[-118.310,33.928],[-118.280,33.929],[-118.250,33.931],[-118.230,33.933]] },
  { klass: "freeway", coordinates: [[-118.282,34.02],[-118.280,33.98],[-118.278,33.94],[-118.276,33.90],[-118.274,33.86],[-118.272,33.82],[-118.278,33.78],[-118.288,33.74],[-118.292,33.71]] },
  { klass: "freeway", coordinates: [[-118.360,33.868],[-118.330,33.867],[-118.300,33.866],[-118.270,33.865],[-118.240,33.866],[-118.210,33.868]] },
  { klass: "freeway", coordinates: [[-118.480,34.018],[-118.450,34.020],[-118.420,34.025],[-118.390,34.030],[-118.360,34.033],[-118.330,34.035],[-118.290,34.038],[-118.250,34.040]] },
  { klass: "coastal", coordinates: [[-118.475,34.01],[-118.460,33.98],[-118.445,33.95],[-118.430,33.92],[-118.415,33.89],[-118.400,33.86],[-118.395,33.84],[-118.390,33.81],[-118.385,33.78],[-118.380,33.75],[-118.360,33.72]] },
];

const EARTH_M = 6_371_000;
const toRad = (d) => (d * Math.PI) / 180;

function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function airportCnel(lat, lng) {
  let max = 0;
  for (const poly of LAX_NOISE_POLYGONS) {
    if (pointInRing(lng, lat, poly.coordinates)) max = Math.max(max, poly.cnel);
  }
  if (max === 0) {
    const dLat = lat - 33.942;
    const dLng = (lng + 118.4085) * Math.cos((lat * Math.PI) / 180);
    const distKm = Math.sqrt(dLat * dLat + dLng * dLng) * 111;
    if (distKm < 8) return Math.round(55 + (8 - distKm) * 1.2);
    if (distKm < 14) return Math.round(45 + (14 - distKm));
    return 40;
  }
  return max;
}

function toLocalM(lat, lng, refLat, refLng) {
  return {
    x: toRad(lng - refLng) * Math.cos(toRad(refLat)) * EARTH_M,
    y: toRad(lat - refLat) * EARTH_M,
  };
}

function distSeg(lat, lng, aLng, aLat, bLng, bLat) {
  const refLat = (aLat + bLat) / 2;
  const refLng = (aLng + bLng) / 2;
  const p = toLocalM(lat, lng, refLat, refLng);
  const a = toLocalM(aLat, aLng, refLat, refLng);
  const b = toLocalM(bLat, bLng, refLat, refLng);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function highwayCnel(lat, lng) {
  let max = 0;
  for (const road of HIGHWAYS) {
    let best = Infinity;
    for (let i = 0; i < road.coordinates.length - 1; i++) {
      const [aLng, aLat] = road.coordinates[i];
      const [bLng, bLat] = road.coordinates[i + 1];
      best = Math.min(best, distSeg(lat, lng, aLng, aLat, bLng, bLat));
    }
    if (best > 1200) continue;
    const refAt15 = road.klass === "freeway" ? 72 : 66;
    const d = Math.max(best, 8);
    const level = refAt15 - 4.5 * Math.log2(d / 15);
    if (level >= 48) max = Math.max(max, Math.round(Math.min(78, level)));
  }
  return max;
}

function estimateNoiseCnel(lat, lng) {
  return Math.max(airportCnel(lat, lng), highwayCnel(lat, lng));
}

const data = JSON.parse(readFileSync(LISTINGS, "utf8"));
let changed = 0;
let highwayDominant = 0;
for (const l of data.listings) {
  const airport = airportCnel(l.lat, l.lng);
  const highway = highwayCnel(l.lat, l.lng);
  const next = Math.max(airport, highway);
  if (highway > airport) highwayDominant += 1;
  if (l.noiseCnel !== next) {
    l.noiseCnel = next;
    changed += 1;
  }
}
data.generatedAt = new Date().toISOString();
writeFileSync(LISTINGS, JSON.stringify(data, null, 2) + "\n");
console.log({
  listings: data.listings.length,
  changed,
  highwayDominant,
});
