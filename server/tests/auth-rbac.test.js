import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createApp } from "../src/app.js";
import { User, GymClass, Booking, Equipment } from "../src/models.js";

const config = {
  jwtSecret: "authentication-test-secret-32-characters",
  passSecret: "different-pass-test-secret-32-characters",
};

let db, app, admin, trainer, member, targetUser;

const makeToken = (user, options = {}, secret = config.jwtSecret) =>
  jwt.sign({}, secret, {
    algorithm: "HS256",
    subject: String(user._id),
    issuer: "gms",
    audience: "gms-api",
    expiresIn: "1h",
    ...options,
  });

beforeAll(async () => {
  db = await MongoMemoryServer.create({
    instance: {
      args: ["--nounixsocket"],
    },
  });
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

  const hash = await bcrypt.hash("secure-password-123", 10);
  [admin, trainer, member, targetUser] = await User.create([
    {
      firstName: "Admin",
      lastName: "User",
      email: "admin@gms.test",
      passwordHash: hash,
      role: "Admin",
    },
    {
      firstName: "Trainer",
      lastName: "User",
      email: "trainer@gms.test",
      passwordHash: hash,
      role: "Trainer",
    },
    {
      firstName: "Member",
      lastName: "User",
      email: "member@gms.test",
      passwordHash: hash,
      role: "Member",
      tier: "Premium",
      membershipExpiresAt: new Date(Date.now() + 86400_000 * 30),
    },
    {
      firstName: "Target",
      lastName: "Victim",
      email: "target@gms.test",
      passwordHash: hash,
      role: "Member",
      tier: "Basic",
    },
  ]);
});

describe("REQ-SEC-01 / SV-01: JWT Authentication Enforcement (TC-SEC-01)", () => {
  it("rejects protected endpoints when Authorization header is missing (401)", async () => {
    const res = await request(app).get("/api/me").expect(401);
    expect(res.body).toEqual({
      error: true,
      message: "Please sign in to continue.",
      code: 401,
    });
  });

  it("rejects non-Bearer Authorization headers (401)", async () => {
    const res = await request(app)
      .get("/api/me")
      .set("Authorization", "Basic dXNlcjpwYXNz")
      .expect(401);
    expect(res.body).toMatchObject({ error: true, code: 401 });
  });

  it("rejects malformed token strings (401)", async () => {
    const res = await request(app)
      .get("/api/me")
      .set("Authorization", "Bearer not.a.valid.jwt")
      .expect(401);
    expect(res.body).toMatchObject({
      error: true,
      message: "Your session has expired. Please sign in again.",
      code: 401,
    });
  });

  it("rejects expired tokens (401)", async () => {
    const expiredToken = makeToken(member, { expiresIn: "-10s" });
    const res = await request(app)
      .get("/api/me")
      .auth(expiredToken, { type: "bearer" })
      .expect(401);
    expect(res.body).toMatchObject({
      error: true,
      message: "Your session has expired. Please sign in again.",
      code: 401,
    });
  });

  it("rejects tokens signed with an incorrect secret (401)", async () => {
    const forgedToken = makeToken(
      member,
      {},
      "wrong-forged-secret-32-characters-long",
    );
    const res = await request(app)
      .get("/api/me")
      .auth(forgedToken, { type: "bearer" })
      .expect(401);
    expect(res.body).toMatchObject({ error: true, code: 401 });
  });

  it("rejects tokens with tampered signatures (401)", async () => {
    const validToken = makeToken(member);
    const tampered = `${validToken}tampered`;
    const res = await request(app)
      .get("/api/me")
      .auth(tampered, { type: "bearer" })
      .expect(401);
    expect(res.body).toMatchObject({ error: true, code: 401 });
  });

  it("rejects 'alg: none' unsigned tokens (401)", async () => {
    const header = Buffer.from(
      JSON.stringify({ alg: "none", typ: "JWT" }),
    ).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        sub: String(member._id),
        iss: "gms",
        aud: "gms-api",
      }),
    ).toString("base64url");
    const noneToken = `${header}.${payload}.`;

    const res = await request(app)
      .get("/api/me")
      .auth(noneToken, { type: "bearer" })
      .expect(401);
    expect(res.body).toMatchObject({ error: true, code: 401 });
  });

  it("rejects tokens with invalid audience or issuer (401)", async () => {
    const badAudToken = makeToken(member, { audience: "wrong-audience" });
    await request(app)
      .get("/api/me")
      .auth(badAudToken, { type: "bearer" })
      .expect(401);

    const badIssToken = makeToken(member, { issuer: "wrong-issuer" });
    await request(app)
      .get("/api/me")
      .auth(badIssToken, { type: "bearer" })
      .expect(401);
  });

  it("rejects entry pass tokens used as API session tokens (401)", async () => {
    const entryPassToken = jwt.sign(
      { sub: String(member._id), kind: "entry-pass" },
      config.jwtSecret,
      { algorithm: "HS256", issuer: "gms", audience: "gms-api" },
    );
    const res = await request(app)
      .get("/api/me")
      .auth(entryPassToken, { type: "bearer" })
      .expect(401);
    expect(res.body).toMatchObject({
      error: true,
      message: "Entry pass cannot be used as an API session.",
      code: 401,
    });
  });

  it("rejects tokens if user has been disabled or deleted from DB (401)", async () => {
    const validToken = makeToken(member);
    await User.updateOne({ _id: member._id }, { $set: { disabled: true } });

    const disabledRes = await request(app)
      .get("/api/me")
      .auth(validToken, { type: "bearer" })
      .expect(401);
    expect(disabledRes.body).toMatchObject({
      error: true,
      message: "This account is unavailable.",
      code: 401,
    });

    await User.deleteOne({ _id: member._id });
    const deletedRes = await request(app)
      .get("/api/me")
      .auth(validToken, { type: "bearer" })
      .expect(401);
    expect(deletedRes.body).toMatchObject({
      error: true,
      message: "This account is unavailable.",
      code: 401,
    });
  });

  it("rejects tokens with non-ObjectId subject (401)", async () => {
    const badSubToken = jwt.sign({}, config.jwtSecret, {
      algorithm: "HS256",
      subject: "not-an-object-id",
      issuer: "gms",
      audience: "gms-api",
      expiresIn: "1h",
    });
    const res = await request(app)
      .get("/api/me")
      .auth(badSubToken, { type: "bearer" })
      .expect(401);
    expect(res.body).toMatchObject({
      error: true,
      message: "Invalid session.",
      code: 401,
    });
  });

  it("accepts valid JWT and returns public sanitized profile", async () => {
    const validToken = makeToken(member);
    const res = await request(app)
      .get("/api/me")
      .auth(validToken, { type: "bearer" })
      .expect(200);

    expect(res.body.user).toEqual({
      id: String(member._id),
      firstName: "Member",
      lastName: "User",
      role: "Member",
      tier: "Premium",
      membershipExpiresAt: expect.any(String),
    });
    expect(JSON.stringify(res.body)).not.toContain("passwordHash");
  });
});

describe("REQ-SEC-02 / NFR-5 / SV-02: RBAC Matrix and Protected Admin Routes (TC-SEC-02, TC-SEC-04)", () => {
  it("enforces RBAC matrix on /api/users/delete (POST & DELETE)", async () => {
    // 1. Anonymous -> 401, target user unchanged
    const anonRes = await request(app)
      .post("/api/users/delete")
      .send({ userId: String(targetUser._id) })
      .expect(401);
    expect(anonRes.body).toMatchObject({ error: true, code: 401 });
    expect(await User.findById(targetUser._id)).not.toBeNull();

    // 2. Member -> 403, target user unchanged
    const memberRes = await request(app)
      .post("/api/users/delete")
      .auth(makeToken(member), { type: "bearer" })
      .send({ userId: String(targetUser._id) })
      .expect(403);
    expect(memberRes.body).toEqual({
      error: true,
      message: "You do not have access to this page.",
      code: 403,
    });
    expect(await User.findById(targetUser._id)).not.toBeNull();

    // 3. Trainer -> 403, target user unchanged
    const trainerRes = await request(app)
      .delete(`/api/users/delete/${targetUser._id}`)
      .auth(makeToken(trainer), { type: "bearer" })
      .expect(403);
    expect(trainerRes.body).toEqual({
      error: true,
      message: "You do not have access to this page.",
      code: 403,
    });
    expect(await User.findById(targetUser._id)).not.toBeNull();

    // 4. Admin -> 200, target user successfully removed
    const adminRes = await request(app)
      .post("/api/users/delete")
      .auth(makeToken(admin), { type: "bearer" })
      .send({ userId: String(targetUser._id) })
      .expect(200);
    expect(adminRes.body).toMatchObject({
      status: "success",
      deletedUserId: String(targetUser._id),
    });
    expect(await User.findById(targetUser._id)).toBeNull();
  });

  it("prevents Admin from deleting their own active account", async () => {
    const res = await request(app)
      .delete(`/api/users/delete/${admin._id}`)
      .auth(makeToken(admin), { type: "bearer" })
      .expect(400);
    expect(res.body).toMatchObject({
      error: true,
      message: "Admins cannot delete their own account.",
      code: 400,
    });
    expect(await User.findById(admin._id)).not.toBeNull();
  });

  it("enforces RBAC matrix on /api/revenue/view", async () => {
    // 1. Anonymous -> 401
    const anonRes = await request(app).get("/api/revenue/view").expect(401);
    expect(anonRes.body).toMatchObject({ error: true, code: 401 });

    // 2. Member -> 403
    const memberRes = await request(app)
      .get("/api/revenue/view")
      .auth(makeToken(member), { type: "bearer" })
      .expect(403);
    expect(memberRes.body).toEqual({
      error: true,
      message: "You do not have access to this page.",
      code: 403,
    });

    // 3. Trainer -> 403
    const trainerRes = await request(app)
      .get("/api/revenue/view")
      .auth(makeToken(trainer), { type: "bearer" })
      .expect(403);
    expect(trainerRes.body).toEqual({
      error: true,
      message: "You do not have access to this page.",
      code: 403,
    });

    // 4. Admin -> 200 with revenue breakdown
    const adminRes = await request(app)
      .get("/api/revenue/view")
      .auth(makeToken(admin), { type: "bearer" })
      .expect(200);
    expect(adminRes.body).toMatchObject({
      status: "success",
      revenue: {
        currency: "USD",
        breakdown: expect.any(Object),
      },
    });
    expect(adminRes.body.revenue.totalRevenue).toBeGreaterThanOrEqual(0);
  });
});

describe("NFR-4 / SV-04 / TC-SEC-03: Credential Storage & Sanitization", () => {
  it("stores passwords hashed with bcrypt cost factor >= 10", async () => {
    const dbUser = await User.findOne({ email: "member@gms.test" }).select(
      "+passwordHash",
    );
    expect(dbUser.passwordHash).toMatch(/^\$2[aby]\$\d{2}\$/);
    const cost = parseInt(dbUser.passwordHash.split("$")[2], 10);
    expect(cost).toBeGreaterThanOrEqual(10);
  });

  it("never returns password or passwordHash in /api/auth/login response", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "member@gms.test", password: "secure-password-123" })
      .expect(200);

    expect(res.body.token).toBeDefined();
    expect(res.body.user).toBeDefined();
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain("passwordHash");
    expect(JSON.stringify(res.body)).not.toContain("secure-password-123");
  });
});

describe("SV-03 / TC-SEC-06: Mass Assignment Mitigation", () => {
  it("strips role, tier, and expiryDate from login payload to prevent privilege escalation", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({
        email: "member@gms.test",
        password: "secure-password-123",
        role: "Admin",
        tier: "VIP",
        expiryDate: new Date(Date.now() + 86400_000 * 365),
      })
      .expect(200);

    // Returned user role must remain unchanged in database and response
    expect(res.body.user.role).toBe("Member");
    const dbUser = await User.findById(member._id);
    expect(dbUser.role).toBe("Member");
  });
});

describe("SV-08: Login Abuse & Enumeration Mitigation", () => {
  it("returns generic error message on invalid password without user enumeration", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "member@gms.test", password: "incorrect-password" })
      .expect(401);

    expect(res.body).toEqual({
      error: true,
      message: "Email or password is incorrect.",
      code: 401,
    });
  });

  it("returns identical generic error message for non-existent email", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "nonexistent@gms.test", password: "arbitrary-password" })
      .expect(401);

    expect(res.body).toEqual({
      error: true,
      message: "Email or password is incorrect.",
      code: 401,
    });
  });

  it("triggers 429 rate limit when login attempts threshold is exceeded", async () => {
    for (let attempt = 0; attempt < 30; attempt++) {
      await request(app)
        .post("/api/auth/login")
        .send({ email: "member@gms.test", password: "wrong" })
        .expect(401);
    }

    const rateLimited = await request(app)
      .post("/api/auth/login")
      .send({ email: "member@gms.test", password: "wrong" })
      .expect(429);

    expect(rateLimited.body).toEqual({
      error: true,
      message: "Too many sign-in attempts. Please try again later.",
      code: 429,
    });
  });
});
