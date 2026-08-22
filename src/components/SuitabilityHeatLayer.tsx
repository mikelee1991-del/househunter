import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { ImageOverlay } from "react-leaflet";
import type { SafetyTractsFile } from "../data/safetyTiers";
import type { AirQualityTractsFile } from "../hooks/useAirQualityTracts";
import type { IsochroneMap } from "../hooks/useIsochrones";
import { tryDefaultSuitabilityRaster } from "../lib/defaultMapCache";
import {
  buildHeatmapBase,
  paintSuitabilityHeatmap,
  type SuitabilityRaster,
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
  /** Fired when defaults miss and live tract-based paint is required */
  onNeedLiveCompute?: () => void;
}

/**
 * High-res canvas heatmap of blended location suitability.
 * On default anchors/criteria, paints from a shipped score grid (no tract PIP).
 */
export function SuitabilityHeatLayer({
  enabled,
  criteria,
  anchors,
  isochrones,
  listings,
  safetyTracts,
  airTracts,
  onNeedLiveCompute,
}: Props) {
  const deferredCriteria = useDeferredValue(criteria);
  const deferredIso = useDeferredValue(isochrones);
  const deferredAnchors = useDeferredValue(anchors);

  const [precomputed, setPrecomputed] = useState<SuitabilityRaster | null>(
    null,
  );
  const [precomputeChecked, setPrecomputeChecked] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setPrecomputed(null);
      setPrecomputeChecked(false);
      return;
    }
    let cancelled = false;
    setPrecomputeChecked(false);
    void (async () => {
      const raster = await tryDefaultSuitabilityRaster(anchors, criteria);
      if (cancelled) return;
      setPrecomputed(raster);
      setPrecomputeChecked(true);
      if (!raster) onNeedLiveCompute?.();
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, anchors, criteria, onNeedLiveCompute]);

  const base = useMemo(() => {
    if (!enabled || !precomputeChecked || precomputed) return null;
    if (!safetyTracts && !airTracts) return null;
    return buildHeatmapBase(
      listings,
      safetyTracts,
      deferredAnchors,
      airTracts,
    );
  }, [
    enabled,
    precomputeChecked,
    precomputed,
    listings,
    safetyTracts,
    airTracts,
    deferredAnchors,
  ]);

  const liveRaster = useMemo(() => {
    if (!enabled || precomputed || !base) return null;
    const havePolys =
      deferredAnchors.length > 0 &&
      deferredAnchors.some((a) => !!deferredIso[a.id]);
    return paintSuitabilityHeatmap(
      base,
      deferredCriteria,
      deferredAnchors,
      havePolys ? deferredIso : undefined,
    );
  }, [
    enabled,
    precomputed,
    base,
    deferredCriteria,
    deferredAnchors,
    deferredIso,
  ]);

  const raster = precomputed ?? liveRaster;
  if (!enabled || !raster?.url) return null;

  return (
    <ImageOverlay
      url={raster.url}
      bounds={raster.bounds}
      opacity={0.55}
      zIndex={330}
      interactive={false}
    />
  );
}
