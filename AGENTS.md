# Househunter — South Bay

Interactive real-estate map SPA (React 19 + Leaflet + TypeScript, built with Vite). See `README.md` for product details and data-ingest scripts.

## Cursor Cloud specific instructions

- This is a **pure client-side SPA** — there is no backend server and no database. The only service to run is the Vite dev server (`npm run dev`, port `5173`). The app is fully functional offline because listing/safety data is committed under `public/data/`.
- No lint tooling and no automated tests exist. Validation is limited to `npm run typecheck` (`tsc -b --noEmit`) and `npm run build` (`tsc -b && vite build`). Do not assume a `lint` or `test` script exists.
- No `.env` is required to boot. Env vars in `.env.example` (`RENTCAST_API_KEY`, `RAPIDAPI_KEY`, `VITE_ORS_API_KEY`, etc.) only affect optional offline ingest scripts and the optional OpenRouteService isochrone provider. The app runs without them.
- Several map features (Valhalla drive-time isochrones, ocean-viewshed elevation lookups, geocoding, EPA walkability) call third-party public APIs live from the browser. These enhance features but are not required to load; precomputed scores are already baked into `public/data/listings.json`. Expect these calls to fail or be rate-limited in a sandboxed/offline network, without blocking the core UI.
- The `ingest:*` and `build:safety` scripts are offline, on-demand data generators (not part of running/testing the UI). `npm run ingest:market` / `ingest:sereno` use Playwright, which needs browsers installed separately (`npx playwright install`) — not installed by `npm install`.
