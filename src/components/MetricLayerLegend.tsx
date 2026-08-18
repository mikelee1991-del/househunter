import { airQualityBand } from "../lib/airQuality";
import {
  MAP_METRIC_OPTIONS,
  metricScoreColor,
  type MapMetricLayer,
} from "../lib/mapMetrics";
import { SAFETY_TIERS } from "../data/safetyTiers";

const SCORE_BANDS = [
  { label: "High", min: 70 },
  { label: "Good", min: 50 },
  { label: "Fair", min: 35 },
  { label: "Low", min: 20 },
  { label: "Poor", min: 0 },
];

const ADDRESS_NOTE =
  "One ~40 m halo per listing address — not a tract or neighborhood wash.";

export function MetricLayerLegend({ layer }: { layer: MapMetricLayer }) {
  if (layer === "off" || layer === "suitability") return null;

  if (layer === "safety") {
    return (
      <div className="safety-legend">
        <strong>Safety (per address)</strong>
        <p>{ADDRESS_NOTE} Score from CA OpenJustice / tract index at the home.</p>
        <ul>
          {SAFETY_TIERS.map((t) => (
            <li key={t.tier}>
              <i style={{ background: t.color }} />
              {t.label}
              <span>{t.scoreBand}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (layer === "air") {
    return (
      <div className="safety-legend">
        <strong>Air / pollution (per address)</strong>
        <p>
          {ADDRESS_NOTE} CalEnviroScreen burden at the listing’s tract — higher
          = cleaner.
        </p>
        <ul>
          {SCORE_BANDS.map((b) => (
            <li key={b.label}>
              <i style={{ background: metricScoreColor(b.min + 10) }} />
              {airQualityBand(b.min + 10)}
              <span>≥{b.min}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (layer === "walk") {
    return (
      <div className="safety-legend">
        <strong>Walkability (per address)</strong>
        <p>{ADDRESS_NOTE} EPA Walkability at the home (1–20 → 0–100).</p>
        <ul>
          <li>
            <i style={{ background: "#0b6e4f" }} />
            Higher walk
            <span>15–20</span>
          </li>
          <li>
            <i style={{ background: "#a3b18a" }} />
            Moderate
            <span>10–15</span>
          </li>
          <li>
            <i style={{ background: "#c4a35a" }} />
            Lower walk
            <span>&lt;10</span>
          </li>
        </ul>
      </div>
    );
  }

  if (layer === "noise") {
    return (
      <div className="safety-legend">
        <strong>Ambient noise (per address)</strong>
        <p>
          {ADDRESS_NOTE} Louder of LAX CNEL + highway corridors. Lines =
          road centerlines.
        </p>
        <ul>
          <li>
            <i style={{ background: "#c0392b" }} />
            Loud
            <span>≥70</span>
          </li>
          <li>
            <i style={{ background: "#e07a3d" }} />
            Elevated
            <span>60–70</span>
          </li>
          <li>
            <i style={{ background: "#f0c929" }} />
            Moderate
            <span>50–60</span>
          </li>
          <li>
            <i style={{ background: "#c8b88a" }} />
            Quieter
            <span>&lt;50</span>
          </li>
        </ul>
      </div>
    );
  }

  if (layer === "ocean") {
    return (
      <div className="safety-legend">
        <strong>Ocean / sunset (per address)</strong>
        <p>
          {ADDRESS_NOTE} DEM line-of-sight score baked on each listing (~18
          rays).
        </p>
        <ul>
          <li>
            <i style={{ background: "#0b6e4f" }} />
            Strong wedge
            <span>≥60</span>
          </li>
          <li>
            <i style={{ background: "#2a9d8f" }} />
            Usable wedge
            <span>35–60</span>
          </li>
          <li>
            <i style={{ background: "#7a9bb0" }} />
            Mostly blocked
            <span>&lt;35</span>
          </li>
        </ul>
      </div>
    );
  }

  if (layer === "condition") {
    return (
      <div className="safety-legend">
        <strong>Condition (per address)</strong>
        <p>{ADDRESS_NOTE} Listing-text condition score at that home.</p>
        <ul>
          {SCORE_BANDS.map((b) => (
            <li key={b.label}>
              <i style={{ background: metricScoreColor(b.min + 10) }} />
              {b.label}
              <span>≥{b.min}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return null;
}

/** Chip row for switching map metrics (optional companion to the select). */
export function MetricLayerTabs({
  value,
  onChange,
}: {
  value: MapMetricLayer;
  onChange: (layer: MapMetricLayer) => void;
}) {
  return (
    <div className="metric-tabs" role="tablist" aria-label="Map metric layer">
      {MAP_METRIC_OPTIONS.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={value === o.id}
          className={`metric-tab ${value === o.id ? "is-active" : ""}`}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
