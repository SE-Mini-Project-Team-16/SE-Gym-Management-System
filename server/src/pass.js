import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { apiError } from "./middleware.js";

export const PASS_LIFETIME_SECONDS = 15 * 60;

export function requireActiveMembership(user, now = Date.now()) {
  const expiry = new Date(user.membershipExpiresAt).getTime();
  if (
    user.role !== "Member" ||
    user.disabled ||
    !Number.isFinite(expiry) ||
    Math.floor(expiry / 1000) <= Math.floor(now / 1000)
  ) {
    throw apiError(403, "An active membership is required for an entry pass.");
  }
  return expiry;
}

export function issuePass(user, config, now = Date.now()) {
  const expiry = requireActiveMembership(user, now);
  const issuedAt = Math.floor(now / 1000);
  const expiresAt = Math.min(
    Math.floor(expiry / 1000),
    issuedAt + PASS_LIFETIME_SECONDS,
  );
  const token = jwt.sign(
    {
      sub: String(user._id),
      kind: "entry-pass",
      iat: issuedAt,
      exp: expiresAt,
    },
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

export function verifyPassToken(token, config, now = Date.now()) {
  try {
    const seconds = Math.floor(now / 1000);
    const payload = jwt.verify(token, config.passSecret, {
      algorithms: ["HS256"],
      issuer: "gms",
      audience: "gms-entry",
      clockTimestamp: seconds,
    });
    if (
      payload.kind !== "entry-pass" ||
      !mongoose.isObjectIdOrHexString(payload.sub) ||
      !Number.isInteger(payload.iat) ||
      !Number.isInteger(payload.exp) ||
      payload.iat > seconds ||
      payload.exp <= payload.iat ||
      payload.exp - payload.iat > PASS_LIFETIME_SECONDS
    )
      throw new Error("Invalid pass claims");
    return payload;
  } catch {
    throw apiError(403, "This entry pass is invalid or expired.");
  }
}
