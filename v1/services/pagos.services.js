// Lógica de pagos compartida por el webhook de Mercado Pago, la consulta de estado
// que hace resultado.html y la tarea de vencimiento de reservas.
// Así una reserva se confirma aunque el webhook no haya llegado (p. ej. en desarrollo sin ngrok).
import Reserva from "../models/reserva.model.js";
import { obtenerOrden } from "./mercadoPago.services.js";
import { esObjectIdValido } from "../utils/id.util.js";
import { notificarConfirmacion } from "./mail.services.js";

const ESTADOS_ORDEN_SIN_PAGO = ["canceled", "expired"];

// Aplica a la reserva el estado real de una orden de Mercado Pago. Es idempotente.
// Devuelve un texto con lo que ocurrió (útil para logs y tests).
export const procesarOrdenService = async (orden) => {
    // 1. La orden debe corresponder a una reserva nuestra.
    const reserva = esObjectIdValido(String(orden.external_reference))
        ? await Reserva.findById(orden.external_reference)
        : null;

    if (!reserva) {
        console.error("No se encontró la reserva asociada a la orden.");
        return "reserva_no_encontrada";
    }

    if (
        reserva.mercadoPagoOrderId !== String(orden.id) ||
        Number(orden.total_amount) !== reserva.montoSena ||
        orden.currency !== "UYU"
    ) {
        console.error("Los datos de la orden no coinciden con la reserva.");
        return "datos_no_coinciden";
    }

    // 2. Orden cancelada o vencida en Mercado Pago sin pago: se libera el horario.
    if (ESTADOS_ORDEN_SIN_PAGO.includes(orden.status)) {
        await Reserva.updateOne(
            { _id: reserva._id, estadoReserva: "pendiente_pago" },
            { $set: { estadoReserva: "cancelada", estadoPago: "rechazado" } }
        );
        return "orden_sin_pago";
    }

    // 3. ¿El pago está acreditado por el importe completo?
    const importePagado = Number(orden.total_paid_amount);

    const pagoAcreditado =
        orden.status === "processed" &&
        orden.status_detail === "accredited" &&
        Number.isFinite(importePagado) &&
        importePagado >= reserva.montoSena;

    if (!pagoAcreditado) {
        return "pendiente";
    }

    // 4. Confirmar únicamente si sigue pendiente. La actualización atómica evita
    // confirmar una reserva que ya expiró o que otro proceso ya confirmó.
    const confirmada = await Reserva.findOneAndUpdate(
        { _id: reserva._id, estadoReserva: "pendiente_pago" },
        { $set: { estadoPago: "aprobado", estadoReserva: "confirmada" } },
        { returnDocument: "after" }
    );

    if (confirmada) {
        console.log("Pago acreditado. Reserva confirmada:", String(confirmada._id));
        // Aviso al cliente por correo (una sola vez; si falla, la reserva queda confirmada igual).
        await notificarConfirmacion(confirmada._id);
        return "confirmada";
    }

    // 5. No estaba pendiente: revisar su estado actual.
    const actual = await Reserva.findById(reserva._id);

    if (!actual) return "reserva_no_encontrada";

    if (actual.estadoReserva === "expirada" || actual.estadoReserva === "cancelada") {
        // Se registra el pago, pero NO se reactiva la reserva.
        if (actual.estadoPago !== "aprobado" && actual.estadoPago !== "reembolsado") {
            await Reserva.updateOne(
                { _id: actual._id, estadoReserva: { $in: ["expirada", "cancelada"] } },
                { $set: { estadoPago: "aprobado" } }
            );
        }

        console.error("ATENCIÓN: se acreditó un pago para una reserva expirada o cancelada.", {
            reservaId: String(actual._id),
            ordenId: String(orden.id),
            importePagado,
            accion: "Revisar el caso y gestionar la devolución."
        });

        return "pago_en_reserva_cerrada";
    }

    if (actual.estadoReserva === "confirmada") {
        // El webhook puede repetirse: solo se asegura que el pago figure aprobado.
        if (actual.estadoPago !== "aprobado") {
            await Reserva.updateOne(
                { _id: actual._id, estadoReserva: "confirmada" },
                { $set: { estadoPago: "aprobado" } }
            );
        }
        // Si el correo no pudo enviarse antes (p. ej. servidor de correo caído), el aviso repetido de Mercado Pago lo reintenta.
        await notificarConfirmacion(actual._id);
        return "ya_confirmada";
    }

    console.error("El pago está acreditado, pero la reserva tiene un estado inesperado.", {
        reservaId: String(actual._id),
        estadoReserva: actual.estadoReserva
    });
    return "estado_inesperado";
};

// Consulta la orden en Mercado Pago y actualiza la reserva. Lanza error si Mercado Pago no responde.
export const sincronizarPagoDeReserva = async (reserva) => {
    if (!reserva.mercadoPagoOrderId) {
        return { orden: null, reserva };
    }

    const orden = await obtenerOrden(reserva.mercadoPagoOrderId);
    await procesarOrdenService(orden);

    return { orden, reserva: await Reserva.findById(reserva._id) };
};
