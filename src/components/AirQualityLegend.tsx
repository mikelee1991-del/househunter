import { airQualityColor } from "../lib/airQuality";

const BANDS = [
  { label: "Lower burden", min: 70, color: airQualityColor(80) },
  { label: "Moderate", min: 50, color: airQualityColor(55) },
  { label: "Elevated", min: 35, color: airQualityColor(40) },
  { label: "High", min: 20, color: airQualityColor(25) },
  { label: "Very high", min: 0, color: airQualityColor(10) },
];

export function AirQualityLegend() {
  return (
    <div className="safety-legend air-legend">
      <strong>Air / pollution burden</strong>
      <p>CalEnviroScreen 4.0 — higher score = cleaner relative air</p>
      <ul>
        {BANDS.map((b) => (
          <li key={b.label}>
            <i style={{ background: b.color }} />
            {b.label}
            <span>≥{b.min}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
