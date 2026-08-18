import { useMemo } from "react";
import { ImageOverlay, Polyline } from "react-leaflet";
import {
  estimateNoiseCnel,
  HIGHWAY_CORRIDORS,
} from "../data/ambientNoise";
import {
  SUITABILITY_BOUNDS,
  type SuitabilityRaster,
} from "../lib/suitabilityHeatmap";

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

/** Louder → more opaque amber/red; quiet areas nearly clear. */
function noiseRgba(cnel: number): [number, number, number, number] {
  const t = clamp((cnel - 42) / 36, 0, 1);
  const a = Math.round(clamp(t, 0, 1) * 200);
  let r: number;
  let g: number;
  let b: number;
  if (t < 0.45) {
    const u = t / 0.45;
    r = Math.round(200 + u * 30);
    g = Math.round(180 - u * 40);
    b = Math.round(80 - u * 40);
  } else if (t < 0.75) {
    const u = (t - 0.45) / 0.3;
    r = Math.round(230 - u * 20);
    g = Math.round(140 - u * 60);
    b = Math.round(40);
  } else {
    const u = (t - 0.75) / 0.25;
    r = Math.round(210 - u * 20);
    g = Math.round(80 - u * 40);
    b = Math.round(40 + u * 10);
  }
  return [r, g, b, a];
}

function paintNoiseHeatmap(cols = 200, rows = 150): SuitabilityRaster {
  const { south, west, north, east } = SUITABILITY_BOUNDS;
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return {
      url: "",
      bounds: [
        [south, west],
        [north, east],
      ],
      cols,
      rows,
      peakMean: 0,
    };
  }
  const img = ctx.createImageData(cols, rows);
  for (let row = 0; row < rows; row++) {
    const lat = north - ((row + 0.5) / rows) * (north - south);
    for (let col = 0; col < cols; col++) {
      const lng = west + ((col + 0.5) / cols) * (east - west);
      const cnel = estimateNoiseCnel(lat, lng);
      const [r, g, b, a] = noiseRgba(cnel);
      const px = (row * cols + col) * 4;
      img.data[px] = r;
      img.data[px + 1] = g;
      img.data[px + 2] = b;
      img.data[px + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
  return {
    url: canvas.toDataURL("image/png"),
    bounds: [
      [south, west],
      [north, east],
    ],
    cols,
    rows,
    peakMean: 0,
  };
}

interface Props {
  enabled: boolean;
}

/**
 * Ambient noise surface: max(LAX CNEL, highway corridor decay).
 * Highway centerlines drawn on top for orientation.
 */
export function NoiseHeatLayer({ enabled }: Props) {
  const raster = useMemo(() => {
    if (!enabled) return null;
    return paintNoiseHeatmap();
  }, [enabled]);

  if (!enabled || !raster?.url) return null;

  return (
    <>
      <ImageOverlay
        url={raster.url}
        bounds={raster.bounds}
        opacity={0.85}
        zIndex={340}
        interactive={false}
      />
      {HIGHWAY_CORRIDORS.map((road) => (
        <Polyline
          key={road.id}
          positions={road.coordinates.map(([lng, lat]) => [lat, lng])}
          pathOptions={{
            color: road.klass === "freeway" ? "#9b2c2c" : "#b85c38",
            weight: road.klass === "freeway" ? 2.5 : 1.5,
            opacity: 0.75,
            dashArray: road.klass === "coastal" ? "4 6" : undefined,
          }}
        />
      ))}
    </>
  );
}
