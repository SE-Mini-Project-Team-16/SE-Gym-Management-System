import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { existsSync } from "node:fs";
import { User, Booking, Equipment, GymClass } from "./models.js";
import {
  authenticate,
  allowRoles,
  apiError,
  errorHandler,
} from "./middleware.js";
import { createSummaryCache, loadDashboard } from "./dashboard.js";
import { issuePass } from "./pass.js";

const publicUser = (user) => ({
  id: String(user._id),
  firstName: user.firstName,
  lastName: user.lastName,
  role: user.role,
  tier: user.tier,
  membershipExpiresAt: user.membershipExpiresAt,
});
const objectId = (value) => mongoose.isObjectIdOrHexString(value);

export function createApp(config) {
  const app = express();
  const cached = createSummaryCache();
  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", 1);
  app.use(helmet());
  app.use((req, res, next) => {
    if (config.production && !req.secure)
      return res
        .status(308)
        .set("Location", config.publicOrigin + req.originalUrl)
        .json({ error: true, message: "Please use HTTPS.", code: 308 });
    next();
  });
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    const bodyExpected =
      Number(req.headers["content-length"] || 0) > 0 ||
      Boolean(req.headers["transfer-encoding"]);
    if (bodyExpected && !req.is("application/json"))
      return next(apiError(415, "Send request data as application/json."));
    next();
  });
  app.use(express.json({ limit: "16kb", strict: true }));
  app.get("/api/health", (req, res) => {
    const ready = mongoose.connection.readyState === 1;
    res.status(ready ? 200 : 503).json({
      status: ready ? "ok" : "unavailable",
      database: ready ? "connected" : "disconnected",
    });
  });

  // Minimal login adapter for the initial shell. Registration/RBAC work can extend this router.
  app.post(
    "/api/auth/login",
    rateLimit({
      windowMs: 15 * 60_000,
      limit: 30,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      handler: (req, res, next) =>
        next(
          apiError(429, "Too many sign-in attempts. Please try again later."),
        ),
    }),
    async (req, res) => {
      const { email, password } = req.body || {};
      if (
        typeof email !== "string" ||
        typeof password !== "string" ||
        email.length > 100 ||
        password.length > 128
      )
        throw apiError(400, "Enter a valid email and password.");
      const user = await User.findOne({ email: email.trim().toLowerCase() })
        .select("+passwordHash")
        .maxTimeMS(1000);
      // Perform a hash comparison for unknown users as well, to avoid a fast account-existence signal.
      const hash =
        user?.passwordHash ||
        "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";
      const valid = await bcrypt.compare(password, hash);
      if (!user || !valid || user.disabled)
        throw apiError(401, "Email or password is incorrect.");
      const token = jwt.sign({}, config.jwtSecret, {
        algorithm: "HS256",
        subject: String(user._id),
        issuer: "gms",
        audience: "gms-api",
        expiresIn: "1h",
      });
      res.json({ token, user: publicUser(user) });
    },
  );

  app.use("/api", authenticate(config));
  app.get("/api/me", (req, res) => res.json({ user: publicUser(req.user) }));
  app.get("/api/dashboard", async (req, res) => {
    const data = await cached(`${req.user.role}:${req.user._id}`, () =>
      loadDashboard(req.user),
    );
    res.json({ ...data, user: publicUser(req.user) });
  });
  app.get("/api/passes/me", allowRoles("Member"), (req, res) =>
    res.json(issuePass(req.user, config)),
  );
  app.post(
    "/api/passes/verify",
    allowRoles("Admin", "Trainer"),
    async (req, res) => {
      if (typeof req.body?.token !== "string" || req.body.token.length > 4096)
        throw apiError(400, "Provide an entry pass.");
      let payload;
      try {
        payload = jwt.verify(req.body.token, config.passSecret, {
          algorithms: ["HS256"],
          issuer: "gms",
          audience: "gms-entry",
        });
      } catch {
        throw apiError(403, "This entry pass is invalid or expired.");
      }
      if (payload.kind !== "entry-pass" || !objectId(payload.sub))
        throw apiError(403, "Invalid entry pass.");
      const member = await User.findById(payload.sub).lean().maxTimeMS(1000);
      if (!member) throw apiError(403, "This membership is unavailable.");
      issuePass(member, config); // Recheck revocation, role and current membership expiry on every scan.
      res.json({ valid: true, member: publicUser(member) });
    },
  );

  // Bounded read endpoints for the shell; mutations belong to the team's module issues.
  app.get("/api/members", allowRoles("Admin"), async (req, res) => {
    const users = await User.find({ role: "Member", disabled: false })
      .sort({ _id: 1 })
      .limit(50)
      .select("firstName lastName tier membershipExpiresAt")
      .lean()
      .maxTimeMS(1000);
    res.json({ items: users });
  });
  app.get("/api/classes", async (req, res) => {
    const filter = { status: "Open", startsAt: { $gte: new Date() } };
    if (req.user.role === "Trainer") filter.trainerId = req.user._id;
    res.json({
      items: await GymClass.find(filter)
        .sort({ startsAt: 1 })
        .limit(50)
        .select("name startsAt durationMinutes capacity availableSlots")
        .lean()
        .maxTimeMS(1000),
    });
  });
  app.get("/api/bookings", async (req, res) => {
    const filter = req.user.role === "Member" ? { memberId: req.user._id } : {};
    if (req.user.role === "Trainer") {
      // A lookup scopes roster access to the signed-in trainer without an unbounded ID list.
      const items = await Booking.aggregate([
        { $match: { status: "Active" } },
        {
          $lookup: {
            from: GymClass.collection.name,
            localField: "classId",
            foreignField: "_id",
            as: "session",
          },
        },
        { $unwind: "$session" },
        { $match: { "session.trainerId": req.user._id } },
        { $sort: { createdAt: -1 } },
        { $limit: 50 },
        {
          $project: {
            _id: 1,
            status: 1,
            createdAt: 1,
            classId: { name: "$session.name", startsAt: "$session.startsAt" },
          },
        },
      ]).option({ maxTimeMS: 1000 });
      return res.json({ items });
    }
    const items = await Booking.find(filter)
      .sort({ createdAt: -1 })
      .limit(50)
      .select("classId status createdAt")
      .populate({ path: "classId", select: "name startsAt status" })
      .lean()
      .maxTimeMS(1000);
    res.json({ items });
  });
  app.get("/api/equipment", async (req, res) => {
    const filter = req.user.role === "Member" ? { status: "Available" } : {};
    res.json({
      items: await Equipment.find(filter)
        .sort({ inventoryId: 1 })
        .limit(50)
        .select("inventoryId name category status")
        .lean()
        .maxTimeMS(1000),
    });
  });
  app.use("/api", (req, res, next) =>
    next(apiError(404, "API endpoint not found.")),
  );
  const clientDist = fileURLToPath(
    new URL("../../client/dist/", import.meta.url),
  );
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get("/{*path}", (req, res) =>
      res.sendFile(path.join(clientDist, "index.html")),
    );
  }
  app.use((req, res, next) => next(apiError(404, "Page not found.")));
  app.use(errorHandler);
  return app;
}
