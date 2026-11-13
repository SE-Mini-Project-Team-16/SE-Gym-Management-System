import mongoose from "mongoose";
import { Booking, GymClass } from "./models.js";
import { apiError } from "./middleware.js";

// REQ-3: the slot reservation and booking must commit together, including retries.
export async function createBooking(req, res) {
  const classId = req.body?.classId;
  if (typeof classId !== "string" || !mongoose.isObjectIdOrHexString(classId))
    throw apiError(400, "Provide a valid classId.");
  // Ownership always comes from the authenticated account, never the payload.
  const memberId = req.user._id;
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(
      async () => {
        if (
          await Booking.exists({ memberId, classId, status: "Active" }).session(
            session,
          )
        )
          throw apiError(
            409,
            "You already have an active booking for this class.",
          );

        const gymClass = await GymClass.findOneAndUpdate(
          {
            _id: classId,
            status: "Open",
            startsAt: { $gt: new Date() },
            availableSlots: { $gt: 0 },
          },
          { $inc: { availableSlots: -1 } },
          { session, returnDocument: "after" },
        );
        if (!gymClass) {
          if (!(await GymClass.exists({ _id: classId }).session(session)))
            throw apiError(404, "Class not found.");
          throw apiError(
            400,
            "This class is full, cancelled, or has already started.",
          );
        }
        const [booking] = await Booking.create(
          [{ memberId, classId, status: "Active" }],
          { session },
        );
        result = {
          status: "success",
          bookingId: booking._id,
          remainingSlots: gymClass.availableSlots,
        };
      },
      { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } },
    );
  } catch (error) {
    // The partial unique index also protects against concurrent duplicate inserts.
    if (error.code === 11000)
      throw apiError(409, "You already have an active booking for this class.");
    throw error;
  } finally {
    await session.endSession();
  }
  res.status(200).json(result);
}

// TC-SEC-08 / REQ-3: Member cancels active booking; frees slot atomically; prevents IDOR.
export async function cancelBooking(req, res) {
  const bookingId = req.params?.id || req.body?.bookingId || req.body?.id;
  if (typeof bookingId !== "string" || !mongoose.isObjectIdOrHexString(bookingId)) {
    throw apiError(400, "Provide a valid booking identifier.");
  }

  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(
      async () => {
        const booking = await Booking.findById(bookingId).session(session);
        if (!booking) {
          throw apiError(404, "Booking not found.");
        }

        // TC-SEC-08: Prevent IDOR - Member A cannot cancel Member B's booking
        if (
          req.user.role === "Member" &&
          !booking.memberId.equals(req.user._id)
        ) {
          throw apiError(403, "You can only cancel your own bookings.");
        }

        if (booking.status === "Cancelled") {
          throw apiError(400, "This booking is already cancelled.");
        }

        const gymClass = await GymClass.findById(booking.classId).session(session);
        if (gymClass && new Date(gymClass.startsAt) <= new Date()) {
          throw apiError(
            400,
            "Cannot cancel a booking for a class that has already started or ended.",
          );
        }

        booking.status = "Cancelled";
        await booking.save({ session });

        // Restore available slot atomically if class is open
        if (gymClass && gymClass.status === "Open") {
          await GymClass.updateOne(
            { _id: gymClass._id },
            { $inc: { availableSlots: 1 } },
            { session },
          );
        }

        result = {
          status: "success",
          message: "Booking cancelled successfully.",
          bookingId: String(booking._id),
        };
      },
      { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } },
    );
  } finally {
    await session.endSession();
  }
  res.status(200).json(result);
}
