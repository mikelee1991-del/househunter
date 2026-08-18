import { useDeferredValue, useMemo } from "react";
import { ImageOverlay } from "react-leaflet";
import type { SafetyTractsFile } from "../data/safetyTiers";
import type { AirQualityTractsFile } from "../hooks/useAirQualityTracts";
import type { IsochroneMap } from "../hooks/useIsochrones";
import {
  buildHeatmapBase,
  paintSuitabilityHeatmap,
} from "../lib/suitabilityHeatmap";
import type { Anchor, Criteria, Listing } from "../types";

interface Props {
  enabled: boolean;
  criteria: Criteria;
  anchors: Anchor[];
  isochrones: IsochroneMap;
  listings: Listing[];
  safetyTracts: SafetyTractsFile | null;
  airTracts: AirQualityTractsFile | null;
}

/**
 * High-res canvas heatmap of blended location suitability (drives, noise,
 * safety, walk, ocean openness, air). Home-specific filters are not applied.
 */
export function SuitabilityHeatLayer({
  enabled,
  criteria,
  anchors,
  isochrones,
  listings,
  safetyTracts,
  airTracts,
}: Props) {
  const deferredCriteria = useDeferredValue(criteria);
  const deferredIso = useDeferredValue(isochrones);
  const deferredAnchors = useDeferredValue(anchors);

  const base = useMemo(() => {
    if (!enabled) return null;
    return buildHeatmapBase(
      listings,
      safetyTracts,
      deferredAnchors,
      airTracts,
    );
  }, [enabled, listings, safetyTracts, airTracts, deferredAnchors]);

  const raster = useMemo(() => {
    if (!enabled || !base) return null;
    const havePolys =
      deferredAnchors.length > 0 &&
      deferredAnchors.every((a) => !!deferredIso[a.id]);
    return paintSuitabilityHeatmap(
      base,
      deferredCriteria,
      deferredAnchors,
      havePolys ? deferredIso : undefined,
    );
  }, [enabled, base, deferredCriteria, deferredAnchors, deferredIso]);

  if (!enabled || !raster?.url) return null;

  return (
    <ImageOverlay
      url={raster.url}
      bounds={raster.bounds}
      opacity={0.22}
      zIndex={330}
      interactive={false}
    />
  );
}
