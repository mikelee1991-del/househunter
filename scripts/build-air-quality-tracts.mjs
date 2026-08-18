#!/usr/bin/env node
/**
 * Build CalEnviroScreen 4.0 air/pollution tract polygons for South Bay LA.
 *
 * Source: OEHHA CalEnviroScreen 4.0 (ArcGIS FeatureServer)
 * https://services1.arcgis.com/PCHfdHz4GlDNAhBb/arcgis/rest/services/CalEnviroScreen_4_0_Results_/FeatureServer/0
 *
 * Metrics kept:
 *   pm25 / pm25Pctile, diesel / dieselPctile, ozone / ozonePctile
 *   pollutionBurden / pollutionBurdenPctile
 *
 * airQualityScore = 100 − PollutionP  (higher = cleaner / lower burden)
 *
 * Output: public/data/air-quality-tracts.json
 *
 *   npm run build:air
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "public", "data", "air-quality-tracts.json");

const SERVICE =
  "https://services1.arcgis.com/PCHfdHz4GlDNAhBb/arcgis/rest/services/CalEnviroScreen_4_0_Results_/FeatureServer/0/query";

/** South Bay + Westside / coastal LA bbox (lon/lat). */
const BBOX = {
  xmin: -118.55,
  ymin: 33.68,
  xmax: -117.85,
  ymax: 34.12,
};

const OUT_FIELDS = [
  "tract",
  "TractTXT",
  "ACS2019TotalPop",
  "pm",
  "pmP",
  "diesel",
  "dieselP",
  "ozone",
  "ozoneP",
  "Pollution",
  "PollutionP",
].join(",");

function simplifyRing(ring, minStep = 0.0008) {
  if (!Array.isArray(ring) || ring.length < 4) return ring;
  const out = [ring[0]];
  for (let i = 1; i < ring.length - 1; i++) {
    const [x, y] = ring[i];
    const [px, py] = out[out.length - 1];
    if (Math.abs(x - px) >= minStep || Math.abs(y - py) >= minStep) {
      out.push(ring[i]);
    }
  }
  out.push(ring[ring.length - 1]);
  return out.length >= 4 ? out : ring;
}

function toLatLngRings(geom) {
  if (!geom?.rings) return [];
  return geom.rings.map((ring) =>
    simplifyRing(ring).map(([x, y]) => [y, x]),
  );
}

function airQualityScore(pollutionBurdenPctile) {
  if (pollutionBurdenPctile == null || !Number.isFinite(pollutionBurdenPctile)) {
    return null;
  }
  return Math.max(0, Math.min(100, Math.round(100 - pollutionBurdenPctile)));
}

async function fetchPage(resultOffset) {
  const params = new URLSearchParams({
    f: "json",
    where: "1=1",
    geometry: `${BBOX.xmin},${BBOX.ymin},${BBOX.xmax},${BBOX.ymax}`,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: OUT_FIELDS,
    returnGeometry: "true",
    outSR: "4326",
    resultOffset: String(resultOffset),
    resultRecordCount: "1000",
  });
  const res = await fetch(`${SERVICE}?${params}`);
  if (!res.ok) throw new Error(`CES query HTTP ${res.status}`);
  return res.json();
}

async function main() {
  const features = [];
  let offset = 0;
  for (;;) {
    const page = await fetchPage(offset);
    if (page.error) throw new Error(JSON.stringify(page.error));
    const batch = page.features ?? [];
    features.push(...batch);
    console.log(`  fetched ${features.length} tracts…`);
    if (!page.exceededTransferLimit || batch.length === 0) break;
    offset += batch.length;
  }

  const tracts = [];
  const seen = new Set();
  for (const f of features) {
    const a = f.attributes ?? {};
    const tractId = String(a.TractTXT ?? a.tract ?? "").trim();
    if (!tractId || seen.has(tractId)) continue;
    seen.add(tractId);
    const rings = toLatLngRings(f.geometry);
    if (!rings.length) continue;

    const pollutionBurdenPctile =
      a.PollutionP != null && Number.isFinite(Number(a.PollutionP))
        ? Math.round(Number(a.PollutionP) * 10) / 10
        : null;

    tracts.push({
      tract: tractId,
      population:
        a.ACS2019TotalPop != null ? Number(a.ACS2019TotalPop) : null,
      pm25: a.pm != null ? Math.round(Number(a.pm) * 100) / 100 : null,
      pm25Pctile: a.pmP != null ? Math.round(Number(a.pmP) * 10) / 10 : null,
      diesel: a.diesel != null ? Math.round(Number(a.diesel) * 100) / 100 : null,
      dieselPctile:
        a.dieselP != null ? Math.round(Number(a.dieselP) * 10) / 10 : null,
      ozone: a.ozone != null ? Math.round(Number(a.ozone) * 1000) / 1000 : null,
      ozonePctile:
        a.ozoneP != null ? Math.round(Number(a.ozoneP) * 10) / 10 : null,
      pollutionBurden:
        a.Pollution != null ? Math.round(Number(a.Pollution) * 100) / 100 : null,
      pollutionBurdenPctile,
      airQualityScore: airQualityScore(pollutionBurdenPctile),
      rings,
    });
  }

  tracts.sort((a, b) => a.tract.localeCompare(b.tract));

  const scores = tracts
    .map((t) => t.airQualityScore)
    .filter((n) => n != null);
  const avg =
    scores.length > 0
      ? Math.round((scores.reduce((s, n) => s + n, 0) / scores.length) * 10) /
        10
      : null;

  const payload = {
    source: "OEHHA CalEnviroScreen 4.0",
    sourceUrl:
      "https://oehha.ca.gov/calenviroscreen/report/calenviroscreen-40",
    apiUrl: SERVICE.replace("/query", ""),
    generatedAt: new Date().toISOString(),
    note:
      "airQualityScore = 100 − Pollution Burden percentile (statewide). Higher = lower pollution burden / cleaner relative air. PM2.5, diesel, and ozone are included for detail views.",
    bbox: BBOX,
    tractCount: tracts.length,
    avgAirQualityScore: avg,
    tracts,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(payload));
  console.log(
    `Wrote ${tracts.length} tracts → ${OUT} (avg airQualityScore ${avg})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
