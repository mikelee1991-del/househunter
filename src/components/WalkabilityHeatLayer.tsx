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

type NbOutline = {
  name: string;
  walkIndex: number;
  positions: [number, number][];
};

function neighborhoodOutlines(listings: Listing[]): NbOutline[] {
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
      positions: n.polygon.map(([lat, lng]) => [lat, lng] as [number, number]),
    };
  });
}

/**
 * Full-area walkability: continuous raster across South Bay bounds (every
 * pixel gets a walk score via neighborhood / nearest-nb). Thin outlines +
 * tooltips label neighborhoods without leaving choropleth gaps.
 */
export function WalkabilityHeatLayer({ enabled, listings }: Props) {
  const wash = useMemo(() => {
    if (!enabled) return null;
    return paintWalkabilityHeatmap(listings, 280, 210);
  }, [enabled, listings]);

  const outlines = useMemo(
    () => (enabled ? neighborhoodOutlines(listings) : []),
    [enabled, listings],
  );

  if (!enabled || !wash?.url) return null;

  return (
    <>
      <ImageOverlay
        url={wash.url}
        bounds={wash.bounds}
        opacity={0.82}
        zIndex={340}
        interactive={false}
      />
      {outlines.map((n) => (
        <Polygon
          key={`walk-nb-${n.name}`}
          positions={n.positions}
          pathOptions={{
            color: walkColor(n.walkIndex),
            weight: 1.25,
            opacity: 0.65,
            fill: false,
            fillOpacity: 0,
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
