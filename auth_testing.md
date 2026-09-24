# Existing JWT authentication regression checklist

No credentials, password hashing, JWT format, token lifetimes, or storage mechanism were changed.
Use `/app/memory/test_credentials.md`; read the external URL from frontend/.env.

## Playbook checks
1. MongoDB: verify existing users have bcrypt password hashes and login_attempts indexes remain intact. Never print hashes/secrets into reports.
2. API: POST /api/auth/login using the existing username/password JSON contract; use the returned access token as Authorization Bearer for GET /api/auth/me.
3. Verify /auth/me returns the same identity and accessible_towns independently of stale X-Town-Code. Identity discovery does not read town data.
4. Protected town-data APIs must still reject surveyors for towns outside assigned_town + extra_town_ids.
5. Verify logout/account change, persisted invalid town, valid extra-town selection, refresh, and login redirects. No public-town fallback after authenticated lookup failure.
6. No auth credential changes are required. Use existing accounts; document any temporary accounts if created.