import Reserva from "../models/reserva.model.js";
import Servicio from "../models/servicio.model.js";
import Especialista from "../models/especialista.model.js";
import { NEGOCIO, ESTADOS_ACTIVOS } from "../config/negocio.config.js";
import { crearError } from "../utils/http-error.util.js";
import { esObjectIdValido } from "../utils/id.util.js";
import {
    ahoraNegocio, esFechaValida, esHoraValida, generarFranjas,
    franjaYaPaso, hayCruce, sumarDias, diaSemana, diasDeAtencion, atiendeEseDia, mensajeDiaNoAtendido
} from "../utils/horarios.util.js";
import { calcularCobro, calcularCobroTratamiento, duracionDe, calcularReembolso, esConsulta } from "../utils/cobro.util.js";
import { construirMensajeWhatsApp, urlWhatsApp } from "../utils/whatsapp.util.js";
import { crearOrden, cancelarOrden, obtenerOrden, reembolsarOrden } from "./mercadoPago.services.js";
import { sincronizarPagoDeReserva } from "./pagos.services.js";
import { registrarClienteService } from "./usuarios.services.js";
import { notificarConfirmacion } from "./mail.services.js";

const validarId = (id, texto = "El id") => {
    if (!esObjectIdValido(id)) {
        throw crearError(400, `${texto} no es válido`);
    }
};

const esActiva = (reserva) => ESTADOS_ACTIVOS.includes(reserva.estadoReserva);
const duracionDeReserva = (reserva) => reserva.duracionMinutos ?? 60;

// --- Reglas de horario -----------------------------------------------------------------

// El especialista debe atender ese día de la semana, el horario debe existir en la grilla del servicio,
// no haber empezado ya y estar dentro del plazo permitido.
const validarTurno = ({ fecha, hora, duracion, especialista }) => {
    if (!esFechaValida(fecha)) {
        throw crearError(400, "La fecha debe tener formato YYYY-MM-DD y ser una fecha real");
    }

    if (!atiendeEseDia(especialista, fecha)) {
        throw crearError(400, mensajeDiaNoAtendido(especialista, fecha));
    }

    if (!esHoraValida(hora) || !generarFranjas(duracion).includes(hora)) {
        throw crearError(400, "El horario seleccionado no es válido para este servicio");
    }

    const ahora = ahoraNegocio();

    if (franjaYaPaso(fecha, hora, ahora)) {
        throw crearError(400, "No se puede reservar en un horario que ya pasó");
    }

    if (fecha > sumarDias(ahora.fecha, NEGOCIO.maxDiasAnticipacion)) {
        throw crearError(400, `Solo se puede reservar con hasta ${NEGOCIO.maxDiasAnticipacion} días de anticipación`);
    }
};

const reservasQueOcupan = (especialistaId, fecha, excluirReservaId) => {
    const filtro = { especialistaId, fecha, estadoReserva: { $in: ESTADOS_ACTIVOS } };
    if (excluirReservaId) filtro._id = { $ne: excluirReservaId };
    return Reserva.find(filtro).select("hora duracionMinutos").lean();
};

const chocaConAlguna = (hora, duracion, existentes) =>
    existentes.some((r) => hayCruce(hora, duracion, r.hora, r.duracionMinutos ?? 60));

const verificarDisponibilidad = async ({ especialistaId, fecha, hora, duracion, excluirReservaId }) => {
    const existentes = await reservasQueOcupan(especialistaId, fecha, excluirReservaId);

    if (chocaConAlguna(hora, duracion, existentes)) {
        throw crearError(409, "Ese horario ya no está disponible. Selecciona otro.");
    }
};

const calcularDisponibilidad = async ({ especialistaId, fecha, duracion, excluirReservaId }) => {
    const existentes = await reservasQueOcupan(especialistaId, fecha, excluirReservaId);
    const ahora = ahoraNegocio();
    const franjas = generarFranjas(duracion);

    return {
        horariosDisponibles: franjas.filter(
            (h) => !franjaYaPaso(fecha, h, ahora) && !chocaConAlguna(h, duracion, existentes)
        ),
        horariosOcupados: franjas.filter((h) => chocaConAlguna(h, duracion, existentes)),
    };
};

// Horarios de un día para un especialista. Si ese día de la semana no atiende, no hay horarios y se explica por qué
// (la fecha es válida, simplemente no es un día de atención): así los formularios de clientes y de administración
// muestran el mismo mensaje y los mismos días.
const disponibilidadDelDia = async ({ especialista, especialistaId, fecha, duracion, excluirReservaId }) => {
    const base = {
        especialistaNombre: especialista?.nombre ?? null,
        diasDisponibles: diasDeAtencion(especialista),
    };

    if (!atiendeEseDia(especialista, fecha)) {
        return { ...base, atiendeEseDia: false, mensaje: mensajeDiaNoAtendido(especialista, fecha), horariosDisponibles: [], horariosOcupados: [] };
    }

    await expirarReservasPendientesService({ especialistaId, fecha });
    return { ...base, atiendeEseDia: true, ...(await calcularDisponibilidad({ especialistaId, fecha, duracion, excluirReservaId })) };
};

// --- Vencimiento de reservas pendientes ------------------------------------------------------

// Libera una reserva pendiente cuyo plazo de pago venció. Antes consulta a Mercado Pago: si el pago ya
// se acreditó la reserva se confirma; si Mercado Pago no responde NO se libera (no hay certeza).
export const expirarReservasPendientesService = async (filtro = {}) => {
    const vencidas = await Reserva.find({
        ...filtro,
        estadoReserva: "pendiente_pago",
        fechaExpiracion: { $lte: new Date() }
    });

    for (const reserva of vencidas) {
        try {
            if (reserva.mercadoPagoOrderId) {
                const { reserva: actual } = await sincronizarPagoDeReserva(reserva);
                if (!actual || actual.estadoReserva !== "pendiente_pago") continue;
            }

            const expirada = await Reserva.findOneAndUpdate(
                { _id: reserva._id, estadoReserva: "pendiente_pago", fechaExpiracion: { $lte: new Date() } },
                { $set: { estadoReserva: "expirada" } },
                { returnDocument: "after" }
            );

            // Se cancela también la orden para que nadie pueda pagar una reserva ya liberada.
            if (expirada?.mercadoPagoOrderId) {
                cancelarOrden(expirada.mercadoPagoOrderId).catch((e) =>
                    console.error(`No se pudo cancelar la orden de ${expirada._id}:`, e.message));
            }
        } catch (error) {
            console.error(`No se pudo verificar la reserva ${reserva._id}:`, error.message);
        }
    }
};

// Cantidad de reservas activas cuyo turno todavía no empezó (sirve para bloquear bajas y cambios).
export const contarReservasFuturasActivas = async (filtro) => {
    await expirarReservasPendientesService(filtro);

    const ahora = ahoraNegocio();
    const candidatas = await Reserva.find({
        ...filtro,
        estadoReserva: { $in: ESTADOS_ACTIVOS },
        fecha: { $gte: ahora.fecha }
    }).select("fecha hora").lean();

    return candidatas.filter((r) => !franjaYaPaso(r.fecha, r.hora, ahora)).length;
};

// Reservas futuras activas de un especialista que caen en un día de la semana que ya no atiende.
// Sirve para avisar al cambiar sus días de atención (las reservas existentes no se tocan).
export const contarReservasFueraDeDias = async (especialistaId, dias) => {
    const ahora = ahoraNegocio();
    const candidatas = await Reserva.find({
        especialistaId,
        estadoReserva: { $in: ESTADOS_ACTIVOS },
        fecha: { $gte: ahora.fecha }
    }).select("fecha hora").lean();

    return candidatas.filter((r) => !dias.includes(diaSemana(r.fecha)) && !franjaYaPaso(r.fecha, r.hora, ahora)).length;
};

// --- Cierre de reservas ---------------------------------------------------------------------------

// Cancela una reserva activa. Si estaba pendiente de pago, primero verifica que el pago no se haya
// acreditado justo ahora y, si sigue sin pagarse, también cancela la orden de Mercado Pago.
const cancelarReserva = async (reserva) => {
    if (reserva.estadoReserva === "pendiente_pago" && reserva.mercadoPagoOrderId) {
        try {
            await sincronizarPagoDeReserva(reserva);
        } catch (error) {
            console.error(`No se pudo consultar el pago de ${reserva._id}:`, error.message);
        }
    }

    const cancelada = await Reserva.findOneAndUpdate(
        { _id: reserva._id, estadoReserva: { $in: ESTADOS_ACTIVOS } },
        { $set: { estadoReserva: "cancelada" } },
        { returnDocument: "after" }
    );

    if (cancelada && cancelada.estadoPago !== "aprobado" && cancelada.mercadoPagoOrderId) {
        try {
            await cancelarOrden(cancelada.mercadoPagoOrderId);
        } catch (error) {
            console.error(`No se pudo cancelar la orden de ${cancelada._id}:`, error.message);
        }
    }

    return cancelada;
};

// Un cliente solo mantiene una consulta pendiente de pago: si vuelve a reservar (reintento tras un pago
// rechazado, otro horario, doble clic...) la anterior se cancela y libera su horario.
const cancelarPendientesDelCliente = async (email) => {
    // Solo las reservadas por la web: un tratamiento dado de alta por el administrador no se toca.
    const pendientes = await Reserva.find({ email, estadoReserva: "pendiente_pago", origen: { $ne: "admin" } });
    for (const reserva of pendientes) {
        await cancelarReserva(reserva);
    }
};

// --- Consultas ---------------------------------------------------------------------------------------

export const obtenerReservasService = async () => {
    return Reserva.find().sort({ fecha: -1, hora: -1 });
};

export const obtenerReservaPorIdService = async (id) => {
    validarId(id);

    const reserva = await Reserva.findById(id);

    if (!reserva) {
        throw crearError(404, "No se encontró la reserva");
    }

    return reserva;
};

// Estado visible para el cliente (resultado.html). Solo datos no sensibles: sin nombre, cédula ni correo.
export const obtenerEstadoPublicoService = async (id) => {
    if (!esObjectIdValido(id)) {
        throw crearError(404, "No se encontró la reserva");
    }

    let reserva = await Reserva.findById(id);

    if (!reserva) {
        throw crearError(404, "No se encontró la reserva");
    }

    if (reserva.estadoReserva === "pendiente_pago") {
        // Confirma al instante si el pago ya se acreditó, sin esperar al webhook.
        try {
            const resultado = await sincronizarPagoDeReserva(reserva);
            reserva = resultado.reserva ?? reserva;
        } catch (error) {
            console.error(`No se pudo consultar el pago de ${reserva._id}:`, error.message);
        }
    }

    return {
        reservaId: reserva._id,
        estadoReserva: reserva.estadoReserva,
        estadoPago: reserva.estadoPago,
        fecha: reserva.fecha,
        hora: reserva.hora,
        servicioNombre: reserva.servicioNombre ?? null,
        montoSena: reserva.montoSena,
    };
};

// Horarios libres para reservar un servicio en una fecha (el especialista es el que tiene a cargo el servicio).
export const obtenerDisponibilidadService = async (fecha, servicioId, { admin = false } = {}) => {
    if (!esFechaValida(fecha)) {
        throw crearError(400, "La fecha debe tener formato YYYY-MM-DD y ser una fecha real");
    }

    validarId(servicioId, "El ID del servicio");

    const ahora = ahoraNegocio();

    if (fecha < ahora.fecha) {
        throw crearError(400, "La fecha no puede ser anterior a hoy");
    }

    if (fecha > sumarDias(ahora.fecha, NEGOCIO.maxDiasAnticipacion)) {
        throw crearError(400, `Solo se puede reservar con hasta ${NEGOCIO.maxDiasAnticipacion} días de anticipación`);
    }

    const servicio = await Servicio.findOne({ _id: servicioId, activo: true });

    // El público solo puede consultar horarios de consultas; los tratamientos los agenda el administrador.
    if (!servicio || (!admin && !esConsulta(servicio))) {
        throw crearError(404, "El servicio no existe o no está disponible");
    }

    const especialista = await Especialista.findById(servicio.especialistaId);

    if (!especialista) {
        throw crearError(409, "El servicio no tiene un especialista asignado en este momento");
    }

    const duracion = duracionDe(servicio);

    return {
        fecha,
        servicioId: servicio._id,
        especialistaId: servicio.especialistaId,
        duracionMinutos: duracion,
        ...(await disponibilidadDelDia({ especialista, especialistaId: servicio.especialistaId, fecha, duracion })),
    };
};

// Horarios a los que se puede mover una reserva existente (ella misma no cuenta como ocupación).
export const obtenerDisponibilidadDeReservaService = async (reservaId, fecha) => {
    const reserva = await obtenerReservaPorIdService(reservaId);

    if (!esFechaValida(fecha)) {
        throw crearError(400, "La fecha debe tener formato YYYY-MM-DD y ser una fecha real");
    }

    const duracion = duracionDeReserva(reserva);
    const especialista = await Especialista.findById(reserva.especialistaId);

    return {
        fecha,
        reservaId: reserva._id,
        especialistaId: reserva.especialistaId,
        duracionMinutos: duracion,
        ...(await disponibilidadDelDia({ especialista, especialistaId: reserva.especialistaId, fecha, duracion, excluirReservaId: reserva._id })),
    };
};

// --- Alta ------------------------------------------------------------------------------------------------

export const guardarReservaService = async (nuevaReserva) => {
    const { nombre, cedula, email, telefono, fechaNacimiento, servicioId, fecha, hora } = nuevaReserva;

    // 1. Consulta activa y especialista a cargo. Por la web solo se reservan CONSULTAS (valor fijo).
    const servicio = await Servicio.findOne({ _id: servicioId, activo: true });

    if (!servicio || !esConsulta(servicio)) {
        throw crearError(404, "El servicio no existe o no está disponible");
    }

    const especialista = await Especialista.findById(servicio.especialistaId);

    if (!especialista) {
        throw crearError(409, "El servicio no tiene un especialista asignado en este momento");
    }

    // 2. Horario válido según la duración del servicio (30 min la consulta, 60 min el resto).
    const duracion = duracionDe(servicio);
    validarTurno({ fecha, hora, duracion, especialista });

    // 3. Liberar lo vencido y lo propio pendiente, y comprobar que el horario siga libre.
    await expirarReservasPendientesService({ especialistaId: especialista._id, fecha });
    await cancelarPendientesDelCliente(email);
    await verificarDisponibilidad({ especialistaId: especialista._id, fecha, hora, duracion });

    // 4. Registrar (o reutilizar) al cliente.
    const usuario = await registrarClienteService({ nombre, email, telefono, cedula, fechaNacimiento });

    // 5. Crear la reserva con la seña calculada por el servidor.
    const cobro = calcularCobro(servicio);
    let reserva;

    try {
        reserva = await Reserva.create({
            nombre,
            cedula,
            email,
            telefono,
            origen: "web",
            tipo: "consulta",
            metodoPago: "mercadopago",
            usuarioId: usuario._id,
            servicioId: servicio._id,
            especialistaId: especialista._id,
            servicioNombre: servicio.nombre,
            especialistaNombre: especialista.nombre,
            fecha,
            hora,
            duracionMinutos: duracion,
            precioTotal: cobro.precioTotal,
            porcentajeSena: cobro.porcentajeSena,
            montoSena: cobro.montoSena,
            estadoReserva: "pendiente_pago",
            estadoPago: "pendiente",
            fechaExpiracion: new Date(Date.now() + NEGOCIO.reservaTtlMinutos * 60 * 1000)
        });
    } catch (error) {
        // Otro cliente reservó el mismo horario en el mismo instante (índice único).
        if (error?.code === 11000) {
            throw crearError(409, "Ese horario ya no está disponible. Selecciona otro.");
        }
        throw error;
    }

    // 6. Crear la orden de pago en Mercado Pago.
    try {
        const orden = await crearOrden(reserva);

        reserva.mercadoPagoOrderId = orden.id;
        reserva.checkoutUrl = orden.checkout_url ?? null;
        await reserva.save();

        return {
            reservaId: reserva._id,
            checkoutUrl: orden.checkout_url,
            estado: reserva.estadoReserva
        };
    } catch (error) {
        // Si Mercado Pago rechazó la orden de forma definitiva se libera el horario enseguida.
        // Si la respuesta es incierta (timeout, 5xx) se conserva y vence sola.
        if (error.ordenNoCreada) {
            await Reserva.updateOne(
                { _id: reserva._id, estadoReserva: "pendiente_pago" },
                { $set: { estadoReserva: "cancelada" } }
            );
        }
        throw error;
    }
};

// --- Tratamientos dados de alta por el administrador -----------------------------------------------------------

// "05/11 a las 14:30", en la zona horaria del local.
const formatearVencimiento = (fecha) => {
    const partes = Object.fromEntries(new Intl.DateTimeFormat("es-UY", {
        timeZone: NEGOCIO.zonaHoraria, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(fecha).map((p) => [p.type, p.value]));
    return `${partes.day}/${partes.month} a las ${partes.hour}:${partes.minute}`;
};

const armarWhatsApp = (reserva) => {
    const mensaje = construirMensajeWhatsApp(reserva, {
        checkoutUrl: reserva.checkoutUrl,
        venceEl: reserva.fechaExpiracion ? formatearVencimiento(reserva.fechaExpiracion) : null
    });
    return { telefono: reserva.telefono, mensaje, url: urlWhatsApp(reserva.telefono, mensaje) };
};

// El administrador agenda un tratamiento para un cliente: el precio lo define él, el cliente paga el 50 % como
// seña (Mercado Pago o transferencia BROU) y el resto en el local. Devuelve el enlace de WhatsApp con el mensaje.
export const crearReservaAdminService = async (datos) => {
    const { nombre, telefono, email, cedula = "", fechaNacimiento = null, servicioId, fecha, hora, precio } = datos;

    const servicio = await Servicio.findById(servicioId);

    if (!servicio || esConsulta(servicio)) {
        throw crearError(404, "El tratamiento no existe");
    }
    if (!servicio.activo) {
        throw crearError(409, "El tratamiento está desactivado. Actívalo para poder agendarlo");
    }

    const especialista = await Especialista.findById(servicio.especialistaId);

    if (!especialista) {
        throw crearError(409, "El tratamiento no tiene un especialista asignado. Asígnalo desde Servicios");
    }

    const duracion = duracionDe(servicio);
    validarTurno({ fecha, hora, duracion, especialista });

    await expirarReservasPendientesService({ especialistaId: especialista._id, fecha });
    await verificarDisponibilidad({ especialistaId: especialista._id, fecha, hora, duracion });

    const usuario = await registrarClienteService({ nombre, email, telefono, cedula: cedula || null, fechaNacimiento });
    const cobro = calcularCobroTratamiento(precio);
    let reserva;

    try {
        reserva = await Reserva.create({
            nombre,
            cedula,
            email,
            telefono,
            origen: "admin",
            tipo: "tratamiento",
            metodoPago: "mercadopago",
            usuarioId: usuario._id,
            servicioId: servicio._id,
            especialistaId: especialista._id,
            servicioNombre: servicio.nombre,
            especialistaNombre: especialista.nombre,
            fecha,
            hora,
            duracionMinutos: duracion,
            precioTotal: cobro.precioTotal,
            porcentajeSena: cobro.porcentajeSena,
            montoSena: cobro.montoSena,
            estadoReserva: "pendiente_pago",
            estadoPago: "pendiente",
            fechaExpiracion: new Date(Date.now() + NEGOCIO.adminReservaTtlDias * 24 * 60 * 60 * 1000)
        });
    } catch (error) {
        if (error?.code === 11000) {
            throw crearError(409, "Ese horario ya no está disponible. Selecciona otro.");
        }
        throw error;
    }

    try {
        const orden = await crearOrden(reserva, { expiracionDias: NEGOCIO.adminReservaTtlDias });

        reserva.mercadoPagoOrderId = orden.id;
        reserva.checkoutUrl = orden.checkout_url ?? null;
        await reserva.save();
    } catch (error) {
        if (error.ordenNoCreada) {
            await Reserva.updateOne(
                { _id: reserva._id, estadoReserva: "pendiente_pago" },
                { $set: { estadoReserva: "cancelada" } }
            );
        }
        throw error;
    }

    return {
        reservaId: reserva._id,
        reserva,
        checkoutUrl: reserva.checkoutUrl,
        whatsapp: armarWhatsApp(reserva)
    };
};

// Vuelve a generar el mensaje de WhatsApp de una reserva pendiente (p. ej. para reenviarlo).
export const obtenerWhatsappReservaService = async (id) => {
    const reserva = await obtenerReservaPorIdService(id);

    if (reserva.estadoReserva !== "pendiente_pago") {
        throw crearError(409, "Solo se envía el enlace de pago de reservas pendientes de pago");
    }
    if (reserva.tipo !== "tratamiento") {
        throw crearError(409, "El mensaje de WhatsApp es para tratamientos dados de alta desde administración");
    }
    if (!reserva.telefono) {
        throw crearError(409, "La reserva no tiene un teléfono de contacto");
    }

    return armarWhatsApp(reserva);
};

// La seña pagada por transferencia BROU no se detecta sola: el administrador la confirma al ver el comprobante.
export const confirmarPagoManualService = async (id) => {
    const reserva = await obtenerReservaPorIdService(id);

    if (reserva.estadoReserva !== "pendiente_pago") {
        throw crearError(409, "Solo se puede confirmar el pago de una reserva pendiente de pago");
    }

    // ¿Ya había pagado por Mercado Pago? Entonces no hace falta confirmar nada a mano.
    if (reserva.mercadoPagoOrderId) {
        try {
            const { reserva: actual } = await sincronizarPagoDeReserva(reserva);
            if (actual?.estadoReserva === "confirmada") return actual;
        } catch (error) {
            console.error(`No se pudo consultar el pago de ${reserva._id}:`, error.message);
        }
    }

    const confirmada = await Reserva.findOneAndUpdate(
        { _id: reserva._id, estadoReserva: "pendiente_pago" },
        { $set: { estadoReserva: "confirmada", estadoPago: "aprobado", metodoPago: "transferencia" } },
        { returnDocument: "after" }
    );

    if (!confirmada) {
        throw crearError(409, "La reserva cambió de estado. Actualiza la lista e inténtalo de nuevo");
    }

    // Se anula el enlace de Mercado Pago para que no se pague dos veces.
    if (confirmada.mercadoPagoOrderId) {
        try {
            await cancelarOrden(confirmada.mercadoPagoOrderId);
        } catch (error) {
            console.error(`No se pudo cancelar la orden de ${confirmada._id}:`, error.message);
        }
    }

    // Confirmación por correo al cliente (también cuando el pago fue por transferencia).
    await notificarConfirmacion(confirmada._id);

    return confirmada;
};

// --- Modificación y baja ----------------------------------------------------------------------------------

// Reprogramar: solo fecha y hora de una reserva activa que todavía no empezó.
export const actualizarReservaService = async (id, { fecha, hora }) => {
    const reserva = await obtenerReservaPorIdService(id);

    if (!esActiva(reserva)) {
        throw crearError(409, "Solo se pueden modificar reservas pendientes de pago o confirmadas");
    }

    if (franjaYaPaso(reserva.fecha, reserva.hora)) {
        throw crearError(409, "La reserva ya pasó y no se puede modificar");
    }

    const nuevaFecha = fecha ?? reserva.fecha;
    const nuevaHora = hora ?? reserva.hora;

    if (nuevaFecha === reserva.fecha && nuevaHora === reserva.hora) {
        throw crearError(400, "No hay cambios para guardar");
    }

    const duracion = duracionDeReserva(reserva);
    const especialista = await Especialista.findById(reserva.especialistaId);
    validarTurno({ fecha: nuevaFecha, hora: nuevaHora, duracion, especialista });

    await expirarReservasPendientesService({ especialistaId: reserva.especialistaId, fecha: nuevaFecha });
    await verificarDisponibilidad({
        especialistaId: reserva.especialistaId,
        fecha: nuevaFecha,
        hora: nuevaHora,
        duracion,
        excluirReservaId: reserva._id
    });

    reserva.fecha = nuevaFecha;
    reserva.hora = nuevaHora;

    try {
        await reserva.save();
    } catch (error) {
        if (error?.code === 11000) {
            throw crearError(409, "Ese horario ya no está disponible. Selecciona otro.");
        }
        throw error;
    }

    return reserva;
};

export const cancelarReservaService = async (id) => {
    const reserva = await obtenerReservaPorIdService(id);

    if (!esActiva(reserva)) {
        throw crearError(409, "Solo se pueden cancelar reservas pendientes de pago o confirmadas");
    }

    if (reserva.asistencia === "asistio") {
        throw crearError(409, "El cliente ya figura como asistente: quita la marca de asistencia antes de cancelar");
    }

    const cancelada = await cancelarReserva(reserva);

    if (!cancelada) {
        throw crearError(409, "La reserva cambió de estado. Actualiza la lista e inténtalo de nuevo");
    }

    return cancelada;
};

// Constancia de asistencia: el administrador marca a mano si el cliente asistió. Solo reservas confirmadas
// (pagadas) cuyo turno ya comenzó; `null` quita la marca para corregir un error.
export const marcarAsistenciaService = async (id, asistencia) => {
    const reserva = await obtenerReservaPorIdService(id);

    if (asistencia !== null) {
        if (reserva.estadoReserva !== "confirmada") {
            throw crearError(409, "Solo se registra la asistencia de reservas confirmadas");
        }
        if (!franjaYaPaso(reserva.fecha, reserva.hora)) {
            throw crearError(409, "El turno todavía no comenzó: la asistencia se registra desde su horario");
        }
    }

    const actualizada = await Reserva.findOneAndUpdate(
        { _id: reserva._id, ...(asistencia !== null ? { estadoReserva: "confirmada" } : {}) },
        { $set: { asistencia, asistenciaMarcadaEn: asistencia ? new Date() : null } },
        { returnDocument: "after" }
    );

    if (!actualizada) {
        throw crearError(409, "La reserva cambió de estado. Actualiza la lista e inténtalo de nuevo");
    }

    return actualizada;
};

// Para devoluciones hechas A MANO en el panel de Mercado Pago: solo deja constancia. (Para devolver desde el sistema: reembolsarReservaService.)
export const marcarReembolsoService = async (id) => {
    await obtenerReservaPorIdService(id);

    const reserva = await Reserva.findOneAndUpdate(
        { _id: id, estadoReserva: { $in: ["cancelada", "expirada"] }, estadoPago: "aprobado" },
        { $set: { estadoPago: "reembolsado", reembolsadoEn: new Date() } },
        { returnDocument: "after" }
    );

    if (!reserva) {
        throw crearError(409, "Solo se puede marcar como reembolsada una reserva cancelada o expirada con pago aprobado");
    }

    return reserva;
};

// --- Reembolso desde el sistema --------------------------------------------------------------------------

const LIMITE_CERROJO_MS = 2 * 60 * 1000;

// Devuelve a la clienta el porcentaje configurado de la seña (REEMBOLSO_PORCENTAJE, 100 % por defecto)
// mediante la API de Mercado Pago, y deja la reserva como «reembolsado».
export const reembolsarReservaService = async (id) => {
    const reserva = await obtenerReservaPorIdService(id);

    if (esActiva(reserva)) {
        throw crearError(409, "Cancela la reserva antes de reembolsarla");
    }
    if (reserva.estadoPago === "reembolsado") {
        throw crearError(409, "Esta reserva ya fue reembolsada");
    }
    if (reserva.estadoPago !== "aprobado") {
        throw crearError(409, "La reserva no tiene un pago aprobado para reembolsar");
    }
    if (reserva.metodoPago === "transferencia") {
        throw crearError(409, "La seña se pagó por transferencia BROU: devuelve el dinero desde tu banco y usa «Marcar reembolso»");
    }
    if (!reserva.mercadoPagoOrderId) {
        throw crearError(409, "La reserva no tiene una orden de Mercado Pago asociada. Si devolviste el dinero a mano, usa «Marcar reembolso»");
    }

    // Cerrojo: un solo reembolso a la vez por reserva (un cerrojo colgado de más de 2 minutos se ignora).
    const bloqueada = await Reserva.findOneAndUpdate(
        {
            _id: reserva._id,
            estadoPago: "aprobado",
            estadoReserva: { $nin: ESTADOS_ACTIVOS },
            $or: [{ reembolsoIniciadoEn: null }, { reembolsoIniciadoEn: { $lt: new Date(Date.now() - LIMITE_CERROJO_MS) } }]
        },
        { $set: { reembolsoIniciadoEn: new Date() } },
        { returnDocument: "after" }
    );

    if (!bloqueada) {
        throw crearError(409, "Ya hay un reembolso en curso para esta reserva, o su estado cambió. Actualiza la lista");
    }

    try {
        return await ejecutarReembolso(bloqueada);
    } finally {
        await Reserva.updateOne({ _id: reserva._id }, { $set: { reembolsoIniciadoEn: null } });
    }
};

const registrarReembolso = (reserva, { monto, porcentaje, reembolsoId }) =>
    Reserva.findOneAndUpdate(
        { _id: reserva._id, estadoPago: "aprobado" },
        { $set: { estadoPago: "reembolsado", montoReembolsado: monto, reembolsoPorcentaje: porcentaje, reembolsoId: reembolsoId ?? null, reembolsadoEn: new Date() } },
        { returnDocument: "after" }
    );

const ejecutarReembolso = async (reserva) => {
    let orden;
    try {
        orden = await obtenerOrden(reserva.mercadoPagoOrderId);
    } catch {
        throw crearError(502, "No se pudo consultar la orden en Mercado Pago. Inténtalo de nuevo en unos minutos");
    }

    // La orden ya figura reembolsada en Mercado Pago (p. ej. se devolvió a mano desde su panel).
    if (orden.status_detail === "refunded") {
        return registrarReembolso(reserva, { monto: null, porcentaje: null, reembolsoId: null });
    }
    if (orden.status_detail === "partially_refunded") {
        throw crearError(409, "La orden ya tiene un reembolso parcial en Mercado Pago. Completa la devolución allí y usa «Marcar reembolso»");
    }
    if (!(orden.status === "processed" && orden.status_detail === "accredited")) {
        throw crearError(409, "Mercado Pago no registra este pago como acreditado, así que no hay nada para reembolsar desde aquí");
    }

    const porcentaje = NEGOCIO.reembolsoPorcentaje;
    const monto = calcularReembolso(reserva.montoSena, porcentaje);
    const total = porcentaje >= 100;

    // Un reembolso parcial necesita el id de la transacción de pago de la orden.
    const transactionId = orden.transactions?.payments?.[0]?.id ?? null;
    if (!total && !transactionId) {
        throw crearError(502, "Mercado Pago no informó la transacción de pago de la orden. Haz el reembolso desde su panel y usa «Marcar reembolso»");
    }

    let respuesta;
    try {
        respuesta = await reembolsarOrden(reserva.mercadoPagoOrderId, {
            transactionId,
            monto: total ? null : monto,
            // Misma reserva + mismo porcentaje = misma clave: repetir el pedido no devuelve dos veces.
            idempotencia: `reembolso-${reserva._id}-${porcentaje}`
        });
    } catch (error) {
        // Si la respuesta se perdió pero el reembolso sí ocurrió, se registra igual en vez de dar error.
        const verificada = await obtenerOrden(reserva.mercadoPagoOrderId).catch(() => null);
        if (verificada?.status_detail === "refunded") {
            return registrarReembolso(reserva, { monto, porcentaje, reembolsoId: null });
        }
        throw error;
    }

    const registrada = await registrarReembolso(reserva, {
        monto, porcentaje, reembolsoId: respuesta?.transactions?.refunds?.[0]?.id
    });

    if (!registrada) {
        console.error(`ATENCIÓN: se reembolsó la orden ${reserva.mercadoPagoOrderId} pero la reserva ${reserva._id} cambió de estado antes de registrarlo.`);
        throw crearError(409, "El reembolso se realizó en Mercado Pago, pero la reserva cambió de estado. Revisa su estado de pago");
    }

    return registrada;
};

export const eliminarReservaService = async (id) => {
    const reserva = await obtenerReservaPorIdService(id);

    if (esActiva(reserva)) {
        throw crearError(409, "Cancela la reserva antes de eliminarla");
    }

    if (reserva.estadoPago === "aprobado") {
        throw crearError(409, "La reserva tiene un pago aprobado. Gestiona la devolución y márcala como reembolsada antes de eliminarla");
    }

    const { deletedCount } = await Reserva.deleteOne({
        _id: reserva._id,
        estadoReserva: { $nin: ESTADOS_ACTIVOS },
        estadoPago: { $ne: "aprobado" }
    });

    if (!deletedCount) {
        throw crearError(409, "La reserva cambió de estado. Actualiza la lista e inténtalo de nuevo");
    }

    return reserva;
};
