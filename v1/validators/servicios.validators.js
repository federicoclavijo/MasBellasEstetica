import Joi from "joi";

const nombre = Joi.string().trim().min(3).max(60).label("El nombre");
// En las consultas el precio lo fija el sistema ($500); en los tratamientos es solo una referencia opcional.
const precio = Joi.number().min(1).max(1000000).precision(2).allow(null).label("El precio");
// null = dejar el servicio "Sin asignar".
const especialistaId = Joi.string().hex().length(24).allow(null).label("El especialista")
    .messages({ "string.hex": "{#label} no es válido", "string.length": "{#label} no es válido" });

export const agregarServicioSchema = Joi.object({
    nombre: nombre.required(),
    esConsulta: Joi.boolean().default(false).label("El tipo de servicio"),
    precio,
    activo: Joi.boolean().default(true).label("El estado"),
    especialistaId: especialistaId.default(null),
});

export const modificarServicioSchema = Joi.object({
    nombre,
    esConsulta: Joi.boolean().label("El tipo de servicio"),
    precio,
    activo: Joi.boolean().label("El estado"),
    especialistaId,
}).min(1).messages({ "object.min": "No hay cambios para guardar" });
