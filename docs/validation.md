# Local validation

## Issue #5 — 24 October 2026

Configure Automated Daily Database Backups (NFR-2, TC-REL-01, ST-07, SV-10), validated on Node.js 24 with a temporary MongoDB 8.2 database.

| Check | Result |
| --- | --- |
| Full Vitest suite | 105 tests passed across 7 test files |
| Backup & Recovery test suite (`backup.test.js`) | 7 passed: snapshot creation with all collections/indexes, clean database full restore with record count & sample verification, SHA-256 tampering detection, safe permission enforcement, automatic retention pruning, scheduled runner, and disconnected database error handling |
| Production frontend bundle | Vite build passed (244ms) |
| CLI Verification | `npm run backup`, `npm run restore`, and `npm run backup:verify` run cleanly via `server/scripts/backupJob.js` |

## Issue #2 — 24 October 2026

Member registration and password hashing (REQ-1, NFR-4), validated on Windows with Node.js 24.22.1 and a real temporary MongoDB 8.2.6 database.

| Check | Result |
| --- | --- |
| Full Vitest suite, sequential files | 98 tests passed across 6 files |
| Registration API tests | 32 passed: field boundaries, Unicode byte limits, hidden credential storage, cost-12 bcrypt and salt uniqueness, privilege-field injection, normalization, concurrent duplicate emails, existing login integration, JSON enforcement and throttling |
| Registration React tests | 8 passed: accessible fields, payload allowlist, password confirmation, byte limit, successful return to sign-in, duplicate/rate-limit errors, pending-submit guard, network-error recovery |
| Production frontend bundle | Vite build passed |
| Existing authentication suite on Windows | Unix socket argument is now omitted on Windows; all 21 tests pass |
| Browser smoke check | Not completed: local browser connection timed out; responsive rendering needs manual verification |

The local runner used dependencies installed in a parent scratch directory because Windows denied npm workspace symlink creation. No dependency manifests or lockfiles were changed. The full suite was run with `vitest run --no-file-parallelism` and the production frontend with Vite. CI retains the repository's `npm ci`, `npm test`, and `npm run build` workflow.

These checks validate the API and form behavior locally; they do not establish production rate-limit capacity or deployment acceptance. Registration requires the unique email index before production traffic. No Sprint 2 booking changes are included.

## Earlier issue #1 validation — 22 October 2026

Scope: issue #1. These are local development results, not production SLA evidence.

| Check | Result |
| --- | --- |
| `npm test` | 37 tests passed across real-MongoDB API integration, cache behavior and React interactions |
| `npm run build` | Production Vite build passed |
| Browser smoke check | Chromium: member sign-in, dashboard, QR entry pass, equipment navigation and admin member directory |
| Responsive layout | 375×812, 768×1024, 1366×900; dashboard/pass screens fit without page-level horizontal overflow |
| Local performance fixture | 1,000 members, 200 bookings; Admin, Trainer and Member sessions |
| Local concurrency / requests | 50 simultaneous users, 500 dashboard requests |
| Local latency | p50 49 ms; p95 154 ms; first uncached wave p95 224 ms |
| Local HTTP errors | 0 |

The performance smoke test uses a real temporary MongoDB database, on the same machine as the API, and includes both uncached and cached requests. It does not include a WAN/Atlas connection, reverse proxy, or a sustained 10-minute load. Re-run the supplied k6 test on provisioned staging before accepting NFR-1. Run the entry-pass monitor for the specified 72-hour observation before accepting NFR-3. Validate the deployed TLS configuration separately for NFR-6; Firefox/Safari and full team UAT remain outstanding.

## Issue #6 — class booking API (2026-10-30)

- Added `POST /api/bookings`, member-owned booking creation, atomic conditional slot decrement, transactional booking persistence, and a partial unique Active member/class index.
- Added 18 real-MongoDB integration cases in `server/tests/bookings.test.js`, including TC-BK-01/02/03, concurrent duplicate requests, rollback after persistence failure, access controls, and malformed/unavailable classes.
- `npm run build`: passed.
- `git diff --check` and JavaScript syntax checks for the new handler/test: passed.
- `npm test`: 45 tests passed; 78 tests skipped across three failed suite setups. The new booking suite, existing API suite, and existing registration suite could not start MongoDB in this execution environment (`open: Operation not permitted`, process exit 100). The 18 new integration cases have not been verified as passing. A separate attempt with MongoDB 7.0.24 encountered the same startup error.
- Run the full suite in CI or a local environment that permits MongoDB startup before merging. Production also requires Atlas/a replica set and creation of the `unique_active_member_class` index; reconcile any existing duplicate Active member/class records and slot counts first.
