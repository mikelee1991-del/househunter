# Househunter — South Bay

Interactive map for finding ocean-view, generally west-facing homes in the Los Angeles South Bay, with:

- **Real Valhalla drive-time isochrones** (same engine as [SimpleMapLab](https://www.simplemaplab.com/tools/drive-time-map)) from **SpaceX**, **LAX**, **Kentwood Bluffs**, and **Torrance** — optional OpenRouteService if you paste a key
- Approximate **LAX CNEL noise** bands
- **Low crime + moderate walkability**: neighborhood safety index, EPA National Walkability Index per listing, safety×walk scatter with a target zone, and map choropleth
- **Ocean viewshed (0–100)**: GIS score of ocean + sunset visibility — % of rays toward the Pacific (SW–NW sunset band) that clear DEM terrain + nearby OSM buildings. House facing is ignored. ≥~35 with 2+ clear rays counts as a view. Screening model, not a survey.
- Max-budget slider and other settable criteria
- Listings merged from multiple sources, refreshed **daily** via GitHub Actions
- Automatic **match flagging** against your criteria

## Live site

**https://mikelee1991-del.github.io/househunter/**

Deploys from `main` via GitHub Actions (Pages). Local `npm run dev` still uses `/`.

## Quick start

```bash
npm install
npm run dev
```

Open the local URL Vite prints. Use the left panel to tune max budget, beds, ocean/sunset viewshed, noise ceiling, drive-time limits, and place addresses.

## Live listing sources

```bash
cp .env.example .env
# add keys, then:
npm run ingest
```

| Env var | Source |
| --- | --- |
| `RENTCAST_API_KEY` | [RentCast](https://www.rentcast.io/) sale listings |
| `RAPIDAPI_KEY` | Realtor.com-style RapidAPI feed (optional) |
| `VITE_ORS_API_KEY` | Optional [OpenRouteService](https://openrouteservice.org/) alternate (or paste in the UI) |

**Isochrones:** Default is [Valhalla](https://valhalla1.openstreetmap.de/isochrone) on the FOSSGIS public demo — Dijkstra expansion on the OSM road graph (speed limits, road class, turns), matching SimpleMapLab. Listing flags use point-in-polygon against those shapes.

**Free market inventory (no paid MLS):** Prefer running ingest on a **local** machine. Sereno is the reliable free CRMLS path; Redfin/MB Confidential are often blocked from cloud/datacenter IPs.

```bash
npx playwright install chromium   # once, for Sereno/Redfin scrapers
npm run ingest:all                 # Sereno + Redfin + MBC (merge, never wipe)
INGEST_SERENO_ONLY=1 npm run ingest:all   # maximize free Sereno only
npm run ingest:sereno              # neighborhoods + ZIP pass + price-band splits
SERENO_SKIP_ENRICH=1 npm run ingest:sereno  # search merge only (faster)
npm run ingest:redfin              # Redfin GIS (best locally)
npm run ingest:market              # MB Confidential IDX (often 403 from cloud)
npm run ingest:verify              # re-check MLS on Sereno; drop sold/pending
INGEST_PRECOMPUTE=1 npm run ingest:all     # then bake GIS / default scores
# optional paid path:
# RENTCAST_API_KEY=... npm run ingest
```

Sereno caps each API query at ~200 rows with no pagination. The free scraper beats that by querying city **subsections**, splitting capped queries into **price bands**, and running a South Bay **ZIP** pass (`INGEST_MIN_PRICE` default `$500k`). Empty scrapes never wipe inventory. `ingest:precompute` caches GIS scores so the map paints matches immediately. Add hand-vetted homes to `data/manual-listings.json`.

### Daily refresh

`.github/workflows/ingest-listings.yml` runs every day (~8am PT). Add repository secrets:

- `RENTCAST_API_KEY`
- `RAPIDAPI_KEY` (optional)
- `RAPIDAPI_REALTOR_HOST` (optional)

## Notes

- Seed listing photos are Unsplash stand-ins until live APIs supply MLS photos.
- LAX contours are **approximate** planning bands inspired by LAWA quarterly CNEL maps (official polygons are not published as open GeoJSON).
- Isochrones use the public Valhalla demo (fair-use rate limits). Recompute is debounced when you drag time sliders.
- Facing degrees and some ocean-view flags on seed data are research heuristics; confirm on tour.
