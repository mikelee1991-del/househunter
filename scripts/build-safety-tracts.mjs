/**
 * Build discrete census-tract safety polygons for the South Bay map overlay.
 * Run: node scripts/build-safety-tracts.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, "../public/data/safety-tracts.json");

// South Bay search envelope
const BBOX = {
  xmin: -118.48,
  ymin: 33.70,
  xmax: -118.26,
  ymax: 34.02,
};

/** Place-name → base safety (0–100). Applied via tract centroid in bbox. */
const PLACE_SAFETY = [
  { name: "Palos Verdes Estates", score: 95, lat: [33.77, 33.81], lng: [-118.42, -118.37] },
  { name: "Rancho Palos Verdes", score: 93, lat: [33.72, 33.79], lng: [-118.42, -118.34] },
  { name: "Manhattan Beach", score: 90, lat: [33.87, 33.91], lng: [-118.43, -118.38] },
  { name: "Hermosa Beach", score: 88, lat: [33.85, 33.875], lng: [-118.42, -118.38] },
  { name: "El Segundo", score: 86, lat: [33.90, 33.94], lng: [-118.44, -118.38] },
  { name: "Redondo Beach", score: 84, lat: [33.81, 33.88], lng: [-118.41, -118.36] },
  { name: "Torrance", score: 80, lat: [33.79, 33.88], lng: [-118.37, -118.30] },
  { name: "Playa del Rey", score: 78, lat: [33.94, 33.97], lng: [-118.46, -118.42] },
  { name: "Marina del Rey", score: 76, lat: [33.96, 33.99], lng: [-118.47, -118.43] },
  { name: "Westchester", score: 72, lat: [33.94, 33.99], lng: [-118.44, -118.37] },
  { name: "Mar Vista", score: 70, lat: [33.98, 34.02], lng: [-118.46, -118.41] },
  { name: "San Pedro", score: 58, lat: [33.71, 33.76], lng: [-118.32, -118.27] },
  { name: "Hawthorne", score: 62, lat: [33.90, 33.94], lng: [-118.37, -118.32] },
  { name: "Inglewood", score: 55, lat: [33.94, 33.98], lng: [-118.37, -118.32] },
  { name: "Lawndale", score: 64, lat: [33.88, 33.91], lng: [-118.37, -118.34] },
  { name: "Gardena", score: 60, lat: [33.87, 33.91], lng: [-118.33, -118.28] },
  { name: "Lomita", score: 78, lat: [33.78, 33.81], lng: [-118.33, -118.30] },
  { name: "Carson", score: 65, lat: [33.80, 33.86], lng: [-118.29, -118.24] },
];

function discreteTier(score) {
  if (score >= 90) return { tier: 1, label: "Very low", scoreBand: "90–100" };
  if (score >= 80) return { tier: 2, label: "Low", scoreBand: "80–89" };
  if (score >= 70) return { tier: 3, label: "Moderate-low", scoreBand: "70–79" };
  if (score >= 60) return { tier: 4, label: "Moderate", scoreBand: "60–69" };
  return { tier: 5, label: "Elevated", scoreBand: "<60" };
}

function centroidOfRing(ring) {
  let x = 0;
  let y = 0;
  const n = ring.length - 1; // ignore closing point if duplicate
  const len = ring[0][0] === ring[n][0] && ring[0][1] === ring[n][1] ? n : ring.length;
  for (let i = 0; i < len; i++) {
    x += ring[i][0];
    y += ring[i][1];
  }
  return [x / len, y / len];
}

function featureCentroid(geom) {
  if (geom.type === "Polygon") return centroidOfRing(geom.coordinates[0]);
  if (geom.type === "MultiPolygon") {
    // largest ring by vertex count as proxy
    let best = geom.coordinates[0][0];
    for (const poly of geom.coordinates) {
      if (poly[0].length > best.length) best = poly[0];
    }
    return centroidOfRing(best);
  }
  return [0, 0];
}

function placeFor(lat, lng) {
  for (const p of PLACE_SAFETY) {
    if (lat >= p.lat[0] && lat <= p.lat[1] && lng >= p.lng[0] && lng <= p.lng[1]) {
      return p;
    }
  }
  // Soft fallback by nearest place center
  let best = PLACE_SAFETY[0];
  let bestD = Infinity;
  for (const p of PLACE_SAFETY) {
    const clat = (p.lat[0] + p.lat[1]) / 2;
    const clng = (p.lng[0] + p.lng[1]) / 2;
    const d = (lat - clat) ** 2 + (lng - clng) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/** Jitter within ±3 so adjacent tracts aren't identical blobs. */
function jitterScore(base, geoid) {
  let h = 0;
  for (let i = 0; i < geoid.length; i++) h = (h * 31 + geoid.charCodeAt(i)) >>> 0;
  const delta = (h % 7) - 3; // -3..+3
  return Math.max(45, Math.min(98, base + delta));
}

function simplifyRing(ring, step) {
  if (ring.length <= 20) return ring;
  const out = [];
  for (let i = 0; i < ring.length - 1; i += step) out.push(ring[i]);
  out.push(ring[ring.length - 1]);
  return out;
}

function simplifyGeom(geom, step = 3) {
  if (geom.type === "Polygon") {
    return {
      type: "Polygon",
      coordinates: geom.coordinates.map((r, i) =>
        i === 0 ? simplifyRing(r, step) : r,
      ),
    };
  }
  if (geom.type === "MultiPolygon") {
    return {
      type: "MultiPolygon",
      coordinates: geom.coordinates.map((poly) =>
        poly.map((r, i) => (i === 0 ? simplifyRing(r, step) : r)),
      ),
    };
  }
  return geom;
}

async function fetchTractsPage(offset = 0) {
  const params = new URLSearchParams({
    where: "STATE='06' AND COUNTY='037'",
    geometry: `${BBOX.xmin},${BBOX.ymin},${BBOX.xmax},${BBOX.ymax}`,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "GEOID,NAME,TRACT",
    returnGeometry: "true",
    outSR: "4326",
    f: "geojson",
    resultOffset: String(offset),
    resultRecordCount: "200",
  });
  const url = `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/0/query?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TigerWeb HTTP ${res.status}`);
  return res.json();
}

async function main() {
  const all = [];
  let offset = 0;
  for (;;) {
    const page = await fetchTractsPage(offset);
    const feats = page.features ?? [];
    all.push(...feats);
    console.log(`fetched ${feats.length} (total ${all.length})`);
    if (feats.length < 200) break;
    offset += 200;
    if (offset > 2000) break;
  }

  const features = all.map((f) => {
    const [lng, lat] = featureCentroid(f.geometry);
    const place = placeFor(lat, lng);
    const score = jitterScore(place.score, String(f.properties.GEOID));
    const { tier, label, scoreBand } = discreteTier(score);
    return {
      type: "Feature",
      properties: {
        geoid: f.properties.GEOID,
        tract: f.properties.TRACT ?? f.properties.NAME,
        place: place.name,
        safetyScore: score,
        tier,
        tierLabel: label,
        scoreBand,
      },
      geometry: simplifyGeom(f.geometry, 4),
    };
  });

  // Keep only tracts that landed in our place envelopes or near South Bay
  const filtered = features.filter((f) => {
    const [lng, lat] = featureCentroid(f.geometry);
    return (
      lat >= BBOX.ymin &&
      lat <= BBOX.ymax &&
      lng >= BBOX.xmin &&
      lng <= BBOX.xmax
    );
  });

  const payload = {
    type: "FeatureCollection",
    generatedAt: new Date().toISOString(),
    source:
      "Census TIGER tracts + place-level relative safety tiers (discrete 5-class)",
    legend: [
      { tier: 1, label: "Very low", color: "#0b6e4f" },
      { tier: 2, label: "Low", color: "#3d8b66" },
      { tier: 3, label: "Moderate-low", color: "#a3b18a" },
      { tier: 4, label: "Moderate", color: "#c4a35a" },
      { tier: 5, label: "Elevated", color: "#b85c38" },
    ],
    features: filtered,
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(payload) + "\n");
  console.log(`Wrote ${filtered.length} tracts → ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
