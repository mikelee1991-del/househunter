/**
 * Backfill beds/baths/sqft/photos/year from MBC detail meta tags.
 *   node scripts/enrich-mbc-listings.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractAskPrice,
  priceConflictsWithDescription,
} from "./lib/parseListingPrice.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = join(root, "public", "data", "listings.json");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseMeta(html) {
  const desc =
    html.match(
      /<meta\s+name="description"\s+content="([^"]+)"/i,
    )?.[1] ||
    html.match(
      /<meta\s+property="og:description"\s+content="([^"]+)"/i,
    )?.[1] ||
    "";

  const bedBath = desc.match(
    /(\d+)\s*-?\s*bedroom[s]?,\s*([\d.]+)\s*-?\s*bathroom/i,
  );
  const sqftM = desc.match(/([\d,]+)\s*sq\.?\s*ft/i);
  const yearM = desc.match(/built in (\d{4})/i);
  const typeM = desc.match(
    /(Single Family Residence|Condo|Townhouse|Townhome|Multi[- ]Family)/i,
  );

  const photos = [
    ...html.matchAll(
      /<meta\s+property="og:image"\s+content="(https:\/\/[^"]+)"/gi,
    ),
  ]
    .map((m) => m[1])
    .filter((u, i, arr) => arr.indexOf(u) === i)
    .slice(0, 8);

  let garage = 0;
  const garageM = html.match(
    /Garage Spaces[^0-9]{0,40}(\d+)/i,
  ) || html.match(/>(\d+)\s*Car Garage</i);
  if (garageM) garage = Number(garageM[1]);

  const lotM =
    html.match(/Lot Size[^0-9]{0,40}([\d,]+)/i) ||
    html.match(/([\d,]+)\s*Lot\b/i);

  return {
    beds: bedBath ? Number(bedBath[1]) : 0,
    baths: bedBath ? Number(bedBath[2]) : 0,
    sqft: sqftM ? Number(sqftM[1].replace(/,/g, "")) : 0,
    yearBuilt: yearM ? Number(yearM[1]) : undefined,
    propertyType: /condo|town/i.test(typeM?.[1] || "")
      ? "condo"
      : /multi/i.test(typeM?.[1] || "")
        ? "multi"
        : "sfr",
    garageSpaces: garage,
    lotSqft: lotM ? Number(lotM[1].replace(/,/g, "")) : undefined,
    photos,
    description: desc.slice(0, 600),
  };
}

async function main() {
  const data = JSON.parse(readFileSync(outPath, "utf8"));
  const listings = data.listings ?? [];
  let updated = 0;

  for (let i = 0; i < listings.length; i += 1) {
    const l = listings[i];
    if (!l.sourceUrl?.includes("mbconfidential.com")) continue;
    if (l.beds > 0 && l.baths > 0 && l.sqft > 0 && l.photos?.length) continue;

    try {
      const res = await fetch(l.sourceUrl, {
        headers: { "User-Agent": UA, Accept: "text/html" },
      });
      if (!res.ok) {
        console.warn(`[${i + 1}/${listings.length}] HTTP ${res.status} ${l.address}`);
        continue;
      }
      const html = await res.text();
      const meta = parseMeta(html);
      if (meta.beds) l.beds = meta.beds;
      if (meta.baths) l.baths = meta.baths;
      if (meta.sqft) l.sqft = meta.sqft;
      if (meta.yearBuilt) l.yearBuilt = meta.yearBuilt;
      if (meta.propertyType) l.propertyType = meta.propertyType;
      if (meta.garageSpaces && (!l.garageSpaces || l.garageSpaces > 6)) {
        l.garageSpaces = meta.garageSpaces;
      }
      if (meta.lotSqft) l.lotSqft = meta.lotSqft;
      if (meta.photos.length) l.photos = meta.photos;
      if (meta.description) l.description = meta.description;
      // Repair ask price from meta / Current Price (never keep reduction deltas)
      const ask = extractAskPrice(html);
      if (ask.price >= 400_000) {
        if (
          !l.price ||
          priceConflictsWithDescription(l.price, meta.description) ||
          ask.price > l.price * 1.2
        ) {
          l.price = ask.price;
        }
      }
      l.outdoorSpace =
        l.outdoorSpace ||
        /yard|patio|deck|balcony|garden/i.test(meta.description) ||
        (l.lotSqft ?? 0) >= 1500;
      l.oceanView =
        l.oceanView ||
        /ocean|catalina|pacific|sunset|water view|strand/i.test(
          meta.description,
        );
      updated += 1;
      console.log(
        `[${i + 1}/${listings.length}] ${l.address} → ${l.beds}/${l.baths} ${l.sqft}sqft`,
      );
    } catch (err) {
      console.warn(`[${i + 1}] ${l.address}: ${err.message}`);
    }
    await sleep(400);
  }

  data.generatedAt = new Date().toISOString();
  data.sources = [...new Set([...(data.sources || []), "mbc-enriched"])];
  writeFileSync(outPath, JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log(`\nEnriched ${updated} listings → ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
