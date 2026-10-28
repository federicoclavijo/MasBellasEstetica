import { WebhookSignatureValidator, InvalidWebhookSignatureError } from "mercadopago";
import { obtenerOrden } from "../services/mercadoPago.services.js";
import { procesarOrdenService } from "../services/pagos.services.js";

export const procesarWebhookMercadoPago = async (req, res) => {
    const orderId = req.query["data.id"];
    const tipo = req.query.type || req.body?.type;

    if (!orderId || tipo !== "order") {
        return res.sendStatus(400);
    }

    // 1. Validar la firma del webhook.
    try {
        if (!process.env.MP_WEBHOOK_SECRET?.trim()) {
            console.error("Falta configurar MP_WEBHOOK_SECRET.");
            return res.sendStatus(500);
        }

        WebhookSignatureValidator.validate({
            xSignature: req.headers["x-signature"],
            xRequestId: req.headers["x-request-id"],
            dataId: String(orderId).toLowerCase(),
            secret: process.env.MP_WEBHOOK_SECRET.trim()
        });
    } catch (error) {
        if (error instanceof InvalidWebhookSignatureError) {
            console.error("Firma del webhook inválida.");
            return res.sendStatus(401);
        }

        console.error("Error validando webhook:", error);
        return res.sendStatus(500);
    }

    // 2. Consultar la orden y aplicarla a la reserva (la lógica vive en pagos.services.js).
    try {
        const orden = await obtenerOrden(String(orderId));
        await procesarOrdenService(orden);
        return res.sendStatus(200);
    } catch (error) {
        console.error("Error procesando el webhook:", error);
        return res.sendStatus(500);
    }
};
