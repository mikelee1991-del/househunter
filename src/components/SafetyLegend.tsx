import { SAFETY_TIERS } from "../data/safetyTiers";

export function SafetyLegend() {
  return (
    <div className="safety-legend">
      <strong>Safety by census tract</strong>
      <p>Discrete 5-class relative index — not address-level crime</p>
      <ul>
        {SAFETY_TIERS.map((t) => (
          <li key={t.tier}>
            <i style={{ background: t.color }} />
            {t.label}
            <span>{t.scoreBand}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
