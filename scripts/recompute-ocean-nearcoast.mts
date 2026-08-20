#!/usr/bin/env npx tsx
/**
 * Rebake ocean viewsheds for the near-coast band where the old 0.4 km
 * building-occlusion cliff left neighbors scored 100 vs 0.
 *
 *   npx tsx scripts/recompute-ocean-nearcoast.mts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { analyzeOceanViewshed } from "../src/lib/oceanViewshed";
import type { ListingsFile } from "../src/types";

const path = "public/data/listings.json";
const data = JSON.parse(readFileSync(path, "utf8")) as ListingsFile;
const concurrency = Math.max(1, Number(process.env.OCEAN_RECOMPUTE_CONCURRENCY ?? 3));
const minCoast = Number(process.env.OCEAN_MIN_COAST_KM ?? 0.2);
const maxCoast = Number(process.env.OCEAN_MAX_COAST_KM ?? 1.6);

type Job = { idx: number; id: string; lat: number; lng: number; prev: number; address: string };

const jobs: Job[] = [];
for (let i = 0; i < data.listings.length; i++) {
  const l = data.listings[i];
  if (!l.analysis?.oceanViewshed) continue;
  const coast = l.analysis.oceanViewshed.nearestCoastKm ?? 99;
  if (coast < minCoast || coast > maxCoast) continue;
  jobs.push({
    idx: i,
    id: l.id,
    lat: l.lat,
    lng: l.lng,
    prev: l.analysis.oceanViewshed.score100 ?? 0,
    address: l.address,
  });
}
console.log(
  `Near-coast rebake ${jobs.length} listings (${minCoast}–${maxCoast} km, concurrency ${concurrency})…`,
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
      if (v.hasOceanView) l.oceanView = true;
      if (v.score100 !== job.prev) changed += 1;
      done += 1;
      if (done % 5 === 0 || done === jobs.length) {
        console.log(
          `[${done}/${jobs.length}] ${l.address} · ${job.prev}→${v.score100} (${v.clearRays}/${v.testedRays})`,
        );
        data.generatedAt = new Date().toISOString();
        writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
      }
    } catch (e) {
      console.warn(`fail ${job.id}`, e instanceof Error ? e.message : e);
      done += 1;
    }
  }
}

const queue = [...jobs];
await Promise.all(Array.from({ length: concurrency }, () => worker(queue)));
data.generatedAt = new Date().toISOString();
writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
console.log(`Done. changed=${changed} of ${jobs.length}`);
