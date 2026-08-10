import type { Anchor, AnchorId } from "../types";

const EARTH_KM = 6371;

export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(a));
}

/**
 * Rough South Bay drive-time model: ~22 mph average with coastal congestion.
 * Used when OpenRouteService is unavailable. Not a routing substitute.
 */
export function estimateDriveMinutes(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): number {
  const km = haversineKm(fromLat, fromLng, toLat, toLng);
  const avgMph = 22;
  const miles = km * 0.621371;
  return Math.round((miles / avgMph) * 60);
}

export function driveMinutesToAnchors(
  lat: number,
  lng: number,
  anchors: Anchor[],
): Record<AnchorId, number> {
  const out = {} as Record<AnchorId, number>;
  for (const a of anchors) {
    out[a.id] = estimateDriveMinutes(lat, lng, a.lat, a.lng);
  }
  return out;
}

/** Build a simple circular isochrone ring (approximation). */
export function circleRing(
  lat: number,
  lng: number,
  radiusKm: number,
  steps = 64,
): [number, number][] {
  const coords: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const bearing = (i / steps) * 2 * Math.PI;
    const dLat = (radiusKm / EARTH_KM) * Math.cos(bearing);
    const dLng =
      (radiusKm / (EARTH_KM * Math.cos((lat * Math.PI) / 180))) *
      Math.sin(bearing);
    coords.push([lng + (dLng * 180) / Math.PI, lat + (dLat * 180) / Math.PI]);
  }
  return coords;
}

/** Convert drive minutes → approximate radius km at 22 mph. */
export function minutesToRadiusKm(minutes: number): number {
  const miles = (minutes / 60) * 22;
  return miles * 1.60934;
}
