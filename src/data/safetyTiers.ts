/** Discrete 5-class safety legend for tract choropleth. */

export interface SafetyTier {
  tier: 1 | 2 | 3 | 4 | 5;
  label: string;
  scoreBand: string;
  color: string;
}

export const SAFETY_TIERS: SafetyTier[] = [
  { tier: 1, label: "Very low", scoreBand: "90–100", color: "#0b6e4f" },
  { tier: 2, label: "Low", scoreBand: "80–89", color: "#3d8b66" },
  { tier: 3, label: "Moderate-low", scoreBand: "70–79", color: "#8a9a6a" },
  { tier: 4, label: "Moderate", scoreBand: "60–69", color: "#c4a35a" },
  { tier: 5, label: "Elevated", scoreBand: "<60", color: "#b85c38" },
];

export function tierColor(tier: number): string {
  return SAFETY_TIERS.find((t) => t.tier === tier)?.color ?? "#9a9a9a";
}

export function scoreToTier(score: number): SafetyTier {
  if (score >= 90) return SAFETY_TIERS[0];
  if (score >= 80) return SAFETY_TIERS[1];
  if (score >= 70) return SAFETY_TIERS[2];
  if (score >= 60) return SAFETY_TIERS[3];
  return SAFETY_TIERS[4];
}

export interface SafetyTractProps {
  geoid: string;
  tract: string;
  place: string;
  safetyScore: number;
  tier: number;
  tierLabel: string;
  scoreBand: string;
}

export interface SafetyTractsFile {
  type: "FeatureCollection";
  generatedAt: string;
  source: string;
  legend: { tier: number; label: string; color: string }[];
  features: {
    type: "Feature";
    properties: SafetyTractProps;
    geometry: {
      type: "Polygon" | "MultiPolygon";
      coordinates: number[][][] | number[][][][];
    };
  }[];
}
