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

function needsLiveGis(l: Listing): boolean {
  const ov = l.analysis?.oceanViewshed;
  if (!ov) return true;
  return /unavailable|pending rebake/i.test(ov.summary || "");
}

export function useOceanViewshed(listings: Listing[], enabled = true) {
  const [byId, setById] = useState<Record<string, OceanViewshedResult>>({});
  const [progress, setProgress] = useState("");
  const [ready, setReady] = useState(false);

  const signature = listings.map((l) => `${l.id}:${l.lat}:${l.lng}`).join("|");

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
      if (pre && !needsLiveGis(l)) seed[l.id] = pre;
      else if (pre) seed[l.id] = pre; // show placeholder until live GIS returns
    }
    if (Object.keys(seed).length) setById(seed);

    const need = listings.filter(needsLiveGis);
    if (!need.length) {
      setReady(true);
      setProgress("");
      return;
    }

    // Cap live browser GIS so we don't hammer DEM/Overpass for hundreds of gaps
    const liveCap = 40;
    const prioritized = [...need].sort((a, b) => {
      const ca = a.analysis?.oceanViewshed?.nearestCoastKm ?? 99;
      const cb = b.analysis?.oceanViewshed?.nearestCoastKm ?? 99;
      return ca - cb;
    }).slice(0, liveCap);

    setReady(false);
    setProgress(
      `Ocean GIS for ${prioritized.length} coastal lots (nearest first)…`,
    );

    (async () => {
      try {
        const results = await analyzeOceanViewshedBatch(
          prioritized.map((l) => ({
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
  }, [signature, enabled, listings]);

  return { byId, progress, ready };
}
