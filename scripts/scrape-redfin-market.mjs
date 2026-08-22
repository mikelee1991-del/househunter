/**
 * Pull active South Bay SFR inventory from Redfin by intercepting the
 * authenticated stingray/api/gis responses inside Chromium.
 *
 * Usage: node scripts/scrape-redfin-market.mjs
 * Writes public/data/listings.json (merged with manual overlays).
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { estimateNoiseCnel } from "../src/data/ambientNoise.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const outPath = join(root, "public", "data", "listings.json");
const manualPath = join(root, "data", "manual-listings.json");

const MIN_PRICE = Number(process.env.INGEST_MIN_PRICE ?? 800_000);
const MAX_PRICE = Number(process.env.INGEST_MAX_PRICE ?? 12_000_000);

/** Redfin city URLs (region ids from redfin.com/city/{id}/CA/...). */
const CITIES = [
  { name: "Manhattan Beach", id: 11270, slug: "Manhattan-Beach" },
  { name: "Hermosa Beach", id: 8584, slug: "Hermosa-Beach" },
  { name: "Redondo Beach", id: 15502, slug: "Redondo-Beach" },
  { name: "Torrance", id: 17150, slug: "Torrance" },
  { name: "Palos Verdes Estates", id: 14887, slug: "Palos-Verdes-Estates" },
  { name: "Rancho Palos Verdes", id: 15352, slug: "Rancho-Palos-Verdes" },
  { name: "El Segundo", id: 5572, slug: "El-Segundo" },
  { name: "Lomita", id: 10888, slug: "Lomita" },
  { name: "Lawndale", id: 10448, slug: "Lawndale" },
  { name: "Hawthorne", id: 8434, slug: "Hawthorne" },
  { name: "Gardena", id: 7052, slug: "Gardena" },
  { name: "Carson", id: 2948, slug: "Carson" },
  { name: "Culver City", id: 4570, slug: "Culver-City" },
];

/** Neighborhood pages under Los Angeles city. */
const NEIGHBORHOODS = [
  { name: "Playa del Rey", id: 3844, path: "Los-Angeles/Playa-del-Rey" },
  { name: "Westchester", id: 290650, path: "Los-Angeles/Westchester" },
  { name: "Playa Vista", id: 4031, path: "Los-Angeles/Playa-Vista" },
  { name: "Mar Vista", id: 2700, path: "Los-Angeles/Mar-Vista" },
  { name: "Venice", id: 5578, path: "Los-Angeles/Venice" },
  { name: "San Pedro", id: 1558, path: "Los-Angeles/San-Pedro" },
  { name: "Marina del Rey", id: 2614, path: "Los-Angeles/Marina-del-Rey" },
];

const SOUTH_BAY_BOUNDS = {
  minLat: 33.70,
  maxLat: 34.02,
  minLng: -118.55,
  maxLng: -118.25,
};

function inSouthBay(lat, lng) {
  return (
    lat >= SOUTH_BAY_BOUNDS.minLat &&
    lat <= SOUTH_BAY_BOUNDS.maxLat &&
    lng >= SOUTH_BAY_BOUNDS.minLng &&
    lng <= SOUTH_BAY_BOUNDS.maxLng
  );
}

function neighborhoodFor(city, lat, lng, hint) {
  if (hint) return hint;
  // Rough Playa / Westchester pockets inside LA city results
  if (city === "Los Angeles" || city === "Playa del Rey") {
    if (lat >= 33.96 && lat <= 33.99 && lng <= -118.42) return "Playa del Rey";
    if (lat >= 33.94 && lat <= 33.99 && lng > -118.42) return "Westchester";
    if (lat >= 33.97 && lng <= -118.44) return "Marina del Rey";
  }
  return city;
}

function mapHome(h, neighborhoodHint) {
  const lat = h.latLong?.value?.latitude ?? h.latitude;
  const lng = h.latLong?.value?.longitude ?? h.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (!inSouthBay(lat, lng)) return null;

  const price = Number(h.price?.value ?? h.price ?? 0);
  if (!price || price < MIN_PRICE || price > MAX_PRICE) return null;

  const mls = String(h.mlsStatus ?? "").toLowerCase();
  if (mls && /sold|off.?market|closed|withdrawn/.test(mls)) return null;
  // Keep Active / Coming Soon / New; drop Pending unless explicitly wanted
  if (/pending|contingent|under contract/.test(mls)) return null;

  const street = String(h.streetLine?.value ?? h.streetLine ?? "").trim();
  if (!street || /^undisclosed/i.test(street) || street === "00") return null;

  const city = String(h.city ?? "");
  const zip = String(h.zip ?? h.postalCode?.value ?? "");
  const urlPath = String(h.url ?? "");
  if (!/\/home\/\d+/.test(urlPath)) return null;

  const beds = Number(h.beds ?? 0);
  const baths = Number(h.baths ?? 0);
  const sqft = Number(h.sqFt?.value ?? h.sqFt ?? 0);
  const lot = h.lotSize?.value ? Number(h.lotSize.value) : undefined;
  const yearBuilt = h.yearBuilt?.value ? Number(h.yearBuilt.value) : undefined;
  const garage =
    typeof h.parkingSpaces === "number"
      ? h.parkingSpaces
      : typeof h.garageSpaces === "number"
        ? h.garageSpaces
        : lot && lot >= 2500
          ? 2
          : 0;

  const descBits = [
    h.listingRemarks,
    h.sashes?.map((s) => s.sashTypeName).join(" "),
    mls,
  ]
    .filter(Boolean)
    .join(" ");
  const oceanView = /ocean|catalina|pacific|water view|sunset view/i.test(
    descBits,
  );

  const neighborhood = neighborhoodFor(city, lat, lng, neighborhoodHint);
  const now = new Date().toISOString();
  const propertyId = h.propertyId ?? h.listingId ?? `${lat}-${lng}`;

  return {
    id: `redfin-${propertyId}`,
    source: "redfin",
    sourceUrl: `https://www.redfin.com${urlPath}`,
    address: street,
    city: /los angeles/i.test(city) ? neighborhood : city,
    neighborhood,
    zip,
    lat,
    lng,
    price,
    beds,
    baths,
    sqft,
    yearBuilt,
    lotSqft: lot,
    propertyType: "sfr",
    garageSpaces: garage,
    outdoorSpace: Boolean(lot && lot >= 1500) || /yard|patio|deck/i.test(descBits),
    outdoorTypes: lot && lot >= 1500 ? ["yard"] : [],
    oceanView,
    oceanViewConfidence: oceanView ? "inferred" : "unknown",
    photos: [],
    description: `Active Redfin SFR · ${mls || "for sale"} · ${city}${
      descBits ? ` · ${String(descBits).slice(0, 200)}` : ""
    }`,
    status: "active",
    listedAt: now,
    updatedAt: now,
    noiseCnel: estimateNoiseCnel(lat, lng),
  };
}

function loadManual() {
  if (!existsSync(manualPath)) return [];
  try {
    return JSON.parse(readFileSync(manualPath, "utf8")).listings ?? [];
  } catch {
    return [];
  }
}

function merge(groups) {
  const map = new Map();
  for (const group of groups) {
    for (const l of group) {
      const key = `${l.address.toLowerCase()}|${l.zip}|${Math.round(l.price / 1000)}`;
      const prev = map.get(key);
      if (!prev || l.updatedAt >= prev.updatedAt) map.set(key, l);
    }
  }
  return [...map.values()].sort((a, b) => b.price - a.price);
}

function loadExisting() {
  if (!existsSync(outPath)) return [];
  try {
    return JSON.parse(readFileSync(outPath, "utf8")).listings ?? [];
  } catch {
    return [];
  }
}

async function scrapeUrl(page, label, url, neighborhoodHint) {
  const homes = [];
  const seenPages = new Set();

  const onResponse = async (res) => {
    try {
      if (!res.url().includes("/stingray/api/gis")) return;
      if (res.status() !== 200) return;
      let text = await res.text();
      if (text.startsWith("{}&&")) text = text.slice(4);
      const json = JSON.parse(text);
      const batch = json?.payload?.homes ?? [];
      for (const h of batch) {
        const mapped = mapHome(h, neighborhoodHint);
        if (mapped) homes.push(mapped);
      }
      seenPages.add(res.url());
    } catch {
      /* ignore parse errors */
    }
  };

  page.on("response", onResponse);
  console.log(`→ ${label}: ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(3500);

  for (let i = 0; i < 5; i++) {
    const next = page
      .locator('a[aria-label="Next"], button:has-text("Next")')
      .first();
    if ((await next.count()) === 0) break;
    if (!(await next.isEnabled().catch(() => false))) break;
    await next.click().catch(() => {});
    await page.waitForTimeout(2500);
  }

  page.off("response", onResponse);
  const byId = new Map(homes.map((h) => [h.id, h]));
  console.log(
    `  captured ${byId.size} homes (${seenPages.size} GIS responses)`,
  );
  return [...byId.values()];
}

async function scrapeCity(page, city) {
  const filter = `property-type=house,min-price=${Math.round(MIN_PRICE / 1000)}k,max-price=${Math.round(MAX_PRICE / 1000)}k,status=active`;
  const url = `https://www.redfin.com/city/${city.id}/CA/${city.slug}/filter/${filter}`;
  return scrapeUrl(page, city.name, url, city.name);
}

async function scrapeNeighborhood(page, nb) {
  const filter = `property-type=house,min-price=${Math.round(MIN_PRICE / 1000)}k,max-price=${Math.round(MAX_PRICE / 1000)}k,status=active`;
  const url = `https://www.redfin.com/neighborhood/${nb.id}/CA/${nb.path}/filter/${filter}`;
  return scrapeUrl(page, nb.name, url, nb.name);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
    locale: "en-US",
    viewport: { width: 1400, height: 900 },
  });
  const page = await context.newPage();

  const all = [];
  for (const city of CITIES) {
    try {
      all.push(...(await scrapeCity(page, city)));
    } catch (err) {
      console.warn(`  failed ${city.name}:`, err.message ?? err);
    }
    await page.waitForTimeout(1000);
  }
  for (const nb of NEIGHBORHOODS) {
    try {
      all.push(...(await scrapeNeighborhood(page, nb)));
    } catch (err) {
      console.warn(`  failed ${nb.name}:`, err.message ?? err);
    }
    await page.waitForTimeout(1000);
  }

  await browser.close();

  const existing = loadExisting();
  const manual = loadManual();
  // Merge: keep existing analysis / richer garage when Redfin is thinner
  const merged = merge([existing, manual, all]).map((l) => {
    const prev = existing.find(
      (e) =>
        e.address?.toLowerCase() === l.address?.toLowerCase() &&
        e.zip === l.zip,
    );
    if (!prev) return l;
    return {
      ...prev,
      ...l,
      garageSpaces: Math.max(prev.garageSpaces || 0, l.garageSpaces || 0),
      outdoorSpace: Boolean(prev.outdoorSpace || l.outdoorSpace),
      analysis: prev.analysis,
      photos: l.photos?.length ? l.photos : prev.photos,
      sourceUrl: l.sourceUrl || prev.sourceUrl,
    };
  });

  mkdirSync(dirname(outPath), { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    sources: [
      ...new Set([
        ...(existsSync(outPath)
          ? JSON.parse(readFileSync(outPath, "utf8")).sources || []
          : []),
        "redfin-market-scrape",
        ...(manual.length ? ["manual"] : []),
      ]),
    ],
    listings: merged,
  };
  writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(
    `\nWrote ${merged.length} active listings → ${outPath}` +
      ` (price band $${MIN_PRICE / 1e6}M–$${MAX_PRICE / 1e6}M; +${all.length} from Redfin this run)`,
  );
  if (!all.length) {
    console.error(
      "No Redfin listings captured this run (bot wall?). Existing inventory kept.",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
