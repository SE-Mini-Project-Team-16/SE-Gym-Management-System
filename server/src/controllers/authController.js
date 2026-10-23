import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { User } from "../models.js";
import { apiError } from "../middleware/errorMiddleware.js";

/**
 * Sanitizes user record for API responses, strictly omitting passwordHash
 * per NFR-4, TC-SEC-03, and SV-04.
 */
export const sanitizeUser = (user) => ({
  id: String(user._id || user.id),
  firstName: user.firstName,
  lastName: user.lastName,
  role: user.role,
  tier: user.tier,
  membershipExpiresAt: user.membershipExpiresAt,
});

/**
 * SV-08: Creates a rate limiter instance for the login endpoint
 * to prevent brute-force and credential abuse (returning 429).
 */
export function createLoginRateLimiter() {
  return rateLimit({
    windowMs: 15 * 60_000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (req, res, next) =>
      next(apiError(429, "Too many sign-in attempts. Please try again later.")),
  });
}

/**
 * REQ-SEC-01 / SV-01 / SV-03 / SV-08: User login handler.
 * Validates credentials, issues 1-hour HS256 JWT, strips mass assignment fields,
 * and uses constant-time bcrypt checks to mitigate user enumeration.
 */
export function loginHandler(config) {
  return async (req, res, next) => {
    try {
      const body = req.body || {};

      // Guard against SV-03 Mass Assignment: strip privileged fields
      delete body.role;
      delete body.tier;
      delete body.expiryDate;
      delete body.membershipExpiresAt;
      delete body.disabled;
      delete body._id;
      delete body.id;

      const { email, password } = body;
      if (
        typeof email !== "string" ||
        typeof password !== "string" ||
        email.length > 100 ||
        password.length > 128
      ) {
        throw apiError(400, "Enter a valid email and password.");
      }

      const normalizedEmail = email.trim().toLowerCase();
      const user = await User.findOne({ email: normalizedEmail })
        .select("+passwordHash")
        .maxTimeMS(1000);

      // Perform dummy hash comparison if user doesn't exist to prevent timing attacks & enumeration (SV-08)
      const dummyHash =
        "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";
      const hashToCompare = user?.passwordHash || dummyHash;
      const valid = await bcrypt.compare(password, hashToCompare);

      if (!user || !valid || user.disabled) {
        throw apiError(401, "Email or password is incorrect.");
      }

      const token = jwt.sign({}, config.jwtSecret, {
        algorithm: "HS256",
        subject: String(user._id),
        issuer: "gms",
        audience: "gms-api",
        expiresIn: "1h",
      });

      res.json({ token, user: sanitizeUser(user) });
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Returns current authenticated profile details.
 */
export function getProfile(req, res) {
  res.json({ user: sanitizeUser(req.user) });
}
