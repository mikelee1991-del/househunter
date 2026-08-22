import { useDeferredValue, useMemo } from "react";
import { CircleMarker, Tooltip } from "react-leaflet";
import type { SafetyTractsFile } from "../data/safetyTiers";
import type { AirQualityTractsFile } from "../hooks/useAirQualityTracts";
import type { IsochroneMap } from "../hooks/useIsochrones";
import { metricScoreColor } from "../lib/mapMetrics";
import { scoreListingLocation } from "../lib/suitabilityHeatmap";
import type { Anchor, Criteria, Listing } from "../types";

interface Props {
  enabled: boolean;
  criteria: Criteria;
  anchors: Anchor[];
  isochrones: IsochroneMap;
  listings: Listing[];
  safetyTracts: SafetyTractsFile | null;
  airTracts: AirQualityTractsFile | null;
  onNeedLiveCompute?: () => void;
}

type ScoredHit = { id: string; lat: number; lng: number; score: number; address: string };

/**
 * Best areas: one marker glow per listing address.
 * Open-wedge Strand lots get large bright discs; blocked / mediocre lots stay
 * small or hidden — never a neighborhood wash.
 */
export function SuitabilityHeatLayer({
  enabled,
  criteria,
  anchors,
  isochrones,
  listings,
}: Props) {
  const deferredCriteria = useDeferredValue(criteria);
  const deferredIso = useDeferredValue(isochrones);
  const deferredAnchors = useDeferredValue(anchors);

  const hits = useMemo(() => {
    if (!enabled || !listings.length) return [] as ScoredHit[];
    const havePolys =
      deferredAnchors.length > 0 &&
      deferredAnchors.some((a) => !!deferredIso[a.id]);
    const iso = havePolys ? deferredIso : undefined;
    const out: ScoredHit[] = [];
    for (const l of listings) {
      if (!Number.isFinite(l.lat) || !Number.isFinite(l.lng)) continue;
      const score = scoreListingLocation(
        l,
        deferredCriteria,
        deferredAnchors,
        iso,
      );
      // Only show solid location fits so peaks read clearly
      if (score < 68) continue;
      out.push({
        id: l.id,
        lat: l.lat,
        lng: l.lng,
        score,
        address: l.address,
      });
    }
    // Paint weaker first so standouts sit on top
    out.sort((a, b) => a.score - b.score);
    return out;
  }, [enabled, listings, deferredCriteria, deferredAnchors, deferredIso]);

  if (!enabled || !hits.length) return null;

  return (
    <>
      {hits.map((h) => {
        const standout = h.score >= 82;
        const strong = h.score >= 75;
        const radius = standout ? 16 : strong ? 11 : 7;
        const fillOpacity = standout ? 0.82 : strong ? 0.55 : 0.28;
        return (
          <CircleMarker
            key={`suit-${h.id}`}
            center={[h.lat, h.lng]}
            radius={radius}
            pathOptions={{
              stroke: standout,
              color: "#0b3d2e",
              weight: standout ? 1.5 : 0,
              fillColor: metricScoreColor(h.score),
              fillOpacity,
            }}
          >
            <Tooltip direction="top" offset={[0, -4]}>
              {h.address}
              <br />
              Location fit {Math.round(h.score)}
            </Tooltip>
          </CircleMarker>
        );
      })}
    </>
  );
}
