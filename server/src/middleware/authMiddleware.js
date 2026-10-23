import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { User } from "../models.js";
import { apiError } from "./errorMiddleware.js";

/**
 * REQ-SEC-01 / SV-01: JWT Authentication Middleware
 * Enforces stateless HS256 JWT session verification on all protected routes.
 * Decodes subject, revalidates account state and permissions against MongoDB on every request.
 */
export function authenticate(config) {
  return async (req, res, next) => {
    try {
      const authorization = req.headers.authorization || "";
      if (!authorization.startsWith("Bearer ")) {
        throw apiError(401, "Please sign in to continue.");
      }

      const rawToken = authorization.slice(7).trim();
      if (!rawToken) {
        throw apiError(401, "Please sign in to continue.");
      }

      let payload;
      try {
        payload = jwt.verify(rawToken, config.jwtSecret, {
          algorithms: ["HS256"], // Strictly enforce HS256; reject "none", RS256, etc.
          issuer: "gms",
          audience: "gms-api",
        });
      } catch (err) {
        // Expired, tampered, wrong signature, or malformed
        throw apiError(401, "Your session has expired. Please sign in again.");
      }

      // Entry pass tokens cannot act as API sessions
      if (payload.kind === "entry-pass") {
        throw apiError(401, "Entry pass cannot be used as an API session.");
      }

      if (!mongoose.isObjectIdOrHexString(payload.sub)) {
        throw apiError(401, "Invalid session.");
      }

      // Always load user from DB to verify current role, existence, and active state
      const user = await User.findById(payload.sub).lean().maxTimeMS(1000);
      if (!user || user.disabled) {
        throw apiError(401, "This account is unavailable.");
      }

      req.user = user;
      next();
    } catch (error) {
      next(error);
    }
  };
}
