import { useEffect, useMemo, useState } from "react";
import { CriteriaPanel } from "./components/CriteriaPanel";
import { ListingCard } from "./components/ListingCard";
import { LivabilityScatter } from "./components/LivabilityScatter";
import {
  MapView,
  type LivabilityOverlay,
} from "./components/MapView";
import { SafetyLegend } from "./components/SafetyLegend";
import { DEFAULT_ANCHORS, DEFAULT_CRITERIA } from "./data/anchors";
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
import { scoreListing } from "./lib/score";
import type { Anchor, Criteria } from "./types";

export default function App() {
  const [criteria, setCriteria] = useState<Criteria>(DEFAULT_CRITERIA);
  const [anchors, setAnchors] = useState<Anchor[]>(() =>
    DEFAULT_ANCHORS.map((a) => ({ ...a })),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNoise, setShowNoise] = useState(false);
  const [showIsochrones, setShowIsochrones] = useState(true);
  /** Default on: show every home that fits the selected criteria */
  const [showFlaggedOnly, setShowFlaggedOnly] = useState(true);
  /** Overlays off by default so home pins stay the primary map signal */
  const [livabilityOverlay, setLivabilityOverlay] =
    useState<LivabilityOverlay>("off");
  const [orsKey, setOrsKey] = useState(() => getStoredOrsKey());

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
    livabilityOverlay === "safety",
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
    const polysReady =
      isoMode === "ors" || isoMode === "valhalla" ? isochrones : undefined;
    return listings
      .map((l) =>
        scoreListing(
          l,
          criteria,
          anchors,
          polysReady,
          undefined,
          livabilityById[l.id],
          viewshedById[l.id],
        ),
      )
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

  const matches = scored.filter((l) => l.flagged);
  const visible = showFlaggedOnly ? matches : scored;
  const flaggedCount = matches.length;
  const top = matches[0] ?? scored[0];
  const selected = scored.find((l) => l.id === selectedId) ?? top;

  return (
    <div className="app">
      <CriteriaPanel
        criteria={criteria}
        anchors={anchors}
        onCriteriaChange={setCriteria}
        onAnchorsChange={setAnchors}
        flaggedCount={flaggedCount}
        totalCount={scored.length}
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
                checked={showNoise}
                onChange={(e) => setShowNoise(e.target.checked)}
              />
              LAX noise
            </label>
            <label className="toolbar-select">
              Livability
              <select
                value={livabilityOverlay}
                onChange={(e) =>
                  setLivabilityOverlay(e.target.value as LivabilityOverlay)
                }
              >
                <option value="off">Off</option>
                <option value="safety">Safety (tracts)</option>
                <option value="walk">Walk map</option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={showFlaggedOnly}
                onChange={(e) => setShowFlaggedOnly(e.target.checked)}
              />
              Matches only
            </label>
          </div>
          {isoMode === "loading" && (
            <div className="map-overlay">
              <p>{isoProgress || "Computing Valhalla isochrones…"}</p>
              <p className="map-overlay-sub">
                Real drive-time polygons via Valhalla (same as SimpleMapLab)
              </p>
            </div>
          )}
          {livabilityOverlay === "safety" && <SafetyLegend />}
          <MapView
            anchors={anchors}
            isochrones={isochrones}
            listings={scored}
            focusListings={showFlaggedOnly ? matches : scored}
            selectedId={selectedId}
            onSelect={setSelectedId}
            showNoise={showNoise}
            showIsochrones={showIsochrones && isoMode !== "loading"}
            livabilityOverlay={livabilityOverlay}
            safetyTracts={safetyTracts}
            dimNonMatches={showFlaggedOnly}
          />
        </div>

        <section className="results">
          <div className="results-top">
            <LivabilityScatter
              listings={scored}
              criteria={criteria}
              selectedId={selected?.id ?? null}
              onSelect={setSelectedId}
            />
            {selected && (
              <div className="pick liv-pick">
                <p className="eyebrow">
                  {selected.flagged ? "Best match — go see it" : "Selected home"}
                </p>
                <h2>
                  {selected.address} · $
                  {(selected.price / 1e6).toFixed(2)}M
                </h2>
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
                {selected.oceanViewshed && (
                  <p
                    className="pick-meta subtle"
                    title="Share of rays toward the Pacific / sunset sky that clear terrain and nearby buildings. Not about house facing."
                  >
                    Ocean viewshed {selected.oceanViewshed.score100}/100
                    {selected.oceanViewshed.score100 >=
                    criteria.minOceanViewshed
                      ? ` · meets min ${criteria.minOceanViewshed}/100`
                      : ` · below min ${criteria.minOceanViewshed}/100`}
                    {" · "}
                    {selected.oceanViewshed.clearRays}/
                    {selected.oceanViewshed.testedRays} rays · ~
                    {selected.oceanViewshed.nearestCoastKm.toFixed(1)} km to
                    coast
                  </p>
                )}
                <p className="pick-meta subtle">
                  {livProgress ?? ""}
                  {livProgress && viewshedProgress ? " · " : ""}
                  {viewshedProgress ?? ""}
                </p>
              </div>
            )}
          </div>

          {loading && <p className="status">Loading listings…</p>}
          {error && <p className="status error">Failed to load: {error}</p>}
          {!loading && !error && (
            <p className="results-count">
              {showFlaggedOnly
                ? `${flaggedCount} home${flaggedCount === 1 ? "" : "s"} fit your criteria`
                : `Showing all ${visible.length} active homes (${flaggedCount} match)`}
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
