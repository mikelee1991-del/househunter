import { useEffect, useState } from "react";
import { isBuyableMarketStatus } from "../lib/listingStatus";
import { isPropertyListingUrl } from "../lib/listingUrl";
import type { ListingsFile } from "../types";

export function useListings() {
  const [data, setData] = useState<ListingsFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/data/listings.json?t=${Date.now()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as ListingsFile;
        // Never surface sold/pending or non-property links in the UI
        const listings = (json.listings ?? []).filter(
          (l) =>
            isBuyableMarketStatus(l.status) && isPropertyListingUrl(l.sourceUrl),
        );
        if (!cancelled) {
          setData({ ...json, listings });
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { data, error, loading };
}
