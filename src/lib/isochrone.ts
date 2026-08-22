import type { Anchor, AnchorId } from "../types";
import { SOUTH_BAY_COASTLINE } from "../data/southBayCoastline";
import { haversineKm } from "./geo";

/**
 * Real drive-time isochrones via Valhalla (same engine as SimpleMapLab)
 * on the public FOSSGIS / OSM demo: https://valhalla1.openstreetmap.de
 *
 * Optional: OpenRouteService when an API key is provided.
 */

export type PolygonFeature = {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: [number, number][][] | [number, number][][][];
  };
};

export type IsochroneMap = Partial<Record<AnchorId, PolygonFeature>>;
export type IsochroneMode = "valhalla" | "ors" | "loading" | "error";

const VALHALLA_URL = "https://valhalla1.openstreetmap.de/isochrone";
const ORS_URL = "https://api.openrouteservice.org/v2/isochrones/driving-car";
const ORS_KEY_STORAGE = "househunter.orsApiKey";

export function getStoredOrsKey(): string {
  try {
    return localStorage.getItem(ORS_KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

export function setStoredOrsKey(key: string) {
  try {
    if (key.trim()) localStorage.setItem(ORS_KEY_STORAGE, key.trim());
    else localStorage.removeItem(ORS_KEY_STORAGE);
  } catch {
    /* ignore */
  }
}

export function resolveOrsKey(uiKey?: string): string {
  let viteKey = "";
  try {
    // Safe under Vite and Node/tsx (import.meta.env may be missing)
    viteKey =
      (import.meta as ImportMeta & { env?: { VITE_ORS_API_KEY?: string } }).env
        ?.VITE_ORS_API_KEY ?? "";
  } catch {
    viteKey = "";
  }
  return uiKey?.trim() || getStoredOrsKey() || viteKey || "";
}

/** Ray-cast point-in-polygon. Ring is [lng, lat][]. */
export function pointInRing(
  lng: number,
  lat: number,
  ring: [number, number][],
): boolean {
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

/** Exterior rings from Polygon or MultiPolygon. */
export function exteriorRings(
  feature?: PolygonFeature,
): [number, number][][] {
  if (!feature) return [];
  if (feature.geometry.type === "Polygon") {
    return [feature.geometry.coordinates[0] as [number, number][]];
  }
  return (feature.geometry.coordinates as [number, number][][][]).map(
    (poly) => poly[0],
  );
}

export function pointInIsochrone(
  lat: number,
  lng: number,
  feature?: PolygonFeature,
): boolean {
  return exteriorRings(feature).some((ring) => pointInRing(lng, lat, ring));
}

/** Distance from a point to the densified South Bay shoreline (km). */
function nearestShoreKm(lat: number, lng: number): number {
  let best = Infinity;
  for (const [clng, clat] of SOUTH_BAY_COASTLINE) {
    const d = haversineKm(lat, lng, clat, clng);
    if (d < best) best = d;
  }
  return best;
}

/**
 * True when a ring vertex sits on/near the Pacific edge (or slightly offshore).
 * Valhalla polygons hug the beach; we hide those edges so the outline doesn't
 * redraw the shoreline.
 */
export function isIsochroneVertexAlongShore(
  lat: number,
  lng: number,
  maxCoastKm = 0.85,
): boolean {
  // Ocean / marina west of a soft west bound for this map
  if (lng < -118.48 && lat < 34.05) {
    const shore = nearestShoreKm(lat, lng);
    if (shore < maxCoastKm * 1.4) return true;
  }
  return nearestShoreKm(lat, lng) < maxCoastKm;
}

/**
 * Split an isochrone exterior ring ([lng,lat][]) into inland-only polylines
 * as Leaflet [lat,lng][] paths — coastal edges omitted.
 */
export function inlandIsochronePaths(
  ring: [number, number][],
  maxCoastKm = 0.85,
): [number, number][][] {
  if (ring.length < 2) return [];
  const pts =
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
      ? ring.slice(0, -1)
      : ring;
  if (pts.length < 2) return [];

  const inland = pts.map(
    ([lng, lat]) => !isIsochroneVertexAlongShore(lat, lng, maxCoastKm),
  );

  // Fully inland — keep the whole outline
  if (inland.every(Boolean)) {
    return [pts.map(([lng, lat]) => [lat, lng] as [number, number])];
  }

  // Start after a coastal vertex so wrap-around doesn't glue two runs
  let start = inland.findIndex((v) => !v);
  if (start < 0) start = 0;

  const paths: [number, number][][] = [];
  let cur: [number, number][] = [];
  for (let k = 0; k < pts.length; k++) {
    const i = (start + k) % pts.length;
    if (inland[i]) {
      const [lng, lat] = pts[i];
      cur.push([lat, lng]);
    } else if (cur.length) {
      if (cur.length >= 2) paths.push(cur);
      cur = [];
    }
  }
  if (cur.length >= 2) paths.push(cur);
  return paths;
}

/** True if the point sits inside the union of any ready isochrone. */
export function pointInAnyIsochrone(
  lat: number,
  lng: number,
  anchors: { id: AnchorId }[],
  isochrones: IsochroneMap,
): boolean {
  const ready = anchors.filter((a) => !!isochrones[a.id]);
  if (!ready.length) return true;
  return ready.some((a) => pointInIsochrone(lat, lng, isochrones[a.id]));
}

/** True when every ready isochrone contains the point (intersection). */
export function pointInAllIsochrones(
  lat: number,
  lng: number,
  anchors: { id: AnchorId }[],
  isochrones: IsochroneMap,
): boolean {
  const ready = anchors.filter((a) => !!isochrones[a.id]);
  if (!ready.length) return true;
  return ready.every((a) => pointInIsochrone(lat, lng, isochrones[a.id]));
}

function asPolygonFeature(
  feature: PolygonFeature,
  anchor: Anchor,
  minutes: number,
  provider: "valhalla" | "ors",
): PolygonFeature {
  return {
    ...feature,
    properties: {
      ...feature.properties,
      id: anchor.id,
      minutes,
      provider,
    },
  };
}

/**
 * Valhalla isochrone — Dijkstra expansion on the OSM road graph
 * (speed limits, functional class, turn costs). Same approach as
 * https://www.simplemaplab.com/tools/drive-time-map
 */
export async function fetchValhallaIsochrone(
  anchor: Anchor,
  minutes: number,
): Promise<PolygonFeature> {
  const res = await fetch(VALHALLA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      locations: [{ lat: anchor.lat, lon: anchor.lng }],
      costing: "auto",
      contours: [{ time: minutes }],
      polygons: true,
      denoise: 0.2,
      generalize: 50,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Valhalla HTTP ${res.status}: ${text.slice(0, 160)}`);
  }

  const json = (await res.json()) as {
    features?: PolygonFeature[];
    error?: string;
  };
  if (json.error) throw new Error(`Valhalla: ${json.error}`);

  const feature = json.features?.find(
    (f) =>
      f.geometry?.type === "Polygon" || f.geometry?.type === "MultiPolygon",
  );
  if (!feature) throw new Error(`Valhalla returned no polygon for ${anchor.id}`);

  return asPolygonFeature(feature, anchor, minutes, "valhalla");
}

export async function fetchOrsIsochrone(
  anchor: Anchor,
  minutes: number,
  apiKey: string,
): Promise<PolygonFeature> {
  const res = await fetch(ORS_URL, {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      locations: [[anchor.lng, anchor.lat]],
      range: [minutes * 60],
      range_type: "time",
      smoothing: 25,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ORS HTTP ${res.status}: ${text.slice(0, 120)}`);
  }
  const json = (await res.json()) as { features?: PolygonFeature[] };
  const feature = json.features?.[0];
  if (!feature) throw new Error("ORS returned no isochrone");
  return asPolygonFeature(feature, anchor, minutes, "ors");
}

export async function buildIsochrones(
  anchors: Anchor[],
  driveMinutes: Record<AnchorId, number>,
  orsKey: string,
  onProgress?: (label: string) => void,
): Promise<{ map: IsochroneMap; mode: Exclude<IsochroneMode, "loading"> }> {
  const map: IsochroneMap = {};

  // Prefer ORS only when the user explicitly provided a key
  if (orsKey) {
    try {
      for (const a of anchors) {
        onProgress?.(`OpenRouteService isochrone: ${a.label}`);
        map[a.id] = await fetchOrsIsochrone(a, driveMinutes[a.id], orsKey);
        await new Promise((r) => setTimeout(r, 200));
      }
      return { map, mode: "ors" };
    } catch (err) {
      console.warn("ORS failed, falling back to Valhalla", err);
    }
  }

  // Fetch a couple at a time — much faster than fully serial + long sleeps
  const queue = [...anchors];
  const workers = Math.min(2, queue.length);
  async function worker() {
    while (queue.length) {
      const a = queue.shift();
      if (!a) return;
      onProgress?.(
        `Valhalla drive-time: ${a.label} (${driveMinutes[a.id]} min)`,
      );
      map[a.id] = await fetchValhallaIsochrone(a, driveMinutes[a.id]);
    }
  }
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return { map, mode: "valhalla" };
}
