const EPA_URL =
  "https://geodata.epa.gov/arcgis/rest/services/OA/WalkabilityIndex/MapServer/0/query";

const cache = new Map<string, number>();

function key(lat: number, lng: number) {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

/** EPA National Walkability Index (approx 1–20) for a point. */
export async function fetchEpaWalkIndex(
  lat: number,
  lng: number,
): Promise<number | null> {
  const k = key(lat, lng);
  if (cache.has(k)) return cache.get(k)!;

  const params = new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "NatWalkInd",
    returnGeometry: "false",
    f: "json",
  });

  const res = await fetch(`${EPA_URL}?${params}`);
  if (!res.ok) return null;
  const json = (await res.json()) as {
    features?: { attributes?: { NatWalkInd?: number } }[];
  };
  const value = json.features?.[0]?.attributes?.NatWalkInd;
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  cache.set(k, value);
  return value;
}

export async function fetchEpaWalkIndexBatch(
  points: { id: string; lat: number; lng: number }[],
  onProgress?: (done: number, total: number) => void,
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  let done = 0;
  for (const p of points) {
    const v = await fetchEpaWalkIndex(p.lat, p.lng);
    if (v != null) out[p.id] = Math.round(v * 10) / 10;
    done += 1;
    onProgress?.(done, points.length);
    // Be gentle with the ArcGIS service
    await new Promise((r) => setTimeout(r, 120));
  }
  return out;
}
