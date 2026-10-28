import { crearError } from "../utils/http-error.util.js";

const API_ORDENES = "https://api.mercadopago.com/v1/orders";

const encabezados = (idempotencia) => ({
    "Authorization": `Bearer ${process.env.MP_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
    ...(idempotencia ? { "X-Idempotency-Key": idempotencia } : {})
});

// URL a la que Mercado Pago devuelve al cliente. Lleva el id de la reserva en la query
// para que resultado.html sepa de qué reserva se trata aunque se abra en otro navegador/dispositivo.
export const urlDeRetorno = (reservaId) => {
    const base = (process.env.FRONTEND_URL || "").trim();
    if (!base) {
        throw crearError(500, "Falta configurar FRONTEND_URL.");
    }
    const raiz = base.endsWith("/") ? base : `${base}/`;
    const url = new URL("resultado.html", raiz);
    url.searchParams.set("reserva", String(reservaId));
    return url.toString();
};

// expiracionDias: vigencia del enlace de pago (ISO 8601, p. ej. "P2D"). Sin valor se usa la predeterminada de Mercado Pago.
export const crearOrden = async (reserva, { expiracionDias = null } = {}) => {
    const importe = reserva.montoSena.toFixed(2);
    const urlRetorno = urlDeRetorno(reserva._id);

    // La redirección automática de Mercado Pago exige una URL pública con https.
    // En desarrollo (http://localhost) se omite y el cliente vuelve con el botón "Volver al sitio".
    const redireccionAutomatica = urlRetorno.startsWith("https://");

    const nombreServicio = reserva.servicioNombre || "Reserva";
    const titulo = reserva.porcentajeSena === 100 ? nombreServicio : `Seña · ${nombreServicio}`;

    let response;
    try {
        response = await fetch(API_ORDENES, {
            method: "POST",
            // Clave determinística: reintentar la misma reserva no duplica la orden.
            headers: encabezados(`reserva-${reserva._id}`),
            body: JSON.stringify({
                type: "online",
                processing_mode: "manual",
                total_amount: importe,
                ...(expiracionDias ? { expiration_time: `P${expiracionDias}D` } : {}),
                external_reference: reserva._id.toString(),
                description: titulo,
                items: [
                    {
                        title: titulo,
                        quantity: 1,
                        unit_price: importe
                    }
                ],
                config: {
                    online: {
                        success_url: urlRetorno,
                        failure_url: urlRetorno,
                        pending_url: urlRetorno,
                        ...(redireccionAutomatica ? { auto_return: "approved" } : {})
                    },
                    statement_descriptor: "Más Bellas"
                }
            })
        });
    } catch (error) {
        console.error("No se pudo conectar con Mercado Pago:", error.message);
        // No sabemos si la orden llegó a crearse: la reserva se conserva y vence sola.
        throw crearError(502, "No se pudo iniciar el pago. Inténtalo nuevamente en unos minutos.", { ordenIndeterminada: true });
    }

    const data = await response.json().catch(() => null);

    if (!response.ok) {
        console.error("Mercado Pago rechazó la orden:", response.status, data?.errors ?? data?.message ?? "");
        throw crearError(502, "No se pudo iniciar el pago. Inténtalo nuevamente en unos minutos.", {
            // Un 4xx es un rechazo definitivo (no hay orden). Un 5xx es ambiguo.
            ordenNoCreada: response.status < 500
        });
    }

    return data;
};

export const obtenerOrden = async (orderId) => {
    const response = await fetch(
        `${API_ORDENES}/${encodeURIComponent(orderId)}`,
        { headers: { "Authorization": `Bearer ${process.env.MP_ACCESS_TOKEN}` } }
    );

    const data = await response.json().catch(() => null);

    if (!response.ok) {
        console.error("Error consultando orden:", response.status, data?.message ?? "");
        throw new Error("No se pudo consultar la orden");
    }

    return data;
};

// Cancela una orden que todavía no fue pagada (solo estados created / action_required).
export const cancelarOrden = async (orderId) => {
    const response = await fetch(
        `${API_ORDENES}/${encodeURIComponent(orderId)}/cancel`,
        { method: "POST", headers: encabezados(`cancelar-${orderId}`) }
    );

    if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(`No se pudo cancelar la orden (${response.status}): ${data?.message ?? ""}`);
    }

    return response.json().catch(() => ({}));
};

// Reembolsa una orden ya pagada.
//  - Total: cuerpo vacío (así lo exige la API; no se envía ningún monto).
//  - Parcial: se indica el id de la transacción de pago y el monto a devolver.
// La clave de idempotencia evita devolver dos veces si el pedido se repite.
export const reembolsarOrden = async (orderId, { transactionId = null, monto = null, idempotencia }) => {
    const parcial = monto !== null;
    let response;

    try {
        response = await fetch(`${API_ORDENES}/${encodeURIComponent(orderId)}/refund`, {
            method: "POST",
            headers: parcial
                ? encabezados(idempotencia)
                : { "Authorization": `Bearer ${process.env.MP_ACCESS_TOKEN}`, "X-Idempotency-Key": idempotencia },
            ...(parcial ? { body: JSON.stringify({ transactions: [{ id: transactionId, amount: monto.toFixed(2) }] }) } : {})
        });
    } catch (error) {
        console.error("No se pudo conectar con Mercado Pago para reembolsar:", error.message);
        throw crearError(502, "No se pudo conectar con Mercado Pago. Verifica en su panel si el reembolso se realizó antes de reintentar.");
    }

    const data = await response.json().catch(() => null);

    if (!response.ok) {
        const codigo = data?.errors?.[0]?.code ?? data?.error ?? "";
        const detalle = data?.errors?.[0]?.message ?? data?.message ?? "";
        console.error("Mercado Pago rechazó el reembolso:", response.status, codigo, detalle);

        if (codigo === "refund_amount_exceeds") {
            throw crearError(409, "El monto a devolver supera lo disponible para reembolso en Mercado Pago.");
        }
        throw crearError(409, `Mercado Pago no pudo realizar el reembolso${detalle ? `: ${detalle}` : ""}. Puede deberse a saldo insuficiente en tu cuenta, a que pasaron más de 180 días o a que la orden ya fue reembolsada.`);
    }

    return data;
};
