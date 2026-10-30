// Prueba de integración del flujo completo (API + base de datos), con Mercado Pago simulado.
// Necesita una base MongoDB VACÍA y descartable (se borra al empezar):
//   TEST_MONGO_URI=mongodb://127.0.0.1:27017/masbellas_test npm run test:integracion
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";

const URI = process.env.TEST_MONGO_URI;
const omitir = URI ? false : "Define TEST_MONGO_URI para ejecutar las pruebas de integración";

let server, base, token, mongoose, M, util, smtp, smtpPort;
const correos = [];   // correos recibidos por el servidor SMTP de prueba
const realFetch = globalThis.fetch;

// --- Mercado Pago simulado -----------------------------------------------------------------------
const ordenes = new Map();
const llamadasMP = { crear: [], cancelar: [], reembolsar: [] };
let falloReembolso = null; // { status, errors } para simular un rechazo de Mercado Pago
let contador = 0;
const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (!u.startsWith("https://api.mercadopago.com/")) return realFetch(url, opts);
    const m = u.match(/\/v1\/orders(?:\/([^/]+?))?(\/cancel|\/refund)?$/);
    const id = m?.[1];
    if (opts.method === "POST" && !id) {
        const body = JSON.parse(opts.body);
        llamadasMP.crear.push(body);
        const orden = {
            id: `ORD${++contador}`, status: "created", status_detail: "created", currency: "UYU",
            total_amount: body.total_amount, total_paid_amount: "0.00", external_reference: body.external_reference,
            checkout_url: `https://www.mercadopago.com.uy/checkout/v1/redirect?order_id=ORD${contador}`,
        };
        ordenes.set(orden.id, orden);
        return json(201, orden);
    }
    if (opts.method === "POST" && m?.[2] === "/refund") {
        llamadasMP.reembolsar.push({ id, body: opts.body ? JSON.parse(opts.body) : null, clave: opts.headers?.["X-Idempotency-Key"] });
        if (falloReembolso) return json(falloReembolso.status, { errors: falloReembolso.errors });
        const o = ordenes.get(id);
        o.status_detail = opts.body ? "partially_refunded" : "refunded";
        return json(201, { id, status: "processed", status_detail: o.status_detail, transactions: { refunds: [{ id: `REF${llamadasMP.reembolsar.length}`, amount: "1.00", status: "processed" }] } });
    }
    if (opts.method === "POST" && m?.[2]) {
        llamadasMP.cancelar.push(id);
        const o = ordenes.get(id);
        if (o?.status === "created") { o.status = "canceled"; o.status_detail = "canceled"; }
        return json(200, o ?? {});
    }
    const o = ordenes.get(id);
    return o ? json(200, o) : json(404, { message: "Order not found" });
};
const pagar = (idOrden) => Object.assign(ordenes.get(idOrden), { status: "processed", status_detail: "accredited", total_paid_amount: ordenes.get(idOrden).total_amount, transactions: { payments: [{ id: `PAY-${idOrden}` }] } });

// --- Utilidades ---------------------------------------------------------------------------------------------
const api = async (metodo, ruta, { body, auth = false } = {}) => {
    const res = await realFetch(`${base}/v1${ruta}`, {
        method: metodo,
        headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
};
const admin = (m, r, body) => api(m, r, { body, auth: true });
// Webhook de Mercado Pago con la firma que valida el sistema (HMAC-SHA256 del "manifest" con MP_WEBHOOK_SECRET).
const webhookMP = async (orderId) => {
    const ts = String(Math.floor(Date.now() / 1000));
    const requestId = `req-${crypto.randomUUID()}`;
    const firma = crypto.createHmac("sha256", "secreto").update(`id:${String(orderId).toLowerCase()};request-id:${requestId};ts:${ts};`).digest("hex");
    const res = await realFetch(`${base}/v1/webhooks/mercadopago?${new URLSearchParams({ "data.id": orderId, type: "order" })}`, {
        method: "POST", headers: { "x-signature": `ts=${ts},v1=${firma}`, "x-request-id": requestId },
    });
    return res.status;
};
const configurarCorreo = (puerto = smtpPort) => Object.assign(process.env, { SMTP_HOST: "127.0.0.1", SMTP_PORT: String(puerto), SMTP_SECURE: "false", MAIL_FROM: "+Bellas <reservas@masbellas.test>", NEGOCIO_DIRECCION: "Av. Ejemplo 1234, Montevideo", NEGOCIO_TELEFONO: "099 000 111" });
const hoy = () => util.ahoraNegocio().fecha;
const dias = (n) => util.sumarDias(hoy(), n);

before(async () => {
    if (omitir) return;
    Object.assign(process.env, {
        MONGO_URI: URI, JWT_SECRET: "secreto-de-prueba", ADMIN_USER: "admin", ADMIN_PASS: bcrypt.hashSync("clave123", 4),
        FRONTEND_URL: "http://localhost:3000", MP_ACCESS_TOKEN: "TEST", MP_WEBHOOK_SECRET: "secreto",
    });
    ({ default: mongoose } = await import("mongoose"));
    const { default: app } = await import("../app.js");
    util = await import("../v1/utils/horarios.util.js");
    M = {
        Reserva: (await import("../v1/models/reserva.model.js")).default,
        Servicio: (await import("../v1/models/servicio.model.js")).default,
        Especialista: (await import("../v1/models/especialista.model.js")).default,
        Usuario: (await import("../v1/models/usuario.model.js")).default,
        pagos: await import("../v1/services/pagos.services.js"),
        indices: await import("../v1/config/indices.config.js"),
    };
    for (let i = 0; i < 100 && mongoose.connection.readyState !== 1; i++) await new Promise((r) => setTimeout(r, 50));
    await mongoose.connection.dropDatabase();
    for (const modelo of [M.Reserva, M.Servicio, M.Especialista, M.Usuario]) await modelo.init().catch(() => {});
    server = app.listen(0);
    base = `http://127.0.0.1:${server.address().port}`;

    // Servidor SMTP real (local) para comprobar qué correo recibe el cliente.
    const { SMTPServer } = await import("smtp-server");
    const { simpleParser } = await import("mailparser");
    smtp = new SMTPServer({
        authOptional: true, disabledCommands: ["STARTTLS", "AUTH"],
        onData(stream, session, callback) {
            simpleParser(stream).then((m) => { correos.push({ para: m.to.value[0].address, todos: m.to.value.map((a) => a.address), replyTo: m.replyTo?.value?.[0]?.address, de: m.from.text, asunto: m.subject, texto: m.text, html: m.html }); callback(); }).catch(callback);
        },
    });
    await new Promise((r) => smtp.listen(0, "127.0.0.1", r));
    smtpPort = smtp.server.address().port;
});

after(async () => {
    globalThis.fetch = realFetch;
    if (omitir) return;
    server?.close();
    smtp?.close();
    await mongoose.disconnect();
});

const ctx = {}; // ids compartidos entre pruebas (se ejecutan en orden)
const datosCliente = (extra = {}) => ({
    nombre: "Ana Pérez", cedula: "1.234.567-8", email: "ana@correo.com", telefono: "099 123 456", fechaNacimiento: "1990-05-20", ...extra,
});


// Reserva por la web (consulta). Devuelve el id.
const reservarConsulta = async (servicioId, hora, email, { dia = 3, extra = {} } = {}) => {
    const r = await api("POST", "/reservas", { body: { ...datosCliente({ email, nombre: "Cliente Web", ...extra }), servicioId, fecha: dias(dia), hora } });
    return r;
};
// Alta de tratamiento por el administrador.
const altaTratamiento = (servicioId, hora, email, { dia = 5, precio = 3000, extra = {} } = {}) =>
    admin("POST", "/reservas/admin", { nombre: "Clienta Tratamiento", telefono: "098 765 432", email, servicioId, fecha: dias(dia), hora, precio, ...extra });

test("login: valida datos y no devuelve la contraseña", { skip: omitir }, async () => {
    assert.equal((await api("POST", "/auth/login", { body: {} })).status, 400);
    assert.equal((await api("POST", "/auth/login", { body: { user: "admin", pass: "mal" } })).status, 401);
    const ok = await api("POST", "/auth/login", { body: { user: "admin", pass: "clave123" } });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.body, undefined);
    token = ok.data.token;
});

test("índices: un índice único viejo (p. ej. sobre el precio) bloquea guardados y se limpia solo", { skip: omitir }, async () => {
    // Se usa una especialista temporal y colecciones todavía vacías (un índice único no se puede crear con precios repetidos).
    const temporal = (await admin("POST", "/especialistas", { nombre: "Temporal de índices" })).data.especialista._id;
    const nuevaConsulta = (nombre) => admin("POST", "/servicios", { nombre, esConsulta: true, especialistaId: temporal });
    await M.Servicio.deleteMany({});

    // Se reproduce lo que queda en una base creada con una versión anterior del esquema.
    await M.Servicio.collection.createIndex({ precio: 1 }, { unique: true, name: "precio_1" });
    await M.Especialista.collection.createIndex({ servicioId: 1 }, { unique: true, name: "servicioId_1" });
    assert.equal((await nuevaConsulta("Consulta A")).status, 201);
    const bloqueada = await nuevaConsulta("Consulta B (mismo precio)");
    assert.equal(bloqueada.status, 409);
    assert.match(bloqueada.data.mensaje, /Ya existe un registro/);          // (con MongoDB real el mensaje además nombra el campo repetido: «precio»)
    // (En MongoDB real, un índice único viejo sobre `servicioId` también impide crear un 2.º especialista sin servicio:
    //  los campos ausentes cuentan como null. El motor de prueba no reproduce ese detalle, pero sí la limpieza.)
    assert.equal((await admin("POST", "/especialistas", { nombre: "Sin servicio 1" })).status, 201);

    // Limpieza: solo se eliminan índices únicos que ningún modelo declara
    const eliminados = await M.indices.eliminarIndicesUnicosObsoletos();
    assert.deepEqual(eliminados.sort(), ["especialistas.servicioId_1", "servicios.precio_1"]);
    const quedan = (await M.Servicio.collection.indexes()).map((i) => i.name);
    assert.ok(quedan.includes("nombre_1_porcentaje_1"), "se conserva el índice único por nombre + tipo");
    assert.deepEqual(await M.indices.eliminarIndicesUnicosObsoletos(), []); // idempotente

    assert.equal((await nuevaConsulta("Consulta B (mismo precio)")).status, 201);
    assert.equal((await nuevaConsulta("Consulta C (mismo precio)")).status, 201);
    assert.equal((await admin("POST", "/servicios", { nombre: "Tratamiento X", precio: 500, especialistaId: temporal })).status, 201);   // también tratamientos con igual precio
    assert.equal((await admin("POST", "/especialistas", { nombre: "Sin servicio 2" })).status, 201);
    assert.equal((await nuevaConsulta("consulta b (MISMO precio)")).status, 409);   // el nombre sigue siendo único dentro de las consultas
    // se retiran los datos de esta prueba para no alterar las demás
    await M.Servicio.deleteMany({});
    await M.Especialista.deleteMany({ nombre: /^(Sin servicio|Temporal de índices)/ });
});

test("nombres: una consulta y un tratamiento pueden llamarse igual, pero no hay 2 consultas ni 2 tratamientos con el mismo nombre", { skip: omitir }, async () => {
    const esp = (await admin("POST", "/especialistas", { nombre: "Temporal de nombres" })).data.especialista._id;
    await M.Servicio.deleteMany({});
    // Base creada con la versión anterior: índice único solo sobre `nombre` (impedía «Botox» consulta + «Botox» tratamiento).
    await M.Servicio.collection.createIndex({ nombre: 1 }, { unique: true, name: "nombre_1" });
    assert.deepEqual(await M.indices.eliminarIndicesUnicosObsoletos(), ["servicios.nombre_1"]);
    await M.Servicio.init();

    const consulta = (nombre) => admin("POST", "/servicios", { nombre, esConsulta: true, especialistaId: esp });
    const tratamiento = (nombre) => admin("POST", "/servicios", { nombre, esConsulta: false, especialistaId: esp });

    const c = await consulta("Botox");
    const t = await tratamiento("Botox");
    assert.equal(c.status, 201);
    assert.equal(t.status, 201);                                   // mismo nombre, tipos distintos
    assert.equal((await consulta("botox")).status, 409);           // 2.ª consulta con ese nombre (sin distinguir mayúsculas)
    assert.match((await consulta("BOTOX")).data.mensaje, /Ya existe una consulta/);
    assert.equal((await tratamiento("Botox")).status, 409);        // 2.º tratamiento con ese nombre
    assert.match((await tratamiento(" Botox ")).data.mensaje, /Ya existe un tratamiento/);

    // Renombrar / cambiar de tipo también respeta la regla.
    const otra = (await consulta("Relleno")).data.servicio._id;
    assert.equal((await admin("PATCH", `/servicios/${otra}`, { nombre: "Botox" })).status, 409);                   // choca con la consulta «Botox»
    assert.equal((await admin("PATCH", `/servicios/${otra}`, { esConsulta: false })).status, 200);                 // «Relleno» pasa a tratamiento (no hay otro)
    assert.equal((await admin("PATCH", `/servicios/${otra}`, { nombre: "Botox" })).status, 409);                   // choca con el tratamiento «Botox»
    await consulta("Relleno");                                                                                     // vuelve a existir una consulta «Relleno»
    assert.equal((await admin("PATCH", `/servicios/${otra}`, { esConsulta: true })).status, 409);                  // dos consultas «Relleno»
    assert.equal((await admin("PATCH", `/servicios/${t.data.servicio._id}`, { precio: 4000 })).status, 200);       // editar otros campos no choca consigo mismo

    // El público solo ve la consulta; el panel ve las dos.
    const publicas = (await api("GET", "/servicios")).data.servicios.filter((x) => x.nombre === "Botox");
    assert.equal(publicas.length, 1);
    assert.equal(publicas[0].esConsulta, true);
    assert.equal((await admin("GET", "/servicios?todos=true")).data.servicios.filter((x) => x.nombre === "Botox").length, 2);

    await M.Servicio.deleteMany({});
    await M.Especialista.deleteMany({ nombre: "Temporal de nombres" });
});

test("antelación: el cliente no puede reservar con menos de 24 h; el administrador sí agenda sin ese margen", { skip: omitir }, async () => {
    const esp = (await admin("POST", "/especialistas", { nombre: "Temporal de antelación", diasDisponibles: [0, 1, 2, 3, 4, 5, 6] })).data.especialista._id;
    const consulta = (await admin("POST", "/servicios", { nombre: "Consulta antelación", esConsulta: true, especialistaId: esp })).data.servicio._id;
    const trat = (await admin("POST", "/servicios", { nombre: "Tratamiento antelación", esConsulta: false, especialistaId: esp })).data.servicio._id;
    const ahora = util.ahoraNegocio();

    // Primer turno de consulta (cada 30 min) que ya cumple las 24 h, y el anterior (que todavía no).
    const horas = util.generarFranjas(30);
    const cumple = (fecha, h) => !util.sinAntelacionMinima(fecha, h, 24, ahora);
    const manana = dias(1);
    const primero = horas.find((h) => cumple(manana, h));
    const anterior = horas[horas.indexOf(primero) - 1];

    // Hoy nunca alcanza: siempre es menos de 24 h.
    const hoyHora = horas.find((h) => !util.franjaYaPaso(hoy(), h, ahora)) ?? horas.at(-1);
    const hoyResp = await api("POST", "/reservas", { body: { ...datosCliente({ email: "antelacion-hoy@correo.com" }), servicioId: consulta, fecha: hoy(), hora: hoyHora } });
    assert.equal(hoyResp.status, 400);

    if (anterior) {
        const corta = await api("POST", "/reservas", { body: { ...datosCliente({ email: "antelacion-corta@correo.com" }), servicioId: consulta, fecha: manana, hora: anterior } });
        assert.equal(corta.status, 400);
        assert.match(corta.data.mensaje, /24 horas de antelación/);
    }

    // La disponibilidad pública no ofrece turnos de menos de 24 h; la del administrador sí.
    const publica = (await api("GET", `/reservas/disponibilidad?fecha=${manana}&servicioId=${consulta}`)).data;
    assert.ok(publica.horariosDisponibles.every((h) => cumple(manana, h)), "la web no ofrece horarios dentro de las próximas 24 h");
    if (primero) assert.ok(publica.horariosDisponibles.includes(primero));
    const hoyPublica = (await api("GET", `/reservas/disponibilidad?fecha=${hoy()}&servicioId=${consulta}`)).data;
    assert.deepEqual(hoyPublica.horariosDisponibles, []);

    if (primero) {
        const ok = await api("POST", "/reservas", { body: { ...datosCliente({ email: "antelacion-ok@correo.com" }), servicioId: consulta, fecha: manana, hora: primero } });
        assert.equal(ok.status, 201);
    }

    // El administrador agenda un tratamiento para mañana sin la restricción (si el horario todavía no pasó).
    const mananaAdmin = await admin("POST", "/reservas/admin", { nombre: "Clienta Tratamiento", telefono: "098 765 432", email: "antelacion-admin@correo.com", servicioId: trat, fecha: manana, hora: "08:00", precio: 3000 });
    assert.equal(mananaAdmin.status, 201);
});

test("catálogo: un especialista con varias consultas; consultas fijas en $500; tratamientos con precio opcional", { skip: omitir }, async () => {
    for (const [k, nombre] of [["a", "Dra. Ana Gómez"], ["b", "Dr. Luis Pérez"], ["c", "Dra. Marta Silva"]]) {
        // Atienden los 7 días para que estas pruebas (que usan fechas relativas a hoy) no dependan del día de la semana.
        const r = await admin("POST", "/especialistas", { nombre, rol: "Medico", diasDisponibles: [0, 1, 2, 3, 4, 5, 6] });
        assert.equal(r.status, 201);
        ctx[k] = r.data.especialista._id;
    }
    const crear = async (clave, body) => {
        const r = await admin("POST", "/servicios", body);
        assert.equal(r.status, 201, JSON.stringify(r.data));
        ctx[clave] = r.data.servicio._id;
        return r.data.servicio;
    };
    const facial = await crear("facial", { nombre: "Consulta facial", esConsulta: true, precio: 99999, especialistaId: ctx.a });
    assert.equal(facial.precio, 500);                 // el precio de una consulta lo fija el sistema
    assert.equal(facial.montoSena, 500);
    assert.equal(facial.duracionMinutos, 30);
    await crear("corporal", { nombre: "Consulta corporal", esConsulta: true, especialistaId: ctx.a });   // misma especialista, otra consulta
    await crear("capilar", { nombre: "Consulta capilar", esConsulta: true, especialistaId: ctx.b });      // y varias consultas a la vez (ya no hay límite de una)
    const limpieza = await crear("limpieza", { nombre: "Limpieza facial", precio: 1000, especialistaId: ctx.a });
    assert.equal(limpieza.duracionMinutos, 60);
    await crear("peeling", { nombre: "Peeling", especialistaId: ctx.b });                                 // sin precio de referencia
    await crear("inactiva", { nombre: "Consulta inactiva", esConsulta: true, activo: false, especialistaId: ctx.c });

    const publico = (await api("GET", "/servicios")).data.servicios;
    assert.deepEqual(publico.map((x) => x.nombre).sort(), ["Consulta capilar", "Consulta corporal", "Consulta facial"]); // solo consultas activas
    assert.equal((await api("GET", "/servicios?todos=true")).status, 401);
    assert.equal((await admin("GET", "/servicios?todos=true")).data.servicios.length, 6);

    const esp = (await api("GET", "/especialistas")).data.especialistas.find((e) => e._id === ctx.a);
    assert.deepEqual(esp.servicios.map((x) => x.nombre).sort(), ["Consulta corporal", "Consulta facial"]);   // el público no ve tratamientos
    const espAdmin = (await admin("GET", "/especialistas")).data.especialistas.find((e) => e._id === ctx.a);
    assert.equal(espAdmin.servicios.length, 3);
});

test("disponibilidad: el público solo ve consultas (24 turnos de 30 min); el admin también tratamientos (12 de 1 h)", { skip: omitir }, async () => {
    const c = await api("GET", `/reservas/disponibilidad?fecha=${dias(3)}&servicioId=${ctx.facial}`);
    assert.equal(c.data.horariosDisponibles.length, 24);
    assert.equal(c.data.especialistaId, ctx.a);
    assert.equal((await api("GET", `/reservas/disponibilidad?fecha=${dias(3)}&servicioId=${ctx.limpieza}`)).status, 404);
    const t = await admin("GET", `/reservas/disponibilidad?fecha=${dias(3)}&servicioId=${ctx.limpieza}`);
    assert.equal(t.status, 200);
    assert.equal(t.data.horariosDisponibles.length, 12);
    assert.equal((await api("GET", `/reservas/disponibilidad?fecha=${dias(-1)}&servicioId=${ctx.facial}`)).status, 400);
    assert.equal((await api("GET", `/reservas/disponibilidad?fecha=${dias(3)}&servicioId=${ctx.inactiva}`)).status, 404);
});

test("reserva web: solo consultas, con teléfono uruguayo obligatorio y $500 fijos", { skip: omitir }, async () => {
    const base = { ...datosCliente(), servicioId: ctx.facial, fecha: dias(3), hora: "10:00" };
    const sinTel = await api("POST", "/reservas", { body: { ...base, telefono: undefined } });
    assert.equal(sinTel.status, 400);
    assert.match(sinTel.data.mensaje, /tel[eé]fono/i);
    for (const malo of ["12345", "2 901 2345", "+54 9 11 1234 5678", "abc", "088 123 456"]) {
        assert.equal((await api("POST", "/reservas", { body: { ...base, telefono: malo } })).status, 400, malo);
    }
    assert.equal((await api("POST", "/reservas", { body: { ...base, servicioId: ctx.limpieza } })).status, 404);   // un tratamiento no se reserva por la web
    assert.equal((await api("POST", "/reservas", { body: { ...base, hora: "10:15" } })).status, 400);
    assert.equal((await api("POST", "/reservas", { body: { ...base, fechaNacimiento: undefined } })).status, 400);
    assert.equal(await M.Usuario.countDocuments(), 0);

    const ok = await api("POST", "/reservas", { body: { ...base, telefono: "+598 99 123 456" } });
    assert.equal(ok.status, 201, JSON.stringify(ok.data));
    ctx.r1 = ok.data.reservaId;
    const doc = await M.Reserva.findById(ctx.r1);
    assert.equal(doc.telefono, "+59899123456");     // se guarda normalizado
    assert.equal(doc.origen, "web");
    assert.equal(doc.tipo, "consulta");
    assert.equal(doc.precioTotal, 500);
    assert.equal(doc.montoSena, 500);
    assert.equal(doc.porcentajeSena, 100);
    assert.equal(doc.duracionMinutos, 30);
    assert.ok(doc.checkoutUrl);
    const usuario = await M.Usuario.findOne({ email: "ana@correo.com" });
    assert.equal(usuario.telefono, "+59899123456");
    assert.equal(usuario.cedula, "12345678");
    const orden = llamadasMP.crear.at(-1);
    assert.equal(orden.total_amount, "500.00");
    assert.equal(orden.expiration_time, undefined);
    assert.equal(orden.config.online.success_url, `http://localhost:3000/resultado.html?reserva=${ctx.r1}`);
});

test("agenda compartida: las consultas de una misma especialista (y sus tratamientos) no se pisan", { skip: omitir }, async () => {
    // Dra. Ana tiene Consulta facial a las 10:00; su Consulta corporal a la misma hora no entra.
    assert.equal((await reservarConsulta(ctx.corporal, "10:00", "otra@correo.com")).status, 409);
    const otra = await reservarConsulta(ctx.corporal, "10:30", "otra@correo.com");
    assert.equal(otra.status, 201);
    const disp = (await api("GET", `/reservas/disponibilidad?fecha=${dias(3)}&servicioId=${ctx.facial}`)).data.horariosDisponibles;
    assert.ok(!disp.includes("10:00") && !disp.includes("10:30") && disp.includes("11:00"));
    // Otra especialista (Dr. Luis, Consulta capilar) a la misma hora: sin problema.
    assert.equal((await reservarConsulta(ctx.capilar, "10:00", "luis@correo.com")).status, 201);
    ctx.r2 = otra.data.reservaId;
});

test("alta de tratamiento por el administrador: precio libre, seña del 50 %, enlace de pago y mensaje de WhatsApp", { skip: omitir }, async () => {
    process.env.BROU_CUENTA = "001234567-00001";
    process.env.BROU_TITULAR = "+Bellas SRL";
    const body = { nombre: "Clienta Tratamiento", telefono: "098 765 432", email: "trat@correo.com", servicioId: ctx.limpieza, fecha: dias(5), hora: "10:00", precio: 3000 };
    assert.equal((await api("POST", "/reservas/admin", { body })).status, 401);
    assert.equal((await admin("POST", "/reservas/admin", { ...body, precio: undefined })).status, 400);
    assert.equal((await admin("POST", "/reservas/admin", { ...body, precio: 0 })).status, 400);
    assert.equal((await admin("POST", "/reservas/admin", { ...body, telefono: "2901 2345" })).status, 400);
    assert.equal((await admin("POST", "/reservas/admin", { ...body, servicioId: ctx.facial })).status, 404);      // una consulta no es un tratamiento
    assert.equal((await admin("POST", "/reservas/admin", { ...body, hora: "10:30" })).status, 400);                // los tratamientos son de 1 hora

    const r = await admin("POST", "/reservas/admin", body);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    ctx.t1 = r.data.reservaId;
    const doc = await M.Reserva.findById(ctx.t1);
    assert.equal(doc.origen, "admin");
    assert.equal(doc.tipo, "tratamiento");
    assert.equal(doc.precioTotal, 3000);
    assert.equal(doc.montoSena, 1500);               // 50 %
    assert.equal(doc.porcentajeSena, 50);
    assert.equal(doc.saldoRestante, 1500);           // el resto se abona en el local
    assert.equal(doc.duracionMinutos, 60);
    assert.equal(doc.telefono, "+59898765432");
    assert.equal(doc.especialistaNombre, "Dra. Ana Gómez");
    const dias2 = (doc.fechaExpiracion - Date.now()) / 86400000;
    assert.ok(dias2 > 1.9 && dias2 <= 2, `retiene el horario ${dias2} días`);
    const orden = llamadasMP.crear.at(-1);
    assert.equal(orden.total_amount, "1500.00");
    assert.equal(orden.expiration_time, "P2D");

    // Mensaje de WhatsApp: número uruguayo, enlace de Mercado Pago, cuenta BROU y montos
    const w = r.data.whatsapp;
    assert.match(w.url, /^https:\/\/wa\.me\/59898765432\?text=/);
    const texto = decodeURIComponent(w.url.split("?text=")[1]);
    assert.equal(texto, w.mensaje);
    assert.ok(w.mensaje.includes(r.data.checkoutUrl));
    assert.ok(w.mensaje.includes("001234567-00001") && w.mensaje.includes("+Bellas SRL"));
    assert.match(w.mensaje, /1\.?500/);
    assert.match(w.mensaje, /Limpieza facial/);
    assert.match(w.mensaje, /Dra\. Ana Gómez/);

    // La cuenta se cambia por variable de entorno; sin cuenta no se menciona la transferencia
    process.env.BROU_CUENTA = "999-000";
    assert.ok((await admin("GET", `/reservas/${ctx.t1}/whatsapp`)).data.whatsapp.mensaje.includes("999-000"));
    delete process.env.BROU_CUENTA;
    assert.ok(!(await admin("GET", `/reservas/${ctx.t1}/whatsapp`)).data.whatsapp.mensaje.includes("BROU"));
    process.env.BROU_CUENTA = "001234567-00001";

    // Mensaje solo para tratamientos pendientes
    assert.equal((await admin("GET", `/reservas/${ctx.r1}/whatsapp`)).status, 409);
    // El cliente ya tenía un usuario: se reutiliza y completa sus datos
    assert.equal(await M.Usuario.countDocuments({ email: "trat@correo.com" }), 1);
});

test("el tratamiento comparte agenda con las consultas de la especialista y no se cancela con nuevas reservas del cliente", { skip: omitir }, async () => {
    // Limpieza (Dra. Ana) 10:00-11:00 del día 5: su consulta facial de 10:30 no entra, la de 11:00 sí.
    assert.equal((await reservarConsulta(ctx.facial, "10:30", "c1@correo.com", { dia: 5 })).status, 409);
    assert.equal((await reservarConsulta(ctx.facial, "10:00", "c2@correo.com", { dia: 5 })).status, 409);
    assert.equal((await reservarConsulta(ctx.facial, "11:00", "c3@correo.com", { dia: 5 })).status, 201);
    // Y el tratamiento no entra encima de esa consulta de 11:00
    assert.equal((await altaTratamiento(ctx.limpieza, "11:00", "x@correo.com")).status, 409);
    const slots = (await admin("GET", `/reservas/disponibilidad?fecha=${dias(5)}&servicioId=${ctx.limpieza}`)).data.horariosDisponibles;
    assert.ok(!slots.includes("10:00") && !slots.includes("11:00") && slots.includes("09:00") && slots.includes("12:00"));

    // Una consulta nueva del mismo cliente reemplaza a su consulta web pendiente, pero NO a su tratamiento
    const mismo = "trat@correo.com";
    const c1 = await reservarConsulta(ctx.capilar, "09:00", mismo, { dia: 6 });
    const c2 = await reservarConsulta(ctx.capilar, "09:30", mismo, { dia: 6 });
    assert.equal(c2.status, 201);
    assert.equal((await M.Reserva.findById(c1.data.reservaId)).estadoReserva, "cancelada");
    assert.equal((await M.Reserva.findById(ctx.t1)).estadoReserva, "pendiente_pago");
});

test("pago del tratamiento: por Mercado Pago se confirma solo; por transferencia BROU lo confirma el administrador", { skip: omitir }, async () => {
    // Mercado Pago
    pagar((await M.Reserva.findById(ctx.t1)).mercadoPagoOrderId);
    const estado = await api("GET", `/reservas/${ctx.t1}/estado`);
    assert.equal(estado.data.estadoReserva, "confirmada");
    assert.equal(estado.data.montoSena, 1500);
    assert.equal((await admin("POST", `/reservas/${ctx.t1}/confirmar-pago`)).status, 409);   // ya confirmada

    // Transferencia
    const t2 = (await altaTratamiento(ctx.limpieza, "14:00", "transf@correo.com", { precio: 2000 })).data.reservaId;
    const antes = llamadasMP.cancelar.length;
    const conf = await admin("POST", `/reservas/${t2}/confirmar-pago`);
    assert.equal(conf.status, 200, JSON.stringify(conf.data));
    const doc = await M.Reserva.findById(t2);
    assert.equal(doc.estadoReserva, "confirmada");
    assert.equal(doc.estadoPago, "aprobado");
    assert.equal(doc.metodoPago, "transferencia");
    assert.equal(llamadasMP.cancelar.length, antes + 1);          // el enlace de Mercado Pago se anula (no se paga dos veces)
    assert.equal((await admin("GET", `/reservas/${t2}/whatsapp`)).status, 409);

    // No se reembolsa por Mercado Pago lo que se pagó por transferencia
    await admin("POST", `/reservas/${t2}/cancelar`);
    const rr = await admin("POST", `/reservas/${t2}/reembolsar`);
    assert.equal(rr.status, 409);
    assert.match(rr.data.mensaje, /transferencia/i);
    assert.equal((await admin("POST", `/reservas/${t2}/reembolso`)).status, 200);              // se marca a mano
    assert.equal((await admin("DELETE", `/reservas/${t2}`)).status, 200);
});

test("reembolso por Mercado Pago: 100 % de la seña por defecto y porcentaje configurable", { skip: omitir }, async () => {
    await admin("POST", `/reservas/${ctx.t1}/cancelar`);
    const prev = (await admin("GET", `/reservas/${ctx.t1}`)).data.reserva;
    assert.equal(prev.porcentajeReembolsable, 100);
    assert.equal(prev.montoReembolsable, 1500);
    const n = llamadasMP.reembolsar.length;
    assert.equal((await admin("POST", `/reservas/${ctx.t1}/reembolsar`)).status, 200);
    assert.equal(llamadasMP.reembolsar.length, n + 1);
    assert.equal(llamadasMP.reembolsar.at(-1).body, null);
    assert.equal((await M.Reserva.findById(ctx.t1)).montoReembolsado, 1500);
    assert.equal((await admin("POST", `/reservas/${ctx.t1}/reembolsar`)).status, 409);

    process.env.REEMBOLSO_PORCENTAJE = "50";
    const t3 = (await altaTratamiento(ctx.limpieza, "16:00", "r50@correo.com", { precio: 2000 })).data.reservaId;   // seña 1000
    pagar((await M.Reserva.findById(t3)).mercadoPagoOrderId);
    await api("GET", `/reservas/${t3}/estado`);
    await admin("POST", `/reservas/${t3}/cancelar`);
    assert.equal((await admin("POST", `/reservas/${t3}/reembolsar`)).status, 200);
    const parcial = llamadasMP.reembolsar.at(-1).body;
    assert.equal(parcial.transactions[0].amount, "500.00");
    delete process.env.REEMBOLSO_PORCENTAJE;
    assert.equal((await M.Reserva.findById(t3)).reembolsoPorcentaje, 50);
});

test("buscar clientes para autocompletar el alta (solo administración)", { skip: omitir }, async () => {
    assert.equal((await api("GET", "/usuarios?q=ana")).status, 401);
    const porNombre = await admin("GET", "/usuarios?q=an");
    assert.ok(porNombre.data.clientes.some((c) => c.email === "ana@correo.com"));
    const porTel = await admin("GET", "/usuarios?q=99123456");
    assert.equal(porTel.data.clientes[0].telefono, "+59899123456");
    assert.deepEqual((await admin("GET", "/usuarios?q=a")).data.clientes, []);   // mínimo 2 letras
});

test("modificar y cancelar reservas siguen funcionando (consultas y tratamientos)", { skip: omitir }, async () => {
    // reprogramar la consulta r1 (día 3, 10:00) a un horario libre; los tratamientos conservan 1 h
    const disp = await admin("GET", `/reservas/${ctx.r1}/disponibilidad?fecha=${dias(4)}`);
    assert.equal(disp.data.horariosDisponibles.length, 24);
    assert.equal((await admin("PATCH", `/reservas/${ctx.r1}`, { fecha: dias(4), hora: "10:15" })).status, 400);
    assert.equal((await admin("PATCH", `/reservas/${ctx.r1}`, { fecha: dias(4), hora: "10:30" })).status, 200);
    const t = (await altaTratamiento(ctx.limpieza, "09:00", "mod@correo.com", { dia: 7 })).data.reservaId;
    assert.equal((await admin("PATCH", `/reservas/${t}`, { hora: "10:30" })).status, 400);
    assert.equal((await admin("PATCH", `/reservas/${t}`, { hora: "10:00" })).status, 200);
    assert.equal((await admin("DELETE", `/reservas/${t}`)).status, 409);       // activa
    assert.equal((await admin("POST", `/reservas/${t}/cancelar`)).status, 200);
    assert.equal((await admin("DELETE", `/reservas/${t}`)).status, 200);       // sin pago: se puede eliminar
});

test("servicios: cambiar a tratamiento o a consulta, y reglas con reservas futuras", { skip: omitir }, async () => {
    // un tratamiento sin precio de referencia puede recibir uno; una consulta siempre vale $500
    assert.equal((await admin("PATCH", `/servicios/${ctx.peeling}`, { precio: 1800 })).data.servicio.precio, 1800);
    assert.equal((await admin("PATCH", `/servicios/${ctx.facial}`, { precio: 900 })).data.servicio.precio, 500);
    // con reservas futuras no se cambia el tipo ni el especialista, ni se elimina
    assert.equal((await admin("PATCH", `/servicios/${ctx.facial}`, { esConsulta: false })).status, 409);
    assert.equal((await admin("PATCH", `/servicios/${ctx.facial}`, { especialistaId: ctx.c })).status, 409);
    assert.equal((await admin("DELETE", `/servicios/${ctx.facial}`)).status, 409);
    // el especialista que tiene turnos futuros no se puede eliminar
    assert.equal((await admin("DELETE", `/especialistas/${ctx.a}`)).status, 409);
    // sin turnos: se elimina y sus servicios quedan sin asignar
    const baja = await admin("DELETE", `/especialistas/${ctx.c}`);
    assert.equal(baja.status, 200);
    assert.deepEqual(baja.data.serviciosSinAsignar, ["Consulta inactiva"]);
    assert.equal((await M.Servicio.findById(ctx.inactiva)).especialistaId, null);
});

test("vencimiento: la consulta web impaga se libera sola; el tratamiento conserva su plazo", { skip: omitir }, async () => {
    const impaga = (await reservarConsulta(ctx.capilar, "15:00", "imp@correo.com", { dia: 9 })).data.reservaId;
    const trat = (await altaTratamiento(ctx.peeling, "16:00", "plazo@correo.com", { dia: 9 })).data.reservaId;
    assert.ok(trat);
    await M.Reserva.updateOne({ _id: impaga }, { $set: { fechaExpiracion: new Date(Date.now() - 1000) } });
    const disp = await api("GET", `/reservas/disponibilidad?fecha=${dias(9)}&servicioId=${ctx.capilar}`);
    assert.equal((await M.Reserva.findById(impaga)).estadoReserva, "expirada");
    assert.ok(disp.data.horariosDisponibles.includes("15:00"), "la consulta impaga liberó su horario");
    assert.ok(!disp.data.horariosDisponibles.includes("16:00"), "el tratamiento (Dr. Luis, 16:00-17:00) sigue reteniendo el suyo");
    assert.equal((await M.Reserva.findById(trat)).estadoReserva, "pendiente_pago");
});

test("correo de confirmación: se envía una sola vez cuando Mercado Pago avisa el pago", { skip: omitir }, async () => {
    const reservar = async (servicioId, hora, email, nombre, dia = 12) => {
        const r = await api("POST", "/reservas", { body: { ...datosCliente({ email, nombre }), servicioId, fecha: dias(dia), hora } });
        assert.equal(r.status, 201, JSON.stringify(r.data));
        const doc = await M.Reserva.findById(r.data.reservaId);
        return { id: r.data.reservaId, orden: doc.mercadoPagoOrderId };
    };
    const reserva = (id) => M.Reserva.findById(id);
    const esperarCorreos = async (n) => { for (let i = 0; i < 60 && correos.length < n; i++) await new Promise((r) => setTimeout(r, 50)); };
    delete process.env.SMTP_HOST;
    correos.length = 0;

    // 1. Sin correo configurado: el pago se confirma igual, no se envía nada y el reenvío manual avisa por qué.
    const a = await reservar(ctx.capilar, "09:00", "sin-correo@correo.com", "Lucía Ramos");
    pagar(a.orden);
    assert.equal(await webhookMP(a.orden), 200);
    assert.equal((await reserva(a.id)).estadoReserva, "confirmada");
    assert.equal((await reserva(a.id)).emailConfirmacionEnviadoEn, null);
    assert.equal(correos.length, 0);
    assert.equal((await api("POST", `/reservas/${a.id}/reenviar-confirmacion`)).status, 401);
    const sinConf = await admin("POST", `/reservas/${a.id}/reenviar-confirmacion`);
    assert.equal(sinConf.status, 409);
    assert.match(sinConf.data.mensaje, /SMTP/);

    // 2. Con correo configurado: el aviso repetido de Mercado Pago reintenta el envío pendiente, y luego no duplica.
    configurarCorreo();
    assert.equal(await webhookMP(a.orden), 200);
    await esperarCorreos(1);
    assert.equal(correos.length, 1);
    const c = correos[0];
    assert.equal(c.para, "sin-correo@correo.com");
    assert.match(c.de, /reservas@masbellas\.test/);
    assert.match(c.asunto, /confirmada/i);
    for (const trozo of ["CONFIRMADA", "Lucía", "Consulta capilar", "Dr. Luis Pérez", "$500", "09:00", "30 min", String(a.id), "Av. Ejemplo 1234", "099 000 111"]) {
        assert.ok(c.texto.includes(trozo), `texto: falta «${trozo}»`);
    }
    for (const trozo of ["quedó confirmada", "Consulta capilar", "Dr. Luis Pérez", "$500", "09:00", "#c6993f"]) assert.ok(c.html.includes(trozo), `html: falta «${trozo}»`);
    assert.ok((await reserva(a.id)).emailConfirmacionEnviadoEn);
    assert.equal(await webhookMP(a.orden), 200);
    assert.equal((await api("GET", `/reservas/${a.id}/estado`)).status, 200);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(correos.length, 1, "un aviso repetido no envía otro correo");

    // 3. Varias vías confirmando a la vez (webhook + página de resultado): un solo correo.
    //    (Entre procesos distintos lo garantiza la actualización atómica de MongoDB; el motor de prueba no la ofrece,
    //     así que aquí se comprueba la protección dentro del proceso.)
    const b = await reservar(ctx.capilar, "09:30", "paralelo@correo.com", "<b>Marta</b> Gil");
    pagar(b.orden);
    await Promise.all([webhookMP(b.orden), webhookMP(b.orden), api("GET", `/reservas/${b.id}/estado`), api("GET", `/reservas/${b.id}/estado`), api("GET", `/reservas/${b.id}/estado`)]);
    await esperarCorreos(2);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(correos.filter((x) => x.para === "paralelo@correo.com").length, 1, "una sola confirmación aunque confirmen varias vías a la vez");
    const mb = correos.find((x) => x.para === "paralelo@correo.com");
    assert.ok(!mb.html.includes("<b>Marta</b>") && mb.html.includes("&lt;b&gt;Marta&lt;/b&gt;"), "el nombre se escapa en el HTML");

    // 4. Tratamiento (alta del administrador) pagado por Mercado Pago: informa el saldo a abonar en el local.
    const antes = correos.length;
    const t = (await altaTratamiento(ctx.limpieza, "09:00", "trat-mail@correo.com", { dia: 12, precio: 4000 })).data;
    pagar((await reserva(t.reservaId)).mercadoPagoOrderId);
    assert.equal(await webhookMP((await reserva(t.reservaId)).mercadoPagoOrderId), 200);
    await esperarCorreos(antes + 1);
    const mt = correos.at(-1);
    assert.equal(mt.para, "trat-mail@correo.com");
    for (const trozo of ["Tratamiento", "Limpieza facial", "Valor del tratamiento", "$4.000", "Seña abonada", "$2.000", "Resta abonar en el local"]) assert.ok(mt.texto.includes(trozo), `tratamiento: falta «${trozo}»`);

    // 5. Pago por transferencia confirmado por el administrador: también se avisa al cliente.
    const t2 = (await altaTratamiento(ctx.limpieza, "11:00", "transf-mail@correo.com", { dia: 12, precio: 3000 })).data;
    const n5 = correos.length;
    assert.equal((await admin("POST", `/reservas/${t2.reservaId}/confirmar-pago`)).status, 200);
    await esperarCorreos(n5 + 1);
    assert.equal(correos.at(-1).para, "transf-mail@correo.com");

    // 6. Servidor de correo caído: la reserva queda confirmada igual y el correo se puede reenviar después.
    configurarCorreo(1);
    const d = await reservar(ctx.capilar, "10:00", "caido@correo.com", "Ana Caída");
    pagar(d.orden);
    assert.equal(await webhookMP(d.orden), 200);                       // Mercado Pago recibe 200: el fallo de correo no lo afecta
    const dd = await reserva(d.id);
    assert.equal(dd.estadoReserva, "confirmada");
    assert.equal(dd.estadoPago, "aprobado");
    assert.equal(dd.emailConfirmacionEnviadoEn, null);
    assert.equal(dd.emailConfirmacionIntentoEn, null);                 // no queda bloqueado
    assert.equal((await admin("POST", `/reservas/${d.id}/reenviar-confirmacion`)).status, 502);
    configurarCorreo();
    const n6 = correos.length;
    const ok = await admin("POST", `/reservas/${d.id}/reenviar-confirmacion`);
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.match(ok.data.mensaje, /caido@correo\.com/);
    await esperarCorreos(n6 + 1);
    assert.equal(correos.at(-1).para, "caido@correo.com");
    assert.ok((await reserva(d.id)).emailConfirmacionEnviadoEn);
    assert.equal((await admin("POST", `/reservas/${d.id}/reenviar-confirmacion`)).status, 200);   // el administrador puede reenviarlo otra vez

    // 7. Una reserva sin confirmar no recibe correo ni reenvío.
    const e = await reservar(ctx.capilar, "10:30", "pendiente@correo.com", "Pendiente Pérez");
    assert.equal((await admin("POST", `/reservas/${e.id}/reenviar-confirmacion`)).status, 409);
    await new Promise((r) => setTimeout(r, 150));
    assert.ok(!correos.some((x) => x.para === "pendiente@correo.com"));
    for (const k of ["SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "MAIL_FROM", "NEGOCIO_DIRECCION", "NEGOCIO_TELEFONO"]) delete process.env[k];
});

test("días de atención: por defecto lunes a sábado, editables, y coherentes en formulario público, panel y reprogramación", { skip: omitir }, async () => {
    // Próxima fecha (desde mañana) que cae en el día de la semana indicado (0 = domingo … 6 = sábado).
    const proximo = (dia, desde = 2) => { let n = desde; while (util.diaSemana(dias(n)) !== dia) n++; return dias(n); };

    // Valor por defecto: lunes a sábado (nunca domingo)
    const sab = (await admin("POST", "/especialistas", { nombre: "Dra. Solo Sábados", diasDisponibles: [6] })).data.especialista;
    const siempre = (await admin("POST", "/especialistas", { nombre: "Dr. Siempre Disponible" })).data.especialista;
    assert.deepEqual(sab.diasDisponibles, [6]);
    assert.deepEqual(siempre.diasDisponibles, [1, 2, 3, 4, 5, 6]);

    // Validación
    assert.equal((await admin("POST", "/especialistas", { nombre: "Sin días", diasDisponibles: [] })).status, 400);
    assert.equal((await admin("POST", "/especialistas", { nombre: "Día raro", diasDisponibles: [7] })).status, 400);
    assert.equal((await admin("POST", "/especialistas", { nombre: "Día repetido", diasDisponibles: [2, 2] })).status, 400);
    assert.equal((await admin("PATCH", `/especialistas/${sab._id}`, { diasDisponibles: [] })).status, 400);

    const consultaSab = (await admin("POST", "/servicios", { nombre: "Consulta sábados", esConsulta: true, especialistaId: sab._id })).data.servicio._id;
    const consultaSiempre = (await admin("POST", "/servicios", { nombre: "Consulta siempre", esConsulta: true, especialistaId: siempre._id })).data.servicio._id;
    const tratSab = (await admin("POST", "/servicios", { nombre: "Tratamiento sábados", especialistaId: sab._id })).data.servicio._id;

    // El público ve los días de cada especialista
    const publico = (await api("GET", "/especialistas")).data.especialistas.find((e) => e._id === sab._id);
    assert.deepEqual(publico.diasDisponibles, [6]);

    const sabado = proximo(6), lunes = proximo(1), domingo = proximo(0);
    const disp = (fecha, servicio, usarAdmin = false) => (usarAdmin ? admin : api)("GET", `/reservas/disponibilidad?fecha=${fecha}&servicioId=${servicio}`);

    // Disponibilidad: el sábado hay turnos; lunes y domingo no (y se explica por qué)
    const ds = await disp(sabado, consultaSab);
    assert.equal(ds.status, 200); assert.equal(ds.data.atiendeEseDia, true); assert.equal(ds.data.horariosDisponibles.length, 24);
    const dl = await disp(lunes, consultaSab);
    assert.equal(dl.status, 200); assert.equal(dl.data.atiendeEseDia, false); assert.deepEqual(dl.data.horariosDisponibles, []);
    assert.deepEqual(dl.data.diasDisponibles, [6]);
    assert.match(dl.data.mensaje, /Dra\. Solo Sábados no atiende los lunes\. Atiende: sábados/);
    assert.equal((await disp(sabado, tratSab)).status, 404);                           // el público sigue sin ver tratamientos
    assert.equal((await disp(lunes, tratSab, true)).data.atiendeEseDia, false);        // el panel usa la misma regla
    assert.equal((await disp(domingo, consultaSiempre)).data.atiendeEseDia, false);    // nadie atiende domingos por defecto
    assert.equal((await disp(lunes, consultaSiempre)).data.atiendeEseDia, true);

    // Reservar: el servidor también lo impide aunque se salte la interfaz
    const body = (fecha, extra = {}) => ({ ...datosCliente({ email: "dias@correo.com" }), servicioId: consultaSab, fecha, hora: "10:00", ...extra });
    const fuera = await api("POST", "/reservas", { body: body(lunes) });
    assert.equal(fuera.status, 400); assert.match(fuera.data.mensaje, /no atiende los lunes/);
    assert.equal((await api("POST", "/reservas", { body: body(domingo, { servicioId: consultaSiempre }) })).status, 400);
    const ok = await api("POST", "/reservas", { body: body(sabado) });
    assert.equal(ok.status, 201, JSON.stringify(ok.data));

    // Tratamiento dado de alta por el administrador: misma regla
    const trat = (fecha) => admin("POST", "/reservas/admin", { nombre: "Clienta Días", telefono: "098 765 432", email: "dias2@correo.com", servicioId: tratSab, fecha, hora: "09:00", precio: 2000 });
    const tFuera = await trat(lunes);
    assert.equal(tFuera.status, 400); assert.match(tFuera.data.mensaje, /no atiende los lunes/);
    const tOk = await trat(sabado);
    assert.equal(tOk.status, 201, JSON.stringify(tOk.data));

    // Reprogramar: solo a un día que atiende
    const reservaId = ok.data.reservaId;
    assert.equal((await admin("PATCH", `/reservas/${reservaId}`, { fecha: lunes })).status, 400);
    assert.equal((await admin("GET", `/reservas/${reservaId}/disponibilidad?fecha=${lunes}`)).data.atiendeEseDia, false);
    const otroSabado = util.sumarDias(sabado, 7);
    assert.equal((await admin("GET", `/reservas/${reservaId}/disponibilidad?fecha=${otroSabado}`)).data.horariosDisponibles.includes("10:00"), true);
    assert.equal((await admin("PATCH", `/reservas/${reservaId}`, { fecha: otroSabado })).status, 200);

    // Cambiar los días: ahora también atiende los lunes. Las reservas existentes siguen intactas.
    const cambio = await admin("PATCH", `/especialistas/${sab._id}`, { diasDisponibles: [6, 1] });
    assert.equal(cambio.status, 200);
    assert.deepEqual(cambio.data.especialista.diasDisponibles, [1, 6]);
    assert.equal(cambio.data.reservasFueraDeDia, 0);
    assert.equal((await disp(lunes, consultaSab)).data.atiendeEseDia, true);
    assert.equal((await api("POST", "/reservas", { body: body(lunes, { email: "lunes@correo.com", hora: "11:00" }) })).status, 201);

    // Quitar el sábado deja las reservas de sábado en pie, pero avisa cuántas quedaron fuera de día
    const quitar = await admin("PATCH", `/especialistas/${sab._id}`, { diasDisponibles: [1] });
    assert.equal(quitar.status, 200);
    assert.equal(quitar.data.reservasFueraDeDia, 2);   // la consulta reprogramada y el tratamiento (ambos en sábado)
    const reservas = (await admin("GET", "/reservas")).data.reservas;
    assert.equal(reservas.filter((r) => r.especialistaId === sab._id && r.estadoReserva === "pendiente_pago").length, 3);
    assert.equal((await disp(sabado, consultaSab)).data.atiendeEseDia, false);

    // Un especialista anterior a este campo (sin diasDisponibles guardado) se trata como lunes a sábado
    const viejo = (await admin("POST", "/especialistas", { nombre: "Dr. Antiguo" })).data.especialista._id;
    await M.Especialista.collection.updateOne({ _id: new mongoose.Types.ObjectId(viejo) }, { $unset: { diasDisponibles: "" } });
    const consultaViejo = (await admin("POST", "/servicios", { nombre: "Consulta antigua", esConsulta: true, especialistaId: viejo })).data.servicio._id;
    assert.deepEqual((await admin("GET", `/especialistas/${viejo}`)).data.especialista.diasDisponibles, [1, 2, 3, 4, 5, 6]);
    assert.equal((await disp(lunes, consultaViejo)).data.atiendeEseDia, true);
    assert.equal((await disp(domingo, consultaViejo)).data.atiendeEseDia, false);
});

test("aviso a administradores: uno o dos correos del .env, una sola vez por reserva pagada", { skip: omitir }, async () => {
    const reservar = async (hora, email, nombre, dia = 14) => {
        const r = await api("POST", "/reservas", { body: { ...datosCliente({ email, nombre }), servicioId: ctx.capilar, fecha: dias(dia), hora } });
        assert.equal(r.status, 201, JSON.stringify(r.data));
        return { id: r.data.reservaId, orden: (await M.Reserva.findById(r.data.reservaId)).mercadoPagoOrderId };
    };
    const esperar = async (n) => { for (let i = 0; i < 60 && correos.length < n; i++) await new Promise((r) => setTimeout(r, 50)); await new Promise((r) => setTimeout(r, 150)); };
    const aAdmins = () => correos.filter((c) => /^Reserva pagada/.test(c.asunto));
    configurarCorreo();

    // 1. Sin ADMIN_EMAIL_*: solo recibe correo el cliente.
    delete process.env.ADMIN_EMAIL_1; delete process.env.ADMIN_EMAIL_2;
    correos.length = 0;
    const a = await reservar("11:00", "sin-admins@correo.com", "Sin Admins");
    pagar(a.orden); assert.equal(await webhookMP(a.orden), 200); await esperar(1);
    assert.equal(correos.length, 1); assert.equal(aAdmins().length, 0);

    // 2. Con dos administradores (uno con mayúsculas y otro inválido/repetido): se envía un único correo a los dos válidos.
    Object.assign(process.env, { ADMIN_EMAIL_1: " Admin.Uno@Clinica.test ", ADMIN_EMAIL_2: "admin.dos@clinica.test" });
    correos.length = 0;
    const b = await reservar("11:30", "cliente-b@correo.com", "<i>Beatriz</i> Soto");
    pagar(b.orden); assert.equal(await webhookMP(b.orden), 200); await esperar(2);
    assert.equal(correos.length, 2);
    assert.equal(correos.filter((c) => c.para === "cliente-b@correo.com").length, 1);   // el cliente sigue recibiendo su confirmación
    const avisos = aAdmins();
    assert.equal(avisos.length, 1);
    assert.deepEqual(avisos[0].todos.sort(), ["admin.dos@clinica.test", "admin.uno@clinica.test"]);
    assert.equal(avisos[0].replyTo, "cliente-b@correo.com");
    for (const trozo of ["Beatriz", "Consulta capilar", "Dr. Luis Pérez", "11:30", "$500", "Mercado Pago", "cliente-b@correo.com", String(b.id)]) {
        assert.ok(avisos[0].texto.includes(trozo), `texto: falta «${trozo}»`);
    }
    assert.ok(avisos[0].html.includes("&lt;i&gt;Beatriz"), "el nombre del cliente se escapa en el HTML");
    assert.ok((await M.Reserva.findById(b.id)).emailAdminEnviadoEn);

    // 3. Un aviso de pago repetido no duplica el correo a los administradores.
    assert.equal(await webhookMP(b.orden), 200); await new Promise((r) => setTimeout(r, 300));
    assert.equal(aAdmins().length, 1);

    // 4. Con un solo administrador alcanza; una dirección inválida se ignora. La transferencia BROU también avisa.
    Object.assign(process.env, { ADMIN_EMAIL_1: "solo@clinica.test", ADMIN_EMAIL_2: "esto-no-es-un-correo" });
    correos.length = 0;
    const t = await altaTratamiento(ctx.limpieza, "13:00", "trat-admin@correo.com", { dia: 15, precio: 2000 });
    assert.equal(t.status, 201, JSON.stringify(t.data));
    assert.equal((await admin("POST", `/reservas/${t.data.reservaId}/confirmar-pago`)).status, 200);
    await esperar(2);
    const av = aAdmins();
    assert.equal(av.length, 1); assert.deepEqual(av[0].todos, ["solo@clinica.test"]);
    assert.match(av[0].texto, /Transferencia BROU/); assert.match(av[0].texto, /Resta cobrar en el local: \$1\.?000/);

    delete process.env.ADMIN_EMAIL_1; delete process.env.ADMIN_EMAIL_2; delete process.env.SMTP_HOST;
});

test("asistencia: el administrador deja constancia de si el cliente asistió (solo reservas pagadas cuyo turno ya empezó)", { skip: omitir }, async () => {
    const reservar = async (hora, email, dia = 16) => {
        const r = await api("POST", "/reservas", { body: { ...datosCliente({ email }), servicioId: ctx.capilar, fecha: dias(dia), hora } });
        assert.equal(r.status, 201, JSON.stringify(r.data));
        return { id: r.data.reservaId, orden: (await M.Reserva.findById(r.data.reservaId)).mercadoPagoOrderId };
    };
    const marcar = (id, asistencia) => admin("POST", `/reservas/${id}/asistencia`, { asistencia });
    delete process.env.SMTP_HOST;

    const r = await reservar("14:00", "asiste@correo.com");
    assert.equal((await api("POST", `/reservas/${r.id}/asistencia`, { body: { asistencia: "asistio" } })).status, 401);   // solo administración
    assert.equal((await marcar(r.id, "asistio")).status, 409);                // pendiente de pago: no corresponde
    pagar(r.orden); assert.equal(await webhookMP(r.orden), 200);
    assert.equal((await marcar(r.id, "asistio")).status, 409);                // confirmada pero el turno es futuro
    assert.equal((await admin("GET", `/reservas/${r.id}`)).data.reserva.turnoIniciado, false);
    assert.equal((await marcar(r.id, "quizas")).status, 400);
    assert.equal((await admin("POST", `/reservas/${r.id}/asistencia`, {})).status, 400);

    // El turno ya empezó (se simula moviendo la reserva al pasado): ahora se puede marcar
    await M.Reserva.updateOne({ _id: r.id }, { $set: { fecha: dias(-1) } });
    assert.equal((await admin("GET", `/reservas/${r.id}`)).data.reserva.turnoIniciado, true);
    const ok = await marcar(r.id, "asistio");
    assert.equal(ok.status, 200); assert.equal(ok.data.reserva.asistencia, "asistio"); assert.ok(ok.data.reserva.asistenciaMarcadaEn);
    assert.equal((await admin("GET", "/reservas")).data.reservas.find((x) => x._id === r.id).asistencia, "asistio");

    // Corregir: cambiar a «no asistió» y quitar la marca
    assert.equal((await marcar(r.id, "no_asistio")).data.reserva.asistencia, "no_asistio");
    const quitada = await marcar(r.id, null);
    assert.equal(quitada.status, 200); assert.equal(quitada.data.reserva.asistencia, null); assert.equal(quitada.data.reserva.asistenciaMarcadaEn, null);

    // Una reserva cancelada no admite constancia, y quien ya figura como asistente no se puede cancelar sin corregir antes
    const c = await reservar("14:30", "cancelada@correo.com", 17);
    pagar(c.orden); assert.equal(await webhookMP(c.orden), 200);
    await M.Reserva.updateOne({ _id: c.id }, { $set: { fecha: dias(-1) } });
    assert.equal((await marcar(c.id, "asistio")).status, 200);
    const bloqueo = await admin("POST", `/reservas/${c.id}/cancelar`);
    assert.equal(bloqueo.status, 409); assert.match(bloqueo.data.mensaje, /asistente/);
    assert.equal((await marcar(c.id, null)).status, 200);
    assert.equal((await admin("POST", `/reservas/${c.id}/cancelar`)).status, 200);
    assert.equal((await marcar(c.id, "asistio")).status, 409);
    assert.equal((await marcar("0123456789abcdef01234567", "asistio")).status, 404);
});

test("errores: respuestas uniformes", { skip: omitir }, async () => {
    const res = await realFetch(`${base}/v1/reservas`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{malo" });
    assert.equal(res.status, 400);
    assert.equal((await api("GET", "/ordenes/ORD1")).status, 401);
});
