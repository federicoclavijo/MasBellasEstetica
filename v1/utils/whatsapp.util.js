import { NEGOCIO } from "../config/negocio.config.js";
import { telefonoParaWhatsApp } from "./telefono.util.js";

const moneda = (n) => `$${Number(n).toLocaleString("es-UY", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

const fechaLarga = (fecha) =>
    new Intl.DateTimeFormat("es-UY", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })
        .format(new Date(`${fecha}T00:00:00Z`));

// Mensaje genérico para enviar al cliente con los medios de pago de la seña de un tratamiento.
export const construirMensajeWhatsApp = (reserva, { checkoutUrl, venceEl } = {}) => {
    const saldo = Math.max(0, reserva.precioTotal - reserva.montoSena);
    const lineas = [
        `¡Hola ${reserva.nombre.split(" ")[0]}! 👋 Te escribimos de ${NEGOCIO.nombreComercial}.`,
        "",
        `Tu turno para *${reserva.servicioNombre}* quedó agendado para el *${fechaLarga(reserva.fecha)} a las ${reserva.hora}*` +
            (reserva.especialistaNombre ? ` con ${reserva.especialistaNombre}.` : "."),
        "",
        `Para confirmarlo se abona una seña del ${reserva.porcentajeSena} %: *${moneda(reserva.montoSena)}* ` +
            `(valor del tratamiento: ${moneda(reserva.precioTotal)}). El resto, ${moneda(saldo)}, se abona en el local.`,
        "",
        "*Medios de pago de la seña:*",
    ];

    if (checkoutUrl) {
        lineas.push("", "💳 *Mercado Pago* (tarjeta, débito y otros medios):", checkoutUrl);
    }

    if (NEGOCIO.brouCuenta) {
        lineas.push("", "🏦 *Transferencia BROU*:", `Cuenta: ${NEGOCIO.brouCuenta}` + (NEGOCIO.brouTitular ? ` · Titular: ${NEGOCIO.brouTitular}` : ""),
            "Si pagas por transferencia, envíanos el comprobante por este chat para confirmar tu turno.");
    }

    if (venceEl) {
        lineas.push("", `⏳ El turno se reserva hasta el ${venceEl}; pasado ese plazo se libera.`);
    }

    lineas.push("", "¡Gracias por elegirnos! 🌸");
    return lineas.join("\n");
};

// Enlace "click to chat": abre WhatsApp con el mensaje listo para enviar a ese número.
export const urlWhatsApp = (telefonoE164, mensaje) =>
    `https://wa.me/${telefonoParaWhatsApp(telefonoE164)}?text=${encodeURIComponent(mensaje)}`;
