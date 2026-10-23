import http from "k6/http";
import { check, sleep } from "k6";

// Supply a dedicated seeded staging database with >=1000 members / 200 bookings.
// SESSION_TOKENS is a JSON array of 50 different API session tokens. Never commit tokens.
const tokens = JSON.parse(__ENV.SESSION_TOKENS || "[]");
if (tokens.length < 50)
  throw new Error(
    "Provide 50 distinct signed-in staging sessions in SESSION_TOKENS.",
  );
if (!/^https:\/\//.test(__ENV.BASE_URL || ""))
  throw new Error("BASE_URL must be a staging HTTPS URL.");
export const options = {
  scenarios: {
    warmup: {
      executor: "constant-vus",
      vus: 50,
      duration: "2m",
      gracefulStop: "0s",
      tags: { phase: "warmup" },
    },
    steady: {
      executor: "constant-vus",
      vus: 50,
      duration: "10m",
      startTime: "2m",
      tags: { phase: "steady" },
    },
  },
  thresholds: {
    "http_req_duration{phase:steady}": ["p(95)<1500"],
    "http_req_failed{phase:steady}": ["rate<0.01"],
  },
};
export default function () {
  const response = http.get(`${__ENV.BASE_URL}/api/dashboard`, {
    headers: { Authorization: `Bearer ${tokens[(__VU - 1) % tokens.length]}` },
  });
  check(response, { "dashboard loaded": (res) => res.status === 200 });
  sleep(1);
}
