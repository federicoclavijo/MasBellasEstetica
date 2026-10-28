import Joi from "joi";

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

export const agregarEspecialistaSchema = Joi.object({
    nombre: nombre.required(),
    rol: rol.default("Medico"),
    diasDisponibles,
    serviciosIds,
});

export const actualizarEspecialistaSchema = Joi.object({
    nombre,
    rol,
    diasDisponibles,
    serviciosIds,
}).min(1).messages({ "object.min": "No hay cambios para guardar" });
