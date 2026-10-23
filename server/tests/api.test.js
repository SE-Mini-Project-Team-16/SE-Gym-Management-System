import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { User, GymClass, Booking, Equipment } from "../src/models.js";

const config = {
  jwtSecret: "authentication-test-secret-32-characters",
  passSecret: "different-pass-test-secret-32-characters",
};
let db, app, member, other, trainer, admin, session;
const token = (user, options = {}) =>
  jwt.sign({}, config.jwtSecret, {
    algorithm: "HS256",
    subject: String(user._id),
    issuer: "gms",
    audience: "gms-api",
    expiresIn: "1h",
    ...options,
  });
const get = (path, user = member) =>
  request(app).get(`/api${path}`).auth(token(user), { type: "bearer" });
const post = (path, body, user = member) =>
  request(app)
    .post(`/api${path}`)
    .auth(token(user), { type: "bearer" })
    .send(body);

beforeAll(async () => {
  db = await MongoMemoryServer.create();
  await mongoose.connect(db.getUri());
  await Promise.all([
    User.init(),
    GymClass.init(),
    Booking.init(),
    Equipment.init(),
  ]);
});
afterAll(async () => {
  await mongoose.disconnect();
  await db?.stop();
});
beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    GymClass.deleteMany({}),
    Booking.deleteMany({}),
    Equipment.deleteMany({}),
  ]);
  app = createApp(config);
  const hash = await bcrypt.hash("valid-member-password", 10);
  [member, other, trainer, admin] = await User.create([
    {
      firstName: "Member",
      lastName: "One",
      email: "member@test.dev",
      passwordHash: hash,
      membershipExpiresAt: new Date(Date.now() + 86400_000),
    },
    {
      firstName: "Other",
      lastName: "Member",
      email: "other@test.dev",
      passwordHash: hash,
      membershipExpiresAt: new Date(Date.now() - 86400_000),
    },
    {
      firstName: "Trainer",
      lastName: "One",
      email: "trainer@test.dev",
      passwordHash: hash,
      role: "Trainer",
    },
    {
      firstName: "Admin",
      lastName: "One",
      email: "admin@test.dev",
      passwordHash: hash,
      role: "Admin",
    },
  ]);
  session = await GymClass.create({
    name: "Strength",
    trainerId: trainer._id,
    startsAt: new Date(Date.now() + 3600_000),
    capacity: 20,
    availableSlots: 18,
  });
  await Booking.create([
    { classId: session._id, memberId: member._id },
    { classId: session._id, memberId: other._id },
  ]);
  await Equipment.create([
    { inventoryId: "A", name: "Rack", category: "Strength" },
    {
      inventoryId: "B",
      name: "Bike",
      category: "Cardio",
      status: "Under Maintenance",
    },
  ]);
});

describe("API gateway / issue #1", () => {
  it("reports database readiness with JSON and security headers", async () => {
    const response = await request(app)
      .get("/api/health")
      .expect(200)
      .expect("Content-Type", /json/);
    expect(response.body).toEqual({ status: "ok", database: "connected" });
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });
  it.each([
    "/dashboard",
    "/me",
    "/members",
    "/bookings",
    "/equipment",
    "/classes",
    "/passes/me",
  ])("protects %s from anonymous access", async (path) => {
    const response = await request(app).get(`/api${path}`).expect(401);
    expect(response.body).toMatchObject({ error: true, code: 401 });
  });
  it("rejects malformed, expired and tampered sessions", async () => {
    for (const value of [
      "bad-token",
      token(member, { expiresIn: "-1s" }),
      `${token(member)}broken`,
    ])
      await request(app)
        .get("/api/me")
        .auth(value, { type: "bearer" })
        .expect(401);
  });
  it("issues a login session without exposing the password hash", async () => {
    const response = await request(app)
      .post("/api/auth/login")
      .send({ email: " MEMBER@TEST.DEV ", password: "valid-member-password" })
      .expect(200);
    expect(response.body.user.role).toBe("Member");
    expect(JSON.stringify(response.body)).not.toContain("passwordHash");
    await request(app)
      .get("/api/me")
      .auth(response.body.token, { type: "bearer" })
      .expect(200);
  });
  it("rejects incorrect passwords and injection-shaped credentials", async () => {
    await request(app)
      .post("/api/auth/login")
      .send({ email: "member@test.dev", password: "wrong" })
      .expect(401);
    await request(app)
      .post("/api/auth/login")
      .send({ email: { $ne: null }, password: "anything" })
      .expect(400);
  });
  it("returns standardized JSON when sign-in throttling is reached", async () => {
    for (let attempt = 0; attempt < 30; attempt++) {
      await request(app).post("/api/auth/login").send({}).expect(400);
    }
    const response = await request(app)
      .post("/api/auth/login")
      .send({})
      .expect(429)
      .expect("Content-Type", /json/);
    expect(response.body).toMatchObject({ error: true, code: 429 });
  });
  it("enforces JSON bodies, rejects invalid JSON and unknown API routes", async () => {
    await request(app)
      .post("/api/auth/login")
      .type("form")
      .send("email=x")
      .expect(415);
    await request(app)
      .post("/api/auth/login")
      .set("Content-Type", "application/json")
      .send("{broken")
      .expect(400);
    await get("/unknown").expect(404).expect("Content-Type", /json/);
  });
  it("restricts the member directory and hides maintenance equipment from members", async () => {
    await get("/members").expect(403);
    const directory = await get("/members", admin).expect(200);
    expect(directory.body.items).toHaveLength(2);
    expect(JSON.stringify(directory.body)).not.toContain("email");
    expect((await get("/equipment")).body.items).toHaveLength(1);
    expect((await get("/equipment", trainer)).body.items).toHaveLength(2);
  });
  it("scopes bookings to the current member or trainer", async () => {
    expect((await get("/bookings")).body.items).toHaveLength(1);
    expect((await get("/bookings", trainer)).body.items).toHaveLength(2);
    const secondTrainer = await User.create({
      firstName: "Second",
      lastName: "Trainer",
      email: "second@test.dev",
      passwordHash: "not-used",
      role: "Trainer",
    });
    expect((await get("/bookings", secondTrainer)).body.items).toHaveLength(0);
  });
  it("redirects production HTTP to the configured HTTPS origin, not the Host header", async () => {
    const production = createApp({
      ...config,
      production: true,
      trustProxy: true,
      publicOrigin: "https://gym.example.com",
    });
    await request(production)
      .get("/api/health")
      .set("Host", "attacker.example")
      .expect(308)
      .expect("Location", "https://gym.example.com/api/health");
    await request(production)
      .get("/api/health")
      .set("X-Forwarded-Proto", "https")
      .expect(200);
  });
  it("refuses missing secrets and demo database mode in production", () => {
    expect(() => loadConfig({})).toThrow(/JWT_SECRET/);
    expect(() =>
      loadConfig({
        JWT_SECRET: config.jwtSecret,
        PASS_SECRET: config.jwtSecret,
      }),
    ).toThrow(/separate/);
    expect(() =>
      loadConfig({
        JWT_SECRET: config.jwtSecret,
        PASS_SECRET: config.passSecret,
        NODE_ENV: "production",
        DEMO_DATABASE: "true",
      }),
    ).toThrow(/forbidden/);
  });
});

describe("dashboard and entry pass", () => {
  it("returns member-scoped counts and no other member data", async () => {
    const response = await get("/dashboard").expect(200);
    expect(response.body.stats).toEqual({
      bookings: 1,
      upcomingCount: 1,
      availableEquipment: 1,
    });
    expect(response.body.upcomingClasses).toHaveLength(1);
    expect(JSON.stringify(response.body)).not.toContain(String(other._id));
    expect(response.headers["cache-control"]).toBe("no-store");
  });
  it("returns administrator membership metrics", async () => {
    expect((await get("/dashboard", admin)).body.stats).toEqual({
      members: 2,
      activeMembers: 1,
      expiringSoon: 1,
      availableEquipment: 1,
    });
  });
  it("returns trainer-scoped upcoming classes", async () => {
    const result = await get("/dashboard", trainer).expect(200);
    expect(result.body.stats.upcomingCount).toBe(1);
    expect(result.body.stats.bookings).toBeNull();
  });
  it("bounds upcoming dashboard rows to five", async () => {
    await GymClass.insertMany(
      Array.from({ length: 8 }, (_, i) => ({
        name: `Class ${i}`,
        trainerId: trainer._id,
        startsAt: new Date(Date.now() + (i + 2) * 3600_000),
        capacity: 10,
        availableSlots: 10,
      })),
    );
    expect((await get("/dashboard")).body.upcomingClasses).toHaveLength(5);
  });
  it("issues a signed pass only for the current member", async () => {
    const response = await get("/passes/me").expect(200);
    const payload = jwt.verify(response.body.token, config.passSecret, {
      audience: "gms-entry",
      issuer: "gms",
      algorithms: ["HS256"],
    });
    expect(payload.sub).toBe(String(member._id));
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(900);
    expect(response.body.member.name).toBe("Member One");
    expect(response.headers["cache-control"]).toBe("no-store");
  });
  it("never lets a pass outlive membership expiry", async () => {
    const expires = new Date(Date.now() + 60_000);
    await User.updateOne(
      { _id: member._id },
      { $set: { membershipExpiresAt: expires } },
    );
    const result = await get("/passes/me").expect(200);
    expect(new Date(result.body.expiresAt).getTime()).toBeLessThanOrEqual(
      expires.getTime(),
    );
  });
  it("rejects expired memberships, staff and disabled accounts", async () => {
    await get("/passes/me", other).expect(403);
    await get("/passes/me", trainer).expect(403);
    await User.updateOne({ _id: member._id }, { $set: { disabled: true } });
    await get("/passes/me").expect(401);
  });
  it("verifies valid passes for staff and prevents members verifying passes", async () => {
    const { body: pass } = await get("/passes/me");
    expect(
      (await post("/passes/verify", { token: pass.token }, trainer).expect(200))
        .body.valid,
    ).toBe(true);
    await post("/passes/verify", { token: pass.token }).expect(403);
    await post(
      "/passes/verify",
      { token: `${pass.token}changed` },
      trainer,
    ).expect(403);
    await post("/passes/verify", { token: token(member) }, trainer).expect(403);
  });
  it("rejects expired signed passes", async () => {
    const expired = jwt.sign(
      { sub: String(member._id), kind: "entry-pass" },
      config.passSecret,
      { issuer: "gms", audience: "gms-entry", expiresIn: "-1s" },
    );
    await post("/passes/verify", { token: expired }, trainer).expect(403);
  });
  it("rechecks revocation even after issuing a pass or caching a dashboard", async () => {
    await get("/dashboard").expect(200);
    const { body: pass } = await get("/passes/me");
    await User.updateOne(
      { _id: member._id },
      { $set: { membershipExpiresAt: new Date(Date.now() - 1000) } },
    );
    await post("/passes/verify", { token: pass.token }, trainer).expect(403);
    await get("/passes/me").expect(403);
  });
  it("rejects entry pass tokens used as API login sessions", async () => {
    const { body: pass } = await get("/passes/me");
    await request(app)
      .get("/api/me")
      .auth(pass.token, { type: "bearer" })
      .expect(401);
  });
});
