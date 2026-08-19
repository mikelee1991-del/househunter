import { useMemo, useState } from "react";
import {
  ImageOverlay,
  Polygon,
  useMap,
  useMapEvents,
} from "react-leaflet";
import {
  paintAddressHalos,
  type AddressHeatSample,
} from "../lib/addressHeatmap";
import {
  SUNSET_OCEAN_CONE_CENTER_DEG,
  SUNSET_OCEAN_CONE_HALF_DEG,
} from "../lib/oceanViewshed";
import { oceanViewshedRgba } from "../lib/suitabilityHeatmap";
import type { Listing } from "../types";

/** Only paint listings with a real ocean/sunset wedge */
const MIN_PAINT_SCORE = 35;
/** Parcel floor when zoomed in */
const MIN_RADIUS_KM = 0.045;
/** Cap when zoomed out — still address-centered */
const MAX_RADIUS_KM = 0.12;
const TARGET_PX = 14;

function radiusKmForZoom(zoom: number, lat: number): number {
  const mpp =
    (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
  const targetKm = (mpp * TARGET_PX) / 1000;
  return Math.min(MAX_RADIUS_KM, Math.max(MIN_RADIUS_KM, targetKm));
}

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

function oceanSamples(listings: Listing[]): AddressHeatSample[] {
  const out: AddressHeatSample[] = [];
  for (const l of listings) {
    const score = l.analysis?.oceanViewshed?.score100;
    if (typeof score !== "number" || score < MIN_PAINT_SCORE) continue;
    out.push({ lat: l.lat, lng: l.lng, score });
  }
  return out;
}

type Wedge = {
  id: string;
  positions: [number, number][];
  score: number;
};

/** Soft sunset-facing wedge for strong ocean scores (beach / hill). */
function strongWedges(listings: Listing[]): Wedge[] {
  const out: Wedge[] = [];
  for (const l of listings) {
    const ov = l.analysis?.oceanViewshed;
    if (!ov || ov.score100 < 60) continue;
    const reachKm = Math.min(1.8, Math.max(0.55, (ov.nearestCoastKm ?? 1) + 0.45));
    const left = destination(
      l.lat,
      l.lng,
      SUNSET_OCEAN_CONE_CENTER_DEG - SUNSET_OCEAN_CONE_HALF_DEG * 0.55,
      reachKm,
    );
    const mid = destination(
      l.lat,
      l.lng,
      SUNSET_OCEAN_CONE_CENTER_DEG,
      reachKm * 1.05,
    );
    const right = destination(
      l.lat,
      l.lng,
      SUNSET_OCEAN_CONE_CENTER_DEG + SUNSET_OCEAN_CONE_HALF_DEG * 0.55,
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
 * Ocean/sunset overlay: address halos only for real wedges (≥35), plus
 * directional sunset fans for strong scores (≥60). Suppresses the lumpy
 * mid/low wash that made inland blocks look like view neighborhoods.
 */
export function OceanViewshedHeatLayer({ enabled, listings }: Props) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  useMapEvents({
    zoomend: () => setZoom(map.getZoom()),
  });

  const radiusKm = radiusKmForZoom(zoom, map.getCenter().lat);

  const raster = useMemo(() => {
    if (!enabled) return null;
    const samples = oceanSamples(listings);
    if (!samples.length) return null;
    return paintAddressHalos(samples, oceanViewshedRgba, {
      radiusKm,
      cols: 720,
      rows: 540,
    });
  }, [enabled, listings, radiusKm]);

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
          opacity={0.88}
          zIndex={355}
          interactive={false}
        />
      )}
      {wedges.map((w) => (
        <Polygon
          key={`wedge-${w.id}`}
          positions={w.positions}
          pathOptions={{
            color: w.score >= 80 ? "#0b6e4f" : "#2a9d8f",
            fillColor: w.score >= 80 ? "#0b6e4f" : "#2a9d8f",
            fillOpacity: 0.12 + Math.min(0.18, (w.score - 60) / 200),
            weight: 1,
            opacity: 0.45,
          }}
        />
      ))}
    </>
  );
}
