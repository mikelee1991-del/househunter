import { useEffect, useState, useDeferredValue } from "react";
import { ImageOverlay } from "react-leaflet";
import type { SafetyTractsFile } from "../data/safetyTiers";
import type { AirQualityTractsFile } from "../hooks/useAirQualityTracts";
import type { IsochroneMap } from "../lib/isochrone";
import {
  paintAreaMetricHeatmap,
  type AreaMetricId,
} from "../lib/metricAreaHeatmap";
import type { SuitabilityRaster } from "../lib/suitabilityHeatmap";
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
 * Continuous area wash — paints off the critical path and reuses cached
 * rasters so switching Safety ↔ Walk ↔ Noise does not freeze the map.
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
  const [raster, setRaster] = useState<SuitabilityRaster | null>(null);

  useEffect(() => {
    if (!enabled) {
      setRaster(null);
      return;
    }
    // Walk needs neighborhood/tract context baked into the base grid
    const needsTracts = metric === "walk";
    if (needsTracts && !safetyTracts && !airTracts) return;

    let cancelled = false;
    const havePolys =
      deferredAnchors.length > 0 &&
      deferredAnchors.some((a) => !!deferredIso[a.id]);

    const run = () => {
      if (cancelled) return;
      const next = paintAreaMetricHeatmap(
        metric,
        listings,
        deferredAnchors,
        safetyTracts,
        airTracts,
        havePolys ? deferredIso : undefined,
      );
      if (!cancelled) setRaster(next);
    };

    // Yield to the browser so the metric tab click stays snappy
    const id = window.setTimeout(run, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
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
