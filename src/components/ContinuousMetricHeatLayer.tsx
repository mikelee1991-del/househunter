import { useDeferredValue, useMemo } from "react";
import { ImageOverlay } from "react-leaflet";
import type { SafetyTractsFile } from "../data/safetyTiers";
import type { AirQualityTractsFile } from "../hooks/useAirQualityTracts";
import type { IsochroneMap } from "../lib/isochrone";
import {
  paintAreaMetricHeatmap,
  type AreaMetricId,
} from "../lib/metricAreaHeatmap";
import type { Anchor, Listing } from "../types";

interface Props {
  enabled: boolean;
  metric: AreaMetricId;
  listings: Listing[];
  anchors: Anchor[];
  isochrones: IsochroneMap;
  safetyTracts: SafetyTractsFile | null;
  airTracts: AirQualityTractsFile | null;
}

/**
 * Continuous area wash for a metric across the South Bay grid — any location,
 * not just listing pins. Clipped to the union of drive-time isochrones when ready.
 */
export function ContinuousMetricHeatLayer({
  enabled,
  metric,
  listings,
  anchors,
  isochrones,
  safetyTracts,
  airTracts,
}: Props) {
  const deferredIso = useDeferredValue(isochrones);
  const deferredAnchors = useDeferredValue(anchors);

  const raster = useMemo(() => {
    if (!enabled) return null;
    const havePolys =
      deferredAnchors.length > 0 &&
      deferredAnchors.some((a) => !!deferredIso[a.id]);
    return paintAreaMetricHeatmap(
      metric,
      listings,
      deferredAnchors,
      safetyTracts,
      airTracts,
      havePolys ? deferredIso : undefined,
    );
  }, [
    enabled,
    metric,
    listings,
    deferredAnchors,
    deferredIso,
    safetyTracts,
    airTracts,
  ]);

  if (!enabled || !raster?.url) return null;

  return (
    <ImageOverlay
      url={raster.url}
      bounds={raster.bounds}
      opacity={0.62}
      zIndex={340}
      interactive={false}
    />
  );
}
