/**
 * Only treat URLs that look like a specific property page as buyable.
 * City/neighborhood search pages and 404-prone placeholders must not get
 * a primary "View listing" CTA.
 */
export function isPropertyListingUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }

  const host = u.hostname.replace(/^www\./, "");
  const path = u.pathname;

  // Redfin property pages: /CA/City/Street-Zip/home/12345
  if (host === "redfin.com") {
    return /\/home\/\d+\/?$/.test(path);
  }

  // Zillow homedetails: /homedetails/.../<zpid>_zpid/
  if (host === "zillow.com" || host.endsWith(".zillow.com")) {
    return path.includes("/homedetails/") || /\/\d+_zpid\/?$/.test(path);
  }

  // Realtor.com property: /realestateandhomes-detail/
  if (host === "realtor.com") {
    return path.includes("/realestateandhomes-detail/");
  }

  // Compass listing detail
  if (host === "compass.com") {
    return path.includes("/listing/") || path.includes("/homedetails/");
  }

  // Coldwell / other broker detail pages with MLS-ish paths
  if (host.includes("coldwellbanker")) {
    return (
      path.includes("/lid-") ||
      path.includes("/property/") ||
      /\/pid_\d+/i.test(path)
    );
  }

  // Christie's / Sereno CRMLS detail pages: /SB26138806/...
  if (host === "sereno.com" || host.endsWith(".sereno.com")) {
    return /\/[A-Z]{2}\d{6,}\//i.test(path);
  }

  // Local IDX / broker detail pages with MLS slug
  if (host === "mbconfidential.com" || host.endsWith(".mbconfidential.com")) {
    return /mls-[a-z0-9-]+/i.test(path);
  }

  return false;
}

export function listingCtaLabel(url: string | undefined | null): string {
  return isPropertyListingUrl(url) ? "View listing" : "No live listing link";
}
