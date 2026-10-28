import nodemailer from "nodemailer";
import Reserva from "../models/reserva.model.js";
import { NEGOCIO } from "../config/negocio.config.js";
import { crearError } from "../utils/http-error.util.js";

// ----- Configuración (variables de entorno) -----------------------------------------------------------
//   SMTP_HOST, SMTP_PORT (587 por defecto), SMTP_SECURE ("true" para el puerto 465), SMTP_USER, SMTP_PASS, MAIL_FROM
// Sin SMTP_HOST el sistema funciona igual pero no envía correos.
export const correoConfigurado = () => Boolean((process.env.SMTP_HOST || "").trim());

let transporte = null;
let firmaTransporte = "";

const obtenerTransporte = () => {
    const config = {
        host: process.env.SMTP_HOST.trim(),
        port: Number(process.env.SMTP_PORT) || 587,
        secure: String(process.env.SMTP_SECURE).toLowerCase() === "true",
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" } : undefined,
    };
    // Se reutiliza la conexión mientras la configuración no cambie.
    const firma = JSON.stringify(config);
    if (!transporte || firma !== firmaTransporte) {
        transporte = nodemailer.createTransport({
            ...config,
            // Un servidor de correo lento no debe retener la respuesta al webhook de Mercado Pago.
            connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 12000,
        });
        firmaTransporte = firma;
    }
    return transporte;
};

let avisado = false;
const avisarNoConfigurado = () => {
    if (avisado) return;
    avisado = true;
    console.warn("Correo no configurado (falta SMTP_HOST): no se envían confirmaciones de reserva por email.");
};

// ----- Administradores que reciben el aviso de cada reserva pagada ------------------------------------------------
//   ADMIN_EMAIL_1 y ADMIN_EMAIL_2 (con uno solo alcanza; si faltan los dos no se envía nada).
const REGEX_EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
export const correosAdministradores = () => {
    const lista = [process.env.ADMIN_EMAIL_1, process.env.ADMIN_EMAIL_2].map((c) => (c || "").trim().toLowerCase()).filter(Boolean);
    const validos = lista.filter((c) => REGEX_EMAIL.test(c));
    for (const c of lista) if (!validos.includes(c)) console.warn(`ADMIN_EMAIL inválido, se ignora: «${c}»`);
    return [...new Set(validos)];
};

const remitente = () => process.env.MAIL_FROM || process.env.SMTP_USER || `${NEGOCIO.nombreComercial} <no-reply@localhost>`;

// ----- Contenido del correo ---------------------------------------------------------------------------------
const escapar = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const moneda = (n) => `$${Number(n).toLocaleString("es-UY", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const fechaLarga = (fecha) =>
    new Intl.DateTimeFormat("es-UY", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
        .format(new Date(`${fecha}T00:00:00Z`));
const mayuscula = (t) => t.charAt(0).toUpperCase() + t.slice(1);

export const construirCorreoConfirmacion = (reserva) => {
    const esTratamiento = (reserva.tipo ?? (reserva.porcentajeSena === 100 ? "consulta" : "tratamiento")) === "tratamiento";
    const saldo = Math.max(0, reserva.precioTotal - reserva.montoSena);
    const nombre = reserva.nombre.trim().split(/\s+/)[0];

    // Filas del detalle: [etiqueta, valor]
    const filas = [
        [esTratamiento ? "Tratamiento" : "Consulta", reserva.servicioNombre ?? (esTratamiento ? "Tratamiento" : "Consulta")],
        ...(reserva.especialistaNombre ? [["Especialista", reserva.especialistaNombre]] : []),
        ["Fecha", mayuscula(fechaLarga(reserva.fecha))],
        ["Hora", `${reserva.hora} hs (${reserva.duracionMinutos ?? 60} min)`],
        ...(esTratamiento
            ? [["Valor del tratamiento", moneda(reserva.precioTotal)], ["Seña abonada", moneda(reserva.montoSena)], ["Resta abonar en el local", moneda(saldo)]]
            : [["Valor de la consulta abonado", moneda(reserva.montoSena)]]),
        ["Referencia", String(reserva._id)],
    ];

    const contacto = [
        NEGOCIO.direccion ? `Dirección: ${NEGOCIO.direccion}` : null,
        NEGOCIO.telefonoContacto ? `Consultas y cambios: ${NEGOCIO.telefonoContacto}` : null,
    ].filter(Boolean);

    const notas = [
        "Te pedimos llegar unos minutos antes de tu horario.",
        ...(esTratamiento ? [`El saldo de ${moneda(saldo)} se abona en el local el día del tratamiento.`] : []),
        contacto.length ? "Si necesitas reprogramar o tienes dudas, contáctanos." : "Si necesitas reprogramar o tienes dudas, responde este correo.",
    ];

    const asunto = `Tu reserva en ${NEGOCIO.nombreComercial} quedó confirmada ✓`;

    const texto = [
        `¡Hola ${nombre}!`,
        "",
        `Tu reserva en ${NEGOCIO.nombreComercial} quedó CONFIRMADA. Recibimos tu pago correctamente.`,
        "",
        ...filas.map(([k, v]) => `${k}: ${v}`),
        "",
        ...notas,
        ...contacto,
        "",
        `¡Te esperamos! — ${NEGOCIO.nombreComercial}`,
    ].join("\n");

    const html = `<!doctype html>
<html lang="es"><body style="margin:0;padding:0;background:#fdeaf0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fdeaf0;padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e8d29a;border-radius:16px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#3b2a33;">
    <tr><td style="padding:22px 28px;background:#fffafb;border-bottom:2px solid #c6993f;">
      <span style="font-family:Georgia,'Times New Roman',serif;font-size:30px;font-weight:bold;color:#c6993f;">+</span><span style="font-family:Georgia,'Times New Roman',serif;font-size:28px;font-weight:bold;color:#3b2a33;">Bellas</span>
    </td></tr>
    <tr><td style="padding:28px 28px 8px;">
      <p style="margin:0 0 6px;font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#8f6a1d;">Reserva confirmada</p>
      <h1 style="margin:0 0 12px;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.2;color:#3b2a33;">¡Hola ${escapar(nombre)}, tu reserva quedó confirmada!</h1>
      <p style="margin:0;font-size:15px;line-height:1.5;color:#5b4a52;">Recibimos tu pago correctamente. Estos son los datos de tu reserva:</p>
    </td></tr>
    <tr><td style="padding:16px 28px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fbf1d7;border:1px solid #e8d29a;border-radius:12px;">
        ${filas.map(([k, v], i) => `<tr><td style="padding:10px 16px;${i ? "border-top:1px solid #e8d29a;" : ""}font-size:13px;color:#8f6a1d;width:42%;vertical-align:top;">${escapar(k)}</td><td style="padding:10px 16px;${i ? "border-top:1px solid #e8d29a;" : ""}font-size:15px;font-weight:bold;color:#3b2a33;word-break:break-word;">${escapar(v)}</td></tr>`).join("\n        ")}
      </table>
    </td></tr>
    <tr><td style="padding:4px 28px 24px;">
      ${notas.map((n) => `<p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:#5b4a52;">• ${escapar(n)}</p>`).join("\n      ")}
      ${contacto.map((c) => `<p style="margin:0 0 4px;font-size:14px;color:#3b2a33;font-weight:bold;">${escapar(c)}</p>`).join("\n      ")}
    </td></tr>
    <tr><td style="padding:16px 28px;background:#fffafb;border-top:1px solid #f0dce2;font-size:12px;color:#7b6870;">¡Te esperamos! — ${escapar(NEGOCIO.nombreComercial)}, clínica estética</td></tr>
  </table>
</td></tr></table>
</body></html>`;

    return { asunto, texto, html };
};

// Aviso interno para el administrador: quién pagó, qué reservó y cuándo.
export const construirCorreoAdmin = (reserva) => {
    const esTratamiento = (reserva.tipo ?? (reserva.porcentajeSena === 100 ? "consulta" : "tratamiento")) === "tratamiento";
    const saldo = Math.max(0, reserva.precioTotal - reserva.montoSena);
    const [a, m, d] = reserva.fecha.split("-");
    const medio = reserva.metodoPago === "transferencia" ? "Transferencia BROU (confirmada a mano)" : "Mercado Pago";

    const filas = [
        ["Cliente", reserva.nombre],
        ...(reserva.cedula ? [["Cédula", reserva.cedula]] : []),
        ["Correo", reserva.email],
        ...(reserva.telefono ? [["Teléfono", reserva.telefono]] : []),
        [esTratamiento ? "Tratamiento" : "Consulta", reserva.servicioNombre ?? (esTratamiento ? "Tratamiento" : "Consulta")],
        ...(reserva.especialistaNombre ? [["Especialista", reserva.especialistaNombre]] : []),
        ["Fecha y hora", `${mayuscula(fechaLarga(reserva.fecha))}, ${reserva.hora} hs (${reserva.duracionMinutos ?? 60} min)`],
        ...(esTratamiento
            ? [["Valor del tratamiento", moneda(reserva.precioTotal)], ["Seña abonada", moneda(reserva.montoSena)], ["Resta cobrar en el local", moneda(saldo)]]
            : [["Importe abonado", moneda(reserva.montoSena)]]),
        ["Medio de pago", medio],
        ["Referencia", String(reserva._id)],
    ];

    const titulo = `${esTratamiento ? "Seña de tratamiento" : "Consulta"} pagada`;
    const asunto = `Reserva pagada: ${reserva.servicioNombre ?? titulo} — ${d}/${m}/${a} ${reserva.hora} (${reserva.nombre})`;
    const texto = [titulo.toUpperCase(), "", ...filas.map(([k, v]) => `${k}: ${v}`), "", `Aviso automático de ${NEGOCIO.nombreComercial}.`].join("\n");

    const html = `<!doctype html>
<html lang="es"><body style="margin:0;padding:0;background:#fdeaf0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fdeaf0;padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e8d29a;border-radius:16px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#3b2a33;">
    <tr><td style="padding:22px 28px;background:#fffafb;border-bottom:2px solid #c6993f;">
      <span style="font-family:Georgia,'Times New Roman',serif;font-size:30px;font-weight:bold;color:#c6993f;">+</span><span style="font-family:Georgia,'Times New Roman',serif;font-size:28px;font-weight:bold;color:#3b2a33;">Bellas</span>
      <span style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#8f6a1d;margin-left:10px;">Aviso interno</span>
    </td></tr>
    <tr><td style="padding:28px 28px 8px;">
      <p style="margin:0 0 6px;font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#8f6a1d;">Nueva reserva pagada</p>
      <h1 style="margin:0 0 12px;font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:1.2;color:#3b2a33;">${escapar(reserva.nombre)} pagó ${esTratamiento ? "la seña de un tratamiento" : "una consulta"}</h1>
    </td></tr>
    <tr><td style="padding:8px 28px 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fbf1d7;border:1px solid #e8d29a;border-radius:12px;">
        ${filas.map(([k, v], i) => `<tr><td style="padding:10px 16px;${i ? "border-top:1px solid #e8d29a;" : ""}font-size:13px;color:#8f6a1d;width:38%;vertical-align:top;">${escapar(k)}</td><td style="padding:10px 16px;${i ? "border-top:1px solid #e8d29a;" : ""}font-size:15px;font-weight:bold;color:#3b2a33;word-break:break-word;">${escapar(v)}</td></tr>`).join("\n        ")}
      </table>
    </td></tr>
    <tr><td style="padding:16px 28px;background:#fffafb;border-top:1px solid #f0dce2;font-size:12px;color:#7b6870;">Aviso automático de ${escapar(NEGOCIO.nombreComercial)}. La reserva ya figura como confirmada en el panel.</td></tr>
  </table>
</td></tr></table>
</body></html>`;

    return { asunto, texto, html };
};

// ----- Envío ------------------------------------------------------------------------------------------------------
const VENTANA_INTENTO_MS = 2 * 60 * 1000;

// Defensa en profundidad dentro de un mismo proceso: si varias vías (webhook, página de resultado...) confirman la
// misma reserva a la vez, solo una envía. Entre procesos distintos (p. ej. varias instancias serverless) lo garantiza
// la actualización atómica de MongoDB que "reserva" el envío más abajo.
const enCurso = new Set();

// Envía el correo de confirmación de una reserva CONFIRMADA. Se envía una sola vez aunque el aviso de pago llegue
// repetido o varias vías (webhook, página de resultado, tarea de vencimiento) confirmen a la vez: una actualización
// atómica "reserva" el envío. `forzar` (reenvío manual del administrador) ignora que ya se haya enviado.
export const enviarConfirmacionReservaService = async (reservaId, { forzar = false } = {}) => {
    if (!correoConfigurado()) {
        avisarNoConfigurado();
        return { enviado: false, motivo: "correo_no_configurado" };
    }

    const clave = String(reservaId);
    if (enCurso.has(clave)) return { enviado: false, motivo: "ya_enviado_o_en_curso" };
    enCurso.add(clave);

    try {
        return await enviarSiCorresponde(clave, forzar);
    } finally {
        enCurso.delete(clave);
    }
};

const enviarSiCorresponde = async (reservaId, forzar) => {
    const filtro = {
        _id: reservaId,
        estadoReserva: "confirmada",
        $or: [{ emailConfirmacionIntentoEn: null }, { emailConfirmacionIntentoEn: { $lt: new Date(Date.now() - VENTANA_INTENTO_MS) } }],
    };
    if (!forzar) filtro.emailConfirmacionEnviadoEn = null;

    const reserva = await Reserva.findOneAndUpdate(filtro, { $set: { emailConfirmacionIntentoEn: new Date() } }, { returnDocument: "after" });

    if (!reserva) return { enviado: false, motivo: "ya_enviado_o_en_curso" };

    try {
        const { asunto, texto, html } = construirCorreoConfirmacion(reserva);
        await obtenerTransporte().sendMail({
            from: remitente(),
            to: reserva.email,
            subject: asunto,
            text: texto,
            html,
        });
        await Reserva.updateOne({ _id: reserva._id }, { $set: { emailConfirmacionEnviadoEn: new Date(), emailConfirmacionIntentoEn: null } });
        console.log(`Correo de confirmación enviado (reserva ${reserva._id}).`);
        return { enviado: true };
    } catch (error) {
        // Un fallo de correo nunca debe afectar al pago ni a la reserva: queda registrado y se puede reenviar.
        await Reserva.updateOne({ _id: reserva._id }, { $set: { emailConfirmacionIntentoEn: null } });
        console.error(`No se pudo enviar el correo de confirmación (reserva ${reserva._id}):`, error.message);
        return { enviado: false, motivo: "error", error: error.message };
    }
};

// Uso interno desde el flujo de pagos: nunca lanza.
// Avisa al cliente (confirmación) y a los administradores (reserva pagada); cada correo es independiente.
export const notificarConfirmacion = async (reservaId) => {
    const [cliente] = await Promise.all([
        enviarConfirmacionReservaService(String(reservaId)).catch((error) => {
            console.error("Error notificando la confirmación:", error.message);
            return { enviado: false, motivo: "error" };
        }),
        notificarAdministradores(reservaId),
    ]);
    return cliente;
};

// Reenvío manual desde el panel.
export const reenviarConfirmacionService = async (reservaId) => {
    if (!correoConfigurado()) {
        throw crearError(409, "El envío de correos no está configurado (faltan las variables SMTP_* en el servidor)");
    }

    const reserva = await Reserva.findById(reservaId).select("estadoReserva email");
    if (!reserva) throw crearError(404, "No se encontró la reserva");
    if (reserva.estadoReserva !== "confirmada") {
        throw crearError(409, "Solo se envía confirmación de reservas confirmadas");
    }

    const resultado = await enviarConfirmacionReservaService(reservaId, { forzar: true });

    if (resultado.motivo === "ya_enviado_o_en_curso") {
        throw crearError(409, "Ya hay un envío en curso para esta reserva. Inténtalo en un minuto");
    }
    if (!resultado.enviado) {
        throw crearError(502, `No se pudo enviar el correo: ${resultado.error ?? "error desconocido"}`);
    }

    return { enviadoA: reserva.email };
};

// ----- Aviso a los administradores ----------------------------------------------------------------------------------
// Se envía una sola vez por reserva (aunque el aviso de pago llegue repetido), con la misma reserva atómica que el
// correo del cliente pero con marcas propias: que falle uno no impide el otro. Nunca lanza.
const enCursoAdmin = new Set();

export const notificarAdministradores = async (reservaId) => {
    const clave = String(reservaId);
    try {
        const destinatarios = correosAdministradores();
        if (!destinatarios.length || !correoConfigurado()) return { enviado: false, motivo: destinatarios.length ? "correo_no_configurado" : "sin_destinatarios" };
        if (enCursoAdmin.has(clave)) return { enviado: false, motivo: "ya_enviado_o_en_curso" };
        enCursoAdmin.add(clave);

        try {
            const reserva = await Reserva.findOneAndUpdate(
                {
                    _id: clave, estadoReserva: "confirmada", emailAdminEnviadoEn: null,
                    $or: [{ emailAdminIntentoEn: null }, { emailAdminIntentoEn: { $lt: new Date(Date.now() - VENTANA_INTENTO_MS) } }],
                },
                { $set: { emailAdminIntentoEn: new Date() } },
                { returnDocument: "after" }
            );
            if (!reserva) return { enviado: false, motivo: "ya_enviado_o_en_curso" };

            try {
                const { asunto, texto, html } = construirCorreoAdmin(reserva);
                await obtenerTransporte().sendMail({ from: remitente(), to: destinatarios, subject: asunto, text: texto, html, replyTo: reserva.email });
                await Reserva.updateOne({ _id: reserva._id }, { $set: { emailAdminEnviadoEn: new Date(), emailAdminIntentoEn: null } });
                console.log(`Aviso a administradores enviado (reserva ${reserva._id}).`);
                return { enviado: true };
            } catch (error) {
                await Reserva.updateOne({ _id: reserva._id }, { $set: { emailAdminIntentoEn: null } });
                console.error(`No se pudo enviar el aviso a administradores (reserva ${reserva._id}):`, error.message);
                return { enviado: false, motivo: "error" };
            }
        } finally {
            enCursoAdmin.delete(clave);
        }
    } catch (error) {
        console.error("Error avisando a los administradores:", error.message);
        return { enviado: false, motivo: "error" };
    }
};
