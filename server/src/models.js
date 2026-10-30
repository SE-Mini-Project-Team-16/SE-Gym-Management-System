import mongoose from "mongoose";

const { Schema, model } = mongoose;
const userSchema = new Schema(
  {
    firstName: { type: String, required: true, maxlength: 50 },
    lastName: { type: String, required: true, maxlength: 50 },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      maxlength: 100,
      unique: true,
    },
    passwordHash: { type: String, required: true, select: false },
    // Optional on legacy accounts; required and validated by registration.
    phoneNumber: {
      type: String,
      maxlength: 15,
      match: /^[0-9]{1,15}$/,
      select: false,
    },
    role: {
      type: String,
      enum: ["Admin", "Trainer", "Member"],
      default: "Member",
    },
    tier: { type: String, enum: ["Basic", "Premium", "VIP"], default: "Basic" },
    membershipExpiresAt: { type: Date, default: null },
    disabled: { type: Boolean, default: false },
  },
  { timestamps: true },
);
userSchema.index({ role: 1, disabled: 1, membershipExpiresAt: 1 });

const classSchema = new Schema(
  {
    name: { type: String, required: true },
    trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    startsAt: { type: Date, required: true },
    durationMinutes: { type: Number, default: 60, min: 1 },
    capacity: { type: Number, required: true, min: 1 },
    availableSlots: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ["Open", "Cancelled"], default: "Open" },
  },
  { timestamps: true },
);
classSchema.index({ status: 1, startsAt: 1 });
classSchema.index({ trainerId: 1, status: 1, startsAt: 1 });

const bookingSchema = new Schema(
  {
    memberId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    classId: { type: Schema.Types.ObjectId, ref: "GymClass", required: true },
    status: { type: String, enum: ["Active", "Cancelled"], default: "Active" },
  },
  { timestamps: true },
);
bookingSchema.index({ memberId: 1, status: 1, classId: 1 });
// Cancelled history remains reusable; only active member/class pairs are unique.
bookingSchema.index(
  { memberId: 1, classId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "Active" },
    name: "unique_active_member_class",
  },
);
bookingSchema.index({ classId: 1, status: 1 });
bookingSchema.index({ memberId: 1, createdAt: -1 });
bookingSchema.index({ status: 1, createdAt: -1 });

const equipmentSchema = new Schema(
  {
    inventoryId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    category: { type: String, required: true },
    status: {
      type: String,
      enum: ["Available", "Under Maintenance"],
      default: "Available",
    },
  },
  { timestamps: true },
);
equipmentSchema.index({ status: 1, inventoryId: 1 });

const paymentOrderSchema = new Schema(
  {
    orderId: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    tier: { type: String, enum: ["Basic", "Premium", "VIP"], required: true },
    amount: { type: Number, required: true },
    currency: { type: String, enum: ["INR"], required: true },
    status: { type: String, enum: ["created", "paid"], default: "created" },
    paymentId: { type: String, default: null },
  },
  { timestamps: true },
);

// Stores only gateway references and the applied membership update; never card data.
const paymentReceiptSchema = new Schema(
  {
    orderId: { type: String, required: true, unique: true },
    paymentId: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    tier: { type: String, enum: ["Basic", "Premium", "VIP"], required: true },
    amount: { type: Number, required: true },
    currency: { type: String, required: true },
    membershipExpiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

export const User = model("User", userSchema);
export const GymClass = model("GymClass", classSchema);
export const Booking = model("Booking", bookingSchema);
export const Equipment = model("Equipment", equipmentSchema);
export const PaymentOrder = model("PaymentOrder", paymentOrderSchema);
export const PaymentReceipt = model("PaymentReceipt", paymentReceiptSchema);
