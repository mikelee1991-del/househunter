/** CalEnviroScreen 4.0 air / pollution burden helpers. */

export type AirQualityTract = {
  tract: string;
  zip?: string | null;
  city?: string | null;
  approxLoc?: string | null;
  population?: number | null;
  pm25?: number | null;
  pm25Pctile?: number | null;
  diesel?: number | null;
  dieselPctile?: number | null;
  ozone?: number | null;
  ozonePctile?: number | null;
  pollutionBurden?: number | null;
  pollutionBurdenPctile?: number | null;
  /** 100 − pollution burden percentile; higher = cleaner. */
  airQualityScore: number | null;
  rings: [number, number][][];
};

export type AirQualityLookup = {
  tract: string;
  city: string | null;
  approxLoc: string | null;
  pm25: number | null;
  pm25Pctile: number | null;
  diesel: number | null;
  dieselPctile: number | null;
  ozone: number | null;
  ozonePctile: number | null;
  pollutionBurden: number | null;
  pollutionBurdenPctile: number | null;
  airQualityScore: number | null;
};

function pointInRing(lat: number, lng: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lat: number, lng: number, rings: [number, number][][]): boolean {
  if (!rings.length) return false;
  if (!pointInRing(lat, lng, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) {
    if (pointInRing(lat, lng, rings[i])) return false;
  }
  return true;
}

export function lookupAirQuality(
  lat: number,
  lng: number,
  tracts: AirQualityTract[]
): AirQualityLookup | null {
  for (const t of tracts) {
    if (!pointInPolygon(lat, lng, t.rings)) continue;
    return {
      tract: t.tract,
      city: t.city ?? null,
      approxLoc: t.approxLoc ?? null,
      pm25: t.pm25 ?? null,
      pm25Pctile: t.pm25Pctile ?? null,
      diesel: t.diesel ?? null,
      dieselPctile: t.dieselPctile ?? null,
      ozone: t.ozone ?? null,
      ozonePctile: t.ozonePctile ?? null,
      pollutionBurden: t.pollutionBurden ?? null,
      pollutionBurdenPctile: t.pollutionBurdenPctile ?? null,
      airQualityScore: t.airQualityScore,
    };
  }
  return null;
}

/** Green (clean) → amber → red (high burden). */
export function airQualityColor(score: number | null | undefined): string {
  if (score == null || !Number.isFinite(score)) return "#94a3b8";
  if (score >= 70) return "#16a34a";
  if (score >= 50) return "#65a30d";
  if (score >= 35) return "#ca8a04";
  if (score >= 20) return "#ea580c";
  return "#dc2626";
}

export function airQualityBand(score: number | null | undefined): string {
  if (score == null || !Number.isFinite(score)) return "Unknown";
  if (score >= 70) return "Lower burden";
  if (score >= 50) return "Moderate";
  if (score >= 35) return "Elevated";
  if (score >= 20) return "High";
  return "Very high";
}
