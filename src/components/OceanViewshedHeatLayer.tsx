import { useMemo } from "react";
import { CircleMarker, Polygon } from "react-leaflet";
import {
  OCEAN_CONE_CENTER_DEG,
  OCEAN_CONE_HALF_DEG,
  SUNSET_CONE_CENTER_DEG,
  SUNSET_CONE_HALF_DEG,
} from "../lib/oceanViewshed";
import { oceanViewshedRgba } from "../lib/suitabilityHeatmap";
import type { Listing } from "../types";

/** Short fans only for strong clear wedges */
const MIN_WEDGE_SCORE = 60;

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

function viewScore(
  ov: NonNullable<Listing["analysis"]>["oceanViewshed"] | undefined,
  mode: "ocean" | "sunset",
): number | null {
  if (!ov) return null;
  if (mode === "sunset") {
    return typeof ov.sunsetViewScore === "number" ? ov.sunsetViewScore : null;
  }
  const s = ov.oceanViewScore ?? ov.score100;
  return typeof s === "number" ? s : null;
}

type Wedge = {
  id: string;
  score: number;
  positions: [number, number][];
};

function strongWedges(
  listings: Listing[],
  mode: "ocean" | "sunset",
): Wedge[] {
  const out: Wedge[] = [];
  const center =
    mode === "sunset" ? SUNSET_CONE_CENTER_DEG : OCEAN_CONE_CENTER_DEG;
  const halfDeg =
    (mode === "sunset" ? SUNSET_CONE_HALF_DEG : OCEAN_CONE_HALF_DEG) * 0.4;
  const maxCoast = mode === "sunset" ? 28 : 12;

  for (const l of listings) {
    const ov = l.analysis?.oceanViewshed;
    const score = viewScore(ov, mode);
    if (score == null || score < MIN_WEDGE_SCORE) continue;
    if (isPlaceholderSummary(ov?.summary)) continue;
    if ((ov?.nearestCoastKm ?? 99) > maxCoast) continue;
    const reachKm = 0.28 + (score / 100) * 0.45;
    const left = destination(l.lat, l.lng, center - halfDeg, reachKm);
    const mid = destination(l.lat, l.lng, center, reachKm * 1.06);
    const right = destination(l.lat, l.lng, center + halfDeg, reachKm);
    out.push({
      id: l.id,
      score,
      positions: [[l.lat, l.lng], left, mid, right],
    });
  }
  return out;
}

interface Props {
  enabled: boolean;
  listings: Listing[];
  mode?: "ocean" | "sunset";
}

/**
 * GIS ocean or sunset overlays on analyzed addresses:
 * 1) Continuous wash comes from ContinuousMetricHeatLayer
 * 2) Dot on each lot colored by DEM+building LOS score
 * 3) Short fan only on strong clear wedges (≥60)
 */
export function OceanViewshedHeatLayer({
  enabled,
  listings,
  mode = "ocean",
}: Props) {
  const maxCoast = mode === "sunset" ? 28 : 12;
  const coastalLots = useMemo(() => {
    if (!enabled) return [];
    return listings.filter((l) => {
      const ov = l.analysis?.oceanViewshed;
      if (!ov) return false;
      if (viewScore(ov, mode) == null && !isPlaceholderSummary(ov.summary)) {
        return false;
      }
      const coast = ov.nearestCoastKm ?? 99;
      if (coast > maxCoast) return false;
      return true;
    });
  }, [enabled, listings, mode, maxCoast]);

  const wedges = useMemo(
    () => (enabled ? strongWedges(listings, mode) : []),
    [enabled, listings, mode],
  );

  if (!enabled) return null;

  return (
    <>
      {wedges.map((w) => (
        <Polygon
          key={`owedge-${mode}-${w.id}`}
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
        const score = viewScore(ov, mode) ?? 0;
        const placeholder = isPlaceholderSummary(ov.summary);
        const radius =
          score >= 60 ? 8 : score >= 35 ? 6.5 : score > 0 ? 5.5 : 4.5;
        return (
          <CircleMarker
            key={`odot-${mode}-${l.id}`}
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
