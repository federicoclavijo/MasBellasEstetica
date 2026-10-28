import Usuario from "../models/usuario.model.js";

const aFecha = (fechaNacimiento) => (fechaNacimiento ? new Date(`${fechaNacimiento}T00:00:00.000Z`) : null);
const escapar = (texto) => texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Crea el cliente la primera vez y lo reutiliza después (se identifica por correo).
// Si el correo ya existe NO se pisan sus datos (el formulario público permite escribir cualquier correo):
// solo se completan los que le faltaban (teléfono, cédula, fecha de nacimiento).
export const registrarClienteService = async ({ nombre, email, telefono = null, cedula = null, fechaNacimiento = null }) => {
    const correo = email.trim().toLowerCase();

    const completar = async (usuario) => {
        const faltantes = {};
        if (!usuario.telefono && telefono) faltantes.telefono = telefono;
        if (!usuario.cedula && cedula) faltantes.cedula = cedula;
        if (!usuario.fechaNacimiento && fechaNacimiento) faltantes.fechaNacimiento = aFecha(fechaNacimiento);
        if (Object.keys(faltantes).length) {
            await Usuario.updateOne({ _id: usuario._id }, { $set: faltantes });
            Object.assign(usuario, faltantes);
        }
        return usuario;
    };

    const existente = await Usuario.findOne({ email: correo });
    if (existente) return completar(existente);

    try {
        return await Usuario.create({
            nombre: nombre.trim(),
            email: correo,
            telefono,
            cedula,
            fechaNacimiento: aFecha(fechaNacimiento)
        });
    } catch (error) {
        // Dos reservas simultáneas con el mismo correo: gana una y la otra reutiliza el documento.
        if (error?.code === 11000) {
            const creado = await Usuario.findOne({ email: correo });
            if (creado) return completar(creado);
        }
        throw error;
    }
};

export const obtenerUsuarioPorEmailService = async (email) =>
    Usuario.findOne({ email: email.trim().toLowerCase() });

// Búsqueda para que el administrador autocomplete los datos de un cliente que ya consultó.
export const buscarClientesService = async (texto) => {
    const q = String(texto ?? "").trim();
    if (q.length < 2) return [];

    const patron = new RegExp(escapar(q), "i");
    const digitos = q.replace(/\D/g, "");
    const filtros = [{ nombre: patron }, { email: patron }];
    if (digitos.length >= 3) filtros.push({ telefono: new RegExp(escapar(digitos)) }, { cedula: new RegExp(escapar(digitos)) });

    return Usuario.find({ $or: filtros }).sort({ nombre: 1 }).limit(8)
        .select("nombre email telefono cedula fechaNacimiento");
};
