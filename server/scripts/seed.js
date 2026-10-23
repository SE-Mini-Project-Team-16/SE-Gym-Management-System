import mongoose from "mongoose";
import { seed } from "./seed-data.js";

if (process.env.NODE_ENV === "production")
  throw new Error("Demo seeding is forbidden in production.");
if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required.");
try {
  await mongoose.connect(process.env.MONGODB_URI);
  await seed(process.env.DEMO_PASSWORD);
  console.log(
    "Demo data ready. Log in using member@gym.test, trainer@gym.test or admin@gym.test and your DEMO_PASSWORD.",
  );
} finally {
  await mongoose.disconnect();
}
