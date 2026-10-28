import { NEGOCIO } from "../config/negocio.config.js";

// Convención del modelo: `porcentaje: true`  -> servicio convencional (seña del 50 %, turnos de 1 h)
//                        `porcentaje: false` -> servicio de CONSULTA (valor fijo, turnos de 30 min)
export const esConsulta = (servicio) => servicio.porcentaje === false;

export const duracionDe = (servicio) =>
    esConsulta(servicio) ? NEGOCIO.consulta.duracionMinutos : NEGOCIO.duracionEstandarMinutos;

// Cuánto se cobra online al reservar.
export const calcularCobro = (servicio) => {
    const precioTotal = servicio.precio;
    // Tratamiento sin precio de referencia: el importe se define al dar de alta cada reserva.
    if (precioTotal === null || precioTotal === undefined) {
        return { precioTotal: null, porcentajeSena: NEGOCIO.senaPorcentaje, montoSena: null };
    }
    if (esConsulta(servicio)) {
        // Valor fijo: se abona completo.
        return { precioTotal, porcentajeSena: 100, montoSena: precioTotal };
    }
    const porcentajeSena = NEGOCIO.senaPorcentaje;
    return {
        precioTotal,
        porcentajeSena,
        montoSena: Math.round(precioTotal * porcentajeSena) / 100,
    };
};

// El precio de la consulta no es configurable por servicio: siempre es el valor fijo del negocio.
// El de un tratamiento es solo una referencia opcional (el importe real se define en cada reserva).
export const precioFinal = ({ consulta, precio }) => (consulta ? NEGOCIO.consulta.precio : (precio ?? null));

// Cuánto se devuelve de una seña ya cobrada, según el porcentaje de reembolso (100 = todo).
export const calcularReembolso = (montoSena, porcentaje) => Math.round(montoSena * porcentaje) / 100;

// Cobro de un TRATAMIENTO dado de alta por el administrador: el precio lo fija el admin para cada cliente,
// se paga el 50 % como seña y el resto se abona en el local.
export const calcularCobroTratamiento = (precioTotal) => {
    const porcentajeSena = NEGOCIO.senaPorcentaje;
    return {
        precioTotal,
        porcentajeSena,
        montoSena: Math.round(precioTotal * porcentajeSena) / 100,
    };
};
