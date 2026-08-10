import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_ANCHORS,
  NEIGHBORHOOD_OPTIONS,
} from "../data/anchors";
import { geocodeAddress } from "../lib/geocode";
import type { IsochroneMode } from "../lib/isochrone";
import type { Anchor, AnchorId, Criteria } from "../types";

interface Props {
  criteria: Criteria;
  anchors: Anchor[];
  onCriteriaChange: (c: Criteria) => void;
  onAnchorsChange: (a: Anchor[]) => void;
  flaggedCount: number;
  totalCount: number;
  isoMode: IsochroneMode;
  isoProgress?: string;
  isoError?: string | null;
  orsKey: string;
  onOrsKeyChange: (key: string) => void;
  generatedAt?: string;
  sources?: string[];
}

type GeoStatus = "idle" | "loading" | "ok" | "error";

function isoModeLabel(mode: IsochroneMode): string {
  switch (mode) {
    case "valhalla":
      return "Valhalla road isochrones";
    case "ors":
      return "OpenRouteService isochrones";
    case "loading":
      return "Computing drive-time…";
    case "error":
      return "Isochrone request failed — retry shortly";
  }
}

function money(n: number) {
  return `$${(n / 1_000_000).toFixed(1)}M`;
}

function DualRange({
  min,
  max,
  step,
  valueMin,
  valueMax,
  onMin,
  onMax,
  format,
}: {
  min: number;
  max: number;
  step: number;
  valueMin: number;
  valueMax: number;
  onMin: (v: number) => void;
  onMax: (v: number) => void;
  format: (v: number) => string;
}) {
  const span = max - min || 1;
  const left = ((valueMin - min) / span) * 100;
  const right = ((valueMax - min) / span) * 100;

  return (
    <div className="dual-range-wrap">
      <div className="range-labels">
        <span>{format(valueMin)}</span>
        <span>{format(valueMax)}</span>
      </div>
      <div className="dual-range">
        <div
          className="dual-range-track"
          style={{ left: `${left}%`, width: `${right - left}%` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={valueMin}
          onChange={(e) => onMin(Math.min(Number(e.target.value), valueMax))}
          aria-label="Minimum"
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={valueMax}
          onChange={(e) => onMax(Math.max(Number(e.target.value), valueMin))}
          aria-label="Maximum"
        />
      </div>
    </div>
  );
}

export function CriteriaPanel({
  criteria,
  anchors,
  onCriteriaChange,
  onAnchorsChange,
  flaggedCount,
  totalCount,
  isoMode,
  isoProgress,
  isoError,
  orsKey,
  onOrsKeyChange,
  generatedAt,
  sources,
}: Props) {
  const anchorsRef = useRef(anchors);
  anchorsRef.current = anchors;
  const geocodeTimers = useRef<Partial<Record<AnchorId, number>>>({});
  const [geoStatus, setGeoStatus] = useState<
    Partial<Record<AnchorId, GeoStatus>>
  >({});

  useEffect(() => {
    const timers = geocodeTimers.current;
    return () => {
      for (const id of Object.keys(timers) as AnchorId[]) {
        window.clearTimeout(timers[id]);
      }
    };
  }, []);

  const set = <K extends keyof Criteria>(key: K, value: Criteria[K]) =>
    onCriteriaChange({ ...criteria, [key]: value });

  const setDrive = (id: AnchorId, minutes: number) =>
    set("driveMinutes", { ...criteria.driveMinutes, [id]: minutes });

  const patchAnchor = (id: AnchorId, patch: Partial<Anchor>) =>
    onAnchorsChange(
      anchorsRef.current.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    );

  const setAnchorAddress = (id: AnchorId, address: string) => {
    patchAnchor(id, { address });
    window.clearTimeout(geocodeTimers.current[id]);
    geocodeTimers.current[id] = window.setTimeout(async () => {
      setGeoStatus((s) => ({ ...s, [id]: "loading" }));
      try {
        const hit = await geocodeAddress(address);
        if (!hit) {
          setGeoStatus((s) => ({ ...s, [id]: "error" }));
          return;
        }
        patchAnchor(id, { lat: hit.lat, lng: hit.lng });
        setGeoStatus((s) => ({ ...s, [id]: "ok" }));
      } catch {
        setGeoStatus((s) => ({ ...s, [id]: "error" }));
      }
    }, 700);
  };

  const toggleNeighborhood = (name: string) => {
    const has = criteria.neighborhoods.includes(name);
    set(
      "neighborhoods",
      has
        ? criteria.neighborhoods.filter((n) => n !== name)
        : [...criteria.neighborhoods, name],
    );
  };

  const geoHint = (id: AnchorId) => {
    const st = geoStatus[id];
    if (st === "loading") return "Looking up address…";
    if (st === "error") return "Address not found — try a fuller street address";
    if (st === "ok") return "Pin updated";
    return null;
  };

  return (
    <aside className="panel">
      <header className="panel-hero">
        <p className="eyebrow">South Bay search</p>
        <h1>Househunter</h1>
        <p className="lede">
          Find a buyable South Bay home that fits your life — then open the
          listing and go see it.
        </p>
        <div className="match-pill">
          <strong>{flaggedCount}</strong> match criteria
          <span className="match-pill-sub"> of {totalCount} active</span>
        </div>
      </header>

      <section className="panel-section">
        <h2>Budget</h2>
        <DualRange
          min={1_500_000}
          max={5_000_000}
          step={50_000}
          valueMin={criteria.budgetMin}
          valueMax={criteria.budgetMax}
          onMin={(v) => set("budgetMin", v)}
          onMax={(v) => set("budgetMax", v)}
          format={money}
        />
      </section>

      <section className="panel-section">
        <h2>Must-haves</h2>
        <div className="grid-3">
          <label className="field">
            <span>Beds</span>
            <input
              type="number"
              min={1}
              max={8}
              value={criteria.minBeds}
              onChange={(e) => set("minBeds", Number(e.target.value))}
            />
          </label>
          <label className="field">
            <span>Baths</span>
            <input
              type="number"
              min={1}
              max={8}
              step={0.5}
              value={criteria.minBaths}
              onChange={(e) => set("minBaths", Number(e.target.value))}
            />
          </label>
          <label className="field">
            <span>Sqft</span>
            <input
              type="number"
              min={800}
              max={6000}
              step={50}
              value={criteria.minSqft}
              onChange={(e) => set("minSqft", Number(e.target.value))}
            />
          </label>
        </div>
        <label className="field field-inline">
          <span>
            Min ocean viewshed — {criteria.minOceanViewshed}/100
            {criteria.minOceanViewshed === 0 ? " (off)" : ""}
          </span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={criteria.minOceanViewshed}
            onChange={(e) => {
              const v = Number(e.target.value);
              onCriteriaChange({
                ...criteria,
                minOceanViewshed: v,
                requireOceanView: v > 0,
              });
            }}
          />
        </label>
        <p className="hint">
          0–100 GIS score: % of rays toward the Pacific / sunset that clear
          terrain and buildings. 0 = no filter; ~35 ≈ a usable ocean/sunset
          wedge.
        </p>
        <label className="check">
          <input
            type="checkbox"
            checked={criteria.requireSingleFamily}
            onChange={(e) => set("requireSingleFamily", e.target.checked)}
          />
          Detached SFR only
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={criteria.requireOutdoorSpace}
            onChange={(e) => set("requireOutdoorSpace", e.target.checked)}
          />
          Outdoor space (patio/deck/yard…)
        </label>
        <div className="grid-2">
          <label className="field">
            <span>Garage min</span>
            <input
              type="number"
              min={0}
              max={6}
              value={criteria.minGarageSpaces}
              onChange={(e) => set("minGarageSpaces", Number(e.target.value))}
            />
          </label>
          <label className="field">
            <span>Garage prefer</span>
            <input
              type="number"
              min={0}
              max={6}
              value={criteria.preferGarageSpaces}
              onChange={(e) =>
                set("preferGarageSpaces", Number(e.target.value))
              }
            />
          </label>
        </div>
        <label className="field field-inline">
          <span>Max LAX noise — {criteria.maxNoiseCnel} CNEL</span>
          <input
            type="range"
            min={40}
            max={75}
            step={1}
            value={criteria.maxNoiseCnel}
            onChange={(e) => set("maxNoiseCnel", Number(e.target.value))}
          />
        </label>
      </section>

      <section className="panel-section">
        <h2>Crime & walkability</h2>
        <label className="field field-inline">
          <span>Min safety — {criteria.minSafetyScore}</span>
          <input
            type="range"
            min={50}
            max={100}
            step={1}
            value={criteria.minSafetyScore}
            onChange={(e) => set("minSafetyScore", Number(e.target.value))}
          />
        </label>
        <p className="field-caption">EPA walk band</p>
        <DualRange
          min={1}
          max={20}
          step={0.25}
          valueMin={criteria.walkMin}
          valueMax={criteria.walkMax}
          onMin={(v) => set("walkMin", v)}
          onMax={(v) => set("walkMax", v)}
          format={(v) => v.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")}
        />
        <div className="chip-row chip-row-tight">
          <button
            type="button"
            className="chip"
            onClick={() =>
              onCriteriaChange({
                ...criteria,
                walkMin: 10.5,
                walkMax: 15.25,
              })
            }
          >
            10.5–15.25
          </button>
          <button
            type="button"
            className="chip"
            onClick={() =>
              onCriteriaChange({
                ...criteria,
                walkMin: 10.5,
                walkMax: 20,
              })
            }
          >
            10.5+
          </button>
        </div>
      </section>

      <section className="panel-section">
        <h2>Places & drive times</h2>
        <p className="hint">
          {isoModeLabel(isoMode)}
          {isoProgress ? ` · ${isoProgress}` : ""}
        </p>
        {isoError && <p className="hint error-hint">{isoError}</p>}
        <label className="check">
          <input
            type="checkbox"
            checked={criteria.requireWithinAllIsochrones}
            onChange={(e) =>
              set("requireWithinAllIsochrones", e.target.checked)
            }
          />
          Must sit inside all four isochrones
        </label>

        {anchors.map((a) => {
          const hint = geoHint(a.id);
          return (
            <div key={a.id} className="anchor-edit">
              <div className="anchor-edit-head">
                <strong style={{ color: a.color }}>{a.label}</strong>
                <span className="anchor-mins">
                  {criteria.driveMinutes[a.id]} min
                </span>
              </div>
              <label className="field field-tight">
                <span className="sr-only">Address</span>
                <input
                  type="text"
                  autoComplete="street-address"
                  placeholder="Street address"
                  value={a.address}
                  onChange={(e) => setAnchorAddress(a.id, e.target.value)}
                />
              </label>
              {hint && (
                <p
                  className={`hint field-hint ${
                    geoStatus[a.id] === "error" ? "error-hint" : "accent-hint"
                  }`}
                >
                  {hint}
                </p>
              )}
              <input
                type="range"
                min={5}
                max={60}
                step={1}
                value={criteria.driveMinutes[a.id]}
                onChange={(e) => setDrive(a.id, Number(e.target.value))}
                aria-label={`${a.label} drive minutes`}
              />
            </div>
          );
        })}

        <div className="row-actions">
          <button
            type="button"
            className="ghost-btn"
            onClick={() =>
              onAnchorsChange(DEFAULT_ANCHORS.map((a) => ({ ...a })))
            }
          >
            Reset places
          </button>
        </div>

        <details className="panel-details">
          <summary>Isochrone engine options</summary>
          <p className="hint">
            Default is{" "}
            <a
              href="https://valhalla1.openstreetmap.de"
              target="_blank"
              rel="noreferrer"
            >
              Valhalla
            </a>{" "}
            (same as SimpleMapLab). Optional ORS key below.
          </p>
          <label className="field">
            <span>OpenRouteService API key</span>
            <input
              type="password"
              autoComplete="off"
              placeholder="Optional"
              value={orsKey}
              onChange={(e) => onOrsKeyChange(e.target.value)}
            />
          </label>
        </details>
      </section>

      <section className="panel-section">
        <h2>Neighborhoods</h2>
        <p className="hint">Empty = all. Click to filter.</p>
        <div className="chip-row">
          {NEIGHBORHOOD_OPTIONS.map((n) => {
            const on = criteria.neighborhoods.includes(n);
            return (
              <button
                key={n}
                type="button"
                className={`chip ${on ? "chip-on" : ""}`}
                onClick={() => toggleNeighborhood(n)}
              >
                {n}
              </button>
            );
          })}
        </div>
      </section>

      <footer className="panel-foot">
        {generatedAt && (
          <p>
            Listings refreshed{" "}
            {new Date(generatedAt).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </p>
        )}
        {sources && sources.length > 0 && (
          <p>Sources: {sources.join(", ")}</p>
        )}
      </footer>
    </aside>
  );
}
