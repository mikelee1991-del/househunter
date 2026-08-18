#!/usr/bin/env node
/**
 * Point-in-polygon bake of CalEnviroScreen air scores onto listings.json.
 *
 *   npm run ingest:air
 *
 * Requires public/data/air-quality-tracts.json (npm run build:air).
 * Does not recompute defaultScore — run refresh-default-scores after criteria changes.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const LISTINGS = join(ROOT, "public", "data", "listings.json");
const TRACTS = join(ROOT, "public", "data", "air-quality-tracts.json");

function pointInRing(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lat, lng, rings) {
  if (!rings?.length) return false;
  if (!pointInRing(lat, lng, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) {
    if (pointInRing(lat, lng, rings[i])) return false;
  }
  return true;
}

function lookup(lat, lng, tracts) {
  for (const t of tracts) {
    if (!pointInPolygon(lat, lng, t.rings)) continue;
    return t;
  }
  return null;
}

function main() {
  const air = JSON.parse(readFileSync(TRACTS, "utf8"));
  const data = JSON.parse(readFileSync(LISTINGS, "utf8"));
  const tracts = air.tracts ?? [];

  let hit = 0;
  let miss = 0;
  for (const l of data.listings) {
    if (!l.analysis) l.analysis = { computedAt: new Date().toISOString() };
    const t = lookup(l.lat, l.lng, tracts);
    if (!t || t.airQualityScore == null) {
      miss += 1;
      l.analysis.airQualityScore = null;
      l.analysis.airQuality = null;
      continue;
    }
    hit += 1;
    l.analysis.airQualityScore = t.airQualityScore;
    l.analysis.airQuality = {
      tract: t.tract,
      airQualityScore: t.airQualityScore,
      pollutionBurdenPctile: t.pollutionBurdenPctile,
      pm25: t.pm25,
      pm25Pctile: t.pm25Pctile,
      diesel: t.diesel,
      dieselPctile: t.dieselPctile,
      ozone: t.ozone,
      ozonePctile: t.ozonePctile,
      band:
        t.airQualityScore >= 70
          ? "Lower burden"
          : t.airQualityScore >= 50
            ? "Moderate"
            : t.airQualityScore >= 35
              ? "Elevated"
              : t.airQualityScore >= 20
                ? "High"
                : "Very high",
    };
  }

  data.generatedAt = new Date().toISOString();
  writeFileSync(LISTINGS, JSON.stringify(data, null, 2) + "\n");
  console.log(
    `Air quality bake: ${hit} hit, ${miss} miss of ${data.listings.length} listings`,
  );
}

main();
