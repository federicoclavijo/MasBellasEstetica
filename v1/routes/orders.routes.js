import express from "express";
import { obtenerOrdenPorId } from "../controllers/order.controller.js";
import { authenticateMiddleware } from "../middlewares/authenticate.middleware.js";

const router = express.Router({ mergeParams: true });

router.get("/:id", authenticateMiddleware, obtenerOrdenPorId);

export default router;
