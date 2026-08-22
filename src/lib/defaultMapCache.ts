/**
 * Browser loaders for shipped default isochrones + suitability packs.
 */
import type { Anchor, AnchorId, Criteria } from "../types";
import type { IsochroneMap } from "./isochrone";
import {
  buildDefaultMapSignature,
  roundCoord,
  scoresFromBase64,
  signaturesMatch,
  type DefaultIsochroneFile,
  type DefaultSuitabilityFile,
} from "./defaultMapSignature";
import {
  paintScoresToRaster,
  type SuitabilityRaster,
} from "./suitabilityHeatmap";

function publicDataUrl(path: string): string {
  let base = "/";
  try {
    base =
      (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env
        ?.BASE_URL ?? "/";
  } catch {
    base = "/";
  }
  return `${base}${path}`;
}

let isoCache: DefaultIsochroneFile | null | undefined;
let suitCache: DefaultSuitabilityFile | null | undefined;

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(publicDataUrl(path));
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function loadDefaultIsochroneFile(): Promise<DefaultIsochroneFile | null> {
  if (isoCache !== undefined) return isoCache;
  isoCache = await fetchJson<DefaultIsochroneFile>("data/isochrones-default.json");
  return isoCache;
}

export async function loadDefaultSuitabilityFile(): Promise<DefaultSuitabilityFile | null> {
  if (suitCache !== undefined) return suitCache;
  suitCache =
    await fetchJson<DefaultSuitabilityFile>("data/suitability-default.json");
  return suitCache;
}

/**
 * Return precomputed isochrones when anchors + drive minutes match the
 * shipped Valhalla pack (ORS → never).
 */
export async function tryDefaultIsochrones(
  anchors: Anchor[],
  driveMinutes: Record<AnchorId, number>,
  usingOrs: boolean,
): Promise<IsochroneMap | null> {
  if (usingOrs) return null;
  const file = await loadDefaultIsochroneFile();
  if (!file?.features) return null;

  const fileById = new Map(
    file.signature.anchors.map((a) => [a.id, a] as const),
  );
  if (fileById.size !== anchors.length) return null;
  for (const a of anchors) {
    const b = fileById.get(a.id);
    if (!b) return null;
    if (
      Math.abs(roundCoord(a.lat) - b.lat) > 1e-5 ||
      Math.abs(roundCoord(a.lng) - b.lng) > 1e-5
    ) {
      return null;
    }
  }

  const fileDrive = file.signature.driveMinutes;
  const ids = new Set([
    ...Object.keys(driveMinutes),
    ...Object.keys(fileDrive),
  ]);
  for (const id of ids) {
    if (Number(driveMinutes[id as AnchorId]) !== Number(fileDrive[id as AnchorId])) {
      return null;
    }
  }
  return { ...file.features };
}

export async function tryDefaultSuitabilityRaster(
  anchors: Anchor[],
  criteria: Criteria,
): Promise<SuitabilityRaster | null> {
  const file = await loadDefaultSuitabilityFile();
  if (!file?.scoresB64) return null;
  const live = buildDefaultMapSignature(anchors, criteria);
  if (!signaturesMatch(live, file.signature)) return null;

  const raw = scoresFromBase64(file.scoresB64);
  return paintScoresToRaster(raw, file.cols, file.rows, file.bounds);
}
