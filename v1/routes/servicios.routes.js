import express from "express";
import { obtenerServicios, obtenerServicioPorId, guardarServicio, actualizarServicio, eliminarServicio } from "../controllers/servicios.controller.js";
import { validateBodyMiddleware } from "../middlewares/validateBody.middleware.js";
import { agregarServicioSchema, modificarServicioSchema } from "../validators/servicios.validators.js";
import { authenticateMiddleware } from "../middlewares/authenticate.middleware.js";
import { authenticateOptionalMiddleware } from "../middlewares/authenticateOptional.middleware.js";

const router = express.Router({ mergeParams: true });

router.get("/", authenticateOptionalMiddleware, obtenerServicios);
router.get("/:id", authenticateMiddleware, obtenerServicioPorId);
router.post("/", authenticateMiddleware, validateBodyMiddleware(agregarServicioSchema), guardarServicio);
router.patch("/:id", authenticateMiddleware, validateBodyMiddleware(modificarServicioSchema), actualizarServicio);
router.delete("/:id", authenticateMiddleware, eliminarServicio);

export default router;
