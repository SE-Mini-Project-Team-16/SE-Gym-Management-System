import mongoose from "mongoose";
import { GymClass, Booking, Notification } from "../models.js";
import { apiError } from "../middleware/errorMiddleware.js";

/**
 * REQ-4 / STP §11: Service interface for member notifications that can be stubbed or observed in tests.
 */
export const notificationService = {
  dispatched: [],
  async dispatch({ recipientId, member, gymClass, message }) {
    const record = {
      recipientId: String(recipientId),
      memberEmail: member?.email,
      memberName: member ? `${member.firstName} ${member.lastName}` : undefined,
      classId: String(gymClass._id),
      className: gymClass.name,
      startsAt: gymClass.startsAt,
      message,
      timestamp: new Date().toISOString(),
    };
    this.dispatched.push(record);
    await Notification.create({
      recipientId,
      classId: gymClass._id,
      type: "ClassCancelled",
      message,
    });
    return record;
  },
  getDispatched() {
    return [...this.dispatched];
  },
  clear() {
    this.dispatched = [];
  },
};

/**
 * REQ-4 / UT-04 / ST-02: Cancel a class session and notify all enrolled members.
 * Enforces RBAC: Admin can cancel any class; Trainer can only cancel their own classes.
 * Members are rejected with 403.
 */
export async function cancelClass(req, res) {
  const classId = req.params?.id || req.body?.classId || req.body?.id;
  if (typeof classId !== "string" || !mongoose.isObjectIdOrHexString(classId)) {
    throw apiError(400, "Provide a valid class identifier.");
  }

  const gymClass = await GymClass.findById(classId);
  if (!gymClass) {
    throw apiError(404, "Class not found.");
  }

  // RBAC: Trainer can only cancel their own class (TC-CL-02).
  // Cross-trainer cancellation is rejected with 403.
  if (req.user.role === "Trainer" && !gymClass.trainerId.equals(req.user._id)) {
    throw apiError(403, "Trainers can only cancel their own classes.");
  }

  // Reject already cancelled classes
  if (gymClass.status === "Cancelled") {
    throw apiError(400, "This class is already cancelled.");
  }

  // Cannot cancel classes that have already started or are in the past
  if (new Date(gymClass.startsAt) <= new Date()) {
    throw apiError(400, "Cannot cancel a class that has already started or ended.");
  }

  // Mark class as Cancelled
  gymClass.status = "Cancelled";
  await gymClass.save();

  // Find all active bookings to notify enrolled members (TC-CL-01, TC-CL-02)
  const activeBookings = await Booking.find({
    classId: gymClass._id,
    status: "Active",
  })
    .populate("memberId", "firstName lastName email")
    .lean();

  // Update active bookings for this cancelled class to Cancelled
  if (activeBookings.length > 0) {
    await Booking.updateMany(
      { classId: gymClass._id, status: "Active" },
      { $set: { status: "Cancelled" } },
    );
  }

  // Generate and dispatch notifications for every enrolled member
  const notifications = [];
  for (const booking of activeBookings) {
    const member = booking.memberId;
    const recipientId = member?._id || booking.memberId;
    const timeString = new Date(gymClass.startsAt).toUTCString();
    const message = `The class "${gymClass.name}" scheduled for ${timeString} has been cancelled.`;
    const dispatched = await notificationService.dispatch({
      recipientId,
      member: typeof member === "object" ? member : null,
      gymClass,
      message,
    });
    notifications.push(dispatched);
  }

  res.status(200).json({
    status: "success",
    message: "Class cancelled successfully.",
    class: {
      id: String(gymClass._id),
      name: gymClass.name,
      status: "Cancelled",
    },
    enrolledCount: activeBookings.length,
    notificationsSent: notifications.length,
  });
}

/**
 * Retrieves notifications for the authenticated user.
 */
export async function getNotifications(req, res) {
  const items = await Notification.find({ recipientId: req.user._id })
    .sort({ createdAt: -1 })
    .limit(50)
    .populate("classId", "name startsAt")
    .lean()
    .maxTimeMS(1000);
  res.status(200).json({ items });
}
