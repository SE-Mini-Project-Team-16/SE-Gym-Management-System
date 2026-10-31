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
import { User, GymClass, Booking, Notification } from "../src/models.js";
import { notificationService } from "../src/controllers/classController.js";

const config = {
  jwtSecret: "cancellation-test-secret-at-least-32-chars",
  passSecret: "separate-cancellation-pass-secret-32-chars",
};

let db, app, admin, trainer1, trainer2, member1, member2;

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
    GymClass.init(),
    Booking.init(),
    Notification.init(),
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await db?.stop();
});

beforeEach(async () => {
  vi.restoreAllMocks();
  notificationService.clear();

  await Promise.all([
    User.deleteMany({}),
    GymClass.deleteMany({}),
    Booking.deleteMany({}),
    Notification.deleteMany({}),
  ]);

  app = createApp(config);

  const users = await User.create([
    {
      firstName: "Admin",
      lastName: "User",
      email: "admin@gym.test",
      passwordHash: "not-used-in-token-tests",
      role: "Admin",
    },
    {
      firstName: "Trainer",
      lastName: "One",
      email: "trainer1@gym.test",
      passwordHash: "not-used-in-token-tests",
      role: "Trainer",
    },
    {
      firstName: "Trainer",
      lastName: "Two",
      email: "trainer2@gym.test",
      passwordHash: "not-used-in-token-tests",
      role: "Trainer",
    },
    {
      firstName: "Member",
      lastName: "One",
      email: "member1@gym.test",
      passwordHash: "not-used-in-token-tests",
      role: "Member",
      tier: "VIP",
      membershipExpiresAt: new Date(Date.now() + 86400_000),
    },
    {
      firstName: "Member",
      lastName: "Two",
      email: "member2@gym.test",
      passwordHash: "not-used-in-token-tests",
      role: "Member",
      tier: "Basic",
      membershipExpiresAt: new Date(Date.now() + 86400_000),
    },
  ]);

  [admin, trainer1, trainer2, member1, member2] = users;
});

describe("Class Cancellation Logic & Member Notifications / Issue #7 (REQ-4, UT-04, ST-02)", () => {
  async function createClassWithBookings(trainer = trainer1) {
    const gymClass = await GymClass.create({
      name: "HIIT Blast",
      trainerId: trainer._id,
      startsAt: new Date(Date.now() + 7200_000), // 2 hours in the future
      durationMinutes: 45,
      capacity: 10,
      availableSlots: 8,
      status: "Open",
    });

    const bookings = await Booking.create([
      { memberId: member1._id, classId: gymClass._id, status: "Active" },
      { memberId: member2._id, classId: gymClass._id, status: "Active" },
    ]);

    return { gymClass, bookings };
  }

  it("TC-CL-01: Admin cancels a class; status is Cancelled and every enrolled member is notified", async () => {
    const { gymClass } = await createClassWithBookings();

    const response = await request(app)
      .post(`/api/classes/${gymClass._id}/cancel`)
      .auth(token(admin), { type: "bearer" })
      .expect(200)
      .expect("Cache-Control", "no-store");

    expect(response.body).toMatchObject({
      status: "success",
      message: "Class cancelled successfully.",
      class: {
        id: String(gymClass._id),
        name: "HIIT Blast",
        status: "Cancelled",
      },
      enrolledCount: 2,
      notificationsSent: 2,
    });

    // Verify class status in database
    const updatedClass = await GymClass.findById(gymClass._id);
    expect(updatedClass.status).toBe("Cancelled");

    // Verify enrolled bookings are marked Cancelled
    const updatedBookings = await Booking.find({ classId: gymClass._id });
    expect(updatedBookings).toHaveLength(2);
    expect(updatedBookings.every((b) => b.status === "Cancelled")).toBe(true);

    // Verify notifications were dispatched to both members via service
    const dispatched = notificationService.getDispatched();
    expect(dispatched).toHaveLength(2);
    expect(dispatched.map((d) => d.memberEmail).sort()).toEqual([
      "member1@gym.test",
      "member2@gym.test",
    ]);
    expect(dispatched[0].message).toContain("HIIT Blast");

    // Verify persistent notifications in database for member1
    const member1Notes = await Notification.find({ recipientId: member1._id });
    expect(member1Notes).toHaveLength(1);
    expect(member1Notes[0].type).toBe("ClassCancelled");
    expect(member1Notes[0].classId.equals(gymClass._id)).toBe(true);

    // Verify persistent notifications in database for member2
    const member2Notes = await Notification.find({ recipientId: member2._id });
    expect(member2Notes).toHaveLength(1);

    // Verify member can query notifications via GET /api/notifications
    const apiNotes = await request(app)
      .get("/api/notifications")
      .auth(token(member1), { type: "bearer" })
      .expect(200);
    expect(apiNotes.body.items).toHaveLength(1);
    expect(apiNotes.body.items[0].message).toContain("HIIT Blast");
  });

  it("TC-CL-02: Trainer cancels own class; status is Cancelled and notifications sent", async () => {
    const { gymClass } = await createClassWithBookings(trainer1);

    const response = await request(app)
      .post("/api/classes/cancel")
      .auth(token(trainer1), { type: "bearer" })
      .send({ classId: String(gymClass._id) })
      .expect(200);

    expect(response.body).toMatchObject({
      status: "success",
      class: {
        id: String(gymClass._id),
        status: "Cancelled",
      },
      enrolledCount: 2,
      notificationsSent: 2,
    });

    const updatedClass = await GymClass.findById(gymClass._id);
    expect(updatedClass.status).toBe("Cancelled");

    const dispatched = notificationService.getDispatched();
    expect(dispatched).toHaveLength(2);
  });

  it("TC-CL-03: Member attempts to cancel a class; rejected with 403", async () => {
    const { gymClass } = await createClassWithBookings();

    const response = await request(app)
      .post(`/api/classes/${gymClass._id}/cancel`)
      .auth(token(member1), { type: "bearer" })
      .expect(403);

    expect(response.body).toMatchObject({
      error: true,
      code: 403,
    });

    // Ensure database remained untouched
    const unchangedClass = await GymClass.findById(gymClass._id);
    expect(unchangedClass.status).toBe("Open");

    const unchangedBookings = await Booking.find({ classId: gymClass._id });
    expect(unchangedBookings.every((b) => b.status === "Active")).toBe(true);
    expect(notificationService.getDispatched()).toHaveLength(0);
  });

  it("rejects cross-trainer cancellation: Trainer A cannot cancel Trainer B's class (403)", async () => {
    const { gymClass } = await createClassWithBookings(trainer1);

    // Trainer 2 attempts to cancel Trainer 1's class
    const response = await request(app)
      .post(`/api/classes/${gymClass._id}/cancel`)
      .auth(token(trainer2), { type: "bearer" })
      .expect(403);

    expect(response.body).toMatchObject({
      error: true,
      code: 403,
      message: "Trainers can only cancel their own classes.",
    });

    const unchangedClass = await GymClass.findById(gymClass._id);
    expect(unchangedClass.status).toBe("Open");
    expect(notificationService.getDispatched()).toHaveLength(0);
  });

  it("rejects unauthenticated requests with 401", async () => {
    const { gymClass } = await createClassWithBookings();

    await request(app)
      .post(`/api/classes/${gymClass._id}/cancel`)
      .expect(401);
  });

  it("rejects disabled staff accounts with 401", async () => {
    const { gymClass } = await createClassWithBookings();
    await User.updateOne({ _id: admin._id }, { disabled: true });

    await request(app)
      .post(`/api/classes/${gymClass._id}/cancel`)
      .auth(token(admin), { type: "bearer" })
      .expect(401);
  });

  it("rejects cancellation of an already cancelled class with 400", async () => {
    const { gymClass } = await createClassWithBookings();
    await GymClass.updateOne({ _id: gymClass._id }, { status: "Cancelled" });

    const response = await request(app)
      .post(`/api/classes/${gymClass._id}/cancel`)
      .auth(token(admin), { type: "bearer" })
      .expect(400);

    expect(response.body).toMatchObject({
      error: true,
      code: 400,
      message: "This class is already cancelled.",
    });
  });

  it("rejects cancellation of a class that has already started or passed with 400", async () => {
    const pastClass = await GymClass.create({
      name: "Past Yoga",
      trainerId: trainer1._id,
      startsAt: new Date(Date.now() - 3600_000), // 1 hour ago
      durationMinutes: 60,
      capacity: 10,
      availableSlots: 10,
      status: "Open",
    });

    const response = await request(app)
      .post(`/api/classes/${pastClass._id}/cancel`)
      .auth(token(admin), { type: "bearer" })
      .expect(400);

    expect(response.body).toMatchObject({
      error: true,
      code: 400,
      message: "Cannot cancel a class that has already started or ended.",
    });
  });

  it("rejects non-existent class with 404", async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const response = await request(app)
      .post(`/api/classes/${fakeId}/cancel`)
      .auth(token(admin), { type: "bearer" })
      .expect(404);

    expect(response.body).toMatchObject({
      error: true,
      code: 404,
      message: "Class not found.",
    });
  });

  it.each([
    "not-a-valid-id",
    "12345",
    "undefined",
    "null",
  ])("rejects malformed class identifiers (%s) with 400", async (badId) => {
    const response = await request(app)
      .post(`/api/classes/${badId}/cancel`)
      .auth(token(admin), { type: "bearer" })
      .expect(400);

    expect(response.body).toMatchObject({
      error: true,
      code: 400,
      message: "Provide a valid class identifier.",
    });
  });

  it("allows cancellation via HTTP DELETE /api/classes/:id", async () => {
    const { gymClass } = await createClassWithBookings();

    const response = await request(app)
      .delete(`/api/classes/${gymClass._id}`)
      .auth(token(admin), { type: "bearer" })
      .expect(200);

    expect(response.body.status).toBe("success");
    expect((await GymClass.findById(gymClass._id)).status).toBe("Cancelled");
  });

  it("omits cancelled classes from GET /api/classes open listing", async () => {
    const { gymClass } = await createClassWithBookings();

    // Before cancellation: class is in open classes
    const before = await request(app)
      .get("/api/classes")
      .auth(token(member1), { type: "bearer" })
      .expect(200);
    expect(before.body.items.some((c) => c._id === String(gymClass._id))).toBe(
      true,
    );

    // Cancel class
    await request(app)
      .post(`/api/classes/${gymClass._id}/cancel`)
      .auth(token(admin), { type: "bearer" })
      .expect(200);

    // After cancellation: class is omitted from open classes
    const after = await request(app)
      .get("/api/classes")
      .auth(token(member1), { type: "bearer" })
      .expect(200);
    expect(after.body.items.some((c) => c._id === String(gymClass._id))).toBe(
      false,
    );
  });

  it("supports stubbing the notificationService interface as mandated by STP §11", async () => {
    const { gymClass } = await createClassWithBookings();

    const stub = vi.spyOn(notificationService, "dispatch").mockResolvedValue({
      mocked: true,
    });

    await request(app)
      .post(`/api/classes/${gymClass._id}/cancel`)
      .auth(token(admin), { type: "bearer" })
      .expect(200);

    expect(stub).toHaveBeenCalledTimes(2);
    stub.mockRestore();
  });
});
