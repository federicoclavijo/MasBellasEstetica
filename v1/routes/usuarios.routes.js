import express from "express";
import { buscarClientes } from "../controllers/usuarios.controller.js";
import { authenticateMiddleware } from "../middlewares/authenticate.middleware.js";

const router = express.Router({ mergeParams: true });

router.get("/", authenticateMiddleware, buscarClientes);

export default router;
