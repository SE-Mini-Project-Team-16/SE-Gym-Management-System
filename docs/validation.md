# Local validation — 22 October 2026

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
