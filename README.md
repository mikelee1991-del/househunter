# Househunter — South Bay

Interactive map for finding ocean-view, generally west-facing homes in the Los Angeles South Bay, with:

- **Real Valhalla drive-time isochrones** (same engine as [SimpleMapLab](https://www.simplemaplab.com/tools/drive-time-map)) from **SpaceX**, **LAX**, **Kentwood Bluffs**, and **Torrance** — optional OpenRouteService if you paste a key
- Approximate **LAX CNEL noise** bands
- **Low crime + moderate walkability**: neighborhood safety index, EPA National Walkability Index per listing, safety×walk scatter with a target zone, and map choropleth
- **Ocean viewshed (0–100)**: GIS score of ocean + sunset visibility — % of rays toward the Pacific (SW–NW sunset band) that clear DEM terrain + nearby OSM buildings. House facing is ignored. ≥~35 with 2+ clear rays counts as a view. Screening model, not a survey.
- Budget slider (default **$2.5M–$3.5M**) and other settable criteria
- Listings merged from multiple sources, refreshed **daily** via GitHub Actions
- Automatic **match flagging** against your criteria

## Quick start

```bash
npm install
npm run dev
```

Open the local URL Vite prints. Use the left panel to tune budget, beds, ocean/sunset viewshed, noise ceiling, drive-time limits, and place addresses.

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

**Market inventory (pull everything, then filter in the UI):**

```bash
npm run ingest:market   # scrape active South Bay IDX (~$1M–$12M) → listings.json
npm run ingest:enrich   # backfill beds/baths/sqft/photos from detail pages
npm run ingest:verify   # re-check each MLS on Sereno; refresh price; drop sold/pending
npm run ingest:precompute  # bake viewshed / walk / drives / default scores into listings.json
# or, with a key for fuller MLS coverage:
# RENTCAST_API_KEY=... npm run ingest
```

Ingest uses a wide price band; your criteria sliders filter that down. `ingest:verify` is the freshness gate — it updates ask prices from live CRMLS pages and removes sold/pending/unverifiable rows. `ingest:precompute` caches GIS scores so the map paints matches immediately. Empty scrapes never overwrite existing inventory. Add hand-vetted homes to `data/manual-listings.json`.

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
