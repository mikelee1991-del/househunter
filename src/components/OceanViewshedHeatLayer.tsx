import { useMemo } from "react";
import { CircleMarker, ImageOverlay, Polygon, Tooltip } from "react-leaflet";
import {
  SUNSET_OCEAN_CONE_CENTER_DEG,
  SUNSET_OCEAN_CONE_HALF_DEG,
} from "../lib/oceanViewshed";
import {
  oceanViewshedRgba,
  paintOceanViewshedHeatmap,
} from "../lib/suitabilityHeatmap";
import type { Listing } from "../types";

/** Homes with a real ocean/sunset wedge */
const MIN_VIEW_SCORE = 35;
/** Strong enough to draw a directional fan */
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
    const reachKm = 0.35 + (ov.score100 / 100) * 0.55;
    const half = SUNSET_OCEAN_CONE_HALF_DEG * 0.45;
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
      reachKm * 1.08,
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
 * Ocean/sunset map layer (view = sightline, not “near the beach”):
 * 1) Address-local canvas from lots with a real wedge (≥35)
 * 2) Dot on each of those lots (stable at all zooms)
 * 3) Short sunset fan on strong scores (≥60)
 *
 * Blocked lots stay dark — a Strand 100 does not light up the walled-off
 * second-row house behind it.
 */
export function OceanViewshedHeatLayer({ enabled, listings }: Props) {
  const viewLots = useMemo(() => {
    if (!enabled) return [];
    return listings.filter(
      (l) => (l.analysis?.oceanViewshed?.score100 ?? 0) >= MIN_VIEW_SCORE,
    );
  }, [enabled, listings]);

  const raster = useMemo(() => {
    if (!enabled || !viewLots.length) return null;
    return paintOceanViewshedHeatmap(viewLots, 480, 360);
  }, [enabled, viewLots]);

  const wedges = useMemo(
    () => (enabled ? strongWedges(listings) : []),
    [enabled, listings],
  );

  if (!enabled) return null;

  return (
    <>
      {raster?.url && (
        <ImageOverlay
          url={raster.url}
          bounds={raster.bounds}
          opacity={0.7}
          zIndex={350}
          interactive={false}
        />
      )}
      {wedges.map((w) => (
        <Polygon
          key={`owedge-${w.id}`}
          positions={w.positions}
          pathOptions={{
            color: w.score >= 80 ? "#0b6e4f" : "#2a9d8f",
            fillColor: w.score >= 80 ? "#0b6e4f" : "#2a9d8f",
            fillOpacity: 0.14 + Math.min(0.16, (w.score - 60) / 250),
            weight: 1.25,
            opacity: 0.55,
          }}
        />
      ))}
      {viewLots.map((l) => {
        const score = l.analysis!.oceanViewshed!.score100;
        return (
          <CircleMarker
            key={`odot-${l.id}`}
            center={[l.lat, l.lng]}
            radius={score >= 60 ? 9 : 6}
            pathOptions={{
              color: "#0b3d2e",
              weight: 1,
              fillColor: scoreFill(score),
              fillOpacity: 0.55 + Math.min(0.35, score / 200),
              opacity: 0.75,
            }}
          >
            <Tooltip direction="top" offset={[0, -4]}>
              {l.address}
              <br />
              Ocean/sunset {score}/100
            </Tooltip>
          </CircleMarker>
        );
      })}
    </>
  );
}
