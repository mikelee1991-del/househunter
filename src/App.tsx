import { useEffect, useMemo, useState } from "react";
import { CriteriaPanel } from "./components/CriteriaPanel";
import { ListingCard } from "./components/ListingCard";
import { LivabilityScatter } from "./components/LivabilityScatter";
import { MapView } from "./components/MapView";
import {
  MetricLayerLegend,
  MetricLayerTabs,
} from "./components/MetricLayerLegend";
import { ParameterScoreChart } from "./components/ParameterScoreChart";
import { SuitabilityLegend } from "./components/SuitabilityLegend";
import { DEFAULT_ANCHORS, DEFAULT_CRITERIA } from "./data/anchors";
import { useAirQualityTracts } from "./hooks/useAirQualityTracts";
import { useIsochrones } from "./hooks/useIsochrones";
import { useListings } from "./hooks/useListings";
import { useLivability } from "./hooks/useLivability";
import { useOceanViewshed } from "./hooks/useOceanViewshed";
import { useSafetyTracts } from "./hooks/useSafetyTracts";
import {
  getStoredOrsKey,
  setStoredOrsKey,
} from "./lib/isochrone";
import { isPropertyListingUrl } from "./lib/listingUrl";
import type { MapMetricLayer } from "./lib/mapMetrics";
import { scoreListing } from "./lib/score";
import {
  buildPrefs,
  clearStoredPrefs,
  resolveInitialPrefs,
  writeStoredPrefs,
} from "./lib/userPrefs";
import type { Anchor, Criteria } from "./types";

export default function App() {
  const [prefsReady, setPrefsReady] = useState(false);
  const [criteria, setCriteria] = useState<Criteria>(DEFAULT_CRITERIA);
  const [anchors, setAnchors] = useState<Anchor[]>(() =>
    DEFAULT_ANCHORS.map((a) => ({ ...a })),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showIsochrones, setShowIsochrones] = useState(true);
  /** Default on: show every home that fits the selected criteria */
  const [showFlaggedOnly, setShowFlaggedOnly] = useState(true);
  /** One metric at a time — default Best areas so “where to look” is obvious */
  const [metricLayer, setMetricLayer] =
    useState<MapMetricLayer>("suitability");
  const [orsKey, setOrsKey] = useState(() => getStoredOrsKey());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const prefs = await resolveInitialPrefs();
      if (cancelled) return;
      setCriteria(prefs.criteria);
      setAnchors(prefs.anchors.map((a) => ({ ...a })));
      setPrefsReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!prefsReady) return;
    writeStoredPrefs(buildPrefs(criteria, anchors));
  }, [criteria, anchors, prefsReady]);

  const { data, error, loading } = useListings();
  const listings = data?.listings ?? [];
  const {
    byId: livabilityById,
    progress: livProgress,
  } = useLivability(listings);
  const {
    byId: viewshedById,
    progress: viewshedProgress,
  } = useOceanViewshed(listings, true);
  const { data: safetyTracts } = useSafetyTracts(
    metricLayer === "safety" || metricLayer === "suitability",
  );
  const { data: airTracts } = useAirQualityTracts(
    metricLayer === "air" || metricLayer === "suitability",
  );
  const {
    isochrones,
    mode: isoMode,
    progress: isoProgress,
    error: isoError,
  } = useIsochrones(anchors, criteria, orsKey);

  useEffect(() => {
    setStoredOrsKey(orsKey);
  }, [orsKey]);

  const scored = useMemo(() => {
    // Prefer live isochrone polygons when ready; otherwise use precomputed
    // / approx drive minutes so matches paint immediately.
    const polysReady =
      isoMode === "ors" || isoMode === "valhalla" ? isochrones : undefined;
    return listings
      .map((l) => {
        const livability = livabilityById[l.id] ??
          (l.analysis
            ? {
                safetyScore: l.analysis.safetyScore,
                safetyLabel: l.analysis.safetyLabel,
                walkIndex: l.analysis.walkIndex,
                walkSource: l.analysis.walkSource,
              }
            : undefined);
        const viewshed =
          viewshedById[l.id] ??
          (l.analysis?.oceanViewshed
            ? {
                ...l.analysis.oceanViewshed,
                buildingHits: 0,
                eyeHeightM: 5.5,
                facingUsedDeg: 270,
                method: "dem-los+osm-buildings" as const,
              }
            : undefined);
        return scoreListing(
          l,
          criteria,
          anchors,
          polysReady,
          l.analysis?.driveMinutes,
          livability,
          viewshed,
        );
      })
      .sort((a, b) => {
        if (a.flagged !== b.flagged) return a.flagged ? -1 : 1;
        return b.score - a.score;
      });
  }, [
    listings,
    criteria,
    anchors,
    isochrones,
    isoMode,
    livabilityById,
    viewshedById,
  ]);

  // Never show over-budget / under-beds / incomplete homes in map or list
  const eligible = scored.filter((l) => !l.coreRejected);
  const matches = eligible.filter((l) => l.flagged);
  const visible = showFlaggedOnly ? matches : eligible;
  const flaggedCount = matches.length;
  const top = matches[0] ?? eligible[0] ?? scored[0];
  const selected =
    visible.find((l) => l.id === selectedId) ??
    eligible.find((l) => l.id === selectedId) ??
    top;

  function applyImportedPrefs(next: { criteria: Criteria; anchors: Anchor[] }) {
    setCriteria(next.criteria);
    setAnchors(next.anchors.map((a) => ({ ...a })));
  }

  function resetPrefsToPublicDefaults() {
    clearStoredPrefs();
    setCriteria({
      ...DEFAULT_CRITERIA,
      driveMinutes: { ...DEFAULT_CRITERIA.driveMinutes },
      neighborhoods: [],
    });
    setAnchors(DEFAULT_ANCHORS.map((a) => ({ ...a })));
  }

  return (
    <div className="app">
      <CriteriaPanel
        criteria={criteria}
        anchors={anchors}
        onCriteriaChange={setCriteria}
        onAnchorsChange={setAnchors}
        onImportPrefs={applyImportedPrefs}
        onResetPrefs={resetPrefsToPublicDefaults}
        flaggedCount={flaggedCount}
        totalCount={eligible.length}
        isoMode={isoMode}
        isoProgress={isoProgress}
        isoError={isoError}
        orsKey={orsKey}
        onOrsKeyChange={setOrsKey}
        generatedAt={data?.generatedAt}
        sources={data?.sources}
      />

      <main className="main">
        <div className="map-shell">
          <div className="map-toolbar">
            <label>
              <input
                type="checkbox"
                checked={showIsochrones}
                onChange={(e) => setShowIsochrones(e.target.checked)}
              />
              Isochrones
            </label>
            <label>
              <input
                type="checkbox"
                checked={showFlaggedOnly}
                onChange={(e) => setShowFlaggedOnly(e.target.checked)}
              />
              Matches only
            </label>
            <span className="toolbar-label">Metric</span>
            <MetricLayerTabs value={metricLayer} onChange={setMetricLayer} />
          </div>
          {isoMode === "loading" && (
            <div className="map-overlay">
              <p>{isoProgress || "Computing Valhalla isochrones…"}</p>
              <p className="map-overlay-sub">
                Real drive-time polygons via Valhalla (same as SimpleMapLab)
              </p>
            </div>
          )}
          <MetricLayerLegend layer={metricLayer} />
          {metricLayer === "suitability" && <SuitabilityLegend />}
          <MapView
            anchors={anchors}
            isochrones={isochrones}
            listings={visible}
            allListings={listings}
            criteria={criteria}
            selectedId={selectedId}
            onSelect={setSelectedId}
            showIsochrones={showIsochrones && isoMode !== "loading"}
            metricLayer={metricLayer}
            safetyTracts={safetyTracts}
            airTracts={airTracts}
          />
        </div>

        <section className="results">
          <div className="results-top">
            <LivabilityScatter
              listings={eligible}
              criteria={criteria}
              selectedId={selected?.id ?? null}
              onSelect={setSelectedId}
            />
            {selected && (
              <div className="pick liv-pick">
                <div
                  className="pick-photo"
                  style={
                    selected.photos[0]
                      ? { backgroundImage: `url(${selected.photos[0]})` }
                      : undefined
                  }
                  role={selected.photos[0] ? "img" : undefined}
                  aria-label={
                    selected.photos[0]
                      ? `Photo of ${selected.address}`
                      : undefined
                  }
                >
                  {selected.status === "pending" && (
                    <span className="status-badge pending-badge">
                      Pending
                    </span>
                  )}
                  {selected.flagged && (
                    <span className="flag-badge">Match</span>
                  )}
                  <span className="price-badge">
                    ${(selected.price / 1_000_000).toFixed(2)}M
                  </span>
                </div>
                <div className="pick-body">
                  <p className="eyebrow">
                    {selected.status === "pending"
                      ? "Pending sale — under contract"
                      : selected.flagged
                        ? "Best match — go see it"
                        : "Selected home"}
                  </p>
                  <h2>{selected.address}</h2>
                  {selected.status === "pending" && (
                    <p className="pick-pending">
                      This home is in the process of being sold
                    </p>
                  )}
                  <p className="pick-meta">
                    {selected.neighborhood} · {selected.beds} bd ·{" "}
                    {selected.baths} ba · {selected.sqft.toLocaleString()} sqft
                  </p>
                  {isPropertyListingUrl(selected.sourceUrl) ? (
                    <a
                      className="listing-cta listing-cta-lg"
                      href={selected.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View listing
                    </a>
                  ) : (
                    <p className="listing-cta listing-cta-lg listing-cta-disabled">
                      No live listing link
                    </p>
                  )}
                  <ParameterScoreChart
                    listing={selected}
                    criteria={criteria}
                    anchors={anchors}
                  />
                  <p className="pick-meta subtle">
                    {livProgress ?? ""}
                    {livProgress && viewshedProgress ? " · " : ""}
                    {viewshedProgress ?? ""}
                  </p>
                </div>
              </div>
            )}
          </div>

          {loading && <p className="status">Loading listings…</p>}
          {error && <p className="status error">Failed to load: {error}</p>}
          {!loading && !error && (
            <p className="results-count">
              {showFlaggedOnly
                ? `${flaggedCount} home${flaggedCount === 1 ? "" : "s"} fit your criteria`
                : `Showing ${visible.length} in budget / size (${flaggedCount} full match)`}
            </p>
          )}
          {!loading && !error && visible.length === 0 && (
            <p className="status">
              No homes match the current criteria. Loosen a slider (viewshed,
              budget, drive times) or uncheck “Matches only.”
            </p>
          )}

          <div className="listing-grid">
            {visible.map((l) => (
              <ListingCard
                key={l.id}
                listing={l}
                criteria={criteria}
                selected={l.id === selectedId}
                onSelect={() => setSelectedId(l.id)}
              />
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
