import express from "express";
import { login } from "../controllers/auth.controllers.js"

const router = express.Router({ mergeParams: true });

//Si llego a este archivo yo asumo que ya estoy en rutas /alumnos
router.post("/login", login);


export default router;