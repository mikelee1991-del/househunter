/** Nominatim geocode, biased toward the South Bay. */

export interface GeocodeResult {
  lat: number;
  lng: number;
  displayName: string;
}

export async function geocodeAddress(
  query: string,
): Promise<GeocodeResult | null> {
  const q = query.trim();
  if (q.length < 5) return null;

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "us");
  url.searchParams.set("q", q);
  // Soft bias: LA South Bay / Westside
  url.searchParams.set("viewbox", "-118.55,33.70,-118.22,34.05");
  url.searchParams.set("bounded", "0");

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });
  if (res.ok) {
    const data = (await res.json()) as Array<{
      lat: string;
      lon: string;
      display_name: string;
    }>;
    const hit = data[0];
    if (hit) {
      return {
        lat: Number(hit.lat),
        lng: Number(hit.lon),
        displayName: hit.display_name,
      };
    }
  }

  // Census fallback (better at numbered CA streets Nominatim sometimes misses)
  const censusUrl =
    "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress" +
    `?address=${encodeURIComponent(q)}&benchmark=4&format=json`;
  const censusRes = await fetch(censusUrl);
  if (!censusRes.ok) return null;
  const census = (await censusRes.json()) as {
    result?: {
      addressMatches?: {
        matchedAddress: string;
        coordinates: { x: number; y: number };
      }[];
    };
  };
  const match = census.result?.addressMatches?.[0];
  if (!match) return null;
  return {
    lat: match.coordinates.y,
    lng: match.coordinates.x,
    displayName: match.matchedAddress,
  };
}
