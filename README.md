# Gym Management System (GMS) 🏋️🏋️

A centralized web application designed to manage gym operations, membership renewals, automate trainer and class scheduling, and track equipment maintenance lifecycles. This repository hosts the deliverables for the Software Engineering Mini-Project.

**Project Status: Active Development**
The MERN application includes a responsive React shell, JSON API gateway, dashboard summaries, signed digital entry passes, and member registration with password hashing ([issue #2](https://github.com/SE-Mini-Project-Team-16/SE-Gym-Management-System/issues/2)). The remaining module issues are integration work for the team.

## Run locally

Requires Node.js 24 LTS (minimum 22.12) and npm. Run from the repository root:

```sh
npm ci
cp server/.env.example server/.env
```

Edit `server/.env`: set `JWT_SECRET` and `PASS_SECRET` to **different**, random values of at least 32 characters. For example, generate each with `openssl rand -hex 32`. Never commit the environment file.

Local development defaults to `PAYMENT_MODE=demo`: checkout is clearly marked as a simulation, collects no payment details, and lets you simulate success or failure. It updates membership only in the local project database; no money is charged. For an authorized Razorpay integration, set `PAYMENT_MODE=razorpay`, provide `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`, and configure `RAZORPAY_WEBHOOK_SECRET` for the deployed `payment.captured` webhook. The Razorpay order is created server-side using the sample INR tier amounts (₹30/₹60/₹100). Memberships extend by 30 days by default (`MEMBERSHIP_DURATION_DAYS`). The database must support transactions (Atlas or a replica set). Demo payments are forbidden in production. Do not collect or store card details in GMS.

Choose either a MongoDB 7+ / Atlas connection in `MONGODB_URI`, or set `DEMO_DATABASE=true` to use a temporary real MongoDB database. Demo mode downloads a local MongoDB binary on its first run, resets when the process exits, and is forbidden in production. Set `DEMO_PASSWORD` to a password between 12 and 72 characters for the demo accounts. No default passwords are included.

```sh
# With an external development MongoDB only: create/update demo fixtures.
# Do not point the seed script at a shared database: it rewrites gym.test accounts/classes.
npm run seed

# Start API on 127.0.0.1:4000 and Vite on 127.0.0.1:5173.
# In DEMO_DATABASE mode, fixtures are seeded automatically; skip npm run seed.
npm run dev
```

Sign in with `member@gym.test`, `trainer@gym.test`, or `admin@gym.test` and your configured `DEMO_PASSWORD`. A browser reload requires signing in again: JWTs are kept in memory per the architecture specification.

To register, choose **Create an account** on the sign-in screen. Enter your first and last names, a unique email, a phone number of 1 to 15 digits, and a password of 12 to 64 characters (at most 72 UTF-8 bytes). After registration, sign in with your new credentials. New accounts always start as Members on the Basic tier, without an active membership; reception/payment activation is a separate workflow. Registration cannot grant staff access or membership benefits.

```sh
npm test                 # MongoDB integration tests and React interaction tests
npm run build            # Production frontend bundle
npm start                # API serves client/dist on the same origin
npm run test:performance # Local 1,000-member / 200-booking smoke benchmark
npm run backup           # Create timestamped database backup snapshot
npm run restore          # Restore database from snapshot with verification
npm run backup:verify    # Verify SHA-256 integrity of latest snapshot
```

## Delivered behavior

- Persistent sidebar and responsive layouts for mobile, tablet and desktop; global success/error toasts and accessible forms.
- Dashboard, bounded read views for Members (Admin only), Bookings and Equipment, and upcoming classes. Member renewals use a labeled demo checkout locally or Razorpay Standard Checkout when configured; captured payments and duplicate callbacks/webhooks do not extend membership twice.
- `GET /api/passes/me` issues a member-owned signed QR pass valid for at most 15 minutes, capped at the current membership expiry. Staff use `POST /api/passes/verify` or the verification screen to check it.
- Pass issuance and verification always check the live account and membership, including disabled accounts and revoked/expired memberships. Pass tokens use a separate secret and audience from API sessions.
- Dashboard queries run concurrently with bounded projections, database deadlines, compound indexes, and a bounded 10-second per-user cache that coalesces simultaneous requests. Membership/pass eligibility never uses that cache.
- JSON-only API payloads, standard JSON errors, Helmet headers, login throttling, and production HTTPS redirection to a configured origin.
- Public, separately throttled `POST /api/auth/register`, normalized unique emails, salted bcrypt cost-12 password hashes, and an accessible registration form with confirmation and retryable errors. Passwords, hashes, and phone numbers are excluded from public user responses.

The pass is a reusable short-lived membership credential, not a one-use attendance record or hardware integration. A saved QR expires at the same time as the on-screen pass. Refreshing and verifying require connectivity. No pass tokens are persisted in the browser or server cache.

## Integration and deployment

See [the API contract and deployment notes](docs/application.md) for model fields, module ownership, HTTPS setup, index creation, and staging acceptance checks. CI runs the integration/component suite and builds the frontend. The local benchmark is not a substitute for the test plan's 10-minute staging load test or 72-hour availability observation.

## Team 16

* **Ronak M Surana**
* **Prajwal Deshpande**
* **Chatresh Ramasai Gudi**
* **Nitesh Harsur**
* **Prajwal Ambanna**



## Tech Stack

* **Frontend:** React (Vite), Tailwind CSS


* **Backend:** Node.js (LTS), Express.js


* **Database:** MongoDB Atlas (Cloud Cluster) via Mongoose


* **Security Architecture:** JSON Web Tokens (JWT) for stateless sessions, bcrypt for password hashing, and strict backend Role-Based Access Control (RBAC)


* **Testing Frameworks:** Jest, React Testing Library, Playwright, Supertest



## Core System Modules

### 1. Membership & Authentication

* Secure user registration and login flows protected by JWT middleware.


* Three-tier Role-Based Access Control (Admin/Manager, Trainer/Staff, Member) limiting data access and route execution.


* Automated calculation and updating of membership expiry dates upon successful payment webhook reception.



### 2. Booking & Scheduling

* Dynamic class catalog and personal trainer session scheduling.


* Real-time capacity limits utilizing atomic database update operations (`$inc`) to prevent overbooking during concurrent requests.


* Class cancellation functionality with automated dispatch of notifications to enrolled members.



### 3. Equipment Tracking

* Automated maintenance ticketing system allowing staff to log issues for specific inventory IDs.


* Dynamic filtering that automatically excludes equipment marked as "Under Maintenance" from available use lists.



## Project Documentation

The below foundational design and planning deliverables have been completed:

* `Software Requirements Specification (SRS) v1.1`
* `Software Architecture and Design Specification (SAD) v1.0`
* `Software Test Plan v1.1`
