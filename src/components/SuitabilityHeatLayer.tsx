import { useDeferredValue, useMemo } from "react";
import { ImageOverlay } from "react-leaflet";
import type { SafetyTractsFile } from "../data/safetyTiers";
import type { AirQualityTractsFile } from "../hooks/useAirQualityTracts";
import type { IsochroneMap } from "../hooks/useIsochrones";
import { paintAddressSuitabilityHeatmap } from "../lib/suitabilityHeatmap";
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

/**
 * Best areas as one canvas of address peaks (not hundreds of CircleMarkers).
 * Keeps metric switching fast while Strand-class lots still read bright.
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

  const raster = useMemo(() => {
    if (!enabled || !listings.length) return null;
    const havePolys =
      deferredAnchors.length > 0 &&
      deferredAnchors.some((a) => !!deferredIso[a.id]);
    return paintAddressSuitabilityHeatmap(
      listings,
      deferredCriteria,
      deferredAnchors,
      havePolys ? deferredIso : undefined,
    );
  }, [enabled, listings, deferredCriteria, deferredAnchors, deferredIso]);

  if (!enabled || !raster?.url) return null;

  return (
    <ImageOverlay
      url={raster.url}
      bounds={raster.bounds}
      opacity={0.78}
      zIndex={330}
      interactive={false}
    />
  );
}
