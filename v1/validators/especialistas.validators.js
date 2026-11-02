import Joi from "joi";
import { esFechaValida } from "../utils/horarios.util.js";

const nombre = Joi.string().trim().min(3).max(60).label("El nombre");
const rol = Joi.string().valid("Medico", "Cirujano").label("El rol")
    .messages({ "any.only": "El rol debe ser Medico o Cirujano" });
// Servicios que tendrá a cargo (puede ser más de uno). Si se envía, reemplaza la lista actual.
const serviciosIds = Joi.array().items(Joi.string().hex().length(24)).unique().max(100).label("Los servicios")
    .messages({ "string.hex": "Alguno de los servicios no es válido", "string.length": "Alguno de los servicios no es válido", "array.unique": "Hay servicios repetidos" });

// Días de la semana en que atiende: 0 = domingo … 6 = sábado. Al menos uno.
const diasDisponibles = Joi.array().items(Joi.number().integer().min(0).max(6)).unique().min(1).max(7).label("Los días de atención")
    .messages({
        "array.min": "Elige al menos un día de atención",
        "array.unique": "Hay días repetidos",
        "number.base": "Alguno de los días no es válido", "number.integer": "Alguno de los días no es válido",
        "number.min": "Alguno de los días no es válido", "number.max": "Alguno de los días no es válido",
    });

// Modalidad de disponibilidad: por días de la semana o por fechas puntuales (una u otra, no ambas).
const tipoDisponibilidad = Joi.string().valid("semanal", "fechas").label("La modalidad de atención")
    .messages({ "any.only": "La modalidad de atención debe ser «semanal» o «fechas»" });

// Fechas puntuales de atención ("YYYY-MM-DD", reales y sin repetir). Puede ir vacía si la modalidad es semanal.
const fechasDisponibles = Joi.array()
    .items(Joi.string().custom((valor, helpers) => (esFechaValida(valor) ? valor : helpers.error("fecha.invalida"))))
    .unique().max(366).label("Las fechas de atención")
    .messages({
        "fecha.invalida": "Alguna de las fechas de atención no es válida",
        "string.base": "Alguna de las fechas de atención no es válida",
        "array.unique": "Hay fechas repetidas",
        "array.max": "Se pueden cargar hasta 366 fechas de atención",
    });

export const agregarEspecialistaSchema = Joi.object({
    nombre: nombre.required(),
    rol: rol.default("Medico"),
    diasDisponibles,
    tipoDisponibilidad,
    fechasDisponibles,
    serviciosIds,
});

export const actualizarEspecialistaSchema = Joi.object({
    nombre,
    rol,
    diasDisponibles,
    tipoDisponibilidad,
    fechasDisponibles,
    serviciosIds,
}).min(1).messages({ "object.min": "No hay cambios para guardar" });
