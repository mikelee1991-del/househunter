import { useMemo } from "react";
import { ImageOverlay, Polygon, Tooltip } from "react-leaflet";
import {
  NEIGHBORHOOD_LIVABILITY,
  walkBandLabel,
  walkColor,
} from "../data/neighborhoodLivability";
import { paintWalkabilityHeatmap } from "../lib/walkHeatmap";
import type { Listing } from "../types";

interface Props {
  enabled: boolean;
  listings: Listing[];
}

type NbFill = {
  name: string;
  walkIndex: number;
  positions: [number, number][];
};

/** Mean EPA walk from listings when enough samples; else neighborhood fallback. */
function neighborhoodFills(listings: Listing[]): NbFill[] {
  const sum = new Map<string, number>();
  const count = new Map<string, number>();
  for (const l of listings) {
    const w = l.analysis?.walkIndex;
    if (w == null || !Number.isFinite(w)) continue;
    const name = l.neighborhood || l.city;
    sum.set(name, (sum.get(name) || 0) + w);
    count.set(name, (count.get(name) || 0) + 1);
  }

  return NEIGHBORHOOD_LIVABILITY.map((n) => {
    const c = count.get(n.name) || 0;
    const walkIndex =
      c >= 3
        ? Math.round(((sum.get(n.name) || 0) / c) * 10) / 10
        : n.walkFallback;
    return {
      name: n.name,
      walkIndex,
      // Leaflet positions are [lat, lng]
      positions: n.polygon.map(([lat, lng]) => [lat, lng] as [number, number]),
    };
  });
}

/**
 * Continuous walkability across the metro: neighborhood choropleth (primary)
 * plus a soft bounds-wide wash so gaps/ocean edges still read as area, not spots.
 */
export function WalkabilityHeatLayer({ enabled, listings }: Props) {
  const fills = useMemo(
    () => (enabled ? neighborhoodFills(listings) : []),
    [enabled, listings],
  );

  const wash = useMemo(() => {
    if (!enabled) return null;
    return paintWalkabilityHeatmap(listings, 200, 150);
  }, [enabled, listings]);

  if (!enabled) return null;

  return (
    <>
      {wash?.url && (
        <ImageOverlay
          url={wash.url}
          bounds={wash.bounds}
          opacity={0.35}
          zIndex={335}
          interactive={false}
        />
      )}
      {fills.map((n) => (
        <Polygon
          key={`walk-nb-${n.name}`}
          positions={n.positions}
          pathOptions={{
            color: walkColor(n.walkIndex),
            weight: 1,
            opacity: 0.55,
            fillColor: walkColor(n.walkIndex),
            fillOpacity: 0.48,
          }}
        >
          <Tooltip sticky>
            {n.name}
            <br />
            Walk {n.walkIndex.toFixed(1)} · {walkBandLabel(n.walkIndex)}
          </Tooltip>
        </Polygon>
      ))}
    </>
  );
}
