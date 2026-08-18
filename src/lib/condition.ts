/**
 * Condition / renovation screening from listing text (+ yearBuilt).
 *
 * MLS blurbs are noisy: “renovated” and “fixer” can both appear, and “as-is”
 * is often legal boilerplate. We score signals, extract a renovation year
 * when present, and flag likely fixer-uppers for criteria gating.
 *
 * Optional photo vision (OPENAI_API_KEY) can refine during ingest later;
 * the UI path stays free and offline via this text model.
 */

export type ConditionSource = "text" | "text+year" | "vision";

export interface ConditionAssessment {
  /** 0–100 move-in-ready / updated feel (higher = better for non-fixer buyers) */
  score100: number;
  /** Strong fixer / TLC / contractor language */
  isFixer: boolean;
  /** Year mentioned as renovated/remodeled/updated, if any */
  renovatedYear: number | null;
  yearBuilt: number | null;
  confidence: "high" | "medium" | "low";
  source: ConditionSource;
  summary: string;
  signals: string[];
}

const YEAR_RE =
  /\b(?:renovat(?:ed|ion)|remodel(?:ed|ing)?|fully\s+updated|updated|rebuilt|restored)\b[^.]{0,40}\b((?:19|20)\d{2})\b/i;
const YEAR_RE_ALT =
  /\b((?:19|20)\d{2})\b[^.]{0,24}\b(?:renovat(?:ed|ion)|remodel(?:ed)?|update)\b/i;

const FIXER_PATTERNS: Array<{ re: RegExp; label: string; weight: number }> = [
  { re: /\bfixer(?:-|\s*)uppers?\b/i, label: "fixer-upper", weight: 40 },
  { re: /\bfixer\b/i, label: "fixer", weight: 35 },
  { re: /\bhandyman\s+special\b/i, label: "handyman special", weight: 35 },
  { re: /\bdiamond\s+in\s+the\s+rough\b/i, label: "diamond in the rough", weight: 30 },
  { re: /\bneeds?\s+(?:some\s+)?TLC\b/i, label: "needs TLC", weight: 30 },
  { re: /\bextra\s+TLC\b/i, label: "extra TLC", weight: 28 },
  { re: /\bcosmetic\s+fixer\b/i, label: "cosmetic fixer", weight: 32 },
  {
    re: /\b(?:bring|needs?)\s+your\s+contractor\b/i,
    label: "bring your contractor",
    weight: 30,
  },
  {
    re: /\bsold\s+(?:strictly\s+)?as[-\s]?is\b|\bas[-\s]?is\s*(?:condition|sale|due to)/i,
    label: "sold as-is",
    weight: 22,
  },
  {
    re: /\bneeds?\s+(?:significant\s+|major\s+|substantial\s+)?(?:work|repairs?|updating|renovation)\b/i,
    label: "needs work/repairs",
    weight: 28,
  },
  {
    re: /\bdeferred\s+maintenance\b/i,
    label: "deferred maintenance",
    weight: 26,
  },
  {
    re: /\binvestor\s+(?:special|opportunity)\b/i,
    label: "investor special",
    weight: 24,
  },
  {
    re: /\bopen\s+canvas\b|\bclean\s+slate\b|\bblank\s+canvas\b/i,
    label: "blank canvas",
    weight: 18,
  },
  {
    re: /\boriginal\s+condition\b|\bin\s+need\s+of\s+updating\b/i,
    label: "needs updating",
    weight: 20,
  },
  {
    re: /\belbow\s+grease\b/i,
    label: "elbow grease",
    weight: 22,
  },
];

const POSITIVE_PATTERNS: Array<{ re: RegExp; label: string; weight: number }> = [
  {
    re: /\b(?:extensively|fully|completely|meticulously|tastefully)\s+(?:renovat(?:ed|ion)|remodel(?:ed)?|updated)\b/i,
    label: "fully renovated",
    weight: 28,
  },
  {
    re: /\brenovat(?:ed|ion)\b/i,
    label: "renovated",
    weight: 16,
  },
  {
    re: /\bremodel(?:ed|ing)?\b/i,
    label: "remodeled",
    weight: 14,
  },
  {
    re: /\bturnkey\b|\bmove[-\s]?in\s+ready\b/i,
    label: "turnkey / move-in ready",
    weight: 22,
  },
  {
    re: /\bbrand[-\s]?new\s+(?:kitchen|bath|home|construction)\b/i,
    label: "brand-new finishes",
    weight: 18,
  },
  {
    re: /\bnewly\s+(?:renovated|remodeled|updated|built)\b/i,
    label: "newly updated",
    weight: 18,
  },
  {
    re: /\bpristine\b|\bimpeccable\b|\bimmaculate\b/i,
    label: "pristine condition",
    weight: 12,
  },
  {
    re: /\bnew\s+construction\b|\bbuilt\s+in\s+20(?:1|2)\d\b/i,
    label: "newer build",
    weight: 20,
  },
];

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function extractRenovatedYear(text: string): number | null {
  const now = new Date().getFullYear();
  for (const re of [YEAR_RE, YEAR_RE_ALT]) {
    const m = text.match(re);
    if (!m) continue;
    const y = Number(m[1]);
    if (y >= 1950 && y <= now + 1) return y;
  }
  return null;
}

export function analyzeCondition(input: {
  description?: string;
  address?: string;
  yearBuilt?: number;
}): ConditionAssessment {
  const text = `${input.description || ""} ${input.address || ""}`;
  const yearBuilt =
    typeof input.yearBuilt === "number" && input.yearBuilt > 1800
      ? input.yearBuilt
      : null;
  const renovatedYear = extractRenovatedYear(text);
  const signals: string[] = [];
  let fixerWeight = 0;
  let positiveWeight = 0;

  for (const p of FIXER_PATTERNS) {
    if (p.re.test(text)) {
      signals.push(`− ${p.label}`);
      fixerWeight += p.weight;
    }
  }
  for (const p of POSITIVE_PATTERNS) {
    if (p.re.test(text)) {
      signals.push(`+ ${p.label}`);
      positiveWeight += p.weight;
    }
  }

  // Age pressure when no renovation story
  const nowY = new Date().getFullYear();
  let agePenalty = 0;
  if (yearBuilt != null && renovatedYear == null && positiveWeight < 12) {
    const age = nowY - yearBuilt;
    if (age >= 50) agePenalty = 18;
    else if (age >= 35) agePenalty = 10;
    else if (age >= 25) agePenalty = 5;
    if (agePenalty) signals.push(`− older build (${yearBuilt})`);
  }
  if (renovatedYear != null) {
    const ago = nowY - renovatedYear;
    signals.push(`+ renovated ~${renovatedYear}`);
    if (ago <= 5) positiveWeight += 18;
    else if (ago <= 12) positiveWeight += 12;
    else if (ago <= 20) positiveWeight += 6;
  }

  // “Enjoyed as-is” / “whether as-is” is not a distress sale
  if (
    /\b(?:enjoy(?:ed)?|live|whether)\s+as[-\s]?is\b/i.test(text) &&
    !/\bsold\s+as[-\s]?is\b/i.test(text)
  ) {
    fixerWeight = Math.max(0, fixerWeight - 18);
    signals.push("· benign as-is phrasing");
  }

  let score100 = 62 + positiveWeight - fixerWeight - agePenalty;
  score100 = clamp(Math.round(score100), 0, 100);

  const isFixer =
    fixerWeight >= 28 ||
    (fixerWeight >= 18 && positiveWeight < fixerWeight) ||
    score100 < 40;

  let confidence: ConditionAssessment["confidence"] = "low";
  if (fixerWeight + positiveWeight >= 40 || renovatedYear != null) {
    confidence = "high";
  } else if (fixerWeight + positiveWeight >= 16 || yearBuilt != null) {
    confidence = "medium";
  }

  const source: ConditionSource =
    yearBuilt != null || renovatedYear != null ? "text+year" : "text";

  let summary: string;
  if (isFixer) {
    summary = `Likely fixer / project (condition ${score100}/100)`;
  } else if (renovatedYear != null) {
    summary = `Updated ~${renovatedYear} (condition ${score100}/100)`;
  } else if (positiveWeight >= 16) {
    summary = `Reads move-in ready (condition ${score100}/100)`;
  } else {
    summary = `Condition unclear from listing text (${score100}/100)`;
  }

  return {
    score100,
    isFixer,
    renovatedYear,
    yearBuilt,
    confidence,
    source,
    summary,
    signals: signals.slice(0, 8),
  };
}

/** Short label for map/card chips */
export function conditionChipLabel(c: ConditionAssessment): string {
  if (c.isFixer) return "Fixer risk";
  if (c.renovatedYear) return `Updated ${c.renovatedYear}`;
  if (c.score100 >= 70) return "Move-in ready";
  return `Condition ${c.score100}`;
}
