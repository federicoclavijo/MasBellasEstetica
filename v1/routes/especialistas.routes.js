import express from "express";
import { obtenerEspecialistas, obtenerEspecialistaPorId, agregarEspecialista, actualizarEspecialista, eliminarEspecialista, subirImagenPerfil } from "../controllers/especialistas.controller.js";
import { validateBodyMiddleware } from "../middlewares/validateBody.middleware.js";
import { agregarEspecialistaSchema, actualizarEspecialistaSchema } from "../validators/especialistas.validators.js";
import { upload } from "../middlewares/multer.middleware.js";
import { authenticateMiddleware } from "../middlewares/authenticate.middleware.js";
import { authenticateOptionalMiddleware } from "../middlewares/authenticateOptional.middleware.js";

const router = express.Router({ mergeParams: true });

router.get("/", authenticateOptionalMiddleware, obtenerEspecialistas);
router.get("/:id", authenticateMiddleware, obtenerEspecialistaPorId);
router.post("/", authenticateMiddleware, validateBodyMiddleware(agregarEspecialistaSchema), agregarEspecialista);
router.patch("/imagen/:id", authenticateMiddleware, upload.single("imagen"), subirImagenPerfil);
router.patch("/:id", authenticateMiddleware, validateBodyMiddleware(actualizarEspecialistaSchema), actualizarEspecialista);
router.delete("/:id", authenticateMiddleware, eliminarEspecialista);

export default router;
