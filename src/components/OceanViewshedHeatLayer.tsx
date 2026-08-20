import { useMemo, useState } from "react";
import { ImageOverlay, useMap, useMapEvents } from "react-leaflet";
import {
  paintAddressHalos,
  type AddressHeatSample,
} from "../lib/addressHeatmap";
import { oceanViewshedRgba } from "../lib/suitabilityHeatmap";
import type { Listing } from "../types";

/**
 * Paint every scored lot (including modest wedges). Alpha already ramps with
 * score in oceanViewshedRgba — no hard “only ≥60 get a fan” cliff that made
 * the map look like random address stickers.
 */
const MIN_PAINT_SCORE = 12;
/** Parcel floor when zoomed in */
const MIN_RADIUS_KM = 0.05;
/** Cap when zoomed out — still address-centered, overlaps into a corridor */
const MAX_RADIUS_KM = 0.18;
const TARGET_PX = 18;

function radiusKmForZoom(zoom: number, lat: number): number {
  const mpp =
    (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
  const targetKm = (mpp * TARGET_PX) / 1000;
  return Math.min(MAX_RADIUS_KM, Math.max(MIN_RADIUS_KM, targetKm));
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

interface Props {
  enabled: boolean;
  listings: Listing[];
}

/**
 * Ocean/sunset overlay as a continuous per-address field: every listing with
 * a meaningful score contributes a soft halo. Beach corridors merge visually;
 * inland zeros stay dark. No sparse per-home sunset polygons.
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

  if (!enabled || !raster?.url) return null;

  return (
    <ImageOverlay
      url={raster.url}
      bounds={raster.bounds}
      opacity={0.9}
      zIndex={355}
      interactive={false}
    />
  );
}
