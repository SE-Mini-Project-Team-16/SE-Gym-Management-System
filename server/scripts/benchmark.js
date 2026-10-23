// Reproducible local, real-MongoDB smoke benchmark; staging load acceptance is tests/performance/dashboard.js.
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { performance } from "node:perf_hooks";
import { createApp } from "../src/app.js";
import { seed } from "./seed-data.js";

const db = await MongoMemoryServer.create();
let server;
try {
  await mongoose.connect(db.getUri());
  const { users } = await seed(randomBytes(20).toString("hex"), {
    memberCount: 1000,
    bookingCount: 200,
  });
  const config = {
    jwtSecret: randomBytes(32).toString("hex"),
    passSecret: randomBytes(32).toString("hex"),
  };
  server = createApp(config).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/dashboard`;
  const samples = [];
  const cold = [];
  let failed = 0;
  // Each member has a separate cache key; first wave measures cold summaries.
  const actors = [
    ...users.filter((user) => user.role !== "Member"),
    ...users.filter((user) => user.role === "Member").slice(0, 48),
  ];
  const tokens = actors.map((user) =>
    jwt.sign({}, config.jwtSecret, {
      algorithm: "HS256",
      subject: String(user._id),
      issuer: "gms",
      audience: "gms-api",
      expiresIn: "1h",
    }),
  );
  for (let wave = 0; wave < 10; wave++) {
    await Promise.all(
      tokens.map(async (token) => {
        const begin = performance.now();
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        });
        await response.json();
        if (!response.ok) failed++;
        const elapsed = performance.now() - begin;
        samples.push(elapsed);
        if (wave === 0) cold.push(elapsed);
      }),
    );
  }
  samples.sort((a, b) => a - b);
  cold.sort((a, b) => a - b);
  const p95 = samples[Math.ceil(samples.length * 0.95) - 1];
  console.log(
    JSON.stringify(
      {
        members: 1000,
        bookings: 200,
        concurrency: 50,
        roles: ["Admin", "Trainer", "Member"],
        coldP95Ms: Math.round(cold[Math.ceil(cold.length * 0.95) - 1]),
        requests: samples.length,
        p50Ms: Math.round(samples[Math.floor(samples.length * 0.5)]),
        p95Ms: Math.round(p95),
        errors: failed,
      },
      null,
      2,
    ),
  );
  if (p95 >= 1500 || failed / samples.length >= 0.01) process.exitCode = 1;
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  await db.stop();
}
