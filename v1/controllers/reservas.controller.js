import {
    guardarReservaService, obtenerReservasService, obtenerReservaPorIdService, actualizarReservaService,
    cancelarReservaService, marcarReembolsoService, reembolsarReservaService, eliminarReservaService,
    obtenerDisponibilidadService, obtenerDisponibilidadDeReservaService, obtenerEstadoPublicoService,
    crearReservaAdminService, obtenerWhatsappReservaService, confirmarPagoManualService, marcarAsistenciaService
} from "../services/reservas.services.js";
import { reenviarConfirmacionService } from "../services/mail.services.js";
import { crearError } from "../utils/http-error.util.js";

// Los errores (incluidos los async) llegan a errorMiddleware: Express 5 los reenvía solo.

export const agregarReserva = async (req, res) => {
    const resultado = await guardarReservaService(req.body);
    res.status(201).json({ mensaje: "Reserva creada correctamente.", ...resultado });
};

export const obtenerReservas = async (req, res) => {
    const reservas = await obtenerReservasService();
    res.status(200).json({ mensaje: "Reservas obtenidas.", reservas });
};

export const obtenerReservaPorId = async (req, res) => {
    const reserva = await obtenerReservaPorIdService(req.params.id);
    res.status(200).json({ mensaje: "Reserva obtenida.", reserva });
};

export const actualizarReserva = async (req, res) => {
    const reserva = await actualizarReservaService(req.params.id, req.body);
    res.status(200).json({ mensaje: "Reserva actualizada.", reserva });
};

export const cancelarReserva = async (req, res) => {
    const reserva = await cancelarReservaService(req.params.id);
    res.status(200).json({ mensaje: "Reserva cancelada.", reserva });
};

export const marcarReembolso = async (req, res) => {
    const reserva = await marcarReembolsoService(req.params.id);
    res.status(200).json({ mensaje: "Reserva marcada como reembolsada.", reserva });
};

export const reembolsarReserva = async (req, res) => {
    const reserva = await reembolsarReservaService(req.params.id);
    res.status(200).json({ mensaje: "Reembolso realizado.", reserva });
};

export const eliminarReserva = async (req, res) => {
    const reserva = await eliminarReservaService(req.params.id);
    res.status(200).json({ mensaje: "Reserva eliminada.", reserva });
};

// Público: horarios libres de un servicio en una fecha.
export const obtenerDisponibilidad = async (req, res) => {
    const { fecha, servicioId } = req.query;

    if (!fecha || !servicioId) {
        throw crearError(400, "Debes indicar fecha y servicioId");
    }

    // Con sesión de administrador también se consultan los tratamientos.
    const disponibilidad = await obtenerDisponibilidadService(String(fecha), String(servicioId), { admin: Boolean(req.user) });
    res.status(200).json(disponibilidad);
};

// Admin: horarios a los que se puede mover una reserva.
export const obtenerDisponibilidadDeReserva = async (req, res) => {
    const { fecha } = req.query;

    if (!fecha) {
        throw crearError(400, "Debes indicar la fecha");
    }

    const disponibilidad = await obtenerDisponibilidadDeReservaService(req.params.id, String(fecha));
    res.status(200).json(disponibilidad);
};

// Público: estado de la reserva para resultado.html (sin datos personales).
export const obtenerEstadoReserva = async (req, res) => {
    const estado = await obtenerEstadoPublicoService(req.params.id);
    res.set("Cache-Control", "no-store");
    res.status(200).json(estado);
};

// Admin: alta de un tratamiento (precio definido por el administrador) + mensaje de WhatsApp para el cliente.
export const crearReservaAdmin = async (req, res) => {
    const resultado = await crearReservaAdminService(req.body);
    res.status(201).json({ mensaje: "Reserva creada correctamente.", ...resultado });
};

export const obtenerWhatsappReserva = async (req, res) => {
    const whatsapp = await obtenerWhatsappReservaService(req.params.id);
    res.status(200).json({ mensaje: "Mensaje generado.", whatsapp });
};

export const confirmarPagoManual = async (req, res) => {
    const reserva = await confirmarPagoManualService(req.params.id);
    res.status(200).json({ mensaje: "Pago confirmado.", reserva });
};

export const reenviarConfirmacion = async (req, res) => {
    const { enviadoA } = await reenviarConfirmacionService(req.params.id);
    res.status(200).json({ mensaje: `Correo de confirmación enviado a ${enviadoA}.` });
};

export const marcarAsistencia = async (req, res) => {
    const reserva = await marcarAsistenciaService(req.params.id, req.body.asistencia);
    const mensaje = { asistio: "Asistencia registrada.", no_asistio: "Inasistencia registrada.", null: "Marca de asistencia quitada." }[String(req.body.asistencia)];
    res.status(200).json({ mensaje, reserva });
};
