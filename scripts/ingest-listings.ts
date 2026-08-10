/**
 * Daily multi-source listing ingest.
 *
 * Sources (enable via env):
 *   RENTCAST_API_KEY  — RentCast sale listings
 *   RAPIDAPI_KEY      — optional RapidAPI Realtor/Zillow proxies
 *
 * Always merges with manual seed overlays in data/manual-listings.json
 * and writes public/data/listings.json for the UI.
 *
 * Run: npm run ingest
 * Schedule: GitHub Action daily (see .github/workflows/ingest-listings.yml)
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const outPath = join(root, "public", "data", "listings.json");
const manualPath = join(root, "data", "manual-listings.json");

type RawListing = {
  id: string;
  source: string;
  sourceUrl: string;
  address: string;
  city: string;
  neighborhood: string;
  zip: string;
  lat: number;
  lng: number;
  price: number;
  beds: number;
  baths: number;
  sqft: number;
  yearBuilt?: number;
  lotSqft?: number;
  facingDegrees?: number;
  propertyType: "sfr" | "townhouse" | "condo" | "multi" | "other";
  garageSpaces: number;
  outdoorSpace: boolean;
  outdoorTypes?: Array<
    "patio" | "deck" | "balcony" | "terrace" | "yard" | "rooftop" | "other"
  >;
  oceanView: boolean;
  oceanViewConfidence: "listed" | "inferred" | "unknown" | "gis";
  photos: string[];
  description: string;
  status: "active" | "pending" | "sold";
  listedAt: string;
  updatedAt: string;
  noiseCnel: number;
};

const SOUTH_BAY_CITIES = [
  "Manhattan Beach",
  "Hermosa Beach",
  "Redondo Beach",
  "Torrance",
  "Rancho Palos Verdes",
  "Palos Verdes Estates",
  "El Segundo",
  "Playa del Rey",
  "Westchester",
  "San Pedro",
  "Marina del Rey",
];

function estimateNoiseCnel(lat: number, lng: number): number {
  // Lightweight copy of contour heuristic for Node ingest
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

/** Reject city/neighborhood search pages — only keep property detail URLs. */
function isPropertyListingUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const path = u.pathname;
    if (host === "redfin.com") return /\/home\/\d+\/?$/.test(path);
    if (host.includes("zillow")) {
      return path.includes("/homedetails/") || /\/\d+_zpid\/?$/.test(path);
    }
    if (host === "realtor.com") {
      return path.includes("/realestateandhomes-detail/");
    }
    if (host === "compass.com") {
      return path.includes("/listing/") || path.includes("/homedetails/");
    }
    if (host.includes("coldwellbanker")) {
      return (
        path.includes("/lid-") ||
        path.includes("/property/") ||
        /\/pid_\d+/i.test(path)
      );
    }
    if (host === "sereno.com" || host.endsWith(".sereno.com")) {
      return /\/[A-Z]{2}\d{6,}\//i.test(path);
    }
    return false;
  } catch {
    return false;
  }
}

type MarketStatus = "active" | "pending" | "sold" | "unknown";

function inferMarketStatusFromHtml(html: string, pageTitle = ""): MarketStatus {
  const head = `${pageTitle}\n${html.slice(0, 80_000)}`;
  if (/\|\s*sold\b/i.test(pageTitle) || /\bsold\s+for\b/i.test(pageTitle)) {
    return "sold";
  }
  if (/\|\s*pending\b/i.test(pageTitle)) return "pending";
  if (
    /property is no longer available|this home (?:has been )?sold|sold \(?closed\)?|off[\s-]market|listing (?:has been )?removed/i.test(
      head,
    )
  ) {
    return "sold";
  }
  if (
    /this home is pending|\bpending sale\b|\bactive under contract\b|\bcontingent\b/i.test(
      head,
    )
  ) {
    return "pending";
  }
  const statusField =
    head.match(
      /"(?:mlsStatus|listingStatus|statusLabel|statusValue|StandardStatus)"\s*:\s*"([^"]+)"/i,
    )?.[1] ??
    head.match(/\bStatus\s*<\/[^>]*>\s*([^<\n]{3,40})/i)?.[1] ??
    "";
  const s = statusField.trim().toLowerCase();
  if (s) {
    if (/\bsold\b|\bclosed\b|\boff/.test(s)) return "sold";
    if (/pending|under contract|contingent/.test(s)) return "pending";
    if (/active|for sale|coming soon/.test(s)) return "active";
  }
  if (
    /\bfor sale\b|\blisted \(active\)\b|\bstatus\s*[:|]?\s*active\b|\bactive\s*\/\s*mls\b/i.test(
      head,
    )
  ) {
    return "active";
  }
  return "unknown";
}

async function verifyListingStillActive(
  listing: RawListing,
): Promise<RawListing | null> {
  if (listing.status !== "active") return null;
  if (!isPropertyListingUrl(listing.sourceUrl)) return null;

  // Skip live probe unless explicitly enabled (rate limits / bot walls).
  if (process.env.VERIFY_LISTING_STATUS !== "1") {
    return listing;
  }

  try {
    const res = await fetch(listing.sourceUrl, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "househunter-ingest/1.0",
      },
      redirect: "follow",
    });
    if (res.status === 404) {
      console.warn(`Drop ${listing.address}: source URL 404`);
      return null;
    }
    if (!res.ok) {
      console.warn(
        `Keep ${listing.address}: status probe HTTP ${res.status} (unverified)`,
      );
      return listing;
    }
    const html = await res.text();
    const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? "";
    const market = inferMarketStatusFromHtml(html, title);
    if (market === "sold" || market === "pending") {
      console.warn(`Drop ${listing.address}: live status=${market}`);
      return null;
    }
    return { ...listing, status: "active" };
  } catch (err) {
    console.warn(`Keep ${listing.address}: status probe failed`, err);
    return listing;
  }
}

function inferPropertyType(
  text: string,
  propertyTypeField?: unknown,
): RawListing["propertyType"] {
  const field = String(propertyTypeField ?? "").toLowerCase();
  if (/single|sfr|detached/.test(field) && !/town|condo|multi/.test(field)) {
    return "sfr";
  }
  if (/town/.test(field)) return "townhouse";
  if (/condo|apartment/.test(field)) return "condo";
  if (/multi|duplex|triplex|fourplex/.test(field)) return "multi";

  const t = text.toLowerCase();
  if (/\b(townhome|townhouse|town home)\b/.test(t)) return "townhouse";
  if (/\b(condo|condominium)\b/.test(t)) return "condo";
  if (/\b(duplex|triplex|fourplex|multi-family|multifamily)\b/.test(t)) {
    return "multi";
  }
  if (/\b(single[-\s]?family|detached)\b/.test(t)) return "sfr";
  // Default unknown attached-leaning inventory to other so SFR filter rejects
  if (/\b(shared wall|common wall|attached home)\b/.test(t)) return "townhouse";
  return "sfr";
}

function inferGarageSpaces(text: string, garageSpacesField?: unknown): number {
  if (typeof garageSpacesField === "number" && garageSpacesField >= 0) {
    return garageSpacesField;
  }
  const t = text.toLowerCase();
  if (/\b(3|three)[\s-]?car garage\b/.test(t)) return 3;
  if (/\b(4|four)[\s-]?car garage\b/.test(t)) return 4;
  if (/\b(2|two)[\s-]?car garage\b/.test(t)) return 2;
  if (/\b(1|one|single)[\s-]?car garage\b/.test(t)) return 1;
  if (/\bgarage\b/.test(t)) return 2; // common SFR default when mentioned
  return 0;
}

function inferOutdoor(text: string, lotSqft?: number): {
  outdoorSpace: boolean;
  outdoorTypes: RawListing["outdoorTypes"];
} {
  const t = text.toLowerCase();
  const types: NonNullable<RawListing["outdoorTypes"]> = [];
  if (/\bpatio\b/.test(t)) types.push("patio");
  if (/\bdeck\b/.test(t)) types.push("deck");
  if (/\bbalcony\b/.test(t)) types.push("balcony");
  if (/\bterrace\b/.test(t)) types.push("terrace");
  if (/\b(yard|lawn|garden|backyard)\b/.test(t)) types.push("yard");
  if (/\brooftop\b/.test(t)) types.push("rooftop");
  if (types.length) return { outdoorSpace: true, outdoorTypes: types };
  if (lotSqft && lotSqft >= 2000) {
    return { outdoorSpace: true, outdoorTypes: ["yard"] };
  }
  return { outdoorSpace: false, outdoorTypes: [] };
}

function inferOceanView(text: string, neighborhood: string): {
  oceanView: boolean;
  confidence: "listed" | "inferred" | "unknown";
} {
  const t = text.toLowerCase();
  if (
    /ocean view|panoramic ocean|pacific view|catalina view|water view/.test(t)
  ) {
    return { oceanView: true, confidence: "listed" };
  }
  const coastal = [
    "Palos Verdes Estates",
    "Rancho Palos Verdes",
    "Playa del Rey",
    "Manhattan Beach",
    "Hermosa Beach",
    "Redondo Beach",
  ];
  if (coastal.includes(neighborhood) && /view|bluff|esplanade|strand/.test(t)) {
    return { oceanView: true, confidence: "inferred" };
  }
  return { oceanView: false, confidence: "unknown" };
}

function loadManual(): RawListing[] {
  if (!existsSync(manualPath)) return [];
  const raw = JSON.parse(readFileSync(manualPath, "utf8")) as {
    listings: RawListing[];
  };
  return raw.listings ?? [];
}

function loadExisting(): RawListing[] {
  if (!existsSync(outPath)) return [];
  try {
    const raw = JSON.parse(readFileSync(outPath, "utf8")) as {
      listings: RawListing[];
    };
    return raw.listings ?? [];
  } catch {
    return [];
  }
}

async function fetchRentCast(): Promise<RawListing[]> {
  const key = process.env.RENTCAST_API_KEY;
  if (!key) {
    console.log("RentCast: skipped (no RENTCAST_API_KEY)");
    return [];
  }

  const results: RawListing[] = [];
  const now = new Date().toISOString();

  for (const city of SOUTH_BAY_CITIES) {
    const url = new URL("https://api.rentcast.io/v1/listings/sale");
    url.searchParams.set("city", city);
    url.searchParams.set("state", "CA");
    url.searchParams.set("status", "Active");
    // Wide band — app criteria filters down
    url.searchParams.set("priceMin", String(process.env.INGEST_MIN_PRICE ?? 1500000));
    url.searchParams.set("priceMax", String(process.env.INGEST_MAX_PRICE ?? 5000000));
    url.searchParams.set("propertyType", "Single Family");
    url.searchParams.set("limit", "100");

    const res = await fetch(url, {
      headers: { "X-Api-Key": key, Accept: "application/json" },
    });
    if (!res.ok) {
      console.warn(`RentCast ${city}: HTTP ${res.status}`);
      continue;
    }
    const data = (await res.json()) as Array<Record<string, unknown>>;
    for (const item of data) {
      const lat = Number(item.latitude);
      const lng = Number(item.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const desc = String(item.description ?? item.formattedAddress ?? "");
      const neighborhood = String(item.city ?? city);
      const view = inferOceanView(desc, neighborhood);
      const lotSqft = item.lotSize ? Number(item.lotSize) : undefined;
      const outdoor = inferOutdoor(desc, lotSqft);
      const id = `rentcast-${String(item.id ?? `${lat}-${lng}`)}`;
      results.push({
        id,
        source: "rentcast",
        sourceUrl: String(item.url ?? item.listingUrl ?? "https://rentcast.io"),
        address: String(item.formattedAddress ?? item.addressLine1 ?? "Unknown"),
        city: String(item.city ?? city),
        neighborhood,
        zip: String(item.zipCode ?? ""),
        lat,
        lng,
        price: Number(item.price ?? 0),
        beds: Number(item.bedrooms ?? 0),
        baths: Number(item.bathrooms ?? 0),
        sqft: Number(item.squareFootage ?? 0),
        yearBuilt: item.yearBuilt ? Number(item.yearBuilt) : undefined,
        lotSqft,
        propertyType: inferPropertyType(
          desc,
          item.propertyType ?? item.type,
        ),
        garageSpaces: inferGarageSpaces(desc, item.garageSpaces ?? item.garage),
        outdoorSpace: outdoor.outdoorSpace,
        outdoorTypes: outdoor.outdoorTypes,
        oceanView: view.oceanView,
        oceanViewConfidence: view.confidence,
        photos: Array.isArray(item.photos)
          ? (item.photos as string[]).slice(0, 6)
          : [],
        description: desc.slice(0, 600),
        status: "active",
        listedAt: String(item.listedDate ?? now),
        updatedAt: now,
        noiseCnel: estimateNoiseCnel(lat, lng),
      });
    }
    // gentle rate limit
    await new Promise((r) => setTimeout(r, 350));
  }

  console.log(`RentCast: ${results.length} listings`);
  return results;
}

async function fetchRapidApiRealtor(): Promise<RawListing[]> {
  const key = process.env.RAPIDAPI_KEY;
  if (!key) {
    console.log("RapidAPI Realtor: skipped (no RAPIDAPI_KEY)");
    return [];
  }

  // Realtor.com via RapidAPI — endpoint shapes vary by provider; best-effort.
  const host = process.env.RAPIDAPI_REALTOR_HOST ?? "realtor16.p.rapidapi.com";
  const url =
    `https://${host}/search/forsale?location=Redondo%20Beach%2C%20CA` +
    `&list_price_min=2500000&list_price_max=3500000&limit=40`;

  try {
    const res = await fetch(url, {
      headers: {
        "X-RapidAPI-Key": key,
        "X-RapidAPI-Host": host,
      },
    });
    if (!res.ok) {
      console.warn(`RapidAPI Realtor: HTTP ${res.status}`);
      return [];
    }
    const json = (await res.json()) as {
      data?: { home_search?: { results?: Array<Record<string, unknown>> } };
      results?: Array<Record<string, unknown>>;
    };
    const rows =
      json.data?.home_search?.results ?? json.results ?? ([] as Array<Record<string, unknown>>);
    const now = new Date().toISOString();
    const out: RawListing[] = [];
    for (const item of rows) {
      const loc = (item.location ?? item) as Record<string, unknown>;
      const addr = (loc.address ?? item.address ?? {}) as Record<string, unknown>;
      const coord = (addr.coordinate ?? loc.coordinate ?? {}) as {
        lat?: number;
        lon?: number;
        lng?: number;
      };
      const lat = Number(coord.lat);
      const lng = Number(coord.lon ?? coord.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const description = String(item.description ?? item.permalink ?? "");
      const city = String(addr.city ?? "Redondo Beach");
      const view = inferOceanView(description, city);
      const sqft = Number(
        (item.description as { sqft?: number })?.sqft ?? item.sqft ?? 0,
      );
      const outdoor = inferOutdoor(description);
      const photosRaw = item.primary_photo ?? item.photos;
      const photos: string[] = [];
      if (photosRaw && typeof photosRaw === "object" && "href" in (photosRaw as object)) {
        photos.push(String((photosRaw as { href: string }).href));
      }
      out.push({
        id: `realtor-${String(item.property_id ?? item.listing_id ?? `${lat}-${lng}`)}`,
        source: "realtor",
        sourceUrl: String(
          item.href ?? item.permalink ?? "https://www.realtor.com",
        ),
        address: String(addr.line ?? addr.street_name ?? "Unknown"),
        city,
        neighborhood: city,
        zip: String(addr.postal_code ?? ""),
        lat,
        lng,
        price: Number(
          (item.list_price as number) ??
            (item.price as number) ??
            0,
        ),
        beds: Number((item.description as { beds?: number })?.beds ?? item.beds ?? 0),
        baths: Number(
          (item.description as { baths?: number })?.baths ?? item.baths ?? 0,
        ),
        sqft,
        propertyType: inferPropertyType(
          description,
          (item.description as { type?: string })?.type ?? item.status_type,
        ),
        garageSpaces: inferGarageSpaces(description, item.garage),
        outdoorSpace: outdoor.outdoorSpace,
        outdoorTypes: outdoor.outdoorTypes,
        oceanView: view.oceanView,
        oceanViewConfidence: view.confidence,
        photos,
        description: description.slice(0, 600),
        status: "active",
        listedAt: now,
        updatedAt: now,
        noiseCnel: estimateNoiseCnel(lat, lng),
      });
    }
    console.log(`RapidAPI Realtor: ${out.length} listings`);
    return out;
  } catch (err) {
    console.warn("RapidAPI Realtor failed:", err);
    return [];
  }
}

function mergeListings(groups: RawListing[][]): RawListing[] {
  const map = new Map<string, RawListing>();
  for (const group of groups) {
    for (const listing of group) {
      const key =
        listing.id.startsWith("manual") || listing.source === "manual"
          ? listing.id
          : `${listing.address.toLowerCase()}|${listing.zip}|${listing.price}`;
      const prev = map.get(key);
      if (!prev || listing.updatedAt >= prev.updatedAt) {
        // Prefer manual facingDegrees / oceanView when merging onto same address
        if (prev?.source === "manual") {
          map.set(key, {
            ...listing,
            facingDegrees: prev.facingDegrees ?? listing.facingDegrees,
            oceanView: prev.oceanView || listing.oceanView,
            oceanViewConfidence:
              prev.oceanViewConfidence !== "unknown"
                ? prev.oceanViewConfidence
                : listing.oceanViewConfidence,
            photos: listing.photos.length ? listing.photos : prev.photos,
          });
        } else {
          map.set(key, listing);
        }
      }
    }
  }
  return [...map.values()].sort((a, b) => b.price - a.price);
}

async function main() {
  const sourcesUsed: string[] = [];
  const existing = loadExisting();
  const manual = loadManual();
  if (manual.length) sourcesUsed.push("manual");
  if (existing.length && !manual.length) sourcesUsed.push("existing-cache");

  const rentcast = await fetchRentCast();
  if (rentcast.length) sourcesUsed.push("rentcast");

  const realtor = await fetchRapidApiRealtor();
  if (realtor.length) sourcesUsed.push("realtor");

  // If no live APIs, keep existing seed file content (or manual)
  const merged = mergeListings([
    manual,
    rentcast,
    realtor,
    // fallback seed so the UI never goes empty
    existing,
  ]);

  const candidates = merged.filter(
    (l) => l.status === "active" && isPropertyListingUrl(l.sourceUrl),
  );
  const droppedShape = merged.length - candidates.length;
  if (droppedShape > 0) {
    console.warn(
      `Dropped ${droppedShape} listing(s) that were not active or lacked a property-detail URL.`,
    );
  }

  const verified: RawListing[] = [];
  for (const listing of candidates) {
    const keep = await verifyListingStillActive(listing);
    if (keep) verified.push(keep);
  }

  if (!sourcesUsed.length) sourcesUsed.push("seed-cache");

  mkdirSync(dirname(outPath), { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    sources: sourcesUsed,
    listings: verified,
  };
  writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(
    `Wrote ${verified.length} active listings → ${outPath} [${sourcesUsed.join(", ")}]`,
  );
  if (process.env.VERIFY_LISTING_STATUS !== "1") {
    console.log(
      "Tip: set VERIFY_LISTING_STATUS=1 to re-check each source URL and drop sold/pending pages.",
    );
  }

  if (!process.env.RENTCAST_API_KEY && !process.env.RAPIDAPI_KEY) {
    console.log(
      "\nTip: set RENTCAST_API_KEY for full MLS-style pulls, or run `npm run ingest:market` (MB Confidential IDX scrape).",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
