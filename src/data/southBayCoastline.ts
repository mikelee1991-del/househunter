/**
 * Simplified Pacific shoreline polyline for the South Bay search area.
 * Coordinates are [lng, lat], ordered roughly north → south.
 * Used as ocean-view targets for GIS line-of-sight (not legal shoreline).
 */
export const SOUTH_BAY_COASTLINE: [number, number][] = [
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

/** Points pushed slightly offshore (~400m west) so targets sit over water. */
export function offshoreTargets(
  coastline: [number, number][] = SOUTH_BAY_COASTLINE,
  westKm = 0.4,
): [number, number][] {
  const R = 6371;
  return coastline.map(([lng, lat]) => {
    const dLng =
      ((westKm / (R * Math.cos((lat * Math.PI) / 180))) * 180) / Math.PI;
    return [lng - dLng, lat] as [number, number];
  });
}
