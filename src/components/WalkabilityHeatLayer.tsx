import { useMemo, useState } from "react";
import type { Map as LeafletMap } from "leaflet";
import { ImageOverlay, useMap, useMapEvents } from "react-leaflet";
import {
  paintWalkabilityHeatmap,
  type WalkBounds,
} from "../lib/walkHeatmap";
import type { Listing } from "../types";

interface Props {
  enabled: boolean;
  listings: Listing[];
}

function boundsFromMap(map: LeafletMap): WalkBounds {
  const b = map.getBounds();
  const latPad = (b.getNorth() - b.getSouth()) * 0.04;
  const lngPad = (b.getEast() - b.getWest()) * 0.04;
  return {
    south: b.getSouth() - latPad,
    west: b.getWest() - lngPad,
    north: b.getNorth() + latPad,
    east: b.getEast() + lngPad,
  };
}

/**
 * Continuous walkability wash for the entire visible map (viewport-aligned),
 * not address-only spots.
 */
export function WalkabilityHeatLayer({ enabled, listings }: Props) {
  const map = useMap();
  const [viewBounds, setViewBounds] = useState<WalkBounds>(() =>
    boundsFromMap(map),
  );

  useMapEvents({
    moveend: () => setViewBounds(boundsFromMap(map)),
    zoomend: () => setViewBounds(boundsFromMap(map)),
  });

  // Refit wash when the layer is turned on (map may have been panned/fitted)
  const wash = useMemo(() => {
    if (!enabled) return null;
    const b = boundsFromMap(map);
    return paintWalkabilityHeatmap(listings, 360, 270, b);
  }, [enabled, listings, viewBounds, map]);

  if (!enabled || !wash?.url) return null;

  return (
    <ImageOverlay
      key={`${wash.bounds[0][0].toFixed(3)}-${wash.bounds[1][1].toFixed(3)}-${wash.cols}`}
      url={wash.url}
      bounds={wash.bounds}
      opacity={0.58}
      zIndex={340}
      interactive={false}
    />
  );
}
