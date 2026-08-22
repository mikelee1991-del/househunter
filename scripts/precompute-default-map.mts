/**
 * Precompute default Valhalla isochrones + suitability score grid for
 * DEFAULT_ANCHORS / DEFAULT_CRITERIA so cold map loads skip live Valhalla
 * and tract PIP.
 *
 *   npm run precompute:map
 *
 * Kept out of tsconfig.node typecheck (imports DOM canvas helpers via src).
 */
import { writeFileSync, readFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { DEFAULT_ANCHORS, DEFAULT_CRITERIA } from "../src/data/anchors.ts";
import type { SafetyTractsFile } from "../src/data/safetyTiers.ts";
import {
  buildDefaultMapSignature,
  encodeSuitabilityScores,
  scoresToBase64,
  type DefaultIsochroneFile,
  type DefaultSuitabilityFile,
} from "../src/lib/defaultMapSignature.ts";
import {
  buildIsochrones,
  pointInAnyIsochrone,
  type IsochroneMap,
} from "../src/lib/isochrone.ts";
import {
  buildHeatmapBase,
  scoreHeatmapCell,
  SUITABILITY_BOUNDS,
} from "../src/lib/suitabilityHeatmap.ts";
import type { Listing, ListingsFile } from "../src/types.ts";

type AirQualityTractsFile = {
  source: string;
  generatedAt: string;
  tractCount: number;
  avgAirQualityScore: number | null;
  tracts: Array<{
    geoid: string;
    airQualityScore: number | null;
    rings: [number, number][][];
  }>;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT_ISO = join(ROOT, "public/data/isochrones-default.json");
const OUT_SUIT = join(ROOT, "public/data/suitability-default.json");

const COLS = 160;
const ROWS = 120;

async function main() {
  mkdirSync(dirname(OUT_ISO), { recursive: true });

  console.log("Fetching Valhalla isochrones for defaults…");
  const { map, mode } = await buildIsochrones(
    DEFAULT_ANCHORS,
    DEFAULT_CRITERIA.driveMinutes,
    "",
    (label) => console.log(" ", label),
  );
  if (mode !== "valhalla") {
    throw new Error(`Expected valhalla pack, got ${mode}`);
  }

  const signature = buildDefaultMapSignature(
    DEFAULT_ANCHORS,
    DEFAULT_CRITERIA,
  );

  const isoFile: DefaultIsochroneFile = {
    version: 1,
    generatedAt: new Date().toISOString(),
    provider: "valhalla",
    signature,
    features: map,
  };
  writeFileSync(OUT_ISO, JSON.stringify(isoFile) + "\n");
  console.log(`Wrote ${OUT_ISO}`);

  console.log("Building suitability score grid…");
  const listings = loadListings();
  const safety = JSON.parse(
    readFileSync(join(ROOT, "public/data/safety-tracts.json"), "utf8"),
  ) as SafetyTractsFile;
  const air = JSON.parse(
    readFileSync(join(ROOT, "public/data/air-quality-tracts.json"), "utf8"),
  ) as AirQualityTractsFile;

  const cells = buildHeatmapBase(
    listings,
    safety,
    DEFAULT_ANCHORS,
    air,
    COLS,
    ROWS,
  );

  const isochrones: IsochroneMap = map;
  const scores: Array<number | null> = new Array(cells.length);
  let inside = 0;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (!pointInAnyIsochrone(c.lat, c.lng, DEFAULT_ANCHORS, isochrones)) {
      scores[i] = null;
      continue;
    }
    scores[i] = scoreHeatmapCell(
      c,
      DEFAULT_CRITERIA,
      DEFAULT_ANCHORS,
      isochrones,
    );
    inside += 1;
  }

  const encoded = encodeSuitabilityScores(scores);
  const suitFile: DefaultSuitabilityFile = {
    version: 1,
    generatedAt: new Date().toISOString(),
    signature,
    cols: COLS,
    rows: ROWS,
    bounds: [
      [SUITABILITY_BOUNDS.south, SUITABILITY_BOUNDS.west],
      [SUITABILITY_BOUNDS.north, SUITABILITY_BOUNDS.east],
    ],
    scoresB64: scoresToBase64(encoded),
  };
  writeFileSync(OUT_SUIT, JSON.stringify(suitFile) + "\n");
  console.log(
    `Wrote ${OUT_SUIT} (${inside}/${cells.length} cells inside isochrones)`,
  );
}

function loadListings(): Listing[] {
  const data = JSON.parse(
    readFileSync(join(ROOT, "public/data/listings.json"), "utf8"),
  ) as ListingsFile;
  return data.listings ?? [];
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
