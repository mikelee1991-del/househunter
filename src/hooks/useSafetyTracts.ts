import { useEffect, useState } from "react";
import type { SafetyTractsFile } from "../data/safetyTiers";

export function useSafetyTracts(enabled: boolean) {
  const [data, setData] = useState<SafetyTractsFile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}data/safety-tracts.json`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as SafetyTractsFile;
        if (!cancelled) {
          setData(json);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load tracts");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { data, error };
}
