/**
 * Re-verify every listing against Sereno CRMLS pages by MLS#.
 * Updates live ask price; drops sold / pending / gone.
 *
 *   npm run ingest:verify
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

/** Known sold / bad rows that must never re-enter inventory */
const DENY_MLS = new Set([
  "SB26028112", // 2420 The Strand — sold ~$16M; was wrongly stored at $1.55M
]);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function mlsFromUrl(url) {
  const m = String(url || "").match(/mls-([a-z]{2,4})(\d{6,})/i);
  if (!m) return null;
  return `${m[1].toUpperCase()}${m[2]}`;
}

function parseSereno(html, finalUrl) {
  const title = html.match(/<title[^>]*>([^<]+)/i)?.[1] || "";
  if (/page not found|404|no longer available/i.test(title + html.slice(0, 2000))) {
    return { status: "gone" };
  }

  // Status chips: "Active / MLS", "Pending / MLS", "Sold / MLS", "Price Change / MLS", "New / MLS"
  const chip =
    html.match(
      /\b(Active|Pending|Sold|Closed|Withdrawn|Canceled|Cancelled|Coming Soon|Price Change|New)\s*\/\s*MLS/i,
    )?.[1] || "";
  let status = "unknown";
  const chipL = chip.toLowerCase();
  if (chipL === "sold" || chipL === "closed") status = "sold";
  else if (chipL === "pending") status = "pending";
  else if (chipL === "withdrawn" || chipL === "canceled" || chipL === "cancelled")
    status = "sold";
  else if (
    chipL === "active" ||
    chipL === "new" ||
    chipL === "price change" ||
    chipL === "coming soon"
  ) {
    status = "active";
  }

  // Availability is authoritative even when chip text is messy
  if (/"availability"\s*:\s*"[^"]*(SoldOut|OutOfStock)"/i.test(html)) {
    status = "sold";
  } else if (status === "unknown") {
    if (
      /OffMarket|off-market|no longer available|Sold Price|Close Price/i.test(
        html.slice(0, 80_000),
      )
    ) {
      status = "sold";
    } else if (/"availability"\s*:\s*"[^"]*InStock"/i.test(html)) {
      status = "active";
    }
  }

  const schemaPrice = Number(html.match(/"price"\s*:\s*(\d{6,})/)?.[1]) || 0;
  const ask = extractAskPrice(html, { minPrice: 400_000, maxPrice: 50_000_000 });
  const priceNum =
    schemaPrice >= 400_000
      ? schemaPrice
      : ask.price >= 400_000
        ? ask.price
        : 0;

  const beds =
    Number(html.match(/(\d+)\s*Beds?\b/i)?.[1]) ||
    Number(html.match(/Bedrooms?<\/[^>]*>\s*(\d+)/i)?.[1]) ||
    0;
  const baths =
    Number(html.match(/([\d.]+)\s*Baths?\b/i)?.[1]) ||
    Number(html.match(/Bathrooms?<\/[^>]*>\s*([\d.]+)/i)?.[1]) ||
    0;
  const sqft =
    Number(
      (html.match(/([\d,]+)\s*Sq\.?\s*Ft/i)?.[1] || "").replace(/,/g, ""),
    ) || 0;

  const propertyType = /Condo|Townhome|Townhouse/i.test(
    html.match(/\/ MLS #\w+ \/ ([^/]+) \//)?.[1] || "",
  )
    ? "condo"
    : /Single Family/i.test(html)
      ? "sfr"
      : undefined;

  return {
    status,
    price: priceNum,
    beds,
    baths,
    sqft,
    propertyType,
    sourceUrl: finalUrl,
    title: title.replace(/&#039;/g, "'").slice(0, 120),
  };
}

async function verifyOne(mls) {
  const res = await fetch(`https://www.sereno.com/${mls}`, {
    headers: { "User-Agent": UA, Accept: "text/html" },
    redirect: "follow",
  });
  if (res.status === 404) return { status: "gone" };
  if (!res.ok) return { status: "error", http: res.status };
  const html = await res.text();
  return parseSereno(html, res.url);
}

async function main() {
  const data = JSON.parse(readFileSync(outPath, "utf8"));
  const listings = data.listings ?? [];
  const kept = [];
  let dropped = 0;
  let priceUpdates = 0;
  let errors = 0;

  for (let i = 0; i < listings.length; i += 1) {
    const l = listings[i];
    const mls =
      mlsFromUrl(l.sourceUrl) ||
      String(l.sourceUrl).match(/sereno\.com\/([A-Z]{2}\d{6,})/i)?.[1]?.toUpperCase();
    if (!mls) {
      // Non-MLS / unverifiable — drop to avoid stale junk
      dropped += 1;
      console.log(`[${i + 1}/${listings.length}] DROP no-mls ${l.address}`);
      continue;
    }
    if (DENY_MLS.has(mls)) {
      dropped += 1;
      console.log(`[${i + 1}/${listings.length}] DROP denylist ${mls} ${l.address}`);
      continue;
    }
    if (priceConflictsWithDescription(l.price, l.description)) {
      dropped += 1;
      console.log(
        `[${i + 1}/${listings.length}] DROP price/desc mismatch ${l.address} stored=$${l.price}`,
      );
      continue;
    }

    try {
      const live = await verifyOne(mls);
      if (live.status === "error") {
        errors += 1;
        console.warn(
          `[${i + 1}/${listings.length}] KEEP unverified HTTP ${live.http} ${l.address}`,
        );
        kept.push(l);
        await sleep(350);
        continue;
      }
      if (
        live.status === "sold" ||
        live.status === "pending" ||
        live.status === "gone"
      ) {
        dropped += 1;
        console.log(
          `[${i + 1}/${listings.length}] DROP ${live.status} ${l.address} (was $${(l.price / 1e6).toFixed(2)}M)`,
        );
        await sleep(250);
        continue;
      }
      // OutOfStock / closed chips already handled; also drop unknown w/ no price
      if (live.status !== "active") {
        if (!live.price || live.status === "unknown") {
          dropped += 1;
          console.log(
            `[${i + 1}/${listings.length}] DROP ${live.status || "unknown"} ${l.address}`,
          );
          await sleep(250);
          continue;
        }
      }

      const next = { ...l };
      if (live.price >= 400_000 && live.price !== l.price) {
        // Ignore wild swings that look like parse errors (>70% drop or >3x)
        const ratio = live.price / l.price;
        if (ratio < 0.3 || ratio > 3) {
          console.warn(
            `[${i + 1}/${listings.length}] PRICE SUSPECT $${(l.price / 1e6).toFixed(2)}M → $${(live.price / 1e6).toFixed(2)}M — keeping stored  ${l.address}`,
          );
        } else {
          priceUpdates += 1;
          console.log(
            `[${i + 1}/${listings.length}] PRICE $${(l.price / 1e6).toFixed(2)}M → $${(live.price / 1e6).toFixed(2)}M  ${l.address}`,
          );
          next.price = live.price;
        }
      } else {
        console.log(
          `[${i + 1}/${listings.length}] OK $${(l.price / 1e6).toFixed(2)}M ${l.address}`,
        );
      }
      if (live.beds > 0) next.beds = live.beds;
      if (live.baths > 0) next.baths = live.baths;
      if (live.sqft > 0) next.sqft = live.sqft;
      if (live.propertyType) next.propertyType = live.propertyType;
      if (live.sourceUrl?.includes("sereno.com")) {
        next.sourceUrl = live.sourceUrl;
        next.source = "manual";
      }
      next.status = "active";
      next.updatedAt = new Date().toISOString();
      kept.push(next);
    } catch (err) {
      errors += 1;
      console.warn(`[${i + 1}] ERR ${l.address}: ${err.message}`);
      kept.push(l);
    }
    await sleep(280);
  }

  kept.sort((a, b) => b.price - a.price);
  const payload = {
    generatedAt: new Date().toISOString(),
    sources: [
      ...new Set([...(data.sources || []), "sereno-verified"]),
    ],
    listings: kept,
  };
  writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(
    `\nKept ${kept.length}/${listings.length}; dropped ${dropped}; price updates ${priceUpdates}; errors ${errors}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
