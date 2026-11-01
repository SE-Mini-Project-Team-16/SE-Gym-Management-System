import { describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import { issuePass, verifyPassToken } from "../src/pass.js";

const config = {
  passSecret: "entry-pass-unit-test-secret-at-least-32-characters",
};
const now = Date.parse("2026-11-01T10:00:00.100Z");
const member = {
  _id: "0123456789abcdef01234567",
  firstName: "Jordan",
  lastName: "Lee",
  role: "Member",
  tier: "Premium",
  disabled: false,
  membershipExpiresAt: new Date(now + 86400_000),
};
const sign = (claims, options = {}) =>
  jwt.sign(claims, config.passSecret, {
    algorithm: "HS256",
    issuer: "gms",
    audience: "gms-entry",
    ...options,
  });

describe("issue #10 entry pass validity", () => {
  it("issues a verifiable member-owned pass for at most fifteen minutes", () => {
    const pass = issuePass(member, config, now);
    const payload = verifyPassToken(pass.token, config, now);
    expect(payload.sub).toBe(member._id);
    expect(payload.exp - payload.iat).toBe(900);
    expect(Date.parse(pass.expiresAt)).toBe(payload.exp * 1000);
    expect(payload).not.toHaveProperty("email");
    expect(() =>
      verifyPassToken(pass.token, config, payload.exp * 1000),
    ).toThrow(/expired/);
  });
  it("caps the pass at membership expiry", () => {
    const expiry = new Date(now + 35_000);
    const pass = issuePass(
      { ...member, membershipExpiresAt: expiry },
      config,
      now,
    );
    expect(Date.parse(pass.expiresAt)).toBeLessThanOrEqual(expiry.getTime());
    expect(verifyPassToken(pass.token, config, now).exp).toBe(
      Math.floor(expiry.getTime() / 1000),
    );
  });
  it("does not issue an already-expired JWT for a membership ending within the current second", () => {
    expect(() =>
      issuePass(
        { ...member, membershipExpiresAt: new Date(now + 100) },
        config,
        now,
      ),
    ).toThrow(/active membership/);
  });
  it.each([
    { membershipExpiresAt: null },
    { membershipExpiresAt: "invalid" },
    { membershipExpiresAt: new Date(now) },
    { disabled: true },
    { role: "Trainer" },
  ])("rejects ineligible membership %j", (changes) => {
    expect(() => issuePass({ ...member, ...changes }, config, now)).toThrow(
      /active membership/,
    );
  });
  it.each([
    "missing-expiry",
    "missing-issued-at",
    "excessive-lifetime",
    "future-issued-at",
    "invalid-subject",
    "wrong-kind",
  ])("rejects signed passes with %s", (variant) => {
    const claims = {
      sub: member._id,
      kind: "entry-pass",
      iat: Math.floor(now / 1000),
      exp: Math.floor(now / 1000) + 900,
    };
    if (variant === "missing-expiry") delete claims.exp;
    if (variant === "missing-issued-at") delete claims.iat;
    if (variant === "excessive-lifetime") claims.exp++;
    if (variant === "future-issued-at") {
      claims.iat += 30;
      claims.exp += 30;
    }
    if (variant === "invalid-subject") claims.sub = "invalid-member";
    if (variant === "wrong-kind") claims.kind = "session";
    const token = sign(
      claims,
      variant === "missing-issued-at" ? { noTimestamp: true } : {},
    );
    expect(() => verifyPassToken(token, config, now)).toThrow(
      /invalid or expired/,
    );
  });
});
