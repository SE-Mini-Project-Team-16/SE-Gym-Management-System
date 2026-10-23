import mongoose from "mongoose";
import { User } from "../models.js";
import { apiError } from "../middleware/errorMiddleware.js";

/**
 * REQ-SEC-02 / NFR-5 / TC-SEC-02 / SV-02: Admin-only user deletion endpoint.
 * Ensures only users with the Admin role can delete accounts.
 */
export async function deleteUser(req, res, next) {
  try {
    const targetId = req.params?.id || req.body?.userId || req.body?.id;
    if (!targetId || !mongoose.isObjectIdOrHexString(targetId)) {
      throw apiError(400, "Provide a valid user ID to delete.");
    }

    if (String(req.user._id) === String(targetId)) {
      throw apiError(400, "Admins cannot delete their own account.");
    }

    const deleted = await User.findByIdAndDelete(targetId).maxTimeMS(1000);
    if (!deleted) {
      throw apiError(404, "User account not found.");
    }

    res.json({
      status: "success",
      message: "User account deleted successfully.",
      deletedUserId: String(deleted._id),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * REQ-SEC-02 / NFR-5 / TC-SEC-02 / SV-02: Admin-only revenue viewing endpoint.
 * Ensures only users with the Admin role can access financial records and revenue reports.
 */
export async function getRevenue(req, res, next) {
  try {
    const tierPricing = { Basic: 30, Premium: 60, VIP: 100 };
    const tierCounts = await User.aggregate([
      { $match: { role: "Member", disabled: false } },
      { $group: { _id: "$tier", count: { $sum: 1 } } },
    ]).option({ maxTimeMS: 1000 });

    const breakdown = { Basic: 0, Premium: 0, VIP: 0 };
    let totalRevenue = 0;

    for (const item of tierCounts) {
      if (item._id in breakdown) {
        breakdown[item._id] = item.count;
        totalRevenue += item.count * (tierPricing[item._id] || 0);
      }
    }

    res.json({
      status: "success",
      revenue: {
        totalRevenue,
        currency: "USD",
        breakdown,
      },
    });
  } catch (error) {
    next(error);
  }
}
