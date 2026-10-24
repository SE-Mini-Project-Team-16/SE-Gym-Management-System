# Local validation

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
