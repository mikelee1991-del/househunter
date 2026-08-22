/**
 * Recompute analysis.defaultScore from existing GIS fields + current
 * DEFAULT_CRITERIA (no DEM / EPA refetch).
 *
 *   npx tsx scripts/refresh-default-scores.mts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { DEFAULT_ANCHORS, DEFAULT_CRITERIA } from "../src/data/anchors";
import { scoreListing } from "../src/lib/score";
import type { ListingsFile } from "../src/types";

const path = "public/data/listings.json";
const data = JSON.parse(readFileSync(path, "utf8")) as ListingsFile;
const anchors = DEFAULT_ANCHORS.map((a) => ({ ...a }));
let matches = 0;
const by: Record<string, number> = {};

for (const l of data.listings) {
  const a = l.analysis;
  if (!a) continue;
  const liv = {
    safetyScore: a.safetyScore,
    safetyLabel: a.safetyLabel,
    walkIndex: a.walkIndex,
    walkSource: a.walkSource,
  };
  const viewshed = {
    ...a.oceanViewshed,
    hasSunsetView: a.oceanViewshed.hasSunsetView ?? false,
    oceanViewScore: a.oceanViewshed.oceanViewScore ?? a.oceanViewshed.score100,
    sunsetViewScore: a.oceanViewshed.sunsetViewScore ?? 0,
    sunsetClearRays: a.oceanViewshed.sunsetClearRays ?? 0,
    sunsetTestedRays: a.oceanViewshed.sunsetTestedRays ?? 0,
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
  if (s.flagged) {
    matches += 1;
    by[l.neighborhood] = (by[l.neighborhood] ?? 0) + 1;
  }
}

data.generatedAt = new Date().toISOString();
writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
console.log("refreshed defaultScore matches", matches, by);
