/**
 * Private user preferences — criteria + drive anchors.
 *
 * Load order (first hit wins):
 *   1) localStorage (this browser)
 *   2) optional /private-prefs.json (gitignored; for local npm run dev only)
 *   3) public DEFAULT_* from the repo
 *
 * Export/import JSON to move prefs between devices without committing them.
 */
import { DEFAULT_ANCHORS, DEFAULT_CRITERIA } from "../data/anchors";
import type { Anchor, AnchorId, Criteria } from "../types";

export const PREFS_STORAGE_KEY = "househunter.userPrefs.v1";
export const PREFS_VERSION = 1 as const;

export interface UserPrefs {
  version: typeof PREFS_VERSION;
  savedAt: string;
  criteria: Criteria;
  anchors: Anchor[];
}

const ANCHOR_IDS: AnchorId[] = ["spacex", "lax", "kentwood", "torrance"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function mergeCriteria(raw: unknown): Criteria {
  const base = { ...DEFAULT_CRITERIA, driveMinutes: { ...DEFAULT_CRITERIA.driveMinutes } };
  if (!isRecord(raw)) return base;
  const driveIn = isRecord(raw.driveMinutes) ? raw.driveMinutes : {};
  const driveMinutes = { ...base.driveMinutes };
  for (const id of ANCHOR_IDS) {
    driveMinutes[id] = num(driveIn[id], base.driveMinutes[id]);
  }
  const neighborhoods = Array.isArray(raw.neighborhoods)
    ? raw.neighborhoods.filter((n): n is string => typeof n === "string")
    : base.neighborhoods;

  return {
    budgetMax: num(raw.budgetMax, base.budgetMax),
    minBeds: num(raw.minBeds, base.minBeds),
    minBaths: num(raw.minBaths, base.minBaths),
    minSqft: num(raw.minSqft, base.minSqft),
    minOceanViewshed: num(raw.minOceanViewshed, base.minOceanViewshed),
    requireOceanView: bool(raw.requireOceanView, base.requireOceanView),
    requireWestFacing: bool(raw.requireWestFacing, base.requireWestFacing),
    requireOutdoorSpace: bool(raw.requireOutdoorSpace, base.requireOutdoorSpace),
    requireSingleFamily: bool(raw.requireSingleFamily, base.requireSingleFamily),
    minGarageSpaces: num(raw.minGarageSpaces, base.minGarageSpaces),
    preferGarageSpaces: num(raw.preferGarageSpaces, base.preferGarageSpaces),
    excludeFixerUpper: bool(raw.excludeFixerUpper, base.excludeFixerUpper),
    minConditionScore: num(raw.minConditionScore, base.minConditionScore),
    maxNoiseCnel: num(raw.maxNoiseCnel, base.maxNoiseCnel),
    minSafetyScore: num(raw.minSafetyScore, base.minSafetyScore),
    minAirQualityScore: num(raw.minAirQualityScore, base.minAirQualityScore),
    walkMin: num(raw.walkMin, base.walkMin),
    walkMax: num(raw.walkMax, base.walkMax),
    driveMinutes,
    requireWithinAllIsochrones: bool(
      raw.requireWithinAllIsochrones,
      base.requireWithinAllIsochrones,
    ),
    neighborhoods,
  };
}

function mergeAnchors(raw: unknown): Anchor[] {
  const byId = new Map(
    DEFAULT_ANCHORS.map((a) => [a.id, { ...a } as Anchor]),
  );
  if (!Array.isArray(raw)) return DEFAULT_ANCHORS.map((a) => ({ ...a }));

  for (const item of raw) {
    if (!isRecord(item)) continue;
    const id = item.id;
    if (typeof id !== "string" || !ANCHOR_IDS.includes(id as AnchorId)) continue;
    const prev = byId.get(id as AnchorId)!;
    byId.set(id as AnchorId, {
      ...prev,
      label: typeof item.label === "string" ? item.label : prev.label,
      address: typeof item.address === "string" ? item.address : prev.address,
      description:
        typeof item.description === "string" ? item.description : prev.description,
      lat: num(item.lat, prev.lat),
      lng: num(item.lng, prev.lng),
      color: typeof item.color === "string" ? item.color : prev.color,
    });
  }
  return ANCHOR_IDS.map((id) => byId.get(id)!);
}

export function normalizePrefs(raw: unknown): UserPrefs {
  const rec = isRecord(raw) ? raw : {};
  return {
    version: PREFS_VERSION,
    savedAt:
      typeof rec.savedAt === "string" ? rec.savedAt : new Date().toISOString(),
    criteria: mergeCriteria(rec.criteria),
    anchors: mergeAnchors(rec.anchors),
  };
}

export function buildPrefs(criteria: Criteria, anchors: Anchor[]): UserPrefs {
  return {
    version: PREFS_VERSION,
    savedAt: new Date().toISOString(),
    criteria,
    anchors: anchors.map((a) => ({ ...a })),
  };
}

export function readStoredPrefs(): UserPrefs | null {
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return null;
    return normalizePrefs(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeStoredPrefs(prefs: UserPrefs): void {
  try {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* quota / private mode */
  }
}

export function clearStoredPrefs(): void {
  try {
    localStorage.removeItem(PREFS_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Optional gitignored file for local/dev only (404 on public Pages is fine). */
export async function fetchOptionalPrivatePrefsFile(): Promise<UserPrefs | null> {
  try {
    const url = `${import.meta.env.BASE_URL}private-prefs.json`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return normalizePrefs(await res.json());
  } catch {
    return null;
  }
}

export async function resolveInitialPrefs(): Promise<UserPrefs> {
  const stored = readStoredPrefs();
  if (stored) return stored;
  const file = await fetchOptionalPrivatePrefsFile();
  if (file) {
    writeStoredPrefs(file);
    return file;
  }
  return buildPrefs(DEFAULT_CRITERIA, DEFAULT_ANCHORS);
}

export function prefsToJson(prefs: UserPrefs): string {
  return `${JSON.stringify(prefs, null, 2)}\n`;
}

export function downloadPrefs(prefs: UserPrefs, filename = "househunter-prefs.json") {
  const blob = new Blob([prefsToJson(prefs)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function parsePrefsJson(text: string): UserPrefs {
  return normalizePrefs(JSON.parse(text));
}
