import { useEffect, useState } from "react";
import { LIVABILITY_BY_NAME } from "../data/neighborhoodLivability";
import { fetchEpaWalkIndexBatch } from "../lib/epaWalkability";
import type { Listing } from "../types";

export interface ListingLivability {
  safetyScore: number;
  safetyLabel: string;
  walkIndex: number;
  walkSource: "epa" | "neighborhood-fallback";
}

export function useLivability(listings: Listing[]) {
  const [byId, setById] = useState<Record<string, ListingLivability>>({});
  const [progress, setProgress] = useState("");
  const [ready, setReady] = useState(false);

  const signature = listings.map((l) => l.id).join("|");

  useEffect(() => {
    let cancelled = false;
    if (!listings.length) {
      setById({});
      setReady(true);
      return;
    }

    setReady(false);
    setProgress("Loading EPA walkability…");

    // Seed with neighborhood safety + walk fallback immediately
    const seed: Record<string, ListingLivability> = {};
    for (const l of listings) {
      const n = LIVABILITY_BY_NAME[l.neighborhood];
      seed[l.id] = {
        safetyScore: n?.safetyScore ?? 65,
        safetyLabel: n?.safetyLabel ?? "Moderate",
        walkIndex: n?.walkFallback ?? 12,
        walkSource: "neighborhood-fallback",
      };
    }
    setById(seed);

    (async () => {
      try {
        const walks = await fetchEpaWalkIndexBatch(
          listings.map((l) => ({ id: l.id, lat: l.lat, lng: l.lng })),
          (done, total) => {
            if (!cancelled) {
              setProgress(`EPA walkability ${done}/${total}`);
            }
          },
        );
        if (cancelled) return;
        setById((prev) => {
          const next = { ...prev };
          for (const l of listings) {
            const base = next[l.id] ?? seed[l.id];
            if (walks[l.id] != null) {
              next[l.id] = {
                ...base,
                walkIndex: walks[l.id],
                walkSource: "epa",
              };
            }
          }
          return next;
        });
      } finally {
        if (!cancelled) {
          setProgress("");
          setReady(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [signature, listings]);

  return { byId, progress, ready };
}
