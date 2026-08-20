/**
 * Precompute viewshed, EPA walkability, drive minutes, and default scores
 * onto each listing so the UI can render matches immediately.
 *
 *   npm run ingest:precompute
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_ANCHORS, DEFAULT_CRITERIA } from "../src/data/anchors";
import {
  LIVABILITY_BY_NAME,
} from "../src/data/neighborhoodLivability";
import { fetchEpaWalkIndex } from "../src/lib/epaWalkability";
import { driveMinutesToAnchors, haversineKm } from "../src/lib/geo";
import { analyzeOceanViewshed } from "../src/lib/oceanViewshed";
import { SOUTH_BAY_COASTLINE } from "../src/data/southBayCoastline";
import { scoreListing } from "../src/lib/score";
import type { Listing, ListingAnalysis, ListingsFile } from "../src/types";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = join(root, "public", "data", "listings.json");

/** Set PRECOMPUTE_FORCE=1 to recompute rows that already have analysis. */
const SKIP_EXISTING = process.env.PRECOMPUTE_FORCE !== "1";
/** Parallel workers (DEM/Overpass are rate-limited — keep small). */
const CONCURRENCY = Math.max(1, Number(process.env.PRECOMPUTE_CONCURRENCY ?? 2));
/** Skip full DEM viewshed inland of this distance (km); assign score 0. */
const OCEAN_SKIP_COAST_KM = Number(process.env.PRECOMPUTE_OCEAN_SKIP_KM ?? 4);
/** Skip live ocean DEM entirely (fast hunt scoring; rebake coastal later). */
const SKIP_OCEAN = process.env.PRECOMPUTE_SKIP_OCEAN === "1";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function nearestCoastKm(lat: number, lng: number): number {
  let best = Infinity;
  for (const [clng, clat] of SOUTH_BAY_COASTLINE) {
    best = Math.min(best, haversineKm(lat, lng, clat, clng));
  }
  return best;
}

async function main() {
  const data = JSON.parse(readFileSync(outPath, "utf8")) as ListingsFile;
  const listings = data.listings ?? [];
  const now = new Date().toISOString();
  const anchors = DEFAULT_ANCHORS.map((a) => ({ ...a }));

  const pending = SKIP_EXISTING
    ? listings.filter((l) => !l.analysis)
    : listings;
  console.log(
    `Precomputing analysis for ${pending.length}/${listings.length} listings` +
      `${SKIP_EXISTING ? " (skip existing; PRECOMPUTE_FORCE=1 to redo)" : ""}` +
      ` · concurrency ${CONCURRENCY}` +
      (SKIP_OCEAN
        ? " · SKIP_OCEAN=1 (placeholder viewshed)"
        : ` · inland ocean skip >${OCEAN_SKIP_COAST_KM}km`) +
      "…",
  );

  const emptyViewshed = (coastKm: number) => ({
    hasOceanView: false,
    clearRayFraction: 0,
    score100: 0,
    clearRays: 0,
    testedRays: 0,
    nearestCoastKm: coastKm,
    terrainBlockedRays: 0,
    buildingBlockedRays: 0,
    buildingHits: 0,
    eyeHeightM: 5.5,
    facingUsedDeg: 270,
    confidence: "low" as const,
    summary:
      coastKm > OCEAN_SKIP_COAST_KM
        ? `Ocean viewshed 0/100 — too far inland (~${coastKm.toFixed(1)} km to coast)`
        : "Ocean viewshed unavailable",
    method: "dem-los+osm-buildings" as const,
  });

  let completed = 0;

  async function processOne(l: Listing) {
    const n = LIVABILITY_BY_NAME[l.neighborhood];
    let walkIndex = n?.walkFallback ?? 12;
    let walkSource: ListingAnalysis["walkSource"] = "neighborhood-fallback";
    try {
      const epa = await fetchEpaWalkIndex(l.lat, l.lng);
      if (epa != null) {
        walkIndex = Math.round(epa * 10) / 10;
        walkSource = "epa";
      }
    } catch {
      /* keep fallback */
    }
    await sleep(60);

    const coastKm = nearestCoastKm(l.lat, l.lng);
    let viewshed;
    if (SKIP_OCEAN || coastKm > OCEAN_SKIP_COAST_KM) {
      viewshed = emptyViewshed(coastKm);
    } else {
      try {
        viewshed = await Promise.race([
          analyzeOceanViewshed({ lat: l.lat, lng: l.lng }),
          sleep(25_000).then(() => {
            throw new Error("viewshed timeout 25s");
          }),
        ]);
      } catch (err) {
        console.warn(`  viewshed fail ${l.address}:`, err);
        viewshed = emptyViewshed(coastKm);
      }
      await sleep(100);
    }

    const driveMinutes = driveMinutesToAnchors(l.lat, l.lng, anchors);
    const livability = {
      safetyScore: n?.safetyScore ?? 65,
      safetyLabel: n?.safetyLabel ?? "Moderate",
      walkIndex,
      walkSource,
    };

    const scored = scoreListing(
      l,
      DEFAULT_CRITERIA,
      anchors,
      undefined,
      driveMinutes,
      livability,
      viewshed,
    );

    const analysis: ListingAnalysis = {
      computedAt: now,
      safetyScore: livability.safetyScore,
      safetyLabel: livability.safetyLabel,
      walkIndex,
      walkSource,
      driveMinutes,
      oceanViewshed: {
        hasOceanView: viewshed.hasOceanView,
        clearRayFraction: viewshed.clearRayFraction,
        score100: viewshed.score100,
        clearRays: viewshed.clearRays,
        testedRays: viewshed.testedRays,
        nearestCoastKm: viewshed.nearestCoastKm,
        terrainBlockedRays: viewshed.terrainBlockedRays,
        buildingBlockedRays: viewshed.buildingBlockedRays,
        confidence: viewshed.confidence,
        summary: viewshed.summary,
      },
      defaultScore: {
        score: scored.score,
        flagged: scored.flagged,
        coreRejected: scored.coreRejected,
        matchReasons: scored.matchReasons,
        failReasons: scored.failReasons,
      },
      condition: scored.condition,
    };

    l.analysis = analysis;
    if (viewshed.hasOceanView) {
      l.oceanView = true;
      l.oceanViewConfidence = "gis";
    }

    completed += 1;
    console.log(
      `[${completed}/${pending.length}] ${l.address} · score ${scored.score}` +
        `${scored.flagged ? " MATCH" : ""}` +
        `${scored.coreRejected ? " (core reject)" : ""}` +
        ` · view ${viewshed.score100}/100 · walk ${walkIndex}`,
    );

    if (completed % 25 === 0 || completed === pending.length) {
      data.generatedAt = new Date().toISOString();
      data.sources = [
        ...new Set([...(data.sources ?? []), "precomputed-scores"]),
      ];
      writeFileSync(outPath, JSON.stringify(data, null, 2) + "\n", "utf8");
    }
  }

  const queue = pending.map((l, i) => ({ l: l as Listing, i }));
  async function worker() {
    while (queue.length) {
      const job = queue.shift();
      if (!job) return;
      await processOne(job.l);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  data.generatedAt = new Date().toISOString();
  data.sources = [...new Set([...(data.sources ?? []), "precomputed-scores"])];
  writeFileSync(outPath, JSON.stringify(data, null, 2) + "\n", "utf8");

  const withAnalysis = listings.filter((l) => l.analysis).length;
  const matches = listings.filter((l) => l.analysis?.defaultScore.flagged).length;
  console.log(
    `\nWrote analysis for ${withAnalysis}/${listings.length} → ${outPath}`,
  );
  console.log(`Default-criteria matches: ${matches}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
