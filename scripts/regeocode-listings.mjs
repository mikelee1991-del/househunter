/**
 * Fix stacked / wrong coordinates by geocoding each listing address.
 *   node scripts/regeocode-listings.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = join(root, "public", "data", "listings.json");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function geocodeCensus(address) {
  const url =
    "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress" +
    `?address=${encodeURIComponent(address)}&benchmark=4&format=json`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = await res.json();
  const hit = json?.result?.addressMatches?.[0];
  if (!hit) return null;
  return { lat: hit.coordinates.y, lng: hit.coordinates.x, src: "census" };
}

async function geocodeNominatim(address) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "us");
  url.searchParams.set("q", address);
  url.searchParams.set("viewbox", "-118.55,33.70,-118.22,34.05");
  url.searchParams.set("bounded", "0");
  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": "househunter-regeocode/1.0",
    },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const hit = data[0];
  if (!hit) return null;
  return { lat: Number(hit.lat), lng: Number(hit.lon), src: "nominatim" };
}

function inSouthBay(lat, lng) {
  return lat >= 33.68 && lat <= 34.05 && lng >= -118.55 && lng <= -118.22;
}

function estimateNoiseCnel(lat, lng) {
  const dLat = lat - 33.942;
  const dLng = (lng + 118.4085) * Math.cos((lat * Math.PI) / 180);
  const distKm = Math.sqrt(dLat * dLat + dLng * dLng) * 111;
  if (distKm < 3.5) return 75;
  if (distKm < 5.5) return 70;
  if (distKm < 7.5) return 65;
  if (distKm < 10) return Math.round(55 + (10 - distKm) * 2);
  if (distKm < 14) return Math.round(45 + (14 - distKm));
  return 40;
}

function addressCandidates(listing) {
  const base = `${listing.address}, ${listing.city}, CA ${listing.zip || ""}`
    .replace(/\s+/g, " ")
    .trim();
  const out = [base];

  // From MBC slug: /2208-the-strand-manhattan-beach-90266-mls-…/
  try {
    const path = new URL(listing.sourceUrl).pathname.replace(/^\/|\/$/g, "");
    const beforeMls = path.split(/-mls-/i)[0] || "";
    const zipIdx = beforeMls.search(/-90\d{3}$/);
    const streetCity = zipIdx > 0 ? beforeMls.slice(0, zipIdx) : beforeMls;
    const citySlug = listing.city.toLowerCase().replace(/\s+/g, "-");
    let streetSlug = streetCity;
    if (streetSlug.endsWith(`-${citySlug}`)) {
      streetSlug = streetSlug.slice(0, -(citySlug.length + 1));
    }
    // drop leading house number already in address; rebuild from slug words
    const words = streetSlug.split("-").filter(Boolean);
    if (words.length >= 2) {
      const fromSlug = `${words.join(" ")}, ${listing.city}, CA ${listing.zip || ""}`;
      if (!out.includes(fromSlug)) out.push(fromSlug);
    }
  } catch {
    /* ignore */
  }

  // Light suffix guesses when Census misses bare street names
  if (!/\b(st|street|ave|avenue|blvd|dr|drive|rd|road|ln|lane|ct|way|pl|place|ter|circle|cir)\b/i.test(listing.address)) {
    for (const suf of ["St", "Ave", "Dr", "Blvd", "Rd"]) {
      out.push(
        `${listing.address} ${suf}, ${listing.city}, CA ${listing.zip || ""}`,
      );
    }
  }
  return out;
}

async function geocodeOne(listing) {
  for (const address of addressCandidates(listing)) {
    let g = await geocodeCensus(address);
    if (g && inSouthBay(g.lat, g.lng)) return { ...g, query: address };
    await sleep(150);
  }
  // Nominatim once with best-looking candidate
  const primary = addressCandidates(listing)[0];
  await sleep(1100);
  const g = await geocodeNominatim(primary);
  if (g) return { ...g, query: primary };
  return null;
}

async function main() {
  const data = JSON.parse(readFileSync(outPath, "utf8"));
  const listings = data.listings ?? [];

  // Detect the most common (likely bogus) coordinate cluster
  const freq = new Map();
  for (const l of listings) {
    const k = `${l.lat.toFixed(5)},${l.lng.toFixed(5)}`;
    freq.set(k, (freq.get(k) || 0) + 1);
  }
  const [stackedKey, stackedCount] = [...freq.entries()].sort(
    (a, b) => b[1] - a[1],
  )[0] ?? ["", 0];
  console.log(
    `Most common coord ${stackedKey} appears ${stackedCount}/${listings.length} times`,
  );

  let fixed = 0;
  let failed = 0;
  for (let i = 0; i < listings.length; i += 1) {
    const l = listings[i];
    const key = `${Number(l.lat).toFixed(5)},${Number(l.lng).toFixed(5)}`;
    const needsFix =
      key === stackedKey ||
      !inSouthBay(l.lat, l.lng) ||
      !Number.isFinite(l.lat) ||
      !Number.isFinite(l.lng);

    if (!needsFix && stackedCount < 20) continue;
    // Always re-geocode the stacked cluster; leave unique good coords alone
    if (!needsFix) continue;

    try {
      const g = await geocodeOne(l);
      if (!g) {
        failed += 1;
        console.warn(`[${i + 1}/${listings.length}] FAIL ${l.address}, ${l.city}`);
      } else {
        l.lat = g.lat;
        l.lng = g.lng;
        l.noiseCnel = estimateNoiseCnel(g.lat, g.lng);
        fixed += 1;
        console.log(
          `[${i + 1}/${listings.length}] ${l.address} → ${g.lat.toFixed(5)},${g.lng.toFixed(5)} (${g.src})`,
        );
      }
    } catch (err) {
      failed += 1;
      console.warn(`[${i + 1}] ${l.address}: ${err.message}`);
    }
    await sleep(80);
  }

  const uniq = new Set(
    listings.map((l) => `${l.lat.toFixed(4)},${l.lng.toFixed(4)}`),
  ).size;
  data.generatedAt = new Date().toISOString();
  data.sources = [...new Set([...(data.sources || []), "regeocoded"])];
  writeFileSync(outPath, JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log(`\nFixed ${fixed}, failed ${failed}, unique coords now ${uniq}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
