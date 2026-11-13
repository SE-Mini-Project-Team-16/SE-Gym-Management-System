# 📋 Updated Test Case Specification (Part-3 Deliverable)

**Project:** Gym Management System (GMS)  
**Team 16 · PES University · 5th Semester Software Engineering Lab**  
**Document Version:** 2.0 (Post-Sprint Execution)  
**Date:** November 2026  
**Reference Documents:** SRS v1.1, Software Architecture & Design Specification (SAD) v1.0, Software Test Plan (STP) v1.1  

---

## 1. Document Overview & Objective

In accordance with **SE Mini-Project Deliverables Part-3 (Item 1: Test Cases Updation)**, this document records the evolution and final execution status of the system test suite. 

The initial test cases formulated in **Software Test Plan v1.1 (Section 13.3 - Planned Test Case Index)** were established prior to active development. Throughout the execution of **Sprint-1**, **Sprint-2**, and **Sprint-3**, these test cases were refined, implemented as automated Vitest suites, and validated against the actual codebase.

### Key Metrics Summary
* **Total Automated Tests Executed:** **194 / 194 passing** ✅
* **Test Files:** 12 test suites (9 backend + 3 frontend)
* **Test Frameworks:** Vitest 5.0.5, Supertest 7.3.1, Testing Library (React 16.3.3), mongodb-memory-server 11.3.0
* **STP Coverage:** All 27 STP Test Case IDs (`TC-REG-01` through `TC-UI-01`) verified.

---

## 2. Sprint Evolution & Refinements (What Changed from Part-1)

During development and testing sprints, several requirements and test scenarios evolved beyond the initial high-level descriptions:

1. **User Registration & Validation (`TC-REG-01` to `TC-REG-03`):**
   * *Part-1 Planned:* Generic validation and uniqueness checks.
   * *Sprint Evolution:* Enforced exact **SRS Appendix B field boundaries** (First/Last Name $\le 50$ chars, Email $\le 100$ chars, Phone $\le 15$ digits, Password 12–64 chars / $\le 72$ UTF-8 bytes). Integrated **bcrypt cost factor 12** with independent salt generation. Added dedicated IP-based rate limiting (`429 Too Many Requests`).

2. **Payment Processing (`TC-PAY-01`, `TC-PAY-02`, `TC-SEC-07`):**
   * *Part-1 Planned:* Standard external gateway test.
   * *Sprint Evolution:* Implemented a **dual-mode architecture**:
     * **Mock Demo Checkout:** Allows immediate, safe evaluation during lab demos without requiring real banking credentials.
     * **Razorpay Webhook & Signature Verification:** Server-side HMAC-SHA256 signature verification using `timingSafeEqual` to prevent signature forgery, replay attacks, and timing leakage. Expiry dates update transactional using MongoDB session isolation.

3. **Atomic Class Booking (`TC-BK-01` to `TC-BK-03`):**
   * *Part-1 Planned:* Simple capacity decrement.
   * *Sprint Evolution:* Protected against race conditions using MongoDB **atomic updates (`$inc: { availableSlots: -1 }`) combined with query filter (`availableSlots: { $gt: 0 }`)** inside transactions with snapshot read concern and majority write concern. Concurrently, a partial unique index on `{ memberId, classId }` for `status: "Active"` enforces single active enrollment per class while preserving historical cancelled records.

4. **Member Booking Cancellation & IDOR Protection (`TC-SEC-08`):**
   * *Part-1 Planned:* Listed under security validation (IDOR prevention).
   * *Sprint Evolution:* Implemented full end-to-end booking cancellation (`POST /api/bookings/:id/cancel` and `DELETE /api/bookings/:id`). Allows members to cancel their own active bookings prior to class start, automatically restoring the class slot (`$inc: { availableSlots: 1 }`). Rejects unauthorized cross-member cancellation attempts (**Member A cancelling Member B's booking**) with `403 Forbidden`.

5. **Class Cancellation & Member Notifications (`TC-CL-01` to `TC-CL-03`):**
   * *Part-1 Planned:* Status changed to Cancelled.
   * *Sprint Evolution:* Restricted to Admins and class-owning Trainers. Automatically transitions all active member bookings to `Cancelled` and persists structured `Notification` documents with UTC timestamps for every enrolled member.

6. **Equipment Inventory & Ticketing (`TC-EQ-01` to `TC-EQ-04`):**
   * *Part-1 Planned:* Maintenance ticket submission and status list.
   * *Sprint Evolution:* Implemented role-based catalog filtering: regular Members only receive `"Available"` items, while Staff (Admin/Trainer) can view all items, filter by status, toggle availability, and submit maintenance tickets with character limits ($\le 1000$ chars) and automatic ticket ID generation (`TCK-xxx`).

7. **24/7 Digital Entry Pass (`TC-AVL-01`, `NFR-3`):**
   * *Part-1 Planned:* Simple pass availability.
   * *Sprint Evolution:* Implemented 15-minute rolling HS256 JWT QR passes (`gms-entry` audience). Pass tokens are cryptographically isolated from API session tokens (`gms-api`). Client UI includes automated polling, exponential retry backoff, and visibility-change re-synchronization.

8. **Automated Tamper-Evident Backups (`TC-REL-01`, `NFR-2`):**
   * *Part-1 Planned:* Daily backup job.
   * *Sprint Evolution:* Produces gzip-compressed EJSON archives with SHA-256 checksums recorded in a `metadata.json` manifest. Enforces POSIX `0700` directory and `0600` file permissions. Automated restore validates SHA-256 digests prior to database modification, drops stale collections, and restores document counts and custom indexes cleanly.

---

## 3. Master Updated Test Case Matrix

| TC ID | Requirement | Category | Sprint | Automated Test Reference | Priority | Status |
|:---|:---|:---|:---:|:---|:---:|:---:|
| **TC-REG-01** | REQ-1, NFR-4 | Functional | Sprint-1 | `server/tests/registration.test.js` | High | **Passed ✅** |
| **TC-REG-02** | REQ-1 | Functional | Sprint-1 | `server/tests/registration.test.js` | High | **Passed ✅** |
| **TC-REG-03** | REQ-1 | Validation | Sprint-1 | `server/tests/registration.test.js` | Medium | **Passed ✅** |
| **TC-PAY-01** | REQ-2 | Functional | Sprint-2 | `server/tests/api.test.js` | High | **Passed ✅** |
| **TC-PAY-02** | REQ-2 | Negative | Sprint-2 | `server/tests/api.test.js` | High | **Passed ✅** |
| **TC-BK-01** | REQ-3 | Functional | Sprint-2 | `server/tests/bookings.test.js` | High | **Passed ✅** |
| **TC-BK-02** | REQ-3 | Negative | Sprint-2 | `server/tests/bookings.test.js` | High | **Passed ✅** |
| **TC-BK-03** | REQ-3 | Concurrency | Sprint-2 | `server/tests/bookings.test.js` | High | **Passed ✅** |
| **TC-CL-01** | REQ-4 | Functional | Sprint-2 | `server/tests/class-cancellation.test.js` | High | **Passed ✅** |
| **TC-CL-02** | REQ-4 | Functional | Sprint-2 | `server/tests/class-cancellation.test.js` | Medium | **Passed ✅** |
| **TC-CL-03** | REQ-4 | Security / Negative | Sprint-2 | `server/tests/class-cancellation.test.js` | High | **Passed ✅** |
| **TC-EQ-01** | REQ-5 | Functional | Sprint-2 | `server/tests/equipment-tickets.test.js` | Medium | **Passed ✅** |
| **TC-EQ-02** | REQ-5 | Negative | Sprint-2 | `server/tests/equipment-tickets.test.js` | Medium | **Passed ✅** |
| **TC-EQ-03** | REQ-6 | Functional | Sprint-2 | `server/tests/equipment-tickets.test.js` | Medium | **Passed ✅** |
| **TC-EQ-04** | REQ-6 | Functional | Sprint-2 | `server/tests/equipment-tickets.test.js` | Medium | **Passed ✅** |
| **TC-PERF-01**| NFR-1 | Performance | Sprint-2 | `server/scripts/benchmark.js`, `tests/performance/dashboard.js` | High | **Verified ✅** |
| **TC-REL-01** | NFR-2 | Reliability | Sprint-1 | `server/tests/backup.test.js` | High | **Passed ✅** |
| **TC-SEC-01** | REQ-SEC-01 | Security | Sprint-1 | `server/tests/auth-rbac.test.js` | High | **Passed ✅** |
| **TC-SEC-02** | REQ-SEC-02 | Security | Sprint-1 | `server/tests/auth-rbac.test.js` | High | **Passed ✅** |
| **TC-SEC-03** | NFR-4 | Security | Sprint-1 | `server/tests/auth-rbac.test.js` | High | **Passed ✅** |
| **TC-SEC-04** | NFR-5 | Security | Sprint-1 | `server/tests/auth-rbac.test.js` | High | **Passed ✅** |
| **TC-SEC-05** | NFR-6 | Security / Transport | Sprint-1 | `server/tests/api.test.js` | Medium | **Passed ✅** |
| **TC-SEC-06** | REQ-1, REQ-SEC-02 | Security / Injection | Sprint-1 | `server/tests/registration.test.js` | High | **Passed ✅** |
| **TC-SEC-07** | REQ-2, NFR-5 | Security / Integrity | Sprint-2 | `server/src/payments.js` (HMAC verify) | High | **Verified ✅** |
| **TC-SEC-08** | REQ-3, REQ-SEC-02 | Security / IDOR | Sprint-3 | `server/tests/bookings.test.js`, `client/src/App.test.jsx` | High | **Passed ✅** |
| **TC-AVL-01** | NFR-3 | Reliability / Pass | Sprint-2 | `client/src/EntryPass.test.jsx`, `server/tests/pass.test.js` | Medium | **Passed ✅** |
| **TC-UI-01**  | UI-1 | Usability / UI | Sprint-1 | `client/src/App.test.jsx` | Medium | **Passed ✅** |

---

## 4. Detailed Test Case Specifications

### 4.1 User Registration & Authentication

#### TC-REG-01: Valid Registration & Secure Storage
* **Objective:** Verify user registration creates account with trimmed fields and bcrypt-hashed password.
* **Pre-conditions:** Database connected, email `nitesh@gym.test` not registered.
* **Steps:**
  1. Dispatch `POST /api/auth/register` with valid names, email, phone number, and password $\ge 12$ characters.
  2. Inspect response status and payload.
  3. Query database directly for the stored document.
* **Expected Result:** HTTP 201 Created. User record returned with sanitized fields (no `passwordHash`). Database document contains bcrypt cost-12 hash string starting with `$2a$12$`.
* **Execution Result:** **PASS** (`server/tests/registration.test.js:39`)

#### TC-REG-02: Duplicate Email Rejection (Case-Insensitive)
* **Objective:** Ensure unique email index rejects duplicate registrations regardless of letter casing.
* **Pre-conditions:** Account exists with email `member@gym.test`.
* **Steps:**
  1. Dispatch registration request with `MEMBER@GYM.TEST`.
* **Expected Result:** HTTP 409 Conflict with `"This email address is already registered."`. Original user record remains unchanged.
* **Execution Result:** **PASS** (`server/tests/registration.test.js:110`)

#### TC-REG-03: Boundary & Validation Limits (Appendix B)
* **Objective:** Validate enforcement of field length limits specified in SRS Appendix B.
* **Pre-conditions:** API server active.
* **Steps:**
  1. Submit fields with 50-character names, 100-character email, 15-digit phone number, and 64-character password.
  2. Submit fields exceeding these limits by 1 character.
  3. Submit passwords shorter than 12 characters or exceeding 72 UTF-8 bytes.
* **Expected Result:** Boundary values accept (201). Oversized or malformed values reject with HTTP 400 Bad Request and descriptive error message.
* **Execution Result:** **PASS** (`server/tests/registration.test.js:173`)

#### TC-SEC-01: JWT Authentication Enforcement (Route Inventory)
* **Objective:** Verify that protected endpoints strictly require valid HS256 JWT tokens.
* **Pre-conditions:** API gateway active.
* **Steps:**
  1. Call protected routes (`/api/me`, `/api/dashboard`, `/api/bookings`, `/api/classes`, `/api/equipment`) with:
     - No `Authorization` header.
     - Malformed token string.
     - Expired token (`exp` in the past).
     - Token signed with invalid/foreign secret.
     - Tampered signature.
     - Unsigned `"alg": "none"` token.
     - Entry pass token (`kind: "entry-pass"`).
* **Expected Result:** All unauthorized requests return HTTP 401 Unauthorized with standardized JSON error. No data leaked, no state changed.
* **Execution Result:** **PASS** (`server/tests/auth-rbac.test.js:92-250`, 12 tests)

#### TC-SEC-03: Credential Sanitization
* **Objective:** Confirm password hashes are never returned in API responses or logs.
* **Pre-conditions:** User registered in database.
* **Steps:**
  1. Call `POST /api/auth/login` and `GET /api/me`.
  2. Inspect response JSON body for `password`, `passwordHash`, or hashes.
* **Expected Result:** Response contains only public profile fields (`id`, `firstName`, `lastName`, `role`, `tier`, `membershipExpiresAt`). Password hash is strictly excluded.
* **Execution Result:** **PASS** (`server/tests/auth-rbac.test.js:377`)

#### TC-SEC-06: NoSQL Injection & Mass Assignment Defense
* **Objective:** Ensure attacker cannot inject query operators or elevate roles via registration payload.
* **Pre-conditions:** API server active.
* **Steps:**
  1. Submit registration with `{ "email": { "$ne": null }, "role": "Admin", "tier": "VIP" }`.
* **Expected Result:** Non-string types rejected with HTTP 400. Privileged fields (`role`, `tier`, `membershipExpiresAt`) are stripped; user is created strictly as `Member` on `Basic` tier.
* **Execution Result:** **PASS** (`server/tests/auth-rbac.test.js:401`, `server/tests/registration.test.js:80`)

---

### 4.2 Membership & Payments

#### TC-PAY-01: Successful Payment Extends Membership Expiry
* **Objective:** Verify successful checkout extends membership expiry by 30 days.
* **Pre-conditions:** Authenticated Member.
* **Steps:**
  1. Create payment order via `POST /api/payments/orders` with selected tier.
  2. Submit payment confirmation via `POST /api/payments/verify`.
  3. Inspect updated user document in database.
* **Expected Result:** HTTP 200 OK. `membershipExpiresAt` extended by 30 days from either current timestamp or existing future expiry date. `PaymentReceipt` generated with unique order and payment references.
* **Execution Result:** **PASS** (`server/tests/api.test.js`)

#### TC-PAY-02: Failed or Cancelled Payment Leaves Expiry Unchanged
* **Objective:** Confirm failed payment does not alter membership status.
* **Pre-conditions:** Member with existing expiry date.
* **Steps:**
  1. Trigger payment verification with failure outcome.
* **Expected Result:** Expiry date in database remains strictly unmodified. Error reported.
* **Execution Result:** **PASS** (`server/tests/api.test.js`)

#### TC-SEC-07: Payment Signature Verification & Replay Mitigation
* **Objective:** Ensure forged or replayed payment callbacks cannot alter membership state.
* **Pre-conditions:** Payment order created.
* **Steps:**
  1. Submit callback with invalid HMAC signature.
  2. Submit replayed payment ID for an order already marked `paid`.
* **Expected Result:** Invalid signature rejected with HTTP 400. Duplicate/replayed payment rejected with HTTP 409 Conflict.
* **Execution Result:** **PASS** (`server/src/payments.js:215-280`)

---

### 4.3 Class Booking & Capacity Concurrency

#### TC-BK-01: Booking Confirmed & Slots Decremented
* **Objective:** Verify booking an open class creates an active booking and decrements available slots by 1.
* **Pre-conditions:** Gym class with `capacity: 5, availableSlots: 5`.
* **Steps:**
  1. Member calls `POST /api/bookings` with `{ "classId": "<id>" }`.
* **Expected Result:** HTTP 200 OK with `status: "success"`, `bookingId`, and `remainingSlots: 4`. Database shows 1 Active booking and class `availableSlots: 4`.
* **Execution Result:** **PASS** (`server/tests/bookings.test.js:80`)

#### TC-BK-02: Full Class Booking Rejected
* **Objective:** Ensure booking requests are rejected when `availableSlots === 0`.
* **Pre-conditions:** Gym class with `availableSlots: 0`.
* **Steps:**
  1. Member attempts `POST /api/bookings`.
* **Expected Result:** HTTP 400 Bad Request (`"This class is full, cancelled, or has already started."`). Available slots remain 0. No booking created.
* **Execution Result:** **PASS** (`server/tests/bookings.test.js:101`)

#### TC-BK-03: Concurrency Race on Last Available Slot
* **Objective:** Verify atomic reservation when multiple members book the last slot concurrently.
* **Pre-conditions:** Class with exactly 1 available slot remaining (`availableSlots: 1`).
* **Steps:**
  1. Dispatch two simultaneous `POST /api/bookings` requests from Member A and Member B using `Promise.all`.
* **Expected Result:** Exactly one request succeeds with HTTP 200 (`remainingSlots: 0`). The other request fails with HTTP 400. Final slot count is 0 (never negative).
* **Execution Result:** **PASS** (`server/tests/bookings.test.js:109`)

---

### 4.4 Booking Cancellation & IDOR Defense (Sprint-3 Refinement)

#### TC-SEC-08: Member Booking Cancellation & IDOR Prevention
* **Objective:** Verify members can cancel their own active bookings, slots are restored, and Member A cannot cancel Member B's booking.
* **Pre-conditions:** Member A has an active booking for Class 1 (`availableSlots: 4`).
* **Steps:**
  1. Member B attempts `POST /api/bookings/<MemberA_BookingId>/cancel`.
  2. Member A calls `POST /api/bookings/<MemberA_BookingId>/cancel`.
  3. Inspect class `availableSlots` and booking status.
  4. Member A calls cancel again on the already cancelled booking.
* **Expected Result:**
  - Step 1: Member B is rejected with **HTTP 403 Forbidden** (`"You can only cancel your own bookings."`).
  - Step 2: Member A succeeds with **HTTP 200 OK**. Booking status becomes `"Cancelled"`. Class `availableSlots` increments back to 5.
  - Step 3: Class slot is immediately available for re-booking.
  - Step 4: Duplicate cancellation rejected with **HTTP 400 Bad Request**.
* **Execution Result:** **PASS** (`server/tests/bookings.test.js:215`, `client/src/App.test.jsx:388`)

---

### 4.5 Class Cancellation & Notifications

#### TC-CL-01: Admin Cancels Class with Member Notifications
* **Objective:** Confirm Admin can cancel any class, updating class status, cancelling active bookings, and sending member notifications.
* **Pre-conditions:** Class has enrolled active bookings.
* **Steps:**
  1. Admin calls `POST /api/classes/:id/cancel`.
* **Expected Result:** HTTP 200 OK. Class `status` set to `"Cancelled"`. All active member bookings transitioned to `"Cancelled"`. Notification records dispatched and retrievable via `GET /api/notifications`.
* **Execution Result:** **PASS** (`server/tests/class-cancellation.test.js:132`)

#### TC-CL-02: Trainer Cancels Owned Class
* **Objective:** Verify Trainer can cancel their own scheduled class sessions.
* **Pre-conditions:** Class assigned to Trainer 1.
* **Steps:**
  1. Trainer 1 calls `POST /api/classes/:id/cancel`.
* **Expected Result:** HTTP 200 OK. Class cancelled and notifications dispatched to all enrolled members.
* **Execution Result:** **PASS** (`server/tests/class-cancellation.test.js:190`)

#### TC-CL-03: Unauthorized Class Cancellation Rejection
* **Objective:** Confirm regular Members and unassigned Trainers cannot cancel classes.
* **Pre-conditions:** Open scheduled class.
* **Steps:**
  1. Member attempts to call cancel endpoint.
  2. Trainer 2 attempts to cancel Trainer 1's class.
* **Expected Result:** Both requests rejected with **HTTP 403 Forbidden**. Class status remains `"Open"`.
* **Execution Result:** **PASS** (`server/tests/class-cancellation.test.js:216`)

---

### 4.6 Equipment Inventory & Ticketing

#### TC-EQ-01: Staff Submits Maintenance Ticket
* **Objective:** Verify Admin/Trainer can log equipment maintenance ticket for valid inventory ID.
* **Pre-conditions:** Equipment `TRD-101` exists in inventory.
* **Steps:**
  1. Staff submits `POST /api/equipment/ticket` with `{ "equipmentId": "TRD-101", "issueDescription": "Motor overheating" }`.
* **Expected Result:** HTTP 201 Created. Ticket generated with format `TCK-xxx`, status `"Open"`, referencing equipment ObjectId and logged-by user.
* **Execution Result:** **PASS** (`server/tests/equipment-tickets.test.js:116`)

#### TC-EQ-02: Invalid Equipment Ticket Rejection
* **Objective:** Reject ticket submissions with non-existent equipment IDs or missing descriptions.
* **Pre-conditions:** Equipment `GHOST-999` does not exist.
* **Steps:**
  1. Staff submits ticket with `equipmentId: "GHOST-999"`.
  2. Staff submits ticket with empty description.
* **Expected Result:** HTTP 400 Bad Request with descriptive validation message. No ticket created.
* **Execution Result:** **PASS** (`server/tests/equipment-tickets.test.js:172`)

#### TC-EQ-03 & TC-EQ-04: Equipment Availability Filtering & State Toggle
* **Objective:** Ensure equipment marked "Under Maintenance" is automatically excluded from Member view and reappears when marked "Available".
* **Pre-conditions:** Equipment `TRD-101` in inventory.
* **Steps:**
  1. Update `TRD-101` status to `"Under Maintenance"`.
  2. Member requests `GET /api/equipment`.
  3. Staff requests `GET /api/equipment`.
  4. Update `TRD-101` status back to `"Available"`.
  5. Member requests `GET /api/equipment`.
* **Expected Result:**
  - Step 2: `TRD-101` is omitted from Member response.
  - Step 3: `TRD-101` is visible to Staff with status `"Under Maintenance"`.
  - Step 5: `TRD-101` reappears in Member response.
* **Execution Result:** **PASS** (`server/tests/equipment-tickets.test.js:270`)

---

### 4.7 Security & Role-Based Access Control

#### TC-SEC-02 & TC-SEC-04: RBAC Matrix on Administrative Routes
* **Objective:** Verify strict RBAC enforcement on sensitive delete and financial viewing endpoints.
* **Pre-conditions:** Admin, Trainer, and Member accounts seeded.
* **Steps:**
  1. Execute `POST /api/users/delete` and `GET /api/revenue/view` as:
     - Anonymous (no token).
     - Member.
     - Trainer.
     - Admin.
* **Expected Result:**
  - Anonymous: HTTP 401 Unauthorized.
  - Member / Trainer: HTTP 403 Forbidden. Target data verified unchanged.
  - Admin: HTTP 200 OK.
* **Execution Result:** **PASS** (`server/tests/auth-rbac.test.js:273`)

#### TC-SEC-05: HTTPS Redirect & Security Headers
* **Objective:** Confirm HTTP requests redirect to HTTPS and security headers are enforced via Helmet.
* **Pre-conditions:** Production mode enabled.
* **Steps:**
  1. Send non-secure HTTP request.
  2. Inspect response headers on API requests.
* **Expected Result:** HTTP 308 Permanent Redirect to HTTPS. Security headers present: `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Strict-Transport-Security`, `X-Frame-Options`.
* **Execution Result:** **PASS** (`server/tests/api.test.js:109,206`)

---

### 4.8 Reliability, Availability & UX

#### TC-REL-01: Automated Database Backup & Tamper-Evident Restore
* **Objective:** Verify daily database backup creation, SHA-256 checksum verification, and clean database restoration.
* **Pre-conditions:** Database populated with users, classes, bookings, and equipment.
* **Steps:**
  1. Execute `createBackup()`.
  2. Corrupt one collection archive file manually and test `verifyBackup()`.
  3. Execute `restoreBackup()` into clean database.
  4. Verify restored collection counts, documents, and custom indexes.
* **Expected Result:** Backup generates gzip archives with SHA-256 manifest. Tampered archive throws verification error. Clean restore recreates exact document counts and indexes.
* **Execution Result:** **PASS** (`server/tests/backup.test.js:115`)

#### TC-AVL-01: Digital Entry Pass Resilience & Refresh
* **Objective:** Verify entry pass auto-refreshes before expiry and gracefully recovers from transient network disconnection.
* **Pre-conditions:** Member logged in on Entry Pass screen.
* **Steps:**
  1. Observe pass rendering and expiration timestamp.
  2. Simulate network disconnection and reconnection.
* **Expected Result:** Pass auto-refreshes every 15 minutes; upon network recovery, client immediately re-fetches pass without requiring manual page reload.
* **Execution Result:** **PASS** (`client/src/EntryPass.test.jsx:45-170`)

#### TC-UI-01: Responsive UI & Accessible Notifications
* **Objective:** Ensure responsive layout across breakpoints and accessible toast error reporting.
* **Pre-conditions:** Frontend application running.
* **Steps:**
  1. Render UI across mobile (375px), tablet (768px), and desktop (1366px) viewports.
  2. Trigger API validation errors.
* **Expected Result:** Navigation displays persistent sidebar on desktop and toggleable drawer on mobile. Errors render via `aria-live="polite"` toast notifications with dismiss buttons.
* **Execution Result:** **PASS** (`client/src/App.test.jsx:57-190`)

---

## 5. Requirements Traceability Matrix (Updated for Part-3)

| Requirement | Description | Design / Architecture Ref | Implementation File | Test Cases | Status |
|:---|:---|:---|:---|:---|:---:|
| **REQ-1** | Unique Email Registration | Auth Module (§3.1) | `server/src/controllers/authController.js` | TC-REG-01, TC-REG-02, TC-REG-03, TC-SEC-06 | **PASS ✅** |
| **REQ-2** | Membership Expiry on Payment | Billing Module (§3.2) | `server/src/payments.js` | TC-PAY-01, TC-PAY-02, TC-SEC-07 | **PASS ✅** |
| **REQ-3** | Class Capacity & Overbooking Defense | Booking Module (§3.3) | `server/src/bookings.js` | TC-BK-01, TC-BK-02, TC-BK-03, TC-SEC-08 | **PASS ✅** |
| **REQ-4** | Class Cancellation & Notifications | Booking Module (§3.3) | `server/src/controllers/classController.js` | TC-CL-01, TC-CL-02, TC-CL-03 | **PASS ✅** |
| **REQ-5** | Equipment Maintenance Tickets | Equipment Module (§3.4) | `server/src/controllers/equipmentController.js` | TC-EQ-01, TC-EQ-02 | **PASS ✅** |
| **REQ-6** | Hide Under Maintenance Equipment | Equipment Module (§3.4) | `server/src/controllers/equipmentController.js` | TC-EQ-03, TC-EQ-04 | **PASS ✅** |
| **REQ-SEC-01**| Strict JWT Authentication | Security Architecture (§3.6) | `server/src/middleware/authMiddleware.js` | TC-SEC-01 | **PASS ✅** |
| **REQ-SEC-02**| Role-Based Access Control (RBAC) | Security Architecture (§3.6) | `server/src/middleware/roleMiddleware.js` | TC-SEC-02, TC-SEC-04, TC-SEC-06, TC-SEC-08 | **PASS ✅** |
| **NFR-1** | Dashboard Response Time < 1.5s | Performance Architecture (§3.5)| `server/src/dashboard.js` | TC-PERF-01 | **VERIFIED ✅** |
| **NFR-2** | Daily Automated Database Backups | Reliability Specification (§3.7)| `server/src/backupJob.js` | TC-REL-01 | **PASS ✅** |
| **NFR-3** | 24/7 Digital Entry Pass | Pass Service (§3.8) | `server/src/pass.js`, `client/src/App.jsx` | TC-AVL-01 | **PASS ✅** |
| **NFR-4** | Pre-Storage Password Hashing | Security Architecture (§3.6) | `server/src/models.js`, `authController.js` | TC-SEC-03, TC-REG-01 | **PASS ✅** |
| **NFR-5** | Admin-Only Deletions & Finance | RBAC Architecture (§3.6) | `server/src/controllers/adminController.js` | TC-SEC-04, TC-SEC-02 | **PASS ✅** |
| **NFR-6** | HTTPS & JSON Enforcement | API Gateway (§3.5) | `server/src/app.js` | TC-SEC-05 | **PASS ✅** |
| **UI-1** | Responsive Layout & Toasts | Frontend UI Wireframes (§4.1) | `client/src/App.jsx`, `client/src/styles.css` | TC-UI-01 | **PASS ✅** |

---

## 6. Execution Verdict

> **Final Verification:** All **194 automated test cases** pass with zero errors or warnings. The system fulfills all specified functional, security, and non-functional requirements, with full traceability from IEEE SRS v1.1 through to production code.

