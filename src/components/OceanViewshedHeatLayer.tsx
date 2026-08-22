import { useMemo } from "react";
import { CircleMarker, Polygon } from "react-leaflet";
import {
  SUNSET_OCEAN_CONE_CENTER_DEG,
  SUNSET_OCEAN_CONE_HALF_DEG,
} from "../lib/oceanViewshed";
import { oceanViewshedRgba } from "../lib/suitabilityHeatmap";
import type { Listing } from "../types";

/** Short sunset fans only for strong clear wedges */
const MIN_WEDGE_SCORE = 60;
/**
 * Include every lot with a GIS viewshed inside this coast distance.
 * Farther inland stays off the ocean layer (score already 0 / too-far).
 */
const MAX_COAST_KM = 8;

function destination(
  lat: number,
  lng: number,
  bearingDeg: number,
  distKm: number,
): [number, number] {
  const R = 6371;
  const δ = distKm / R;
  const θ = (bearingDeg * Math.PI) / 180;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lng * Math.PI) / 180;
  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ),
  );
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
    );
  return [(φ2 * 180) / Math.PI, (λ2 * 180) / Math.PI];
}

function scoreFill(score: number): string {
  const [r, g, b] = oceanViewshedRgba(score);
  return `rgb(${r},${g},${b})`;
}

function isPlaceholderSummary(summary: string | undefined): boolean {
  const s = summary || "";
  return /unavailable|pending rebake/i.test(s);
}

type Wedge = {
  id: string;
  score: number;
  positions: [number, number][];
};

function strongWedges(listings: Listing[]): Wedge[] {
  const out: Wedge[] = [];
  for (const l of listings) {
    const ov = l.analysis?.oceanViewshed;
    if (!ov || ov.score100 < MIN_WEDGE_SCORE) continue;
    if (isPlaceholderSummary(ov.summary)) continue;
    const reachKm = 0.28 + (ov.score100 / 100) * 0.45;
    const half = SUNSET_OCEAN_CONE_HALF_DEG * 0.4;
    const left = destination(
      l.lat,
      l.lng,
      SUNSET_OCEAN_CONE_CENTER_DEG - half,
      reachKm,
    );
    const mid = destination(
      l.lat,
      l.lng,
      SUNSET_OCEAN_CONE_CENTER_DEG,
      reachKm * 1.06,
    );
    const right = destination(
      l.lat,
      l.lng,
      SUNSET_OCEAN_CONE_CENTER_DEG + half,
      reachKm,
    );
    out.push({
      id: l.id,
      score: ov.score100,
      positions: [[l.lat, l.lng], left, mid, right],
    });
  }
  return out;
}

interface Props {
  enabled: boolean;
  listings: Listing[];
}

/**
 * GIS ocean/sunset overlays on every analyzed coastal address (matches or not):
 * 1) Continuous coastal wash comes from ContinuousMetricHeatLayer
 * 2) Dot on each coastal lot colored by DEM+building LOS score (blocked = dark)
 * 3) Short sunset fan only on strong clear wedges (≥60)
 *
 * Address dots stay lot-accurate — a Strand 100 does not light the blocked lot behind it.
 */
export function OceanViewshedHeatLayer({ enabled, listings }: Props) {
  const coastalLots = useMemo(() => {
    if (!enabled) return [];
    return listings.filter((l) => {
      const ov = l.analysis?.oceanViewshed;
      if (!ov) return false;
      const coast = ov.nearestCoastKm ?? 99;
      if (coast > MAX_COAST_KM) return false;
      // Still show placeholders as dark dots so gaps are visible during rebake
      return true;
    });
  }, [enabled, listings]);

  const wedges = useMemo(
    () => (enabled ? strongWedges(listings) : []),
    [enabled, listings],
  );

  if (!enabled) return null;

  return (
    <>
      {wedges.map((w) => (
        <Polygon
          key={`owedge-${w.id}`}
          positions={w.positions}
          pathOptions={{
            color: w.score >= 80 ? "#0b6e4f" : "#2a9d8f",
            fillColor: w.score >= 80 ? "#0b6e4f" : "#2a9d8f",
            fillOpacity: 0.12 + Math.min(0.14, (w.score - 60) / 280),
            weight: 1.1,
            opacity: 0.5,
          }}
        />
      ))}
      {coastalLots.map((l) => {
        const ov = l.analysis!.oceanViewshed!;
        const score = ov.score100;
        const placeholder = isPlaceholderSummary(ov.summary);
        const radius =
          score >= 60 ? 8 : score >= 35 ? 6.5 : score > 0 ? 5.5 : 4.5;
        return (
          <CircleMarker
            key={`odot-${l.id}`}
            center={[l.lat, l.lng]}
            radius={radius}
            pathOptions={{
              color: placeholder ? "#5a6570" : "#1a2a28",
              weight: 1,
              fillColor: placeholder ? "#6b7680" : scoreFill(score),
              fillOpacity: placeholder
                ? 0.35
                : 0.5 + Math.min(0.4, score / 220),
              opacity: 0.7,
              dashArray: placeholder ? "2 3" : undefined,
            }}
          />
        );
      })}
    </>
  );
}
