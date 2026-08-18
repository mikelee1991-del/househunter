/**
 * Approximate South Bay freeway / highway centerlines for traffic-noise screening.
 * Coordinates are [lng, lat]. Not survey-grade — corridor geometry for distance decay.
 */
export type HighwayClass = "freeway" | "coastal";

export interface HighwayCorridor {
  id: string;
  name: string;
  /** Freeway ≈ louder reference; coastal arterials a bit quieter. */
  klass: HighwayClass;
  coordinates: [number, number][];
}

/**
 * Major noise-dominant roads through the South Bay search area.
 * Simplified centerlines (enough for residential screening buffers).
 */
export const HIGHWAY_CORRIDORS: HighwayCorridor[] = [
  {
    id: "i405",
    name: "I-405 San Diego Fwy",
    klass: "freeway",
    coordinates: [
      [-118.442, 34.02],
      [-118.418, 33.99],
      [-118.396, 33.96],
      [-118.378, 33.93],
      [-118.368, 33.90],
      [-118.358, 33.87],
      [-118.348, 33.84],
      [-118.338, 33.81],
      [-118.325, 33.78],
      [-118.310, 33.75],
      [-118.295, 33.72],
      [-118.280, 33.70],
    ],
  },
  {
    id: "i105",
    name: "I-105 Century Fwy",
    klass: "freeway",
    coordinates: [
      [-118.430, 33.932],
      [-118.400, 33.930],
      [-118.370, 33.929],
      [-118.340, 33.928],
      [-118.310, 33.928],
      [-118.280, 33.929],
      [-118.250, 33.931],
      [-118.230, 33.933],
    ],
  },
  {
    id: "i110",
    name: "I-110 Harbor Fwy",
    klass: "freeway",
    coordinates: [
      [-118.282, 34.02],
      [-118.280, 33.98],
      [-118.278, 33.94],
      [-118.276, 33.90],
      [-118.274, 33.86],
      [-118.272, 33.82],
      [-118.278, 33.78],
      [-118.288, 33.74],
      [-118.292, 33.71],
    ],
  },
  {
    id: "sr91",
    name: "SR-91 Artesia Fwy",
    klass: "freeway",
    coordinates: [
      [-118.360, 33.868],
      [-118.330, 33.867],
      [-118.300, 33.866],
      [-118.270, 33.865],
      [-118.240, 33.866],
      [-118.210, 33.868],
    ],
  },
  {
    id: "i10",
    name: "I-10 Santa Monica Fwy",
    klass: "freeway",
    coordinates: [
      [-118.480, 34.018],
      [-118.450, 34.020],
      [-118.420, 34.025],
      [-118.390, 34.030],
      [-118.360, 34.033],
      [-118.330, 34.035],
      [-118.290, 34.038],
      [-118.250, 34.040],
    ],
  },
  {
    id: "pch",
    name: "PCH / SR-1",
    klass: "coastal",
    coordinates: [
      [-118.475, 34.01],
      [-118.460, 33.98],
      [-118.445, 33.95],
      [-118.430, 33.92],
      [-118.415, 33.89],
      [-118.400, 33.86],
      [-118.395, 33.84],
      [-118.390, 33.81],
      [-118.385, 33.78],
      [-118.380, 33.75],
      [-118.360, 33.72],
    ],
  },
];
