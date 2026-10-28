import mongoose, { Schema } from "mongoose";
import { esConsulta, duracionDe, calcularCobro } from "../utils/cobro.util.js";

const servicioSchema = new Schema({
    nombre: { type: String, required: true, unique: true, trim: true },
    // Consulta: siempre $500 (lo fija el servidor). Tratamiento: precio de referencia OPCIONAL; el importe real
    // lo define el administrador en cada reserva, porque varía según el cliente.
    precio: { type: Number, min: 1, default: null },
    // false -> CONSULTA: valor fijo de $500, turnos cada 30 min. Es lo ÚNICO que reserva el cliente en la web.
    // true  -> TRATAMIENTO: lo reserva el administrador (seña del 50 %, turnos de 1 hora).
    porcentaje: { type: Boolean, default: true },
    // Cada servicio tiene UN especialista a cargo (un especialista puede tener varios servicios).
    // null = "Sin asignar": el servicio se ve pero todavía no se puede reservar.
    // La relación inversa es Especialista.servicios (virtual): no se duplica el dato.
    especialistaId: { type: mongoose.Schema.Types.ObjectId, ref: "Especialista", default: null },
    activo: { type: Boolean, default: true },
}, {
    versionKey: false,
    toJSON: { virtuals: true, id: false },
    toObject: { virtuals: true, id: false },
});

// Datos calculados por el servidor (así el frontend no duplica las reglas de negocio).
servicioSchema.virtual("esConsulta").get(function () { return esConsulta(this); });
servicioSchema.virtual("duracionMinutos").get(function () { return duracionDe(this); });
servicioSchema.virtual("porcentajeSena").get(function () { return calcularCobro(this).porcentajeSena; });
servicioSchema.virtual("montoSena").get(function () { return calcularCobro(this).montoSena; });

export default mongoose.model("Servicio", servicioSchema);
