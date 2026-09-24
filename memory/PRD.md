# PHED Survey & Notice Distribution System — Deployment PRD

## Original Problem Statement
Deploy the existing `phed` project to managed hosting (React + FastAPI + MongoDB), hardened against the usual prod-breaking issues.

## What This App Is
Public Health Engineering Department (Haryana) field-survey & notice-distribution platform for Thanesar town. Multi-tenant (town-scoped) admin + field-staff system.

### User Personas
- ADMIN / Super Admin: dashboards, PHED consumers, surveys, Excel imports, employees, towns, audit log, MC property/bills, PDF exports.
- SUPERVISOR / MC_OFFICER: scoped admin views (permission-gated).
- EMPLOYEE / SURVEYOR: field survey capture (GPS geofence, Aadhaar photo, signatures), attendance, submissions.

## Architecture
- Frontend: Next.js 15.5 production build (`next start` on :3000) hosting the original React SPA (`src/`) via catch-all `app/[[...slug]]` (force-dynamic, client-only). Same-origin relative `/api` calls.
- Backend: FastAPI (`backend/server.py` + `phed.py` + helpers), uvicorn on :8001 (supervisor). JWT auth (access+refresh), bcrypt, slowapi rate limiting, GridFS file storage, multi-tenant town DBs (single-DB mode).
- DB: local MongoDB, database `test_database` (master == town DB in single mode).
- Config: MONGO_URL, DB_NAME, JWT_SECRET, ADMIN_USERNAME, ADMIN_PASSWORD, TOWN_DB_MODE=single, ENV=production.

## Verified Features & Deployment Status
- Phase 0 (Audit): Unpacked and confirmed complete folder layout, resolved packages, verified no hardcoded localhost in frontend, confirmed MongoDB connection.
- Phase 1 (Config & Secrets): Centralized environment configuration in .env, JWT secret generated with 64-hex entropy, admin credentials securely seeded from env.
- Phase 2 (Backend Hardening): CORS configured, `/api` prefix on all routes, binds to 0.0.0.0, `/api/health` endpoint live.
- Phase 3 (Frontend Build): Production optimized Next.js build created and tested.
- Phase 4 (Verification): Health check returns `status: ok`, admin authentication tested, seeded Thanesar town with 32 wards / 192 colonies.
- 2026-09-23 (Surveyor map fix): User reported surveyor map flashed correct colours for ~1s then showed only Pending. Root cause: `frontend/src/views/employee/Properties.js` `visibleMarkers` returned pending-only markers when map zoom < 13 (initial zoom 17 → fit-bounds zoomed out → non-pending pins vanished). Fix: removed the pending-only zoom branch; all statuses (red/yellow/green) now render at every zoom with a 2000-pin safety cap. Verified in browser as surveyor1: 2 green + 1 yellow + 2 red markers stable across t=4s/12s/27s (including 15s live-refresh). Backend unchanged.
- 2026-09-24 (Map fix v2 for big datasets): plain slice(0,2000) still hid done pins because sortedProperties is pending-first (VPS: 3056 pending / 549 done). Fix: visibleMarkers now always includes ALL non-pending pins first, then fills remaining capacity with pending. Verified via logic replica with VPS-scale mock (549 green + 3 amber + 1448 red = 2000 shown, zero surveyed dropped) and live browser check.
- 2026-09-24 (Colony-based access assignment): User reported admin /admin/properties "Bulk Assign by Area" dropdown was empty (data is colony-only; /api/admin/areas returned only distinct ward). Fixes: (1) /admin/areas now returns union of distinct ward+colony; (2) POST /admin/assign-bulk matches area against ward OR colony (incl. auto-copy props_count check); (3) GET /admin/properties ward param matches ward OR colony ($and+$or to coexist with search). Frontend labels updated to "Area / Colony". Verified by curl: colonies listed, count by colony works, bulk-assign by colony 'Kirti Nagar' assigned 3 properties to surveyor2.
- NOTE: phed.nstuindia.com is the user's own VPS running an OLD build. These fixes exist in this repo; VPS needs: replace changed files (backend/server.py, frontend/src/views/employee/Properties.js, frontend/src/views/admin/Properties.js), `yarn build`, restart backend+frontend, and users should hard-refresh / clear site data (no service worker present).
- 2026-09-24 (Multi-town access): User created new town 'थानेसर BHD' (55,180 props + 26,407 PHED records on VPS) and could not give any surveyor access — users had a single assigned_town, so existing workers were invisible in the new town's assign dialogs and got 403 there. Fix: `extra_town_ids` grants on user docs. Backend: get_accessible_towns() helper (assigned + extras) used by login, /auth/me, get_current_user (town 403 check); /admin/users + /admin/employee-progress town filters include extra_town_ids; create/update user validate + store grants. Frontend: Employees.js 'Additional town access' checkbox list in Add/Edit dialogs. Verified end-to-end: granted surveyor1 BHD access (THS untouched), login returns THS+BHD, BHD APIs 200, admin BHD assign dialog lists surveyor1, bulk-assign by colony works in BHD.
- 2026-09-24 (Bulk Assign Colonies stuck on 'Loading colonies...'): Same ward-only class of bug — GET /admin/colonies returned only distinct('ward') (empty on colony-only towns); frontend showed 'Loading colonies...' whenever list empty. Fixes: /admin/colonies unions distinct ward+colony; block-assign-colonies and block-unassign-colonies match ward OR colony; frontend added coloniesLoading state (empty after load now shows 'कोई colony नहीं मिली'). Verified by curl in BHD town: colonies listed, 3 props assigned then unassigned by colony.
- 2026-09-24 (Ward numbers hidden from colony lists): Per user request, colony dropdowns/checklists no longer mix in ward numbers ('1','17','Ward 1'...). New helper `_distinct_area_names()` (colony preferred per record, ward only as fallback when colony empty, pure ward numbers / 'Ward N' filtered out) now powers /admin/areas and /admin/colonies; /map/colonies aggregation updated the same way. Verified: BHD returns 145 clean colony names (0 ward numbers), THS regression clean, map colonies clean. No frontend change needed (lists are server-driven). User uploaded real 'MC PHED DATA.xlsx' (cols: TOWN, PID, ONWER, COLONY NAME, MOBILE NO; 55,180 rows). upload_batch didn't recognise those headers → colony='', owner='Unknown', property_id=random on their VPS import. Fix: normalized header matching (lowercase alnum) + variants PID, ONWER/Owner, 'Colony Name'/colony_name/Locality (Excel + CSV paths). Verified by uploading the real file into BHD town here (batch 'MC PHED TEST', 55,180 records): real PIDs/owners/colonies stored; /admin/colonies lists 150+ real colonies. VPS ACTION NEEDED: old 55,180-record batch there has colony lost (unrecoverable — join key never stored) → after deploying new build, DELETE the old batch in the new town and re-upload the same Excel.

## Prioritized Backlog
- P1: Monitor initial real user survey submissions and PDF exports.
- P2: Configure custom domain if requested.
