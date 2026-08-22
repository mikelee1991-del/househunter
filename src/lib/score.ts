import { walkBandLabel } from "../data/neighborhoodLivability";
import { estimateTrafficCnel } from "../data/ambientNoise";
import type { Anchor, AnchorId, Criteria, Listing, ScoredListing } from "../types";
import { analyzeCondition, type ConditionAssessment } from "./condition";
import { driveMinutesToAnchors } from "./geo";
import {
  pointInIsochrone,
  type IsochroneMap,
} from "./isochrone";
import type { ListingLivability } from "../hooks/useLivability";
import { airQualityBand } from "./airQuality";
import type { OceanViewshedResult } from "./oceanViewshed";

function resolveAirQuality(listing: Listing): {
  airQualityScore: number | null;
  band: string | null;
} {
  const score =
    listing.analysis?.airQualityScore ??
    listing.analysis?.airQuality?.airQualityScore ??
    null;
  if (score == null || !Number.isFinite(score)) {
    return { airQualityScore: null, band: null };
  }
  return {
    airQualityScore: score,
    band: listing.analysis?.airQuality?.band ?? airQualityBand(score),
  };
}

function resolveCondition(listing: Listing): ConditionAssessment {
  if (listing.analysis?.condition) {
    return listing.analysis.condition;
  }
  return analyzeCondition({
    description: listing.description,
    address: listing.address,
    yearBuilt: listing.yearBuilt,
  });
}

export function scoreListing(
  listing: Listing,
  criteria: Criteria,
  anchors: Anchor[],
  isochrones?: IsochroneMap,
  roadMinutes?: Partial<Record<AnchorId, number>>,
  livability?: ListingLivability,
  viewshed?: OceanViewshedResult,
): ScoredListing {
  const matchReasons: string[] = [];
  const failReasons: string[] = [];
  let score = 0;

  const approx = driveMinutesToAnchors(listing.lat, listing.lng, anchors);
  const drives = { ...approx, ...roadMinutes } as Record<AnchorId, number>;
  const condition = resolveCondition(listing);
  const air = resolveAirQuality(listing);

  if (listing.status === "pending") {
    failReasons.push("Pending sale / under contract");
  } else if (listing.status !== "active") {
    failReasons.push(`Not actively for sale (${listing.status})`);
  }

  // Budget — max only; cheaper homes still fully in budget
  if (listing.price <= criteria.budgetMax) {
    score += 25;
    matchReasons.push("In budget");
  } else {
    failReasons.push(
      `Over budget ($${(listing.price / 1e6).toFixed(2)}M > $${(criteria.budgetMax / 1e6).toFixed(2)}M)`,
    );
  }

  // Beds / baths / sqft — hard minimums
  if (listing.beds > 0 && listing.beds >= criteria.minBeds) {
    score += 8;
    matchReasons.push(`${listing.beds} beds`);
  } else if (listing.beds <= 0) {
    failReasons.push("Missing bed count");
  } else {
    failReasons.push(`Needs ${criteria.minBeds}+ beds (has ${listing.beds})`);
  }
  if (listing.baths > 0 && listing.baths >= criteria.minBaths) {
    score += 6;
  } else if (listing.baths <= 0) {
    failReasons.push("Missing bath count");
  } else {
    failReasons.push(`Needs ${criteria.minBaths}+ baths (has ${listing.baths})`);
  }
  if (listing.sqft > 0 && listing.sqft >= criteria.minSqft) {
    score += 6;
  } else if (listing.sqft <= 0) {
    failReasons.push("Missing sqft");
  } else {
    failReasons.push(
      `Under ${criteria.minSqft.toLocaleString()} sqft (has ${listing.sqft.toLocaleString()})`,
    );
  }

  // Ocean view (Pacific water LOS) — separate from sunset
  const minOcean = criteria.minOceanViewshed ?? 0;
  const oceanScore = viewshed
    ? (viewshed.oceanViewScore ?? viewshed.score100)
    : listing.oceanView
      ? 70
      : 0;
  if (minOcean > 0) {
    if (oceanScore >= minOcean) {
      score += 12;
      if (viewshed) {
        matchReasons.push(
          `Ocean view ${oceanScore}/100 ≥ ${minOcean} (${viewshed.confidence})`,
        );
        if (viewshed.buildingBlockedRays === 0) score += 2;
      } else {
        matchReasons.push(
          `Ocean view (listing text ≈ ${oceanScore}/100 ≥ ${minOcean})`,
        );
      }
    } else {
      failReasons.push(
        `Ocean view ${oceanScore}/100 < ${minOcean}${
          viewshed ? ` (${viewshed.summary})` : " (no GIS yet / no listing view)"
        }`,
      );
    }
  } else if (oceanScore >= 35) {
    score += 5;
    matchReasons.push(
      viewshed
        ? `Ocean view ${oceanScore}/100 (bonus)`
        : "Ocean view bonus",
    );
  }

  // Sunset view (due-west horizon) — hills inland can score without beach water
  const minSunset = criteria.minSunsetViewshed ?? 0;
  const sunsetScore = viewshed?.sunsetViewScore;
  if (minSunset > 0) {
    if (sunsetScore != null && sunsetScore >= minSunset) {
      score += 10;
      matchReasons.push(
        `Sunset view ${sunsetScore}/100 ≥ ${minSunset} (${viewshed!.confidence})`,
      );
    } else {
      failReasons.push(
        `Sunset view ${sunsetScore == null ? "unknown" : `${sunsetScore}/100`} < ${minSunset}${
          viewshed ? ` (${viewshed.summary})` : " (no GIS yet)"
        }`,
      );
    }
  } else if (sunsetScore != null && sunsetScore >= 35) {
    score += 4;
    matchReasons.push(`Sunset view ${sunsetScore}/100 (bonus)`);
  }

  // Single-family detached — no shared walls
  if (criteria.requireSingleFamily) {
    if (listing.propertyType === "sfr") {
      score += 8;
      matchReasons.push("Single-family (detached)");
    } else {
      failReasons.push(
        `Not SFR (${listing.propertyType}) — shared walls / not detached`,
      );
    }
  }

  // Outdoor space (grass not required)
  if (criteria.requireOutdoorSpace) {
    if (listing.outdoorSpace) {
      score += 8;
      const kinds = listing.outdoorTypes?.length
        ? listing.outdoorTypes.join(", ")
        : "outdoor space";
      matchReasons.push(`Outdoor space (${kinds})`);
    } else {
      failReasons.push("No outdoor space");
    }
  } else if (listing.outdoorSpace) {
    score += 3;
  }

  // Garage — 2-car required, 3-car nice-to-have
  if (listing.garageSpaces >= criteria.minGarageSpaces) {
    score += 8;
    matchReasons.push(`${listing.garageSpaces}-car garage`);
    if (listing.garageSpaces >= criteria.preferGarageSpaces) {
      score += 8;
      matchReasons.push(
        `${listing.garageSpaces}-car garage (nice-to-have met)`,
      );
    }
  } else {
    failReasons.push(
      `Garage ${listing.garageSpaces}-car < required ${criteria.minGarageSpaces}-car`,
    );
  }

  // Condition / renovation — listing-text screening (not an inspection)
  const minCond = criteria.minConditionScore ?? 0;
  if (criteria.excludeFixerUpper && condition.isFixer) {
    failReasons.push(`Fixer-upper risk — ${condition.summary}`);
  } else if (minCond > 0 && condition.score100 < minCond) {
    failReasons.push(
      `Condition ${condition.score100}/100 below min ${minCond} — ${condition.summary}`,
    );
  } else if (condition.score100 >= 70) {
    score += 8;
    matchReasons.push(
      condition.renovatedYear
        ? `Updated ~${condition.renovatedYear}`
        : "Move-in ready language",
    );
  } else if (condition.score100 >= 55) {
    score += 4;
    matchReasons.push("Acceptable condition from listing text");
  }

  // Ambient noise (LAX ∪ roads)
  if (listing.noiseCnel <= criteria.maxNoiseCnel) {
    score += 8;
    matchReasons.push(`Quiet ~${listing.noiseCnel} CNEL (ambient)`);
  } else {
    failReasons.push(
      `Noise ~${listing.noiseCnel} CNEL > max ${criteria.maxNoiseCnel} (LAX + roads)`,
    );
  }

  // Traffic / road corridors only (no airport)
  const trafficCnel = estimateTrafficCnel(listing.lat, listing.lng);
  const maxTraffic = criteria.maxTrafficCnel ?? 72;
  if (trafficCnel <= maxTraffic) {
    score += 6;
    matchReasons.push(
      trafficCnel <= 42
        ? "Away from freeway / PCH corridors"
        : `Traffic ~${trafficCnel} CNEL (roads)`,
    );
  } else {
    failReasons.push(
      `Traffic ~${trafficCnel} CNEL > max ${maxTraffic} (freeway / PCH)`,
    );
  }

  // Safety / low crime
  if (livability) {
    if (livability.safetyScore >= criteria.minSafetyScore) {
      score += 10;
      matchReasons.push(
        `Low crime area (${livability.safetyScore} · ${livability.safetyLabel})`,
      );
    } else {
      failReasons.push(
        `Safety ${livability.safetyScore} < min ${criteria.minSafetyScore} (${livability.safetyLabel})`,
      );
    }

    // Moderate walkability band
    if (
      livability.walkIndex >= criteria.walkMin &&
      livability.walkIndex <= criteria.walkMax
    ) {
      score += 10;
      matchReasons.push(
        `Walk ${livability.walkIndex.toFixed(1)} · ${walkBandLabel(livability.walkIndex)}`,
      );
    } else if (livability.walkIndex < criteria.walkMin) {
      failReasons.push(
        `Walk ${livability.walkIndex.toFixed(1)} below band (${criteria.walkMin}–${criteria.walkMax})`,
      );
    } else {
      failReasons.push(
        `Walk ${livability.walkIndex.toFixed(1)} above band (${criteria.walkMin}–${criteria.walkMax}) — denser than “moderate”`,
      );
    }
  }

  // Air / pollution burden (CalEnviroScreen)
  const minAir = criteria.minAirQualityScore ?? 0;
  if (minAir > 0) {
    if (air.airQualityScore == null) {
      failReasons.push("Air quality unknown for this tract");
    } else if (air.airQualityScore >= minAir) {
      score += 8;
      matchReasons.push(
        `Air quality ${air.airQualityScore} · ${air.band ?? "OK"} (≥ ${minAir})`,
      );
    } else {
      failReasons.push(
        `Air quality ${air.airQualityScore} < min ${minAir} (${air.band ?? "high burden"})`,
      );
    }
  } else if (air.airQualityScore != null && air.airQualityScore >= 50) {
    score += 4;
    matchReasons.push(
      `Lower pollution burden (${air.airQualityScore} · ${air.band})`,
    );
  }

  // Isochrones / drive times — prefer polygon membership when available
  let insideAll = true;
  const havePolys =
    !!isochrones && anchors.every((a) => !!isochrones[a.id]);

  for (const a of anchors) {
    const limit = criteria.driveMinutes[a.id];
    const mins = drives[a.id];
    const inside = havePolys
      ? pointInIsochrone(listing.lat, listing.lng, isochrones![a.id])
      : mins <= limit;

    if (inside) {
      score += 4;
      matchReasons.push(
        havePolys
          ? `Inside ${a.label.split(" ")[0]} ${limit}m isochrone` +
            (mins < 900 ? ` (~${mins}m road)` : "")
          : `≤${limit} min to ${a.label.split(" ")[0]} (~${mins}m)`,
      );
    } else {
      insideAll = false;
      failReasons.push(
        havePolys
          ? `Outside ${a.label} ${limit}m isochrone` +
            (mins < 900 ? ` (~${mins}m road)` : "")
          : `${mins}m to ${a.label} (limit ${limit}m)`,
      );
    }
  }
  if (criteria.requireWithinAllIsochrones && !insideAll) {
    score = Math.min(score, 40);
  }

  // Neighborhood filter
  if (
    criteria.neighborhoods.length > 0 &&
    !criteria.neighborhoods.includes(listing.neighborhood)
  ) {
    failReasons.push(`Neighborhood filter excludes ${listing.neighborhood}`);
  } else if (criteria.neighborhoods.length > 0) {
    score += 5;
  }

  // Core gates — home should not appear in the UI pool at all
  // (pending stays visible with a UI indicator, but never counts as a match)
  const coreFails = failReasons.filter(
    (r) =>
      r.startsWith("Not actively for sale") ||
      r.startsWith("Over budget") ||
      r.startsWith("Needs ") || // beds / baths
      r.startsWith("Under ") || // sqft
      r.startsWith("Missing ") || // beds / baths / sqft
      (criteria.requireSingleFamily && r.startsWith("Not SFR")) ||
      (criteria.requireOutdoorSpace && r === "No outdoor space") ||
      r.startsWith("Garage ") ||
      (criteria.excludeFixerUpper && r.startsWith("Fixer-upper risk")) ||
      ((criteria.minConditionScore ?? 0) > 0 && r.startsWith("Condition ")),
  );

  // Full match gates — also require viewshed, noise, drive times, livability
  const hardFails = failReasons.filter(
    (r) =>
      coreFails.includes(r) ||
      r.startsWith("Pending sale") ||
      ((criteria.minOceanViewshed ?? 0) > 0 &&
        r.startsWith("Ocean view")) ||
      ((criteria.minSunsetViewshed ?? 0) > 0 &&
        r.startsWith("Sunset view")) ||
      (r.startsWith("Noise ~") && r.includes("> max")) ||
      r.startsWith("Airplane noise") ||
      r.startsWith("Neighborhood filter") ||
      r.startsWith("Safety ") ||
      r.startsWith("Walk ") ||
      ((criteria.minAirQualityScore ?? 0) > 0 &&
        (r.startsWith("Air quality ") || r.startsWith("Air quality unknown"))) ||
      (criteria.requireWithinAllIsochrones &&
        (r.includes("limit") || r.startsWith("Outside"))),
  );

  const coreRejected = coreFails.length > 0;
  const flagged = hardFails.length === 0 && score >= 55;

  return {
    ...listing,
    score,
    matchReasons,
    failReasons,
    coreRejected,
    flagged,
    driveMinutesEstimate: drives,
    safetyScore: livability?.safetyScore,
    safetyLabel: livability?.safetyLabel,
    walkIndex: livability?.walkIndex,
    walkSource: livability?.walkSource,
    airQualityScore: air.airQualityScore,
    airQualityBand: air.band,
    condition,
    oceanViewshed: viewshed
      ? {
          hasOceanView: viewshed.hasOceanView,
          hasSunsetView: viewshed.hasSunsetView,
          clearRayFraction: viewshed.clearRayFraction,
          score100: viewshed.score100,
          oceanViewScore: viewshed.oceanViewScore,
          sunsetViewScore: viewshed.sunsetViewScore,
          clearRays: viewshed.clearRays,
          testedRays: viewshed.testedRays,
          sunsetClearRays: viewshed.sunsetClearRays,
          sunsetTestedRays: viewshed.sunsetTestedRays,
          nearestCoastKm: viewshed.nearestCoastKm,
          terrainBlockedRays: viewshed.terrainBlockedRays,
          buildingBlockedRays: viewshed.buildingBlockedRays,
          confidence: viewshed.confidence,
          summary: viewshed.summary,
        }
      : undefined,
  };
}
