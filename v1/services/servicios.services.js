import Servicio from "../models/servicio.model.js";
import Especialista from "../models/especialista.model.js";
import { crearError } from "../utils/http-error.util.js";
import { esObjectIdValido } from "../utils/id.util.js";
import { precioFinal } from "../utils/cobro.util.js";
import { contarReservasFuturasActivas } from "./reservas.services.js";

// Relación Servicio -> Especialista: un especialista puede tener VARIOS servicios; cada servicio tiene
// como máximo UN especialista (`especialistaId`, null = "Sin asignar"). Ese campo es la fuente única;
// Especialista.servicios es un virtual que la lee en sentido inverso.

const validarId = (id, texto = "El id") => {
    if (!esObjectIdValido(id)) {
        throw crearError(400, `${texto} no es válido`);
    }
};

const escapar = (texto) => texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const errorDuplicado = (esConsulta) => crearError(409, esConsulta ? "Ya existe una consulta con ese nombre" : "Ya existe un tratamiento con ese nombre");

// El nombre es único DENTRO de cada tipo: una consulta y un tratamiento pueden llamarse igual,
// pero no puede haber 2 consultas ni 2 tratamientos con el mismo nombre.
const existeNombre = async (nombre, esConsulta, excluirId) => {
    const filtro = { nombre: new RegExp(`^${escapar(nombre.trim())}$`, "i"), porcentaje: !esConsulta };
    if (excluirId) filtro._id = { $ne: excluirId };
    return Servicio.exists(filtro);
};

const obtenerEspecialistaExistente = async (especialistaId) => {
    validarId(especialistaId, "El ID del especialista");

    const especialista = await Especialista.findById(especialistaId);

    if (!especialista) {
        throw crearError(404, "No se encontró el especialista");
    }

    return especialista;
};

// Cambiar quién atiende un servicio con turnos futuros reservados dejaría a esos clientes con otro profesional.
const exigirSinReservasFuturas = async (servicio, accion, sugerencia = "") => {
    const futuras = await contarReservasFuturasActivas({ servicioId: servicio._id });
    if (futuras > 0) {
        throw crearError(409, `No se puede ${accion} «${servicio.nombre}»: tiene ${futuras} reserva(s) futura(s). Cancélalas o reprográmalas primero.${sugerencia}`);
    }
};

// Público: solo las CONSULTAS activas (lo único que el cliente puede reservar en la web).
// Administración (incluirInactivos): todos los servicios, tratamientos incluidos.
export const obtenerServiciosService = async ({ incluirInactivos = false } = {}) => {
    const filtro = incluirInactivos ? {} : { activo: true, porcentaje: false };
    return Servicio.find(filtro).sort({ nombre: 1 });
};

export const obtenerServicioPorIdService = async (id) => {
    validarId(id);

    const servicio = await Servicio.findById(id);

    if (!servicio) {
        throw crearError(404, "No se encontró un servicio con ese ID");
    }

    return servicio;
};

export const guardarServicioService = async ({ nombre, precio, activo = true, esConsulta = false, especialistaId = null }) => {
    nombre = nombre.trim();

    if (await existeNombre(nombre, esConsulta)) {
        throw errorDuplicado(esConsulta);
    }

    const especialista = especialistaId ? await obtenerEspecialistaExistente(especialistaId) : null;

    return Servicio.create({
        nombre,
        precio: precioFinal({ consulta: esConsulta, precio }),
        porcentaje: !esConsulta,
        activo,
        especialistaId: especialista?._id ?? null
    });
};

export const actualizarServicioService = async (id, cambios) => {
    const servicio = await obtenerServicioPorIdService(id);

    const nombre = cambios.nombre?.trim();

    // Tipo: consulta (valor fijo, turnos de 30 min) o tratamiento (seña 50 %, turnos de 60 min).
    const cambiaTipo = cambios.esConsulta !== undefined && cambios.esConsulta !== (servicio.porcentaje === false);

    // La unicidad es por (nombre + tipo): se valida con el nombre y el tipo que quedarían después del cambio.
    // Cambiar un servicio de tipo también cuenta: «Botox» (tratamiento) no puede pasar a consulta si ya hay una «Botox».
    const esConsultaFinal = cambiaTipo ? cambios.esConsulta : servicio.porcentaje === false;
    const cambiaNombre = nombre !== undefined && nombre !== servicio.nombre;
    if ((cambiaNombre || cambiaTipo) && await existeNombre(nombre ?? servicio.nombre, esConsultaFinal, servicio._id)) {
        throw errorDuplicado(esConsultaFinal);
    }

    // Especialista nuevo (null = dejar sin asignar).
    const cambiaEspecialista = cambios.especialistaId !== undefined
        && String(cambios.especialistaId ?? "") !== String(servicio.especialistaId ?? "");

    // Cambiar el tipo altera la grilla de horarios; cambiar el especialista altera quién atiende.
    if (cambiaTipo) await exigirSinReservasFuturas(servicio, "cambiar el tipo del servicio");

    let nuevoEspecialista = null;
    if (cambiaEspecialista) {
        if (servicio.especialistaId) await exigirSinReservasFuturas(servicio, "cambiar el especialista del servicio");
        if (cambios.especialistaId) nuevoEspecialista = await obtenerEspecialistaExistente(cambios.especialistaId);
        servicio.especialistaId = nuevoEspecialista?._id ?? null;
    }

    if (nombre !== undefined) servicio.nombre = nombre;
    if (cambios.activo !== undefined) servicio.activo = cambios.activo;
    if (cambiaTipo) servicio.porcentaje = !cambios.esConsulta;

    servicio.precio = precioFinal({
        consulta: servicio.porcentaje === false,
        precio: cambios.precio !== undefined ? cambios.precio : servicio.precio
    });

    await servicio.save();

    return servicio;
};

// Lado "especialista" de la relación: deja a `especialistaId` a cargo exactamente de `serviciosIds`.
// Los servicios que se agregan se le quitan a su especialista anterior; los que se omiten quedan "Sin asignar".
// Se validan todos los cambios antes de aplicar ninguno.
export const asignarServiciosAEspecialistaService = async (especialistaId, serviciosIds) => {
    const objetivo = [...new Set(serviciosIds.map(String))];

    const elegidos = await Servicio.find({ _id: { $in: objetivo } });
    if (elegidos.length !== objetivo.length) {
        throw crearError(404, "Alguno de los servicios elegidos no existe");
    }

    const actuales = await Servicio.find({ especialistaId });
    const agregar = elegidos.filter((s) => String(s.especialistaId ?? "") !== String(especialistaId));
    const quitar = actuales.filter((s) => !objetivo.includes(String(s._id)));

    // Solo importa si el servicio ya tenía a alguien a cargo (un servicio sin asignar no tiene turnos).
    for (const servicio of [...agregar.filter((s) => s.especialistaId), ...quitar]) {
        await exigirSinReservasFuturas(servicio, "cambiar el especialista del servicio");
    }

    if (agregar.length) {
        await Servicio.updateMany({ _id: { $in: agregar.map((s) => s._id) } }, { $set: { especialistaId } });
    }
    if (quitar.length) {
        await Servicio.updateMany({ _id: { $in: quitar.map((s) => s._id) } }, { $set: { especialistaId: null } });
    }
};

export const eliminarServicioService = async (id) => {
    const servicio = await obtenerServicioPorIdService(id);

    await exigirSinReservasFuturas(servicio, "eliminar el servicio", " Si solo quieres que no reciba nuevas reservas, desactívalo.");

    await Servicio.deleteOne({ _id: servicio._id });

    return servicio;
};
