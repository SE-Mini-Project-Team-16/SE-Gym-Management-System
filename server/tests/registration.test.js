import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createApp } from "../src/app.js";
import { User } from "../src/models.js";

const config = {
  jwtSecret: "authentication-test-secret-32-characters",
  passSecret: "different-pass-test-secret-32-characters",
};
const valid = {
  firstName: " Nitesh ",
  lastName: " Harsur ",
  email: " NITESH@GYM.TEST ",
  phoneNumber: "09876543210",
  password: "a-long-member-password",
};
let db, app;
const register = (body = valid) =>
  request(app).post("/api/auth/register").send(body);

beforeAll(async () => {
  db = await MongoMemoryServer.create();
  await mongoose.connect(db.getUri());
  await User.init();
});
afterAll(async () => {
  await mongoose.disconnect();
  await db?.stop();
});
beforeEach(async () => {
  await User.deleteMany({});
  app = createApp(config);
});

describe("member registration / issue #2", () => {
  it("normalizes fields, stores a cost-12 bcrypt hash, and supports existing login", async () => {
    const response = await register()
      .expect(201)
      .expect("Cache-Control", "no-store");
    expect(response.body.user).toMatchObject({
      firstName: "Nitesh",
      lastName: "Harsur",
      role: "Member",
      tier: "Basic",
      membershipExpiresAt: null,
    });
    const stored = await User.findOne({ email: "nitesh@gym.test" }).select(
      "+passwordHash +phoneNumber",
    );
    expect(stored.phoneNumber).toBe(valid.phoneNumber);
    expect(bcrypt.getRounds(stored.passwordHash)).toBe(12);
    expect(await bcrypt.compare(valid.password, stored.passwordHash)).toBe(
      true,
    );
    for (const secret of [
      valid.password,
      stored.passwordHash,
      "passwordHash",
      "phoneNumber",
    ])
      expect(JSON.stringify(response.body)).not.toContain(secret);
    expect(
      await User.collection.findOne({ _id: stored._id }),
    ).not.toHaveProperty("password");
    expect((await User.findById(stored._id)).passwordHash).toBeUndefined();
    expect((await User.findById(stored._id)).phoneNumber).toBeUndefined();
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: valid.email, password: valid.password })
      .expect(200);
    await request(app)
      .get("/api/me")
      .auth(login.body.token, { type: "bearer" })
      .expect(200);
  });

  it("ignores privileged fields, injected hashes, and supplied account IDs", async () => {
    const response = await register({
      ...valid,
      role: "Admin",
      tier: "VIP",
      disabled: true,
      membershipExpiresAt: "2099-01-01",
      passwordHash: "injected",
      _id: "aaaaaaaaaaaaaaaaaaaaaaaa",
    }).expect(201);
    const stored = await User.findById(response.body.user.id).select(
      "+passwordHash",
    );
    expect(stored).toMatchObject({
      role: "Member",
      tier: "Basic",
      disabled: false,
      membershipExpiresAt: null,
    });
    expect(String(stored._id)).not.toBe("aaaaaaaaaaaaaaaaaaaaaaaa");
    expect(stored.passwordHash).not.toBe("injected");
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: valid.email, password: valid.password });
    await request(app)
      .get("/api/members")
      .auth(login.body.token, { type: "bearer" })
      .expect(403);
  });

  it("returns 409 for normalized duplicates and preserves the existing account", async () => {
    await register().expect(201);
    await register({
      ...valid,
      email: "nitesh@gym.test",
      password: "another-valid-password",
    }).expect(409);
    expect(await User.countDocuments()).toBe(1);
    const stored = await User.findOne().select("+passwordHash");
    expect(await bcrypt.compare(valid.password, stored.passwordHash)).toBe(
      true,
    );
  });

  it("creates exactly one account when the same email is registered concurrently", async () => {
    const results = await Promise.all([register(), register(), register()]);
    expect(results.map((result) => result.status).sort()).toEqual([
      201, 409, 409,
    ]);
    expect(await User.countDocuments()).toBe(1);
  });

  it("salts identical passwords independently", async () => {
    await register().expect(201);
    await register({ ...valid, email: "other@gym.test" }).expect(201);
    const users = await User.find().select("+passwordHash");
    expect(users[0].passwordHash).not.toBe(users[1].passwordHash);
  });

  it.each([
    ["firstName", ""],
    ["firstName", "   "],
    ["firstName", "a".repeat(51)],
    ["lastName", ""],
    ["lastName", "a".repeat(51)],
    ["firstName", { $ne: null }],
    ["email", "not-an-email"],
    ["email", "a@b@c.test"],
    ["email", "a b@gym.test"],
    ["email", "a".repeat(92) + "@gym.test"],
    ["email", { $ne: null }],
    ["phoneNumber", ""],
    ["phoneNumber", "1234567890123456"],
    ["phoneNumber", "12abc"],
    ["phoneNumber", 12345],
    ["password", "short"],
    ["password", "a".repeat(65)],
    ["password", "界".repeat(25)],
    ["password", { $ne: null }],
  ])("rejects invalid %s without storing an account", async (field, value) => {
    const response = await register({ ...valid, [field]: value }).expect(400);
    expect(response.body).toMatchObject({ error: true, code: 400 });
    expect(await User.countDocuments()).toBe(0);
    expect(JSON.stringify(response.body)).not.toContain(valid.password);
  });

  it.each(Object.keys(valid))("requires %s", async (field) => {
    const body = { ...valid };
    delete body[field];
    await register(body).expect(400);
    expect(await User.countDocuments()).toBe(0);
  });

  it("accepts maximum field lengths and the exact bcrypt UTF-8 byte boundary", async () => {
    await register({
      ...valid,
      firstName: "a".repeat(50),
      lastName: "b".repeat(50),
      email: "a".repeat(91) + "@gym.test",
      phoneNumber: "1".repeat(15),
      password: "x".repeat(64),
    }).expect(201);
    await register({ ...valid, password: "界".repeat(24) }).expect(201);
  });

  it("rejects non-JSON, malformed JSON and oversized payloads", async () => {
    await request(app)
      .post("/api/auth/register")
      .type("form")
      .send("email=x")
      .expect(415);
    await request(app)
      .post("/api/auth/register")
      .type("json")
      .send("{broken")
      .expect(400);
    await register({ ...valid, firstName: "x".repeat(17000) }).expect(413);
    expect(await User.countDocuments()).toBe(0);
  });

  it("throttles registration separately from login with standard JSON errors", async () => {
    for (let i = 0; i < 10; i++) await register({}).expect(400);
    expect((await register({}).expect(429)).body).toMatchObject({
      error: true,
      code: 429,
    });
    await request(app).post("/api/auth/login").send({}).expect(400);
  });
});
