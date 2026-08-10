export type AnchorId = "spacex" | "lax" | "kentwood" | "torrance";

export interface Anchor {
  id: AnchorId;
  label: string;
  /** Street address used for geocoding and display */
  address: string;
  description: string;
  lat: number;
  lng: number;
  color: string;
}

export interface Criteria {
  budgetMin: number;
  budgetMax: number;
  minBeds: number;
  minBaths: number;
  minSqft: number;
  /**
   * Minimum GIS ocean/sunset viewshed score 0–100.
   * 0 = no viewshed filter. Typical “has a view” band starts ~35.
   */
  minOceanViewshed: number;
  /**
   * @deprecated Derived from minOceanViewshed > 0. Kept for compatibility.
   */
  requireOceanView: boolean;
  /**
   * @deprecated Unused in scoring/UI. Kept for saved criteria compatibility.
   * Ocean/sunset viewshed replaces house-facing checks.
   */
  requireWestFacing: boolean;
  /** Patio, deck, balcony, terrace, yard, rooftop — grass not required */
  requireOutdoorSpace: boolean;
  /** Detached SFR only — no condos/townhomes/shared walls */
  requireSingleFamily: boolean;
  /** Hard minimum garage spaces (default 2) */
  minGarageSpaces: number;
  /** Nice-to-have garage spaces for bonus scoring (default 3) */
  preferGarageSpaces: number;
  maxNoiseCnel: number;
  /** Minimum neighborhood safety score 0–100 (higher = safer / lower crime) */
  minSafetyScore: number;
  /** EPA National Walkability Index band (1–20) */
  walkMin: number;
  walkMax: number;
  driveMinutes: Record<AnchorId, number>;
  requireWithinAllIsochrones: boolean;
  neighborhoods: string[];
}

export type ListingSource =
  | "redfin"
  | "zillow"
  | "realtor"
  | "manual"
  | "rentcast"
  | "compass";

export interface Listing {
  id: string;
  source: ListingSource;
  sourceUrl: string;
  address: string;
  city: string;
  neighborhood: string;
  zip: string;
  lat: number;
  lng: number;
  price: number;
  beds: number;
  baths: number;
  sqft: number;
  yearBuilt?: number;
  lotSqft?: number;
  /**
   * Property form. `sfr` = detached single-family (no shared walls).
   * Townhomes/condos/duplexes are not SFR for our purposes.
   */
  propertyType: "sfr" | "townhouse" | "condo" | "multi" | "other";
  /** Attached/detached garage parking spaces (0 if none / unknown street-only) */
  garageSpaces: number;
  /** Any usable outdoor space (patio, deck, balcony, terrace, yard, rooftop) */
  outdoorSpace: boolean;
  outdoorTypes?: Array<
    "patio" | "deck" | "balcony" | "terrace" | "yard" | "rooftop" | "other"
  >;
  /** Compass degrees: 270 ≈ due west */
  facingDegrees?: number;
  oceanView: boolean;
  oceanViewConfidence: "listed" | "inferred" | "unknown" | "gis";
  photos: string[];
  description: string;
  status: "active" | "pending" | "sold";
  listedAt: string;
  updatedAt: string;
  /** Approximate CNEL from LAX contour model */
  noiseCnel: number;
}

export interface ScoredListing extends Listing {
  score: number;
  matchReasons: string[];
  failReasons: string[];
  /** Failed budget / beds / baths / sqft / status / SFR / garage / etc. */
  coreRejected: boolean;
  flagged: boolean;
  driveMinutesEstimate: Record<AnchorId, number>;
  safetyScore?: number;
  safetyLabel?: string;
  walkIndex?: number;
  walkSource?: "epa" | "neighborhood-fallback";
  /** GIS DEM + OSM building line-of-sight to Pacific */
  oceanViewshed?: {
    hasOceanView: boolean;
    clearRayFraction: number;
    /** 0–100 GIS ocean line-of-sight score */
    score100: number;
    clearRays: number;
    testedRays: number;
    nearestCoastKm: number;
    terrainBlockedRays: number;
    buildingBlockedRays: number;
    confidence: "high" | "medium" | "low";
    summary: string;
  };
}

export interface ListingsFile {
  generatedAt: string;
  sources: string[];
  listings: Listing[];
}
