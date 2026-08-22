import { useMemo, useState } from "react";
import { ImageOverlay, Polyline, useMap, useMapEvents } from "react-leaflet";
import { HIGHWAY_CORRIDORS } from "../data/ambientNoise";
import {
  noiseCnelRgba,
  paintAddressHalos,
  scoreRgba,
  type AddressHeatSample,
} from "../lib/addressHeatmap";
import type { MapMetricLayer } from "../lib/mapMetrics";
import { oceanViewshedRgba } from "../lib/suitabilityHeatmap";
import type { Listing } from "../types";

/** Parcel floor when zoomed in */
const MIN_RADIUS_KM = 0.04;
/** Cap when zoomed out — still address-centered, not tract-scale */
const MAX_RADIUS_KM = 0.15;
/** Aim for ~this many screen pixels of halo diameter/2 */
const TARGET_PX = 16;

function radiusKmForZoom(zoom: number, lat: number): number {
  const mpp =
    (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
  const targetKm = (mpp * TARGET_PX) / 1000;
  return Math.min(MAX_RADIUS_KM, Math.max(MIN_RADIUS_KM, targetKm));
}

function samplesForMetric(
  listings: Listing[],
  metric: MapMetricLayer,
): AddressHeatSample[] {
  const out: AddressHeatSample[] = [];
  for (const l of listings) {
    let score: number | null = null;
    switch (metric) {
      case "ocean": {
        const ov = l.analysis?.oceanViewshed;
        if (!ov) break;
        const s = ov.oceanViewScore ?? ov.score100;
        if (typeof s !== "number") break;
        const coast = ov.nearestCoastKm ?? 99;
        const summary = ov.summary || "";
        if (coast > 12) break;
        if (/too far inland/i.test(summary)) break;
        score = s;
        break;
      }
      case "sunset": {
        const ov = l.analysis?.oceanViewshed;
        if (!ov || typeof ov.sunsetViewScore !== "number") break;
        const coast = ov.nearestCoastKm ?? 99;
        const summary = ov.summary || "";
        if (coast > 28) break;
        if (/too far inland/i.test(summary)) break;
        score = ov.sunsetViewScore;
        break;
      }
      case "noise":
        score = l.noiseCnel;
        break;
      case "safety":
        score = l.analysis?.safetyScore ?? null;
        break;
      case "air":
        score = l.analysis?.airQualityScore ?? null;
        break;
      case "walk":
        score =
          l.analysis?.walkIndex != null
            ? Math.round((l.analysis.walkIndex / 20) * 100)
            : null;
        break;
      case "condition":
        score = l.analysis?.condition?.score100 ?? null;
        break;
      case "suitability": {
        const raw = l.analysis?.defaultScore?.score;
        // defaultScore can exceed 100 — clamp for colormap
        score = raw == null ? null : Math.max(0, Math.min(100, raw));
        break;
      }
      default:
        break;
    }
    if (score == null || !Number.isFinite(score)) continue;
    out.push({ lat: l.lat, lng: l.lng, score });
  }
  return out;
}

function rgbaFor(metric: MapMetricLayer) {
  if (metric === "ocean" || metric === "sunset") return oceanViewshedRgba;
  if (metric === "noise") return noiseCnelRgba;
  return scoreRgba;
}

interface Props {
  enabled: boolean;
  metric: MapMetricLayer;
  listings: Listing[];
}

/**
 * Address-local heatmap: one soft halo per listing. Radius tracks zoom so
 * discs stay readable city-wide but tighten to ~40 m when zoomed in.
 */
export function AddressMetricHeatLayer({ enabled, metric, listings }: Props) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  useMapEvents({
    zoomend: () => setZoom(map.getZoom()),
  });

  const radiusKm = radiusKmForZoom(zoom, map.getCenter().lat);

  const raster = useMemo(() => {
    if (!enabled || metric === "off") return null;
    const samples = samplesForMetric(listings, metric);
    if (!samples.length) return null;
    return paintAddressHalos(samples, rgbaFor(metric), {
      radiusKm,
      cols: 720,
      rows: 540,
    });
  }, [enabled, metric, listings, radiusKm]);

  if (!enabled || !raster?.url) return null;

  return (
    <>
      <ImageOverlay
        url={raster.url}
        bounds={raster.bounds}
        opacity={0.95}
        zIndex={360}
        interactive={false}
      />
      {metric === "noise" &&
        HIGHWAY_CORRIDORS.map((road) => (
          <Polyline
            key={road.id}
            positions={road.coordinates.map(([lng, lat]) => [lat, lng])}
            pathOptions={{
              color: road.klass === "freeway" ? "#9b2c2c" : "#b85c38",
              weight: road.klass === "freeway" ? 2 : 1.25,
              opacity: 0.45,
              dashArray: road.klass === "coastal" ? "4 6" : undefined,
            }}
          />
        ))}
    </>
  );
}
