export function SuitabilityLegend() {
  return (
    <div className="suitability-legend">
      <strong>Best areas (address + context)</strong>
      <p>
        Bright halos = each listing’s overall fit (address-local; ~40 m when
        zoomed in). Faint wash = drive / noise / livability context between homes.
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
