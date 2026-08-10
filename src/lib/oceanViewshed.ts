import { offshoreTargets, SOUTH_BAY_COASTLINE } from "../data/southBayCoastline";
import { haversineKm } from "./geo";

/**
 * GIS ocean / sunset viewshed (screening model, not a survey):
 * 1) Cast rays from the lot toward Pacific targets in the sunset azimuth
 *    band (SW–NW). House orientation is ignored — what matters is whether
 *    ocean + sunset sky are geometrically visible.
 * 2) Sample terrain elevation (DEM) along each ray.
 * 3) Line-of-sight: terrain must stay below the viewer→target ray.
 * 4) Near-field building occlusion via OSM Overpass (height / levels).
 *
 * score100 = round(clear rays / tested rays × 100). Higher means a wider
 * clear ocean/sunset wedge. “Has view” when score ≥35 and ≥2 rays clear.
 */

export type ViewshedConfidence = "high" | "medium" | "low";

/** Compass center of the sunset / Pacific look direction for South Bay. */
export const SUNSET_OCEAN_CONE_CENTER_DEG = 270;
/** Half-width of the sunset/ocean cone (covers ~SW through NW). */
export const SUNSET_OCEAN_CONE_HALF_DEG = 55;

export interface OceanViewshedResult {
  hasOceanView: boolean;
  /** 0–1 fraction of tested rays with clear terrain+building LOS */
  clearRayFraction: number;
  /** Same signal as clearRayFraction, scaled 0–100 for UI */
  score100: number;
  clearRays: number;
  testedRays: number;
  nearestCoastKm: number;
  terrainBlockedRays: number;
  buildingBlockedRays: number;
  buildingHits: number;
  eyeHeightM: number;
  /** Sunset/ocean cone center used for rays (not house facing). */
  facingUsedDeg: number;
  confidence: ViewshedConfidence;
  summary: string;
  method: "dem-los+osm-buildings";
}

/** Plain-language blurb for UI captions / tooltips. */
export const OCEAN_VIEWSHED_EXPLAIN =
  "Ocean viewshed (0–100): share of rays toward the Pacific / sunset sky that clear terrain and nearby buildings. About ocean + sunset visibility — not whether the house faces west. Screening GIS only.";

export function viewshedScore100(clearRayFraction: number): number {
  return Math.round(Math.min(1, Math.max(0, clearRayFraction)) * 100);
}

interface SamplePoint {
  lat: number;
  lng: number;
  /** Distance from viewer along ray (km) */
  distKm: number;
}

interface OsmBuilding {
  lat: number;
  lng: number;
  heightM: number;
}

const ELEV_URL = "https://api.open-meteo.com/v1/elevation";
const OPENTOPO_URL = "https://api.opentopodata.org/v1/ned10m";
const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const elevCache = new Map<string, number>();

function elevKey(lat: number, lng: number) {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

function bearingDeg(lat1: number, lng1: number, lat2: number, lng2: number) {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function angleDelta(a: number, b: number) {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function nearestCoastKm(lat: number, lng: number): number {
  let best = Infinity;
  for (const [clng, clat] of SOUTH_BAY_COASTLINE) {
    best = Math.min(best, haversineKm(lat, lng, clat, clng));
  }
  return best;
}

/**
 * Pick Pacific/offshore targets in the sunset azimuth band from this lot.
 * Ignores house facing — sunsets + ocean are the goal.
 */
function pickOceanTargets(
  lat: number,
  lng: number,
  coneCenterDeg = SUNSET_OCEAN_CONE_CENTER_DEG,
  coneHalfAngle = SUNSET_OCEAN_CONE_HALF_DEG,
  maxTargets = 7,
): [number, number][] {
  const offshore = offshoreTargets();
  const scored = offshore
    .map(([olng, olat]) => {
      const brg = bearingDeg(lat, lng, olat, olng);
      const delta = angleDelta(brg, coneCenterDeg);
      const dist = haversineKm(lat, lng, olat, olng);
      return { olng, olat, delta, dist };
    })
    .filter((t) => t.delta <= coneHalfAngle && t.dist <= 18)
    .sort((a, b) => a.delta - b.delta || a.dist - b.dist);

  const picked = scored.slice(0, maxTargets);
  if (picked.length >= 3) {
    return picked.map((t) => [t.olng, t.olat] as [number, number]);
  }

  // Fallback: nearest offshore points (still prefer sunset-band bearings)
  return [...offshore]
    .map(([olng, olat]) => {
      const brg = bearingDeg(lat, lng, olat, olng);
      return {
        olng,
        olat,
        dist: haversineKm(lat, lng, olat, olng),
        delta: angleDelta(brg, coneCenterDeg),
      };
    })
    .sort((a, b) => a.delta - b.delta || a.dist - b.dist)
    .slice(0, maxTargets)
    .map((t) => [t.olng, t.olat] as [number, number]);
}

function samplesAlongRay(
  lat0: number,
  lng0: number,
  lat1: number,
  lng1: number,
  stepKm = 0.45,
): SamplePoint[] {
  const total = haversineKm(lat0, lng0, lat1, lng1);
  if (total < 0.05) return [];
  const n = Math.max(3, Math.min(18, Math.ceil(total / stepKm)));
  const out: SamplePoint[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    out.push({
      lat: lerp(lat0, lat1, t),
      lng: lerp(lng0, lng1, t),
      distKm: total * t,
    });
  }
  return out;
}

async function fetchOpenMeteoChunk(
  batch: { lat: number; lng: number }[],
): Promise<number[] | null> {
  const url =
    `${ELEV_URL}?latitude=${batch.map((b) => b.lat.toFixed(5)).join(",")}` +
    `&longitude=${batch.map((b) => b.lng.toFixed(5)).join(",")}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url);
    if (res.status === 429) {
      await sleep(800 * (attempt + 1));
      continue;
    }
    if (!res.ok) return null;
    const json = (await res.json()) as { elevation?: number[] };
    return json.elevation ?? null;
  }
  return null;
}

async function fetchOpenTopoChunk(
  batch: { lat: number; lng: number }[],
): Promise<number[]> {
  // Free tier ~1 req/s; max 100 locations
  const locations = batch.map((b) => `${b.lat},${b.lng}`).join("|");
  const res = await fetch(`${OPENTOPO_URL}?locations=${locations}`);
  if (!res.ok) throw new Error(`OpenTopoData HTTP ${res.status}`);
  const json = (await res.json()) as {
    results?: { elevation: number | null }[];
  };
  return (json.results ?? []).map((r) => r.elevation ?? 0);
}

async function fetchElevations(
  points: { lat: number; lng: number }[],
): Promise<number[]> {
  const results = new Array(points.length).fill(0);
  const missing: { idx: number; lat: number; lng: number }[] = [];

  points.forEach((p, idx) => {
    const cached = elevCache.get(elevKey(p.lat, p.lng));
    if (cached != null) results[idx] = cached;
    else missing.push({ idx, lat: p.lat, lng: p.lng });
  });

  const chunk = 40;
  for (let i = 0; i < missing.length; i += chunk) {
    const batch = missing.slice(i, i + chunk);
    let elevs = await fetchOpenMeteoChunk(batch);
    if (!elevs) {
      await sleep(1100);
      elevs = await fetchOpenTopoChunk(batch);
    }
    batch.forEach((b, j) => {
      const e = elevs![j] ?? 0;
      elevCache.set(elevKey(b.lat, b.lng), e);
      results[b.idx] = e;
    });
    if (i + chunk < missing.length) await sleep(350);
  }
  return results;
}

/**
 * True if terrain along the ray stays below the geometric LOS.
 * Skip the first ~80m (own lot / street) to avoid self-blocking noise.
 */
function terrainClear(
  viewerElev: number,
  targetElev: number,
  samples: SamplePoint[],
  sampleElevs: number[],
  totalKm: number,
): boolean {
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (s.distKm < 0.08) continue;
    // Don't test the last sample as "blocker" — it's the target neighborhood
    if (s.distKm > totalKm - 0.05) continue;
    const t = s.distKm / totalKm;
    const losElev = viewerElev + (targetElev - viewerElev) * t;
    // Small clearance so DEM noise doesn't false-block
    if (sampleElevs[i] > losElev + 2.5) return false;
  }
  return true;
}

function estimateBuildingHeight(tags: Record<string, string>): number {
  if (tags.height) {
    const m = parseFloat(tags.height);
    if (Number.isFinite(m) && m > 0) return m;
  }
  if (tags["building:levels"]) {
    const levels = parseFloat(tags["building:levels"]);
    if (Number.isFinite(levels) && levels > 0) return levels * 3.1;
  }
  // Untagged building — assume 2-story South Bay SFR
  if (tags.building && tags.building !== "no") return 7;
  return 0;
}

async function fetchBuildingsInWedge(
  lat: number,
  lng: number,
  coneCenterDeg = SUNSET_OCEAN_CONE_CENTER_DEG,
  radiusM = 700,
): Promise<OsmBuilding[]> {
  // Bounding box around viewer (Overpass), then filter to sunset/ocean wedge
  const pad = radiusM / 111_320;
  const padLng = pad / Math.cos((lat * Math.PI) / 180);
  const south = lat - pad;
  const north = lat + pad;
  const west = lng - padLng;
  const east = lng + padLng;

  const query = `
    [out:json][timeout:20];
    (
      way["building"](${south},${west},${north},${east});
      relation["building"](${south},${west},${north},${east});
    );
    out tags center;
  `;

  for (const endpoint of OVERPASS_URLS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        body: query,
        headers: { "Content-Type": "text/plain" },
      });
      if (!res.ok) continue;
      const json = (await res.json()) as {
        elements?: {
          type: string;
          center?: { lat: number; lon: number };
          lat?: number;
          lon?: number;
          tags?: Record<string, string>;
        }[];
      };

      const buildings: OsmBuilding[] = [];
      for (const el of json.elements ?? []) {
        const blat = el.center?.lat ?? el.lat;
        const blng = el.center?.lon ?? el.lon;
        if (blat == null || blng == null) continue;
        const dist = haversineKm(lat, lng, blat, blng) * 1000;
        if (dist < 25 || dist > radiusM) continue;
        const brg = bearingDeg(lat, lng, blat, blng);
        if (angleDelta(brg, coneCenterDeg) > SUNSET_OCEAN_CONE_HALF_DEG) {
          continue;
        }
        const heightM = estimateBuildingHeight(el.tags ?? {});
        if (heightM < 5) continue;
        buildings.push({ lat: blat, lng: blng, heightM });
      }
      return buildings;
    } catch {
      /* try next mirror */
    }
  }
  return [];
}

function buildingBlocksRay(
  lat0: number,
  lng0: number,
  lat1: number,
  lng1: number,
  viewerElev: number,
  viewerGround: number,
  targetElev: number,
  buildings: OsmBuilding[],
): boolean {
  const totalKm = haversineKm(lat0, lng0, lat1, lng1);
  if (totalKm < 0.05) return false;

  for (const b of buildings) {
    const dViewer = haversineKm(lat0, lng0, b.lat, b.lng);
    const dTarget = haversineKm(lat1, lng1, b.lat, b.lng);
    // Near the ray segment if triangle inequality is nearly tight
    if (dViewer + dTarget > totalKm + 0.08) continue;
    if (dViewer < 0.03) continue; // skip own footprint / curb

    const t = Math.min(0.98, Math.max(0.02, dViewer / totalKm));
    const losElev = viewerElev + (targetElev - viewerElev) * t;
    // Near-field: assume building ground ≈ viewer ground (flat South Bay blocks)
    const buildingTop = viewerGround + b.heightM;
    if (buildingTop > losElev + 1.5) return true;
  }
  return false;
}

export async function analyzeOceanViewshed(input: {
  lat: number;
  lng: number;
  /** @deprecated Ignored — viewshed uses sunset/ocean azimuth, not house facing */
  facingDegrees?: number;
  /** Extra eye height above DEM ground (upper-story window ≈ 5–6m) */
  eyeHeightM?: number;
}): Promise<OceanViewshedResult> {
  const facingUsedDeg = SUNSET_OCEAN_CONE_CENTER_DEG;
  const eyeHeightM = input.eyeHeightM ?? 5.5;
  const coastKm = nearestCoastKm(input.lat, input.lng);

  const targets = pickOceanTargets(input.lat, input.lng, facingUsedDeg, SUNSET_OCEAN_CONE_HALF_DEG, 7);
  if (!targets.length || coastKm > 12) {
    return {
      hasOceanView: false,
      clearRayFraction: 0,
      score100: 0,
      clearRays: 0,
      testedRays: 0,
      nearestCoastKm: coastKm,
      terrainBlockedRays: 0,
      buildingBlockedRays: 0,
      buildingHits: 0,
      eyeHeightM,
      facingUsedDeg,
      confidence: "low",
      summary:
        coastKm > 12
          ? `Ocean viewshed 0/100 — too far inland (~${coastKm.toFixed(1)} km to coast)`
          : "Ocean viewshed 0/100 — no ocean targets in view cone",
      method: "dem-los+osm-buildings",
    };
  }

  // Gather all elevation sample points
  const raySamples = targets.map(([tlng, tlat]) =>
    samplesAlongRay(input.lat, input.lng, tlat, tlng, 0.5),
  );
  const allPoints: { lat: number; lng: number }[] = [
    { lat: input.lat, lng: input.lng },
    ...targets.map(([tlng, tlat]) => ({ lat: tlat, lng: tlng })),
  ];
  for (const samples of raySamples) {
    for (const s of samples) allPoints.push({ lat: s.lat, lng: s.lng });
  }

  const elevs = await fetchElevations(allPoints);
  const viewerGround = elevs[0] ?? 0;
  const viewerElev = viewerGround + eyeHeightM;

  const buildings = await fetchBuildingsInWedge(
    input.lat,
    input.lng,
    facingUsedDeg,
    750,
  );

  let clearRays = 0;
  let terrainBlockedRays = 0;
  let buildingBlockedRays = 0;
  let elevIdx = 1 + targets.length; // samples start after viewer+targets

  for (let r = 0; r < targets.length; r++) {
    const [tlng, tlat] = targets[r];
    const samples = raySamples[r];
    const targetElev = (elevs[1 + r] ?? 0) + 1; // ~1m above water/shore
    const totalKm = haversineKm(input.lat, input.lng, tlat, tlng);
    const sampleElevs = samples.map(() => {
      const e = elevs[elevIdx] ?? 0;
      elevIdx += 1;
      return e;
    });

    const terrainOk = terrainClear(
      viewerElev,
      targetElev,
      samples,
      sampleElevs,
      totalKm,
    );
    if (!terrainOk) {
      terrainBlockedRays += 1;
      continue;
    }

    const buildingHit = buildingBlocksRay(
      input.lat,
      input.lng,
      tlat,
      tlng,
      viewerElev,
      viewerGround,
      targetElev,
      buildings,
    );
    if (buildingHit) {
      buildingBlockedRays += 1;
      continue;
    }
    clearRays += 1;
  }

  const testedRays = targets.length;
  const clearRayFraction = testedRays ? clearRays / testedRays : 0;
  const score100 = viewshedScore100(clearRayFraction);
  // Need a meaningful wedge of clear ocean, not a single lucky gap
  const hasOceanView = clearRays >= 2 && score100 >= 35;

  let confidence: ViewshedConfidence = "low";
  if (testedRays >= 5 && buildings.length > 0) {
    confidence = score100 >= 50 ? "high" : "medium";
  } else if (testedRays >= 3) {
    confidence = "medium";
  }

  const detail =
    `${clearRays}/${testedRays} clear rays` +
    (buildingBlockedRays ? ` · ${buildingBlockedRays} building-blocked` : "") +
    (terrainBlockedRays ? ` · ${terrainBlockedRays} terrain-blocked` : "") +
    ` · ~${coastKm.toFixed(1)} km to coast`;

  const summary = hasOceanView
    ? `Ocean viewshed ${score100}/100 (${detail})`
    : `Ocean viewshed ${score100}/100 — no clear beach wedge (${detail})`;

  return {
    hasOceanView,
    clearRayFraction,
    score100,
    clearRays,
    testedRays,
    nearestCoastKm: coastKm,
    terrainBlockedRays,
    buildingBlockedRays,
    buildingHits: buildings.length,
    eyeHeightM,
    facingUsedDeg,
    confidence,
    summary,
    method: "dem-los+osm-buildings",
  };
}

export async function analyzeOceanViewshedBatch(
  listings: {
    id: string;
    lat: number;
    lng: number;
  }[],
  onProgress?: (done: number, total: number) => void,
): Promise<Record<string, OceanViewshedResult>> {
  const out: Record<string, OceanViewshedResult> = {};
  let done = 0;
  for (const l of listings) {
    try {
      out[l.id] = await analyzeOceanViewshed({
        lat: l.lat,
        lng: l.lng,
      });
    } catch (err) {
      console.warn(`Viewshed failed for ${l.id}`, err);
      out[l.id] = {
        hasOceanView: false,
        clearRayFraction: 0,
        score100: 0,
        clearRays: 0,
        testedRays: 0,
        nearestCoastKm: nearestCoastKm(l.lat, l.lng),
        terrainBlockedRays: 0,
        buildingBlockedRays: 0,
        buildingHits: 0,
        eyeHeightM: 5.5,
        facingUsedDeg: SUNSET_OCEAN_CONE_CENTER_DEG,
        confidence: "low",
        summary: "Ocean viewshed unavailable (elevation/Overpass error)",
        method: "dem-los+osm-buildings",
      };
    }
    done += 1;
    onProgress?.(done, listings.length);
    await sleep(450);
  }
  return out;
}
