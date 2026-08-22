/**
 * Shared signature + score encoding for default map packs.
 * Safe for Node (precompute script) and the browser.
 */
import { DEFAULT_ANCHORS, DEFAULT_CRITERIA } from "../data/anchors";
import type { Anchor, AnchorId, Criteria } from "../types";
import type { PolygonFeature } from "./isochrone";

export type DefaultIsochroneFile = {
  version: 1;
  generatedAt: string;
  provider: "valhalla";
  signature: DefaultMapSignature;
  features: Partial<Record<AnchorId, PolygonFeature>>;
};

export type DefaultSuitabilityFile = {
  version: 1;
  generatedAt: string;
  signature: DefaultMapSignature;
  cols: number;
  rows: number;
  bounds: [[number, number], [number, number]];
  /** 0 = transparent (outside isochrone); 1–101 = score+1 */
  scoresB64: string;
};

/** Stable fingerprint for default-map cache hits. */
export type DefaultMapSignature = {
  anchors: Array<{ id: AnchorId; lat: number; lng: number }>;
  driveMinutes: Record<AnchorId, number>;
  maxNoiseCnel: number;
  minSafetyScore: number;
  walkMin: number;
  walkMax: number;
  minOceanViewshed: number;
  minAirQualityScore: number;
  requireWithinAllIsochrones: boolean;
};

export function roundCoord(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}

export function buildDefaultMapSignature(
  anchors: Anchor[],
  criteria: Criteria,
): DefaultMapSignature {
  return {
    anchors: anchors.map((a) => ({
      id: a.id,
      lat: roundCoord(a.lat),
      lng: roundCoord(a.lng),
    })),
    driveMinutes: { ...criteria.driveMinutes },
    maxNoiseCnel: criteria.maxNoiseCnel,
    minSafetyScore: criteria.minSafetyScore,
    walkMin: criteria.walkMin,
    walkMax: criteria.walkMax,
    minOceanViewshed: criteria.minOceanViewshed ?? 0,
    minAirQualityScore: criteria.minAirQualityScore ?? 0,
    requireWithinAllIsochrones: !!criteria.requireWithinAllIsochrones,
  };
}

export function defaultMapSignatureKey(sig: DefaultMapSignature): string {
  return JSON.stringify(sig);
}

export function shippedDefaultSignature(): DefaultMapSignature {
  return buildDefaultMapSignature(DEFAULT_ANCHORS, DEFAULT_CRITERIA);
}

export function signaturesMatch(
  a: DefaultMapSignature,
  b: DefaultMapSignature,
): boolean {
  return defaultMapSignatureKey(a) === defaultMapSignatureKey(b);
}

export function encodeSuitabilityScores(
  scores: Array<number | null>,
): Uint8Array {
  const out = new Uint8Array(scores.length);
  for (let i = 0; i < scores.length; i++) {
    const s = scores[i];
    if (s == null || !Number.isFinite(s)) {
      out[i] = 0;
      continue;
    }
    out[i] = Math.max(0, Math.min(100, Math.round(s))) + 1;
  }
  return out;
}

export function scoresToBase64(scores: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(scores).toString("base64");
  }
  let s = "";
  for (let i = 0; i < scores.length; i++) s += String.fromCharCode(scores[i]);
  return btoa(s);
}

export function scoresFromBase64(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
