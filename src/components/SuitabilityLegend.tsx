export function SuitabilityLegend() {
  return (
    <div className="suitability-legend">
      <strong>Best areas (per address)</strong>
      <p>
        Peaks at listing addresses — drive, noise, safety, walk, ocean/sunset
        GIS, and air at that lot. Beachfront open-wedge homes (e.g. The Strand)
        should read brightest; blocked lots stay faint or hidden.
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
