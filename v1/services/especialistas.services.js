import Especialista from "../models/especialista.model.js";
import Servicio from "../models/servicio.model.js";
import { crearError } from "../utils/http-error.util.js";
import { ahoraNegocio, modoDisponibilidad, fechasDeAtencion } from "../utils/horarios.util.js";
import { esObjectIdValido } from "../utils/id.util.js";
import { subirImagenService } from "./uploads.service.js";
import { contarReservasFuturasActivas, contarReservasFueraDeDias } from "./reservas.services.js";
import { asignarServiciosAEspecialistaService } from "./servicios.services.js";

const validarId = (id) => {
    if (!esObjectIdValido(id)) {
        throw crearError(400, "El id no es válido");
    }
};

const escapar = (texto) => texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Fechas puntuales de atención: sin repetir, ordenadas y SIN las que ya pasaron (no sirven para reservar).
const limpiarFechas = (fechas) => [...new Set(fechas)].filter((f) => f >= ahoraNegocio().fecha).sort();

const errorSinFechas = () => crearError(400, "Elige al menos una fecha de atención en el calendario (o cambia a «Días de la semana»)");

const existeNombre = async (nombre, excluirId) => {
    const filtro = { nombre: new RegExp(`^${escapar(nombre.trim())}$`, "i") };
    if (excluirId) filtro._id = { $ne: excluirId };
    return Especialista.exists(filtro);
};

// Incluye en cada especialista los servicios que tiene a cargo (lado inverso de la relación).
// El público solo ve las consultas activas (lo único que puede reservar); administración ve todos los servicios.
const conServicios = (consulta, incluirInactivos) =>
    consulta.populate({ path: "servicios", select: "nombre activo porcentaje", match: incluirInactivos ? {} : { activo: true, porcentaje: false } });

export const obtenerEspecialistasService = async ({ incluirInactivos = false } = {}) => {
    return conServicios(Especialista.find().sort({ nombre: 1 }), incluirInactivos);
};

export const obtenerEspecialistaPorIdService = async (id, { incluirInactivos = true } = {}) => {
    validarId(id);

    const especialista = await conServicios(Especialista.findById(id), incluirInactivos);

    if (!especialista) {
        throw crearError(404, "No se encontró el especialista");
    }

    return especialista;
};

export const guardarEspecialistaService = async ({ nombre, rol, duracionConsultaMinutos, diasDisponibles, tipoDisponibilidad = "semanal", fechasDisponibles, serviciosIds }) => {
    nombre = nombre.trim();

    // Una sola modalidad a la vez: con "fechas" tiene que haber al menos una fecha que todavía no haya pasado.
    const fechas = limpiarFechas(fechasDisponibles ?? []);
    if (tipoDisponibilidad === "fechas" && !fechas.length) throw errorSinFechas();

    if (await existeNombre(nombre)) {
        throw crearError(409, "Ya existe un especialista con ese nombre");
    }

    const especialista = await Especialista.create({
        nombre, rol, tipoDisponibilidad, fechasDisponibles: fechas,
        ...(duracionConsultaMinutos ? { duracionConsultaMinutos } : {}),
        ...(diasDisponibles ? { diasDisponibles: [...diasDisponibles].sort((a, b) => a - b) } : {}),
    });

    if (serviciosIds?.length) {
        try {
            await asignarServiciosAEspecialistaService(especialista._id, serviciosIds);
        } catch (error) {
            // No dejar un alta a medias si la asignación de servicios no fue posible.
            await Especialista.deleteOne({ _id: especialista._id });
            throw error;
        }
    }

    return obtenerEspecialistaPorIdService(especialista._id.toString());
};

export const actualizarEspecialistaService = async (id, cambios) => {
    const especialista = await obtenerEspecialistaPorIdService(id);

    if (cambios.nombre !== undefined) {
        const nombre = cambios.nombre.trim();
        if (nombre !== especialista.nombre && await existeNombre(nombre, especialista._id)) {
            throw crearError(409, "Ya existe un especialista con ese nombre");
        }
        especialista.nombre = nombre;
    }

    if (cambios.rol !== undefined) especialista.rol = cambios.rol;

    // Duración de sus consultas (30 o 60 min). Las reservas ya tomadas conservan su duración; solo cambian los horarios nuevos.
    if (cambios.duracionConsultaMinutos !== undefined) especialista.duracionConsultaMinutos = cambios.duracionConsultaMinutos;

    if (cambios.diasDisponibles !== undefined) {
        especialista.diasDisponibles = [...cambios.diasDisponibles].sort((a, b) => a - b);
    }

    // Modalidad de atención: por días de la semana O por fechas puntuales. Lo cargado en la modalidad que no está activa
    // se conserva (por si se vuelve a ella) pero no se aplica.
    if (cambios.tipoDisponibilidad !== undefined) especialista.tipoDisponibilidad = cambios.tipoDisponibilidad;
    if (cambios.fechasDisponibles !== undefined) especialista.fechasDisponibles = limpiarFechas(cambios.fechasDisponibles);
    if (modoDisponibilidad(especialista) === "fechas" && !limpiarFechas(fechasDeAtencion(especialista)).length) {
        throw errorSinFechas();
    }

    // La asignación se valida completa antes de guardar nada.
    if (cambios.serviciosIds !== undefined) {
        await asignarServiciosAEspecialistaService(especialista._id, cambios.serviciosIds);
    }

    await especialista.save();

    // Los nombres se copian en las reservas nuevas; las anteriores conservan el nombre con el que se hicieron.
    const actualizado = await obtenerEspecialistaPorIdService(id);

    // Cambiar los días NO cancela nada: las reservas ya hechas se respetan. Pero se avisa cuántas quedaron en un día
    // que ya no atiende, para que el administrador las reprograme.
    const cambioDisponibilidad = ["diasDisponibles", "tipoDisponibilidad", "fechasDisponibles"].some((c) => cambios[c] !== undefined);
    const reservasFueraDeDia = cambioDisponibilidad
        ? await contarReservasFueraDeDias(actualizado._id, actualizado)
        : 0;

    return { especialista: actualizado, reservasFueraDeDia };
};

// Un especialista a cargo de servicios SÍ se puede eliminar: esos servicios quedan "Sin asignar".
// Lo que lo impide son los turnos futuros reservados con él (esos clientes quedarían sin profesional).
export const eliminarEspecialistaService = async (id) => {
    const especialista = await obtenerEspecialistaPorIdService(id);

    const futuras = await contarReservasFuturasActivas({ especialistaId: especialista._id });

    if (futuras > 0) {
        throw crearError(409, `No se puede eliminar a ${especialista.nombre}: tiene ${futuras} reserva(s) futura(s). Cancélalas o reprográmalas primero.`);
    }

    const servicios = await Servicio.find({ especialistaId: especialista._id }).select("nombre");

    await Servicio.updateMany({ especialistaId: especialista._id }, { $set: { especialistaId: null } });
    await Especialista.deleteOne({ _id: especialista._id });

    return { especialista, serviciosSinAsignar: servicios.map((s) => s.nombre) };
};

export const subirImagenPerfilService = async (especialistaId, archivo) => {
    if (!archivo) {
        throw crearError(400, "No se subió ningún archivo");
    }

    const especialista = await obtenerEspecialistaPorIdService(especialistaId);

    const resultado = await subirImagenService(archivo.buffer, "especialistas");

    especialista.imagenPerfil = resultado.secure_url;

    await especialista.save();

    return especialista;
};
