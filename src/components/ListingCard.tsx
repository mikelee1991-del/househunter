import { isPropertyListingUrl } from "../lib/listingUrl";
import type { Criteria, ScoredListing } from "../types";
import { LivabilityMeters } from "./LivabilityMeters";

interface Props {
  listing: ScoredListing;
  criteria: Criteria;
  selected: boolean;
  onSelect: () => void;
}

export function ListingCard({ listing, criteria, selected, onSelect }: Props) {
  const photo = listing.photos[0];
  const buyable = isPropertyListingUrl(listing.sourceUrl);
  return (
    <article
      className={`listing-card ${selected ? "selected" : ""} ${listing.flagged ? "flagged" : ""}`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onSelect();
      }}
      role="button"
      tabIndex={0}
    >
      <div
        className="listing-photo"
        style={
          photo
            ? { backgroundImage: `url(${photo})` }
            : { background: "var(--surface-2)" }
        }
      >
        {listing.flagged && <span className="flag-badge">Match</span>}
        <span className="price-badge">
          ${(listing.price / 1_000_000).toFixed(2)}M
        </span>
      </div>
      <div className="listing-body">
        <h3>{listing.address}</h3>
        <p className="meta">
          {listing.neighborhood} · {listing.beds} bd · {listing.baths} ba ·{" "}
          {listing.sqft.toLocaleString()} sqft
        </p>

        {buyable ? (
          <a
            className="listing-cta"
            href={listing.sourceUrl}
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

        {listing.safetyScore != null && listing.walkIndex != null && (
          <LivabilityMeters
            compact
            safetyScore={listing.safetyScore}
            safetyLabel={listing.safetyLabel ?? ""}
            walkIndex={listing.walkIndex}
            walkSource={listing.walkSource ?? "neighborhood-fallback"}
            minSafety={criteria.minSafetyScore}
            walkMin={criteria.walkMin}
            walkMax={criteria.walkMax}
            oceanViewshedScore={listing.oceanViewshed?.score100}
            oceanViewshedHasView={
              listing.oceanViewshed != null
                ? listing.oceanViewshed.score100 >= criteria.minOceanViewshed
                : undefined
            }
            minOceanViewshed={criteria.minOceanViewshed}
          />
        )}
        <p className="desc">{listing.description}</p>
        <div className="tags">
          {listing.oceanViewshed ? (
            <span
              className={`tag ${
                listing.oceanViewshed.score100 >= criteria.minOceanViewshed
                  ? "tag-ok"
                  : "tag-bad"
              }`}
              title={listing.oceanViewshed.summary}
            >
              Ocean/sunset {listing.oceanViewshed.score100}/100
            </span>
          ) : (
            listing.oceanView && (
              <span className="tag">
                Ocean view ({listing.oceanViewConfidence})
              </span>
            )
          )}
          <span className="tag">
            {listing.propertyType === "sfr"
              ? "SFR detached"
              : listing.propertyType}
          </span>
          <span className="tag">
            {listing.garageSpaces}-car garage
            {listing.garageSpaces >= criteria.preferGarageSpaces ? " ★" : ""}
          </span>
          <span className="tag">Score {listing.score}</span>
        </div>
        {listing.flagged && listing.matchReasons.length > 0 && (
          <ul className="reasons ok">
            {listing.matchReasons.slice(0, 3).map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
        {!listing.flagged && listing.failReasons.length > 0 && (
          <ul className="reasons bad">
            {listing.failReasons.slice(0, 2).map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}
