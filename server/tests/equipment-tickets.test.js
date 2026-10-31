import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createApp } from "../src/app.js";
import { User, Equipment, Ticket } from "../src/models.js";

const config = {
  jwtSecret: "equipment-test-jwt-secret-at-least-32-chars",
  passSecret: "equipment-test-pass-secret-at-least-32-chars",
};

let db, app, admin, trainer, member;

const token = (user) =>
  jwt.sign({}, config.jwtSecret, {
    algorithm: "HS256",
    subject: String(user._id),
    issuer: "gms",
    audience: "gms-api",
    expiresIn: "1h",
  });

beforeAll(async () => {
  db = await MongoMemoryServer.create({
    instance: {
      args: process.platform === "win32" ? [] : ["--nounixsocket"],
    },
  });
  await mongoose.connect(db.getUri());
  await Promise.all([
    User.init(),
    Equipment.init(),
    Ticket.init(),
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await db?.stop();
});

beforeEach(async () => {
  vi.restoreAllMocks();

  await Promise.all([
    User.deleteMany({}),
    Equipment.deleteMany({}),
    Ticket.deleteMany({}),
  ]);

  admin = await User.create({
    firstName: "Admin",
    lastName: "User",
    email: "admin@gym.test",
    passwordHash: "hash-admin",
    role: "Admin",
    tier: "VIP",
    disabled: false,
  });

  trainer = await User.create({
    firstName: "Trainer",
    lastName: "Sam",
    email: "trainer@gym.test",
    passwordHash: "hash-trainer",
    role: "Trainer",
    tier: "Premium",
    disabled: false,
  });

  member = await User.create({
    firstName: "Jordan",
    lastName: "Lee",
    email: "member@gym.test",
    passwordHash: "hash-member",
    role: "Member",
    tier: "Basic",
    disabled: false,
  });

  await Equipment.create([
    {
      inventoryId: "TRD-101",
      name: "Treadmill Alpha",
      category: "Cardio",
      status: "Available",
    },
    {
      inventoryId: "BIK-102",
      name: "Spin Bike Beta",
      category: "Cardio",
      status: "Available",
    },
    {
      inventoryId: "RCK-103",
      name: "Power Squat Rack",
      category: "Strength",
      status: "Under Maintenance",
    },
  ]);

  app = createApp(config);
});

describe("Equipment Ticketing System & Filtering (REQ-5, REQ-6, UT-05, UT-06, ST-03)", () => {
  describe("TC-EQ-01: Staff submits a ticket for a valid inventory ID", () => {
    it("allows Admin to log a maintenance ticket and persists record with unique ticketId", async () => {
      const res = await request(app)
        .post("/api/equipment/ticket")
        .set("Authorization", `Bearer ${token(admin)}`)
        .send({
          equipmentId: "TRD-101",
          issueDescription: "Treadmill belt slipping during use.",
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe("success");
      expect(res.body.message).toBe("Maintenance ticket logged successfully.");
      expect(res.body.ticketId).toMatch(/^TCK-\d+$/);

      const ticketInDb = await Ticket.findOne({ ticketId: res.body.ticketId });
      expect(ticketInDb).not.toBeNull();
      expect(ticketInDb.equipmentId).toBe("TRD-101");
      expect(ticketInDb.issueDescription).toBe("Treadmill belt slipping during use.");
      expect(String(ticketInDb.submittedBy)).toBe(String(admin._id));
      expect(ticketInDb.status).toBe("Open");
    });

    it("allows Trainer to log a maintenance ticket using inventoryId field alias", async () => {
      const res = await request(app)
        .post("/api/equipment/ticket")
        .set("Authorization", `Bearer ${token(trainer)}`)
        .send({
          inventoryId: "BIK-102",
          description: "Resistance knob loose.",
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe("success");
      expect(res.body.ticketId).toBeDefined();

      const ticketInDb = await Ticket.findOne({ equipmentId: "BIK-102" });
      expect(ticketInDb).not.toBeNull();
      expect(ticketInDb.issueDescription).toBe("Resistance knob loose.");
      expect(String(ticketInDb.submittedBy)).toBe(String(trainer._id));
    });

    it("supports the plural route /api/equipment/tickets for submission", async () => {
      const res = await request(app)
        .post("/api/equipment/tickets")
        .set("Authorization", `Bearer ${token(trainer)}`)
        .send({
          equipmentId: "TRD-101",
          issueDescription: "Console display flickering intermittently.",
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe("success");
    });
  });

  describe("TC-EQ-02: Ticket with non-existent inventory ID or empty description is rejected", () => {
    it("rejects ticket with non-existent inventory ID with 400", async () => {
      const res = await request(app)
        .post("/api/equipment/ticket")
        .set("Authorization", `Bearer ${token(trainer)}`)
        .send({
          equipmentId: "GHOST-999",
          issueDescription: "Cable snapped.",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe(true);
      expect(res.body.message).toMatch(/not found/i);
    });

    it("rejects ticket with missing or empty equipment ID with 400", async () => {
      const res = await request(app)
        .post("/api/equipment/ticket")
        .set("Authorization", `Bearer ${token(trainer)}`)
        .send({
          equipmentId: "   ",
          issueDescription: "Frame vibrating.",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe(true);
      expect(res.body.message).toMatch(/inventory ID is required/i);
    });

    it("rejects ticket with missing or empty issue description with 400", async () => {
      const res = await request(app)
        .post("/api/equipment/ticket")
        .set("Authorization", `Bearer ${token(trainer)}`)
        .send({
          equipmentId: "TRD-101",
          issueDescription: "   ",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe(true);
      expect(res.body.message).toMatch(/description is required/i);
    });

    it("rejects ticket when issue description exceeds 1000 characters", async () => {
      const res = await request(app)
        .post("/api/equipment/ticket")
        .set("Authorization", `Bearer ${token(trainer)}`)
        .send({
          equipmentId: "TRD-101",
          issueDescription: "a".repeat(1001),
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe(true);
      expect(res.body.message).toMatch(/limit of 1000 characters/i);
    });
  });

  describe("RBAC: Ticket Submission Access Controls", () => {
    it("rejects Member from submitting a ticket with 403 Forbidden", async () => {
      const res = await request(app)
        .post("/api/equipment/ticket")
        .set("Authorization", `Bearer ${token(member)}`)
        .send({
          equipmentId: "TRD-101",
          issueDescription: "Belt loose.",
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe(true);
    });

    it("rejects unauthenticated ticket submission with 401", async () => {
      const res = await request(app)
        .post("/api/equipment/ticket")
        .send({
          equipmentId: "TRD-101",
          issueDescription: "Belt loose.",
        });

      expect(res.status).toBe(401);
    });

    it("rejects disabled staff from submitting tickets with 401", async () => {
      await User.updateOne({ _id: trainer._id }, { $set: { disabled: true } });

      const res = await request(app)
        .post("/api/equipment/ticket")
        .set("Authorization", `Bearer ${token(trainer)}`)
        .send({
          equipmentId: "TRD-101",
          issueDescription: "Belt loose.",
        });

      expect(res.status).toBe(401);
    });
  });

  describe("TC-EQ-03 & TC-EQ-04: Equipment Availability Filtering & State Transitions (REQ-6)", () => {
    it("TC-EQ-03: Equipment set to Under Maintenance no longer appears in member available list", async () => {
      // Initially, Member sees 2 available items: TRD-101 and BIK-102
      let memberListRes = await request(app)
        .get("/api/equipment")
        .set("Authorization", `Bearer ${token(member)}`);

      expect(memberListRes.status).toBe(200);
      expect(memberListRes.body.items).toHaveLength(2);
      expect(memberListRes.body.items.some((i) => i.inventoryId === "TRD-101")).toBe(true);

      // Admin updates TRD-101 to Under Maintenance
      const statusRes = await request(app)
        .patch("/api/equipment/TRD-101/status")
        .set("Authorization", `Bearer ${token(admin)}`)
        .send({ status: "Under Maintenance" });

      expect(statusRes.status).toBe(200);
      expect(statusRes.body.status).toBe("success");
      expect(statusRes.body.equipment.status).toBe("Under Maintenance");

      // Verify Member no longer sees TRD-101 in the available list
      memberListRes = await request(app)
        .get("/api/equipment")
        .set("Authorization", `Bearer ${token(member)}`);

      expect(memberListRes.status).toBe(200);
      expect(memberListRes.body.items).toHaveLength(1);
      expect(memberListRes.body.items[0].inventoryId).toBe("BIK-102");
      expect(memberListRes.body.items.some((i) => i.inventoryId === "TRD-101")).toBe(false);
    });

    it("TC-EQ-04: Equipment returned to Available reappears in member list", async () => {
      // RCK-103 is initially Under Maintenance
      let memberListRes = await request(app)
        .get("/api/equipment")
        .set("Authorization", `Bearer ${token(member)}`);

      expect(memberListRes.body.items.some((i) => i.inventoryId === "RCK-103")).toBe(false);

      // Admin returns RCK-103 to Available
      const statusRes = await request(app)
        .patch("/api/equipment/RCK-103/status")
        .set("Authorization", `Bearer ${token(admin)}`)
        .send({ status: "Available" });

      expect(statusRes.status).toBe(200);
      expect(statusRes.body.status).toBe("success");
      expect(statusRes.body.equipment.status).toBe("Available");

      // Member now sees RCK-103
      memberListRes = await request(app)
        .get("/api/equipment")
        .set("Authorization", `Bearer ${token(member)}`);

      expect(memberListRes.body.items.some((i) => i.inventoryId === "RCK-103")).toBe(true);
      expect(memberListRes.body.items).toHaveLength(3);
    });

    it("rejects Member from updating equipment status with 403 Forbidden", async () => {
      const res = await request(app)
        .patch("/api/equipment/TRD-101/status")
        .set("Authorization", `Bearer ${token(member)}`)
        .send({ status: "Under Maintenance" });

      expect(res.status).toBe(403);
    });

    it("rejects invalid status value with 400 Bad Request", async () => {
      const res = await request(app)
        .patch("/api/equipment/TRD-101/status")
        .set("Authorization", `Bearer ${token(admin)}`)
        .send({ status: "Broken" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe(true);
    });

    it("rejects non-existent equipment status update with 404", async () => {
      const res = await request(app)
        .patch("/api/equipment/NON-EXISTENT/status")
        .set("Authorization", `Bearer ${token(admin)}`)
        .send({ status: "Under Maintenance" });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe(true);
    });
  });

  describe("Equipment Query Filtering & Ticket Retrieval", () => {
    it("allows Staff to query equipment filtered by ?status query parameter", async () => {
      const availableRes = await request(app)
        .get("/api/equipment?status=Available")
        .set("Authorization", `Bearer ${token(trainer)}`);

      expect(availableRes.status).toBe(200);
      expect(availableRes.body.items).toHaveLength(2);
      expect(availableRes.body.items.every((i) => i.status === "Available")).toBe(true);

      const maintenanceRes = await request(app)
        .get("/api/equipment?status=Under%20Maintenance")
        .set("Authorization", `Bearer ${token(trainer)}`);

      expect(maintenanceRes.status).toBe(200);
      expect(maintenanceRes.body.items).toHaveLength(1);
      expect(maintenanceRes.body.items[0].inventoryId).toBe("RCK-103");
    });

    it("prevents Member from viewing Under Maintenance items even if ?status=Under Maintenance is passed", async () => {
      const res = await request(app)
        .get("/api/equipment?status=Under%20Maintenance")
        .set("Authorization", `Bearer ${token(member)}`);

      expect(res.status).toBe(200);
      expect(res.body.items.every((i) => i.status === "Available")).toBe(true);
      expect(res.body.items.some((i) => i.status === "Under Maintenance")).toBe(false);
    });

    it("allows Staff to retrieve logged tickets with populated equipment and user", async () => {
      await request(app)
        .post("/api/equipment/ticket")
        .set("Authorization", `Bearer ${token(trainer)}`)
        .send({
          equipmentId: "TRD-101",
          issueDescription: "Speed sensor faulty.",
        });

      const res = await request(app)
        .get("/api/equipment/tickets")
        .set("Authorization", `Bearer ${token(admin)}`);

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].equipmentId).toBe("TRD-101");
      expect(res.body.items[0].issueDescription).toBe("Speed sensor faulty.");
      expect(res.body.items[0].submittedBy.firstName).toBe("Trainer");
      expect(res.body.items[0].equipment.name).toBe("Treadmill Alpha");
    });

    it("rejects Member from fetching tickets with 403 Forbidden", async () => {
      const res = await request(app)
        .get("/api/equipment/tickets")
        .set("Authorization", `Bearer ${token(member)}`);

      expect(res.status).toBe(403);
    });
  });
});
