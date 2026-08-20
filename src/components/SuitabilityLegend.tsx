export function SuitabilityLegend() {
  return (
    <div className="suitability-legend">
      <strong>Best areas (region)</strong>
      <p>
        Continuous blended fit across the commute-reachable region (union of
        isochrones) — drive, noise, safety, walk, ocean openness, air. Not
        limited to for-sale or matching addresses; pins are inventory only.
      </p>
      <div
        className="suitability-legend-ramp"
        aria-hidden
        title="Weak → strong fit"
      />
      <div className="suitability-legend-labels">
        <span>Weaker</span>
        <span>Stronger</span>
      </div>
    </div>
  );
}
