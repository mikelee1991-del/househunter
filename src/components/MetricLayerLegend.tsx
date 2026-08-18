import { airQualityBand } from "../lib/airQuality";
import {
  MAP_METRIC_OPTIONS,
  metricLayerTitle,
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

export function MetricLayerLegend({ layer }: { layer: MapMetricLayer }) {
  if (layer === "off" || layer === "suitability") return null;

  if (layer === "safety") {
    return (
      <div className="safety-legend">
        <strong>Safety by census tract</strong>
        <p>Discrete 5-class relative index — not address-level crime</p>
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
        <strong>Air / pollution burden</strong>
        <p>CalEnviroScreen — higher = cleaner relative air</p>
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
        <strong>Walkability</strong>
        <p>Neighborhood EPA walk index estimate (1–20)</p>
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
        <strong>LAX noise contours</strong>
        <p>Approximate CNEL bands — quieter is better for matches</p>
        <ul>
          <li>
            <i style={{ background: "#f0c929" }} />
            ~65 CNEL
          </li>
          <li>
            <i style={{ background: "#e07a3d" }} />
            ~70 CNEL
          </li>
          <li>
            <i style={{ background: "#c0392b" }} />
            ~75 CNEL
          </li>
        </ul>
      </div>
    );
  }

  // ocean / condition — pin-colored layers
  return (
    <div className="safety-legend">
      <strong>{metricLayerTitle(layer)} on homes</strong>
      <p>
        {layer === "ocean"
          ? "Pin color = ocean/sunset openness score"
          : "Pin color = listing condition score"}
      </p>
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
