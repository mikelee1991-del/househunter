import { useMemo } from "react";
import { ImageOverlay } from "react-leaflet";
import {
  paintOceanViewshedHeatmap,
} from "../lib/suitabilityHeatmap";
import type { Listing } from "../types";

interface Props {
  enabled: boolean;
  listings: Listing[];
}

/**
 * Continuous ocean/sunset openness surface from baked GIS viewshed scores
 * (IDW + coast proximity). Shown when the Ocean / sunset metric layer is on.
 */
export function OceanViewshedHeatLayer({ enabled, listings }: Props) {
  const raster = useMemo(() => {
    if (!enabled) return null;
    return paintOceanViewshedHeatmap(listings);
  }, [enabled, listings]);

  if (!enabled || !raster?.url) return null;

  return (
    <ImageOverlay
      url={raster.url}
      bounds={raster.bounds}
      opacity={0.88}
      zIndex={340}
      interactive={false}
    />
  );
}
