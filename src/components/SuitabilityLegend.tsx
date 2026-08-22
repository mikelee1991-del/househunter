export function SuitabilityLegend() {
  return (
    <div className="suitability-legend">
      <strong>Best areas (per address)</strong>
      <p>
        Peaks at listing addresses using your weighted mix of drive, quiet,
        safety, walk, ocean/sunset GIS, and air (see <em>Best areas weights</em>{" "}
        in the criteria panel). Beachfront open-wedge homes should read bright
        when ocean weight is high.
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
