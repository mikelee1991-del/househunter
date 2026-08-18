export function SuitabilityLegend() {
  return (
    <div className="suitability-legend">
      <strong>Best areas (address + context)</strong>
      <p>
        Bright dots = each listing’s overall fit at that address (~40 m). Faint
        wash = continuous drive / noise / livability context between homes.
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
