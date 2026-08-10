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
import {
  NEIGHBORHOOD_LIVABILITY,
  walkColor,
} from "../data/neighborhoodLivability";
import type { SafetyTractsFile } from "../data/safetyTiers";
import { tierColor } from "../data/safetyTiers";
import type { IsochroneMap } from "../hooks/useIsochrones";
import { exteriorRings } from "../lib/isochrone";
import { isPropertyListingUrl } from "../lib/listingUrl";
import type { Anchor, ScoredListing } from "../types";

export type LivabilityOverlay = "off" | "safety" | "walk";

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

function homeIcon(listing: ScoredListing, selected: boolean) {
  const price = `$${(listing.price / 1e6).toFixed(2)}M`;
  const state = selected ? "is-selected" : listing.flagged ? "is-match" : "";
  return L.divIcon({
    className: `home-marker ${state}`,
    html: `
      <div class="home-pin" title="${listing.address}">
        <span class="home-pin-dot"></span>
        <span class="home-pin-label">${price}</span>
      </div>
    `,
    iconSize: [72, 36],
    iconAnchor: [12, 18],
    popupAnchor: [24, -10],
  });
}

function geoRingsToLatLng(
  geometry: SafetyTractsFile["features"][number]["geometry"],
): [number, number][][] {
  if (geometry.type === "Polygon") {
    return [
      (geometry.coordinates[0] as [number, number][]).map(([lng, lat]) => [
        lat,
        lng,
      ]),
    ];
  }
  return (geometry.coordinates as [number, number][][][]).map((poly) =>
    poly[0].map(([lng, lat]) => [lat, lng] as [number, number]),
  );
}

interface Props {
  anchors: Anchor[];
  isochrones: IsochroneMap;
  listings: ScoredListing[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  showNoise: boolean;
  showIsochrones: boolean;
  livabilityOverlay: LivabilityOverlay;
  safetyTracts: SafetyTractsFile | null;
}

export function MapView({
  anchors,
  isochrones,
  listings,
  selectedId,
  onSelect,
  showNoise,
  showIsochrones,
  livabilityOverlay,
  safetyTracts,
}: Props) {
  const center = useMemo(() => {
    if (listings[0]) return [listings[0].lat, listings[0].lng] as [number, number];
    const lat = anchors.reduce((s, a) => s + a.lat, 0) / anchors.length;
    const lng = anchors.reduce((s, a) => s + a.lng, 0) / anchors.length;
    return [lat, lng] as [number, number];
  }, [anchors, listings]);

  const selected = listings.find((l) => l.id === selectedId);
  const boundsList = listings;

  return (
    <MapContainer
      center={center}
      zoom={11}
      className="map"
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
      />
      <FitToHomes listings={boundsList} />
      <FocusSelected listing={selected} />

      {livabilityOverlay === "safety" &&
        safetyTracts?.features.map((f) => {
          const fill = tierColor(f.properties.tier);
          const rings = geoRingsToLatLng(f.geometry);
          return rings.map((positions, idx) => (
            <Polygon
              key={`tract-${f.properties.geoid}-${idx}`}
              positions={positions}
              pathOptions={{
                color: "#5c574c",
                fillColor: fill,
                fillOpacity: 0.22,
                weight: 0.5,
                opacity: 0.35,
              }}
            >
              <Tooltip sticky>
                {f.properties.place} · {f.properties.tierLabel}
              </Tooltip>
            </Polygon>
          ));
        })}

      {livabilityOverlay === "walk" &&
        NEIGHBORHOOD_LIVABILITY.map((n) => {
          const fill = walkColor(n.walkFallback);
          return (
            <Polygon
              key={`walk-${n.name}`}
              positions={n.polygon}
              pathOptions={{
                color: fill,
                fillColor: fill,
                fillOpacity: 0.18,
                weight: 1,
              }}
            >
              <Tooltip sticky>
                {n.name} · walk ~{n.walkFallback}
              </Tooltip>
            </Polygon>
          );
        })}

      {showNoise &&
        LAX_NOISE_POLYGONS.map((poly) => (
          <Polygon
            key={poly.cnel}
            positions={poly.coordinates.map(([lng, lat]) => [lat, lng])}
            pathOptions={{
              color: NOISE_COLORS[poly.cnel].slice(0, 7),
              fillColor: NOISE_COLORS[poly.cnel],
              fillOpacity: 0.22,
              weight: 1,
            }}
          >
            <Tooltip sticky>LAX ~{poly.cnel} CNEL</Tooltip>
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
                fillColor: a.color,
                fillOpacity: 0.04,
                weight: 1.5,
                opacity: 0.55,
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

      {/* Homes last + high z-index: primary map signal */}
      {listings.map((l) => {
        const isSelected = l.id === selectedId;
        return (
          <Marker
            key={l.id}
            position={[l.lat, l.lng]}
            icon={homeIcon(l, isSelected)}
            zIndexOffset={isSelected ? 2000 : l.flagged ? 1500 : 1000}
            eventHandlers={{ click: () => onSelect(l.id) }}
          >
            <Popup className="home-popup" maxWidth={280}>
              <div className="home-popup-body">
                <p className="home-popup-price">
                  ${(l.price / 1e6).toFixed(2)}M
                  {l.flagged ? " · Match" : ""}
                </p>
                <p className="home-popup-addr">{l.address}</p>
                <p className="home-popup-meta">
                  {l.neighborhood} · {l.beds} bd · {l.baths} ba ·{" "}
                  {l.sqft.toLocaleString()} sqft
                </p>
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
