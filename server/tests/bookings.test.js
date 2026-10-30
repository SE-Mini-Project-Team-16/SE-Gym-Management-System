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
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { createApp } from "../src/app.js";
import { Booking, GymClass, User } from "../src/models.js";

const config = {
  jwtSecret: "booking-test-secret-at-least-32-characters",
  passSecret: "separate-booking-pass-secret-32-characters",
};
let db, app, members, trainer, admin, gymClass;
const token = (user) =>
  jwt.sign({}, config.jwtSecret, {
    subject: String(user._id),
    issuer: "gms",
    audience: "gms-api",
    expiresIn: "1h",
  });
const book = (body = { classId: String(gymClass._id) }, user = members[0]) =>
  request(app)
    .post("/api/bookings")
    .auth(token(user), { type: "bearer" })
    .send(body);

beforeAll(async () => {
  db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(db.getUri());
  await Promise.all([User.init(), GymClass.init(), Booking.init()]);
});
afterAll(async () => {
  await mongoose.disconnect();
  await db?.stop();
});
beforeEach(async () => {
  vi.restoreAllMocks();
  await Promise.all([
    Booking.deleteMany({}),
    GymClass.deleteMany({}),
    User.deleteMany({}),
  ]);
  app = createApp(config);
  const users = await User.create(
    Array.from({ length: 12 }, (_, i) => ({
      firstName: "Booking",
      lastName: `User${i}`,
      email: `booking${i}@test.dev`,
      passwordHash: "not-used-by-token-tests",
      role: i === 10 ? "Trainer" : i === 11 ? "Admin" : "Member",
    })),
  );
  members = users.slice(0, 10);
  [trainer, admin] = users.slice(10);
  gymClass = await GymClass.create({
    name: "Strength",
    trainerId: trainer._id,
    startsAt: new Date(Date.now() + 3600_000),
    capacity: 5,
    availableSlots: 5,
  });
});

async function expectInventory(slots, bookings) {
  expect((await GymClass.findById(gymClass._id)).availableSlots).toBe(slots);
  expect(
    await Booking.countDocuments({ classId: gymClass._id, status: "Active" }),
  ).toBe(bookings);
}

describe("class booking / issue #6 / REQ-3", () => {
  it("TC-BK-01: confirms a booking and decrements slots exactly once", async () => {
    const response = await book()
      .expect(200)
      .expect("Cache-Control", "no-store");
    expect(response.body).toEqual({
      status: "success",
      bookingId: expect.any(String),
      remainingSlots: 4,
    });
    const saved = await Booking.findById(response.body.bookingId);
    expect(saved.memberId.equals(members[0]._id)).toBe(true);
    expect(saved.classId.equals(gymClass._id)).toBe(true);
    await expectInventory(4, 1);
    const list = await request(app)
      .get("/api/bookings")
      .auth(token(members[0]), { type: "bearer" })
      .expect(200);
    expect(list.body.items.map((item) => item._id)).toContain(
      response.body.bookingId,
    );
  });
  it("TC-BK-02: rejects a full class without creating a booking", async () => {
    await GymClass.updateOne({ _id: gymClass._id }, { availableSlots: 0 });
    expect((await book().expect(400)).body).toMatchObject({
      error: true,
      code: 400,
    });
    await expectInventory(0, 0);
  });
  it("TC-BK-03: only one of two members can reserve the last slot", async () => {
    await GymClass.updateOne(
      { _id: gymClass._id },
      { capacity: 1, availableSlots: 1 },
    );
    const results = await Promise.all(
      members.slice(0, 2).map((user) => book(undefined, user)),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    await expectInventory(0, 1);
  });
  it("caps ten simultaneous requests at the five available places", async () => {
    const results = await Promise.all(
      members.map((user) => book(undefined, user)),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(5);
    expect(results.filter((r) => r.status === 400)).toHaveLength(5);
    await expectInventory(0, 5);
  });
  it("rejects concurrent duplicate bookings without consuming another slot", async () => {
    const results = await Promise.all([book(), book(), book()]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    await book().expect(409);
    await expectInventory(4, 1);
  });
  it("rolls back the slot reservation when booking persistence fails", async () => {
    vi.spyOn(Booking, "create").mockRejectedValueOnce(
      new Error("simulated write failure"),
    );
    const failed = await book().expect(500);
    expect(failed.body.message).not.toContain("simulated");
    await expectInventory(5, 0);
    vi.restoreAllMocks();
    await book().expect(200);
    await expectInventory(4, 1);
  });
  it("enforces uniqueness in MongoDB while allowing cancelled booking history", async () => {
    await Booking.create({
      memberId: members[0]._id,
      classId: gymClass._id,
      status: "Cancelled",
    });
    await book().expect(200);
    await expect(
      Booking.create({ memberId: members[0]._id, classId: gymClass._id }),
    ).rejects.toMatchObject({ code: 11000 });
    await expectInventory(4, 1);
  });
  it.each([
    {},
    { classId: "invalid" },
    { classId: null },
    { classId: 1 },
    { classId: { $ne: null } },
    { classId: [] },
  ])("rejects malformed class identifiers: %j", async (body) => {
    await book(body).expect(400);
    await expectInventory(5, 0);
  });
  it("rejects a missing class", async () => {
    await book({ classId: String(new mongoose.Types.ObjectId()) }).expect(404);
    await expectInventory(5, 0);
  });
  it.each(["Cancelled", "started"])("rejects a %s class", async (state) => {
    await GymClass.updateOne(
      { _id: gymClass._id },
      state === "Cancelled"
        ? { status: "Cancelled" }
        : { startsAt: new Date(Date.now() - 1000) },
    );
    await book().expect(400);
    await expectInventory(5, 0);
  });
  it("requires authentication and restricts booking to members", async () => {
    await request(app)
      .post("/api/bookings")
      .send({ classId: String(gymClass._id) })
      .expect(401);
    await book(undefined, trainer).expect(403);
    await book(undefined, admin).expect(403);
    await User.updateOne({ _id: members[0]._id }, { disabled: true });
    await book().expect(401);
    await expectInventory(5, 0);
  });
  it("ignores caller-provided ownership, status, and slot counts", async () => {
    await book({
      classId: String(gymClass._id),
      memberId: String(members[1]._id),
      status: "Cancelled",
      availableSlots: 999,
    }).expect(200);
    const saved = await Booking.findOne({ classId: gymClass._id });
    expect(saved.memberId.equals(members[0]._id)).toBe(true);
    expect(saved.status).toBe("Active");
    const otherList = await request(app)
      .get("/api/bookings")
      .auth(token(members[1]), { type: "bearer" })
      .expect(200);
    expect(otherList.body.items).toEqual([]);
    await expectInventory(4, 1);
  });
});
