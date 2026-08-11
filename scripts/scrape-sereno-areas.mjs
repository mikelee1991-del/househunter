/**
 * Pull active homes from Sereno CRMLS for northern South Bay areas
 * that MB Confidential indexes don't cover (Playa del Rey, Westchester,
 * El Segundo) plus Manhattan Beach subsections.
 *
 *   npm run ingest:sereno
 *
 * Merges into public/data/listings.json by MLS#. Detail pages enrich
 * garage / outdoor / description. Does not wipe existing beach-city rows.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { extractAskPrice } from "./lib/parseListingPrice.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = join(root, "public", "data", "listings.json");

const MIN_PRICE = Number(process.env.INGEST_MIN_PRICE ?? 800_000);
const MAX_PRICE = Number(process.env.INGEST_MAX_PRICE ?? 12_000_000);
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";

/** Sereno neighborhood IDs from /api/v0/neighborhoods/search */
const NEIGHBORHOODS = [
  { id: 38141, name: "Playa del Rey" },
  { id: 37475, name: "Westchester" },
  { id: 38214, name: "El Segundo" },
  { id: 38168, name: "Manhattan Beach" },
  { id: 37618, name: "Manhattan Beach" }, // Sand Section
  { id: 37538, name: "Manhattan Beach" }, // Tree Section
  { id: 37849, name: "Manhattan Beach" }, // Hill Section
  { id: 37919, name: "Manhattan Beach" }, // Eastside
  { id: 37314, name: "Manhattan Beach" }, // North End
  { id: 37774, name: "Manhattan Beach" }, // Manhattan Village
  { id: 38199, name: "Hermosa Beach" },
  { id: 37662, name: "Playa Vista" },
  { id: 37951, name: "Del Rey" },
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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

function parseSqft(s) {
  return Number(String(s || "").replace(/,/g, "")) || 0;
}

function mapPropertyType(type) {
  const t = String(type || "").toLowerCase();
  if (/vacant|land|lot/.test(t)) return null;
  if (/single family|detached/.test(t)) return "sfr";
  if (/town/.test(t)) return "townhouse";
  if (/condo/.test(t)) return "condo";
  if (/multi|duplex|triplex|fourplex/.test(t)) return "multi";
  return "other";
}

function normalizeNeighborhood(city, zip, fallback) {
  const c = String(city || "").trim();
  if (/playa del rey/i.test(c)) return "Playa del Rey";
  if (/el segundo/i.test(c)) return "El Segundo";
  if (/manhattan beach/i.test(c)) return "Manhattan Beach";
  if (/hermosa beach/i.test(c)) return "Hermosa Beach";
  if (/playa vista/i.test(c)) return "Playa Vista";
  if (/marina/i.test(c)) return "Marina del Rey";
  if (/westchester/i.test(c)) return "Westchester";
  if (/los angeles/i.test(c)) {
    if (zip === "90045" || zip === "90094") return "Westchester";
    if (zip === "90293") return "Playa del Rey";
    if (zip === "90291" || zip === "90292") return "Marina del Rey";
    if (fallback) return fallback;
    return "Los Angeles";
  }
  return fallback || c || "Los Angeles";
}

function isActiveStatus(status) {
  const s = String(status || "").toLowerCase();
  return (
    s === "active" ||
    s === "new" ||
    s === "price change" ||
    s === "coming soon" ||
    s === "open house"
  );
}

function parseGarageOutdoor(html) {
  const garageLabel =
    html.match(
      /Garage:\s*<\/[^>]+>\s*(?:Garage|Attached|Detached|Built[- ]In)?\s*-?\s*(\d+)\s*Car/i,
    )?.[1] ||
    html.match(/(?:Attached|Detached|Built[- ]In)\s*-\s*(\d+)\s*Car\(s\)/i)?.[1] ||
    html.match(/Garage\s*-\s*(\d+)\s*Car\(s\)/i)?.[1] ||
    html.match(/(\d+)\s*-?\s*car garage/i)?.[1] ||
    html.match(/Parking Spaces:\s*<\/[^>]+>\s*(\d+)/i)?.[1];
  let garageSpaces = Number(garageLabel) || 0;
  if (garageSpaces > 6) garageSpaces = 0;

  const outdoor =
    /Patio\/Porch|Patio|Deck|Balcony|Yard|Garden|Rooftop/i.test(html) ||
    /outdoor (space|living)|grass|lawn/i.test(html);

  const outdoorTypes = [];
  if (/patio/i.test(html)) outdoorTypes.push("patio");
  if (/deck/i.test(html)) outdoorTypes.push("deck");
  if (/balcony/i.test(html)) outdoorTypes.push("balcony");
  if (/yard|lawn|garden/i.test(html)) outdoorTypes.push("yard");
  if (/rooftop/i.test(html)) outdoorTypes.push("rooftop");

  const desc =
    html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i)?.[1] ||
    html.match(/itemprop="description"[^>]*content="([^"]+)"/i)?.[1] ||
    "";

  return {
    garageSpaces,
    outdoorSpace: outdoor,
    outdoorTypes: outdoor ? outdoorTypes : [],
    description: desc.replace(/&amp;/g, "&").replace(/&#039;/g, "'").slice(0, 600),
  };
}

async function fetchDetail(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html" },
    redirect: "follow",
  });
  if (!res.ok) return null;
  return res.text();
}

function rowFromSearch(d, neighborhoodHint) {
  const propertyType = mapPropertyType(d.type);
  if (!propertyType) return null;
  if (!isActiveStatus(d.status)) return null;
  const price = Number(d.rawPrice) || 0;
  if (price < MIN_PRICE || price > MAX_PRICE) return null;
  if (!d.lat || !d.lng) return null;

  const beds = Number(d.bedrooms) || 0;
  const baths =
    (Number(d.fullBathrooms) || 0) + (Number(d.halfBathrooms) || 0) * 0.5 ||
    Number(d.bathrooms) ||
    0;
  const sqft = parseSqft(d.sqft);
  const zip = String(d.zip || "");
  const city = String(d.city || "");
  const neighborhood = normalizeNeighborhood(city, zip, neighborhoodHint);
  const mls = String(d.LN || "").toUpperCase();
  if (!mls) return null;

  const street = String(d.streetAddress || "").replace(/\s+/g, " ").trim();
  const sourceUrl = d.listingUrl || d.linkUrl || `https://www.sereno.com/${mls}`;
  const now = new Date().toISOString();
  const listedAt = d.listDate
    ? new Date(d.listDate.replace(" ", "T") + "Z").toISOString()
    : now;

  return {
    id: `sereno-${mls.toLowerCase()}`,
    source: "sereno",
    sourceUrl,
    address: street,
    city: /los angeles/i.test(city) ? neighborhood : city,
    neighborhood,
    zip,
    lat: d.lat,
    lng: d.lng,
    price,
    beds,
    baths,
    sqft,
    propertyType,
    garageSpaces: 0,
    outdoorSpace: false,
    outdoorTypes: [],
    oceanView: false,
    oceanViewConfidence: "unknown",
    photos: d.imageUrl ? [d.imageUrl] : [],
    description: `${propertyType} in ${neighborhood}`,
    status: "active",
    listedAt,
    updatedAt: now,
    noiseCnel: estimateNoiseCnel(d.lat, d.lng),
    _mls: mls,
  };
}

async function searchSereno(page, token, neighborhoodIds) {
  return page.evaluate(
    async ({ token, neighborhoodIds }) => {
      const r = await fetch("/api/v0/listings/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json;charset=UTF-8",
          Accept: "application/json",
          "X-CSRF-TOKEN": token,
          "X-Requested-With": "XMLHttpRequest",
          "X-Site-Context-Id": "164",
        },
        body: JSON.stringify({
          requestID: 1,
          searchString: "",
          searchFilters: {
            listingCategory: "residential",
            listingType: "non-rental",
            neighborhoods: neighborhoodIds,
            propertyStatus: "active",
            searchType: "residential",
            source: "W",
          },
          mbr: null,
          commercial: false,
          customHeading: true,
        }),
      });
      if (!r.ok) {
        return { error: `HTTP ${r.status}`, data: [] };
      }
      return r.json();
    },
    { token, neighborhoodIds },
  );
}

function mlsKey(listing) {
  const m =
    String(listing.sourceUrl || "").match(/mls-([a-z]{2,4})(\d{6,})/i) ||
    String(listing.sourceUrl || "").match(/sereno\.com\/([A-Z]{2})(\d{6,})/i) ||
    String(listing.id || "").match(/sereno-([a-z]{2})(\d+)/i);
  if (!m) return null;
  return `${m[1].toUpperCase()}${m[2]}`;
}

async function main() {
  console.log("Sereno northern South Bay ingest…");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("https://www.sereno.com/search", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await sleep(1200);
  const token = await page.evaluate(
    () => document.querySelector('meta[name="csrf-token"]')?.content || "",
  );
  if (!token) {
    await browser.close();
    throw new Error("No CSRF token from Sereno");
  }

  // Search one neighborhood at a time — Sereno caps a single query at ~200 rows
  const byLn = new Map();
  for (const nb of NEIGHBORHOODS) {
    const json = await searchSereno(page, token, [nb.id]);
    if (json.error) {
      console.warn(`  ${nb.name}: ${json.error}`);
      continue;
    }
    const rows = json.data || [];
    console.log(`  ${nb.name} (${nb.id}): ${rows.length} raw`);
    for (const d of rows) {
      const ln = String(d.LN || "").toUpperCase();
      if (!ln) continue;
      if (!byLn.has(ln)) byLn.set(ln, { d, hint: nb.name });
    }
    await sleep(400);
  }
  await browser.close();

  const raw = [...byLn.values()];
  console.log(`Unique listings across areas: ${raw.length}`);

  const mapped = [];
  for (const { d, hint } of raw) {
    const row = rowFromSearch(d, hint);
    if (row) mapped.push(row);
  }
  console.log(`After filters (active SFR/condo band): ${mapped.length}`);

  // Enrich garage / outdoor from detail pages
  let enriched = 0;
  for (let i = 0; i < mapped.length; i++) {
    const row = mapped[i];
    try {
      const html = await fetchDetail(row.sourceUrl);
      if (html) {
        const extra = parseGarageOutdoor(html);
        row.garageSpaces = extra.garageSpaces;
        row.outdoorSpace = extra.outdoorSpace;
        row.outdoorTypes = extra.outdoorTypes;
        if (extra.description) row.description = extra.description;
        const ocean = /ocean|catalina|pacific|sunset view|water view|strand/i.test(
          `${row.description} ${row.address}`,
        );
        row.oceanView = ocean;
        row.oceanViewConfidence = ocean ? "inferred" : "unknown";
        // Prefer schema ask if detail disagrees with search card
        const ask = extractAskPrice(html, {
          minPrice: MIN_PRICE,
          maxPrice: MAX_PRICE,
        });
        const schema =
          Number(html.match(/"price"\s*:\s*(\d{6,})/)?.[1]) || 0;
        if (schema >= MIN_PRICE && schema <= MAX_PRICE) row.price = schema;
        else if (ask.price >= MIN_PRICE) row.price = ask.price;
        enriched += 1;
      }
    } catch (e) {
      console.warn(`  enrich fail ${row.address}: ${e.message}`);
    }
    if ((i + 1) % 20 === 0 || i === mapped.length - 1) {
      console.log(`  enriched ${i + 1}/${mapped.length}`);
    }
    await sleep(280);
  }
  console.log(`Detail enrich ok: ${enriched}/${mapped.length}`);

  const existing = existsSync(outPath)
    ? JSON.parse(readFileSync(outPath, "utf8"))
    : { listings: [], sources: [] };

  const byMls = new Map();
  for (const l of existing.listings || []) {
    const k = mlsKey(l);
    if (k) byMls.set(k, l);
    else byMls.set(`addr:${l.address}|${l.zip}`, l);
  }

  let added = 0;
  let updated = 0;
  for (const row of mapped) {
    const mls = row._mls;
    delete row._mls;
    const prev = byMls.get(mls);
    if (prev) {
      // Keep precomputed analysis when coordinates unchanged
      const keepAnalysis =
        prev.analysis &&
        Math.abs(prev.lat - row.lat) < 1e-4 &&
        Math.abs(prev.lng - row.lng) < 1e-4
          ? prev.analysis
          : undefined;
      byMls.set(mls, {
        ...prev,
        ...row,
        id: prev.id?.startsWith("sereno-") ? row.id : prev.id,
        // Never downgrade known garage / outdoor from a prior enrich
        garageSpaces: Math.max(prev.garageSpaces || 0, row.garageSpaces || 0),
        outdoorSpace: Boolean(prev.outdoorSpace || row.outdoorSpace),
        outdoorTypes:
          prev.outdoorTypes?.length && !row.outdoorTypes?.length
            ? prev.outdoorTypes
            : row.outdoorTypes,
        oceanView: Boolean(prev.oceanView || row.oceanView),
        analysis: keepAnalysis,
        listedAt: prev.listedAt || row.listedAt,
      });
      updated += 1;
    } else {
      byMls.set(mls, row);
      added += 1;
    }
  }

  // Collapse address+zip duplicates (same home under two MLS / sources)
  const byAddr = new Map();
  for (const l of byMls.values()) {
    const key = `${String(l.address).toLowerCase().replace(/\s+/g, " ")}|${l.zip}`;
    const prev = byAddr.get(key);
    if (!prev) {
      byAddr.set(key, l);
      continue;
    }
    const score = (x) =>
      (x.analysis ? 4 : 0) +
      (x.source === "sereno" ? 2 : 0) +
      (x.garageSpaces || 0) +
      (x.outdoorSpace ? 1 : 0) +
      (x.photos?.length || 0) * 0.01;
    byAddr.set(key, score(l) >= score(prev) ? { ...prev, ...l, analysis: l.analysis || prev.analysis } : { ...l, ...prev, analysis: prev.analysis || l.analysis });
  }

  const listings = [...byAddr.values()].sort((a, b) => b.price - a.price);
  const byNb = {};
  for (const l of listings) {
    byNb[l.neighborhood] = (byNb[l.neighborhood] || 0) + 1;
  }

  const out = {
    generatedAt: new Date().toISOString(),
    sources: [
      ...new Set([...(existing.sources || []), "sereno-areas"]),
    ],
    listings,
  };
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(
    `Wrote ${listings.length} listings (+${added} / ~${updated} updated)`,
  );
  console.log("By neighborhood:", byNb);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
