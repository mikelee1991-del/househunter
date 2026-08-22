import { conditionChipLabel } from "../lib/condition";
import { isPendingSaleStatus, pendingSaleLabel } from "../lib/listingStatus";
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
  const pending = isPendingSaleStatus(listing.status);
  const pendingLabel = pendingSaleLabel(listing.status);
  return (
    <article
      className={`listing-card ${selected ? "selected" : ""} ${listing.flagged ? "flagged" : ""} ${pending ? "is-pending" : ""}`}
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
        {pending && pendingLabel && (
          <span className="status-badge pending-badge">{pendingLabel}</span>
        )}
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
            airQualityScore={listing.airQualityScore}
            minAirQualityScore={criteria.minAirQualityScore}
            oceanViewshedScore={
              listing.oceanViewshed?.oceanViewScore ??
              listing.oceanViewshed?.score100
            }
            oceanViewshedHasView={
              listing.oceanViewshed != null
                ? (listing.oceanViewshed.oceanViewScore ??
                    listing.oceanViewshed.score100) >=
                    criteria.minOceanViewshed ||
                  criteria.minOceanViewshed <= 0
                : undefined
            }
            minOceanViewshed={criteria.minOceanViewshed}
            sunsetViewshedScore={listing.oceanViewshed?.sunsetViewScore}
            sunsetViewshedHasView={
              listing.oceanViewshed?.sunsetViewScore != null
                ? listing.oceanViewshed.sunsetViewScore >=
                    (criteria.minSunsetViewshed ?? 0) ||
                  (criteria.minSunsetViewshed ?? 0) <= 0
                : undefined
            }
            minSunsetViewshed={criteria.minSunsetViewshed ?? 0}
          />
        )}
        <p className="desc">{listing.description}</p>
        <div className="tags">
          {listing.oceanViewshed ? (
            <>
              <span
                className={`tag ${
                  (listing.oceanViewshed.oceanViewScore ??
                    listing.oceanViewshed.score100) >=
                    criteria.minOceanViewshed ||
                  criteria.minOceanViewshed <= 0
                    ? "tag-ok"
                    : "tag-bad"
                }`}
                title={listing.oceanViewshed.summary}
              >
                Ocean{" "}
                {listing.oceanViewshed.oceanViewScore ??
                  listing.oceanViewshed.score100}
                /100
              </span>
              {listing.oceanViewshed.sunsetViewScore != null && (
                <span
                  className={`tag ${
                    listing.oceanViewshed.sunsetViewScore >=
                      (criteria.minSunsetViewshed ?? 0) ||
                    (criteria.minSunsetViewshed ?? 0) <= 0
                      ? "tag-ok"
                      : "tag-bad"
                  }`}
                  title={listing.oceanViewshed.summary}
                >
                  Sunset {listing.oceanViewshed.sunsetViewScore}/100
                </span>
              )}
            </>
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
          {listing.condition && (
            <span
              className={`tag ${
                listing.condition.isFixer ||
                (criteria.minConditionScore > 0 &&
                  listing.condition.score100 < criteria.minConditionScore)
                  ? "tag-bad"
                  : listing.condition.score100 >= 70
                    ? "tag-ok"
                    : ""
              }`}
              title={listing.condition.summary}
            >
              {conditionChipLabel(listing.condition)}
            </span>
          )}
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
