import jwt from "jsonwebtoken";
import { apiError } from "./middleware.js";

export function issuePass(user, config, now = Date.now()) {
  const expiry = new Date(user.membershipExpiresAt).getTime();
  if (
    user.role !== "Member" ||
    user.disabled ||
    !Number.isFinite(expiry) ||
    expiry <= now
  ) {
    throw apiError(403, "An active membership is required for an entry pass.");
  }
  const expiresAt = Math.min(
    Math.floor(expiry / 1000),
    Math.floor(now / 1000) + 15 * 60,
  );
  const token = jwt.sign(
    { sub: String(user._id), kind: "entry-pass", exp: expiresAt },
    config.passSecret,
    {
      algorithm: "HS256",
      issuer: "gms",
      audience: "gms-entry",
    },
  );
  return {
    token,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
    member: {
      name: `${user.firstName} ${user.lastName}`,
      tier: user.tier,
      membershipExpiresAt: user.membershipExpiresAt,
    },
  };
}
