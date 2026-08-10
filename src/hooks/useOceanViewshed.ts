import { useEffect, useState } from "react";
import {
  analyzeOceanViewshedBatch,
  type OceanViewshedResult,
} from "../lib/oceanViewshed";
import type { Listing } from "../types";

function fromListing(l: Listing): OceanViewshedResult | null {
  const v = l.analysis?.oceanViewshed;
  if (!v) return null;
  return {
    hasOceanView: v.hasOceanView,
    clearRayFraction: v.clearRayFraction,
    score100: v.score100,
    clearRays: v.clearRays,
    testedRays: v.testedRays,
    nearestCoastKm: v.nearestCoastKm,
    terrainBlockedRays: v.terrainBlockedRays,
    buildingBlockedRays: v.buildingBlockedRays,
    buildingHits: 0,
    eyeHeightM: 5.5,
    facingUsedDeg: 270,
    confidence: v.confidence,
    summary: v.summary,
    method: "dem-los+osm-buildings",
  };
}

export function useOceanViewshed(listings: Listing[], enabled = true) {
  const [byId, setById] = useState<Record<string, OceanViewshedResult>>({});
  const [progress, setProgress] = useState("");
  const [ready, setReady] = useState(false);

  const signature = listings.map((l) => `${l.id}:${l.lat}:${l.lng}`).join("|");
  const allPrecomputed =
    listings.length > 0 && listings.every((l) => !!l.analysis?.oceanViewshed);

  useEffect(() => {
    let cancelled = false;
    if (!enabled || !listings.length) {
      setById({});
      setReady(true);
      setProgress("");
      return;
    }

    const seed: Record<string, OceanViewshedResult> = {};
    for (const l of listings) {
      const pre = fromListing(l);
      if (pre) seed[l.id] = pre;
    }
    if (Object.keys(seed).length) setById(seed);

    if (allPrecomputed) {
      setReady(true);
      setProgress("");
      return;
    }

    setReady(false);
    setProgress("Running ocean/sunset viewshed (DEM + buildings)…");

    const need = listings.filter((l) => !l.analysis?.oceanViewshed);
    (async () => {
      try {
        const results = await analyzeOceanViewshedBatch(
          need.map((l) => ({
            id: l.id,
            lat: l.lat,
            lng: l.lng,
          })),
          (done, total) => {
            if (!cancelled) {
              setProgress(`Ocean viewshed ${done}/${total}`);
            }
          },
        );
        if (!cancelled) {
          setById((prev) => ({ ...prev, ...results }));
          setReady(true);
          setProgress("");
        }
      } catch (e) {
        console.warn("Ocean viewshed failed", e);
        if (!cancelled) {
          setReady(true);
          setProgress("");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [signature, enabled, listings, allPrecomputed]);

  return { byId, progress, ready };
}
