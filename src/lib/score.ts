import { walkBandLabel } from "../data/neighborhoodLivability";
import type { Anchor, AnchorId, Criteria, Listing, ScoredListing } from "../types";
import { driveMinutesToAnchors } from "./geo";
import {
  pointInIsochrone,
  type IsochroneMap,
} from "./isochrone";
import type { ListingLivability } from "../hooks/useLivability";
import type { OceanViewshedResult } from "./oceanViewshed";

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

  if (listing.status !== "active") {
    failReasons.push(`Not actively for sale (${listing.status})`);
  }

  // Budget
  if (listing.price >= criteria.budgetMin && listing.price <= criteria.budgetMax) {
    score += 25;
    matchReasons.push("In budget");
  } else if (listing.price < criteria.budgetMin) {
    score += 10;
    matchReasons.push("Under budget");
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

  // Ocean / sunset viewshed — GIS score vs slider minimum (0 = off)
  const minView = criteria.minOceanViewshed ?? 0;
  const viewScore = viewshed
    ? viewshed.score100
    : listing.oceanView
      ? 70
      : 0;
  if (minView > 0) {
    if (viewScore >= minView) {
      score += 20;
      if (viewshed) {
        matchReasons.push(
          `Ocean viewshed ${viewScore}/100 ≥ ${minView} (${viewshed.confidence})`,
        );
        if (viewshed.buildingBlockedRays === 0) score += 4;
      } else {
        matchReasons.push(
          `Ocean/sunset view (listing text ≈ ${viewScore}/100 ≥ ${minView})`,
        );
      }
    } else {
      failReasons.push(
        `Ocean viewshed ${viewScore}/100 < ${minView}${
          viewshed ? ` (${viewshed.summary})` : " (no GIS yet / no listing view)"
        }`,
      );
    }
  } else if (viewScore >= 35) {
    score += 8;
    matchReasons.push(
      viewshed
        ? `Ocean viewshed ${viewScore}/100 (bonus)`
        : "Ocean/sunset view bonus",
    );
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

  // Noise
  if (listing.noiseCnel <= criteria.maxNoiseCnel) {
    score += 10;
    matchReasons.push(`Noise ~${listing.noiseCnel} CNEL`);
  } else {
    failReasons.push(
      `Airplane noise ~${listing.noiseCnel} CNEL > max ${criteria.maxNoiseCnel}`,
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
  const coreFails = failReasons.filter(
    (r) =>
      r.startsWith("Not actively for sale") ||
      r.startsWith("Over budget") ||
      r.startsWith("Needs ") || // beds / baths
      r.startsWith("Under ") || // sqft
      r.startsWith("Missing ") || // beds / baths / sqft
      (criteria.requireSingleFamily && r.startsWith("Not SFR")) ||
      (criteria.requireOutdoorSpace && r === "No outdoor space") ||
      r.startsWith("Garage "),
  );

  // Full match gates — also require viewshed, noise, drive times, livability
  const hardFails = failReasons.filter(
    (r) =>
      coreFails.includes(r) ||
      ((criteria.minOceanViewshed ?? 0) > 0 &&
        r.startsWith("Ocean viewshed")) ||
      r.startsWith("Airplane noise") ||
      r.startsWith("Neighborhood filter") ||
      r.startsWith("Safety ") ||
      r.startsWith("Walk ") ||
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
    oceanViewshed: viewshed
      ? {
          hasOceanView: viewshed.hasOceanView,
          clearRayFraction: viewshed.clearRayFraction,
          score100: viewshed.score100,
          clearRays: viewshed.clearRays,
          testedRays: viewshed.testedRays,
          nearestCoastKm: viewshed.nearestCoastKm,
          terrainBlockedRays: viewshed.terrainBlockedRays,
          buildingBlockedRays: viewshed.buildingBlockedRays,
          confidence: viewshed.confidence,
          summary: viewshed.summary,
        }
      : undefined,
  };
}
