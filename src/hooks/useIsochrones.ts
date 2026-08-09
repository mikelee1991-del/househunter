import { useEffect, useMemo, useState } from "react";
import {
  buildIsochrones,
  type IsochroneMap,
  type IsochroneMode,
  resolveOrsKey,
} from "../lib/isochrone";
import type { Anchor, AnchorId, Criteria } from "../types";

export type { IsochroneMap, IsochroneMode };

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
  const [progress, setProgress] = useState("Computing Valhalla isochrones…");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMode("loading");
    setProgress("Waiting to recompute isochrones…");

    const timer = window.setTimeout(() => {
      const parsed = JSON.parse(signature) as {
        anchors: [AnchorId, number, number][];
        drive: Criteria["driveMinutes"];
      };
      const liveAnchors: Anchor[] = parsed.anchors.map(([id, lat, lng]) => {
        const base = anchors.find((a) => a.id === id)!;
        return { ...base, lat, lng };
      });
      const orsKey = resolveOrsKey(orsKeyInput);

      (async () => {
        setError(null);
        setProgress("Computing Valhalla drive-time isochrones…");
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
    }, 700);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [signature, anchors, orsKeyInput]);

  return { isochrones, mode, progress, error };
}
