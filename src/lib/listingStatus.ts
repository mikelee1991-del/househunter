/**
 * Detect whether a listing page HTML still represents an active for-sale home.
 * Prefer explicit off-market signals over generic "sold" words in price history.
 */

export type MarketStatus = "active" | "pending" | "sold" | "unknown";

const OFF_MARKET =
  /property is no longer available|this home (?:has been )?sold|sold \(?closed\)?|off[\s-]market|listing (?:has been )?removed|withdrawn from the market/i;

const PENDING =
  /this home is pending|\bpending sale\b|\bactive under contract\b|\bcontingent\b/i;

const ACTIVE_HINT =
  /\bfor sale\b|\blisted \(active\)\b|\bstatus\s*[:|]?\s*active\b|\bactive\s*\/\s*mls\b/i;

export function inferMarketStatusFromHtml(
  html: string,
  pageTitle = "",
): MarketStatus {
  const head = `${pageTitle}\n${html.slice(0, 80_000)}`;

  // Title-level sold/pending is usually authoritative
  if (/\|\s*sold\b/i.test(pageTitle) || /\bsold\s+for\b/i.test(pageTitle)) {
    return "sold";
  }
  if (/\|\s*pending\b/i.test(pageTitle)) return "pending";

  if (OFF_MARKET.test(head)) return "sold";
  if (PENDING.test(head)) return "pending";

  // Structured status fields commonly embedded in listing pages
  const statusField =
    head.match(
      /"(?:mlsStatus|listingStatus|statusLabel|statusValue|StandardStatus)"\s*:\s*"([^"]+)"/i,
    )?.[1] ??
    head.match(/\bStatus\s*<\/[^>]*>\s*([^<\n]{3,40})/i)?.[1] ??
    "";

  const s = statusField.trim().toLowerCase();
  if (s) {
    if (/\bsold\b|\bclosed\b|\boff/.test(s)) return "sold";
    if (/pending|under contract|contingent/.test(s)) return "pending";
    if (/active|for sale|coming soon/.test(s)) return "active";
  }

  if (ACTIVE_HINT.test(head)) return "active";
  return "unknown";
}

export function isBuyableMarketStatus(status: MarketStatus | string): boolean {
  return status === "active";
}
