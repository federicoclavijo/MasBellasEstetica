// Reglas de negocio centralizadas. Si cambia una regla (seña, precio de la consulta,
// horario de atención...), se cambia aquí y en ningún otro lugar.

const entero = (valor, porDefecto) => {
    const n = Number.parseInt(valor, 10);
    return Number.isFinite(n) && n > 0 ? n : porDefecto;
};

export const NEGOCIO = Object.freeze({
    // Zona horaria del local. El servidor (p. ej. Vercel) corre en UTC, por eso
    // "hoy" y "ahora" se calculan siempre en esta zona y no con la del servidor.
    zonaHoraria: process.env.NEGOCIO_ZONA_HORARIA || "America/Montevideo",

    // Horario de atención: el último turno debe TERMINAR a las "fin".
    horario: Object.freeze({ inicio: "08:00", fin: "20:00" }),

    // Días de la semana en que atiende un especialista cuando no se le configuró otra cosa (0 = domingo … 6 = sábado).
    // Cada especialista tiene sus propios días (se editan en el panel); aquí solo está el valor inicial: lunes a sábado.
    diasPorDefecto: Object.freeze([1, 2, 3, 4, 5, 6]),

    // Servicios convencionales: seña del 50 % y turnos de 1 hora.
    senaPorcentaje: 50,
    duracionEstandarMinutos: 60,

    // Servicio de consulta: valor fijo (se cobra completo) y turnos cada media hora.
    consulta: Object.freeze({ precio: 500, duracionMinutos: 30 }),

    // Tiempo que se retiene el horario mientras el cliente paga en Mercado Pago (consulta reservada por la web).
    reservaTtlMinutos: entero(process.env.RESERVA_TTL_MINUTOS, 15),

    // Reservas de TRATAMIENTO dadas de alta por el administrador: el enlace de pago se envía por WhatsApp y el
    // cliente puede tardar en pagar (o pagar por transferencia), por eso el horario se retiene más tiempo.
    adminReservaTtlDias: entero(process.env.RESERVA_ADMIN_TTL_DIAS, 2),

    // Datos que se incluyen en el mensaje de WhatsApp. La cuenta BROU se cambia con BROU_CUENTA en el .env.
    get brouCuenta() { return (process.env.BROU_CUENTA || "").trim(); },
    get brouTitular() { return (process.env.BROU_TITULAR || "").trim(); },
    nombreComercial: "+Bellas",
    // Datos de contacto que se muestran en el correo de confirmación (opcionales).
    get direccion() { return (process.env.NEGOCIO_DIRECCION || "").trim(); },
    get telefonoContacto() { return (process.env.NEGOCIO_TELEFONO || "").trim(); },

    // Cuántos días hacia adelante se puede reservar.
    maxDiasAnticipacion: entero(process.env.RESERVA_MAX_DIAS, 365),

    // Porcentaje de la seña que se devuelve al reembolsar (ver porcentajeReembolsoConfigurado).
    get reembolsoPorcentaje() { return porcentajeReembolsoConfigurado(); },

    // Edad máxima razonable para validar la fecha de nacimiento.
    edadMaximaAnios: 120,
});

// Porcentaje de la seña que se devuelve al reembolsar (1 a 100). Se cambia con la variable de entorno
// REEMBOLSO_PORCENTAJE (p. ej. 50 para devolver la mitad); si falta o es inválida, se devuelve el 100 %.
export const porcentajeReembolsoConfigurado = (valor = process.env.REEMBOLSO_PORCENTAJE) => {
    const n = Number(valor);
    return Number.isFinite(n) && n >= 1 && n <= 100 ? Math.round(n * 100) / 100 : 100;
};

// Estados en los que una reserva ocupa (o puede ocupar) el horario del especialista.
export const ESTADOS_ACTIVOS = Object.freeze(["pendiente_pago", "confirmada"]);
