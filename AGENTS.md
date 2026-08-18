# Househunter — South Bay

Interactive real-estate map SPA (React 19 + Leaflet + TypeScript, built with Vite). See `README.md` for product details and data-ingest scripts.

## Cursor Cloud specific instructions

- This is a **pure client-side SPA** — there is no backend server and no database. The only service to run is the Vite dev server (`npm run dev`, port `5173`). The app is fully functional offline because listing/safety data is committed under `public/data/`.
- No lint tooling and no automated tests exist. Validation is limited to `npm run typecheck` (`tsc -b --noEmit`) and `npm run build` (`tsc -b && vite build`). Do not assume a `lint` or `test` script exists.
- **End-of-turn gate (required):** After meaningful code changes, run `npm run typecheck` and `npm run build`, smoke-check the Vite app (`npm run dev` on port `5173` — `/` and `/data/listings.json` should return 200). **If that passes, merge the working branch into `main` and push `main`** so GitHub Pages can redeploy. Do not leave a green, user-facing change only on a feature branch.
- No `.env` is required to boot. Env vars in `.env.example` (`RENTCAST_API_KEY`, `RAPIDAPI_KEY`, `VITE_ORS_API_KEY`, etc.) only affect optional offline ingest scripts and the optional OpenRouteService isochrone provider. The app runs without them.
- User criteria and drive anchors persist in **browser localStorage** (and optional gitignored `public/private-prefs.json` for local/dev). Do not commit personal addresses; use Export/Import prefs to move them between devices. Public defaults in `src/data/anchors.ts` are intentionally generic.
- Several map features (Valhalla drive-time isochrones, ocean-viewshed elevation lookups, geocoding, EPA walkability) call third-party public APIs live from the browser. These enhance features but are not required to load; precomputed scores are already baked into `public/data/listings.json`. Expect these calls to fail or be rate-limited in a sandboxed/offline network, without blocking the core UI.
- The `ingest:*` and `build:safety` scripts are offline, on-demand data generators (not part of running/testing the UI). `npm run ingest:market` / `ingest:sereno` / `ingest:all` use Playwright, which needs browsers installed separately (`npx playwright install chromium`) — not installed by `npm install`.
- **Free inventory path:** `npm run ingest:sereno` (or `INGEST_SERENO_ONLY=1 npm run ingest:all`) is the primary CRMLS source. It queries neighborhood subsections + ZIPs and price-band-splits any 200-row-capped response. Prefer local runs; Redfin/MB Confidential often return 0/403 from cloud IPs. Use `SERENO_SKIP_ENRICH=1` for a fast search-only merge, then full enrich + `INGEST_PRECOMPUTE=1` when committing inventory.
