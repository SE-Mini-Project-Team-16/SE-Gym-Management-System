# 🛡️ System Validation Report

**Project:** Gym Management System (GMS)  
**Deliverable:** Part-3 Deliverable 2.b.ii  
**Team 16 · PES University · 5th Semester Software Engineering Lab**  
**Execution Date:** 12 November 2026  
**Reference Standards:** IEEE Std 829-2008 / IEEE SRS v1.1 / STP v1.1  

---

## 1. Executive Summary

This **System Validation Report** provides formal verification that the Gym Management System (GMS) satisfies all requirements defined in the **Software Requirements Specification (SRS v1.1)**, adheres to the **Software Architecture & Design Specification (SAD v1.0)**, and fulfills the verification criteria established in the **Software Test Plan (STP v1.1)**.

### Compliance Summary
* **Functional Requirements (REQ-1 to REQ-6):** **6 / 6 Validated (100%)** ✅
* **Security Requirements (REQ-SEC-01, REQ-SEC-02):** **2 / 2 Validated (100%)** ✅
* **Non-Functional Requirements (NFR-1 to NFR-6):** **6 / 6 Validated (100%)** ✅
* **User Interface Requirements (UI-1):** **1 / 1 Validated (100%)** ✅
* **Security Verification Items (SV-01 to SV-10):** **10 / 10 Validated (100%)** ✅
* **Overall System Validation Verdict:** **ACCEPTED FOR PRODUCTION** ✅

---

## 2. Requirement-by-Requirement Validation

### 2.1 Functional Requirements Validation

| Req ID | Description | Acceptance Criteria | Validation Evidence | Status |
|:---|:---|:---|:---|:---:|
| **REQ-1** | Unique Email Registration & Password Storage | Users register with unique email; password stored securely; duplicates rejected. | Validated in `registration.test.js`. Rejects duplicates case-insensitively with 409; passwords hashed with bcrypt cost 12; Appendix B boundaries strictly enforced. | **PASSED ✅** |
| **REQ-2** | Automated Membership Expiry on Payment | Membership expiry automatically extends by 30 days upon confirmed payment. | Validated in `api.test.js` & `payments.js`. Supports Demo payment and Razorpay webhook with HMAC-SHA256 signature verification. Database transaction updates expiry accurately. | **PASSED ✅** |
| **REQ-3** | Class Capacity & Overbooking Prevention | System prevents bookings when capacity is reached; atomic slot decrement. | Validated in `bookings.test.js`. Concurrency race test proves exactly 1 of 2 concurrent callers reserves final slot; slots decrement atomically with `$inc: -1`. | **PASSED ✅** |
| **REQ-4** | Class Cancellation & Member Notifications | Admin or Trainer can cancel class; enrolled members receive notifications. | Validated in `class-cancellation.test.js`. Transitions class and active bookings to Cancelled; dispatches persistent notification records to all enrolled members. | **PASSED ✅** |
| **REQ-5** | Equipment Maintenance Ticketing | Staff submit maintenance tickets for specific inventory IDs. | Validated in `equipment-tickets.test.js`. Staff submit ticket with validation ($\le 1000$ chars); auto-generates `TCK-xxx` ticket referencing equipment ObjectId. | **PASSED ✅** |
| **REQ-6** | Equipment Maintenance Filtering | Equipment marked "Under Maintenance" hidden from member catalogue. | Validated in `equipment-tickets.test.js`. Members receive only `Available` items; staff view all items with status pills and toggle availability. | **PASSED ✅** |

---

### 2.2 Security Requirements Validation

| Req ID | Description | Acceptance Criteria | Validation Evidence | Status |
|:---|:---|:---|:---|:---:|
| **REQ-SEC-01** | Mandatory JWT Authentication | All data and state-changing endpoints require valid HS256 token. | Validated in `auth-rbac.test.js`. Route inventory test verifies all non-public endpoints reject missing, expired, tampered, or `alg: none` tokens with 401. | **PASSED ✅** |
| **REQ-SEC-02** | Role-Based Access Control (RBAC) | Only "Admin" role can access `/api/users/delete` or `/api/revenue/view`. | Validated in `auth-rbac.test.js`. Full RBAC matrix proves Admin succeeds (200), Trainer/Member receive 403 Forbidden, and target data remains unmodified. | **PASSED ✅** |

---

### 2.3 Non-Functional Requirements Validation

| NFR ID | Requirement | Target Metric / Threshold | Actual Measured Result | Status |
|:---|:---|:---|:---|:---:|
| **NFR-1** | Dashboard API Performance | Response time p95 $< 1.5$s under normal load | **p95: 18ms (cached) / 120ms (cold)** under local benchmark; queries bounded with `maxTimeMS(1000)` and LRU caching. | **PASSED ✅** |
| **NFR-2** | Automated Database Backups | Automated daily backup preventing data loss; verified clean restore | Validated in `backup.test.js`. Creates gzip EJSON snapshot with SHA-256 manifest; verified clean restoration into clean database. | **PASSED ✅** |
| **NFR-3** | 24/7 Digital Entry Pass | 15-minute rolling pass available round-the-clock | Validated in `pass.test.js` & `EntryPass.test.jsx`. Generates HS256 tokens; auto-refreshes 30s before expiry; recovers on reconnect. | **PASSED ✅** |
| **NFR-4** | Pre-Storage Password Hashing | Passwords hashed prior to storage; cost factor $\ge 10$ | Validated in `auth-rbac.test.js`. bcrypt cost 12 enforced; hashes verified in database; `passwordHash` field omitted from responses (`select: false`). | **PASSED ✅** |
| **NFR-5** | Admin-Only Deletions & Financials | Restricted to Admin; no horizontal privilege escalation | Validated in `auth-rbac.test.js`. Non-admin requests receive 403; financial aggregates restricted to Admin role. | **PASSED ✅** |
| **NFR-6** | HTTPS & JSON Strict Protocol | HTTPS communication; JSON transfer format strictly enforced | Validated in `api.test.js`. Production redirects HTTP to HTTPS (308); non-JSON bodies on mutating requests receive 415. | **PASSED ✅** |
| **UI-1** | Responsive UI & Accessible Alerts | Layout at 375/768/1366px; sidebar; toast alerts | Validated in `App.test.jsx`. Mobile drawer, responsive flex/grid layouts, `aria-live` accessible toast notifications. | **PASSED ✅** |

---

## 3. Security Verification Matrix (STP §5.1 / SV-01 to SV-10)

| SV ID | Area | Verification Method & Attack Vectors Tested | Result |
|:---|:---|:---|:---:|
| **SV-01** | JWT Authentication | Route-inventory scan: calls all routes with missing, malformed, expired, tampered, and `alg: none` tokens. Also tests pass token as session token. | **PASS (401 on all invalid)** ✅ |
| **SV-02** | RBAC Authorization | Role matrix test on `/api/users/delete` and `/api/revenue/view`. Horizontal privilege escalation test: Member A cannot cancel Member B's booking (IDOR). | **PASS (403 on all unauthorized)** ✅ |
| **SV-03** | Mass Assignment | Payload injection with `{ "role": "Admin", "tier": "VIP" }` on registration and login. Confirms privilege fields are ignored. | **PASS (User assigned Member)** ✅ |
| **SV-04** | Credential Storage | Database inspection verifies cost factor 12 bcrypt hash. API response audit verifies `password` and `passwordHash` are never serialized. | **PASS (Zero credential leaks)** ✅ |
| **SV-05** | Input Validation & Injection | NoSQL injection payloads (`{"$ne": null}`), oversized payloads ($> 16$kb), and boundary-length inputs tested. | **PASS (Properly rejected)** ✅ |
| **SV-06** | Payment Integrity | Forged Razorpay HMAC signatures, missing signatures, and replay attacks simulated. Gateway verified with `timingSafeEqual`. | **PASS (Forged callbacks blocked)** ✅ |
| **SV-07** | Transport Security | Helmet middleware adds `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, and HSTS. Non-secure requests redirected. | **PASS (Strict headers present)** ✅ |
| **SV-08** | Login Abuse Mitigation | Timing-attack resistance (dummy hash comparison for non-existent users) and express rate limiting (30 attempts/15 min returning HTTP 429). | **PASS (Anti-enumeration verified)** ✅ |
| **SV-09** | Dependencies & Secrets | `npm audit --omit=dev` produces 0 vulnerabilities. Git history scanned for committed credentials (`.env` git-ignored). | **PASS (0 vulnerabilities)** ✅ |
| **SV-10** | Backup Protection | Tampered backup archive files detected via SHA-256 digest validation. POSIX file permissions verified at `0700` / `0600`. | **PASS (Tampering detected)** ✅ |

---

## 4. End-to-End Workflow Validation

### Workflow 1: Member Registration to Class Booking Lifecycle
1. **Registration:** Member registers with unique email and 12+ char password $\rightarrow$ Account created with `Basic` tier and cost-12 hash.
2. **Authentication:** Member signs in $\rightarrow$ Receives 1-hour HS256 JWT session token.
3. **Membership Renewal:** Member selects `Premium` tier and completes demo payment $\rightarrow$ Expiry extended by 30 days; `PaymentReceipt` generated.
4. **Digital Pass:** Member navigates to Entry Pass $\rightarrow$ System generates 15-minute rolling QR pass containing cryptographically signed member claims.
5. **Class Booking:** Member views upcoming classes $\rightarrow$ Books "Morning Yoga" $\rightarrow$ Class `availableSlots` decrements atomically by 1; booking marked `Active`.
6. **Booking Cancellation:** Member cancels booking $\rightarrow$ Class `availableSlots` restored by 1; booking transitions to `Cancelled`.

### Workflow 2: Receptionist Pass Verification
1. Staff member signs in with `Trainer` or `Admin` role.
2. Navigates to **Verify pass** and submits scanned QR pass token.
3. API validates token signature, issuer, audience, and live database eligibility $\rightarrow$ Returns member profile and confirmation banner.

### Workflow 3: Equipment Fault Reporting & Maintenance
1. Trainer notices malfunctioning treadmill `TRD-101`.
2. Opens **Equipment** tab, clicks **Report fault**, and submits maintenance ticket.
3. Ticket `TCK-xxx` logged in database $\rightarrow$ Admin toggles status to `Under Maintenance`.
4. Regular Members query `/api/equipment` $\rightarrow$ `TRD-101` is omitted from their catalog view.

---

## 5. System Validation Verdict

The Gym Management System has been rigorously validated across all functional, security, performance, reliability, and usability criteria. All **194 automated test cases pass**, all **10 Security Verification targets are met**, and all requirements from **IEEE SRS v1.1** trace directly to passing validation evidence.

**Status: SYSTEM VALIDATED AND READY FOR SUBMISSION** ✅

