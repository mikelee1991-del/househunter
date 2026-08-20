import { useEffect, useMemo } from "react";
import {
  MapContainer,
  Marker,
  Polygon,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import { LAX_NOISE_POLYGONS } from "../data/laxNoise";
import type { SafetyTractsFile } from "../data/safetyTiers";
import type { AirQualityTractsFile } from "../hooks/useAirQualityTracts";
import type { IsochroneMap } from "../hooks/useIsochrones";
import { exteriorRings } from "../lib/isochrone";
import { isPendingSaleStatus, pendingSaleLabel } from "../lib/listingStatus";
import { isPropertyListingUrl } from "../lib/listingUrl";
import {
  metricScoreColor,
  quietScoreFromCnel,
  type MapMetricLayer,
} from "../lib/mapMetrics";
import type { Anchor, Criteria, Listing, ScoredListing } from "../types";
import { ParameterScoreChart } from "./ParameterScoreChart";
import { AddressMetricHeatLayer } from "./AddressMetricHeatLayer";
import { OceanViewshedHeatLayer } from "./OceanViewshedHeatLayer";
import { SuitabilityHeatLayer } from "./SuitabilityHeatLayer";

const NOISE_COLORS: Record<number, string> = {
  65: "#f0c92955",
  70: "#e07a3d77",
  75: "#c0392b99",
};

function FitToHomes({ listings }: { listings: ScoredListing[] }) {
  const map = useMap();
  const key = listings.map((l) => l.id).join("|");
  useEffect(() => {
    if (!listings.length) return;
    const pts = listings.map((l) => [l.lat, l.lng] as [number, number]);
    map.fitBounds(L.latLngBounds(pts), { padding: [48, 48], maxZoom: 13 });
    // key captures listing set identity without depending on array ref churn
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
  return null;
}

function FocusSelected({
  listing,
}: {
  listing: ScoredListing | undefined;
}) {
  const map = useMap();
  useEffect(() => {
    if (!listing) return;
    map.panTo([listing.lat, listing.lng], { animate: true });
  }, [listing, map]);
  return null;
}

function anchorIcon(color: string) {
  return L.divIcon({
    className: "anchor-icon",
    html: `<span style="background:${color}"></span>`,
    iconSize: [10, 10],
    iconAnchor: [5, 5],
  });
}

function listingMetricScore(
  listing: ScoredListing,
  layer: MapMetricLayer,
): number | null {
  switch (layer) {
    case "safety":
      return listing.safetyScore ?? null;
    case "air":
      return listing.airQualityScore ?? null;
    case "walk":
      return listing.walkIndex != null
        ? Math.round((listing.walkIndex / 20) * 100)
        : null;
    case "ocean":
      return listing.oceanViewshed?.score100 ?? null;
    case "condition":
      return listing.condition?.score100 ?? null;
    case "noise":
      return Math.round(quietScoreFromCnel(listing.noiseCnel));
    default:
      return null;
  }
}

function homeIcon(
  listing: ScoredListing,
  selected: boolean,
  metricLayer: MapMetricLayer,
) {
  const price = `$${(listing.price / 1e6).toFixed(2)}M`;
  const pending = isPendingSaleStatus(listing.status);
  const metric = listingMetricScore(listing, metricLayer);
  const tint =
    metric != null && metricLayer !== "off" && metricLayer !== "suitability"
      ? metricScoreColor(metric)
      : null;
  const state = [
    selected ? "is-selected" : "",
    listing.flagged ? "is-match" : "",
    pending ? "is-pending" : "",
    tint ? "has-metric" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const pendingMark = pending
    ? `<span class="home-pin-pending" title="Pending sale / under contract">Pending</span>`
    : "";
  const metricMark =
    tint && metric != null
      ? `<span class="home-pin-metric" title="Metric score">${metric}</span>`
      : "";
  const dotStyle = tint ? ` style="background:${tint}"` : "";
  return L.divIcon({
    className: `home-marker ${state}`,
    html: `
      <div class="home-pin" title="${listing.address}${pending ? " (pending sale)" : ""}">
        <span class="home-pin-dot"${dotStyle}></span>
        <span class="home-pin-label">${price}${metricMark}${pendingMark}</span>
      </div>
    `,
    iconSize: [pending || tint ? 128 : 72, 36],
    iconAnchor: [12, 18],
    popupAnchor: [24, -10],
  });
}

interface Props {
  anchors: Anchor[];
  isochrones: IsochroneMap;
  listings: ScoredListing[];
  /** Full inventory (for ocean IDW samples on the suitability heatmap) */
  allListings: Listing[];
  criteria: Criteria;
  selectedId: string | null;
  onSelect: (id: string) => void;
  showIsochrones: boolean;
  metricLayer: MapMetricLayer;
  satellite: boolean;
  safetyTracts: SafetyTractsFile | null;
  airTracts: AirQualityTractsFile | null;
}

export function MapView({
  anchors,
  isochrones,
  listings,
  allListings,
  criteria,
  selectedId,
  onSelect,
  showIsochrones,
  metricLayer,
  satellite,
  safetyTracts,
  airTracts,
}: Props) {
  const center = useMemo(() => {
    if (listings[0]) return [listings[0].lat, listings[0].lng] as [number, number];
    const lat = anchors.reduce((s, a) => s + a.lat, 0) / anchors.length;
    const lng = anchors.reduce((s, a) => s + a.lng, 0) / anchors.length;
    return [lat, lng] as [number, number];
  }, [anchors, listings]);

  const selected = listings.find((l) => l.id === selectedId);
  const showSuitability = metricLayer === "suitability";
  const showNoise = metricLayer === "noise";
  const showOcean = metricLayer === "ocean";
  // Ocean: address-local halos for every scored lot + dedicated dots/fans.
  // Suitability has its own continuous wash + halos pair.
  const showAddressHeat =
    metricLayer !== "off" && metricLayer !== "suitability";

  return (
    <MapContainer
      center={center}
      zoom={11}
      className="map"
      scrollWheelZoom
    >
      <TileLayer
        key={satellite ? "sat" : "light"}
        attribution={
          satellite
            ? 'Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics'
            : '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
        }
        url={
          satellite
            ? "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        }
        maxZoom={satellite ? 19 : 20}
      />
      <FitToHomes listings={listings} />
      <FocusSelected listing={selected} />

      {/* Best areas: continuous location model (background) + address halos */}
      <SuitabilityHeatLayer
        enabled={showSuitability}
        criteria={criteria}
        anchors={anchors}
        isochrones={isochrones}
        listings={allListings}
        safetyTracts={safetyTracts}
        airTracts={airTracts}
      />
      <AddressMetricHeatLayer
        enabled={showSuitability}
        metric="suitability"
        listings={allListings}
      />

      {/* Per-metric lot-scale halos — ocean included (full 0–100 GIS scores) */}
      <AddressMetricHeatLayer
        enabled={showAddressHeat}
        metric={metricLayer}
        listings={allListings}
      />
      <OceanViewshedHeatLayer enabled={showOcean} listings={allListings} />

      {showNoise &&
        LAX_NOISE_POLYGONS.map((poly) => (
          <Polygon
            key={poly.cnel}
            positions={poly.coordinates.map(([lng, lat]) => [lat, lng])}
            pathOptions={{
              color: NOISE_COLORS[poly.cnel].slice(0, 7),
              fill: false,
              fillOpacity: 0,
              weight: 1.5,
              opacity: 0.55,
              dashArray: "3 5",
            }}
          >
            <Tooltip sticky>LAX ~{poly.cnel} CNEL contour</Tooltip>
          </Polygon>
        ))}

      {showIsochrones &&
        anchors.flatMap((a) => {
          const feature = isochrones[a.id];
          if (!feature) return [];
          return exteriorRings(feature).map((ring, idx) => (
            <Polygon
              key={`iso-${a.id}-${idx}`}
              positions={ring.map(
                ([lng, lat]) => [lat, lng] as [number, number],
              )}
              pathOptions={{
                color: a.color,
                fill: false,
                fillOpacity: 0,
                weight: 2,
                opacity: 0.85,
                dashArray: "5 7",
              }}
            >
              <Tooltip sticky>
                {a.label} — {String(feature.properties.minutes)} min
              </Tooltip>
            </Polygon>
          ));
        })}

      {anchors.map((a) => (
        <Marker
          key={a.id}
          position={[a.lat, a.lng]}
          icon={anchorIcon(a.color)}
          zIndexOffset={100}
        >
          <Tooltip direction="top" offset={[0, -4]}>
            <strong>{a.label}</strong>
            <br />
            {a.address}
          </Tooltip>
        </Marker>
      ))}

      {listings.map((l) => {
        const isSelected = l.id === selectedId;
        const pendingLabel = pendingSaleLabel(l.status);
        return (
          <Marker
            key={l.id}
            position={[l.lat, l.lng]}
            icon={homeIcon(l, isSelected, metricLayer)}
            zIndexOffset={
              isSelected ? 2000 : l.flagged ? 1500 : pendingLabel ? 1200 : 1000
            }
            eventHandlers={{ click: () => onSelect(l.id) }}
          >
            <Popup className="home-popup" maxWidth={320} minWidth={260}>
              <div className="home-popup-body">
                <p className="home-popup-price">
                  ${(l.price / 1e6).toFixed(2)}M
                  {l.flagged ? " · Match" : ""}
                  {pendingLabel ? ` · ${pendingLabel}` : ""}
                </p>
                {pendingLabel && (
                  <p className="home-popup-pending">
                    {pendingLabel} — under contract
                  </p>
                )}
                <p className="home-popup-addr">{l.address}</p>
                <p className="home-popup-meta">
                  {l.neighborhood} · {l.beds} bd · {l.baths} ba ·{" "}
                  {l.sqft.toLocaleString()} sqft
                </p>
                <ParameterScoreChart
                  listing={l}
                  criteria={criteria}
                  anchors={anchors}
                  compact
                />
                {isPropertyListingUrl(l.sourceUrl) ? (
                  <a
                    className="listing-cta"
                    href={l.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    View listing
                  </a>
                ) : (
                  <p className="listing-cta listing-cta-disabled">
                    No live listing link
                  </p>
                )}
              </div>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
