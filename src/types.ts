/** Stable id for a drive-time place (built-ins + user-added). */
export type AnchorId = string;

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
  /** Maximum list price — no minimum (cheaper homes are fine) */
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
  /**
   * Drop obvious fixer / TLC / “bring your contractor” homes from the pool.
   * Uses listing-text condition screening (not a home inspection).
   */
  excludeFixerUpper: boolean;
  /**
   * Minimum condition score 0–100 from text (+ year built).
   * 0 = off. ~50 is “not a project”; ~70 prefers updated/turnkey language.
   */
  minConditionScore: number;
  maxNoiseCnel: number;
  /** Minimum neighborhood safety score 0–100 (higher = safer / lower crime) */
  minSafetyScore: number;
  /**
   * Minimum CalEnviroScreen air-quality score 0–100
   * (100 − pollution burden percentile; higher = cleaner).
   * 0 = off.
   */
  minAirQualityScore: number;
  /** EPA National Walkability Index band (1–20) */
  walkMin: number;
  walkMax: number;
  /** Max drive minutes per place id (built-in or user-added) */
  driveMinutes: Record<string, number>;
  requireWithinAllIsochrones: boolean;
  neighborhoods: string[];
}

export type ListingSource =
  | "redfin"
  | "zillow"
  | "realtor"
  | "manual"
  | "rentcast"
  | "compass"
  | "sereno";

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
  /** Approximate combined CNEL (LAX + highway corridors) */
  noiseCnel: number;
  /**
   * Precomputed analysis (viewshed, walk, drives, default score).
   * Written by `npm run ingest:precompute` so the UI paints without
   * waiting on DEM / EPA / Overpass.
   */
  analysis?: ListingAnalysis;
}

/** Cached GIS / livability / drive inputs + default-criteria score snapshot */
export interface ListingAnalysis {
  computedAt: string;
  safetyScore: number;
  safetyLabel: string;
  walkIndex: number;
  walkSource: "epa" | "neighborhood-fallback";
  driveMinutes: Record<string, number>;
  oceanViewshed: {
    hasOceanView: boolean;
    clearRayFraction: number;
    score100: number;
    clearRays: number;
    testedRays: number;
    nearestCoastKm: number;
    terrainBlockedRays: number;
    buildingBlockedRays: number;
    confidence: "high" | "medium" | "low";
    summary: string;
  };
  /**
   * Fixer / renovation screening from listing text (+ yearBuilt).
   * Optional vision pass can set source to "vision" later.
   */
  condition?: {
    score100: number;
    isFixer: boolean;
    renovatedYear: number | null;
    yearBuilt: number | null;
    confidence: "high" | "medium" | "low";
    source: "text" | "text+year" | "vision";
    summary: string;
    signals: string[];
  };
  /** CalEnviroScreen air / pollution burden (higher airQualityScore = cleaner) */
  airQualityScore?: number | null;
  airQuality?: {
    tract: string;
    airQualityScore: number;
    pollutionBurdenPctile: number | null;
    pm25: number | null;
    pm25Pctile: number | null;
    diesel: number | null;
    dieselPctile: number | null;
    ozone: number | null;
    ozonePctile: number | null;
    band: string;
  } | null;
  /** Score against DEFAULT_CRITERIA at compute time */
  defaultScore: {
    score: number;
    flagged: boolean;
    coreRejected: boolean;
    matchReasons: string[];
    failReasons: string[];
  };
}

export interface ScoredListing extends Listing {
  score: number;
  matchReasons: string[];
  failReasons: string[];
  /** Failed budget / beds / baths / sqft / status / SFR / garage / etc. */
  coreRejected: boolean;
  flagged: boolean;
  driveMinutesEstimate: Record<string, number>;
  safetyScore?: number;
  safetyLabel?: string;
  walkIndex?: number;
  walkSource?: "epa" | "neighborhood-fallback";
  airQualityScore?: number | null;
  airQualityBand?: string | null;
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
  /** Fixer / renovation assessment used in scoring */
  condition?: {
    score100: number;
    isFixer: boolean;
    renovatedYear: number | null;
    yearBuilt: number | null;
    confidence: "high" | "medium" | "low";
    source: "text" | "text+year" | "vision";
    summary: string;
    signals: string[];
  };
}

export interface ListingsFile {
  generatedAt: string;
  sources: string[];
  listings: Listing[];
}
