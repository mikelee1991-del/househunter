import { useMemo } from "react";
import { CircleMarker, Tooltip } from "react-leaflet";
import {
  conditionChipLabel,
  conditionRgba,
  hasConditionMapSignal,
  resolveListingCondition,
} from "../lib/condition";
import type { Listing } from "../types";

type CondDot = {
  id: string;
  lat: number;
  lng: number;
  score: number;
  label: string;
  summary: string;
  isFixer: boolean;
};

function scoreFill(score: number): string {
  const [r, g, b] = conditionRgba(score);
  return `rgb(${r},${g},${b})`;
}

function buildDots(listings: Listing[]): CondDot[] {
  const out: CondDot[] = [];
  for (const l of listings) {
    if (!Number.isFinite(l.lat) || !Number.isFinite(l.lng)) continue;
    const c = resolveListingCondition(l);
    if (!c || !hasConditionMapSignal(c)) continue;
    out.push({
      id: l.id,
      lat: l.lat,
      lng: l.lng,
      score: c.score100,
      label: conditionChipLabel(c),
      summary: c.summary,
      isFixer: c.isFixer,
    });
  }
  // Draw mid scores first so fixers / turnkeys sit on top
  out.sort((a, b) => a.score - b.score);
  return out;
}

interface Props {
  enabled: boolean;
  listings: Listing[];
}

/**
 * Address-exact condition dots — listing-text screening only.
 * Skips the default “unclear ~62” majority so the map highlights real
 * fixer / updated signal instead of a muddy city wash.
 */
export function ConditionHeatLayer({ enabled, listings }: Props) {
  const dots = useMemo(
    () => (enabled ? buildDots(listings) : []),
    [enabled, listings],
  );

  if (!enabled || !dots.length) return null;

  return (
    <>
      {dots.map((d) => {
        const radius =
          d.isFixer || d.score >= 85
            ? 9
            : d.score >= 70 || d.score <= 50
              ? 7.5
              : 6;
        return (
          <CircleMarker
            key={`cond-${d.id}`}
            center={[d.lat, d.lng]}
            radius={radius}
            pathOptions={{
              color: d.isFixer ? "#7a1f1f" : "#1a2a28",
              weight: d.isFixer || d.score >= 85 ? 1.6 : 1,
              fillColor: scoreFill(d.score),
              fillOpacity: 0.72,
              opacity: 0.85,
            }}
          >
            <Tooltip direction="top" offset={[0, -4]}>
              <strong>
                {d.label} · {d.score}/100
              </strong>
              <br />
              {d.summary}
            </Tooltip>
          </CircleMarker>
        );
      })}
    </>
  );
}
