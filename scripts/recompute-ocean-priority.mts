#!/usr/bin/env npx tsx
/**
 * Priority ocean viewshed rebake — beachfront + high prior scores first.
 * Checkpoints every 5 listings.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { analyzeOceanViewshed } from "../src/lib/oceanViewshed";
import type { ListingsFile } from "../src/types";

const path = "public/data/listings.json";
const data = JSON.parse(readFileSync(path, "utf8")) as ListingsFile;
const concurrency = Math.max(1, Number(process.env.OCEAN_RECOMPUTE_CONCURRENCY ?? 3));

type Job = {
  idx: number;
  id: string;
  lat: number;
  lng: number;
  prev: number;
  pri: number;
  address: string;
};

const jobs: Job[] = [];
for (let i = 0; i < data.listings.length; i++) {
  const l = data.listings[i];
  if (!l.analysis?.oceanViewshed) continue;
  const ov = l.analysis.oceanViewshed;
  const coast = ov.nearestCoastKm ?? 99;
  const score = ov.score100 ?? 0;
  if (coast > 2.8 && score < 35) continue;
  if (coast > 4) continue;

  let pri = 0;
  if (/strand|esplanade|paseo del mar|the walk|ocean blvd|vista del mar/i.test(l.address)) {
    pri += 100;
  }
  if (score >= 60) pri += 50;
  if (coast <= 0.8) pri += 40;
  else if (coast <= 1.5) pri += 20;
  pri += Math.max(0, 30 - coast * 8);
  jobs.push({
    idx: i,
    id: l.id,
    lat: l.lat,
    lng: l.lng,
    prev: score,
    pri,
    address: l.address,
  });
}
jobs.sort((a, b) => b.pri - a.pri);
console.log(`Priority rebake ${jobs.length} listings (concurrency ${concurrency})…`);

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
