// Página a la que Mercado Pago devuelve al cliente después de pagar.
// El estado real lo informa el servidor (que consulta a Mercado Pago): nunca se da un pago por
// aprobado solo porque el cliente llegó hasta aquí.
import { obtenerEstadoReserva, ApiError } from "./api.js";
import { STORAGE } from "./config.js";
import { el, $, vaciar, formatearFecha, formatearMoneda } from "./ui.js";

const params = new URLSearchParams(window.location.search);
const leerAlmacen = (almacen) => { try { return window[almacen].getItem(STORAGE.ultimaReserva); } catch { return null; } };
const reservaId = params.get("reserva") || params.get("external_reference") || leerAlmacen("localStorage") || leerAlmacen("sessionStorage");

// Pista de Mercado Pago en la URL: solo se usa para mostrar "rechazado", nunca para aprobar.
const pistaMP = (params.get("status") || params.get("collection_status") || "").toLowerCase();
const MP_RECHAZADO = ["rejected", "failure", "failed", "cancelled", "canceled"];

const REINTENTO_MS = 4000;
const MAX_REINTENTOS = 30; // ~2 minutos esperando la acreditación

const VISTAS = {
  pendiente: { clase: "", icono: "⏳", titulo: "Estamos verificando tu pago",
    texto: "Mercado Pago está confirmando el pago. Esta página se actualiza sola; tu turno quedará confirmado apenas se acredite." },
  aprobado: { clase: "result--ok", icono: "✓", titulo: "¡Reserva confirmada!",
    texto: "Recibimos tu pago. Te esperamos en +Bellas." },
  rechazado: { clase: "result--error", icono: "✕", titulo: "No pudimos acreditar tu pago",
    texto: "El pago fue rechazado o cancelado y tu turno no quedó confirmado. Puedes volver a reservar e intentarlo nuevamente." },
  cerrada: { clase: "result--error", icono: "!", titulo: "Esta reserva ya no está activa",
    texto: "El plazo para pagar venció o la reserva fue cancelada. Si ya pagaste, contacta al centro. Si no, puedes reservar nuevamente." },
  sinReserva: { clase: "result--error", icono: "?", titulo: "No encontramos tu reserva",
    texto: "No pudimos identificar la reserva. Si realizaste un pago, contacta al centro indicando tu nombre y la fecha elegida." },
  error: { clase: "result--error", icono: "!", titulo: "No pudimos consultar el estado",
    texto: "Ocurrió un problema al consultar tu reserva. Si ya pagaste, tu turno se confirmará automáticamente; también puedes contactar al centro." },
};

let temporizador = null;

function pintar(clave, reserva) {
  const v = VISTAS[clave];
  const sec = vaciar($("#resultado"));
  sec.className = `card result ${v.clase}`;
  sec.append(
    el("div", { class: "result__icon", "aria-hidden": "true" }, v.icono),
    el("h1", {}, v.titulo),
    el("p", {}, v.texto),
    reserva?.fecha
      ? el("p", { style: "margin-top:.6rem;font-weight:600;color:var(--ink)" },
          [reserva.servicioNombre, `${formatearFecha(reserva.fecha)} · ${reserva.hora}`].filter(Boolean).join(" — "))
      : null,
    clave === "aprobado" && reserva?.montoSena != null
      ? el("p", { style: "margin-top:.3rem" }, `Importe abonado: ${formatearMoneda(reserva.montoSena)}`) : null,
    el("div", { class: "result__actions" },
      el("a", { class: "btn btn--primary", href: "/" }, ["rechazado", "cerrada", "sinReserva"].includes(clave) ? "Volver a reservar" : "Volver al inicio"),
      clave === "error" ? el("button", { type: "button", class: "btn btn--ghost", onclick: () => window.location.reload() }, "Reintentar") : null,
    ),
    reservaId && clave !== "sinReserva" ? el("p", { class: "result__ref" }, `Referencia de reserva: ${reservaId}`) : null,
  );
}

function vistaPara(reserva) {
  if (reserva.estadoReserva === "confirmada" && reserva.estadoPago === "aprobado") return "aprobado";
  if (reserva.estadoReserva === "cancelada" || reserva.estadoReserva === "expirada") {
    return reserva.estadoPago === "rechazado" ? "rechazado" : "cerrada";
  }
  return MP_RECHAZADO.includes(pistaMP) ? "rechazado" : "pendiente";
}

async function consultar(intento = 0) {
  try {
    const reserva = await obtenerEstadoReserva(reservaId);
    const clave = vistaPara(reserva);
    pintar(clave, reserva);
    if (clave === "pendiente" && intento < MAX_REINTENTOS) {
      temporizador = setTimeout(() => consultar(intento + 1), REINTENTO_MS);
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return pintar("sinReserva");
    // Un fallo momentáneo de red durante la espera no debe tapar la pantalla de verificación.
    if (intento > 0 && intento < MAX_REINTENTOS) {
      temporizador = setTimeout(() => consultar(intento + 1), REINTENTO_MS);
      return;
    }
    pintar("error");
  }
}

if (!reservaId) {
  pintar(MP_RECHAZADO.includes(pistaMP) ? "rechazado" : "sinReserva");
} else {
  consultar();
}

window.addEventListener("pagehide", () => clearTimeout(temporizador));
