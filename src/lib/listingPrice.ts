/** Guard against scraped price-cut deltas posing as ask prices. */

export function listedAtFromDescription(
  description: string | undefined | null,
): number {
  const m = String(description || "").match(/Listed at \$([\d,]+)/i);
  if (!m) return 0;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** True when stored price is far below an explicit "Listed at" in the blurb. */
export function priceConflictsWithDescription(
  price: number,
  description: string | undefined | null,
): boolean {
  const listed = listedAtFromDescription(description);
  if (!listed || !(price > 0)) return false;
  return listed >= price * 1.5;
}
