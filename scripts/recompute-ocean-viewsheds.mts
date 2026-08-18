#!/usr/bin/env npx tsx
/**
 * Force-recompute ocean viewsheds with the denser per-address ray model.
 *
 *   npx tsx scripts/recompute-ocean-viewsheds.mts
 *   OCEAN_RECOMPUTE_LIMIT=80 npx tsx scripts/recompute-ocean-viewsheds.mts
 *   OCEAN_RECOMPUTE_MAX_COAST_KM=8 npx tsx ...
 *
 * Prefer coastal lots (inland stay 0). Rate-limits DEM/Overpass.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { analyzeOceanViewshed } from "../src/lib/oceanViewshed";
import type { ListingsFile } from "../src/types";

const path = "public/data/listings.json";
const limit = Number(process.env.OCEAN_RECOMPUTE_LIMIT ?? 0) || Infinity;
const maxCoastKm = Number(process.env.OCEAN_RECOMPUTE_MAX_COAST_KM ?? 8);
const concurrency = Math.max(1, Number(process.env.OCEAN_RECOMPUTE_CONCURRENCY ?? 2));

const data = JSON.parse(readFileSync(path, "utf8")) as ListingsFile;

type Job = { idx: number; id: string; lat: number; lng: number; prev: number };

const jobs: Job[] = [];
for (let i = 0; i < data.listings.length; i++) {
  const l = data.listings[i];
  if (!l.analysis) continue;
  const prev = l.analysis.oceanViewshed?.score100 ?? -1;
  const coast = l.analysis.oceanViewshed?.nearestCoastKm;
  // Always redo coastal / previously scored; skip deep inland zeros
  if (coast != null && coast > maxCoastKm && prev <= 0) continue;
  jobs.push({ idx: i, id: l.id, lat: l.lat, lng: l.lng, prev });
  if (jobs.length >= limit) break;
}

console.log(
  `Recomputing ocean viewshed for ${jobs.length} listings (coast≤${maxCoastKm}km, concurrency ${concurrency})…`,
);

let done = 0;
let changed = 0;

async function worker(queue: Job[]) {
  while (queue.length) {
    const job = queue.shift();
    if (!job) return;
    const l = data.listings[job.idx];
    try {
      const v = await analyzeOceanViewshed({ lat: job.lat, lng: job.lng });
      if (!l.analysis) continue;
      l.analysis.oceanViewshed = {
        hasOceanView: v.hasOceanView,
        clearRayFraction: v.clearRayFraction,
        score100: v.score100,
        clearRays: v.clearRays,
        testedRays: v.testedRays,
        nearestCoastKm: v.nearestCoastKm,
        terrainBlockedRays: v.terrainBlockedRays,
        buildingBlockedRays: v.buildingBlockedRays,
        confidence: v.confidence,
        summary: v.summary,
      };
      l.analysis.computedAt = new Date().toISOString();
      if (v.score100 !== job.prev) changed += 1;
      done += 1;
      if (done % 10 === 0 || done === jobs.length) {
        console.log(
          `[${done}/${jobs.length}] ${l.address} · ${job.prev}→${v.score100} (${v.clearRays}/${v.testedRays} rays)`,
        );
        // Checkpoint periodically
        if (done % 25 === 0) {
          data.generatedAt = new Date().toISOString();
          writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
        }
      }
    } catch (e) {
      console.warn(`fail ${job.id}`, e instanceof Error ? e.message : e);
      done += 1;
    }
  }
}

const queue = [...jobs];
await Promise.all(
  Array.from({ length: concurrency }, () => worker(queue)),
);

data.generatedAt = new Date().toISOString();
writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
console.log(`Done. changed=${changed} of ${jobs.length}`);
