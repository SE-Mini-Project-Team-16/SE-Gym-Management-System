// Run for 72 hours against staging. Login refreshes the in-memory session on expiry.
const origin = process.env.BASE_URL;
if (!/^https:\/\//.test(origin || ""))
  throw new Error("BASE_URL must be the staging HTTPS URL.");
if (!process.env.MONITOR_EMAIL || !process.env.MONITOR_PASSWORD)
  throw new Error(
    "Configure a dedicated member account in MONITOR_EMAIL and MONITOR_PASSWORD.",
  );
const duration = Number(process.env.MONITOR_HOURS || 72) * 3600_000;
if (!Number.isFinite(duration) || duration <= 0)
  throw new Error("MONITOR_HOURS must be a positive number.");
let session;
let total = 0,
  successful = 0;
async function login() {
  const response = await fetch(`${origin}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: process.env.MONITOR_EMAIL,
      password: process.env.MONITOR_PASSWORD,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw new Error(`Monitor login failed (${response.status}).`);
  session = (await response.json()).token;
}
const start = Date.now();
while (Date.now() - start < duration) {
  total++;
  try {
    if (!session) await login();
    let response = await fetch(`${origin}/api/passes/me`, {
      headers: { Authorization: `Bearer ${session}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 401) {
      await login();
      response = await fetch(`${origin}/api/passes/me`, {
        headers: { Authorization: `Bearer ${session}` },
        signal: AbortSignal.timeout(10_000),
      });
    }
    const pass = await response.json();
    if (
      response.ok &&
      typeof pass.token === "string" &&
      new Date(pass.expiresAt) > new Date()
    )
      successful++;
    console.log(
      JSON.stringify({
        time: new Date().toISOString(),
        status: response.status,
        checks: total,
        availability: successful / total,
      }),
    );
  } catch {
    console.log(
      JSON.stringify({
        time: new Date().toISOString(),
        status: "unreachable",
        checks: total,
        availability: successful / total,
      }),
    );
  }
  await new Promise((resolve) =>
    setTimeout(
      resolve,
      Math.min(60_000, Math.max(0, start + duration - Date.now())),
    ),
  );
}
if (successful / total < 0.995) process.exitCode = 1;
