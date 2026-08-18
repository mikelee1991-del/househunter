/**
 * Bake text-based condition / fixer screening onto every listing's analysis
 * and refresh defaultScore (no DEM / EPA refetch).
 *
 *   npx tsx scripts/enrich-listing-condition.mts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { DEFAULT_ANCHORS, DEFAULT_CRITERIA } from "../src/data/anchors";
import { analyzeCondition } from "../src/lib/condition";
import { scoreListing } from "../src/lib/score";
import type { ListingsFile } from "../src/types";

const path = "public/data/listings.json";
const data = JSON.parse(readFileSync(path, "utf8")) as ListingsFile;
const anchors = DEFAULT_ANCHORS.map((a) => ({ ...a }));
let fixers = 0;
let withYear = 0;

for (const l of data.listings) {
  const condition = analyzeCondition({
    description: l.description,
    address: l.address,
    yearBuilt: l.yearBuilt,
  });
  if (condition.isFixer) fixers += 1;
  if (condition.renovatedYear) withYear += 1;

  const a = l.analysis;
  if (!a) {
    // Don't invent stub GIS analysis — leave for ingest:precompute
    continue;
  }

  a.condition = condition;
  const liv = {
    safetyScore: a.safetyScore,
    safetyLabel: a.safetyLabel,
    walkIndex: a.walkIndex,
    walkSource: a.walkSource,
  };
  const viewshed = {
    ...a.oceanViewshed,
    buildingHits: 0,
    eyeHeightM: 5.5,
    facingUsedDeg: 270,
    method: "dem-los+osm-buildings" as const,
  };

  const s = scoreListing(
    l,
    DEFAULT_CRITERIA,
    anchors,
    undefined,
    a.driveMinutes,
    liv,
    viewshed,
  );
  a.defaultScore = {
    score: s.score,
    flagged: s.flagged,
    coreRejected: s.coreRejected,
    matchReasons: s.matchReasons,
    failReasons: s.failReasons,
  };
}

data.generatedAt = new Date().toISOString();
data.sources = [...new Set([...(data.sources ?? []), "condition-text"])];
writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
console.log({
  total: data.listings.length,
  fixers,
  withRenovatedYear: withYear,
  defaultMatches: data.listings.filter((l) => l.analysis?.defaultScore.flagged)
    .length,
});
