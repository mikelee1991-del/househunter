import { useEffect, useState } from "react";
import {
  analyzeOceanViewshedBatch,
  type OceanViewshedResult,
} from "../lib/oceanViewshed";
import type { Listing } from "../types";

export function useOceanViewshed(listings: Listing[], enabled = true) {
  const [byId, setById] = useState<Record<string, OceanViewshedResult>>({});
  const [progress, setProgress] = useState("");
  const [ready, setReady] = useState(false);

  const signature = listings.map((l) => `${l.id}:${l.lat}:${l.lng}`).join("|");

  useEffect(() => {
    let cancelled = false;
    if (!enabled || !listings.length) {
      setById({});
      setReady(true);
      setProgress("");
      return;
    }

    setReady(false);
    setProgress("Running ocean/sunset viewshed (DEM + buildings)…");

    (async () => {
      try {
        const results = await analyzeOceanViewshedBatch(
          listings.map((l) => ({
            id: l.id,
            lat: l.lat,
            lng: l.lng,
          })),
          (done, total) => {
            if (!cancelled) {
              setProgress(`Ocean viewshed ${done}/${total}`);
            }
          },
        );
        if (!cancelled) {
          setById(results);
          setReady(true);
          setProgress("");
        }
      } catch (e) {
        console.warn("Ocean viewshed failed", e);
        if (!cancelled) {
          setReady(true);
          setProgress("");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [signature, enabled, listings]);

  return { byId, progress, ready };
}
