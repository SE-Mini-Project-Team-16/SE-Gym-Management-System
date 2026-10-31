import express from "express";
import { allowRoles } from "./middleware.js";
import {
  createTicket,
  getTickets,
  updateEquipmentStatus,
  getEquipment,
} from "./controllers/equipmentController.js";

const router = express.Router();

router.get("/", getEquipment);
router.post(
  "/ticket",
  allowRoles("Admin", "Trainer"),
  createTicket,
);
router.post(
  "/tickets",
  allowRoles("Admin", "Trainer"),
  createTicket,
);
router.get(
  "/tickets",
  allowRoles("Admin", "Trainer"),
  getTickets,
);
router.patch(
  "/:inventoryId/status",
  allowRoles("Admin", "Trainer"),
  updateEquipmentStatus,
);
router.put(
  "/:inventoryId/status",
  allowRoles("Admin", "Trainer"),
  updateEquipmentStatus,
);
router.post(
  "/:inventoryId/status",
  allowRoles("Admin", "Trainer"),
  updateEquipmentStatus,
);

export {
  router as equipmentRouter,
  createTicket,
  getTickets,
  updateEquipmentStatus,
  getEquipment,
};
export default router;
