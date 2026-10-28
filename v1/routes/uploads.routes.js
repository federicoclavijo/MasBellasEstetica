import express from "express";
import { subirImagen } from "../controllers/uploads.controller.js";
import { authenticateMiddleware } from "../middlewares/authenticate.middleware.js";

const router = express.Router();

router.post("/cloudinary", authenticateMiddleware, subirImagen);

export default router;

