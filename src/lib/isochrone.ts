import type { Anchor, AnchorId } from "../types";

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
  return (
    uiKey?.trim() ||
    getStoredOrsKey() ||
    import.meta.env.VITE_ORS_API_KEY ||
    ""
  );
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
        await new Promise((r) => setTimeout(r, 350));
      }
      return { map, mode: "ors" };
    } catch (err) {
      console.warn("ORS failed, falling back to Valhalla", err);
    }
  }

  for (const a of anchors) {
    onProgress?.(`Valhalla drive-time: ${a.label} (${driveMinutes[a.id]} min)`);
    map[a.id] = await fetchValhallaIsochrone(a, driveMinutes[a.id]);
    // Be polite to the public FOSSGIS demo server
    await new Promise((r) => setTimeout(r, 400));
  }
  return { map, mode: "valhalla" };
}
