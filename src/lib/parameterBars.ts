import type { Anchor, Criteria, ScoredListing } from "../types";

export type ParameterBarKind = "min" | "max" | "band" | "target" | "none";

export interface ParameterBar {
  id: string;
  label: string;
  /** Display value, e.g. "82" or "12.5" or "2-car" */
  valueLabel: string;
  /** 0–100 fill for the bar */
  fill: number;
  /** Where the criteria threshold sits on the same 0–100 scale (optional) */
  threshold?: number;
  /** For walk-style band: start/end on 0–100 scale */
  band?: { start: number; end: number };
  kind: ParameterBarKind;
  /** Meets criteria for this parameter (null = informational only) */
  ok: boolean | null;
  detail?: string;
}

function clamp(n: number, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, n));
}

/** Quieter → higher. 40 CNEL ≈ 100, 80 CNEL ≈ 0. */
function quietScore(cnel: number): number {
  return clamp(((80 - cnel) / 40) * 100);
}

function quietThreshold(maxCnel: number): number {
  return quietScore(maxCnel);
}

/**
 * Build horizontal-bar rows for a selected listing: each scored parameter
 * plus where it sits vs the current criteria.
 */
export function buildParameterBars(
  listing: ScoredListing,
  criteria: Criteria,
  anchors: Anchor[],
): ParameterBar[] {
  const bars: ParameterBar[] = [];

  bars.push({
    id: "match",
    label: "Match score",
    valueLabel: String(Math.round(listing.score)),
    fill: clamp(listing.score),
    threshold: 55,
    kind: "min",
    ok: listing.flagged,
    detail: listing.flagged ? "Full match" : "Not a full match yet",
  });

  if (listing.safetyScore != null) {
    bars.push({
      id: "safety",
      label: "Safety",
      valueLabel: String(listing.safetyScore),
      fill: clamp(listing.safetyScore),
      threshold: criteria.minSafetyScore,
      kind: "min",
      ok: listing.safetyScore >= criteria.minSafetyScore,
      detail: listing.safetyLabel,
    });
  }

  if (listing.airQualityScore != null) {
    const minAir = criteria.minAirQualityScore ?? 0;
    bars.push({
      id: "air",
      label: "Air quality",
      valueLabel: String(listing.airQualityScore),
      fill: clamp(listing.airQualityScore),
      threshold: minAir > 0 ? minAir : undefined,
      kind: minAir > 0 ? "min" : "none",
      ok: minAir <= 0 ? null : listing.airQualityScore >= minAir,
      detail: listing.airQualityBand ?? undefined,
    });
  }

  if (listing.walkIndex != null) {
    const fill = clamp((listing.walkIndex / 20) * 100);
    bars.push({
      id: "walk",
      label: "Walkability",
      valueLabel: listing.walkIndex.toFixed(1),
      fill,
      band: {
        start: clamp((criteria.walkMin / 20) * 100),
        end: clamp((criteria.walkMax / 20) * 100),
      },
      kind: "band",
      ok:
        listing.walkIndex >= criteria.walkMin &&
        listing.walkIndex <= criteria.walkMax,
      detail: `Band ${criteria.walkMin}–${criteria.walkMax}`,
    });
  }

  const ocean =
    listing.oceanViewshed?.oceanViewScore ?? listing.oceanViewshed?.score100;
  if (ocean != null) {
    const minOcean = criteria.minOceanViewshed ?? 0;
    bars.push({
      id: "ocean",
      label: "Ocean view",
      valueLabel: String(ocean),
      fill: clamp(ocean),
      threshold: minOcean > 0 ? minOcean : undefined,
      kind: minOcean > 0 ? "min" : "none",
      ok: minOcean <= 0 ? null : ocean >= minOcean,
      detail: listing.oceanViewshed?.summary,
    });
  }

  const sunset = listing.oceanViewshed?.sunsetViewScore;
  if (sunset != null) {
    const minSunset = criteria.minSunsetViewshed ?? 0;
    bars.push({
      id: "sunset",
      label: "Sunset view",
      valueLabel: String(sunset),
      fill: clamp(sunset),
      threshold: minSunset > 0 ? minSunset : undefined,
      kind: minSunset > 0 ? "min" : "none",
      ok: minSunset <= 0 ? null : sunset >= minSunset,
      detail: listing.oceanViewshed?.summary,
    });
  }

  if (listing.condition) {
    const minCond = criteria.minConditionScore ?? 0;
    bars.push({
      id: "condition",
      label: "Condition",
      valueLabel: String(listing.condition.score100),
      fill: clamp(listing.condition.score100),
      threshold: minCond > 0 ? minCond : undefined,
      kind: minCond > 0 ? "min" : "none",
      ok:
        criteria.excludeFixerUpper && listing.condition.isFixer
          ? false
          : minCond <= 0
            ? null
            : listing.condition.score100 >= minCond,
      detail: listing.condition.summary,
    });
  }

  bars.push({
    id: "noise",
    label: "Quiet",
    valueLabel: `~${listing.noiseCnel} CNEL`,
    fill: quietScore(listing.noiseCnel),
    threshold: quietThreshold(criteria.maxNoiseCnel),
    kind: "min",
    ok: listing.noiseCnel <= criteria.maxNoiseCnel,
    detail: `Max ${criteria.maxNoiseCnel} CNEL (airport + highway)`,
  });

  const budgetFill =
    listing.price <= criteria.budgetMax
      ? clamp(40 + (1 - listing.price / criteria.budgetMax) * 60)
      : clamp(40 * (criteria.budgetMax / Math.max(listing.price, 1)));
  bars.push({
    id: "budget",
    label: "Budget",
    valueLabel: `$${(listing.price / 1e6).toFixed(2)}M`,
    fill: budgetFill,
    threshold: 40,
    kind: "max",
    ok: listing.price <= criteria.budgetMax,
    detail: `Max $${(criteria.budgetMax / 1e6).toFixed(2)}M`,
  });

  if (listing.sqft > 0) {
    const ratio = listing.sqft / Math.max(criteria.minSqft, 1);
    bars.push({
      id: "sqft",
      label: "Size",
      valueLabel: `${listing.sqft.toLocaleString()} sqft`,
      fill: clamp(ratio * 70),
      threshold: 70,
      kind: "min",
      ok: listing.sqft >= criteria.minSqft,
      detail: `Min ${criteria.minSqft.toLocaleString()} sqft`,
    });
  }

  const garageTarget = Math.max(criteria.preferGarageSpaces, criteria.minGarageSpaces, 1);
  bars.push({
    id: "garage",
    label: "Garage",
    valueLabel: `${listing.garageSpaces}-car`,
    fill: clamp((listing.garageSpaces / garageTarget) * 100),
    threshold: clamp((criteria.minGarageSpaces / garageTarget) * 100),
    kind: "min",
    ok: listing.garageSpaces >= criteria.minGarageSpaces,
    detail:
      listing.garageSpaces >= criteria.preferGarageSpaces
        ? `${criteria.preferGarageSpaces}+ preferred`
        : `Need ${criteria.minGarageSpaces}+`,
  });

  for (const a of anchors) {
    const mins = listing.driveMinutesEstimate?.[a.id];
    if (mins == null || !Number.isFinite(mins) || mins >= 900) continue;
    const limit = criteria.driveMinutes[a.id];
    const fill =
      mins <= limit
        ? clamp(55 + (1 - mins / Math.max(limit, 1)) * 45)
        : clamp(45 * (limit / Math.max(mins, 1)));
    bars.push({
      id: `drive-${a.id}`,
      label: `Drive · ${a.label.split(" ")[0]}`,
      valueLabel: `~${Math.round(mins)}m`,
      fill,
      threshold: 55,
      kind: "max",
      ok: mins <= limit,
      detail: `Limit ${limit}m`,
    });
  }

  return bars;
}
