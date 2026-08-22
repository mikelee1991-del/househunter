import { useMemo } from "react";
import { Polygon } from "react-leaflet";
import { NEIGHBORHOOD_LIVABILITY } from "../data/neighborhoodLivability";
import {
  scoreToTier,
  tierColor,
  type SafetyTractsFile,
} from "../data/safetyTiers";
import type { AirQualityTractsFile } from "../hooks/useAirQualityTracts";
import { airQualityColor } from "../lib/airQuality";
import { SUITABILITY_BOUNDS } from "../lib/suitabilityHeatmap";
import { walkIndexRgba } from "../lib/walkHeatmap";
import type { Listing } from "../types";

type Mode = "safety" | "air" | "walk";

interface Props {
  enabled: boolean;
  mode: Mode;
  safetyTracts: SafetyTractsFile | null;
  airTracts: AirQualityTractsFile | null;
  listings?: Listing[];
}

type Poly = {
  key: string;
  positions: [number, number][][];
  color: string;
};

/** GeoJSON rings are [lng, lat]; Leaflet wants [lat, lng]. */
function geoRingToLatLng(ring: number[][]): [number, number][] {
  return ring.map(([lng, lat]) => [lat, lng]);
}

function airRingToLatLng(ring: [number, number][]): [number, number][] {
  return ring.map(([lat, lng]) => [lat, lng]);
}

function inSuitabilityBbox(lat: number, lng: number): boolean {
  return (
    lat >= SUITABILITY_BOUNDS.south - 0.02 &&
    lat <= SUITABILITY_BOUNDS.north + 0.02 &&
    lng >= SUITABILITY_BOUNDS.west - 0.02 &&
    lng <= SUITABILITY_BOUNDS.east + 0.02
  );
}

function walkColor(walkIndex: number): string {
  const [r, g, b] = walkIndexRgba(walkIndex);
  return `rgb(${r},${g},${b})`;
}

function walkByNeighborhood(listings: Listing[] | undefined): Map<string, number> {
  const sum = new Map<string, number>();
  const count = new Map<string, number>();
  if (listings) {
    for (const l of listings) {
      const w = l.analysis?.walkIndex;
      if (w == null || !Number.isFinite(w)) continue;
      const name = l.neighborhood || l.city;
      if (!name) continue;
      sum.set(name, (sum.get(name) || 0) + w);
      count.set(name, (count.get(name) || 0) + 1);
    }
  }
  const out = new Map<string, number>();
  for (const n of NEIGHBORHOOD_LIVABILITY) {
    const c = count.get(n.name) || 0;
    out.set(
      n.name,
      c >= 3
        ? Math.round(((sum.get(n.name) || 0) / c) * 10) / 10
        : n.walkFallback,
    );
  }
  return out;
}

/**
 * Sharp polygon choropleth for tract / neighborhood metrics —
 * avoids stair-step edges from coarse rasters.
 */
export function TractMetricLayer({
  enabled,
  mode,
  safetyTracts,
  airTracts,
  listings,
}: Props) {
  const polygons = useMemo((): Poly[] => {
    if (!enabled) return [];

    if (mode === "safety" && safetyTracts?.features?.length) {
      const out: Poly[] = [];
      for (const f of safetyTracts.features) {
        const props = f.properties;
        const score = props.safetyScore;
        if (typeof score !== "number") continue;
        const color = tierColor(props.tier) || scoreToTier(score).color;
        const geom = f.geometry;
        if (!geom) continue;
        if (geom.type === "Polygon") {
          const rings = (geom.coordinates as number[][][]).map(geoRingToLatLng);
          const [lat, lng] = rings[0]?.[0] ?? [0, 0];
          if (!inSuitabilityBbox(lat, lng)) continue;
          out.push({ key: `s-${props.geoid}`, positions: rings, color });
        } else if (geom.type === "MultiPolygon") {
          const polys = geom.coordinates as number[][][][];
          polys.forEach((poly, i) => {
            const rings = poly.map(geoRingToLatLng);
            const [lat, lng] = rings[0]?.[0] ?? [0, 0];
            if (!inSuitabilityBbox(lat, lng)) return;
            out.push({
              key: `s-${props.geoid}-${i}`,
              positions: rings,
              color,
            });
          });
        }
      }
      return out;
    }

    if (mode === "air" && airTracts?.tracts?.length) {
      const out: Poly[] = [];
      for (const t of airTracts.tracts) {
        const score = t.airQualityScore;
        if (typeof score !== "number" || !t.rings?.length) continue;
        const first = t.rings[0]?.[0];
        if (!first || !inSuitabilityBbox(first[0], first[1])) continue;
        out.push({
          key: `a-${t.tract}`,
          positions: t.rings.map(airRingToLatLng),
          color: airQualityColor(score),
        });
      }
      return out;
    }

    if (mode === "walk") {
      const byName = walkByNeighborhood(listings);
      return NEIGHBORHOOD_LIVABILITY.map((n) => {
        const walk = byName.get(n.name) ?? n.walkFallback;
        return {
          key: `w-${n.name}`,
          positions: [n.polygon.map(([lat, lng]) => [lat, lng] as [number, number])],
          color: walkColor(walk),
        };
      });
    }

    return [];
  }, [enabled, mode, safetyTracts, airTracts, listings]);

  if (!enabled || !polygons.length) return null;

  return (
    <>
      {polygons.map((p) => (
        <Polygon
          key={p.key}
          positions={p.positions}
          pathOptions={{
            color: p.color,
            weight: 0.6,
            opacity: 0.75,
            fillColor: p.color,
            fillOpacity: 0.48,
          }}
          interactive={false}
        />
      ))}
    </>
  );
}
