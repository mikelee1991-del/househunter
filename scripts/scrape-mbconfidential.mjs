/**
 * Pull active South Bay inventory from mbconfidential.com IDX pages,
 * then let the app filter by criteria.
 *
 *   npm run ingest:market
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const outPath = join(root, "public", "data", "listings.json");
const manualPath = join(root, "data", "manual-listings.json");

/** Wide net — UI criteria filters down. */
const MIN_PRICE = Number(process.env.INGEST_MIN_PRICE ?? 1_000_000);
const MAX_PRICE = Number(process.env.INGEST_MAX_PRICE ?? 12_000_000);
const MAX_PAGES = Number(process.env.INGEST_MAX_PAGES ?? 12);
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";

const INDEX_URLS = [
  "https://www.mbconfidential.com/manhattan-beach-homes-for-sale.php",
  "https://www.mbconfidential.com/manhattan-beach-sand-section-homes-for-sale.php",
  "https://www.mbconfidential.com/manhattan-beach-tree-section-homes-for-sale.php",
  "https://www.mbconfidential.com/manhattan-beach-hill-section-homes-for-sale.php",
  "https://www.mbconfidential.com/east-manhattan-beach-homes-for-sale.php",
  "https://www.mbconfidential.com/el-porto-homes-for-sale.php",
  "https://www.mbconfidential.com/manhattan-beach-strand-homes-for-sale.php",
  "https://www.mbconfidential.com/manhattan-beach-under-3m.php",
  "https://www.mbconfidential.com/manhattan-beach-luxury-homes-for-sale.php",
  "https://www.mbconfidential.com/hermosa-beach-homes-for-sale.php",
  "https://www.mbconfidential.com/hermosa-beach-sand-section-real-estate.php",
  "https://www.mbconfidential.com/redondo-beach-homes-for-sale.php",
  "https://www.mbconfidential.com/north-redondo-beach-real-estate.php",
  "https://www.mbconfidential.com/south-redondo-beach-real-estate.php",
  "https://www.mbconfidential.com/hollywood-riviera-homes-for-sale.php",
  "https://www.mbconfidential.com/palos-verdes-estates-real-estate.php",
  "https://www.mbconfidential.com/palos-verdes-area-real-estate.php",
  "https://www.mbconfidential.com/torrance-real-estate.php",
  "https://www.mbconfidential.com/west-of-sepulveda-listings.php",
  "https://www.mbconfidential.com/manhattan-beach-coming-soon-listings.php",
  "https://www.mbconfidential.com/south-bay-coming-soon-listings.php",
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

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** Normalize listing detail path from absolute or relative href. */
function toListingPath(href) {
  if (!href) return null;
  let h = href.trim().replace(/\r|\n/g, "");
  try {
    if (h.startsWith("http")) {
      const u = new URL(h);
      if (!u.hostname.includes("mbconfidential.com")) return null;
      h = u.pathname;
    }
  } catch {
    return null;
  }
  // Detail pages look like /123-main-st-city-90266-mls-sb12345678/
  // Exclude area index pages like /mls-area-165-real-estate.php/
  if (/mls-area-/i.test(h) || /\.php/i.test(h)) return null;
  if (!/\/[^/]+-mls-[a-z]{2}\d+/i.test(h)) return null;
  const path = h.split("?")[0].replace(/\/$/, "") + "/";
  if (!path.startsWith("/")) return null;
  return path;
}

function extractListingPaths(html) {
  const paths = new Set();
  for (const m of html.matchAll(/href=["']([^"']+)["']/gi)) {
    const path = toListingPath(m[1]);
    if (path) paths.add(path);
  }
  // Also catch bare absolute URLs in JSON-LD / scripts
  for (const m of html.matchAll(
    /https?:\/\/(?:www\.)?mbconfidential\.com(\/[^"'<\s]*?mls-[a-z0-9-]+\/?)/gi,
  )) {
    const path = toListingPath(m[1]);
    if (path) paths.add(path);
  }
  return [...paths];
}

function pageCount(html) {
  const m = html.match(/PAGE\s+(\d+)\s+of\s+(\d+)/i);
  if (!m) return 1;
  return Math.min(Number(m[2]) || 1, MAX_PAGES);
}

function withPage(url, page) {
  if (page <= 1) return url;
  const u = new URL(url);
  u.searchParams.set("p", String(page));
  return u.toString();
}

function pick(html, patterns) {
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return m[1].trim();
  }
  return "";
}

function parseMoney(s) {
  const n = Number(String(s).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function inferStatus(html) {
  if (/Active Status/i.test(html)) return "active";
  if (/Coming Soon/i.test(html) && /Current Price/i.test(html)) return "active";
  if (/Status\s*[|:]\s*Active/i.test(html)) return "active";
  if (/Pending Status|Status\s*Pending|Active Under Contract/i.test(html)) {
    return "pending";
  }
  if (/Sold Status|Status\s*Sold|Closed Status/i.test(html)) return "sold";
  if (/Current Price/i.test(html) && /\$[\d,]{7,}/.test(html)) return "active";
  return "unknown";
}

async function geocode(address) {
  const census =
    "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress" +
    `?address=${encodeURIComponent(address)}&benchmark=4&format=json`;
  try {
    const res = await fetch(census);
    if (!res.ok) return null;
    const json = await res.json();
    const hit = json?.result?.addressMatches?.[0];
    if (!hit) return null;
    return { lat: hit.coordinates.y, lng: hit.coordinates.x };
  } catch {
    return null;
  }
}

const CITY_SLUGS = [
  ["rolling-hills-estates", "Rolling Hills Estates"],
  ["rancho-palos-verdes", "Rancho Palos Verdes"],
  ["palos-verdes-estates", "Palos Verdes Estates"],
  ["palos-verdes-peninsula", "Rancho Palos Verdes"],
  ["manhattan-beach", "Manhattan Beach"],
  ["hermosa-beach", "Hermosa Beach"],
  ["redondo-beach", "Redondo Beach"],
  ["el-segundo", "El Segundo"],
  ["playa-del-rey", "Playa del Rey"],
  ["westchester", "Westchester"],
  ["torrance", "Torrance"],
];

/** Prefer city + zip embedded in the detail slug over loose string matches. */
function placeFromPath(path) {
  const clean = path.replace(/^\/|\/$/g, "");
  const beforeMls = clean.split(/-mls-/i)[0] || clean;
  const zipMatch = beforeMls.match(/^(.*?)-(90\d{3})$/);
  const zip = zipMatch?.[2] || "";
  const rest = zipMatch?.[1] || beforeMls;
  for (const [slug, name] of CITY_SLUGS) {
    if (rest.endsWith(`-${slug}`) || rest.includes(`-${slug}-`)) {
      return { city: name, zip };
    }
  }
  return { city: "Los Angeles", zip };
}

async function parseDetail(path) {
  const url = `https://www.mbconfidential.com${path}`;
  const html = await fetchText(url);
  const status = inferStatus(html);
  if (status === "sold" || status === "pending") return null;

  const title =
    pick(html, [
      /<h1[^>]*>([^<]+)<\/h1>/i,
      /property="og:title" content="([^"|]+)/i,
    ]) || "";
  const street = title.replace(/,.*$/, "").replace(/\s+/g, " ").trim();
  if (!street) return null;

  let price = 0;
  const nearCurrent = html.match(/Current Price[\s\S]{0,400}?\$([\d,]+)/i);
  if (nearCurrent) price = parseMoney(nearCurrent[1]);
  if (!price) {
    const amounts = [...html.matchAll(/\$([\d,]{7,})/g)]
      .map((m) => parseMoney(m[1]))
      .filter((n) => n >= MIN_PRICE && n <= MAX_PRICE);
    price = amounts[0] ?? 0;
  }
  if (!price || price < MIN_PRICE || price > MAX_PRICE) return null;

  const metaDesc =
    pick(html, [
      /<meta\s+name="description"\s+content="([^"]+)"/i,
      /<meta\s+property="og:description"\s+content="([^"]+)"/i,
    ]) || "";
  const bedBath = metaDesc.match(
    /(\d+)\s*-?\s*bedroom[s]?,\s*([\d.]+)\s*-?\s*bathroom/i,
  );
  const beds = Number(
    bedBath?.[1] ||
      pick(html, [/(\d+)\s*BR\b/i, /(\d+)\s*Bd\b/i, /(\d+)\s*Bed/i]) ||
      0,
  );
  const baths = Number(
    bedBath?.[2] ||
      pick(html, [
        /(\d+(?:\.\d+)?)\s*BA\b/i,
        /(\d+(?:\.\d+)?)\s*Ba\b/i,
      ]) ||
      0,
  );
  const sqft =
    parseMoney(metaDesc.match(/([\d,]+)\s*sq\.?\s*ft/i)?.[1] || "") ||
    parseMoney(
      pick(html, [/([\d,]+)\s*Sqft/i, /Int\.\s*Sqft\.[^0-9]*([\d,]+)/i]),
    );
  const photos = [
    ...html.matchAll(
      /<meta\s+property="og:image"\s+content="(https:\/\/[^"]+)"/gi,
    ),
  ]
    .map((m) => m[1])
    .filter((u, i, arr) => arr.indexOf(u) === i)
    .slice(0, 8);
  const lot = parseMoney(
    pick(html, [/([\d,]+)\s*Lot\b/i, /Lot Size[^0-9]*([\d,]+)/i]),
  );
  const yearBuilt =
    Number(
      metaDesc.match(/built in (\d{4})/i)?.[1] ||
        pick(html, [/Year Built[^0-9]*(\d{4})/i]) ||
        0,
    ) || undefined;
  const garage = Number(
    pick(html, [
      /Garage Spaces[^0-9]{0,40}(\d+)/i,
      />(\d+)\s*Car Garage</i,
    ]) || 0,
  );
  const propertyType = /condo|townhome|townhouse/i.test(metaDesc)
    ? "condo"
    : "sfr";

  const place = placeFromPath(path);
  const city = place.city;
  const zip =
    place.zip ||
    pick(html, [/\b(90\d{3})\b/]) ||
    pick(path, [/-(90\d{3})/]) ||
    "";
  const desc = metaDesc || `Active South Bay listing · ${city}`;

  const oceanView = /ocean|catalina|pacific|sunset view|water view|strand/i.test(
    `${desc} ${street}`,
  );

  // Always geocode the street address. Page HTML often embeds a single
  // office/map default lat/lng that would stack every pin on one point.
  const g = await geocode(`${street}, ${city}, CA ${zip}`);
  if (!g) return null;
  const lat = g.lat;
  const lng = g.lng;
  await sleep(250);

  const now = new Date().toISOString();
  const outdoor =
    /yard|patio|deck|balcony|garden|lawn/i.test(desc) || (lot && lot >= 1500);

  return {
    id: `mbc-${path.replace(/\W+/g, "-").replace(/^-|-$/g, "").slice(0, 90)}`,
    source: "manual",
    sourceUrl: url,
    address: street,
    city,
    neighborhood: city,
    zip,
    lat,
    lng,
    price,
    beds,
    baths,
    sqft: sqft || 0,
    yearBuilt,
    lotSqft: lot || undefined,
    propertyType,
    garageSpaces: garage > 6 ? 0 : garage,
    outdoorSpace: Boolean(outdoor),
    outdoorTypes: outdoor ? ["yard"] : [],
    oceanView,
    oceanViewConfidence: oceanView ? "inferred" : "unknown",
    photos,
    description: desc.slice(0, 600),
    status: "active",
    listedAt: now,
    updatedAt: now,
    noiseCnel: estimateNoiseCnel(lat, lng),
  };
}

function loadJsonListings(path) {
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, "utf8")).listings ?? [];
  } catch {
    return [];
  }
}

function merge(groups) {
  const map = new Map();
  for (const g of groups) {
    for (const l of g) {
      const key = `${l.address.toLowerCase()}|${l.zip}|${Math.round(l.price / 1000)}`;
      const prev = map.get(key);
      if (!prev || l.updatedAt >= prev.updatedAt) map.set(key, l);
    }
  }
  return [...map.values()].sort((a, b) => b.price - a.price);
}

async function collectIndexPaths(baseUrl) {
  const firstHtml = await fetchText(baseUrl);
  const pages = pageCount(firstHtml);
  const found = new Set(extractListingPaths(firstHtml));
  for (let p = 2; p <= pages; p += 1) {
    await sleep(350);
    try {
      const html = await fetchText(withPage(baseUrl, p));
      for (const path of extractListingPaths(html)) found.add(path);
    } catch (err) {
      console.warn(`  page ${p} fail: ${err.message}`);
    }
  }
  return { found: [...found], pages };
}

async function main() {
  const previous = loadJsonListings(outPath);
  const paths = new Set();

  for (const url of INDEX_URLS) {
    try {
      const { found, pages } = await collectIndexPaths(url);
      console.log(
        `${found.length.toString().padStart(3)} links (${pages}p) ← ${url}`,
      );
      for (const p of found) paths.add(p);
    } catch (err) {
      console.warn(`index fail: ${url} :: ${err.message}`);
    }
    await sleep(400);
  }

  console.log(`\nUnique detail URLs: ${paths.size}`);
  if (paths.size === 0) {
    console.error(
      "No listing links found — leaving existing public/data/listings.json untouched.",
    );
    process.exit(1);
  }

  const listings = [];
  let i = 0;
  for (const path of paths) {
    i += 1;
    try {
      const row = await parseDetail(path);
      if (row) {
        listings.push(row);
        console.log(
          `  [${i}/${paths.size}] ✓ ${row.address}, ${row.city} · $${(row.price / 1e6).toFixed(2)}M · ${row.beds}/${row.baths}`,
        );
      } else {
        console.log(`  [${i}/${paths.size}] · skip ${path}`);
      }
    } catch (err) {
      console.warn(`  [${i}/${paths.size}] ✗ ${path}: ${err.message}`);
    }
    await sleep(550);
  }

  if (listings.length === 0) {
    console.error(
      "Parsed 0 listings — leaving existing public/data/listings.json untouched.",
    );
    process.exit(1);
  }

  const manual = loadJsonListings(manualPath);
  // Keep prior curated rows that aren't in the scrape (different sources)
  const merged = merge([previous, manual, listings]);
  mkdirSync(dirname(outPath), { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    sources: [
      "mbconfidential-market",
      ...(manual.length ? ["manual"] : []),
      ...(previous.length ? ["previous"] : []),
    ],
    listings: merged,
  };
  writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(`\nWrote ${merged.length} active listings → ${outPath}`);
  console.log(
    `Price band ingested: $${MIN_PRICE / 1e6}M–$${MAX_PRICE / 1e6}M (filter in the app)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

