import type { Anchor, Criteria } from "../types";

/**
 * Public defaults shipped in the repo / GitHub Pages build.
 * Personal places & criteria belong in localStorage or gitignored
 * `public/private-prefs.json` — never commit those.
 *
 * Add more places anytime in the Criteria panel (“Add place”).
 */
export const DEFAULT_ANCHORS: Anchor[] = [
  {
    id: "spacex",
    label: "SpaceX Hawthorne",
    address: "1 Rocket Road, Hawthorne, CA 90250",
    description: "SpaceX Hawthorne campus",
    lat: 33.92055,
    lng: -118.32698,
    color: "#0b6e4f",
  },
  {
    id: "lax",
    label: "LAX",
    address: "1 World Way, Los Angeles, CA 90045",
    description: "Los Angeles International Airport",
    lat: 33.9416,
    lng: -118.4085,
    color: "#1d4e89",
  },
  {
    id: "kentwood",
    label: "Westchester",
    address: "7000 W Manchester Ave, Los Angeles, CA 90045",
    description: "Westchester area",
    lat: 33.9597,
    lng: -118.4183,
    color: "#b85c38",
  },
  {
    id: "torrance",
    label: "Torrance",
    address: "3031 Torrance Blvd, Torrance, CA 90503",
    description: "Torrance civic area",
    lat: 33.8358,
    lng: -118.3406,
    color: "#6b4c9a",
  },
  {
    id: "harbor",
    label: "Redondo Harbor",
    address: "659 N Harbor Dr, Redondo Beach, CA 90277",
    description: "659 N Harbor Drive, Redondo Beach",
    lat: 33.84841,
    lng: -118.39523,
    color: "#c0392b",
  },
];

export const DEFAULT_CRITERIA: Criteria = {
  budgetMax: 3_500_000,
  minBeds: 3,
  minBaths: 2,
  minSqft: 1600,
  minOceanViewshed: 0,
  requireOceanView: false,
  requireWestFacing: false,
  requireOutdoorSpace: true,
  requireSingleFamily: true,
  minGarageSpaces: 2,
  preferGarageSpaces: 3,
  excludeFixerUpper: true,
  minConditionScore: 45,
  maxNoiseCnel: 75,
  minSafetyScore: 70,
  /** Soft floor — filters only the highest pollution-burden tracts */
  minAirQualityScore: 15,
  walkMin: 10.5,
  walkMax: 20,
  driveMinutes: {
    spacex: 25,
    lax: 30,
    kentwood: 35,
    torrance: 40,
    harbor: 20,
  },
  requireWithinAllIsochrones: true,
  neighborhoods: [],
  metricWeights: {
    drive: 22,
    noise: 12,
    safety: 13,
    walk: 14,
    ocean: 26,
    air: 7,
  },
};

export const NEIGHBORHOOD_OPTIONS = [
  "Playa del Rey",
  "Playa Vista",
  "Westchester",
  "El Segundo",
  "Del Rey",
  "Manhattan Beach",
  "Hermosa Beach",
  "Redondo Beach",
  "Torrance",
  "Rancho Palos Verdes",
  "Palos Verdes Estates",
  "Rolling Hills Estates",
  "San Pedro",
  "Marina del Rey",
  "Mar Vista",
  "Culver City",
  "Venice",
  "Hawthorne",
  "Lawndale",
  "Lomita",
  "Gardena",
  "Harbor City",
];

/** Palette for user-added places (cycles). */
export const ANCHOR_COLOR_PALETTE = [
  "#0b6e4f",
  "#1d4e89",
  "#b85c38",
  "#6b4c9a",
  "#c0392b",
  "#0e7490",
  "#a16207",
  "#be185d",
];

export function newAnchorId(): string {
  return `place-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Rough west-facing: 225° (SW) through 315° (NW). */
export function isWestFacing(degrees?: number): boolean {
  if (degrees == null) return false;
  const d = ((degrees % 360) + 360) % 360;
  return d >= 225 && d <= 315;
}
