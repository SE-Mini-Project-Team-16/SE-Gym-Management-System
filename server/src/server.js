import mongoose from "mongoose";
import { loadConfig } from "./config.js";
import { createApp } from "./app.js";

const config = loadConfig();
mongoose.set("bufferCommands", false);
let demo;
if (process.env.DEMO_DATABASE === "true") {
  const { MongoMemoryServer } = await import("mongodb-memory-server");
  demo = await MongoMemoryServer.create();
  config.mongoUri = demo.getUri();
}
await mongoose.connect(config.mongoUri, {
  serverSelectionTimeoutMS: 1500,
  maxPoolSize: 20,
  autoIndex: !config.production,
});
if (demo) {
  const { seed } = await import("../scripts/seed-data.js");
  await seed(process.env.DEMO_PASSWORD);
  console.log(
    "Ephemeral demo database ready. Accounts: member@gym.test, trainer@gym.test, admin@gym.test.",
  );
}
const server = createApp(config).listen(config.port, "127.0.0.1", () =>
  console.log(`GMS API: http://127.0.0.1:${config.port}`),
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  const timeout = setTimeout(() => process.exit(1), 10_000).unref();
  server.close(async () => {
    await mongoose.disconnect();
    await demo?.stop();
    clearTimeout(timeout);
    process.exit(0);
  });
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
