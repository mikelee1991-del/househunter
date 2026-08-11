export function SuitabilityLegend() {
  return (
    <div className="suitability-legend">
      <strong>Best areas</strong>
      <p>
        Blended map of drive times, LAX noise, safety, walk band, and ocean /
        sunset openness — not individual home prices or beds
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
