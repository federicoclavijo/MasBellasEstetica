import mongoose, { Schema } from "mongoose";
import { NEGOCIO } from "../config/negocio.config.js";
import { calcularReembolso } from "../utils/cobro.util.js";
import { franjaYaPaso } from "../utils/horarios.util.js";

const reservaSchema = new Schema({
    nombre: { type: String, required: true },
    cedula: { type: String, default: "" },
    email: { type: String, required: true },
    // Móvil uruguayo en formato internacional (+598...).
    telefono: { type: String, default: null },
    // "web": consulta reservada por el cliente · "admin": tratamiento dado de alta por el administrador.
    origen: { type: String, enum: ["web", "admin"], default: "web" },
    // (Las reservas anteriores a este campo no lo tienen: se deduce de porcentajeSena, 100 = consulta.)
    tipo: { type: String, enum: ["consulta", "tratamiento"] },
    // Cómo se pagó la seña. La transferencia BROU la confirma el administrador a mano.
    metodoPago: { type: String, enum: ["mercadopago", "transferencia"], default: "mercadopago" },
    usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: "Usuario", default: null },
    servicioId: { type: mongoose.Schema.Types.ObjectId, ref: "Servicio", required: true },
    especialistaId: { type: mongoose.Schema.Types.ObjectId, ref: "Especialista", required: true },
    // Copias de los nombres al momento de reservar: el historial sigue siendo legible
    // aunque después se renombre o elimine el servicio / especialista.
    servicioNombre: { type: String },
    especialistaNombre: { type: String },
    fecha: { type: String, required: true },
    fechaExpiracion: { type: Date, default: null },
    hora: { type: String, required: true },
    // Duración del turno al reservar (30 = consulta, 60 = resto). Sirve para detectar cruces de horario.
    duracionMinutos: { type: Number, enum: [30, 60], default: 60 },
    precioTotal: { type: Number, min: 0, required: true },
    // 50 en servicios convencionales; 100 en la consulta (valor fijo que se paga completo).
    porcentajeSena: { type: Number, min: 0, max: 100, default: 50, required: true },
    montoSena: { type: Number, min: 0, required: true },
    estadoReserva: {
        type: String,
        enum: [
            "pendiente_pago",
            "confirmada",
            "cancelada",
            "expirada"
        ],
        default: "pendiente_pago"
    },
    estadoPago: {
        type: String,
        enum: [
            "pendiente",
            "aprobado",
            "rechazado",
            "reembolsado"
        ],
        default: "pendiente"
    },
    mercadoPagoOrderId: { type: String, default: null },
    // Enlace de pago de Mercado Pago (para poder reenviarlo por WhatsApp).
    checkoutUrl: { type: String, default: null },
    // Correo de confirmación al cliente (se envía una sola vez cuando la reserva queda confirmada).
    emailConfirmacionEnviadoEn: { type: Date, default: null },
    emailConfirmacionIntentoEn: { type: Date, default: null },
    // Aviso por correo a los administradores cuando la reserva queda pagada (se envía una sola vez; mismo mecanismo que el del cliente).
    emailAdminEnviadoEn: { type: Date, default: null },
    emailAdminIntentoEn: { type: Date, default: null },
    // Constancia de asistencia, marcada a mano por el administrador: null = sin registrar.
    asistencia: { type: String, enum: ["asistio", "no_asistio"], default: null },
    asistenciaMarcadaEn: { type: Date, default: null },
    // Reembolso hecho desde el sistema (null mientras no exista).
    montoReembolsado: { type: Number, min: 0, default: null },
    reembolsoPorcentaje: { type: Number, min: 0, max: 100, default: null },
    reembolsoId: { type: String, default: null },
    reembolsadoEn: { type: Date, default: null },
    // Cerrojo contra doble reembolso (dos clics / dos administradores a la vez). Se libera solo si queda colgado.
    reembolsoIniciadoEn: { type: Date, default: null },
}, {
    versionKey: false,
    toJSON: { virtuals: true, id: false },
    toObject: { virtuals: true, id: false },
});

// ¿El turno ya comenzó? Solo entonces tiene sentido registrar si el cliente asistió.
reservaSchema.virtual("turnoIniciado").get(function () { return franjaYaPaso(this.fecha, this.hora); });

// Lo que resta abonar en el local (tratamientos: precio total menos la seña).
reservaSchema.virtual("saldoRestante").get(function () { return Math.max(0, this.precioTotal - this.montoSena); });

// Lo que se devolvería hoy si se reembolsa esta reserva (el panel lo muestra antes de confirmar).
reservaSchema.virtual("porcentajeReembolsable").get(function () { return NEGOCIO.reembolsoPorcentaje; });
reservaSchema.virtual("montoReembolsable").get(function () { return calcularReembolso(this.montoSena, NEGOCIO.reembolsoPorcentaje); });

// Red de seguridad contra doble reserva exacta (dos pedidos simultáneos al mismo horario).
// Los cruces entre turnos de distinta duración se controlan en reservas.services.js.
reservaSchema.index(
    {
        especialistaId: 1,
        fecha: 1,
        hora: 1
    },
    {
        unique: true,
        partialFilterExpression: {
            estadoReserva: {
                $in: ["pendiente_pago", "confirmada"]
            }
        }
    }
);

export default mongoose.model("Reserva", reservaSchema);
