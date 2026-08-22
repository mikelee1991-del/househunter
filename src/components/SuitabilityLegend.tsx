export function SuitabilityLegend() {
  return (
    <div className="suitability-legend">
      <strong>Best areas (per address)</strong>
      <p>
        Peaks at listing addresses using your weighted mix of drive, quiet,
        safety, walk, ocean view, sunset view, and air (see{" "}
        <em>Best areas weights</em> in the criteria panel). Beachfront water
        views and inland hill sunsets are weighted separately.
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
