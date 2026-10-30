# Application contract — issue #1

## Ownership and integration seams

`client/` is React + Vite + Tailwind. `server/src/app.js` builds the Express app independently of the network listener, so Supertest exercises the actual middleware/routes. `server/src/server.js` owns MongoDB connection, startup, and graceful shutdown.

Issue #2 adds registration and registration-time bcrypt hashing to the existing issue #3 login and authentication/role middleware. Registration returns a public user record; members then use the existing login endpoint and session JWT format. Registered and seeded passwords use bcrypt cost 12.

Shared Mongoose models live in `server/src/models.js`:

| Model | Integration fields |
| --- | --- |
| User | `firstName`, `lastName`, normalized unique `email`, hidden `passwordHash` and `phoneNumber`, `role` (`Admin`, `Trainer`, `Member`), `tier` (`Basic`, `Premium`, `VIP`), `membershipExpiresAt`, `disabled` |
| GymClass | `name`, `trainerId`, `startsAt`, `durationMinutes`, `capacity`, `availableSlots`, `status` (`Open`, `Cancelled`) |
| Booking | `memberId`, `classId`, `status` (`Active`, `Cancelled`) |
| Equipment | unique `inventoryId`, `name`, `category`, `status` (`Available`, `Under Maintenance`) |

Issue #4 implements membership renewal using a clearly labeled demo checkout in local development and Razorpay Standard Checkout when explicitly configured. Successful renewal updates `User.tier` and extends `User.membershipExpiresAt`; the pass becomes available on the next request with no cache invalidation. All timestamps are UTC instants; the UI formats them in the browser's timezone. Issue #6 implements member booking creation; issue #7 owns class cancellation and notifications; issue #8 owns inventory/ticket mutations. Add new routers before the authenticated API 404 handler. Counts can lag writes by at most 10 seconds; explicitly invalidate or remove the summary cache if stronger consistency is needed.

## JSON API

Same-origin `/api` avoids exposing permissive CORS. All requests with bodies must use `Content-Type: application/json` (16 KB maximum). API responses use `Cache-Control: no-store`. API errors use `{ "error": true, "message": "…", "code": 400 }`. Registration, login and health are public; all other API routes require `Authorization: Bearer <session>`.

| Method | Route | Access | Response |
| --- | --- | --- | --- |
| GET | `/api/health` | Public readiness | `status`, `database`; 503 when disconnected |
| POST | `/api/auth/register` | Public, 10 attempts per IP per 15 minutes | JSON registration fields → 201 `{ user }`; 400 invalid fields, 409 duplicate email, 429 throttled |
| POST | `/api/auth/login` | Public, throttled | JSON `email`, `password` → `token`, `user` |
| GET | `/api/me` | Signed in | `user` |
| GET | `/api/dashboard` | Signed in | `user`, role-scoped `stats`, at most 5 `upcomingClasses` |
| GET | `/api/members` | Admin | `items`, first 50 members, no email/password |
| POST / DELETE | `/api/users/delete` | Admin | JSON `userId` or `:id` → delete confirmation or 403 |
| GET | `/api/revenue/view` | Admin | Total revenue & breakdown by tier or 403 |
| GET | `/api/classes` | Signed in | `items`, next 50 open classes (own classes for Trainer) |
| POST | `/api/bookings` | Member | JSON `classId` → 200 `{ status: "success", bookingId, remainingSlots }`; 400 unavailable/invalid class, 404 missing class, 409 duplicate active booking |
| GET | `/api/bookings` | Signed in | `items`, latest 50 (own for Member; own classes for Trainer) |
| GET | `/api/equipment` | Signed in | `items`, first 50 inventory IDs (available only for Member) |
| GET | `/api/passes/me` | Active Member | `token`, `expiresAt`, `member` display metadata |
| POST | `/api/passes/verify` | Admin / Trainer | JSON `token` → `valid: true`, `member`, or 403 |
| POST | `/api/payments/orders` | Member | JSON `tier` (`Basic`, `Premium`, `VIP`) → server-created demo or Razorpay order |
| POST | `/api/payments/verify` | Member | Demo result (`orderId`, `outcome`) or Razorpay callback → ownership and payment verification |
| POST | `/api/payments/webhook` | Razorpay signature | Raw `payment.captured` event; duplicate captured payments are idempotent |

`PAYMENT_MODE` defaults to `demo` outside production and is rejected in production. The demo checkout displays a no-real-payment notice, collects no payment details, and offers simulated success/failure; only the success action updates the member. To use Razorpay instead, set `PAYMENT_MODE=razorpay` and provide `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`. Existing tier prices are INR (₹30/₹60/₹100; values sent to Razorpay are paise). The browser Checkout callback is verified with the server-created order ID, then the server fetches the payment and requires `status: captured`, matching order, amount and currency. `RAZORPAY_WEBHOOK_SECRET` verifies the exact raw body for `payment.captured` events. Both confirmation paths use a MongoDB transaction and unique order/payment receipts, so retries cannot extend expiry twice. `MEMBERSHIP_DURATION_DAYS` defaults to 30. MongoDB must support transactions (Atlas or replica set); `DEMO_DATABASE=true` starts a single-node in-memory replica set. Receipts store gateway references, amount/currency, tier, and applied expiry; card details are never stored or logged. For a public Razorpay deployment, configure `/api/payments/webhook` and subscribe to `payment.captured`.

No endpoint accepts a caller-provided member ID for pass ownership. Session JWTs require HS256, issuer `gms`, audience `gms-api`, and a valid MongoDB user ID in `sub`. Roles are read from the database on every request, not trusted from client state. Disabled/deleted accounts cannot continue using old sessions.

### Class booking contract — issue #6 / REQ-3

`POST /api/bookings` accepts a 24-character hexadecimal `classId`. The authenticated Member owns the booking; supplied `memberId`, `status`, capacity, and slot fields are ignored. Admins and Trainers receive 403, missing/invalid sessions and disabled accounts receive 401. This endpoint implements class capacity enforcement; membership activation remains the payment workflow.

An open, future class with `availableSlots > 0` is reserved using a single conditional `findOneAndUpdate` and `$inc: { availableSlots: -1 }`. The slot decrement and Active booking insert run in the same MongoDB transaction, with snapshot reads and majority writes. Concurrent transactions retry through the driver; at the last slot only one reservation commits. Any failed booking insert aborts the slot decrement. The response is sent only after commit and reports the remaining slots at that reservation, not a guarantee that later requests have not changed them.

The `unique_active_member_class` partial unique index enforces one Active booking per member/class across requests and API instances. A repeat attempt returns 409 without consuming a slot. Cancelled historical records do not prevent a new booking. Booking a full, cancelled, or started class returns 400 per the architecture contract; a valid but unknown class ID returns 404. Existing booking list ownership filters apply to newly created records. Class cancellation/notifications and booking UI changes are outside issue #6.

**Deployment:** MongoDB must be Atlas or a replica set (the existing demo database already is one). Before enabling traffic, run `npm run indexes -w server` to build the partial unique index. If existing data has duplicate Active member/class pairs, reconcile those records and their class slot counts before retrying index creation; the index command fails rather than silently deleting records. No existing records are changed automatically. Summary counts can lag a booking by the existing 10-second dashboard cache TTL; `/api/classes` and `/api/bookings` read the database directly.

`server/tests/bookings.test.js` uses a real single-node MongoDB replica set and the actual authenticated Express endpoint. It covers TC-BK-01/02/03, ten-member contention for five places, concurrent duplicate requests, rollback after an injected insert failure, database-enforced uniqueness, cancelled history, invalid/missing/unavailable classes, staff/anonymous/disabled-account rejection, and caller-supplied ownership. Run `npx vitest run server/tests/bookings.test.js` or the complete `npm test` suite.

### Registration contract — REQ-1 / NFR-4

Send `firstName`, `lastName`, `email`, `phoneNumber`, and `password` as strings. Names are trimmed and must contain 1–50 characters. Email is trimmed, lowercased, checked for basic email syntax, and limited to 100 characters after trimming. Phone numbers preserve leading zeros and contain 1–15 ASCII digits. Passwords are used exactly as supplied: 12–64 JavaScript string code units and at most 72 UTF-8 bytes, avoiding bcrypt truncation. The UI also requires matching password confirmation; confirmation is never sent to the server.

The handler allowlists these five fields. Extra fields, including `role`, `tier`, `membershipExpiresAt`, `disabled`, caller-supplied IDs and `passwordHash`, are ignored. Every self-registered account starts with `role: Member`, `tier: Basic`, `disabled: false`, and no membership expiry. Tier selection and payment activation remain separate trusted workflows. No session token is issued at registration; sign in through `/api/auth/login` afterward.

Passwords are salted and hashed asynchronously with bcrypt cost 12 before the user document is inserted. Responses use the shared user sanitizer and never expose passwords, hashes, or phone numbers. Phone numbers are hidden by default in model queries and remain optional for existing/seeded accounts; the registration endpoint requires them for new accounts. This avoids making legacy users invalid.

The existing **unique email database index** is the source of truth for duplicate detection, including concurrent requests. Duplicate inserts return a standard 409 error without changing the original account. Before accepting production registration traffic, run `npm run indexes -w server` to create the index; existing duplicate emails must be resolved if index creation fails. Registration and login have independent in-memory rate limiters. Deployments with multiple API instances should provide a shared limiter store or enforce a global limit at the trusted proxy.

Registration does not activate a membership, implement booking/cancellation, or change the existing staff provisioning flow. The current UI escapes names when displaying them; clients must continue treating user-supplied names as text.

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

### Automated Database Backups & Restore — NFR-2 / TC-REL-01 / ST-07 / SV-10

The system provides an automated, self-contained database backup and recovery job in `server/src/backupJob.js` with CLI commands in `server/scripts/backupJob.js`. It requires no external host binaries (e.g. `mongodump`), functioning across Linux, macOS, Windows, CI runners, and cloud database instances.

1. **Snapshot Structure**:
   - Each backup generates an isolated snapshot directory: `backups/snapshot-<ISO-TIMESTAMP>/`.
   - Collections are exported to compressed, canonical extended JSON archives (`<collection>.json.gz`) using `bson.EJSON` to preserve BSON data types (`ObjectId`, `Date`, etc.).
   - Collection indexes are extracted and recorded in `metadata.json` for faithful recreation during restore operations.
   - Each collection archive has a SHA-256 integrity checksum recorded in `metadata.json`, alongside an overall combined snapshot checksum.
2. **Access Control & Safe Storage (SV-10)**:
   - The backup directory root defaults to `./backups` (configurable via `BACKUP_DIR`).
   - Snapshot directories and files are written with restricted permissions (`0700` directory / `0600` file modes).
   - The directory is placed outside web server document roots (`client/dist` and `client/public`), and is ignored by git (`.gitignore`).
3. **Automated Pruning & Retention**:
   - Older snapshots exceeding `BACKUP_RETENTION_DAYS` (default 7 days) are automatically pruned on each backup run.
   - The most recent snapshot is never pruned regardless of age to avoid empty backup states.
4. **Commands**:
   - `npm run backup`: Creates an immediate timestamped backup snapshot with SHA-256 verification and retention cleanup.
   - `npm run restore [-- <path>]`: Restores collections and indexes to the database, verifying pre-restore checksums and post-restore record counts.
   - `npm run backup:verify [-- <path>]`: Verifies SHA-256 checksums across all snapshot archives without touching the live database.
   - `npm run backup:schedule -w server`: Runs the automated daily backup scheduler daemon (default 24h interval via `BACKUP_INTERVAL_HOURS`).

## Requirement checks and limits

| Requirement | Delivered checks | Remaining staging acceptance |
| --- | --- | --- |
| UI-1 | React interaction tests for login errors, navigation, pass rendering and expired-state behavior; manual browser sizes 375, 768, 1366 | Latest Firefox/Safari compatibility and team UAT |
| NFR-6 | Integration tests for JSON/error contracts, media-type enforcement, headers and trusted-proxy HTTPS redirection | Certificate/TLS 1.2+ test on deployed hostname |
| NFR-1 | Real-MongoDB integration suite, bounded cache tests, and `npm run test:performance` with 1,000 members / 200 bookings / 50 simultaneous users | `tests/performance/dashboard.js`: k6 2-minute warm-up + 10-minute steady state, p95 < 1.5 s, errors < 1% |
| NFR-2 | Vitest suite (`server/tests/backup.test.js`) verifying daily snapshot creation, clean database restore, checksum tampering rejection, retention pruning, and scheduled execution (TC-REL-01, ST-07, SV-10) | Execution of daily backup job on staging Atlas cluster and quarterly disaster recovery drill |
| NFR-3 | Active/expired/disabled/tampered/revoked pass tests; session/pass separation; automatic UI refresh | `server/scripts/monitor-pass.js`: 72-hour staging observation, availability ≥ 99.5% |

For k6, provide HTTPS `BASE_URL` and `SESSION_TOKENS` as an environment-only JSON array of 50 distinct signed-in sessions, against dedicated seeded staging data. Run `k6 run tests/performance/dashboard.js`; keep tokens out of source, command history, and logs. Sessions last one hour, longer than this 12-minute test. The native smoke benchmark is shorter and is not the staging acceptance result.

For the availability monitor, provide HTTPS `BASE_URL`, `MONITOR_EMAIL` and `MONITOR_PASSWORD` via your environment/secret manager, using a dedicated Member with membership lasting beyond the entire observation. Run `node server/scripts/monitor-pass.js`. The monitor refreshes expired login sessions, samples once a minute, and logs only time/status/counts/availability. Default duration is 72 hours. Never treat a short local run as proof of the 72-hour target.

