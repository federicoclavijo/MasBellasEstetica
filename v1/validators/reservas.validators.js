import Joi from "joi";
import { NEGOCIO } from "../config/negocio.config.js";
import { esFechaValida, ahoraNegocio } from "../utils/horarios.util.js";
import { normalizarTelefonoUY } from "../utils/telefono.util.js";

const id = (etiqueta) => Joi.string().hex().length(24).label(etiqueta)
    .messages({ "string.hex": "{#label} no es válido", "string.length": "{#label} no es válido" });

const fecha = (etiqueta) => Joi.string().label(etiqueta).custom((valor, helpers) =>
    esFechaValida(valor) ? valor : helpers.error("fecha.invalida"))
    .messages({ "fecha.invalida": "{#label} debe ser una fecha real con formato AAAA-MM-DD" });

const hora = Joi.string().label("La hora").pattern(/^([01]\d|2[0-3]):[0-5]\d$/)
    .messages({ "string.pattern.base": "La hora debe tener formato HH:MM" });

const fechaNacimiento = fecha("La fecha de nacimiento").custom((valor, helpers) => {
    const hoy = ahoraNegocio().fecha;
    if (valor > hoy) return helpers.error("nacimiento.futuro");

    const masAntigua = `${Number(hoy.slice(0, 4)) - NEGOCIO.edadMaximaAnios}${hoy.slice(4)}`;
    if (valor < masAntigua) return helpers.error("nacimiento.antigua");

    return valor;
}).messages({
    "nacimiento.futuro": "La fecha de nacimiento no puede ser futura",
    "nacimiento.antigua": "La fecha de nacimiento no es válida",
});

const cedula = Joi.string().trim().label("La cédula").custom((valor, helpers) => {
    const limpia = valor.replace(/[.\-\s]/g, "");
    return /^\d{6,9}$/.test(limpia) ? limpia : helpers.error("cedula.invalida");
}).messages({ "cedula.invalida": "La cédula debe tener entre 6 y 9 dígitos" });

// Celular uruguayo (admite 099 123 456, 99123456, +598 99 123 456...). Se guarda normalizado: +59899123456.
const telefono = Joi.string().trim().label("El teléfono").custom((valor, helpers) =>
    normalizarTelefonoUY(valor) ?? helpers.error("telefono.invalido"))
    .messages({ "telefono.invalido": "Ingresa un celular uruguayo válido (por ejemplo 099 123 456)" });

// Consulta reservada por el cliente en la web.
export const agregarReservaSchema = Joi.object({
    nombre: Joi.string().trim().min(3).max(80).required().label("El nombre"),
    cedula: cedula.required(),
    email: Joi.string().trim().lowercase().max(120).email({ tlds: { allow: false } }).required().label("El correo electrónico"),
    telefono: telefono.required(),
    fechaNacimiento: fechaNacimiento.required(),
    servicioId: id("El servicio").required(),
    fecha: fecha("La fecha").required(),
    hora: hora.required(),
});

// Tratamiento dado de alta por el administrador: el importe lo define él para cada cliente.
export const crearReservaAdminSchema = Joi.object({
    nombre: Joi.string().trim().min(3).max(80).required().label("El nombre"),
    telefono: telefono.required(),
    email: Joi.string().trim().lowercase().max(120).email({ tlds: { allow: false } }).required().label("El correo electrónico"),
    cedula: cedula.empty("").optional(),
    fechaNacimiento: fechaNacimiento.empty("").optional(),
    servicioId: id("El tratamiento").required(),
    fecha: fecha("La fecha").required(),
    hora: hora.required(),
    precio: Joi.number().min(1).max(1000000).precision(2).required().label("El precio del tratamiento"),
});

// Reprogramar una reserva: solo fecha y/u hora.
export const modificarReservaSchema = Joi.object({
    fecha: fecha("La fecha"),
    hora,
}).or("fecha", "hora").messages({ "object.missing": "Indica la nueva fecha u hora" });

// Constancia de asistencia: "asistio", "no_asistio" o null para quitar la marca.
export const marcarAsistenciaSchema = Joi.object({
    asistencia: Joi.string().valid("asistio", "no_asistio").allow(null).required().label("La asistencia")
        .messages({ "any.only": "La asistencia debe ser «asistio», «no_asistio» o null" }),
});
