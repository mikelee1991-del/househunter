#!/usr/bin/env npx tsx
/**
 * GIS ocean/sunset rebake: DEM terrain + OSM buildings for coastal inventory.
 * Prioritizes nearest-coast (best view areas) first.
 *
 *   npx tsx scripts/recompute-ocean-gis.mts
 *
 * Env:
 *   OCEAN_GIS_MAX_COAST_KM   default 5
 *   OCEAN_GIS_CONCURRENCY    default 2
 *   OCEAN_GIS_LIMIT          optional cap
 *   OCEAN_GIS_GAPS_ONLY=1    only unavailable / pending placeholders
 */
import { readFileSync, writeFileSync } from "node:fs";
import { analyzeOceanViewshed } from "../src/lib/oceanViewshed";
import { haversineKm } from "../src/lib/geo";
import { SOUTH_BAY_COASTLINE } from "../src/data/southBayCoastline";
import type { ListingsFile } from "../src/types";

const path = "public/data/listings.json";
const data = JSON.parse(readFileSync(path, "utf8")) as ListingsFile;
const maxCoast = Number(process.env.OCEAN_GIS_MAX_COAST_KM ?? 5);
const concurrency = Math.max(
  1,
  Number(process.env.OCEAN_GIS_CONCURRENCY ?? 2),
);
const limit = Number(process.env.OCEAN_GIS_LIMIT ?? 0);
const gapsOnly = process.env.OCEAN_GIS_GAPS_ONLY === "1";

function coastKm(lat: number, lng: number): number {
  let best = Infinity;
  for (const [clng, clat] of SOUTH_BAY_COASTLINE) {
    best = Math.min(best, haversineKm(lat, lng, clat, clng));
  }
  return best;
}

function isGap(summary: string | undefined): boolean {
  return /unavailable|pending rebake/i.test(summary || "");
}

type Job = { idx: number; coast: number };

  const jobs: Job[] = [];
  for (let i = 0; i < data.listings.length; i++) {
    const l = data.listings[i];
    const coast = coastKm(l.lat, l.lng);
    if (coast > maxCoast) continue;
    const ov = l.analysis?.oceanViewshed;
    if (gapsOnly && !isGap(ov?.summary)) continue;
    // Skip lots that already have a real GIS summary (resume-friendly)
    if (
      !gapsOnly &&
      ov &&
      !isGap(ov.summary) &&
      /clear rays/i.test(ov.summary || "")
    ) {
      continue;
    }
    jobs.push({ idx: i, coast });
  }

jobs.sort((a, b) => a.coast - b.coast);
const selected = limit > 0 ? jobs.slice(0, limit) : jobs;
console.log(
  `Ocean GIS rebake ${selected.length}/${data.listings.length}` +
    ` (coast≤${maxCoast}km, concurrency ${concurrency}` +
    `${gapsOnly ? ", gaps only" : ", all coastal"}, nearest-first)…`,
);

let done = 0;
let changed = 0;
let failed = 0;
const queue = [...selected];

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function processOne(idx: number) {
  const l = data.listings[idx];
  if (!l.analysis) {
    l.analysis = {
      computedAt: new Date().toISOString(),
    } as NonNullable<typeof l.analysis>;
  }
  const prev = l.analysis!.oceanViewshed?.score100 ?? -1;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const v = await analyzeOceanViewshed({ lat: l.lat, lng: l.lng });
      l.analysis!.oceanViewshed = {
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
      l.analysis!.computedAt = new Date().toISOString();
      l.oceanView = v.hasOceanView;
      if (v.score100 !== prev) changed += 1;
      return;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (attempt < 2 && /429|timeout|fetch failed|Abrupt/i.test(msg)) {
        await sleep(1800 * (attempt + 1));
        continue;
      }
      console.warn("fail", l.address, msg);
      failed += 1;
      return;
    }
  }
}

async function worker() {
  while (queue.length) {
    const job = queue.shift();
    if (!job) return;
    await processOne(job.idx);
    done += 1;
    if (done % 8 === 0 || done === selected.length) {
      const l = data.listings[job.idx];
      const s = l.analysis?.oceanViewshed?.score100;
      console.log(
        `[${done}/${selected.length}] ~${job.coast.toFixed(2)}km ${l.address} → ${s}` +
          ` (Δ=${changed} fail=${failed})`,
      );
      data.generatedAt = new Date().toISOString();
      writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
    }
    await sleep(40);
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));
data.generatedAt = new Date().toISOString();
writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
console.log(`Done changed=${changed} failed=${failed} processed=${done}`);
