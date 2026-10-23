export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === "production";
  for (const name of ["JWT_SECRET", "PASS_SECRET"]) {
    if (!env[name] || env[name].length < 32)
      throw new Error(`${name} must contain at least 32 characters.`);
  }
  if (env.JWT_SECRET === env.PASS_SECRET)
    throw new Error("Use separate authentication and entry pass secrets.");
  if (!env.MONGODB_URI && env.DEMO_DATABASE !== "true")
    throw new Error("MONGODB_URI is required.");
  if (production && env.DEMO_DATABASE === "true")
    throw new Error("Demo database is forbidden in production.");
  if (production && !/^https:\/\/[^/]+$/.test(env.PUBLIC_ORIGIN || ""))
    throw new Error("PUBLIC_ORIGIN must be an HTTPS origin in production.");
  return {
    production,
    port: Number(env.PORT || 4000),
    mongoUri: env.MONGODB_URI,
    jwtSecret: env.JWT_SECRET,
    passSecret: env.PASS_SECRET,
    publicOrigin: env.PUBLIC_ORIGIN,
    trustProxy: env.TRUST_PROXY === "1",
  };
}
