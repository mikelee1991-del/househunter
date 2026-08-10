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

function fromListing(l: Listing): ListingLivability | null {
  if (l.analysis) {
    return {
      safetyScore: l.analysis.safetyScore,
      safetyLabel: l.analysis.safetyLabel,
      walkIndex: l.analysis.walkIndex,
      walkSource: l.analysis.walkSource,
    };
  }
  return null;
}

export function useLivability(listings: Listing[]) {
  const [byId, setById] = useState<Record<string, ListingLivability>>({});
  const [progress, setProgress] = useState("");
  const [ready, setReady] = useState(false);

  const signature = listings.map((l) => l.id).join("|");
  const allPrecomputed =
    listings.length > 0 && listings.every((l) => !!l.analysis);

  useEffect(() => {
    let cancelled = false;
    if (!listings.length) {
      setById({});
      setReady(true);
      return;
    }

    // Prefer baked-in analysis for instant paint
    const seed: Record<string, ListingLivability> = {};
    for (const l of listings) {
      const pre = fromListing(l);
      if (pre) {
        seed[l.id] = pre;
      } else {
        const n = LIVABILITY_BY_NAME[l.neighborhood];
        seed[l.id] = {
          safetyScore: n?.safetyScore ?? 65,
          safetyLabel: n?.safetyLabel ?? "Moderate",
          walkIndex: n?.walkFallback ?? 12,
          walkSource: "neighborhood-fallback",
        };
      }
    }
    setById(seed);

    if (allPrecomputed) {
      setReady(true);
      setProgress("");
      return;
    }

    setReady(false);
    setProgress("Loading EPA walkability…");

    const needFetch = listings.filter((l) => !l.analysis);
    (async () => {
      try {
        const walks = await fetchEpaWalkIndexBatch(
          needFetch.map((l) => ({ id: l.id, lat: l.lat, lng: l.lng })),
          (done, total) => {
            if (!cancelled) {
              setProgress(`EPA walkability ${done}/${total}`);
            }
          },
        );
        if (cancelled) return;
        setById((prev) => {
          const next = { ...prev };
          for (const l of needFetch) {
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
  }, [signature, listings, allPrecomputed]);

  return { byId, progress, ready };
}
