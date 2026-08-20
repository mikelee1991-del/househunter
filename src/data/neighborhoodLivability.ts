/**
 * Neighborhood livability context for the South Bay search area.
 *
 * Safety: relative 0–100 index (higher = safer), derived from published
 * city/neighborhood Part I crime rates vs LA County norms (CA DOJ / local PD
 * summaries). Not address-level and not a prediction of victimization.
 *
 * Walk fallback: used only if the EPA block-group query fails.
 * Live walk scores come from EPA National Walkability Index (1–20).
 */

export interface NeighborhoodLivability {
  name: string;
  /** 0–100, higher = lower relative crime */
  safetyScore: number;
  safetyLabel: "Very low crime" | "Low crime" | "Moderate" | "Elevated";
  /** Fallback EPA-like walk index 1–20 */
  walkFallback: number;
  note: string;
  /** Approximate [lat, lng][] ring for choropleth (not legal boundaries) */
  polygon: [number, number][];
}

function ring(points: [number, number][]): [number, number][] {
  if (!points.length) return points;
  const first = points[0];
  const last = points[points.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return points;
  return [...points, first];
}

function safetyLabel(score: number): NeighborhoodLivability["safetyLabel"] {
  if (score >= 88) return "Very low crime";
  if (score >= 75) return "Low crime";
  if (score >= 60) return "Moderate";
  return "Elevated";
}

type NeighborhoodSeed = Omit<NeighborhoodLivability, "safetyLabel">;

const RAW: NeighborhoodSeed[] = [
  {
    name: "Palos Verdes Estates",
    safetyScore: 95,
    walkFallback: 10,
    note: "Among the lowest crime cities in LA County; hillside form lowers walk scores.",
    polygon: ring([
      [33.81, -118.41],
      [33.81, -118.37],
      [33.78, -118.37],
      [33.78, -118.41],
    ]),
  },
  {
    name: "Rancho Palos Verdes",
    safetyScore: 93,
    walkFallback: 12,
    note: "Very low crime; coastal bluffs — walkability varies pocket to pocket.",
    polygon: ring([
      [33.78, -118.42],
      [33.78, -118.35],
      [33.72, -118.35],
      [33.72, -118.42],
    ]),
  },
  {
    name: "Manhattan Beach",
    safetyScore: 90,
    walkFallback: 15,
    note: "Very low crime beach city; hill vs strand walkability differs.",
    polygon: ring([
      [33.905, -118.425],
      [33.905, -118.385],
      [33.875, -118.385],
      [33.875, -118.425],
    ]),
  },
  {
    name: "Hermosa Beach",
    safetyScore: 88,
    walkFallback: 17,
    note: "Low crime, compact grid — often EPA “most walkable.”",
    polygon: ring([
      [33.875, -118.415],
      [33.875, -118.385],
      [33.85, -118.385],
      [33.85, -118.415],
    ]),
  },
  {
    name: "El Segundo",
    safetyScore: 86,
    walkFallback: 13,
    note: "Low crime small city; industrial edge near LAX.",
    polygon: ring([
      [33.935, -118.435],
      [33.935, -118.385],
      [33.905, -118.385],
      [33.905, -118.435],
    ]),
  },
  {
    name: "Redondo Beach",
    safetyScore: 84,
    walkFallback: 16,
    note: "Low-moderate crime; south esplanade walks well, north more mixed.",
    polygon: ring([
      [33.87, -118.41],
      [33.87, -118.365],
      [33.81, -118.365],
      [33.81, -118.41],
    ]),
  },
  {
    name: "Torrance",
    safetyScore: 80,
    walkFallback: 14,
    note: "Broad city — safety and walk vary by pocket; hills quieter than strips.",
    polygon: ring([
      [33.87, -118.365],
      [33.87, -118.31],
      [33.80, -118.31],
      [33.80, -118.365],
    ]),
  },
  {
    name: "Playa del Rey",
    safetyScore: 78,
    walkFallback: 14,
    note: "Relatively low crime for LA city; bluff vs flat walk differs.",
    polygon: ring([
      [33.97, -118.46],
      [33.97, -118.425],
      [33.94, -118.425],
      [33.94, -118.46],
    ]),
  },
  {
    name: "Marina del Rey",
    safetyScore: 76,
    walkFallback: 14,
    note: "Marina-adjacent; property crime can run higher than beach cities.",
    polygon: ring([
      [33.99, -118.47],
      [33.99, -118.43],
      [33.96, -118.43],
      [33.96, -118.47],
    ]),
  },
  {
    name: "Playa Vista",
    safetyScore: 80,
    walkFallback: 15,
    note: "Newer master-planned pocket; relatively low crime, solid walk scores on the campus grid.",
    polygon: ring([
      [33.99, -118.43],
      [33.99, -118.40],
      [33.96, -118.40],
      [33.96, -118.43],
    ]),
  },
  {
    name: "Del Rey",
    safetyScore: 74,
    walkFallback: 14,
    note: "Between Marina and Culver — quieter than central LA, denser than beach cities.",
    polygon: ring([
      [34.015, -118.445],
      [34.015, -118.405],
      [33.985, -118.405],
      [33.985, -118.445],
    ]),
  },
  {
    name: "Westchester",
    safetyScore: 72,
    walkFallback: 13,
    note: "Near LAX — safer than many LA neighborhoods but above beach-city crime.",
    polygon: ring([
      [33.98, -118.44],
      [33.98, -118.38],
      [33.945, -118.38],
      [33.945, -118.44],
    ]),
  },
  {
    name: "Mar Vista",
    safetyScore: 70,
    walkFallback: 14,
    note: "Westside LA pocket; more urban crime profile than South Bay beach cities.",
    polygon: ring([
      [34.02, -118.45],
      [34.02, -118.41],
      [33.99, -118.41],
      [33.99, -118.45],
    ]),
  },
  {
    name: "San Pedro",
    safetyScore: 58,
    walkFallback: 13,
    note: "Harbor area — wider crime variance; check block carefully.",
    polygon: ring([
      [33.76, -118.32],
      [33.76, -118.27],
      [33.71, -118.27],
      [33.71, -118.32],
    ]),
  },
  {
    name: "Culver City",
    safetyScore: 74,
    walkFallback: 15,
    note: "Independent city west of LA — moderate-low crime, solid downtown walk.",
    polygon: ring([
      [34.03, -118.42],
      [34.03, -118.37],
      [33.99, -118.37],
      [33.99, -118.42],
    ]),
  },
  {
    name: "Venice",
    safetyScore: 62,
    walkFallback: 16,
    note: "Tourist/boardwalk density lifts property crime vs quieter Westside pockets.",
    polygon: ring([
      [34.00, -118.48],
      [34.00, -118.445],
      [33.97, -118.445],
      [33.97, -118.48],
    ]),
  },
  {
    name: "Rolling Hills Estates",
    safetyScore: 92,
    walkFallback: 10,
    note: "Peninsula city — very low crime; car-oriented hills.",
    polygon: ring([
      [33.80, -118.38],
      [33.80, -118.34],
      [33.76, -118.34],
      [33.76, -118.38],
    ]),
  },
  {
    name: "Rolling Hills",
    safetyScore: 94,
    walkFallback: 6,
    note: "Gated equestrian community — among lowest crime; minimal walk grid.",
    polygon: ring([
      [33.78, -118.37],
      [33.78, -118.33],
      [33.74, -118.33],
      [33.74, -118.37],
    ]),
  },
  {
    name: "Lomita",
    safetyScore: 72,
    walkFallback: 13,
    note: "Small city between Torrance and the harbor — moderate overall.",
    polygon: ring([
      [33.81, -118.33],
      [33.81, -118.30],
      [33.78, -118.30],
      [33.78, -118.33],
    ]),
  },
  {
    name: "Harbor City",
    safetyScore: 60,
    walkFallback: 12,
    note: "Harbor-adjacent LA neighborhood — wider crime variance by block.",
    polygon: ring([
      [33.81, -118.31],
      [33.81, -118.27],
      [33.77, -118.27],
      [33.77, -118.31],
    ]),
  },
  {
    name: "Wilmington",
    safetyScore: 52,
    walkFallback: 12,
    note: "Industrial harbor district — elevated crime vs beach cities; verify block.",
    polygon: ring([
      [33.80, -118.28],
      [33.80, -118.23],
      [33.76, -118.23],
      [33.76, -118.28],
    ]),
  },
  {
    name: "Carson",
    safetyScore: 65,
    walkFallback: 12,
    note: "Inland South Bay city — moderate crime; pockets vary widely.",
    polygon: ring([
      [33.88, -118.29],
      [33.88, -118.22],
      [33.80, -118.22],
      [33.80, -118.29],
    ]),
  },
  {
    name: "Hawthorne",
    safetyScore: 58,
    walkFallback: 13,
    note: "Near LAX/Inglewood corridor — elevated vs beach cities.",
    polygon: ring([
      [33.94, -118.38],
      [33.94, -118.32],
      [33.89, -118.32],
      [33.89, -118.38],
    ]),
  },
  {
    name: "Lawndale",
    safetyScore: 62,
    walkFallback: 13,
    note: "Compact inland city between Redondo and Hawthorne.",
    polygon: ring([
      [33.90, -118.37],
      [33.90, -118.33],
      [33.87, -118.33],
      [33.87, -118.37],
    ]),
  },
  {
    name: "Gardena",
    safetyScore: 60,
    walkFallback: 13,
    note: "Inland South Bay — moderate crime; check neighborhood carefully.",
    polygon: ring([
      [33.91, -118.33],
      [33.91, -118.28],
      [33.86, -118.28],
      [33.86, -118.33],
    ]),
  },
  {
    name: "Inglewood",
    safetyScore: 55,
    walkFallback: 13,
    note: "LAX-east city — elevated crime overall; new SoFi corridor is mixed.",
    polygon: ring([
      [33.98, -118.37],
      [33.98, -118.32],
      [33.93, -118.32],
      [33.93, -118.37],
    ]),
  },
  {
    name: "Santa Monica",
    safetyScore: 70,
    walkFallback: 16,
    note: "Coastal Westside city — strong walk grid near downtown and Pico.",
    polygon: ring([
      [34.05, -118.515],
      [34.05, -118.45],
      [33.995, -118.45],
      [33.995, -118.515],
    ]),
  },
  {
    name: "Pacific Palisades",
    safetyScore: 88,
    walkFallback: 9,
    note: "Affluent coastal canyon community — low crime, lower walk scores on hills.",
    polygon: ring([
      [34.08, -118.56],
      [34.08, -118.50],
      [34.03, -118.50],
      [34.03, -118.56],
    ]),
  },
  {
    name: "West Los Angeles",
    safetyScore: 68,
    walkFallback: 15,
    note: "Sawtelle / West LA corridor — denser urban walk, mixed crime profile.",
    polygon: ring([
      [34.06, -118.46],
      [34.06, -118.40],
      [34.02, -118.40],
      [34.02, -118.46],
    ]),
  },
  {
    name: "Palms",
    safetyScore: 66,
    walkFallback: 15,
    note: "Dense Westside pocket between Culver and Santa Monica Freeway.",
    polygon: ring([
      [34.03, -118.42],
      [34.03, -118.38],
      [34.00, -118.38],
      [34.00, -118.42],
    ]),
  },
  {
    name: "Ladera Heights",
    safetyScore: 72,
    walkFallback: 11,
    note: "Unincorporated pocket near View Park — residential, moderate walk.",
    polygon: ring([
      [33.99, -118.38],
      [33.99, -118.34],
      [33.96, -118.34],
      [33.96, -118.38],
    ]),
  },
];

export const NEIGHBORHOOD_LIVABILITY: NeighborhoodLivability[] = RAW.map((n) => ({
  ...n,
  safetyLabel: safetyLabel(n.safetyScore),
}));

export const LIVABILITY_BY_NAME = Object.fromEntries(
  NEIGHBORHOOD_LIVABILITY.map((n) => [n.name, n]),
) as Record<string, NeighborhoodLivability>;

/** EPA National Walkability Index band labels (official breakpoints). */
export function walkBandLabel(natWalkInd: number): string {
  if (natWalkInd <= 5.75) return "Least walkable";
  if (natWalkInd <= 10.5) return "Below average";
  if (natWalkInd <= 15.25) return "Above average";
  return "Most walkable";
}

export function safetyColor(score: number): string {
  if (score >= 88) return "#0b6e4f";
  if (score >= 75) return "#3d8b66";
  if (score >= 60) return "#c4a35a";
  return "#b85c38";
}

export function walkColor(natWalkInd: number): string {
  if (natWalkInd <= 5.75) return "#8a7a66";
  if (natWalkInd <= 10.5) return "#c4a35a";
  if (natWalkInd <= 15.25) return "#3d8b66";
  return "#1d4e89";
}
