export function SuitabilityLegend() {
  return (
    <div className="suitability-legend">
      <strong>Best areas</strong>
      <p>
        Continuous fit wash (drive, quiet, safety, walk, ocean, sunset, air)
        clipped to your isochrones, with brighter peaks at strong listing
        addresses. Adjust weights in the criteria panel.
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
