/**
 * Pull active homes from Sereno CRMLS across the South Bay metro
 * (beach cities, PV, Torrance, Playa/Westchester, and nearby).
 *
 *   npm run ingest:sereno
 *
 * Strategy (free path — Sereno caps each query at ~200 rows, no pagination):
 *   1) City + subsection neighborhood IDs
 *   2) Auto price-band split when a query returns exactly 200
 *   3) ZIP searchString pass for full metro coverage under the cap
 *
 * Merges into public/data/listings.json by MLS#. Detail pages enrich
 * garage / outdoor / description (set SERENO_SKIP_ENRICH=1 to skip).
 * Does not wipe existing rows from other sources.
 *
 * Env:
 *   INGEST_MIN_PRICE   default 500000
 *   INGEST_MAX_PRICE   default 12000000
 *   SERENO_SKIP_ENRICH=1
 *   SERENO_ZIPS_ONLY=1     skip neighborhood queries (debug)
 *   SERENO_SKIP_ZIPS=1     skip zip pass
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { extractAskPrice } from "./lib/parseListingPrice.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = join(root, "public", "data", "listings.json");

const MIN_PRICE = Number(process.env.INGEST_MIN_PRICE ?? 500_000);
const MAX_PRICE = Number(process.env.INGEST_MAX_PRICE ?? 12_000_000);
const RESULT_CAP = 200;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";

/**
 * Sereno neighborhood / city IDs from GET /api/v0/neighborhoods/search?q=…
 * Prefer city-level IDs plus subsections for cities that hit the 200-row cap.
 */
const NEIGHBORHOODS = [
  // Manhattan Beach (city + sections)
  { id: 38168, name: "Manhattan Beach" },
  { id: 37618, name: "Manhattan Beach" }, // Sand
  { id: 37538, name: "Manhattan Beach" }, // Tree
  { id: 37849, name: "Manhattan Beach" }, // Hill
  { id: 37919, name: "Manhattan Beach" }, // Eastside
  { id: 37314, name: "Manhattan Beach" }, // North End
  { id: 37774, name: "Manhattan Beach" }, // Manhattan Village
  { id: 38199, name: "Hermosa Beach" },
  // Redondo (city + sections)
  { id: 38134, name: "Redondo Beach" },
  { id: 37717, name: "Redondo Beach" }, // North
  { id: 37177, name: "Redondo Beach" }, // South
  { id: 37837, name: "Redondo Beach" }, // Hollywood Riviera
  { id: 37374, name: "Redondo Beach" }, // Golden Hills
  { id: 37390, name: "Redondo Beach" }, // El Nido
  // Torrance (city + subsections — city alone caps at 200)
  { id: 38095, name: "Torrance" },
  { id: 37185, name: "Torrance" }, // North
  { id: 37199, name: "Torrance" }, // Central
  { id: 37476, name: "Torrance" }, // West
  { id: 37591, name: "Torrance" }, // South
  { id: 37588, name: "Torrance" }, // Southeast
  { id: 37707, name: "Torrance" }, // Northwest
  { id: 37713, name: "Torrance" }, // Northeast
  { id: 37490, name: "Torrance" }, // Walteria
  { id: 37694, name: "Torrance" }, // Olde Torrance
  { id: 37785, name: "Torrance" }, // Madrona
  { id: 37586, name: "Torrance" }, // Southwood
  { id: 37653, name: "Torrance" }, // Pueblo
  { id: 38038, name: "Torrance" }, // Belmar
  { id: 37950, name: "Torrance" }, // Delthome
  // Peninsula
  { id: 38135, name: "Rancho Palos Verdes" },
  { id: 38148, name: "Palos Verdes Estates" },
  { id: 38131, name: "Rolling Hills Estates" },
  { id: 38132, name: "Rolling Hills" },
  { id: 38147, name: "Rancho Palos Verdes" }, // Peninsula umbrella
  { id: 37786, name: "Palos Verdes Estates" }, // Lunada Bay
  { id: 37781, name: "Palos Verdes Estates" }, // Malaga Cove
  { id: 37745, name: "Palos Verdes Estates" }, // Monte Malaga
  { id: 37752, name: "Rancho Palos Verdes" }, // Miraleste
  { id: 37395, name: "Rancho Palos Verdes" }, // Eastview
  // San Pedro subsections
  { id: 37620, name: "San Pedro" },
  { id: 37304, name: "San Pedro" }, // Northwest
  { id: 37409, name: "San Pedro" }, // Coastal
  { id: 37414, name: "San Pedro" }, // Central
  { id: 38175, name: "Lomita" },
  { id: 37859, name: "Harbor City" },
  { id: 38068, name: "Wilmington" },
  // Northern coastal / LAX corridor
  { id: 38214, name: "El Segundo" },
  { id: 37475, name: "Westchester" },
  { id: 38141, name: "Playa del Rey" },
  { id: 37662, name: "Playa Vista" },
  { id: 37951, name: "Del Rey" },
  { id: 37768, name: "Marina del Rey" },
  { id: 38169, name: "Marina del Rey" },
  { id: 37772, name: "Mar Vista" },
  { id: 37955, name: "Culver City" },
  { id: 37516, name: "Venice" },
  // Adjacent South Bay
  { id: 38200, name: "Hawthorne" },
  { id: 37196, name: "Hawthorne" }, // East
  { id: 37726, name: "Hawthorne" }, // North
  { id: 37651, name: "Hawthorne" }, // Ramona
  { id: 37843, name: "Hawthorne" }, // Holly Glen
  { id: 38180, name: "Lawndale" },
  { id: 37804, name: "Lawndale" }, // Lawndale Acres
  { id: 38209, name: "Gardena" },
  { id: 37727, name: "Gardena" }, // North
  { id: 37990, name: "Gardena" }, // Central
  { id: 37263, name: "Gardena" }, // South Gardena (LA)
  { id: 38256, name: "Alondra Park" },
  { id: 38241, name: "Carson" },
  { id: 38079, name: "Carson" }, // West Carson
  { id: 37186, name: "Carson" }, // North
  { id: 37197, name: "Carson" }, // East
  { id: 37598, name: "Carson" }, // South
  { id: 37992, name: "Carson" }, // Central
  // Inglewood / Lennox (LAX east edge)
  { id: 38195, name: "Inglewood" },
  { id: 37723, name: "Inglewood" }, // North
  { id: 37739, name: "Inglewood" }, // Morningside Park
  { id: 37362, name: "Inglewood" }, // Hollywood Park
  { id: 38178, name: "Lennox" },
];

/** South Bay + LAX-corridor ZIPs — each stays under Sereno's 200-row cap. */
const ZIPS = [
  // Beach cities
  "90266", // Manhattan Beach
  "90254", // Hermosa Beach
  "90277", // Redondo Beach
  "90278", // Redondo Beach / North
  "90245", // El Segundo
  // Torrance
  "90501",
  "90502",
  "90503",
  "90504",
  "90505",
  // Peninsula / San Pedro
  "90274", // PVE / RHE
  "90275", // RPV
  "90717", // Lomita
  "90731", // San Pedro
  "90732", // San Pedro
  "90710", // Harbor City
  "90744", // Wilmington
  // Carson
  "90745",
  "90746",
  "90810", // Carson / LB edge
  // Northern coastal
  "90045", // Westchester
  "90293", // Playa del Rey
  "90094", // Playa Vista
  "90291", // Venice
  "90292", // Marina del Rey
  "90066", // Mar Vista / Del Rey
  "90230", // Culver City
  "90232", // Culver City
  "90405", // Santa Monica south edge
  // Inland South Bay
  "90250", // Hawthorne
  "90260", // Lawndale
  "90247", // Gardena
  "90248", // Gardena
  "90249", // Gardena / Hawthorne
  // Inglewood / Lennox
  "90301",
  "90302",
  "90303",
  "90304",
  "90305",
];

/** Price bands used when a single query returns the 200-row cap. */
const PRICE_BANDS = [
  [0, 700_000],
  [700_000, 900_000],
  [900_000, 1_100_000],
  [1_100_000, 1_400_000],
  [1_400_000, 1_800_000],
  [1_800_000, 2_500_000],
  [2_500_000, 4_000_000],
  [4_000_000, 20_000_000],
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
  if (/redondo beach/i.test(c)) return "Redondo Beach";
  if (/playa vista/i.test(c)) return "Playa Vista";
  if (/marina/i.test(c)) return "Marina del Rey";
  if (/westchester/i.test(c)) return "Westchester";
  if (/torrance/i.test(c)) return "Torrance";
  if (/rancho palos verdes/i.test(c)) return "Rancho Palos Verdes";
  if (/palos verdes estates/i.test(c)) return "Palos Verdes Estates";
  if (/rolling hills estates/i.test(c)) return "Rolling Hills Estates";
  if (/rolling hills/i.test(c)) return "Rolling Hills";
  if (/san pedro/i.test(c)) return "San Pedro";
  if (/mar vista/i.test(c)) return "Mar Vista";
  if (/culver city/i.test(c)) return "Culver City";
  if (/hawthorne/i.test(c)) return "Hawthorne";
  if (/lawndale/i.test(c)) return "Lawndale";
  if (/gardena/i.test(c)) return "Gardena";
  if (/lomita/i.test(c)) return "Lomita";
  if (/harbor city/i.test(c)) return "Harbor City";
  if (/wilmington/i.test(c)) return "Wilmington";
  if (/venice/i.test(c)) return "Venice";
  if (/carson/i.test(c)) return "Carson";
  if (/inglewood/i.test(c)) return "Inglewood";
  if (/lennox/i.test(c)) return "Lennox";
  if (/los angeles/i.test(c)) {
    if (zip === "90045") return "Westchester";
    if (zip === "90094") return "Playa Vista";
    if (zip === "90293") return "Playa del Rey";
    if (zip === "90291" || zip === "90292") return "Marina del Rey";
    if (zip === "90066") return "Mar Vista";
    if (zip === "90731" || zip === "90732") return "San Pedro";
    if (zip === "90744") return "Wilmington";
    if (fallback) return fallback;
    return "Los Angeles";
  }
  return fallback || c || "Los Angeles";
}

/** Map Sereno MLS status → our inventory status. Null = skip (sold/off-market). */
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
  const marketStatus = mapMarketStatus(d.status);
  if (!marketStatus) return null;
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
    status: marketStatus,
    listedAt,
    updatedAt: now,
    noiseCnel: estimateNoiseCnel(d.lat, d.lng),
    _mls: mls,
  };
}

async function searchSereno(
  page,
  token,
  { neighborhoodIds, searchString, minPrice, maxPrice, propertyStatus = "active" },
) {
  return page.evaluate(
    async ({
      token,
      neighborhoodIds,
      searchString,
      minPrice,
      maxPrice,
      propertyStatus,
    }) => {
      const searchFilters = {
        listingCategory: "residential",
        listingType: "non-rental",
        propertyStatus,
        searchType: "residential",
        source: "W",
      };
      if (neighborhoodIds?.length) searchFilters.neighborhoods = neighborhoodIds;
      if (minPrice != null) searchFilters.minPrice = minPrice;
      if (maxPrice != null) searchFilters.maxPrice = maxPrice;

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
          searchString: searchString || "",
          searchFilters,
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
    { token, neighborhoodIds, searchString, minPrice, maxPrice, propertyStatus },
  );
}

/**
 * Fetch all rows for a query, splitting on price when Sereno's 200-row cap is hit.
 */
async function collectQuery(page, token, label, opts) {
  const json = await searchSereno(page, token, opts);
  if (json.error) {
    console.warn(`  ${label}: ${json.error}`);
    return [];
  }
  const rows = json.data || [];
  if (rows.length < RESULT_CAP) {
    console.log(`  ${label}: ${rows.length} raw`);
    return rows;
  }

  console.log(`  ${label}: ${rows.length} (cap) → price bands`);
  const byLn = new Map();
  for (const [lo, hi] of PRICE_BANDS) {
    const bandLabel = `${label} $${(lo / 1000) | 0}k–$${hi >= 1e6 ? `${(hi / 1e6).toFixed(1)}M` : `${(hi / 1000) | 0}k`}`;
    const band = await searchSereno(page, token, {
      ...opts,
      minPrice: lo,
      maxPrice: hi,
    });
    if (band.error) {
      console.warn(`    ${bandLabel}: ${band.error}`);
      continue;
    }
    const bandRows = band.data || [];
    console.log(`    ${bandLabel}: ${bandRows.length}`);
    for (const d of bandRows) {
      const ln = String(d.LN || "").toUpperCase();
      if (ln) byLn.set(ln, d);
    }
    // If a band itself hits the cap, recurse once with tighter halves
    if (bandRows.length >= RESULT_CAP && hi - lo > 100_000) {
      const mid = Math.round((lo + hi) / 2);
      for (const [a, b] of [
        [lo, mid],
        [mid, hi],
      ]) {
        const sub = await searchSereno(page, token, {
          ...opts,
          minPrice: a,
          maxPrice: b,
        });
        for (const d of sub.data || []) {
          const ln = String(d.LN || "").toUpperCase();
          if (ln) byLn.set(ln, d);
        }
        await sleep(250);
      }
    }
    await sleep(300);
  }
  console.log(`  ${label}: ${byLn.size} after bands`);
  return [...byLn.values()];
}

function mlsKey(listing) {
  const m =
    String(listing.sourceUrl || "").match(/mls-([a-z]{2,4})(\d{6,})/i) ||
    String(listing.sourceUrl || "").match(/sereno\.com\/([A-Z]{2})(\d{6,})/i) ||
    String(listing.id || "").match(/sereno-([a-z]{2})(\d+)/i);
  if (!m) return null;
  return `${m[1].toUpperCase()}${m[2]}`;
}

function zipHint(zip) {
  const map = {
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
  return map[zip] || null;
}

async function main() {
  console.log(
    `Sereno metro ingest ($${MIN_PRICE.toLocaleString()}–$${MAX_PRICE.toLocaleString()})…`,
  );
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

  const byLn = new Map(); // LN → { d, hint }

  if (process.env.SERENO_ZIPS_ONLY !== "1") {
    console.log(`Neighborhood queries (${NEIGHBORHOODS.length})…`);
    for (const nb of NEIGHBORHOODS) {
      const rows = await collectQuery(page, token, `${nb.name} (${nb.id})`, {
        neighborhoodIds: [nb.id],
      });
      for (const d of rows) {
        const ln = String(d.LN || "").toUpperCase();
        if (!ln) continue;
        if (!byLn.has(ln)) byLn.set(ln, { d, hint: nb.name });
      }
      await sleep(350);
    }
  }

  if (process.env.SERENO_SKIP_ZIPS !== "1") {
    console.log(`ZIP queries (${ZIPS.length})…`);
    for (const zip of ZIPS) {
      const rows = await collectQuery(page, token, `ZIP ${zip}`, {
        searchString: zip,
      });
      const hint = zipHint(zip);
      for (const d of rows) {
        const ln = String(d.LN || "").toUpperCase();
        if (!ln) continue;
        // Prefer exact zip match when searchString returns extras
        if (String(d.zip) !== zip) continue;
        if (!byLn.has(ln)) byLn.set(ln, { d, hint: hint || d.city });
      }
      await sleep(350);
    }

    // Pending / under-contract pass — Sereno's "active" filter still returns
    // Contingent, but dedicated Pending listings need propertyStatus=pending.
    console.log(`Pending ZIP queries (${ZIPS.length})…`);
    for (const zip of ZIPS) {
      const rows = await collectQuery(page, token, `Pending ZIP ${zip}`, {
        searchString: zip,
        propertyStatus: "pending",
      });
      const hint = zipHint(zip);
      for (const d of rows) {
        const ln = String(d.LN || "").toUpperCase();
        if (!ln) continue;
        if (String(d.zip) !== zip) continue;
        // Pending wins over a stale active copy of the same MLS
        byLn.set(ln, { d, hint: hint || d.city });
      }
      await sleep(350);
    }
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

  const skipEnrich = process.env.SERENO_SKIP_ENRICH === "1";
  let enriched = 0;
  if (skipEnrich) {
    console.log("Skipping detail enrich (SERENO_SKIP_ENRICH=1)");
  } else {
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
          const ocean =
            /ocean|catalina|pacific|sunset view|water view|strand/i.test(
              `${row.description} ${row.address}`,
            );
          row.oceanView = ocean;
          row.oceanViewConfidence = ocean ? "inferred" : "unknown";
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
      if ((i + 1) % 25 === 0 || i === mapped.length - 1) {
        console.log(`  enriched ${i + 1}/${mapped.length}`);
      }
      await sleep(220);
    }
    console.log(`Detail enrich ok: ${enriched}/${mapped.length}`);
  }

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
        // Prefer richer prior description when search-only row is a stub
        description:
          String(prev.description || "").length > String(row.description || "").length
            ? prev.description
            : row.description,
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
    byAddr.set(
      key,
      score(l) >= score(prev)
        ? { ...prev, ...l, analysis: l.analysis || prev.analysis }
        : { ...l, ...prev, analysis: prev.analysis || l.analysis },
    );
  }

  const listings = [...byAddr.values()].sort((a, b) => b.price - a.price);
  const byNb = {};
  for (const l of listings) {
    byNb[l.neighborhood] = (byNb[l.neighborhood] || 0) + 1;
  }

  const out = {
    generatedAt: new Date().toISOString(),
    sources: [...new Set([...(existing.sources || []), "sereno-areas"])],
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
