import express from "express";
import {
    obtenerReservas, obtenerReservaPorId, agregarReserva, actualizarReserva, eliminarReserva,
    cancelarReserva, marcarReembolso, reembolsarReserva, crearReservaAdmin, obtenerWhatsappReserva, confirmarPagoManual, reenviarConfirmacion, obtenerDisponibilidad, obtenerDisponibilidadDeReserva, obtenerEstadoReserva, marcarAsistencia
} from "../controllers/reservas.controller.js";
import { validateBodyMiddleware } from "../middlewares/validateBody.middleware.js";
import { agregarReservaSchema, modificarReservaSchema, crearReservaAdminSchema, marcarAsistenciaSchema } from "../validators/reservas.validators.js";
import { authenticateMiddleware } from "../middlewares/authenticate.middleware.js";
import { authenticateOptionalMiddleware } from "../middlewares/authenticateOptional.middleware.js";

const router = express.Router({ mergeParams: true });

// Públicas (formulario de reserva y página de resultado)
router.get("/disponibilidad", authenticateOptionalMiddleware, obtenerDisponibilidad);
router.post("/", validateBodyMiddleware(agregarReservaSchema), agregarReserva);
router.get("/:id/estado", obtenerEstadoReserva);

// Administración
router.post("/admin", authenticateMiddleware, validateBodyMiddleware(crearReservaAdminSchema), crearReservaAdmin);
router.get("/", authenticateMiddleware, obtenerReservas);
router.get("/:id/disponibilidad", authenticateMiddleware, obtenerDisponibilidadDeReserva);
router.get("/:id", authenticateMiddleware, obtenerReservaPorId);
router.patch("/:id", authenticateMiddleware, validateBodyMiddleware(modificarReservaSchema), actualizarReserva);
router.get("/:id/whatsapp", authenticateMiddleware, obtenerWhatsappReserva);
router.post("/:id/confirmar-pago", authenticateMiddleware, confirmarPagoManual);
router.post("/:id/reenviar-confirmacion", authenticateMiddleware, reenviarConfirmacion);
router.post("/:id/asistencia", authenticateMiddleware, validateBodyMiddleware(marcarAsistenciaSchema), marcarAsistencia);
router.post("/:id/cancelar", authenticateMiddleware, cancelarReserva);
router.post("/:id/reembolsar", authenticateMiddleware, reembolsarReserva);   // devuelve el dinero vía Mercado Pago
router.post("/:id/reembolso", authenticateMiddleware, marcarReembolso);      // solo deja constancia (devolución hecha a mano)
router.delete("/:id", authenticateMiddleware, eliminarReserva);

export default router;
