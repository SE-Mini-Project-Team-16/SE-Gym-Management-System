# Application contract — issue #1

## Ownership and integration seams

`client/` is React + Vite + Tailwind. `server/src/app.js` builds the Express app independently of the network listener, so Supertest exercises the actual middleware/routes. `server/src/server.js` owns MongoDB connection, startup, and graceful shutdown.

The minimal login adapter and authentication/role middleware make this foundation independently runnable. Issue #3 can extend or extract them; issue #2 owns registration and registration-time bcrypt hashing. Do not add alternate token formats. No registration or user mutation endpoint is implemented here. The seeded hashes use bcrypt cost 12.

Shared Mongoose models live in `server/src/models.js`:

| Model | Integration fields |
| --- | --- |
| User | `firstName`, `lastName`, normalized unique `email`, hidden `passwordHash`, `role` (`Admin`, `Trainer`, `Member`), `tier` (`Basic`, `Premium`, `VIP`), `membershipExpiresAt`, `disabled` |
| GymClass | `name`, `trainerId`, `startsAt`, `durationMinutes`, `capacity`, `availableSlots`, `status` (`Open`, `Cancelled`) |
| Booking | `memberId`, `classId`, `status` (`Active`, `Cancelled`) |
| Equipment | unique `inventoryId`, `name`, `category`, `status` (`Available`, `Under Maintenance`) |

Issue #4's verified payment handler must update `User.membershipExpiresAt`; the pass becomes available on the next request with no cache invalidation. All timestamps are UTC instants; the UI formats them in the browser's timezone. Issues #6/#7 own booking and cancellation mutations; issue #8 owns inventory/ticket mutations. Add new routers before the authenticated API 404 handler. Counts can lag writes by at most 10 seconds; explicitly invalidate or remove the summary cache if stronger consistency is needed.

## JSON API

Same-origin `/api` avoids exposing permissive CORS. All requests with bodies must use `Content-Type: application/json` (16 KB maximum). Successful reads return JSON with `Cache-Control: no-store`. API errors use `{ "error": true, "message": "…", "code": 400 }`. Login and health are public; all other API routes require `Authorization: Bearer <session>`.

| Method | Route | Access | Response |
| --- | --- | --- | --- |
| GET | `/api/health` | Public readiness | `status`, `database`; 503 when disconnected |
| POST | `/api/auth/login` | Public, throttled | JSON `email`, `password` → `token`, `user` |
| GET | `/api/me` | Signed in | `user` |
| GET | `/api/dashboard` | Signed in | `user`, role-scoped `stats`, at most 5 `upcomingClasses` |
| GET | `/api/members` | Admin | `items`, first 50 members, no email/password |
| GET | `/api/classes` | Signed in | `items`, next 50 open classes (own classes for Trainer) |
| GET | `/api/bookings` | Signed in | `items`, latest 50 (own for Member; own classes for Trainer) |
| GET | `/api/equipment` | Signed in | `items`, first 50 inventory IDs (available only for Member) |
| GET | `/api/passes/me` | Active Member | `token`, `expiresAt`, `member` display metadata |
| POST | `/api/passes/verify` | Admin / Trainer | JSON `token` → `valid: true`, `member`, or 403 |

No endpoint accepts a caller-provided member ID for pass ownership. Session JWTs require HS256, issuer `gms`, audience `gms-api`, and a valid MongoDB user ID in `sub`. Roles are read from the database on every request, not trusted from client state. Disabled/deleted accounts cannot continue using old sessions.

Entry pass JWTs use `PASS_SECRET`, audience `gms-entry`, `kind: entry-pass`, member ID in `sub`, and a maximum 900-second lifetime. A pass cannot act as an API session. Staff verification repeats the live eligibility check; changing the membership expiry, disabling/deleting the user, or changing their role immediately rejects an existing pass. Every instance must share the same secrets. Rotating `PASS_SECRET` invalidates all issued passes.

The independent pass endpoint makes pass retrieval available without a successful dashboard load. It deliberately fails closed during database failure. Availability requires a continuously running API and healthy MongoDB; this change alone does not establish a 24/7 deployment SLA.

## Dashboard query strategy

- Query the User compound index `(role, disabled, membershipExpiresAt)` for admin membership summaries.
- Query `(status, startsAt)` or `(trainerId, status, startsAt)` for bounded upcoming classes.
- Query `(memberId, status, classId)` for a member's active booking count and `(status, inventoryId)` for available equipment.
- Fetch counters/upcoming classes concurrently; use `lean()`, field projections, 1-second query deadlines and a 20-connection pool.
- Cache only completed/in-flight summaries, keyed by role and user ID, for 10 seconds; evict errors and cap the cache at 500 keys. HTTP responses are not cached. Multiple application instances keep independent bounded summary caches.

Build indexes before production traffic:

```sh
npm run indexes -w server
```

This creates declared indexes without dropping existing ones. Production disables automatic index creation. Review database execution plans and provision the Atlas tier for the agreed load; indexes and caching do not guarantee latency on an undersized or cold deployment.

## Production deployment

1. Provision MongoDB 7+ / Atlas with restricted network access and a least-privileged database user. Set `MONGODB_URI`, distinct random `JWT_SECRET` / `PASS_SECRET`, `NODE_ENV=production`, and `PUBLIC_ORIGIN=https://<your-gym-host>`. Do not enable demo mode or use demo accounts in production.
2. Run `npm ci`, `npm test`, `npm run build`, then create the database indexes. Start with `npm start` under a process supervisor. The app serves the built frontend and JSON API from the same origin.
3. Terminate TLS at a reverse proxy on the same host as the API, forwarding to `127.0.0.1:4000`. Restrict the API port from external access. Set `TRUST_PROXY=1` **only** for exactly one trusted proxy that overwrites forwarded headers; otherwise leave it off. With a trusted proxy, HTTPS requests are recognized and HTTP requests redirect to `PUBLIC_ORIGIN`, never a user-supplied Host.
4. Configure the proxy for TLS 1.2/1.3, a valid certificate, HTTP-to-HTTPS redirection, `Host`, and an overwritten `X-Forwarded-Proto`. Helmet supplies HSTS and security headers; the reverse proxy owns TLS negotiation. `deploy/nginx.conf.example` shows the intended boundary.
5. Use an always-on hosting tier, health/readiness monitoring, database replicas and the team's backup job. Remove instance sleep/scale-to-zero for the availability target. Configure restarts/rolling deployments; handle secret rotation as a coordinated change.

The development listener uses loopback HTTP intentionally. External HTTPS, certificates, Atlas credentials, daily backups and production uptime require deployment work outside these issues.

## Requirement checks and limits

| Requirement | Delivered checks | Remaining staging acceptance |
| --- | --- | --- |
| UI-1 | React interaction tests for login errors, navigation, pass rendering and expired-state behavior; manual browser sizes 375, 768, 1366 | Latest Firefox/Safari compatibility and team UAT |
| NFR-6 | Integration tests for JSON/error contracts, media-type enforcement, headers and trusted-proxy HTTPS redirection | Certificate/TLS 1.2+ test on deployed hostname |
| NFR-1 | Real-MongoDB integration suite, bounded cache tests, and `npm run test:performance` with 1,000 members / 200 bookings / 50 simultaneous users | `tests/performance/dashboard.js`: k6 2-minute warm-up + 10-minute steady state, p95 < 1.5 s, errors < 1% |
| NFR-3 | Active/expired/disabled/tampered/revoked pass tests; session/pass separation; automatic UI refresh | `server/scripts/monitor-pass.js`: 72-hour staging observation, availability ≥ 99.5% |

For k6, provide HTTPS `BASE_URL` and `SESSION_TOKENS` as an environment-only JSON array of 50 distinct signed-in sessions, against dedicated seeded staging data. Run `k6 run tests/performance/dashboard.js`; keep tokens out of source, command history, and logs. Sessions last one hour, longer than this 12-minute test. The native smoke benchmark is shorter and is not the staging acceptance result.

For the availability monitor, provide HTTPS `BASE_URL`, `MONITOR_EMAIL` and `MONITOR_PASSWORD` via your environment/secret manager, using a dedicated Member with membership lasting beyond the entire observation. Run `node server/scripts/monitor-pass.js`. The monitor refreshes expired login sessions, samples once a minute, and logs only time/status/counts/availability. Default duration is 72 hours. Never treat a short local run as proof of the 72-hour target.
