import type { Anchor, Criteria } from "../types";

/** Default pins — edit addresses in the Criteria panel or here. */
export const DEFAULT_ANCHORS: Anchor[] = [
  {
    id: "spacex",
    label: "SpaceX (work)",
    address: "1 Rocket Road, Hawthorne, CA 90250",
    description: "SpaceX Hawthorne",
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
    label: "Kentwood Bluffs friends",
    address: "6662 Kentwood Bluffs Dr, Los Angeles, CA 90045",
    description: "Kentwood Bluffs",
    lat: 33.98081,
    lng: -118.40075,
    color: "#b85c38",
  },
  {
    id: "torrance",
    label: "Torrance friends",
    address: "1624 W 223rd St, Torrance, CA 90501",
    description: "Torrance",
    lat: 33.82443,
    lng: -118.30702,
    color: "#6b4c9a",
  },
];

export const DEFAULT_CRITERIA: Criteria = {
  budgetMax: 3_500_000,
  minBeds: 3,
  minBaths: 2,
  minSqft: 1600,
  /**
   * Off by default so inland Westchester / El Segundo / east MB still surface.
   * Use the Usable (~35) chip when you want an ocean/sunset wedge.
   */
  minOceanViewshed: 0,
  requireOceanView: false,
  /** Deprecated: house facing no longer used — ocean/sunset viewshed matters */
  requireWestFacing: false,
  requireOutdoorSpace: true,
  requireSingleFamily: true,
  minGarageSpaces: 2,
  preferGarageSpaces: 3,
  /** 70 includes El Segundo / Westchester / north MB under LAX path */
  maxNoiseCnel: 70,
  /** Low crime: beach cities / PV typically 80–95 */
  minSafetyScore: 75,
  /**
   * EPA NatWalkInd band (1–20). Default: above-average floor, no upper cap
   * (most-walkable homes should not be filtered out).
   */
  walkMin: 10.5,
  walkMax: 20,
  driveMinutes: {
    spacex: 25,
    lax: 30,
    kentwood: 35,
    torrance: 35,
  },
  requireWithinAllIsochrones: true,
  neighborhoods: [],
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
  "San Pedro",
  "Marina del Rey",
  "Mar Vista",
];

/** Rough west-facing: 225° (SW) through 315° (NW). */
export function isWestFacing(degrees?: number): boolean {
  if (degrees == null) return false;
  const d = ((degrees % 360) + 360) % 360;
  return d >= 225 && d <= 315;
}
