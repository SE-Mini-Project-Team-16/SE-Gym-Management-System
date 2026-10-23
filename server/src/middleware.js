import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { User } from "./models.js";

export const apiError = (status, message) =>
  Object.assign(new Error(message), { status });

export function authenticate(config) {
  return async (req, res, next) => {
    try {
      const authorization = req.headers.authorization || "";
      if (!authorization.startsWith("Bearer "))
        throw apiError(401, "Please sign in to continue.");
      let payload;
      try {
        payload = jwt.verify(authorization.slice(7), config.jwtSecret, {
          algorithms: ["HS256"],
          issuer: "gms",
          audience: "gms-api",
        });
      } catch {
        throw apiError(401, "Your session has expired. Please sign in again.");
      }
      if (!mongoose.isObjectIdOrHexString(payload.sub))
        throw apiError(401, "Invalid session.");
      const user = await User.findById(payload.sub).lean().maxTimeMS(1000);
      if (!user || user.disabled)
        throw apiError(401, "This account is unavailable.");
      req.user = user;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function allowRoles(...roles) {
  return (req, res, next) =>
    roles.includes(req.user.role)
      ? next()
      : next(apiError(403, "You do not have access to this page."));
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  if (error.type === "entity.parse.failed")
    error = apiError(400, "Request body must contain valid JSON.");
  const databaseError =
    error.name?.startsWith("Mongo") || error.name === "MongooseError";
  const status = error.status || (databaseError ? 503 : 500);
  res.status(status).json({
    error: true,
    message:
      status >= 500
        ? "Service temporarily unavailable. Please try again."
        : error.message,
    code: status,
  });
}
