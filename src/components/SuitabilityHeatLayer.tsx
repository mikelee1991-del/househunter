import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { ImageOverlay } from "react-leaflet";
import type { SafetyTractsFile } from "../data/safetyTiers";
import type { AirQualityTractsFile } from "../hooks/useAirQualityTracts";
import type { IsochroneMap } from "../hooks/useIsochrones";
import { tryDefaultSuitabilityRaster } from "../lib/defaultMapCache";
import {
  buildHeatmapBase,
  paintAddressSuitabilityHeatmap,
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
  onNeedLiveCompute?: () => void;
}

/**
 * Best areas: continuous suitability wash (clipped to isochrones) plus
 * brighter address peaks so Strand-class lots still pop.
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
  const [areaRaster, setAreaRaster] = useState<SuitabilityRaster | null>(null);

  useEffect(() => {
    if (!enabled) {
      setAreaRaster(null);
      return;
    }

    let cancelled = false;
    const havePolys =
      deferredAnchors.length > 0 &&
      deferredAnchors.some((a) => !!deferredIso[a.id]);
    const iso = havePolys ? deferredIso : undefined;

    const run = async () => {
      // Shipped pack when criteria/anchors still match defaults
      const packed = await tryDefaultSuitabilityRaster(
        deferredAnchors,
        deferredCriteria,
      );
      if (cancelled) return;
      if (packed?.url) {
        setAreaRaster(packed);
        return;
      }

      // Live continuous wash (same model as precompute pack)
      onNeedLiveCompute?.();
      const cells = buildHeatmapBase(
        listings,
        safetyTracts,
        deferredAnchors,
        airTracts,
      );
      if (cancelled) return;
      const next = paintSuitabilityHeatmap(
        cells,
        deferredCriteria,
        deferredAnchors,
        iso,
      );
      if (!cancelled) setAreaRaster(next);
    };

    const id = window.setTimeout(() => {
      void run();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [
    enabled,
    listings,
    deferredCriteria,
    deferredAnchors,
    deferredIso,
    safetyTracts,
    airTracts,
    onNeedLiveCompute,
  ]);

  const peakRaster = useMemo(() => {
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

  if (!enabled) return null;

  return (
    <>
      {areaRaster?.url && (
        <ImageOverlay
          url={areaRaster.url}
          bounds={areaRaster.bounds}
          opacity={0.58}
          zIndex={325}
          interactive={false}
        />
      )}
      {peakRaster?.url && (
        <ImageOverlay
          url={peakRaster.url}
          bounds={peakRaster.bounds}
          opacity={0.88}
          zIndex={335}
          interactive={false}
        />
      )}
    </>
  );
}
