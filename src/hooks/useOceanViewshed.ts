import { useEffect, useState } from "react";
import {
  analyzeOceanViewshedBatch,
  type OceanViewshedResult,
} from "../lib/oceanViewshed";
import type { Listing } from "../types";

/**
 * Legacy inventory only baked a single west/Pacific wedge as score100.
 * Beachfront lots with a strong score almost always clear due-west too —
 * never invent sunset=0 (that wiped The Strand while ocean still showed 100).
 */
function legacyCoastalSunsetProxy(
  score100: number,
  nearestCoastKm: number,
): number | undefined {
  if (nearestCoastKm <= 2.5 && score100 > 0) return score100;
  return undefined;
}

function fromListing(l: Listing): OceanViewshedResult | null {
  const v = l.analysis?.oceanViewshed;
  if (!v) return null;
  const oceanViewScore = v.oceanViewScore ?? v.score100;
  const sunsetViewScore =
    v.sunsetViewScore ??
    legacyCoastalSunsetProxy(v.score100, v.nearestCoastKm ?? 99);
  const hasSunsetView =
    v.hasSunsetView ??
    (sunsetViewScore != null && sunsetViewScore >= 35);

  const summary =
    v.sunsetViewScore != null
      ? v.summary
      : sunsetViewScore != null
        ? `Ocean ${oceanViewScore}/100 · Sunset ~${sunsetViewScore}/100 (legacy coastal — GIS refining)`
        : v.summary;

  return {
    hasOceanView: v.hasOceanView,
    hasSunsetView,
    clearRayFraction: v.clearRayFraction,
    score100: v.score100,
    oceanViewScore,
    sunsetViewScore,
    clearRays: v.clearRays,
    testedRays: v.testedRays,
    sunsetClearRays: v.sunsetClearRays,
    sunsetTestedRays: v.sunsetTestedRays,
    nearestCoastKm: v.nearestCoastKm,
    terrainBlockedRays: v.terrainBlockedRays,
    buildingBlockedRays: v.buildingBlockedRays,
    buildingHits: 0,
    eyeHeightM: 5.5,
    facingUsedDeg: 270,
    confidence: v.confidence,
    summary,
    method: "dem-los+osm-buildings",
  };
}

function needsLiveGis(l: Listing): boolean {
  const ov = l.analysis?.oceanViewshed;
  if (!ov) return true;
  if (/unavailable|pending rebake/i.test(ov.summary || "")) return true;
  // Legacy bake only had combined score100 — recompute for dual ocean/sunset
  if (ov.sunsetViewScore == null && (ov.nearestCoastKm ?? 99) <= 28) {
    return true;
  }
  return false;
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
      if (pre) seed[l.id] = pre;
    }
    if (Object.keys(seed).length) setById(seed);

    const need = listings.filter(needsLiveGis);
    if (!need.length) {
      setReady(true);
      setProgress("");
      return;
    }

    // Beachfront / Strand first; higher cap so dual scores replace proxies
    const liveCap = 80;
    const prioritized = [...need]
      .sort((a, b) => {
        const oa =
          a.oceanView || a.analysis?.oceanViewshed?.hasOceanView ? 0 : 1;
        const ob =
          b.oceanView || b.analysis?.oceanViewshed?.hasOceanView ? 0 : 1;
        if (oa !== ob) return oa - ob;
        const ca = a.analysis?.oceanViewshed?.nearestCoastKm ?? 99;
        const cb = b.analysis?.oceanViewshed?.nearestCoastKm ?? 99;
        return ca - cb;
      })
      .slice(0, liveCap);

    setReady(false);
    setProgress(
      `Ocean/sunset GIS for ${prioritized.length} lots (beachfront first)…`,
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
              setProgress(`Ocean/sunset viewshed ${done}/${total}`);
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
