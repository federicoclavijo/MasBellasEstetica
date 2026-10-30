// Pruebas de las reglas puras (no necesitan base de datos): npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { generarFranjas, hayCruce, franjaYaPaso, esFechaValida, ahoraNegocio, sumarDias, minutosHastaTurno, sinAntelacionMinima } from "../v1/utils/horarios.util.js";
import { calcularCobro, calcularCobroTratamiento, duracionDe, esConsulta, precioFinal, calcularReembolso } from "../v1/utils/cobro.util.js";
import { normalizarTelefonoUY, formatearTelefonoUY, telefonoParaWhatsApp } from "../v1/utils/telefono.util.js";
import { construirMensajeWhatsApp, urlWhatsApp } from "../v1/utils/whatsapp.util.js";
import { construirCorreoConfirmacion } from "../v1/services/mail.services.js";
import { porcentajeReembolsoConfigurado } from "../v1/config/negocio.config.js";
import { agregarReservaSchema } from "../v1/validators/reservas.validators.js";

test("franjas: servicios convencionales cada 1 hora, consulta cada 30 minutos", () => {
    const horas = generarFranjas(60);
    assert.equal(horas.length, 12);
    assert.equal(horas[0], "08:00");
    assert.equal(horas.at(-1), "19:00");

    const medias = generarFranjas(30);
    assert.equal(medias.length, 24);
    assert.deepEqual(medias.slice(0, 3), ["08:00", "08:30", "09:00"]);
    assert.equal(medias.at(-1), "19:30"); // el último turno termina a las 20:00
});

test("cobro: 50 % de seña en servicios convencionales", () => {
    const servicio = { precio: 1000, porcentaje: true };
    assert.deepEqual(calcularCobro(servicio), { precioTotal: 1000, porcentajeSena: 50, montoSena: 500 });
    assert.equal(duracionDe(servicio), 60);
    assert.equal(calcularCobro({ precio: 1234.5, porcentaje: true }).montoSena, 617.25);
});

test("cobro: la consulta es de valor fijo ($500) y dura 30 minutos", () => {
    const consulta = { precio: 500, porcentaje: false };
    assert.equal(esConsulta(consulta), true);
    assert.deepEqual(calcularCobro(consulta), { precioTotal: 500, porcentajeSena: 100, montoSena: 500 });
    assert.equal(duracionDe(consulta), 30);
    assert.equal(precioFinal({ consulta: true, precio: 9999 }), 500);
    assert.equal(precioFinal({ consulta: false, precio: 9999 }), 9999);
});

test("cruces de horario entre turnos de 30 y 60 minutos", () => {
    assert.equal(hayCruce("10:00", 60, "10:30", 30), true);   // 10:30 cae dentro de 10:00-11:00
    assert.equal(hayCruce("10:00", 60, "11:00", 60), false);  // consecutivos, no se pisan
    assert.equal(hayCruce("10:00", 30, "10:30", 30), false);
    assert.equal(hayCruce("10:30", 30, "10:00", 60), true);
});

test("fechas: rechaza días inexistentes y calcula 'ahora' en la zona del local", () => {
    assert.equal(esFechaValida("2026-02-28"), true);
    assert.equal(esFechaValida("2026-02-31"), false);
    assert.equal(esFechaValida("26-02-28"), false);
    assert.equal(sumarDias("2026-12-31", 1), "2027-01-01");

    const ahora = ahoraNegocio(new Date("2026-10-19T02:30:00Z")); // 23:30 del día anterior en Montevideo (UTC-3)
    assert.deepEqual(ahora, { fecha: "2026-10-18", minutos: 23 * 60 + 30 });
    assert.equal(franjaYaPaso("2026-10-18", "23:00", ahora), true);
    assert.equal(franjaYaPaso("2026-10-18", "23:45", ahora), false);
    assert.equal(franjaYaPaso("2026-10-17", "23:59", ahora), true);
});

test("validación de la reserva: fecha de nacimiento y datos del cliente", () => {
    const base = {
        nombre: "  Ana Pérez ", cedula: "1.234.567-8", email: " ANA@Correo.com ", telefono: "099 123 456",
        fechaNacimiento: "1990-05-20", servicioId: "a".repeat(24), fecha: "2030-01-10", hora: "10:00",
    };
    const ok = agregarReservaSchema.validate(base);
    assert.equal(ok.error, undefined);
    assert.equal(ok.value.nombre, "Ana Pérez");
    assert.equal(ok.value.cedula, "12345678");
    assert.equal(ok.value.email, "ana@correo.com");

    const sinNacimiento = agregarReservaSchema.validate({ ...base, fechaNacimiento: undefined });
    assert.ok(sinNacimiento.error);

    for (const fechaNacimiento of ["2999-01-01", "1800-01-01", "1990-02-31"]) {
        assert.ok(agregarReservaSchema.validate({ ...base, fechaNacimiento }).error, fechaNacimiento);
    }
});

test("reembolso: 100 % por defecto, configurable y a prueba de valores inválidos", () => {
    assert.equal(porcentajeReembolsoConfigurado(undefined), 100);
    assert.equal(porcentajeReembolsoConfigurado("100"), 100);
    assert.equal(porcentajeReembolsoConfigurado("50"), 50);
    assert.equal(porcentajeReembolsoConfigurado("33.333"), 33.33);
    for (const invalido of ["", "abc", "0", "-10", "101", "150"]) assert.equal(porcentajeReembolsoConfigurado(invalido), 100, invalido);

    assert.equal(calcularReembolso(500, 100), 500);
    assert.equal(calcularReembolso(600, 50), 300);
    assert.equal(calcularReembolso(617.25, 50), 308.63);
});

test("teléfonos uruguayos: se normalizan a +598 y solo se aceptan celulares", () => {
    for (const valido of ["099 123 456", "099123456", "99123456", "+598 99 123 456", "+59899123456", "00598 99123456", "(099) 123-456"]) {
        assert.equal(normalizarTelefonoUY(valido), "+59899123456", valido);
    }
    for (const invalido of ["", "12345", "2901 2345", "088 123 456", "+54 9 11 1234 5678", "abc", "099 12 345", null, undefined]) {
        assert.equal(normalizarTelefonoUY(invalido), null, String(invalido));
    }
    assert.equal(formatearTelefonoUY("+59899123456"), "099 123 456");
    assert.equal(telefonoParaWhatsApp("+59899123456"), "59899123456");
});

test("tratamientos del administrador: seña del 50 % sobre el precio que fija el admin", () => {
    assert.deepEqual(calcularCobroTratamiento(3000), { precioTotal: 3000, porcentajeSena: 50, montoSena: 1500 });
    assert.equal(calcularCobroTratamiento(1234.5).montoSena, 617.25);
    assert.equal(precioFinal({ consulta: false, precio: undefined }), null);   // el precio de un tratamiento es solo una referencia
    assert.equal(calcularCobro({ precio: null, porcentaje: true }).montoSena, null);
});

test("mensaje de WhatsApp: medios de pago, montos y enlace wa.me", () => {
    const reserva = { nombre: "Lucía Pérez", servicioNombre: "Limpieza facial", especialistaNombre: "Dra. Ana", fecha: "2030-03-05", hora: "10:00", precioTotal: 3000, montoSena: 1500, porcentajeSena: 50 };
    process.env.BROU_CUENTA = "001-123";
    const m = construirMensajeWhatsApp(reserva, { checkoutUrl: "https://mp.example/pay/1", venceEl: "07/03 a las 10:00" });
    for (const trozo of ["Lucía", "Limpieza facial", "10:00", "Dra. Ana", "https://mp.example/pay/1", "001-123", "Mercado Pago", "BROU", "07/03 a las 10:00"]) assert.ok(m.includes(trozo), trozo);
    assert.match(m, /1\.?500/);
    const url = urlWhatsApp("+59899123456", m);
    assert.ok(url.startsWith("https://wa.me/59899123456?text="));
    assert.equal(decodeURIComponent(url.split("?text=")[1]), m);
    delete process.env.BROU_CUENTA;
    assert.ok(!construirMensajeWhatsApp(reserva, { checkoutUrl: "x" }).includes("BROU"));
});

test("correo de confirmación: consulta y tratamiento, con datos escapados", () => {
    const base = { _id: "abc123", nombre: "<i>Lucía</i> Pérez", servicioNombre: "Limpieza", especialistaNombre: "Dra. Ana", fecha: "2030-03-05", hora: "10:00", duracionMinutos: 60, precioTotal: 3000, montoSena: 1500, porcentajeSena: 50, tipo: "tratamiento" };
    const t = construirCorreoConfirmacion(base);
    assert.match(t.asunto, /confirmada/i);
    for (const trozo of ["Valor del tratamiento: $3.000", "Seña abonada: $1.500", "Resta abonar en el local: $1.500", "Martes, 5 de marzo de 2030", "10:00 hs (60 min)", "abc123"]) assert.ok(t.texto.includes(trozo), trozo);
    assert.ok(!t.html.includes("<i>") && t.html.includes("&lt;i&gt;"), "el HTML escapa el contenido del cliente");

    const c = construirCorreoConfirmacion({ ...base, tipo: "consulta", precioTotal: 500, montoSena: 500, porcentajeSena: 100, duracionMinutos: 30 });
    assert.ok(c.texto.includes("Valor de la consulta abonado: $500") && !c.texto.includes("Resta abonar"));
    // reservas anteriores al campo "tipo": se deduce de la seña
    assert.ok(construirCorreoConfirmacion({ ...base, tipo: undefined }).texto.includes("Resta abonar"));
    assert.ok(construirCorreoConfirmacion({ ...base, tipo: undefined, porcentajeSena: 100, precioTotal: 500, montoSena: 500 }).texto.includes("Valor de la consulta"));
});

test("días de atención: día de la semana, valor por defecto y textos", async () => {
    const u = await import("../v1/utils/horarios.util.js");
    assert.equal(u.diaSemana("2026-11-01"), 0);   // domingo
    assert.equal(u.diaSemana("2026-10-31"), 6);   // sábado
    assert.equal(u.diaSemana("2026-10-26"), 1);   // lunes
    assert.deepEqual(u.diasDeAtencion({}), [1, 2, 3, 4, 5, 6]);              // sin el campo: lunes a sábado
    assert.deepEqual(u.diasDeAtencion({ diasDisponibles: [6, 1, 6] }), [1, 6]);
    assert.equal(u.atiendeEseDia({ diasDisponibles: [6] }, "2026-10-31"), true);
    assert.equal(u.atiendeEseDia({ diasDisponibles: [6] }, "2026-10-30"), false);
    assert.equal(u.atiendeEseDia(null, "2026-11-01"), true);                  // sin especialista no hay restricción
    assert.equal(u.textoDias([6]), "sábados");
    assert.equal(u.textoDias([1, 3, 6]), "lunes, miércoles y sábados");
    assert.equal(u.mensajeDiaNoAtendido({ nombre: "Dra. Ana", diasDisponibles: [6] }, "2026-10-26"), "Dra. Ana no atiende los lunes. Atiende: sábados. Elige otra fecha.");
});

test("antelación: el cliente solo reserva turnos que empiezan dentro de 24 h o más", () => {
    const ahora = ahoraNegocio(new Date("2026-10-19T18:00:00Z")); // 15:00 en Montevideo
    assert.deepEqual(ahora, { fecha: "2026-10-19", minutos: 15 * 60 });
    assert.equal(minutosHastaTurno("2026-10-20", "15:00", ahora), 1440);
    assert.equal(minutosHastaTurno("2026-10-19", "18:00", ahora), 180);
    assert.equal(sinAntelacionMinima("2026-10-19", "19:00", 24, ahora), true);   // hoy
    assert.equal(sinAntelacionMinima("2026-10-20", "14:30", 24, ahora), true);   // mañana, 30 min antes del límite
    assert.equal(sinAntelacionMinima("2026-10-20", "15:00", 24, ahora), false);  // justo 24 h
    assert.equal(sinAntelacionMinima("2026-10-20", "15:30", 24, ahora), false);
    assert.equal(sinAntelacionMinima("2026-12-31", "08:00", 24, ahora), false);
    assert.equal(sinAntelacionMinima("2026-10-19", "15:00", 0, ahora), true);    // sin antelación: igual no vale un turno ya iniciado
    assert.equal(sinAntelacionMinima("2026-10-19", "15:30", 0, ahora), false);
});
