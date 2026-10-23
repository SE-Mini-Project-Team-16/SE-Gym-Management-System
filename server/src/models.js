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

export const User = model("User", userSchema);
export const GymClass = model("GymClass", classSchema);
export const Booking = model("Booking", bookingSchema);
export const Equipment = model("Equipment", equipmentSchema);
