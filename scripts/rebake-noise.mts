#!/usr/bin/env node
/**
 * Rebake listing.noiseCnel with the shared airport + highway model.
 *
 *   npm run ingest:noise
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { estimateNoiseCnel, noiseBreakdown } from "../src/data/ambientNoise";
import type { ListingsFile } from "../src/types";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const path = join(root, "public", "data", "listings.json");

const data = JSON.parse(readFileSync(path, "utf8")) as ListingsFile;
let changed = 0;
const byDominant: Record<string, number> = {
  airport: 0,
  highway: 0,
  ambient: 0,
};

for (const l of data.listings) {
  const next = estimateNoiseCnel(l.lat, l.lng);
  const b = noiseBreakdown(l.lat, l.lng);
  byDominant[b.dominant] = (byDominant[b.dominant] ?? 0) + 1;
  if (l.noiseCnel !== next) {
    l.noiseCnel = next;
    changed += 1;
  }
}

data.generatedAt = new Date().toISOString();
data.sources = [...new Set([...(data.sources ?? []), "noise-rebake"])];
writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
console.log({
  total: data.listings.length,
  changed,
  byDominant,
});
