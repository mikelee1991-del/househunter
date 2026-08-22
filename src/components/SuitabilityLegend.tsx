export function SuitabilityLegend() {
  return (
    <div className="suitability-legend">
      <strong>Best areas (per address)</strong>
      <p>
        Each disc is one listing’s location fit (drive, noise, safety, walk,
        ocean/sunset GIS, air). Larger / brighter = better — beachfront
        open-wedge homes like The Strand should pop; blocked lots stay small or
        hidden.
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
