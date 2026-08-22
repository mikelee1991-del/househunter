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

const AREA_NOTE =
  "Continuous surface across the commute-reachable region (union of isochrones) — any location, not listing pins only.";

export function MetricLayerLegend({ layer }: { layer: MapMetricLayer }) {
  if (layer === "off" || layer === "suitability") return null;

  if (layer === "safety") {
    return (
      <div className="safety-legend">
        <strong>Safety (area)</strong>
        <p>
          {AREA_NOTE} Census-tract / neighborhood crime index at every cell.
        </p>
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
        <strong>Air / pollution (area)</strong>
        <p>
          {AREA_NOTE} CalEnviroScreen burden by tract — higher = cleaner.
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
        <strong>Walkability (area)</strong>
        <p>
          {AREA_NOTE} Neighborhood + EPA-style walk index at every cell inside
          the drive-time polygons.
        </p>
        <ul>
          <li>
            <i style={{ background: "#1d4e89" }} />
            Most walkable
            <span>15–20</span>
          </li>
          <li>
            <i style={{ background: "#3d8b66" }} />
            Above average
            <span>10.5–15</span>
          </li>
          <li>
            <i style={{ background: "#c4a35a" }} />
            Below average
            <span>5.8–10.5</span>
          </li>
          <li>
            <i style={{ background: "#8a7a66" }} />
            Least walkable
            <span>≤5.75</span>
          </li>
        </ul>
      </div>
    );
  }

  if (layer === "noise") {
    return (
      <div className="safety-legend">
        <strong>Ambient noise (area)</strong>
        <p>
          {AREA_NOTE} LAX CNEL contours (dashed) + freeway corridors (solid;
          PCH dashed). Wash takes the louder source, and energy-combines when
          airport and highway are both ≥50 CNEL.
        </p>
        <ul>
          <li>
            <i style={{ background: "#c0392b" }} />
            Loud
            <span>≥70 CNEL</span>
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
        <strong>Ocean view (area)</strong>
        <p>
          Clear line-of-sight to Pacific water across the reachable region,
          plus GIS dots/fans at analyzed coastal addresses. Blocked second-row
          lots stay dark next to a Strand 100.
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
            <i style={{ background: "#4a5560" }} />
            Blocked / weak
            <span>&lt;35</span>
          </li>
        </ul>
      </div>
    );
  }

  if (layer === "sunset") {
    return (
      <div className="safety-legend">
        <strong>Sunset view (area)</strong>
        <p>
          Due-west horizon openness — elevated inland hills can score when
          ridges do not block the western sky. Separate from beachfront ocean
          water.
        </p>
        <ul>
          <li>
            <i style={{ background: "#0b6e4f" }} />
            Strong west band
            <span>≥60</span>
          </li>
          <li>
            <i style={{ background: "#2a9d8f" }} />
            Usable west band
            <span>35–60</span>
          </li>
          <li>
            <i style={{ background: "#4a5560" }} />
            Blocked / weak
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
        <p>
          Listing-text screening at each home — not a neighborhood wash. Quiet
          mid-scores (no renovation / fixer language) stay off the map so
          updated and project homes stand out.
        </p>
        <ul>
          <li>
            <i style={{ background: "#0b6e4f" }} />
            Turnkey / updated
            <span>≥85</span>
          </li>
          <li>
            <i style={{ background: "#2a9d8f" }} />
            Solid / remodeled
            <span>70–84</span>
          </li>
          <li>
            <i style={{ background: "#c87832" }} />
            Soft / dated
            <span>40–54</span>
          </li>
          <li>
            <i style={{ background: "#b03a2e" }} />
            Fixer / project
            <span>&lt;40</span>
          </li>
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
