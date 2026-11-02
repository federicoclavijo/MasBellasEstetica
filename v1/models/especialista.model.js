import mongoose, { Schema } from "mongoose";
import { NEGOCIO } from "../config/negocio.config.js";

const especialistaSchema = new Schema({
    nombre: { type: String, required: true, trim: true },
    imagenPerfil: { type: String },
    // Días de la semana en que atiende (0 = domingo … 6 = sábado). Se puede cambiar en cualquier momento desde el panel.
    // Los especialistas creados antes de este campo toman el valor por defecto al leerse (lunes a sábado).
    diasDisponibles: {
        type: [Number],
        default: () => [...NEGOCIO.diasPorDefecto],
        validate: {
            validator: (dias) => dias.length > 0 && dias.every((d) => Number.isInteger(d) && d >= 0 && d <= 6),
            message: "Los días de atención deben ser entre 0 (domingo) y 6 (sábado) y haber al menos uno",
        },
    },
    // Cómo se definen los días de atención. SOLO UNA de las dos modalidades está activa a la vez:
    //  - "semanal": atiende los días de la semana de `diasDisponibles` (p. ej. todos los sábados).
    //  - "fechas":  atiende únicamente las fechas puntuales de `fechasDisponibles` (p. ej. un día al mes).
    // Al cambiar de modalidad se conserva lo cargado en la otra, pero no se aplica.
    tipoDisponibilidad: { type: String, enum: ["semanal", "fechas"], default: "semanal" },
    fechasDisponibles: {
        type: [String], // "YYYY-MM-DD"
        default: [],
        validate: {
            validator: (fechas) => fechas.every((f) => /^\d{4}-\d{2}-\d{2}$/.test(f)),
            message: "Las fechas de atención deben tener formato YYYY-MM-DD",
        },
    },
    rol: { type: String, enum: ["Medico", "Cirujano"], default: "Medico", required: true }
}, {
    versionKey: false,
    toJSON: { virtuals: true, id: false },
    toObject: { virtuals: true, id: false },
});

// Lado inverso de la relación: los servicios que tiene a cargo (Servicio.especialistaId es la fuente única).
// Solo aparece en las respuestas cuando se hace populate("servicios").
especialistaSchema.virtual("servicios", {
    ref: "Servicio",
    localField: "_id",
    foreignField: "especialistaId",
});

export default mongoose.model("Especialista", especialistaSchema);
