import { useId } from "react";
import {
  buildParameterBars,
  type ParameterBar,
} from "../lib/parameterBars";
import type { Anchor, Criteria, ScoredListing } from "../types";

interface Props {
  listing: ScoredListing;
  criteria: Criteria;
  anchors: Anchor[];
  /** Compact for map popup */
  compact?: boolean;
}

function BarRow({ bar, compact }: { bar: ParameterBar; compact?: boolean }) {
  const okClass =
    bar.ok === true ? "ok" : bar.ok === false ? "bad" : "neutral";
  const fill = Math.max(2, Math.min(100, bar.fill));

  return (
    <div className={`param-bar-row ${okClass}`} title={bar.detail}>
      <div className="param-bar-head">
        <span className="param-bar-label">{bar.label}</span>
        <strong className="param-bar-value">{bar.valueLabel}</strong>
      </div>
      <div className="param-bar-track" aria-hidden>
        {bar.band && (
          <div
            className="param-bar-band"
            style={{
              left: `${bar.band.start}%`,
              width: `${Math.max(0, bar.band.end - bar.band.start)}%`,
            }}
          />
        )}
        <div
          className={`param-bar-fill ${okClass}`}
          style={{ width: `${fill}%` }}
        />
        {bar.threshold != null && bar.kind !== "none" && (
          <div
            className="param-bar-threshold"
            style={{ left: `${Math.min(100, Math.max(0, bar.threshold))}%` }}
          />
        )}
      </div>
      {!compact && bar.detail && (
        <p className="param-bar-detail">{bar.detail}</p>
      )}
    </div>
  );
}

export function ParameterScoreChart({
  listing,
  criteria,
  anchors,
  compact,
}: Props) {
  const titleId = useId();
  const bars = buildParameterBars(listing, criteria, anchors);

  return (
    <div
      className={`param-chart ${compact ? "compact" : ""}`}
      role="img"
      aria-labelledby={titleId}
    >
      <div className="param-chart-head">
        <h3 id={titleId}>{compact ? "Scores" : "How it scores"}</h3>
        {!compact && (
          <p>
            Bars = this home · tick = your criteria
            {listing.flagged ? " · full match" : ""}
          </p>
        )}
      </div>
      <div className="param-chart-bars">
        {bars.map((bar) => (
          <BarRow key={bar.id} bar={bar} compact={compact} />
        ))}
      </div>
    </div>
  );
}
