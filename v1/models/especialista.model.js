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
