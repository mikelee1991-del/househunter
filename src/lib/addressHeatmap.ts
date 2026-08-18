import { haversineKm } from "./geo";
import {
  SUITABILITY_BOUNDS,
  type SuitabilityRaster,
} from "./suitabilityHeatmap";

export type AddressHeatSample = {
  lat: number;
  lng: number;
  /** 0–100 display score (higher = better for the metric, except raw noise CNEL handled by caller) */
  score: number;
};

export type RgbaFn = (score: number) => [number, number, number, number];

/**
 * Paint tight halos around address samples only.
 * Default radius ~40 m — parcel / address scale, not neighborhood.
 */
export function paintAddressHalos(
  samples: AddressHeatSample[],
  rgba: RgbaFn,
  opts?: {
    radiusKm?: number;
    cols?: number;
    rows?: number;
  },
): SuitabilityRaster {
  const radiusKm = opts?.radiusKm ?? 0.04;
  const cols = opts?.cols ?? 720;
  const rows = opts?.rows ?? 540;
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
  // Zero-fill (transparent)
  for (let i = 0; i < img.data.length; i++) img.data[i] = 0;

  if (!samples.length) {
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

  const latSpan = north - south;
  const lngSpan = east - west;
  // Approx degrees for radius (for pixel window culling)
  const dLat = radiusKm / 111;
  const midLat = (north + south) / 2;
  const dLng = radiusKm / (111 * Math.cos((midLat * Math.PI) / 180));

  let peakSum = 0;
  let peakN = 0;

  // For each sample, stamp a soft disc onto nearby pixels
  for (const s of samples) {
    if (s.score >= 55) {
      peakSum += s.score;
      peakN += 1;
    }
    const [br, bg, bb, ba] = rgba(s.score);
    if (ba <= 0) continue;

    const row0 = Math.max(
      0,
      Math.floor(((north - (s.lat + dLat)) / latSpan) * rows),
    );
    const row1 = Math.min(
      rows - 1,
      Math.ceil(((north - (s.lat - dLat)) / latSpan) * rows),
    );
    const col0 = Math.max(
      0,
      Math.floor(((s.lng - dLng - west) / lngSpan) * cols),
    );
    const col1 = Math.min(
      cols - 1,
      Math.ceil(((s.lng + dLng - west) / lngSpan) * cols),
    );

    for (let row = row0; row <= row1; row++) {
      const lat = north - ((row + 0.5) / rows) * latSpan;
      for (let col = col0; col <= col1; col++) {
        const lng = west + ((col + 0.5) / cols) * lngSpan;
        const d = haversineKm(lat, lng, s.lat, s.lng);
        if (d > radiusKm) continue;
        // Smooth falloff to parcel edge
        const t = 1 - d / radiusKm;
        const fall = t * t;
        const a = Math.round(ba * fall);
        if (a <= 0) continue;
        const px = (row * cols + col) * 4;
        // Alpha-composite over existing (nearest listing wins if stronger)
        const oa = img.data[px + 3] / 255;
        const na = a / 255;
        const outA = na + oa * (1 - na);
        if (outA <= 0) continue;
        img.data[px] = Math.round(
          (br * na + img.data[px] * oa * (1 - na)) / outA,
        );
        img.data[px + 1] = Math.round(
          (bg * na + img.data[px + 1] * oa * (1 - na)) / outA,
        );
        img.data[px + 2] = Math.round(
          (bb * na + img.data[px + 2] * oa * (1 - na)) / outA,
        );
        img.data[px + 3] = Math.round(outA * 255);
      }
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
    peakMean: peakN ? peakSum / peakN : 0,
  };
}

/** Shared green←amber←red scale for 0–100 “higher is better” metrics. */
export function scoreRgba(score: number): [number, number, number, number] {
  const t = Math.max(0, Math.min(1, score / 100));
  const a = Math.round(200 + t * 40);
  let r: number;
  let g: number;
  let b: number;
  if (t < 0.4) {
    const u = t / 0.4;
    r = Math.round(180 + u * 40);
    g = Math.round(70 + u * 50);
    b = Math.round(55);
  } else if (t < 0.7) {
    const u = (t - 0.4) / 0.3;
    r = Math.round(220 - u * 110);
    g = Math.round(120 + u * 50);
    b = Math.round(55);
  } else {
    const u = (t - 0.7) / 0.3;
    r = Math.round(110 - u * 99);
    g = Math.round(170 + u * 20);
    b = Math.round(55 + u * 20);
  }
  return [r, g, b, a];
}

/** Noise CNEL → rgba (louder = more opaque red/amber). */
export function noiseCnelRgba(cnel: number): [number, number, number, number] {
  const t = Math.max(0, Math.min(1, (cnel - 42) / 36));
  const a = Math.round(40 + t * 200);
  const r = Math.round(200 + t * 30);
  const g = Math.round(170 - t * 100);
  const b = Math.round(50);
  return [r, g, b, a];
}
