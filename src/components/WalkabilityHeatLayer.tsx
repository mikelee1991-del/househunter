import { useMemo } from "react";
import { ImageOverlay } from "react-leaflet";
import { paintWalkabilityHeatmap } from "../lib/walkHeatmap";
import type { Listing } from "../types";

interface Props {
  enabled: boolean;
  listings: Listing[];
}

/**
 * Continuous walkability wash across the search area (neighborhood EPA
 * averages / fallbacks) — not address-only spots.
 */
export function WalkabilityHeatLayer({ enabled, listings }: Props) {
  const raster = useMemo(() => {
    if (!enabled) return null;
    return paintWalkabilityHeatmap(listings, 240, 180);
  }, [enabled, listings]);

  if (!enabled || !raster?.url) return null;

  return (
    <ImageOverlay
      url={raster.url}
      bounds={raster.bounds}
      opacity={0.72}
      zIndex={340}
      interactive={false}
    />
  );
}
