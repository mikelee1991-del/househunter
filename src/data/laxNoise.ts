/**
 * Approximate LAX CNEL contours for planning (not official LAWA polygons).
 * Shapes follow the known east–west runway / overflight pattern:
 * elongated lobes over Westchester, Inglewood, El Segundo, and offshore.
 * Source inspiration: LAWA quarterly CNEL maps (PDF only publicly).
 */
export type NoiseBand = 65 | 70 | 75;

export interface NoisePolygon {
  cnel: NoiseBand;
  coordinates: [number, number][]; // [lng, lat] rings, closed
}

/** Outer ring first; rings are closed (first === last). */
export const LAX_NOISE_POLYGONS: NoisePolygon[] = [
  {
    cnel: 65,
    coordinates: [
      [-118.52, 33.955],
      [-118.48, 33.965],
      [-118.42, 33.97],
      [-118.36, 33.968],
      [-118.30, 33.96],
      [-118.26, 33.95],
      [-118.24, 33.935],
      [-118.25, 33.92],
      [-118.28, 33.91],
      [-118.34, 33.905],
      [-118.40, 33.902],
      [-118.46, 33.905],
      [-118.50, 33.915],
      [-118.52, 33.93],
      [-118.52, 33.955],
    ],
  },
  {
    cnel: 70,
    coordinates: [
      [-118.48, 33.95],
      [-118.44, 33.958],
      [-118.40, 33.96],
      [-118.35, 33.958],
      [-118.31, 33.95],
      [-118.29, 33.938],
      [-118.30, 33.925],
      [-118.34, 33.918],
      [-118.39, 33.915],
      [-118.44, 33.918],
      [-118.47, 33.928],
      [-118.48, 33.94],
      [-118.48, 33.95],
    ],
  },
  {
    cnel: 75,
    coordinates: [
      [-118.45, 33.945],
      [-118.42, 33.95],
      [-118.39, 33.95],
      [-118.36, 33.945],
      [-118.345, 33.935],
      [-118.35, 33.925],
      [-118.38, 33.92],
      [-118.42, 33.92],
      [-118.445, 33.928],
      [-118.45, 33.938],
      [-118.45, 33.945],
    ],
  },
];

/** Point-in-polygon (ray cast). coords are [lng, lat]. */
function pointInRing(lng: number, lat: number, ring: [number, number][]): boolean {
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

/** Highest CNEL band containing the point, or 0 if outside modeled contours. */
export function estimateNoiseCnel(lat: number, lng: number): number {
  let max = 0;
  for (const poly of LAX_NOISE_POLYGONS) {
    if (pointInRing(lng, lat, poly.coordinates)) {
      max = Math.max(max, poly.cnel);
    }
  }
  // Soft falloff just outside 65 contour for scoring nuance
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
