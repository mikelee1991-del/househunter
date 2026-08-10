/**
 * Shared ask-price extraction. Avoids mistaking price-reduction deltas
 * (e.g. "$1,550,000 (7.95%)") for the list price on luxury homes.
 */

export function parseMoney(s) {
  const n = Number(String(s).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Extract the live ask price from listing HTML / meta text.
 * @returns {{ price: number, source: string, overMax: boolean }}
 */
export function extractAskPrice(html, { minPrice = 0, maxPrice = Infinity } = {}) {
  const metaDesc =
    html.match(/<meta\s+name="description"\s+content="([^"]+)"/i)?.[1] ||
    html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i)?.[1] ||
    "";

  const listedAt = parseMoney(metaDesc.match(/Listed at \$([\d,]+)/i)?.[1] || "");
  const currentNear = parseMoney(
    html.match(/Current Price[^\$]{0,80}\$([\d,]+)/i)?.[1] ||
      html.match(/\$([\d,]+)[^\$]{0,40}Current Price/i)?.[1] ||
      "",
  );

  // Dollar amounts that are clearly reduction deltas in history tables
  const reductionDeltas = new Set(
    [...html.matchAll(/\$([\d,]+)\s*\(\s*\d+(?:\.\d+)?%\s*\)/g)].map((m) =>
      parseMoney(m[1]),
    ),
  );

  const allAmounts = [...html.matchAll(/\$([\d,]{7,})/g)]
    .map((m) => parseMoney(m[1]))
    .filter((n) => n >= 250_000 && n <= 80_000_000);

  // Prefer explicit list/current price signals
  const preferred = [listedAt, currentNear].filter((n) => n >= 250_000);
  let price = preferred[0] || 0;
  let source = listedAt ? "meta-listed-at" : currentNear ? "current-price" : "";

  if (!price) {
    // Largest amount on the page that is NOT a reduction delta
    const candidates = allAmounts.filter((n) => !reductionDeltas.has(n));
    price = candidates.length ? Math.max(...candidates) : 0;
    source = "largest-non-delta";
  }

  // If we somehow picked a delta while a much larger ask exists, fix it
  const largerAsk = allAmounts
    .filter((n) => !reductionDeltas.has(n) && n >= price * 1.5)
    .sort((a, b) => b - a)[0];
  if (largerAsk && (reductionDeltas.has(price) || largerAsk >= price * 1.5)) {
    // Only upgrade when preferred signals missing or chosen price looks like a cut
    if (!preferred.length || reductionDeltas.has(price) || price < largerAsk * 0.5) {
      price = largerAsk;
      source = "upgraded-from-delta";
    }
  }

  const overMax = price > maxPrice;
  if (price && (price < minPrice || overMax)) {
    return { price, source, overMax: overMax || price < minPrice };
  }
  return { price, source, overMax: false };
}

/** True when stored price is implausibly low vs meta "Listed at". */
export function priceConflictsWithDescription(price, description) {
  const listed = parseMoney(
    String(description || "").match(/Listed at \$([\d,]+)/i)?.[1] || "",
  );
  if (!listed || !price) return false;
  return listed >= price * 1.5;
}
