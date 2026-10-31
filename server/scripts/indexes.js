import mongoose from "mongoose";
import {
  User,
  GymClass,
  Booking,
  Equipment,
  PaymentOrder,
  PaymentReceipt,
  Notification,
  Ticket,
} from "../src/models.js";

if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required.");
try {
  await mongoose.connect(process.env.MONGODB_URI);
  for (const Model of [
    User,
    GymClass,
    Booking,
    Equipment,
    PaymentOrder,
    PaymentReceipt,
    Notification,
    Ticket,
  ])
    await Model.createIndexes();
  console.log("Dashboard and list indexes created.");
} finally {
  await mongoose.disconnect();
}
