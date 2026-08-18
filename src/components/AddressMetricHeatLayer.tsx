import { useMemo } from "react";
import { ImageOverlay, Polyline } from "react-leaflet";
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

/** ~40 m parcel-scale halo — address-local, not neighborhood */
const RADIUS_KM = 0.04;

function samplesForMetric(
  listings: Listing[],
  metric: MapMetricLayer,
): AddressHeatSample[] {
  const out: AddressHeatSample[] = [];
  for (const l of listings) {
    let score: number | null = null;
    switch (metric) {
      case "ocean": {
        const v = l.analysis?.oceanViewshed?.score100;
        if (typeof v === "number") score = v;
        else if (l.oceanView) score = 70;
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
      case "suitability":
        score = l.analysis?.defaultScore?.score ?? null;
        break;
      default:
        break;
    }
    if (score == null || !Number.isFinite(score)) continue;
    out.push({ lat: l.lat, lng: l.lng, score });
  }
  return out;
}

function rgbaFor(metric: MapMetricLayer) {
  if (metric === "ocean") return oceanViewshedRgba;
  if (metric === "noise") return noiseCnelRgba;
  return scoreRgba;
}

interface Props {
  enabled: boolean;
  metric: MapMetricLayer;
  listings: Listing[];
}

/**
 * Address-local heatmap: one soft ~40 m halo per listing using that
 * address’s score. No tract / neighborhood choropleth wash.
 */
export function AddressMetricHeatLayer({ enabled, metric, listings }: Props) {
  const raster = useMemo(() => {
    if (!enabled || metric === "off") return null;
    const samples = samplesForMetric(listings, metric);
    if (!samples.length) return null;
    return paintAddressHalos(samples, rgbaFor(metric), {
      radiusKm: RADIUS_KM,
      // ~25–30 m pixels across South Bay so 40 m discs stay round
      cols: 720,
      rows: 540,
    });
  }, [enabled, metric, listings]);

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
