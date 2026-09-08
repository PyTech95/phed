# PRD — PHED95007 (Public Health Engineering Department: Survey & Notice Distribution)

## Original Problem Statement
Deploy an archived full-stack project (`PHED95007-main.zip`) into this Emergent environment safely, from zip to live. Confirm real stack, scan for secrets, reproduce a clean build, move config to env vars, run under production settings, and verify end-to-end. User instruction: "deploy here" (Emergent hosting).

## Architecture (as deployed here)
```
Browser ──> ingress ──┬── /api/*  ──> FastAPI (uvicorn) 0.0.0.0:8001  ──> MongoDB
                      └── /*      ──> Next.js 15 (next start) :3000  ──> React SPA (src/, client-side)
```
- Frontend: Next.js 15 at `/app/frontend` (supervisor `frontend`, `next start -H 0.0.0.0 -p 3000`). Serves the original CRA React SPA under `src/` via `app/[[...slug]]` (dynamic import, ssr:false). API calls are same-origin `/api` (`REACT_APP_BACKEND_URL=''` inlined by next.config.js).
- Backend: FastAPI at `/app/backend` (supervisor `backend`, uvicorn 0.0.0.0:8001). 149 endpoints, JWT auth, slowapi rate limiting, GridFS uploads, multi-tenant (single-town mode here).
- `instrumentation.js` neutered (no-op) so Next does not spawn a second uvicorn — supervisor owns the backend.
- DB: local MongoDB, DB_NAME `phed_survey`, single-town mode.

## Config / Secrets (all in env, none hardcoded)
- `/app/backend/.env`: MONGO_URL, DB_NAME, MASTER_DB_NAME, TOWN_DB_MODE=single, CORS_ORIGINS=*, JWT_SECRET (64 hex), ADMIN_USERNAME, ADMIN_PASSWORD, ENV=production, ENABLE_DOCS=false.
- No committed secrets found in the zip (no `.env` committed). JWT secret freshly generated on deploy.

## Credentials (see /app/memory/test_credentials.md)
- Admin: `admin` / `PhedAdmin@2026` (seeded from env on first boot).
- Surveyor `surveyor1` / `Survey@2026`: create via Admin → Employees (not auto-seeded).

## Done (2026-06)
- Phase 0 inspect: mapped stack, scanned secrets (none committed).
- Phase 1 build: backend deps installed, FastAPI boots, `/api/health` = {status:ok, db:connected}. Frontend production build clean.
- Phase 2 env: all config moved to `/app/backend/.env`; secrets generated.
- Phase 3 deploy: backend under uvicorn (no --reload in prod intent, supervisor-managed), frontend `next start`, same-origin API (no CORS surface).
- Verified E2E: admin login (UI + API), towns seeded (Thanesar/THS), PHED dashboard renders, admin endpoints 200. Testing agent 100% backend + frontend. deployment_agent: PASS, no blockers.

## Backlog / Remaining (P1/P2)
- P2: Auto-select town when admin has a single accessible town (skip /select-town). Existing app behavior; non-blocking UX.
- P2: Tighten CORS_ORIGINS to the real production domain after first live deploy (currently `*`, safe because same-origin + Bearer auth, no cookies).
- P2: Optionally create the `surveyor1` test account via Admin → Employees for surveyor-flow testing.

## Next Tasks
- Publish via Emergent "Deploy" when ready.

## Data Import + Suggestion Search (2026-06)
- Imported user data into town Thanesar (THS), ward 1: 26,407 PHED consumers (from `software data all og.xlsx`) and 1,024 properties (from `didar nagar.xlsx`, colony Didar Nagar).
- Root cause of "search not working": no data had been imported (0 consumers) — the empty state looked like broken search.
- Added ranked suggestion/autocomplete search:
  - Backend `phed.py` `GET /api/phed/consumers/search`: fetches name/father-name **prefix** matches first, then broader substring matches, then Python relevance sort (exact > name-prefix > word-prefix > substring). Verified: `q=RAM` -> RAM SARUP, RAMESH KUMAR at top; exact consumer_id -> match=='exact'.
  - Frontend `PhedConsumers.js`: debounced dropdown (`data-testid=consumer-suggestions`, items `suggest-<id>`) under the search box; clicking a suggestion opens the consumer detail. Table below still live-filters.
- Verified 100% by testing agent (iteration_2.json).
- Known minor (optional, not done): `/api/admin/properties?search=` doesn't match the `colony` field (use `colony=` filter instead).

## Property colony search + Auto-link upgrade (2026-06)
- Property search: `/api/admin/properties` and `/api/employee/properties` `search=` now also matches `colony` and `address` (previously only property_id/owner_name/mobile). "Didar" -> 1024 rows.
- Auto-link (consumer -> property) upgraded in `phed.py` `link_suggestions()`:
  - Now scans ALL unlinked consumers (was capped at 300) — 26,407 scanned.
  - Added strong signal: consumer phone == property mobile -> "high" confidence ("phone match"); junk numbers (repeated digit / <7 len) skipped.
  - Kept address+owner-name token fallback ("address & name"). Results sorted high-confidence first, capped by `limit`.
  - Each suggestion now carries a `reason`; UI shows it under the confidence badge. Apply flow (`/link-suggestions/apply`) links selected + persists.
  - Note: endpoint takes ~15-20s (scans 26k) — acceptable for a manual admin bulk action; could be backgrounded/cached later.
- Verified 100% by testing agent (iteration_3.json).

## Import "+0 consumers" clarified + sample template (2026-06)
- Reported: importing `PHED DIDAR NAGAR.xlsx` (3103 rows) showed "Completed · +0 consumers, +0 conn" → looked like nothing imported.
- Root cause (confirmed via validate): file is 100% valid, but all 3103 consumers already existed (imported earlier via master `software data all og.xlsx`). So import = created 0, **updated 3103**, 320 conflicts. Old UI only showed the *created* count → misleading. Data was never lost.
- Fix: `PhedImport.js` import history/result now shows `+N new, M updated, K skipped consumers · +C conn · Q conflicts` (green when created+updated>0), and an amber "Nothing saved" warning with reason (invalid rows need Consumer ID + Consumer Name) only when created+updated==0.
- New: downloadable sample template — backend `GET /api/phed/import/sample` (admin) + "Download sample file" button (`download-sample-btn`) on the import page. Template has the 10 expected headers + example rows.
- Verified 100% by testing agent (iteration_4.json).
- Minor known (optional): `/api/phed/imports` capped at 100, no pagination.
- VPS note: these are code changes on the Emergent preview; the user's own VPS must redeploy the updated code to get them. Their DIDAR data is already present in the DB regardless.

## Re-deploy into fresh Emergent env — PHED20078 (2026-06)
- Source: PHED20078-main.zip. Same stack as prior PRD (FastAPI + Next.js 15 + local MongoDB).
- Steps done: copied backend/ + frontend/ into /app; created /app/backend/.env (fresh 64-hex JWT_SECRET, DB_NAME=phed_survey, ADMIN admin/PhedAdmin@2026, ENV=production, ENABLE_DOCS=false, CORS_ORIGINS=*); frontend/.env REACT_APP_BACKEND_URL='' (same-origin).
- Installed backend requirements.txt; yarn install + `next build` (clean). Backend via supervisor uvicorn :8001; frontend `next start` :3000.
- Verified: /api/health = {ok, db connected}; admin login (API + UI) OK; Thanesar/THS town seeded; select-town renders. deployment_agent: PASS, no blockers.
- To publish: use Emergent "Deploy" button.
