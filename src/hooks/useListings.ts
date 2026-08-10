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
        // Active property pages only; drop incomplete scrapes (no beds/price)
        const listings = (json.listings ?? []).filter((l) => {
          if (!isBuyableMarketStatus(l.status)) return false;
          if (!isPropertyListingUrl(l.sourceUrl)) return false;
          if (!(l.price > 0)) return false;
          if (!(l.beds > 0) || !(l.baths > 0)) return false;
          if (!(l.lat && l.lng)) return false;
          return true;
        });
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
