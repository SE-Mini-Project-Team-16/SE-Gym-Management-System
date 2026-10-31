import express from "express";
import helmet from "helmet";
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
import {
  loginHandler,
  createLoginRateLimiter,
  getProfile,
  sanitizeUser,
  registerHandler,
  createRegistrationRateLimiter,
} from "./controllers/authController.js";
import { deleteUser, getRevenue } from "./controllers/adminController.js";
import { createSummaryCache, loadDashboard } from "./dashboard.js";
import { issuePass } from "./pass.js";
import {
  createRazorpayOrder,
  razorpayWebhook,
  verifyRazorpayPayment,
} from "./payments.js";
import { createBooking } from "./bookings.js";
import {
  cancelClass,
  getNotifications,
} from "./controllers/classController.js";
import {
  createTicket,
  getTickets,
  updateEquipmentStatus,
  getEquipment,
} from "./controllers/equipmentController.js";

const publicUser = sanitizeUser;
const objectId = (value) => mongoose.isObjectIdOrHexString(value);

export function createApp(config) {
  const app = express();
  app.locals.paymentConfig = config;
  const cached = createSummaryCache();
  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", 1);
  const cspDirectives = helmet.contentSecurityPolicy.getDefaultDirectives();
  cspDirectives["script-src"].push("https://checkout.razorpay.com");
  cspDirectives["frame-src"] = [
    "'self'",
    "https://api.razorpay.com",
    "https://checkout.razorpay.com",
  ];
  cspDirectives["connect-src"] = ["'self'", "https://api.razorpay.com"];
  cspDirectives["img-src"].push("https://*.razorpay.com");
  app.use(helmet({ contentSecurityPolicy: { directives: cspDirectives } }));
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
  // Razorpay signs the exact raw JSON bytes; this must precede express.json().
  app.post(
    "/api/payments/webhook",
    express.raw({ type: "application/json", limit: "64kb" }),
    razorpayWebhook(config),
  );
  app.use(express.json({ limit: "16kb", strict: true }));
  app.get("/api/health", (req, res) => {
    const ready = mongoose.connection.readyState === 1;
    res.status(ready ? 200 : 503).json({
      status: ready ? "ok" : "unavailable",
      database: ready ? "connected" : "disconnected",
    });
  });

  // REQ-SEC-01 / SV-08: Throttled login endpoint issuing signed HS256 JWT sessions
  app.post("/api/auth/login", createLoginRateLimiter(), loginHandler(config));
  app.post(
    "/api/auth/register",
    createRegistrationRateLimiter(),
    registerHandler,
  );

  // All downstream /api routes require valid JWT session token
  app.use("/api", authenticate(config));
  app.get("/api/me", getProfile);
  app.post(
    "/api/payments/orders",
    allowRoles("Member"),
    createRazorpayOrder,
  );
  app.post(
    "/api/payments/verify",
    allowRoles("Member"),
    verifyRazorpayPayment,
  );
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

  // Admin-only endpoints mandated by REQ-SEC-02 and NFR-5
  app.get("/api/members", allowRoles("Admin"), async (req, res) => {
    const users = await User.find({ role: "Member", disabled: false })
      .sort({ _id: 1 })
      .limit(50)
      .select("firstName lastName tier membershipExpiresAt")
      .lean()
      .maxTimeMS(1000);
    res.json({ items: users });
  });
  app.post("/api/users/delete", allowRoles("Admin"), deleteUser);
  app.delete("/api/users/delete/:id", allowRoles("Admin"), deleteUser);
  app.get("/api/revenue/view", allowRoles("Admin"), getRevenue);

  // Bounded shell reads and the issue #6 member booking mutation.
  app.get("/api/classes", async (req, res) => {
    const filter = { status: "Open", startsAt: { $gte: new Date() } };
    if (req.user.role === "Trainer") filter.trainerId = req.user._id;
    res.json({
      items: await GymClass.find(filter)
        .sort({ startsAt: 1 })
        .limit(50)
        .select("name startsAt durationMinutes capacity availableSlots trainerId status")
        .lean()
        .maxTimeMS(1000),
    });
  });
  // REQ-4 / UT-04 / ST-02: Class cancellation and member notification dispatch
  app.post(
    "/api/classes/:id/cancel",
    allowRoles("Admin", "Trainer"),
    cancelClass,
  );
  app.post(
    "/api/classes/cancel",
    allowRoles("Admin", "Trainer"),
    cancelClass,
  );
  app.delete(
    "/api/classes/:id",
    allowRoles("Admin", "Trainer"),
    cancelClass,
  );
  app.get("/api/notifications", getNotifications);
  app.post("/api/bookings", allowRoles("Member"), createBooking);
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
  app.get("/api/equipment", getEquipment);
  app.post(
    ["/api/equipment/ticket", "/api/equipment/tickets"],
    allowRoles("Admin", "Trainer"),
    createTicket,
  );
  app.get(
    ["/api/equipment/tickets", "/api/equipment/ticket"],
    allowRoles("Admin", "Trainer"),
    getTickets,
  );
  app.patch(
    "/api/equipment/:inventoryId/status",
    allowRoles("Admin", "Trainer"),
    updateEquipmentStatus,
  );
  app.put(
    "/api/equipment/:inventoryId/status",
    allowRoles("Admin", "Trainer"),
    updateEquipmentStatus,
  );
  app.post(
    "/api/equipment/:inventoryId/status",
    allowRoles("Admin", "Trainer"),
    updateEquipmentStatus,
  );
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
