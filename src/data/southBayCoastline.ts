/**
 * Pacific shoreline polyline for the South Bay search area.
 * Coordinates are [lng, lat], ordered roughly north → south.
 * Used as ocean-view targets for GIS line-of-sight (not legal shoreline).
 *
 * Base vertices are hand-placed; densifyPolyline() fills gaps so each lot
 * gets many distinct sunset-band bearings (address-level ray density).
 */
export const SOUTH_BAY_COASTLINE_VERTICES: [number, number][] = [
  [-118.475, 34.02], // Venice / Marina north
  [-118.48, 33.995],
  [-118.47, 33.97], // Playa del Rey
  [-118.455, 33.955],
  [-118.445, 33.94], // Dockweiler
  [-118.435, 33.925], // El Segundo beach
  [-118.425, 33.91],
  [-118.42, 33.895], // Manhattan Beach
  [-118.412, 33.875], // Hermosa
  [-118.405, 33.855],
  [-118.4, 33.84], // Redondo / King Harbor
  [-118.395, 33.825],
  [-118.405, 33.81], // PV north bluffs
  [-118.41, 33.79],
  [-118.42, 33.77],
  [-118.43, 33.755],
  [-118.425, 33.74], // Portuguese Bend area
  [-118.4, 33.73],
  [-118.37, 33.72], // Long Point / Terranea
  [-118.34, 33.71],
  [-118.32, 33.705], // Point Fermin approach
];

const EARTH_KM = 6371;

function haversineKm(
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

/** Insert vertices so consecutive points are ≤ maxSegKm apart. */
export function densifyPolyline(
  coords: [number, number][],
  maxSegKm = 0.25,
): [number, number][] {
  if (coords.length < 2) return coords.slice();
  const out: [number, number][] = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    const [lng0, lat0] = out[out.length - 1];
    const [lng1, lat1] = coords[i];
    const dist = haversineKm(lat0, lng0, lat1, lng1);
    const n = Math.max(1, Math.ceil(dist / maxSegKm));
    for (let s = 1; s <= n; s++) {
      const t = s / n;
      out.push([lng0 + (lng1 - lng0) * t, lat0 + (lat1 - lat0) * t]);
    }
  }
  return out;
}

/** Densified shoreline (~250 m vertices) for nearest-coast + ray targets. */
export const SOUTH_BAY_COASTLINE: [number, number][] = densifyPolyline(
  SOUTH_BAY_COASTLINE_VERTICES,
  0.25,
);

/**
 * Points pushed slightly offshore so targets sit over water.
 * Uses multiple offsets so each lot gets a denser fan of bearings.
 */
export function offshoreTargets(
  coastline: [number, number][] = SOUTH_BAY_COASTLINE,
  westKmOffsets: number[] = [0.25, 0.55, 1.0],
): [number, number][] {
  const R = 6371;
  const out: [number, number][] = [];
  for (const westKm of westKmOffsets) {
    for (const [lng, lat] of coastline) {
      const dLng =
        ((westKm / (R * Math.cos((lat * Math.PI) / 180))) * 180) / Math.PI;
      out.push([lng - dLng, lat]);
    }
  }
  return out;
}
