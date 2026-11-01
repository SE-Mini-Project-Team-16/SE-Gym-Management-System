# Digital Entry Pass & Dashboard Queries — issue #10

Verified on 1 November 2026 against the integrated application on `main` (`3a23344`). Assigned to `slow-coder35`; requirements NFR-1 and NFR-3.

## Existing implementation verified

The responsive MERN shell already includes a member QR pass screen, staff verification screen, authenticated pass endpoints, and role-scoped dashboard summaries. Dashboard counters use compound indexes and concurrent bounded queries, with five projected upcoming classes, a one-second database query deadline, and a bounded ten-second per-user summary cache. Failed summaries are evicted and simultaneous requests for the same summary share work. Membership/pass checks always read current user state and never rely on dashboard cache entries.

## Changes completing this issue

- Keep an unexpired signed pass visible and downloadable while refreshing. Network errors, HTTP 5xx responses and rate limits trigger retries after 1, 2, 4, 8, 16, then at most every 30 seconds. Each request has a ten-second timeout; returning online or to a visible page triggers recovery immediately. The first failure produces a notification; repeated failures keep an inline status without repeated toasts. Leaving the screen aborts the request and stops recovery.
- A rejected authorization/membership check clears the displayed pass immediately and stops automatic retries. The current expiry still controls display/download during an outage; retaining a code never bypasses the staff endpoint's live membership verification.
- Avoid repeated refreshes in the final seconds of a membership-capped code. Refuse to issue a JWT that would already be expired after timestamps are rounded to whole seconds.
- Require a signed entry-pass token to contain valid issued-at and expiry timestamps with a lifetime of at most 900 seconds. Reject future-issued, missing-expiry, wrong-kind and invalid-subject claims. Staff scans recheck the live role, disabled state and membership expiry without signing an unused replacement token.
- Enforce the local performance threshold on both cold and mixed cached/uncached requests, including each role separately. A fast Member cache cannot hide a slow Admin/Trainer request.

## Validation

| Check | Result |
| --- | --- |
| Integrated baseline before changes | 162 tests passed |
| Full regression suite after changes | 187 tests passed across 12 files |
| Production React/Vite build | Passed |
| Entry-pass unit checks | 15-minute cap, membership cap, same-second expiry, invalid claims and ineligible membership |
| API integration | Pass remains available when dashboard queries fail; failed summary recovers; previously issued passes fail after disable/role changes |
| React recovery checks | Valid code preserved during slow refresh and HTTP 503/429; expired code hidden; 401/403 clear pass without retry; backoff; request timeout; reconnect; membership-capped scheduling; unmount cleanup |

`npm run test:performance` used a real temporary MongoDB database, 1,000 members, 200 bookings, 50 simultaneous users (48 Members, one Admin, one Trainer), and 500 dashboard requests. It exited successfully with zero HTTP errors.

| Role | Requests | p95 | First uncached wave p95 |
| --- | ---: | ---: | ---: |
| Member | 480 | 225 ms | 334 ms |
| Admin | 10 | 145 ms | 145 ms |
| Trainer | 10 | 134 ms | 134 ms |
| Combined | 500 | 218 ms | 334 ms |

All measured p95 values are below the local 1,500 ms threshold. The database and server ran on the same host; these are local smoke results, not a sustained staging/Atlas performance claim. The staff roles each have one cold sample in this short test.

## Deployment acceptance still required

NFR-1's planned staging acceptance uses `tests/performance/dashboard.js`: HTTPS staging, at least 1,000 members/200 bookings, 50 distinct sessions, two-minute warm-up, ten-minute steady state, p95 below 1.5 seconds and less than 1% errors. Include all three roles in the staging sessions.

NFR-3's 24/7 target requires continuously running API/MongoDB instances and the existing `server/scripts/monitor-pass.js` over a continuous 72-hour staging window (availability at least 99.5%). That observation has not been run here. Configure a dedicated active Member lasting beyond the observation and supply monitor credentials through environment secrets. No offline entry authorization or production availability SLA is claimed by this PR.

Run `npm test`, `npm run build`, and `npm run test:performance` from the repository root. See [the application contract](application.md) for index creation, HTTPS deployment and staging monitor configuration.
