import { useMemo } from "react";
import type { Criteria, ScoredListing } from "../types";

interface Props {
  listings: ScoredListing[];
  criteria: Criteria;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const W = 320;
const H = 220;
const PAD = { t: 16, r: 16, b: 36, l: 40 };

function xOf(walk: number) {
  return PAD.l + ((walk - 1) / 19) * (W - PAD.l - PAD.r);
}
function yOf(safety: number) {
  return PAD.t + (1 - safety / 100) * (H - PAD.t - PAD.b);
}

export function LivabilityScatter({
  listings,
  criteria,
  selectedId,
  onSelect,
}: Props) {
  const points = useMemo(
    () =>
      listings.filter(
        (l) => l.safetyScore != null && l.walkIndex != null,
      ),
    [listings],
  );

  if (points.length === 0) return null;

  // Target zone: walk ∈ [min,max], safety ≥ min (top of chart = safer)
  const zoneX = xOf(criteria.walkMin);
  const zoneY = PAD.t;
  const zoneW = Math.max(4, xOf(criteria.walkMax) - zoneX);
  const zoneH = Math.max(4, yOf(criteria.minSafetyScore) - PAD.t);

  return (
    <div className="scatter-card">
      <div className="scatter-head">
        <h2>Safety × walkability</h2>
        <p>
          Target zone = low crime (≥{criteria.minSafetyScore}) and your walk
          band ({criteria.walkMin}–{criteria.walkMax} EPA). Dots outside fail
          those filters.
        </p>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="scatter-svg"
        role="img"
        aria-label="Scatter plot of listing safety versus walkability"
      >
        <rect
          x={zoneX}
          y={zoneY}
          width={zoneW}
          height={zoneH}
          className="scatter-zone"
        />
        {/* axes */}
        <line
          x1={PAD.l}
          y1={H - PAD.b}
          x2={W - PAD.r}
          y2={H - PAD.b}
          className="scatter-axis"
        />
        <line
          x1={PAD.l}
          y1={PAD.t}
          x2={PAD.l}
          y2={H - PAD.b}
          className="scatter-axis"
        />
        <text x={W / 2} y={H - 8} textAnchor="middle" className="scatter-label">
          Walkability (EPA 1–20) →
        </text>
        <text
          x={14}
          y={H / 2}
          textAnchor="middle"
          className="scatter-label"
          transform={`rotate(-90 14 ${H / 2})`}
        >
          Safety →
        </text>
        {/* EPA band ticks */}
        {[5.75, 10.5, 15.25].map((v) => (
          <line
            key={v}
            x1={xOf(v)}
            y1={PAD.t}
            x2={xOf(v)}
            y2={H - PAD.b}
            className="scatter-grid"
          />
        ))}
        {points.map((l) => {
          const cx = xOf(l.walkIndex!);
          const cy = yOf(l.safetyScore!);
          const inZone =
            l.safetyScore! >= criteria.minSafetyScore &&
            l.walkIndex! >= criteria.walkMin &&
            l.walkIndex! <= criteria.walkMax;
          const selected = l.id === selectedId;
          return (
            <g
              key={l.id}
              className="scatter-point"
              onClick={() => onSelect(l.id)}
              style={{ cursor: "pointer" }}
            >
              <circle
                cx={cx}
                cy={cy}
                r={selected ? 7 : l.flagged ? 5.5 : 4}
                className={
                  selected
                    ? "pt selected"
                    : inZone
                      ? "pt in"
                      : "pt out"
                }
              />
              {selected && (
                <text x={cx + 8} y={cy - 8} className="scatter-tip">
                  {l.neighborhood}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="scatter-legend">
        <span>
          <i className="swatch in" /> in target zone
        </span>
        <span>
          <i className="swatch out" /> outside
        </span>
        <span>
          <i className="swatch zone" /> your criteria
        </span>
      </div>
    </div>
  );
}
