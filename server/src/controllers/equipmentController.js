import mongoose from "mongoose";
import { Equipment, Ticket } from "../models.js";
import { apiError } from "../middleware.js";

/**
 * Submits an equipment maintenance ticket for a specific inventory ID.
 * Fulfills REQ-5, UT-05, ST-03, TC-EQ-01, TC-EQ-02.
 */
export async function createTicket(req, res, next) {
  try {
    if (!req.user || !["Admin", "Trainer"].includes(req.user.role)) {
      throw apiError(403, "Forbidden. Only staff can submit maintenance tickets.");
    }

    const equipmentId = (
      req.body?.equipmentId ??
      req.body?.inventoryId ??
      ""
    )
      .toString()
      .trim();

    const issueDescription = (
      req.body?.issueDescription ??
      req.body?.description ??
      ""
    )
      .toString()
      .trim();

    if (!equipmentId) {
      throw apiError(400, "Equipment inventory ID is required.");
    }

    if (!issueDescription) {
      throw apiError(400, "Issue description is required and cannot be empty.");
    }

    if (issueDescription.length > 1000) {
      throw apiError(
        400,
        "Issue description exceeds maximum limit of 1000 characters.",
      );
    }

    const equipment = await Equipment.findOne({ inventoryId: equipmentId });
    if (!equipment) {
      throw apiError(
        400,
        `Equipment with inventory ID "${equipmentId}" not found.`,
      );
    }

    const count = await Ticket.countDocuments();
    let ticketId = `TCK-${String(count + 1).padStart(3, "0")}`;
    while (await Ticket.exists({ ticketId })) {
      ticketId = `TCK-${Math.floor(100 + Math.random() * 9000)}`;
    }

    const ticket = await Ticket.create({
      ticketId,
      equipmentId: equipment.inventoryId,
      equipment: equipment._id,
      submittedBy: req.user._id,
      issueDescription,
      status: "Open",
    });

    return res.status(201).json({
      status: "success",
      ticketId: ticket.ticketId,
      message: "Maintenance ticket logged successfully.",
      ticket,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Retrieves logged maintenance tickets. Staff only.
 */
export async function getTickets(req, res, next) {
  try {
    if (!req.user || !["Admin", "Trainer"].includes(req.user.role)) {
      throw apiError(403, "Forbidden. Only staff can view maintenance tickets.");
    }

    const items = await Ticket.find()
      .sort({ createdAt: -1 })
      .limit(50)
      .populate("submittedBy", "firstName lastName email role")
      .populate("equipment", "inventoryId name category status")
      .lean()
      .maxTimeMS(1000);

    return res.json({ items });
  } catch (error) {
    next(error);
  }
}

/**
 * Updates the status of an equipment item.
 * Supports state transitions: Available <-> Under Maintenance.
 * Fulfills REQ-6, UT-06, ST-03, TC-EQ-03, TC-EQ-04.
 */
export async function updateEquipmentStatus(req, res, next) {
  try {
    if (!req.user || !["Admin", "Trainer"].includes(req.user.role)) {
      throw apiError(
        403,
        "Forbidden. Only staff can update equipment status.",
      );
    }

    const targetId = req.params.inventoryId || req.params.id;
    const { status } = req.body || {};

    if (!status || !["Available", "Under Maintenance"].includes(status)) {
      throw apiError(
        400,
        'Invalid status. Must be "Available" or "Under Maintenance".',
      );
    }

    const query = mongoose.isObjectIdOrHexString(targetId)
      ? { $or: [{ inventoryId: targetId }, { _id: targetId }] }
      : { inventoryId: targetId };

    const equipment = await Equipment.findOne(query);
    if (!equipment) {
      throw apiError(404, `Equipment "${targetId}" not found.`);
    }

    equipment.status = status;
    await equipment.save();

    return res.json({
      status: "success",
      message: `Equipment status updated to "${status}".`,
      equipment,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Retrieves equipment catalogue.
 * Automatically excludes items marked "Under Maintenance" for Member users.
 * Supports explicit ?status= query filtering for staff.
 * Fulfills REQ-6, UT-06, ST-03, TC-EQ-03, TC-EQ-04.
 */
export async function getEquipment(req, res, next) {
  try {
    let filter = {};
    if (req.user?.role === "Member") {
      filter = { status: "Available" };
    } else if (req.query?.status) {
      filter = { status: req.query.status };
    }

    const items = await Equipment.find(filter)
      .sort({ inventoryId: 1 })
      .limit(50)
      .select("inventoryId name category status createdAt updatedAt")
      .lean()
      .maxTimeMS(1000);

    return res.json({ items });
  } catch (error) {
    next(error);
  }
}
