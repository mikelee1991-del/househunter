import { useEffect, useMemo, useState } from "react";
import {
  buildIsochrones,
  type IsochroneMap,
  type IsochroneMode,
  resolveOrsKey,
} from "../lib/isochrone";
import { tryDefaultIsochrones } from "../lib/defaultMapCache";
import type { Anchor, AnchorId, Criteria } from "../types";

export type { IsochroneMap, IsochroneMode };

const LIVE_ISO_CACHE_KEY = "househunter.isochrones.v1";

type LiveIsoCache = {
  signature: string;
  mode: Exclude<IsochroneMode, "loading" | "error">;
  map: IsochroneMap;
  savedAt: string;
};

function readLiveIsoCache(signature: string): LiveIsoCache | null {
  try {
    const raw = localStorage.getItem(LIVE_ISO_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LiveIsoCache;
    if (parsed?.signature !== signature) return null;
    if (!parsed.map || typeof parsed.map !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeLiveIsoCache(entry: LiveIsoCache) {
  try {
    localStorage.setItem(LIVE_ISO_CACHE_KEY, JSON.stringify(entry));
  } catch {
    /* quota / private mode */
  }
}

export function useIsochrones(
  anchors: Anchor[],
  criteria: Criteria,
  orsKeyInput = "",
) {
  const signature = useMemo(
    () =>
      JSON.stringify({
        anchors: anchors.map((a) => [a.id, a.lat, a.lng]),
        drive: criteria.driveMinutes,
        provider: resolveOrsKey(orsKeyInput) ? "ors" : "valhalla",
      }),
    [anchors, criteria.driveMinutes, orsKeyInput],
  );

  const [isochrones, setIsochrones] = useState<IsochroneMap>({});
  const [mode, setMode] = useState<IsochroneMode>("loading");
  const [progress, setProgress] = useState("Loading drive-time isochrones…");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let liveTimer = 0;

    const parsed = JSON.parse(signature) as {
      anchors: [AnchorId, number, number][];
      drive: Criteria["driveMinutes"];
    };
    const liveAnchors: Anchor[] = parsed.anchors.map(([id, lat, lng]) => {
      const base = anchors.find((a) => a.id === id)!;
      return { ...base, lat, lng };
    });
    const orsKey = resolveOrsKey(orsKeyInput);

    setError(null);

    // Browser cache from a prior visit with the same places/minutes
    const liveCached = readLiveIsoCache(signature);
    if (liveCached) {
      setIsochrones(liveCached.map);
      setMode(liveCached.mode);
      setProgress("");
      return;
    }

    setProgress("Loading precomputed drive-time isochrones…");

    (async () => {
      // Shipped pack for public DEFAULT_ANCHORS / DEFAULT_CRITERIA
      const shipped = await tryDefaultIsochrones(
        liveAnchors,
        parsed.drive,
        false,
      );
      if (cancelled) return;
      if (shipped && Object.keys(shipped).length > 0) {
        setIsochrones(shipped);
        setMode("valhalla");
        setProgress("");
        writeLiveIsoCache({
          signature,
          mode: "valhalla",
          map: shipped,
          savedAt: new Date().toISOString(),
        });
        return;
      }

      setMode("loading");
      setIsochrones({});
      setProgress("Computing drive-time isochrones…");
      liveTimer = window.setTimeout(() => {
        (async () => {
          setProgress(
            orsKey
              ? "Computing OpenRouteService isochrones…"
              : "Computing Valhalla drive-time isochrones…",
          );
          try {
            const { map, mode: nextMode } = await buildIsochrones(
              liveAnchors,
              parsed.drive,
              orsKey,
              (label) => {
                if (!cancelled) setProgress(label);
              },
            );
            if (!cancelled) {
              setIsochrones(map);
              setMode(nextMode);
              setProgress("");
              if (nextMode === "valhalla" || nextMode === "ors") {
                writeLiveIsoCache({
                  signature,
                  mode: nextMode,
                  map,
                  savedAt: new Date().toISOString(),
                });
              }
            }
          } catch (e) {
            if (!cancelled) {
              setIsochrones({});
              setMode("error");
              setError(e instanceof Error ? e.message : "Isochrone failed");
              setProgress("");
            }
          }
        })();
      }, 250);
    })();

    return () => {
      cancelled = true;
      if (liveTimer) window.clearTimeout(liveTimer);
    };
  }, [signature, anchors, orsKeyInput]);

  return { isochrones, mode, progress, error };
}
