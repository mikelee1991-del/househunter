#!/usr/bin/env npx tsx
import { readFileSync, writeFileSync } from "node:fs";
import { analyzeOceanViewshed } from "../src/lib/oceanViewshed";
import type { ListingsFile } from "../src/types";

const path = "public/data/listings.json";
const data = JSON.parse(readFileSync(path, "utf8")) as ListingsFile;
const concurrency = 3;

const jobs: number[] = [];
for (let i = 0; i < data.listings.length; i++) {
  const ov = data.listings[i].analysis?.oceanViewshed;
  if (!ov) continue;
  if ((ov.nearestCoastKm ?? 99) <= 1.2 || (ov.score100 ?? 0) >= 20) {
    jobs.push(i);
  }
}
console.log(`Sightline rebake ${jobs.length}…`);

let done = 0;
let changed = 0;
const queue = [...jobs];

async function worker() {
  while (queue.length) {
    const idx = queue.shift();
    if (idx == null) return;
    const l = data.listings[idx];
    if (!l.analysis?.oceanViewshed) continue;
    const prev = l.analysis.oceanViewshed.score100;
    try {
      const v = await analyzeOceanViewshed({ lat: l.lat, lng: l.lng });
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
      l.oceanView = v.hasOceanView;
      if (v.score100 !== prev) changed += 1;
      done += 1;
      if (done % 15 === 0) {
        console.log(`[${done}/${jobs.length}] ${l.address} ${prev}→${v.score100}`);
        data.generatedAt = new Date().toISOString();
        writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
      }
    } catch (e) {
      console.warn("fail", l.address, e instanceof Error ? e.message : e);
      done += 1;
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));
data.generatedAt = new Date().toISOString();
writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
console.log(`Done changed=${changed} done=${done}`);
