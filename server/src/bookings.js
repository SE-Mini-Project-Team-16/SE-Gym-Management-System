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
