/**
 * Fresh market refresh via Playwright (plain fetch gets 403 from cloud IPs).
 * Pulls active index pages → updates prices, drops obsolete MLS IDs.
 *
 *   npm run ingest:refresh
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const outPath = join(root, "public", "data", "listings.json");

const MIN_PRICE = Number(process.env.INGEST_MIN_PRICE ?? 1_000_000);
const MAX_PRICE = Number(process.env.INGEST_MAX_PRICE ?? 12_000_000);
const MAX_PAGES = Number(process.env.INGEST_MAX_PAGES ?? 12);

const INDEX_URLS = [
  "https://www.mbconfidential.com/manhattan-beach-homes-for-sale.php",
  "https://www.mbconfidential.com/hermosa-beach-homes-for-sale.php",
  "https://www.mbconfidential.com/redondo-beach-homes-for-sale.php",
  "https://www.mbconfidential.com/hollywood-riviera-homes-for-sale.php",
  "https://www.mbconfidential.com/palos-verdes-estates-real-estate.php",
  "https://www.mbconfidential.com/palos-verdes-area-real-estate.php",
  "https://www.mbconfidential.com/torrance-real-estate.php",
  "https://www.mbconfidential.com/west-of-sepulveda-listings.php",
  "https://www.mbconfidential.com/east-manhattan-beach-homes-for-sale.php",
  "https://www.mbconfidential.com/manhattan-beach-sand-section-homes-for-sale.php",
  "https://www.mbconfidential.com/manhattan-beach-tree-section-homes-for-sale.php",
  "https://www.mbconfidential.com/manhattan-beach-hill-section-homes-for-sale.php",
  "https://www.mbconfidential.com/north-redondo-beach-real-estate.php",
  "https://www.mbconfidential.com/south-redondo-beach-real-estate.php",
];

const CITY_SLUGS = [
  ["rolling-hills-estates", "Rolling Hills Estates"],
  ["rancho-palos-verdes", "Rancho Palos Verdes"],
  ["palos-verdes-estates", "Palos Verdes Estates"],
  ["manhattan-beach", "Manhattan Beach"],
  ["hermosa-beach", "Hermosa Beach"],
  ["redondo-beach", "Redondo Beach"],
  ["el-segundo", "El Segundo"],
  ["torrance", "Torrance"],
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function mlsKeyFromUrl(url) {
  const m = String(url).match(/mls-([a-z0-9-]+)/i);
  return m ? m[1].toLowerCase().replace(/\/$/, "") : "";
}

function placeFromUrl(url) {
  try {
    const path = new URL(url).pathname.replace(/^\/|\/$/g, "");
    const before = path.split(/-mls-/i)[0] || "";
    const zipM = before.match(/^(.*?)-(90\d{3})$/);
    const zip = zipM?.[2] || "";
    const rest = zipM?.[1] || before;
    for (const [slug, name] of CITY_SLUGS) {
      if (rest.endsWith(`-${slug}`)) {
        const street = rest
          .slice(0, -(slug.length + 1))
          .replace(/-/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase());
        return { street, city: name, zip };
      }
    }
  } catch {
    /* ignore */
  }
  return { street: "", city: "Los Angeles", zip: "" };
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

async function geocodeCensus(address) {
  const url =
    "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress" +
    `?address=${encodeURIComponent(address)}&benchmark=4&format=json`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    const hit = json?.result?.addressMatches?.[0];
    if (!hit) return null;
    const lat = hit.coordinates.y;
    const lng = hit.coordinates.x;
    if (lat < 33.68 || lat > 34.05 || lng < -118.55 || lng > -118.22) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

async function collectFromIndex(page, baseUrl) {
  const found = new Map(); // mls -> {url, price, beds, baths, sqft, statusText}
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1200);

  const pageText = await page.locator("body").innerText().catch(() => "");
  const pageMatch = pageText.match(/PAGE\s+(\d+)\s+of\s+(\d+)/i);
  const totalPages = Math.min(Number(pageMatch?.[2] || 1), MAX_PAGES);

  for (let p = 1; p <= totalPages; p += 1) {
    if (p > 1) {
      const u = new URL(baseUrl);
      u.searchParams.set("p", String(p));
      await page.goto(u.toString(), {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await page.waitForTimeout(900);
    }

    const cards = await page.evaluate(() => {
      const out = [];
      const anchors = [...document.querySelectorAll('a[href*="-mls-"]')];
      for (const a of anchors) {
        const href = a.href;
        if (!/mls-[a-z]{2}\d+/i.test(href)) continue;
        if (/mls-area-/i.test(href)) continue;
        // Walk up to a card-ish container for price / beds text
        let el = a;
        let text = "";
        for (let i = 0; i < 6 && el; i += 1) {
          text = (el.innerText || "").replace(/\s+/g, " ").trim();
          if (/\$[\d,]+/.test(text) && /\d+\s*BR/i.test(text)) break;
          el = el.parentElement;
        }
        const priceM = text.match(/\$([\d,]+)/);
        const bedsM = text.match(/(\d+)\s*BR/i);
        const bathsM = text.match(/(\d+(?:\.\d+)?)\s*BA/i);
        const sqftM = text.match(/([\d,]+)\s*SqFt/i);
        const statusM = text.match(/\b(Active|Pending|Sold|Coming Soon)\b/i);
        out.push({
          href,
          price: priceM ? Number(priceM[1].replace(/,/g, "")) : 0,
          beds: bedsM ? Number(bedsM[1]) : 0,
          baths: bathsM ? Number(bathsM[1]) : 0,
          sqft: sqftM ? Number(sqftM[1].replace(/,/g, "")) : 0,
          status: (statusM?.[1] || "").toLowerCase(),
          snippet: text.slice(0, 220),
        });
      }
      return out;
    });

    for (const c of cards) {
      if (c.status === "pending" || c.status === "sold") continue;
      if (!c.price || c.price < MIN_PRICE || c.price > MAX_PRICE) continue;
      const key = mlsKeyFromUrl(c.href);
      if (!key) continue;
      const prev = found.get(key);
      if (!prev || (c.price && !prev.price)) found.set(key, c);
      else if (c.price) found.set(key, { ...prev, ...c });
    }
    console.log(`  p${p}/${totalPages}: +${cards.length} raw → ${found.size} active`);
  }
  return found;
}

function loadExisting() {
  if (!existsSync(outPath)) return [];
  try {
    return JSON.parse(readFileSync(outPath, "utf8")).listings ?? [];
  } catch {
    return [];
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
    locale: "en-US",
  });
  const page = await context.newPage();

  const live = new Map();
  for (const url of INDEX_URLS) {
    console.log(`Index ${url}`);
    try {
      const batch = await collectFromIndex(page, url);
      for (const [k, v] of batch) live.set(k, v);
      console.log(`  cumulative unique active MLS: ${live.size}`);
    } catch (err) {
      console.warn(`  index fail: ${err.message}`);
    }
    await sleep(500);
  }

  // Probe a few detail pages for status confirmation
  let detailOk = 0;
  let detailBlocked = 0;
  const sampleKeys = [...live.keys()].slice(0, 5);
  for (const key of sampleKeys) {
    const href = live.get(key).href;
    try {
      const res = await page.goto(href, {
        waitUntil: "domcontentloaded",
        timeout: 45000,
      });
      const status = res?.status() ?? 0;
      const body = await page.locator("body").innerText().catch(() => "");
      if (status === 403 || /403 Forbidden/i.test(body)) {
        detailBlocked += 1;
      } else {
        detailOk += 1;
        const priceM = body.match(/Current Price[\s\S]{0,80}?\$([\d,]+)/i);
        if (priceM) {
          const price = Number(priceM[1].replace(/,/g, ""));
          if (price > 0) live.get(key).price = price;
        }
        if (/Pending Status|Sold Status/i.test(body)) {
          live.delete(key);
        }
      }
    } catch {
      detailBlocked += 1;
    }
    await sleep(400);
  }
  console.log(`Detail probe: ok=${detailOk} blocked=${detailBlocked}`);

  await browser.close();

  if (live.size < 20) {
    console.error(
      `Only ${live.size} live listings found — aborting to avoid wiping inventory.`,
    );
    process.exit(1);
  }

  const existing = loadExisting();
  const byMls = new Map();
  for (const l of existing) {
    const k = mlsKeyFromUrl(l.sourceUrl);
    if (k) byMls.set(k, l);
  }

  const now = new Date().toISOString();
  const next = [];
  let updatedPrice = 0;
  let kept = 0;
  let created = 0;
  let dropped = 0;

  for (const [mls, card] of live) {
    const place = placeFromUrl(card.href);
    const prev = byMls.get(mls);
    if (prev) {
      const priceChanged = prev.price !== card.price && card.price > 0;
      if (priceChanged) updatedPrice += 1;
      next.push({
        ...prev,
        address: place.street || prev.address,
        city: place.city || prev.city,
        neighborhood: place.city || prev.neighborhood,
        zip: place.zip || prev.zip,
        price: card.price || prev.price,
        beds: card.beds || prev.beds,
        baths: card.baths || prev.baths,
        sqft: card.sqft || prev.sqft,
        sourceUrl: card.href,
        status: "active",
        updatedAt: now,
      });
      kept += 1;
    } else {
      // New listing — geocode
      const address = `${place.street}, ${place.city}, CA ${place.zip}`;
      const g = await geocodeCensus(address);
      await sleep(120);
      if (!g) {
        console.warn(`  skip new (no geo): ${address}`);
        continue;
      }
      next.push({
        id: `mbc-${mls}`,
        source: "manual",
        sourceUrl: card.href,
        address: place.street,
        city: place.city,
        neighborhood: place.city,
        zip: place.zip,
        lat: g.lat,
        lng: g.lng,
        price: card.price,
        beds: card.beds,
        baths: card.baths,
        sqft: card.sqft,
        propertyType: "sfr",
        garageSpaces: 0,
        outdoorSpace: true,
        outdoorTypes: ["yard"],
        oceanView: false,
        oceanViewConfidence: "unknown",
        photos: [],
        description: `Active South Bay listing · ${place.city}`,
        status: "active",
        listedAt: now,
        updatedAt: now,
        noiseCnel: estimateNoiseCnel(g.lat, g.lng),
      });
      created += 1;
    }
  }

  for (const l of existing) {
    const k = mlsKeyFromUrl(l.sourceUrl);
    if (k && !live.has(k)) dropped += 1;
  }

  // Prefer live-only set (drop obsolete). Keep non-MBC curated if any.
  const nonMbc = existing.filter(
    (l) => l.sourceUrl && !l.sourceUrl.includes("mbconfidential.com"),
  );
  const merged = [...nonMbc, ...next].sort((a, b) => b.price - a.price);

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: now,
        sources: ["mbconfidential-refresh", "playwright-index"],
        listings: merged,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  console.log(`\nWrote ${merged.length} listings → ${outPath}`);
  console.log(
    `kept=${kept} created=${created} droppedObsolete=${dropped} priceUpdates=${updatedPrice}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
