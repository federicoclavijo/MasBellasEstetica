import { NEGOCIO } from "../config/negocio.config.js";

const REGEX_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const REGEX_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

export const aMinutos = (hhmm) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
};

export const aHHMM = (minutos) =>
    `${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`;

// "YYYY-MM-DD" y además un día que existe en el calendario (rechaza 2026-02-31).
export const esFechaValida = (fecha) => {
    if (typeof fecha !== "string" || !REGEX_FECHA.test(fecha)) return false;
    const d = new Date(`${fecha}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === fecha;
};

export const esHoraValida = (hora) => typeof hora === "string" && REGEX_HORA.test(hora);

// Fecha y hora actuales en la zona horaria del local.
export const ahoraNegocio = (instante = new Date()) => {
    const partes = new Intl.DateTimeFormat("en-CA", {
        timeZone: NEGOCIO.zonaHoraria,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(instante);
    const v = Object.fromEntries(partes.map((p) => [p.type, p.value]));
    return {
        fecha: `${v.year}-${v.month}-${v.day}`,
        minutos: Number(v.hour) * 60 + Number(v.minute),
    };
};

export const sumarDias = (fecha, dias) => {
    const d = new Date(`${fecha}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
};

// Horas de inicio posibles para un servicio. El paso coincide con la duración:
// 60 min -> 08:00, 09:00 ... 19:00 · 30 min -> 08:00, 08:30 ... 19:30.
export const generarFranjas = (duracionMinutos) => {
    const franjas = [];
    const fin = aMinutos(NEGOCIO.horario.fin);
    for (let t = aMinutos(NEGOCIO.horario.inicio); t + duracionMinutos <= fin; t += duracionMinutos) {
        franjas.push(aHHMM(t));
    }
    return franjas;
};

// ¿El turno que empieza en `fecha` `hora` ya comenzó (o es de un día anterior)?
export const franjaYaPaso = (fecha, hora, ahora = ahoraNegocio()) =>
    fecha < ahora.fecha || (fecha === ahora.fecha && aMinutos(hora) <= ahora.minutos);

// Minutos que faltan desde "ahora" hasta el inicio del turno (negativo si ya empezó). Se calcula con la hora local del negocio.
export const minutosHastaTurno = (fecha, hora, ahora = ahoraNegocio()) => {
    const dias = (Date.parse(`${fecha}T00:00:00.000Z`) - Date.parse(`${ahora.fecha}T00:00:00.000Z`)) / 86_400_000;
    return dias * 1440 + aMinutos(hora) - ahora.minutos;
};

// ¿El turno empieza antes de que se cumpla la antelación mínima (en horas)? Con 0 equivale a "ya empezó".
export const sinAntelacionMinima = (fecha, hora, horasMinimas, ahora = ahoraNegocio()) =>
    minutosHastaTurno(fecha, hora, ahora) < Math.max(horasMinimas * 60, 1);

// ¿Se pisan dos turnos [horaA, horaA+durA) y [horaB, horaB+durB)?
export const hayCruce = (horaA, durA, horaB, durB) => {
    const a = aMinutos(horaA);
    const b = aMinutos(horaB);
    return a < b + durB && b < a + durA;
};

// --- Días de atención de cada especialista -----------------------------------------------------------
// Los días se numeran como en JavaScript: 0 = domingo, 1 = lunes … 6 = sábado.
export const DIAS_SEMANA = Object.freeze(["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"]);

// Día de la semana (0-6) de una fecha "YYYY-MM-DD". Se calcula en UTC para que no dependa de la zona horaria del servidor.
export const diaSemana = (fecha) => new Date(`${fecha}T00:00:00.000Z`).getUTCDay();

// Días configurados de un especialista, ordenados. Los especialistas anteriores a esta función no tienen el campo:
// se les aplican los días por defecto.
export const diasDeAtencion = (especialista) => {
    const dias = especialista?.diasDisponibles;
    return Array.isArray(dias) ? [...new Set(dias)].sort((a, b) => a - b) : [...NEGOCIO.diasPorDefecto];
};

// Modalidad activa: "semanal" (días de la semana) o "fechas" (fechas puntuales). Los especialistas anteriores
// a esta función no tienen el campo y atienden por días de la semana.
export const modoDisponibilidad = (especialista) => (especialista?.tipoDisponibilidad === "fechas" ? "fechas" : "semanal");

// Fechas puntuales cargadas (ordenadas, sin repetir). Solo se aplican si la modalidad activa es "fechas".
export const fechasDeAtencion = (especialista) =>
    Array.isArray(especialista?.fechasDisponibles) ? [...new Set(especialista.fechasDisponibles)].sort() : [];

// ¿Atiende el especialista en esa fecha? Sin especialista no hay restricción que aplicar.
// Solo cuenta la modalidad activa: o el día de la semana, o la fecha puntual (nunca las dos a la vez).
export const atiendeEseDia = (especialista, fecha) => {
    if (!especialista) return true;
    return modoDisponibilidad(especialista) === "fechas"
        ? fechasDeAtencion(especialista).includes(fecha)
        : diasDeAtencion(especialista).includes(diaSemana(fecha));
};

// "2026-11-07" -> "07/11/2026"
export const fechaLegible = (fecha) => `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}/${fecha.slice(0, 4)}`;

// Próximas fechas puntuales (desde `desde`, inclusive). Las pasadas no sirven para reservar.
export const fechasProximas = (especialista, desde = ahoraNegocio().fecha) =>
    fechasDeAtencion(especialista).filter((f) => f >= desde);

// En español lunes a viernes no cambian en plural; sábado y domingo sí.
const plural = (dia) => (dia === 0 || dia === 6 ? `${DIAS_SEMANA[dia]}s` : DIAS_SEMANA[dia]);

// [1, 3, 6] -> "lunes, miércoles y sábados"
export const textoDias = (dias) => {
    const nombres = dias.map(plural);
    return nombres.length > 1 ? `${nombres.slice(0, -1).join(", ")} y ${nombres.at(-1)}` : (nombres[0] ?? "ningún día");
};

// Descripción corta de cuándo atiende: "los lunes y sábados" o "solo en fechas puntuales (07/11, 21/11…)".
export const descripcionDisponibilidad = (especialista, desde = ahoraNegocio().fecha) => {
    if (modoDisponibilidad(especialista) === "semanal") return `los ${textoDias(diasDeAtencion(especialista))}`;
    const proximas = fechasProximas(especialista, desde);
    if (!proximas.length) return "solo en fechas puntuales (por ahora no tiene fechas disponibles)";
    const muestra = proximas.slice(0, 5).map((f) => fechaLegible(f).slice(0, 5)).join(", ");
    return `solo en fechas puntuales (${muestra}${proximas.length > 5 ? ` y ${proximas.length - 5} más` : ""})`;
};

// Mensaje cuando se pide una fecha en la que el especialista no atiende.
export const mensajeDiaNoAtendido = (especialista, fecha) => {
    if (modoDisponibilidad(especialista) === "fechas") {
        const proximas = fechasProximas(especialista);
        return `${especialista.nombre} no atiende el ${fechaLegible(fecha)}. `
            + (proximas.length
                ? `Fechas disponibles: ${proximas.slice(0, 8).map(fechaLegible).join(", ")}${proximas.length > 8 ? "…" : ""}. Elige otra fecha.`
                : "Por ahora no tiene fechas de atención disponibles.");
    }
    return `${especialista.nombre} no atiende los ${plural(diaSemana(fecha))}. `
        + `Atiende: ${textoDias(diasDeAtencion(especialista))}. Elige otra fecha.`;
};
