# Gym Management System (GMS) 🏋️🏋️

A centralized web application designed to manage gym operations, membership renewals, automate trainer and class scheduling, and track equipment maintenance lifecycles. This repository hosts the deliverables for the Software Engineering Mini-Project.

**Project Status: Active Development (Sprint Planning Phase)**
The system architecture, software requirements, and test plans have been baselined. The project backlog is established, and active codebase implementation is scheduled across upcoming agile sprints.

## Team 16

* **Ronak M Surana**
* **Prajwal Deshpande**
* **Chatresh Ramasai Gudi**
* **Nitesh Harsur**
* **Prajwal Ambanna**



## Proposed Tech Stack

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
