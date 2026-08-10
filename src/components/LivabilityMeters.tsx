import {
  OCEAN_VIEWSHED_EXPLAIN,
  viewshedBandLabel,
} from "../lib/oceanViewshed";
import { walkBandLabel } from "../data/neighborhoodLivability";

interface Props {
  safetyScore: number;
  safetyLabel: string;
  walkIndex: number;
  walkSource: "epa" | "neighborhood-fallback";
  minSafety: number;
  walkMin: number;
  walkMax: number;
  /** GIS ocean viewshed 0–100 when computed */
  oceanViewshedScore?: number;
  oceanViewshedHasView?: boolean;
  minOceanViewshed?: number;
  compact?: boolean;
}

export function LivabilityMeters({
  safetyScore,
  safetyLabel,
  walkIndex,
  walkSource,
  minSafety,
  walkMin,
  walkMax,
  oceanViewshedScore,
  oceanViewshedHasView,
  minOceanViewshed = 35,
  compact,
}: Props) {
  const safetyOk = safetyScore >= minSafety;
  const walkOk = walkIndex >= walkMin && walkIndex <= walkMax;
  const walkLeft = (walkMin / 20) * 100;
  const walkWidth = ((walkMax - walkMin) / 20) * 100;
  const viewOk =
    oceanViewshedHasView === true ||
    (oceanViewshedScore != null &&
      oceanViewshedScore >= minOceanViewshed);
  const showView = oceanViewshedScore != null;
  const viewBandLeft = Math.min(100, Math.max(0, minOceanViewshed));

  return (
    <div className={`liv-meters ${compact ? "compact" : ""}`}>
      <div className="liv-row">
        <div className="liv-head">
          <span>Safety</span>
          <strong className={safetyOk ? "ok" : "bad"}>
            {safetyScore} · {safetyLabel}
          </strong>
        </div>
        <div className="liv-track" aria-hidden>
          <div className="liv-band" style={{ left: `${minSafety}%`, right: 0 }} />
          <div
            className={`liv-thumb ${safetyOk ? "ok" : "bad"}`}
            style={{ left: `${Math.min(100, safetyScore)}%` }}
          />
        </div>
        <p className="liv-cap">Higher = lower relative neighborhood crime</p>
      </div>

      <div className="liv-row">
        <div className="liv-head">
          <span>Walkability</span>
          <strong className={walkOk ? "ok" : "bad"}>
            {walkIndex.toFixed(1)} · {walkBandLabel(walkIndex)}
          </strong>
        </div>
        <div className="liv-track" aria-hidden>
          <div
            className="liv-band walk"
            style={{ left: `${walkLeft}%`, width: `${walkWidth}%` }}
          />
          <div
            className={`liv-thumb ${walkOk ? "ok" : "bad"}`}
            style={{ left: `${(walkIndex / 20) * 100}%` }}
          />
        </div>
        <p className="liv-cap">
          EPA index 1–20
          {walkSource === "epa" ? " (block group)" : " (neighborhood estimate)"}
          {" · "}your band {walkMin.toFixed(1)}–{walkMax.toFixed(1)}
        </p>
      </div>

      {showView && (
        <div className="liv-row">
          <div className="liv-head">
            <span>Ocean / sunset openness</span>
            <strong className={viewOk ? "ok" : "bad"}>
              {oceanViewshedScore}/100 ·{" "}
              {viewshedBandLabel(oceanViewshedScore ?? 0).toLowerCase()}
            </strong>
          </div>
          <div className="liv-track" aria-hidden>
            <div
              className="liv-band"
              style={{ left: `${viewBandLeft}%`, right: 0 }}
            />
            <div
              className={`liv-thumb ${viewOk ? "ok" : "bad"}`}
              style={{ left: `${Math.min(100, oceanViewshedScore)}%` }}
            />
          </div>
          <p className="liv-cap" title={OCEAN_VIEWSHED_EXPLAIN}>
            Clear share of the sunset/Pacific wedge (hills + nearby buildings).
            Your min {minOceanViewshed}/100
            {minOceanViewshed === 0
              ? " · filter off"
              : ` · ${viewshedBandLabel(minOceanViewshed).toLowerCase()}`}
          </p>
        </div>
      )}
    </div>
  );
}
