import {
  OCEAN_VIEWSHED_EXPLAIN,
  SUNSET_VIEWSHED_EXPLAIN,
  viewshedBandLabel,
} from "../lib/oceanViewshed";
import { airQualityBand } from "../lib/airQuality";
import { walkBandLabel } from "../data/neighborhoodLivability";

interface Props {
  safetyScore: number;
  safetyLabel: string;
  walkIndex: number;
  walkSource: "epa" | "neighborhood-fallback";
  minSafety: number;
  walkMin: number;
  walkMax: number;
  airQualityScore?: number | null;
  minAirQualityScore?: number;
  /** GIS ocean water viewshed 0–100 when computed */
  oceanViewshedScore?: number;
  oceanViewshedHasView?: boolean;
  minOceanViewshed?: number;
  /** GIS due-west sunset viewshed 0–100 */
  sunsetViewshedScore?: number;
  sunsetViewshedHasView?: boolean;
  minSunsetViewshed?: number;
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
  airQualityScore,
  minAirQualityScore = 0,
  oceanViewshedScore,
  oceanViewshedHasView,
  minOceanViewshed = 0,
  sunsetViewshedScore,
  sunsetViewshedHasView,
  minSunsetViewshed = 0,
  compact,
}: Props) {
  const safetyOk = safetyScore >= minSafety;
  const walkOk = walkIndex >= walkMin && walkIndex <= walkMax;
  const walkLeft = (walkMin / 20) * 100;
  const walkWidth = ((walkMax - walkMin) / 20) * 100;
  const oceanOk =
    oceanViewshedHasView === true ||
    (oceanViewshedScore != null &&
      (minOceanViewshed <= 0 || oceanViewshedScore >= minOceanViewshed));
  const showOcean = oceanViewshedScore != null;
  const oceanBandLeft = Math.min(100, Math.max(0, minOceanViewshed));
  const sunsetOk =
    sunsetViewshedHasView === true ||
    (sunsetViewshedScore != null &&
      (minSunsetViewshed <= 0 || sunsetViewshedScore >= minSunsetViewshed));
  const showSunset = sunsetViewshedScore != null;
  const sunsetBandLeft = Math.min(100, Math.max(0, minSunsetViewshed));
  const showAir = airQualityScore != null && Number.isFinite(airQualityScore);
  const airOk =
    minAirQualityScore <= 0 ||
    (airQualityScore != null && airQualityScore >= minAirQualityScore);
  const airBandLeft = Math.min(100, Math.max(0, minAirQualityScore));

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

      {showAir && (
        <div className="liv-row">
          <div className="liv-head">
            <span>Air quality</span>
            <strong className={airOk ? "ok" : "bad"}>
              {airQualityScore} · {airQualityBand(airQualityScore).toLowerCase()}
            </strong>
          </div>
          <div className="liv-track" aria-hidden>
            {minAirQualityScore > 0 && (
              <div
                className="liv-band"
                style={{ left: `${airBandLeft}%`, right: 0 }}
              />
            )}
            <div
              className={`liv-thumb ${airOk ? "ok" : "bad"}`}
              style={{ left: `${Math.min(100, airQualityScore)}%` }}
            />
          </div>
          <p className="liv-cap">
            CalEnviroScreen (higher = lower pollution burden)
            {minAirQualityScore > 0
              ? ` · your min ${minAirQualityScore}`
              : " · filter off"}
          </p>
        </div>
      )}

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

      {showOcean && (
        <div className="liv-row">
          <div className="liv-head">
            <span>Ocean view</span>
            <strong className={oceanOk ? "ok" : "bad"}>
              {oceanViewshedScore}/100 ·{" "}
              {viewshedBandLabel(oceanViewshedScore ?? 0).toLowerCase()}
            </strong>
          </div>
          <div className="liv-track" aria-hidden>
            {minOceanViewshed > 0 && (
              <div
                className="liv-band"
                style={{ left: `${oceanBandLeft}%`, right: 0 }}
              />
            )}
            <div
              className={`liv-thumb ${oceanOk ? "ok" : "bad"}`}
              style={{ left: `${Math.min(100, oceanViewshedScore)}%` }}
            />
          </div>
          <p className="liv-cap" title={OCEAN_VIEWSHED_EXPLAIN}>
            Clear LOS to Pacific water.
            {minOceanViewshed > 0
              ? ` Your min ${minOceanViewshed}/100 · ${viewshedBandLabel(minOceanViewshed).toLowerCase()}`
              : " Filter off"}
          </p>
        </div>
      )}

      {showSunset && (
        <div className="liv-row">
          <div className="liv-head">
            <span>Sunset view</span>
            <strong className={sunsetOk ? "ok" : "bad"}>
              {sunsetViewshedScore}/100 ·{" "}
              {viewshedBandLabel(sunsetViewshedScore ?? 0).toLowerCase()}
            </strong>
          </div>
          <div className="liv-track" aria-hidden>
            {minSunsetViewshed > 0 && (
              <div
                className="liv-band"
                style={{ left: `${sunsetBandLeft}%`, right: 0 }}
              />
            )}
            <div
              className={`liv-thumb ${sunsetOk ? "ok" : "bad"}`}
              style={{ left: `${Math.min(100, sunsetViewshedScore)}%` }}
            />
          </div>
          <p className="liv-cap" title={SUNSET_VIEWSHED_EXPLAIN}>
            Due-west horizon (inland hills OK).
            {minSunsetViewshed > 0
              ? ` Your min ${minSunsetViewshed}/100 · ${viewshedBandLabel(minSunsetViewshed).toLowerCase()}`
              : " Filter off"}
          </p>
        </div>
      )}
    </div>
  );
}
