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

export function createRegistrationRateLimiter() {
  return rateLimit({
    windowMs: 15 * 60_000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (req, res, next) =>
      next(
        apiError(
          429,
          "Too many registration attempts. Please try again later.",
        ),
      ),
  });
}

// REQ-1 / NFR-4: allowlist registration fields; never trust privilege fields.
export async function registerHandler(req, res, next) {
  try {
    const { firstName, lastName, email, phoneNumber, password } =
      req.body || {};
    const validName = (value) =>
      typeof value === "string" &&
      value.trim().length > 0 &&
      value.trim().length <= 50;
    if (!validName(firstName) || !validName(lastName))
      throw apiError(
        400,
        "First and last names must contain 1 to 50 characters.",
      );
    if (
      typeof email !== "string" ||
      email.trim().length > 100 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    )
      throw apiError(
        400,
        "Enter a valid email address of at most 100 characters.",
      );
    if (typeof phoneNumber !== "string" || !/^[0-9]{1,15}$/.test(phoneNumber))
      throw apiError(400, "Enter a phone number containing 1 to 15 digits.");
    if (
      typeof password !== "string" ||
      password.length < 12 ||
      password.length > 64 ||
      Buffer.byteLength(password, "utf8") > 72
    )
      throw apiError(
        400,
        "Use a password of 12 to 64 characters and at most 72 UTF-8 bytes.",
      );

    const user = await User.create({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim().toLowerCase(),
      phoneNumber,
      passwordHash: await bcrypt.hash(password, 12),
      role: "Member",
      tier: "Basic",
      membershipExpiresAt: null,
      disabled: false,
    });
    res.status(201).json({ user: sanitizeUser(user) });
  } catch (error) {
    // The unique email index also protects simultaneous registration attempts.
    next(
      error.code === 11000
        ? apiError(409, "This email address is already registered.")
        : error,
    );
  }
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
