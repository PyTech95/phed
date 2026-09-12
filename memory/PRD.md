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

## Surveyor UX iteration (2026-06) — verified 100% (iteration_5.json)
- Dashboard: renamed "PHED Water Bill Survey" -> "Water Severage Bill Survey" and moved it ABOVE the Date-wise Progress calendar. Primary CTA "Water Survey Shuru Karo" now opens the Property MAP (/employee/property-map); added small "Properties List (search)" button.
- Property Map Add Property: added a fixed centre green crosshair (CenterPicker) — panning the map sets the new-property location under the crosshair; tap-to-recentre and "मेरी location" (pan to GPS) also work. Removed old draggable pin.
- WaterSurveyPanel: relationship (Death transfer) and reason (Ownership change) are now dropdowns with common options + "अन्य (Other)" that reveals a free-text input.
- Photos: auto-crop (autoCropDocument, gradient bounding-box, conservative fallback) applied on capture to trim hand/background; tap a photo thumbnail to open an in-app preview modal (check clarity), Close returns to same form.
- Instant submit + background upload: submit() now creates draft -> submits immediately (shows reference no. + done screen fast), then uploads photos in the BACKGROUND (parallel, compressed 2200px/q0.82, 3 retries). Backend upload_attachment now allows uploads while Submitted/Document Pending, blocks only Approved (backend/tests/test_attachment_after_submit.py 3/3 pass).
- Post-submit navigation goes to the MAP (not the list).
- Test surveyor: surveyor1 / Survey@2026 (THS) + 3 seeded field properties.

## Re-deploy into fresh Emergent env — phed-main (2026-06, this workspace)
- Source: `phed-main (1).zip`. Copied backend/, frontend/, tests/, test_reports/ into /app; removed default CRA template.
- /app/backend/.env: fresh 64-hex JWT_SECRET, DB_NAME=MASTER_DB_NAME=phed_survey, TOWN_DB_MODE=single, CORS_ORIGINS=*, ADMIN admin/PhedAdmin@2026, ENV=production, ENABLE_DOCS=false.
- /app/frontend/.env: REACT_APP_BACKEND_URL='' (same-origin /api via Next rewrite).
- pip install requirements.txt; yarn install + `next build` clean; supervisor backend (uvicorn :8001) + frontend (`yarn start` = next start :3000).
- Verified: /api/health ok+db connected, admin seeded, login API + UI OK (lands on /select-town, Thanesar/THS seeded). deployment_agent: PASS, no blockers.
- Next: publish via Emergent "Deploy" button. P2: tighten CORS_ORIGINS to prod domain after go-live.

## Consumer delete + movable pins (2026-06) — verified (iteration_6.json + manual drag check)
- PHED Consumers (admin): row trash `delete-consumer-<id>` → confirm dialog → DELETE /api/phed/consumers/{ref} (also deletes its connections). "Delete all" / "Delete ward data" (`delete-all-consumers-btn`, respects ward filter) → typed DELETE confirmation → POST /api/phed/consumers/delete-all {confirm, ward_id?}.
- Movable pins: new PUT /api/phed/properties/{id}/location {latitude, longitude} (surveyor: assigned/own props via get_property_or_403; admin/officer any). Employee PropertyMap and Admin Map markers draggable → Save/Cancel bar (`move-save-btn`, `admin-move-save-btn`). Cancel remounts marker at old position via key.
- Import uniqueness: already implemented — consumer_id (normalized) is the unique key; existing IDs update, new create; connection numbers unique per service; many consumers may link to one property. No change needed.

## Surveyor pin-adjust + back-to-map fix (2026-06) — verified (iteration_7.json)
- /employee/properties (MapLibre, bottom-nav "Properties"): new pin-adjust mode. Add Property modal → `add-adjust-pin-btn` hides modal, shows draggable red pin (`adjust-pin`) + `pin-bar` (confirm/cancel); confirm sets addLoc and reopens modal. Existing non-completed property modal → `move-pin-btn` → drag → "Save location" → PUT /api/phed/properties/{id}/location.
- WaterSurveyPanel done screen "Map पर वापस जाएँ" now navigates to /employee/properties (was /employee/property-map).
- Surveyor test account: surveyor1 / Survey@2026.

## Import fix: connection numbers unique per consumer (2026-06) — verified (iteration_8.json)
- Bug: importing `software data all og333.xlsx` (26,407 rows) lost ~2,354 water / ~1,823 sewer connections. Cause: import treated (service, connection_number) as globally unique; file has the same numbers (e.g. "1","3","123") under different consumers → skipped as conflicts.
- Fix (phed.py): uniqueness is now (consumer_ref, service, connection_number) in import_validate, _run_import, _add_connection, and survey-created connections. Validate reports `shared_connection_numbers` (info) shown on Import page. Conflicts now only = same number repeated for the SAME consumer in file.
- Real file re-imported: 26,407 consumers, 26,365 water, 13,243 sewer, 0 skipped — matches file exactly. File kept at backend/data/software_data_all_og333.xlsx.

## Deploy into this Emergent env + feature verification — phed-main (3).zip (2026-06)
- Source: `phed-main (3).zip` → copied backend/, frontend/, tests/ into /app (removed CRA boilerplate).
- backend/.env: fresh 64-hex JWT_SECRET, DB_NAME=MASTER_DB_NAME=phed_survey, TOWN_DB_MODE=single, CORS_ORIGINS=*, ADMIN admin/PhedAdmin@2026, ENV=production, ENABLE_DOCS=false.
- frontend/.env: REACT_APP_BACKEND_URL='' (same-origin /api via Next rewrite). pip install + yarn install + `next build` (clean). Supervisor: backend uvicorn :8001, frontend `next start` :3000. deployment_agent: PASS, no blockers.
- Verified E2E on live preview: /api/health ok+db connected; admin + surveyor login; Thanesar (THS) seeded; SPA renders (login → select-town → dashboard) with no console/pageerrors.
- Created surveyor account surveyor1 / Survey@2026 (see test_credentials.md). Seed helper backend/seed_verify_data.py (Ward 1 colonies + 3 properties in Pending/Submitted/Approved + a consumer).

### User's 6 requests — all ALREADY implemented in this build (confirmed):
1. House photo GPS: WaterSurveyPanel `stampPhotoWithGps` burns Lat/Long + date-time onto HOUSE_PHOTO; GPS also sent with the upload.
2. Mandatory fields block submit: `missingCompulsory` + field checks (mobile/owner/colony/relationship/reason) disable Submit; backend submit also requires survey_type + GPS.
3. Point-to-point back: `stepBack` undoes deepest choice first (picked→ownerChange→mode→exit); phone/browser Back hooked via history.pushState + popstate.
4. Ward→colony access: admin Properties "Block Assign Colonies" dialog — pick a Ward (or All), then pick specific colonies within it, assign to employee(s). Backend `assign_ward`/`block-assign-colonies` support single-colony scope.
5. 3-colour map status: red = Pending/not surveyed, yellow = Submitted/Requires Review/Document Pending (reopenable), green = Approved (both employee PropertyMap and admin Map).
6. Office Excel auto-approve: `POST /api/phed/office-import` (admin) matches by PID or Consumer ID → creates an Approved (source=office) survey, sets property phed_survey_status=Approved and LOCKS it (re-open returns 409 "already approved"). Verified via API: THS-0001 → Approved, draft re-open blocked.

### Next: publish via Emergent "Deploy" button. P2: tighten CORS_ORIGINS to prod domain post go-live.

## Survey-based dashboard + map + colour fix (2026-06)
Reported: admin dashboard/property-map showed HOUSE-TAX data (House Open/Lock/Vacant); pin colours didn't change after a survey.
Root causes: (a) AdminMap coloured/counted by house-tax `status`, not `phed_survey_status`; (b) surveyor map cached properties in localStorage 2 min with no invalidation after submit; (c) "No PHED Connection" was treated as green even before approval.
Fixes:
- Backend: new property fields `phed_survey_state` (raw survey status → clean 3-colour) + `phed_outcome` (NEW/LOCKED/DENIED/HAS_CONNECTION) set on submit/approve/office-import/reject/reopen. Added to /map/properties, /map/employee-properties, /employee/properties projections. `/phed/dashboard` now returns `by_outcome` and `by_surveyor` (surveyor-wise total/pending/approved).
- Frontend: employee Properties.js + admin Map.js colour & stats now derive from `phed_survey_state` (red=not surveyed, yellow=Submitted/Requires Review/Document Pending/Draft, green=Approved). Admin map Row-2 stats replaced house-tax (Open/Lock/Vacant) with PHED outcomes (Has/New/Locked/Denied/Rejected/Approved). PhedDashboard: added outcome cards + Surveyor-wise progress table. WaterSurveyPanel busts the surveyor map cache on submit so pin recolours immediately. Frontend rebuilt (`next start` needs build).
- Verified via API: real survey submit → phed_survey_state="Requires Review", outcome=DENIED reflected on surveyor + admin maps; dashboard by_outcome {denied:1, has_connection:1}, by_surveyor lists Surveyor One (1 pending) + Super Admin (1 approved). Dashboard UI renders new cards + surveyor table.

## 4 follow-ups: Approval Queue + Map legend counts + Surveyor leaderboard + Office consumer-link (2026-06)
- Approval Queue: PhedSurveys.js "Approval Queue" toggle (data-testid=approval-queue-toggle) → GET /phed/surveys?queue=pending (Submitted/Requires Review/Document Pending). Inline green Approve button per row (quick-approve-<id>) approves without opening the dialog; row drops on success.
- Map legend counts: new GET /phed/map-summary?colony= returns {red,yellow,green,total} (role-scoped for surveyors). AdminMap shows an always-visible town/colony survey-status bar (map-legend-counts) even before choosing an area; surveyor Properties.js legend now shows live Pending/Submitted/Approved counts.
- Surveyor leaderboard: /phed/dashboard by_surveyor now includes today (submissions since midnight UTC) + target (DAILY_TARGET_DEFAULT=30). Dashboard table adds a "Today / Target" column with a progress bar (green when met). Date-range already supported via existing date_from/date_to filters.
- Office consumer-link: office-import now auto-links a Consumer-ID-only row: match property by phone, then owner-name+colony; if none, CREATE a property (property_id PHED-<consumerid>, source=office) from consumer data, link the consumer, then approve+lock. Response adds auto_linked / created_properties counts. Verified: consumer 4326479 (unlinked) → approved:1, created_properties:1, auto_linked:1.
- All verified via API + Playwright UI (no page errors). Frontend rebuilt (next start).

## 3 more: Bulk Approve + Legend Filter + Location Pending (2026-06)
- Bulk Approve: POST /phed/surveys/bulk-approve {ids[] | all_pending} (reuses shared _approve_survey_doc). PhedSurveys.js adds a select-all header checkbox + per-yellow-row checkbox + "Approve Selected (N)" button (data-testid bulk-approve-btn / select-all-surveys / select-survey-<id>). Verified: bulk approve 1 → green.
- Legend Filter: admin map legend chips (legend-filter-red/yellow/green) toggle-filter the pins by survey colour (surveyColorOf: Approved=green, Completed=yellow, else red); "clear filter" link resets. Uses existing summary counts; always visible even before choosing an area.
- Location Pending: GET /phed/location-pending (office-source properties with no lat/long) + POST /phed/properties/{id}/location. New page /admin/phed/location-pending (LocationPending.js) with list + a Leaflet click-to-place / "Use my location" dialog to set GPS, then it drops off the list. Nav item added in AdminLayout (permission: map). Verified: PHED-4326479 located → list 0, map-summary green:4.
- All verified via API + Playwright UI (no page errors). Frontend rebuilt (next start).

## 3 more: Approve-All + Bulk Locate + Surveyor legend filter (2026-06)
- Approve All Pending: PhedSurveys.js queue mode shows "Approve All Pending (N)" (data-testid approve-all-pending-btn) → POST /phed/surveys/bulk-approve {all_pending:true} (confirm dialog). Verified in UI.
- Bulk Locate: POST /phed/location-pending/bulk-locate {ids[] | all_pending} places office properties at their colony centre (mean GPS of already-located props in same colony, tiny jitter so pins don't stack); skips colonies with no reference. LocationPending.js adds row checkboxes + "Auto-place selected (N)" + "Auto-place all at colony centre" (bulk-locate-selected / bulk-locate-all / loc-select-all). Verified: 2 office props in Sector 5 → located 2, pending 0.
- Surveyor legend filter: employee Properties.js legend chips (surveyor-legend-red/yellow/green) tap to filter map pins by status (visibleMarkers respects mapFilter) + "clear". Verified in UI.
- All verified via API + Playwright (no page errors). Frontend rebuilt (next start).

## Review columns + PHED search (2026-06)
- PhedSurveys.js review table: Property ID → Consumer ID (water.consumer_id / first connection no.), added Name (water.new_owner_name || consumer_name || owner), removed GPS column, kept Ref no. + Surveyor. Type now shows the surveyor's outcome via surveyTypeLabel(): NO_CONNECTION / water.new_connection → "New Connection", property_locked → "Property Locked", owner_denied → "Owner Denied", else the type label. Admin list search also matches water.consumer_id/consumer_name/new_owner_name/connection_numbers.
- Water Survey tab (PhedFieldSurvey.js) search is now PHED-based: debounced call to /phed/consumers/search matches Consumer ID / connection no. / phone / name and surfaces the linked property (union with property-field match); a search overrides the pending-only filter. Placeholder updated. Property tab search unchanged (property fields).
- Verified via API + Playwright: table shows 4326479 / Suman Devi / New Connection / Ramesh Kumar; surveyor search "4326479" surfaces the linked property. No page errors. Frontend rebuilt (next start).

## Surveyor property-search mobile number (2026-09-12)
- Surveyor Property Map search dropdown (`frontend/src/views/employee/Properties.js`) now shows a clear `Property ID: <id>` line and a second, phone-icon line: `Mobile: <number>`.
- The search hint now explicitly includes mobile numbers. When a property has no recorded number, the dropdown shows `Mobile: उपलब्ध नहीं` instead of a blank gap.
- Created the documented test surveyor `surveyor1` / `Survey@2026`, assigned to Thanesar (THS), Ward 1, and seeded three assigned verification properties.
- Verified on the mobile preview as surveyor: searching `THS` returned 3 results and displayed `Mobile: 9000000003` on the first result. Production frontend build completed successfully.

## Simplified PHED dashboard + Today Report (2026-09-12)
- Main PHED Dashboard is now grouped into three scannable sections: Property reporting; PHED consumers & services; and Survey report.
- Removed the non-actionable `Total Connections` dashboard card. Kept Total Existing/Target/Pending/In Progress properties; added clear Total Consumers (PHED), Water Connections, Sewer Connections; and retained only useful field outcomes: completed, linked/not linked, no connection, new PHED connection, already verified, property locked, and owner denied.
- Added `GET /api/phed/dashboard/today`: UTC today-only submitted work, in-progress drafts, approval status, outcome totals, linked-property count, surveyor-wise breakdown, and the 50 most recent submitted property reports.
- Added `/admin/phed/today` and the `Today's PHED Report` sidebar item. The page offers daily metric groups, a surveyor-work table, submitted-property detail, and manual refresh.
- Verified by testing agent (backend + desktop/mobile frontend): 100% pass. Main dashboard no longer includes `Total Connections`; daily endpoint is authenticated and returns all expected fields; both pages have no page-level mobile overflow; surveyor mobile-search flow continues working.

## Mobile PHED survey workflow hardening (2026-09-12)
- Confirmed root cause: the surveyor PHED dashboard counted only surveys created by the current user, while the map counted the PHED state of all assigned properties. `backend/phed.py` now uses the assigned-property PHED state for both scopes, with the invariant `total = pending + in progress + done`.
- Confirmed root cause: the Water Supply Survey list had an early text-search return that bypassed the surveyor's Pending filter. Search now respects Pending/All consistently; Draft and Document Pending are correctly excluded from Pending.
- `frontend/src/views/employee/Properties.js`: added stable result IDs, keyboard blur on selection, visible no-results/load errors, stale-fetch guard, return-to-search context after survey Back, separate pending/in-progress/submitted/approved counts, visualViewport-aware count strip, and internal horizontal scrolling for narrow phones.
- `frontend/src/views/employee/PhedFieldSurvey.js`: added clearable/abortable PHED search, row-wide keyboard-safe selection, actionable missing-property error, strict status filters, and an explicit Pending selection action rather than silently opening a nearest property. `Dashboard.js` refreshes PHED summaries on focus/return and `WaterSurveyPanel.js` emits the saved event after cache invalidation.
- Confirmed already working before the fix: map result to Start Survey already constructed the exact property UUID route and opened the correct Water Bill Survey form. It is now additionally verified with prefilled Property ID, owner, colony, and mobile details.
- Safe test evidence: only seeded record `THS-0001` was submitted once as Property Locked, creating reference `PL0001`. QA confirmed exactly one non-rejected survey, no duplicate, map/list/dashboard refresh, authenticated API guards, and no page-level overflow at 360, 390, and 412 CSS pixels. Actual Android hardware Back/IME was not available; equivalent browser visualViewport and blur behavior was verified.

## PHED Survey Review filters and decision detail (2026-09-12)
- Kept Review's existing search, status, ward, and surveyor filters. Added typed case-insensitive Colony search, inclusive From/To submitted-date filters, and a `Connection / field decision` filter.
- The new decision filter covers Property locked, Owner denied, Water connection, Sewer connection, Already connection, New connection, Death transfer, and Ownership change. `GET /api/phed/surveys` now validates and combines these filters with other query filters without changing survey data.
- Review rows now show Consumer ID, Reference number, Name, Mobile, Ward, Colony, Surveyor, the actual field connection/decision, Status, Submitted date, and actions. Consumer ID never falls back to a connection number; New Connection is explicitly labelled when the survey result is new.
- Verified by testing agent: backend 9/9 and frontend 100%. Date + Property Locked returned only safe record `PL0001` with actual data (mobile 9000000001, ward 27, colony Didar Nagar, Surveyor One); all eight decision filters validate, colony matching is trimmed/case-insensitive, unauthenticated access is denied, and 390px has no page-level overflow.

## Survey Review MC vs PHED comparison (2026-09-12)
- Opening a PHED Survey Review record now presents a clear two-part comparison: `MC property details` on the left and `PHED & surveyor details` on the right; it stacks in the same readable order on mobile.
- The surveyor decision is now prominent in both the header and PHED panel, using the actual recorded outcome (Property Locked, Owner Denied, Death/Ownership Transfer, New Connection, Water/Sewer/Already Connection). The PHED panel retains the submitted consumer/mobile/connection values and linked PHED master record.
- MC panel shows independent property ID, owner, mobile, ward, colony, address, serial number, and MC status so differences can be reviewed rather than hidden. Survey GPS, remarks, documents/PDF, document-pending indicator, and admin approval/return/reject controls remain below the comparison.
- Verified by testing agent: 100% frontend pass at desktop and 390px, no overflow/errors, all requested fields for `PL0001` correct, exact decision precedence covered by 17/17 unit tests, and no survey records modified. The displayed MC Ward 1 vs survey Ward 27 difference is intentionally visible as a review comparison.

## PHED Excel-first Water Survey linking + branding refresh (2026-09-12)
- Confirmed root cause: surveyor Water Survey started from assigned MC properties (`/employee/properties`) and only performed PHED lookup as a secondary search. It now starts from a paginated PHED master/Excel consumer queue via `GET /api/phed/survey-consumers`.
- Surveyor flow is now: search PHED Consumer ID / connection / phone / name → select PHED record → type and select an assigned MC Property ID → attach it with explicit confirmation → open that exact Water Survey form with PHED Consumer ID, consumer name, water/sewer connection numbers, and mobile prefilled.
- The new backend endpoint excludes survey-created records, handles raw legacy Excel field fallbacks, and applies server-side surveyor scope to assigned properties and colonies. Existing `link_consumer` authorization remains the final guard; unlink remains admin-only.
- Added `PhedSurveyConsumerList.js` and `PhedConsumerPropertyLinker.js`; updated `PhedFieldSurvey.js` orchestration and `WaterSurveyPanel.js` PHED prefill. Replaced the shared `/public/phed-logo.png` with the user-supplied official Haryana PHED logo and refreshed admin brand panel plus surveyor header/bottom navigation styling.
- Verified by testing agent: backend 4/4 and frontend 100%. Surveyor found Suman Devi / 4326479 PHED master data, attached it to THS-0003 via the UI, got exact PHED prefill in Water Survey, and the test's admin cleanup restored Suman to unlinked state. Logo, all three bottom tabs, 390px responsiveness, and no-console-errors also passed.

## Property Map MC + PHED survey detail (2026-09-12)
- Confirmed root cause: Admin Property Map's `View Survey Data` called only the legacy MC `/submission/by-property` endpoint. Pure PHED-completed properties therefore opened an empty legacy modal despite having PHED survey data.
- `GET /api/map/properties` now batch-enriches markers with linked PHED Consumer ID, name, and mobile while preserving all existing MC fields. Each map popup visibly separates `MC property` information from `PHED linked data` before the detail action.
- The map action now loads both the PHED property-detail endpoint and the legacy submission endpoint; PHED detail is preferred whenever a PHED survey or linked consumer exists, while legacy MC survey detail remains as fallback. New `PhedMapSurveyDetails.js` shows Property ID/owner/ward/colony/address, PHED Consumer ID/name/mobile, Water/Sewer values, surveyor, decision, status, reference, submission time, remarks, GPS, and document count.
- Testing agent verified backend 5/5 and frontend 100%: THS-0001 opens MC + PHED sections with `PROV-THS-0001`, reference `PL0001`, `Submitted`, and `Property Locked`; auth guards remained intact and no data was changed. A 19px overflow root cause in the map legend row was then fixed with responsive wrapping; final retest shows zero page overflow before and after detail dialog opening at 390px and desktop.
