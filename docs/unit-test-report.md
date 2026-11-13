# 🧪 Unit Test Report

**Project:** Gym Management System (GMS)  
**Deliverable:** Part-3 Deliverable 2.b.i  
**Team 16 · PES University · 5th Semester Software Engineering Lab**  
**Execution Date:** 12 November 2026  
**Test Framework:** Vitest v5.0.5 with JSDOM and mongodb-memory-server  

---

## 1. Executive Summary

This report documents the execution and validation of all unit and component-level test suites for the Gym Management System. The unit test suite validates isolated business logic, data models, controllers, middleware, utility helpers, and client-side UI components without external network dependencies.

| Metric | Result | Status |
|:---|:---:|:---:|
| **Total Test Suites** | 12 | ✅ 100% Passed (12/12) |
| **Total Unit & Component Tests** | 194 | ✅ 100% Passed (194/194) |
| **Failed Tests** | 0 | 0% |
| **Skipped / Queued Tests** | 0 | 0% |
| **Total Execution Duration** | ~6.5 seconds | Highly performant |
| **Execution Environment** | Node.js v22 (Mac OS / Ubuntu CI) | Verified |

---

## 2. Test Execution Methodology

Unit testing was performed using the following structured approach:
1. **Isolated Execution Environment:** An in-memory replica set (`mongodb-memory-server` / `MongoMemoryReplSet`) was spun up dynamically per test suite to isolate test data and support MongoDB multi-document transactions.
2. **Component & Mocking Strategy:** 
   - Backend routes and controllers were exercised using `supertest` against the Express application gateway (`createApp`).
   - Mock sessions and time anchors (`Date.now()`, `vi.useFakeTimers()`) were applied to test expiring JWT tokens, 15-minute rolling digital entry passes, and rate-limiting thresholds.
   - Frontend UI units were rendered with `@testing-library/react` under a simulated JSDOM environment, stubbing network `fetch` calls.
3. **Assertion & Verification:** Strict HTTP status assertion, JSON schema validation, database record inspection, and cryptographic cost checks.

---

## 3. Suite-by-Suite Test Execution Breakdown

```
Test Files  12 passed (12)
Tests       194 passed (194)
Duration    6.57s
```

### 3.1 Backend Suites (9 Test Files, 165 Tests)

#### Suite 1: `server/tests/api.test.js` (30 Tests)
* **Scope:** API Gateway validation, health probes, public endpoint allowlists, JSON header enforcement, error handling middleware, production HTTPS redirects.
* **Key Tests Executed:**
  - Reports database readiness (`/api/health`) with JSON and Helmet security headers.
  - Rejects malformed, expired, or tampered JWT sessions with HTTP 401.
  - Issues login sessions without exposing password hashes.
  - Enforces `application/json` Content-Type on mutating payloads (415 Unsupported Media Type).
  - Enforces rate-limiting throttles returning standardized JSON.
  - Production HTTP redirect to HTTPS origin with 308 Permanent Redirect.
  - Digital entry pass issuance, verification, and rejection for disabled accounts.

#### Suite 2: `server/tests/auth-rbac.test.js` (21 Tests)
* **Scope:** Authentication security, strict HS256 algorithm enforcement, RBAC authorization matrix, anti-enumeration mitigations.
* **Key Tests Executed:**
  - `REQ-SEC-01 / SV-01`: Rejects missing, non-Bearer, expired, incorrect secret, and `alg: none` unsigned tokens.
  - Rejects entry pass tokens when supplied as API session tokens.
  - Rejects tokens belonging to deleted or disabled accounts.
  - `REQ-SEC-02 / NFR-5 / SV-02`: Full role matrix on `/api/users/delete` and `/api/revenue/view` (Admin: 200, Trainer: 403, Member: 403, Anonymous: 401).
  - Verifies target data is unchanged upon 403 rejection.
  - `NFR-4 / SV-04`: Verifies bcrypt cost factor $\ge 10$ (enforced at cost 12).
  - `SV-08`: Anti-enumeration: returns identical generic error messages for nonexistent emails and wrong passwords; triggers HTTP 429 when attempt threshold is exceeded.

#### Suite 3: `server/tests/registration.test.js` (32 Tests)
* **Scope:** User registration validation, field boundaries, database indexing, race condition mitigation.
* **Key Tests Executed:**
  - `REQ-1`: Trims and normalizes fields; stores cost-12 bcrypt hash.
  - Rejects duplicate email registrations across lowercase and uppercase variations (409 Conflict).
  - Strips mass-assignment attempts (`role: "Admin"`, `tier: "VIP"`).
  - Concurrency test: simultaneous registration attempts with the same email result in exactly 1 created user and 1 HTTP 409 rejection.
  - Independent salting: identical passwords produce distinct hash strings.
  - Boundaries: Appendix B limits (names $\le 50$, email $\le 100$, phone $\le 15$, password 12–64 characters / 72 UTF-8 bytes).

#### Suite 4: `server/tests/bookings.test.js` (23 Tests)
* **Scope:** Class slot reservation, capacity control, transactional concurrency, member booking cancellation, and IDOR protection.
* **Key Tests Executed:**
  - `TC-BK-01`: Valid booking confirms and atomically decrements `availableSlots` by 1.
  - `TC-BK-02`: Full class booking rejected with HTTP 400.
  - `TC-BK-03`: Concurrency race on last available slot: exactly 1 member succeeds, 1 member rejected.
  - Transaction rollback: simulated database failure rolls back slot reservation.
  - Duplicate booking rejection: partial unique index blocks duplicate active bookings.
  - `TC-SEC-08`: Member booking cancellation: cancels active booking, restores slot count (`$inc: { availableSlots: 1 }`).
  - `TC-SEC-08 (IDOR)`: Member A cannot cancel Member B's booking (rejected with 403 Forbidden).
  - Rejects double-cancellation and past-class cancellation.

#### Suite 5: `server/tests/class-cancellation.test.js` (16 Tests)
* **Scope:** Class cancellation lifecycle, RBAC enforcement, member notifications dispatch.
* **Key Tests Executed:**
  - `TC-CL-01`: Admin cancels class; status is set to `Cancelled`, active bookings transitioned to `Cancelled`, member notifications dispatched.
  - `TC-CL-02`: Trainer cancels own class session; notifications dispatched.
  - `TC-CL-03`: Unauthorized cancellation: regular Member or foreign Trainer rejected with HTTP 403.
  - Rejection of already cancelled or past classes.

#### Suite 6: `server/tests/equipment-tickets.test.js` (19 Tests)
* **Scope:** Maintenance ticket logging, auto-generation of ticket IDs, role-based equipment filtering.
* **Key Tests Executed:**
  - `TC-EQ-01`: Staff submits maintenance ticket for valid inventory ID; returns HTTP 201 with `ticketId`.
  - `TC-EQ-02`: Rejection of non-existent equipment inventory ID or empty description.
  - `TC-EQ-03 / 04`: Status transitions between `Available` and `Under Maintenance`.
  - Verifies `GET /api/equipment` automatically excludes `Under Maintenance` items for Member users while staff can view all.

#### Suite 7: `server/tests/backup.test.js` (7 Tests)
* **Scope:** Daily backup creation, SHA-256 tamper detection, retention pruning, automated restore.
* **Key Tests Executed:**
  - `NFR-2 / TC-REL-01`: Generates gzip-compressed backup with custom collection indexes and SHA-256 manifest.
  - Verifies restore into a clean database, matching document counts and collection schemas.
  - `SV-10`: Detects tampered backup archives through SHA-256 checksum comparison.
  - Enforces `0700` POSIX directory permissions.
  - Verifies automated retention pruning preserving the latest backup snapshot.

#### Suite 8: `server/tests/pass.test.js` (14 Tests)
* **Scope:** 24/7 Digital Entry Pass token issuance, membership expiry gating, verification.
* **Key Tests Executed:**
  - `NFR-3`: Issues rolling 15-minute HS256 tokens (`gms-entry`).
  - Clamps token expiry to membership expiry if membership expires within 15 minutes.
  - Rejects expired memberships, disabled accounts, and non-Member roles.
  - Verifies pass tokens correctly for staff and rejects pass token usage as API session tokens.

#### Suite 9: `server/tests/cache.test.js` (3 Tests)
* **Scope:** Dashboard LRU summary caching, request coalescing, TTL expiration.
* **Key Tests Executed:**
  - `NFR-1`: Coalesces concurrent dashboard queries under 10-second TTL.
  - Evicts oldest entry when reaching maximum cache bound (500 entries).

---

### 3.2 Frontend Suites (3 Test Files, 29 Tests)

#### Suite 10: `client/src/App.test.jsx` (12 Tests)
* **Scope:** Responsive UI shell, navigation drawer, dashboard statistics, toast notification accessibility, member booking & cancellation controls, staff controls.
* **Key Tests Executed:**
  - `TC-UI-01`: Accessible toast alerts for login failures and confirmations (`aria-live="polite"`).
  - Renders valid QR entry pass for active members and hides QR for expired members.
  - Mobile menu toggle and navigation state transitions.
  - Member class booking flow: renders "Book class" button, dispatches `POST /api/bookings`, transitions to disabled "Booked ✓".
  - Member booking cancellation: renders "Cancel booking", dispatches cancellation API, updates status to "Cancelled".
  - Admin class cancellation controls and equipment maintenance modal interactions.

#### Suite 11: `client/src/EntryPass.test.jsx` (9 Tests)
* **Scope:** Digital entry pass client lifecycle, auto-refresh intervals, connectivity recovery.
* **Key Tests Executed:**
  - `TC-AVL-01`: Auto-refreshes code 30 seconds prior to expiration.
  - Implements bounded exponential backoff upon network interruption.
  - Re-fetches pass immediately on `online` and `visibilitychange` events.
  - Aborts in-flight requests on unmount to avoid memory leaks.

#### Suite 12: `client/src/RegistrationForm.test.jsx` (8 Tests)
* **Scope:** Sign-up form validation, Appendix B boundary checks, error alerts.
* **Key Tests Executed:**
  - Client-side validation for name length, email format, phone digits, and password length.
  - Displays error toast and allows retry on 409 duplicate email.
  - Transitions to sign-in screen upon successful registration.

---

## 4. Defect Tracking & Resolution

| Defect ID | Description | Severity | Resolution Status |
|:---:|:---|:---:|:---:|
| **DEF-01** | Missing member-facing "Book class" button in frontend schedule list | Medium | **Resolved** — Added interactive booking button with slot check and `Booked ✓` state. |
| **DEF-02** | Absence of member booking cancellation endpoint | Medium | **Resolved** — Implemented `POST /api/bookings/:id/cancel` with atomic slot recovery and IDOR protection. |
| **DEF-03** | `body-parser` trailing bytes DoS vulnerability in npm audit | High | **Resolved** — Updated `body-parser` to v2.4.0 (0 vulnerabilities). |

---

## 5. Conclusion & Verdict

The unit test suite achieves **100% pass rate** across all 194 tests. Every core module demonstrates robust error handling, concurrency safety, boundary enforcement, and defense-in-depth security. The unit test suite is fully automated and integrated into GitHub Actions CI.

