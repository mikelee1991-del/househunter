import { offshoreTargets, SOUTH_BAY_COASTLINE } from "../data/southBayCoastline";
import { haversineKm } from "./geo";

/**
 * GIS ocean view + sunset view (two separate scores, one DEM pass):
 * - Ocean: clear LOS to Pacific water across a wide SW–NW wedge (coastal).
 * - Sunset: clear LOS in a narrower due-west band — can score on inland
 *   hills when western horizon is open, even without a beach wedge.
 *
 * score100 aliases oceanViewScore for older UI. House facing is ignored.
 */

export type ViewshedConfidence = "high" | "medium" | "low";

/** Wide Pacific / ocean-water look cone (SW through NW). */
export const OCEAN_CONE_CENTER_DEG = 270;
export const OCEAN_CONE_HALF_DEG = 55;
/** Narrow due-west sunset band (inland hills can still clear this). */
export const SUNSET_CONE_CENTER_DEG = 270;
export const SUNSET_CONE_HALF_DEG = 22;

/** @deprecated Use OCEAN_CONE_* — kept for decorative fans / imports */
export const SUNSET_OCEAN_CONE_CENTER_DEG = OCEAN_CONE_CENTER_DEG;
/** @deprecated Use OCEAN_CONE_HALF_DEG */
export const SUNSET_OCEAN_CONE_HALF_DEG = OCEAN_CONE_HALF_DEG;

const OCEAN_MAX_COAST_KM = 12;
const SUNSET_MAX_COAST_KM = 28;

export interface OceanViewshedResult {
  hasOceanView: boolean;
  hasSunsetView: boolean;
  /** 0–1 fraction of ocean-cone rays with clear LOS */
  clearRayFraction: number;
  /** Alias of oceanViewScore (compat) */
  score100: number;
  /** Clear LOS to Pacific water 0–100 */
  oceanViewScore: number;
  /** Clear LOS in due-west sunset band 0–100 (hills inland OK) */
  sunsetViewScore: number;
  clearRays: number;
  testedRays: number;
  sunsetClearRays: number;
  sunsetTestedRays: number;
  nearestCoastKm: number;
  terrainBlockedRays: number;
  buildingBlockedRays: number;
  buildingHits: number;
  eyeHeightM: number;
  /** Cone center used for rays (not house facing). */
  facingUsedDeg: number;
  confidence: ViewshedConfidence;
  summary: string;
  method: "dem-los+osm-buildings";
}

/** Plain-language blurb for UI captions / tooltips. */
export const OCEAN_VIEWSHED_EXPLAIN =
  "Ocean view = clear sight-lines to Pacific water. Sunset view = clear due-west horizon (can score on inland hills). A building on a ray that sticks above the eye line blocks that ray. Not about which way the house faces. Screening only — confirm on tour.";

export const SUNSET_VIEWSHED_EXPLAIN =
  "Sunset view scores how open the due-west band is from this lot. Elevated inland homes can score well when ridges do not block the western horizon — separate from beachfront ocean water views.";

/** Short label for a score or slider threshold. */
export function viewshedBandLabel(score100: number): string {
  if (score100 <= 0) return "Off";
  if (score100 < 35) return "Mostly blocked";
  if (score100 < 60) return "Usable wedge";
  return "Strong wedge";
}

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
  "https://overpass.osm.ch/api/interpreter",
];

/** Required by public Overpass mirrors — missing UA → 406/429 and empty buildings. */
const OVERPASS_HEADERS: Record<string, string> = {
  "Content-Type": "text/plain",
  Accept: "application/json",
  "User-Agent":
    "HousehunterSouthBay/0.1 (ocean-viewshed screening; https://github.com/mikelee1991-del/househunter)",
};

const elevCache = new Map<string, number>();
/** Cache Overpass buildings by ~400 m grid cell (sunset wedge filter still applied). */
const buildingCellCache = new Map<string, OsmBuilding[]>();

function elevKey(lat: number, lng: number) {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

function buildingCellKey(lat: number, lng: number) {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
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
 * Pick Pacific/offshore targets spread evenly across the sunset cone.
 *
 * Important: do NOT take the N targets closest to due-west — densified
 * coastline creates dozens of near-identical bearings, which collapses the
 * wedge into a single ray and yields bogus 0/100 or 100/100 scores.
 */
function pickOceanTargets(
  lat: number,
  lng: number,
  coneCenterDeg = OCEAN_CONE_CENTER_DEG,
  coneHalfAngle = OCEAN_CONE_HALF_DEG,
  maxTargets = 18,
  maxDistKm = 18,
): [number, number][] {
  const offshore = offshoreTargets();
  if (!offshore.length || maxTargets <= 0) return [];

  const candidates = offshore
    .map(([olng, olat]) => {
      const brg = bearingDeg(lat, lng, olat, olng);
      const delta = angleDelta(brg, coneCenterDeg);
      const dist = haversineKm(lat, lng, olat, olng);
      return { olng, olat, brg, delta, dist };
    })
    .filter((t) => t.delta <= coneHalfAngle && t.dist >= 0.35 && t.dist <= maxDistKm);

  if (candidates.length < 3) {
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

  const picked: [number, number][] = [];
  const used = new Set<string>();

  for (let i = 0; i < maxTargets; i++) {
    const t = maxTargets === 1 ? 0.5 : i / (maxTargets - 1);
    const wantBrg =
      (coneCenterDeg - coneHalfAngle + t * 2 * coneHalfAngle + 360) % 360;

    let best: (typeof candidates)[number] | null = null;
    let bestCost = Infinity;
    for (const c of candidates) {
      const key = `${c.olng.toFixed(4)},${c.olat.toFixed(4)}`;
      if (used.has(key)) continue;
      const ang = angleDelta(c.brg, wantBrg);
      if (ang > 12) continue;
      // Prefer a mid-range offshore target for stable LOS sampling
      const cost = ang + Math.abs(c.dist - 5) * 0.08;
      if (cost < bestCost) {
        bestCost = cost;
        best = c;
      }
    }
    if (!best) continue;
    const key = `${best.olng.toFixed(4)},${best.olat.toFixed(4)}`;
    used.add(key);
    picked.push([best.olng, best.olat]);
  }

  return picked.length >= 3
    ? picked
    : candidates
        .sort((a, b) => a.delta - b.delta || a.dist - b.dist)
        .slice(0, maxTargets)
        .map((t) => [t.olng, t.olat] as [number, number]);
}

function samplesAlongRay(
  lat0: number,
  lng0: number,
  lat1: number,
  lng1: number,
  stepKm = 0.22,
): SamplePoint[] {
  const total = haversineKm(lat0, lng0, lat1, lng1);
  if (total < 0.05) return [];
  const n = Math.max(6, Math.min(28, Math.ceil(total / stepKm)));
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
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${OPENTOPO_URL}?locations=${locations}`);
    if (res.status === 429) {
      await sleep(1200 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`OpenTopoData HTTP ${res.status}`);
    const json = (await res.json()) as {
      results?: { elevation: number | null }[];
    };
    return (json.results ?? []).map((r) => r.elevation ?? 0);
  }
  throw new Error("OpenTopoData HTTP 429");
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
    } else {
      // Open-Meteo occasionally returns 0 on dry land (void / water mask).
      // Those false zeros make hill lots look like beach flats.
      const suspect = batch
        .map((b, j) => ({ b, j, e: elevs![j] }))
        .filter(({ e, b }) => e == null || (e <= 0.5 && b.lng > -118.49));
      if (suspect.length) {
        await sleep(1100);
        try {
          const ned = await fetchOpenTopoChunk(suspect.map((s) => s.b));
          suspect.forEach((s, k) => {
            if (ned[k] != null && Number.isFinite(ned[k])) {
              elevs![s.j] = ned[k];
            }
          });
        } catch {
          /* keep Open-Meteo values */
        }
      }
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
  radiusM = 900,
): Promise<OsmBuilding[]> {
  const cell = buildingCellKey(lat, lng);
  const cached = buildingCellCache.get(cell);
  if (cached) {
    return cached.filter((b) => {
      const dist = haversineKm(lat, lng, b.lat, b.lng) * 1000;
      if (dist < 25 || dist > radiusM) return false;
      const brg = bearingDeg(lat, lng, b.lat, b.lng);
      return angleDelta(brg, coneCenterDeg) <= SUNSET_OCEAN_CONE_HALF_DEG;
    });
  }

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
        headers: OVERPASS_HEADERS,
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

      const cellBuildings: OsmBuilding[] = [];
      for (const el of json.elements ?? []) {
        const blat = el.center?.lat ?? el.lat;
        const blng = el.center?.lon ?? el.lon;
        if (blat == null || blng == null) continue;
        const dist = haversineKm(lat, lng, blat, blng) * 1000;
        if (dist > radiusM * 1.05) continue;
        const heightM = estimateBuildingHeight(el.tags ?? {});
        if (heightM < 5) continue;
        cellBuildings.push({ lat: blat, lng: blng, heightM });
      }
      buildingCellCache.set(cell, cellBuildings);
      return cellBuildings.filter((b) => {
        const dist = haversineKm(lat, lng, b.lat, b.lng) * 1000;
        if (dist < 25 || dist > radiusM) return false;
        const brg = bearingDeg(lat, lng, b.lat, b.lng);
        return angleDelta(brg, coneCenterDeg) <= SUNSET_OCEAN_CONE_HALF_DEG;
      });
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
  coastKm: number,
): boolean {
  const totalKm = haversineKm(lat0, lng0, lat1, lng1);
  if (totalKm < 0.05) return false;
  const brgTarget = bearingDeg(lat0, lng0, lat1, lng1);
  // Only buildings on the land approach to water can occlude. Strand lots
  // looking west usually have nothing on-ray — not because of a distance
  // carve-out, but because the next “lot” is sand/ocean.
  const maxOccKm = Math.max(0.08, coastKm + 0.04);

  for (const b of buildings) {
    const dViewer = haversineKm(lat0, lng0, b.lat, b.lng);
    if (dViewer < 0.03 || dViewer > maxOccKm) continue;
    if (dViewer > totalKm) continue;
    const brgB = bearingDeg(lat0, lng0, b.lat, b.lng);
    // House next door / next row must sit on this sightline
    if (angleDelta(brgTarget, brgB) > 6) continue;

    const t = Math.min(0.98, Math.max(0.02, dViewer / totalKm));
    const losElev = viewerElev + (targetElev - viewerElev) * t;
    // Flat-peer roof at our ground + building height. A higher viewer
    // (hill / upper story) can clear the same roof; a blocked second-row
    // lot cannot.
    const buildingTop = viewerGround + b.heightM;
    if (buildingTop > losElev + 0.5) return true;
  }
  return false;
}

/**
 * When Overpass is empty/rate-limited, invent modest urban fabric on the
 * flat land approach. Same rule: roof on the sightline above LOS → blocked.
 * Hills skip the proxy (DEM owns terrain; fake rooftops over-block bluffs).
 */
function syntheticUrbanBlocksRay(
  viewerElev: number,
  viewerGround: number,
  targetElev: number,
  samples: SamplePoint[],
  sampleElevs: number[],
  totalKm: number,
  coastKm: number,
): boolean {
  if (viewerGround >= 35) return false;
  // Only invent fabric inland of the first beach blocks. Near-shore lots
  // either have OSM buildings or look onto sand/water — don't fake a wall.
  if (coastKm < 0.65) return false;
  const maxBlockKm = Math.min(coastKm - 0.05, 1.6);
  if (maxBlockKm < 0.06) return false;

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (s.distKm < 0.05 || s.distKm > maxBlockKm) continue;
    const ground = sampleElevs[i] ?? viewerGround;
    if (ground > viewerGround + 12) continue;
    const t = Math.min(0.98, Math.max(0.02, s.distKm / totalKm));
    const losElev = viewerElev + (targetElev - viewerElev) * t;
    const obstacleTop = ground + 9.5;
    if (obstacleTop > losElev + 0.5) return true;
  }
  return false;
}

export async function analyzeOceanViewshed(input: {
  lat: number;
  lng: number;
  /** @deprecated Ignored — viewshed uses ocean/sunset azimuth, not house facing */
  facingDegrees?: number;
  /** Extra eye height above DEM ground (upper-story window ≈ 5–6m) */
  eyeHeightM?: number;
}): Promise<OceanViewshedResult> {
  const facingUsedDeg = OCEAN_CONE_CENTER_DEG;
  const eyeHeightM = input.eyeHeightM ?? 6.5;
  const coastKm = nearestCoastKm(input.lat, input.lng);

  const empty = (
    summary: string,
    confidence: ViewshedConfidence = "low",
  ): OceanViewshedResult => ({
    hasOceanView: false,
    hasSunsetView: false,
    clearRayFraction: 0,
    score100: 0,
    oceanViewScore: 0,
    sunsetViewScore: 0,
    clearRays: 0,
    testedRays: 0,
    sunsetClearRays: 0,
    sunsetTestedRays: 0,
    nearestCoastKm: coastKm,
    terrainBlockedRays: 0,
    buildingBlockedRays: 0,
    buildingHits: 0,
    eyeHeightM,
    facingUsedDeg,
    confidence,
    summary,
    method: "dem-los+osm-buildings",
  });

  if (coastKm > SUNSET_MAX_COAST_KM) {
    return empty(
      `Viewshed 0/100 — too far inland for ocean/sunset GIS (~${coastKm.toFixed(1)} km to coast)`,
    );
  }

  // Ocean: wide Pacific wedge (coastal). Sunset: narrower west band, longer reach.
  const wantOcean = coastKm <= OCEAN_MAX_COAST_KM;
  const oceanTargets = wantOcean
    ? pickOceanTargets(
        input.lat,
        input.lng,
        OCEAN_CONE_CENTER_DEG,
        OCEAN_CONE_HALF_DEG,
        18,
        18,
      )
    : [];
  const sunsetTargets = pickOceanTargets(
    input.lat,
    input.lng,
    SUNSET_CONE_CENTER_DEG,
    SUNSET_CONE_HALF_DEG,
    12,
    coastKm <= 12 ? 18 : 35,
  );

  // Merge unique targets; tag which scores each ray feeds
  type Tagged = { lng: number; lat: number; ocean: boolean; sunset: boolean };
  const byKey = new Map<string, Tagged>();
  for (const [lng, lat] of oceanTargets) {
    const key = `${lng.toFixed(5)},${lat.toFixed(5)}`;
    const prev = byKey.get(key);
    if (prev) prev.ocean = true;
    else byKey.set(key, { lng, lat, ocean: true, sunset: false });
  }
  for (const [lng, lat] of sunsetTargets) {
    const key = `${lng.toFixed(5)},${lat.toFixed(5)}`;
    const prev = byKey.get(key);
    if (prev) prev.sunset = true;
    else byKey.set(key, { lng, lat, ocean: false, sunset: true });
  }
  // Ensure sunset-band ocean targets also count for sunset
  for (const t of byKey.values()) {
    if (!t.sunset) {
      const brg = bearingDeg(input.lat, input.lng, t.lat, t.lng);
      if (angleDelta(brg, SUNSET_CONE_CENTER_DEG) <= SUNSET_CONE_HALF_DEG) {
        t.sunset = true;
      }
    }
  }

  const tagged = [...byKey.values()];
  if (!tagged.length) {
    return empty("Viewshed 0/100 — no ocean/sunset targets in view cones");
  }

  const raySamples = tagged.map((t) =>
    samplesAlongRay(input.lat, input.lng, t.lat, t.lng, 0.22),
  );
  const allPoints: { lat: number; lng: number }[] = [
    { lat: input.lat, lng: input.lng },
    ...tagged.map((t) => ({ lat: t.lat, lng: t.lng })),
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
    900,
  );

  let oceanClear = 0;
  let oceanTested = 0;
  let sunsetClear = 0;
  let sunsetTested = 0;
  let terrainBlockedRays = 0;
  let buildingBlockedRays = 0;
  let elevIdx = 1 + tagged.length;

  for (let r = 0; r < tagged.length; r++) {
    const t = tagged[r];
    const samples = raySamples[r];
    const targetElev = (elevs[1 + r] ?? 0) + 1;
    const totalKm = haversineKm(input.lat, input.lng, t.lat, t.lng);
    const sampleElevs = samples.map(() => {
      const e = elevs[elevIdx] ?? 0;
      elevIdx += 1;
      return e;
    });

    if (t.ocean) oceanTested += 1;
    if (t.sunset) sunsetTested += 1;

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

    let buildingHit = buildingBlocksRay(
      input.lat,
      input.lng,
      t.lat,
      t.lng,
      viewerElev,
      viewerGround,
      targetElev,
      buildings,
      coastKm,
    );
    if (!buildingHit && buildings.length === 0) {
      buildingHit = syntheticUrbanBlocksRay(
        viewerElev,
        viewerGround,
        targetElev,
        samples,
        sampleElevs,
        totalKm,
        coastKm,
      );
    }
    if (buildingHit) {
      buildingBlockedRays += 1;
      continue;
    }
    if (t.ocean) oceanClear += 1;
    if (t.sunset) sunsetClear += 1;
  }

  const oceanViewScore = viewshedScore100(
    oceanTested ? oceanClear / oceanTested : 0,
  );
  const sunsetViewScore = viewshedScore100(
    sunsetTested ? sunsetClear / sunsetTested : 0,
  );
  const clearRayFraction = oceanTested ? oceanClear / oceanTested : 0;
  const score100 = oceanViewScore;
  const hasOceanView = oceanClear >= 2 && oceanViewScore >= 35;
  const hasSunsetView = sunsetClear >= 2 && sunsetViewScore >= 35;

  let confidence: ViewshedConfidence = "low";
  const tested = Math.max(oceanTested, sunsetTested);
  if (tested >= 12 && buildings.length > 0) {
    confidence =
      Math.max(oceanViewScore, sunsetViewScore) >= 50 ? "high" : "medium";
  } else if (tested >= 8) {
    confidence = "medium";
  }

  const detail =
    `ocean ${oceanClear}/${oceanTested}` +
    ` · sunset ${sunsetClear}/${sunsetTested}` +
    (buildingBlockedRays ? ` · ${buildingBlockedRays} building-blocked` : "") +
    (terrainBlockedRays ? ` · ${terrainBlockedRays} terrain-blocked` : "") +
    ` · ~${coastKm.toFixed(1)} km to coast`;

  const summary = `Ocean ${oceanViewScore}/100 · Sunset ${sunsetViewScore}/100 (${detail})`;

  return {
    hasOceanView,
    hasSunsetView,
    clearRayFraction,
    score100,
    oceanViewScore,
    sunsetViewScore,
    clearRays: oceanClear,
    testedRays: oceanTested,
    sunsetClearRays: sunsetClear,
    sunsetTestedRays: sunsetTested,
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
        hasSunsetView: false,
        clearRayFraction: 0,
        score100: 0,
        oceanViewScore: 0,
        sunsetViewScore: 0,
        clearRays: 0,
        testedRays: 0,
        sunsetClearRays: 0,
        sunsetTestedRays: 0,
        nearestCoastKm: nearestCoastKm(l.lat, l.lng),
        terrainBlockedRays: 0,
        buildingBlockedRays: 0,
        buildingHits: 0,
        eyeHeightM: 5.5,
        facingUsedDeg: OCEAN_CONE_CENTER_DEG,
        confidence: "low",
        summary: "Ocean/sunset viewshed unavailable (elevation/Overpass error)",
        method: "dem-los+osm-buildings",
      };
    }
    done += 1;
    onProgress?.(done, listings.length);
    await sleep(450);
  }
  return out;
}
