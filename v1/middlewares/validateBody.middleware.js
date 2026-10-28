// Mensajes de Joi en español. {#label} lo define cada validador con .label(...).
const MENSAJES = {
    "any.required": "{#label} es obligatorio",
    "any.only": "{#label} no tiene un valor permitido",
    "string.base": "{#label} debe ser texto",
    "string.empty": "{#label} no puede estar vacío",
    "string.min": "{#label} debe tener al menos {#limit} caracteres",
    "string.max": "{#label} no puede tener más de {#limit} caracteres",
    "string.email": "{#label} no es válido",
    "number.base": "{#label} debe ser un número",
    "number.min": "{#label} debe ser como mínimo {#limit}",
    "number.max": "{#label} no puede superar {#limit}",
    "number.precision": "{#label} admite como máximo {#limit} decimales",
    "boolean.base": "{#label} debe ser verdadero o falso",
    "object.base": "El cuerpo de la solicitud no es válido",
    "object.unknown": "{#label} no es un campo permitido",
};

export const validateBodyMiddleware = (schema) => (req, res, next) => {
    const { error, value } = schema.validate(req.body ?? {}, {
        abortEarly: false,
        // Descarta campos que el cliente no debería poder enviar (estadoPago, precioTotal, _id...).
        stripUnknown: true,
        messages: MENSAJES,
        errors: { wrap: { label: false } },
    });

    if (error) {
        const mensaje = error.details.map((d) => d.message).join(". ");
        return res.status(400).json({ mensaje });
    }

    // Los controladores usan req.body: queda ya validado y normalizado (recortado, minúsculas...).
    req.body = value;
    next();
};
