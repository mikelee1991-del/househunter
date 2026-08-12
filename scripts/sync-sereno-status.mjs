/**
 * Fast Sereno status sync: ZIP active + pending searches, update
 * status on existing MLS rows and merge new pending/contingent homes.
 * Does not re-enrich detail pages.
 *
 *   node scripts/sync-sereno-status.mjs
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = join(root, "public", "data", "listings.json");
const MIN_PRICE = Number(process.env.INGEST_MIN_PRICE ?? 500_000);
const MAX_PRICE = Number(process.env.INGEST_MAX_PRICE ?? 12_000_000);

const ZIPS = [
  "90266", "90254", "90277", "90278", "90245",
  "90501", "90502", "90503", "90504", "90505",
  "90274", "90275", "90717", "90731", "90732", "90710", "90744",
  "90745", "90746", "90810",
  "90045", "90293", "90094", "90291", "90292", "90066",
  "90230", "90232", "90405",
  "90250", "90260", "90247", "90248", "90249",
  "90301", "90302", "90303", "90304", "90305",
];

const ZIP_HINT = {
  "90266": "Manhattan Beach",
  "90254": "Hermosa Beach",
  "90277": "Redondo Beach",
  "90278": "Redondo Beach",
  "90245": "El Segundo",
  "90501": "Torrance",
  "90502": "Torrance",
  "90503": "Torrance",
  "90504": "Torrance",
  "90505": "Torrance",
  "90274": "Palos Verdes Estates",
  "90275": "Rancho Palos Verdes",
  "90717": "Lomita",
  "90731": "San Pedro",
  "90732": "San Pedro",
  "90710": "Harbor City",
  "90744": "Wilmington",
  "90745": "Carson",
  "90746": "Carson",
  "90810": "Carson",
  "90045": "Westchester",
  "90293": "Playa del Rey",
  "90094": "Playa Vista",
  "90291": "Venice",
  "90292": "Marina del Rey",
  "90066": "Mar Vista",
  "90230": "Culver City",
  "90232": "Culver City",
  "90405": "Santa Monica",
  "90250": "Hawthorne",
  "90260": "Lawndale",
  "90247": "Gardena",
  "90248": "Gardena",
  "90249": "Gardena",
  "90301": "Inglewood",
  "90302": "Inglewood",
  "90303": "Inglewood",
  "90304": "Lennox",
  "90305": "Inglewood",
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function mapMarketStatus(status) {
  const s = String(status || "").toLowerCase();
  if (
    s === "pending" ||
    s === "contingent" ||
    s === "active under contract" ||
    s === "under contract"
  ) {
    return "pending";
  }
  if (
    s === "active" ||
    s === "new" ||
    s === "price change" ||
    s === "coming soon" ||
    s === "open house"
  ) {
    return "active";
  }
  return null;
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

function mlsKey(listing) {
  const m =
    String(listing.sourceUrl || "").match(/mls-([a-z]{2,4})(\d{6,})/i) ||
    String(listing.sourceUrl || "").match(/sereno\.com\/([A-Z]{2})(\d{6,})/i) ||
    String(listing.id || "").match(/sereno-([a-z]{2})(\d+)/i);
  if (!m) return null;
  return `${m[1].toUpperCase()}${m[2]}`;
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

async function search(page, token, { searchString, propertyStatus }) {
  return page.evaluate(
    async ({ token, searchString, propertyStatus }) => {
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
          searchString,
          searchFilters: {
            listingCategory: "residential",
            listingType: "non-rental",
            propertyStatus,
            searchType: "residential",
            source: "W",
          },
          mbr: null,
          commercial: false,
          customHeading: true,
        }),
      });
      if (!r.ok) return { error: `HTTP ${r.status}`, data: [] };
      return r.json();
    },
    { token, searchString, propertyStatus },
  );
}

async function main() {
  const existing = existsSync(outPath)
    ? JSON.parse(readFileSync(outPath, "utf8"))
    : { listings: [], sources: [] };

  const byMls = new Map();
  for (const l of existing.listings || []) {
    const k = mlsKey(l);
    if (k) byMls.set(k, l);
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("https://www.sereno.com/search", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await sleep(1000);
  const token = await page.evaluate(
    () => document.querySelector('meta[name="csrf-token"]')?.content || "",
  );
  if (!token) throw new Error("No CSRF token");

  const live = new Map(); // MLS → { status, d, hint }
  for (const zip of ZIPS) {
    for (const propertyStatus of ["active", "pending"]) {
      const json = await search(page, token, {
        searchString: zip,
        propertyStatus,
      });
      const rows = json.data || [];
      let kept = 0;
      for (const d of rows) {
        if (String(d.zip) !== zip) continue;
        const market = mapMarketStatus(d.status);
        if (!market) continue;
        const mls = String(d.LN || "").toUpperCase();
        if (!mls) continue;
        live.set(mls, { status: market, d, hint: ZIP_HINT[zip] || d.city });
        kept += 1;
      }
      console.log(`  ${propertyStatus} ${zip}: ${kept}/${rows.length}`);
      await sleep(280);
    }
  }
  await browser.close();

  let markedPending = 0;
  let markedActive = 0;
  let added = 0;
  const now = new Date().toISOString();

  for (const [mls, info] of live) {
    const prev = byMls.get(mls);
    if (prev) {
      if (prev.status !== info.status) {
        if (info.status === "pending") markedPending += 1;
        else markedActive += 1;
      }
      byMls.set(mls, {
        ...prev,
        status: info.status,
        price: Number(info.d.rawPrice) || prev.price,
        updatedAt: now,
      });
      continue;
    }

    // New pending/contingent (or active we somehow missed)
    const d = info.d;
    const propertyType = mapPropertyType(d.type);
    if (!propertyType) continue;
    const price = Number(d.rawPrice) || 0;
    if (price < MIN_PRICE || price > MAX_PRICE) continue;
    if (!d.lat || !d.lng) continue;
    const beds = Number(d.bedrooms) || 0;
    const baths =
      (Number(d.fullBathrooms) || 0) + (Number(d.halfBathrooms) || 0) * 0.5 ||
      Number(d.bathrooms) ||
      0;
    if (!(beds > 0) || !(baths > 0)) continue;
    const neighborhood = info.hint || String(d.city || "Los Angeles");
    byMls.set(mls, {
      id: `sereno-${mls.toLowerCase()}`,
      source: "sereno",
      sourceUrl: d.listingUrl || d.linkUrl || `https://www.sereno.com/${mls}`,
      address: String(d.streetAddress || "").replace(/\s+/g, " ").trim(),
      city: neighborhood,
      neighborhood,
      zip: String(d.zip || ""),
      lat: d.lat,
      lng: d.lng,
      price,
      beds,
      baths,
      sqft: Number(String(d.sqft || "").replace(/,/g, "")) || 0,
      propertyType,
      garageSpaces: 0,
      outdoorSpace: false,
      outdoorTypes: [],
      oceanView: false,
      oceanViewConfidence: "unknown",
      photos: d.imageUrl ? [d.imageUrl] : [],
      description: `${propertyType} in ${neighborhood}`,
      status: info.status,
      listedAt: d.listDate
        ? new Date(d.listDate.replace(" ", "T") + "Z").toISOString()
        : now,
      updatedAt: now,
      noiseCnel: estimateNoiseCnel(d.lat, d.lng),
    });
    added += 1;
    if (info.status === "pending") markedPending += 1;
  }

  const listings = [...byMls.values()].sort((a, b) => b.price - a.price);
  const byStatus = {};
  for (const l of listings) byStatus[l.status] = (byStatus[l.status] || 0) + 1;

  writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: now,
        sources: [
          ...new Set([...(existing.sources || []), "sereno-status-sync"]),
        ],
        listings,
      },
      null,
      2,
    ) + "\n",
  );
  console.log({
    total: listings.length,
    byStatus,
    markedPending,
    markedActive,
    added,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
