import express from "express";
import { procesarWebhookMercadoPago } from "../controllers/webhooks.controller.js";

const router = express.Router();

router.post("/mercadopago", procesarWebhookMercadoPago);

export default router;
