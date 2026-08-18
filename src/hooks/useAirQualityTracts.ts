import { useEffect, useState } from "react";
import type { AirQualityTract } from "../lib/airQuality";

export type AirQualityTractsFile = {
  source: string;
  generatedAt: string;
  tractCount: number;
  avgAirQualityScore: number | null;
  tracts: AirQualityTract[];
};

export function useAirQualityTracts(enabled: boolean) {
  const [data, setData] = useState<AirQualityTractsFile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${import.meta.env.BASE_URL}data/air-quality-tracts.json`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as AirQualityTractsFile;
        if (!cancelled) {
          setData(json);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load air tracts");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { data, error };
}
