import { useMemo } from "react";
import { Polygon } from "react-leaflet";
import {
  scoreToTier,
  tierColor,
  type SafetyTractsFile,
} from "../data/safetyTiers";
import type { AirQualityTractsFile } from "../hooks/useAirQualityTracts";
import { airQualityColor } from "../lib/airQuality";
import { SUITABILITY_BOUNDS } from "../lib/suitabilityHeatmap";

type Mode = "safety" | "air";

interface Props {
  enabled: boolean;
  mode: Mode;
  safetyTracts: SafetyTractsFile | null;
  airTracts: AirQualityTractsFile | null;
}

/** GeoJSON rings are [lng, lat]; Leaflet wants [lat, lng]. */
function geoRingToLatLng(ring: number[][]): [number, number][] {
  return ring.map(([lng, lat]) => [lat, lng]);
}

function airRingToLatLng(ring: [number, number][]): [number, number][] {
  // Air tracts store [lat, lng]
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

/**
 * Sharp census-tract choropleth — avoids stair-step edges from coarse rasters.
 */
export function TractMetricLayer({
  enabled,
  mode,
  safetyTracts,
  airTracts,
}: Props) {
  const polygons = useMemo(() => {
    if (!enabled) return [];

    if (mode === "safety" && safetyTracts?.features?.length) {
      const out: {
        key: string;
        positions: [number, number][][];
        color: string;
        label: string;
      }[] = [];
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
          out.push({
            key: `s-${props.geoid}`,
            positions: rings,
            color,
            label: `${props.place || props.tract}: ${score}`,
          });
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
              label: `${props.place || props.tract}: ${score}`,
            });
          });
        }
      }
      return out;
    }

    if (mode === "air" && airTracts?.tracts?.length) {
      const out: {
        key: string;
        positions: [number, number][][];
        color: string;
        label: string;
      }[] = [];
      for (const t of airTracts.tracts) {
        const score = t.airQualityScore;
        if (typeof score !== "number" || !t.rings?.length) continue;
        const first = t.rings[0]?.[0];
        if (!first || !inSuitabilityBbox(first[0], first[1])) continue;
        out.push({
          key: `a-${t.tract}`,
          positions: t.rings.map(airRingToLatLng),
          color: airQualityColor(score),
          label: `${t.city || t.approxLoc || t.tract}: ${score}`,
        });
      }
      return out;
    }

    return [];
  }, [enabled, mode, safetyTracts, airTracts]);

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
