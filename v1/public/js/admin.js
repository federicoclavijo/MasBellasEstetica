// Login y panel de administración. La autenticación y los permisos son del backend (JWT);
// aquí solo se envía el token y se reacciona a 401/403.
import * as api from "./api.js";
import { ApiError, sesion } from "./api.js";
import {
  el, $, vaciar, toast, setCargando, abrirDialogo, confirmar, formatearMoneda, formatearFechaCorta, hoyISO, fotoPerfil, iniciales, normalizarTelefonoUY, formatearTelefonoUY, formatearCedulaUY,
  DIAS_ABREV, DIAS_SEMANA, DIAS_POR_DEFECTO, diasDe, textoDias, sugerirFechas,
} from "./ui.js";

const vistaLogin = $("#vista-login");
const vistaPanel = $("#vista-panel");
const contenido = $("#panel-contenido");

const estado = {
  seccion: "reservas",
  reservas: [], servicios: [], especialistas: [],
  filtros: { texto: "", tipo: "", estadoReserva: "", estadoPago: "", asistencia: "", fecha: "", orden: "fecha_desc" },
  filtroServicios: { texto: "", tipo: "" }, // tipo: "" (todos) | "consulta" | "tratamiento"
};

// --- Sesión ---------------------------------------------------------------------------
function mostrarLogin(mensaje) {
  vistaPanel.hidden = true;
  vistaLogin.hidden = false;
  const aviso = vaciar($("#login-aviso"));
  aviso.hidden = !mensaje;
  if (mensaje) aviso.append(el("div", { class: "notice notice--warn" }, mensaje));
  $("#login-user").focus();
}

function mostrarPanel() {
  vistaLogin.hidden = true;
  vistaPanel.hidden = false;
  cargarSeccion(estado.seccion);
}

window.addEventListener("mb:sesion-expirada", () => mostrarLogin("Tu sesión expiró. Inicia sesión nuevamente."));

$("#toggle-pass").addEventListener("click", (e) => {
  const input = $("#login-pass");
  const visible = input.type === "text";
  input.type = visible ? "password" : "text";
  e.currentTarget.textContent = visible ? "Mostrar" : "Ocultar";
  e.currentTarget.setAttribute("aria-pressed", String(!visible));
});

let iniciandoSesion = false;
$("#form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (iniciandoSesion) return;
  const user = $("#login-user").value.trim();
  const pass = $("#login-pass").value;
  const aviso = vaciar($("#login-aviso"));
  if (!user || !pass) {
    aviso.hidden = false;
    aviso.append(el("div", { class: "notice notice--error" }, "Ingresa tu usuario y contraseña."));
    return;
  }
  iniciandoSesion = true;
  const boton = $("#btn-login");
  setCargando(boton, true, "Ingresando…");
  try {
    const { token } = await api.login(user, pass);
    if (!token) throw new ApiError(500, "El servidor no devolvió una sesión válida.");
    sesion.set(token);
    $("#login-pass").value = "";
    aviso.hidden = true;
    mostrarPanel();
  } catch (error) {
    aviso.hidden = false;
    aviso.append(el("div", { class: "notice notice--error" },
      error instanceof ApiError && error.status === 401 ? "Usuario o contraseña incorrectos." : error.message));
  } finally {
    iniciandoSesion = false;
    setCargando(boton, false);
  }
});

$("#btn-logout").addEventListener("click", () => { sesion.clear(); mostrarLogin(); });

// --- Navegación --------------------------------------------------------------------------
$("#tabs").addEventListener("click", (e) => {
  const tab = e.target.closest(".tab");
  if (tab) cargarSeccion(tab.dataset.seccion);
});

const cargarCatalogo = () => Promise.all([api.listarServicios(), api.listarEspecialistas()]).then(([s, e]) => Object.assign(estado, { servicios: s, especialistas: e }));

const SECCIONES = {
  reservas: { cargar: () => Promise.all([api.listarReservas(), api.listarServicios(), api.listarEspecialistas()]).then(([r, s, e]) => Object.assign(estado, { reservas: r, servicios: s, especialistas: e })), pintar: pintarReservas },
  especialistas: { cargar: cargarCatalogo, pintar: pintarEspecialistas },
  servicios: { cargar: cargarCatalogo, pintar: pintarServicios },
};

async function cargarSeccion(nombre) {
  estado.seccion = nombre;
  document.querySelectorAll(".tab").forEach((t) => t.toggleAttribute("aria-current", t.dataset.seccion === nombre));
  document.querySelectorAll(".tab").forEach((t) => { if (t.dataset.seccion === nombre) t.setAttribute("aria-current", "page"); });
  vaciar(contenido).append(el("p", { class: "empty" }, "Cargando…"));
  try {
    await SECCIONES[nombre].cargar();
    SECCIONES[nombre].pintar();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return; // ya se redirigió al login
    vaciar(contenido).append(
      el("div", { class: "notice notice--error" }, error.message),
      el("button", { class: "btn btn--ghost btn--sm", type: "button", style: "margin-top:.8rem", onclick: () => cargarSeccion(nombre) }, "Reintentar"),
    );
  }
}
const recargar = () => cargarSeccion(estado.seccion);

// --- Componentes comunes ----------------------------------------------------------------------
// `accionNueva` es un botón opcional ("Nuevo servicio", "Nuevo especialista"...).
function cabecera(titulo, cantidad, accionNueva) {
  return el("div", { class: "panel__head" },
    el("div", {}, el("h1", {}, titulo), el("span", { class: "panel__count" }, cantidad)),
    accionNueva ? el("button", { type: "button", class: "btn btn--primary btn--sm", onclick: accionNueva.onclick }, accionNueva.texto) : null);
}

function tabla(columnas, filas, vacio) {
  if (!filas.length) return el("p", { class: "empty" }, vacio);
  return el("div", { class: "table-wrap" },
    el("table", { class: "data" },
      el("thead", {}, el("tr", {}, columnas.map((c) => el("th", { scope: "col" }, c)))),
      el("tbody", {}, filas.map((celdas) =>
        el("tr", {}, celdas.map((celda, i) => {
          const esAcciones = i === celdas.length - 1 && celda?.esAcciones;
          return el("td", { "data-label": esAcciones ? null : columnas[i], class: esAcciones ? "acciones" : null },
            esAcciones ? el("div", { class: "acciones__lista" }, celda.nodos) : celda);
        })))),
    ),
  );
}
const acciones = (...nodos) => ({ esAcciones: true, nodos: nodos.filter(Boolean) });
const botonFila = (texto, etiqueta, onclick) =>
  el("button", { type: "button", class: "btn btn--ghost btn--sm", "aria-label": etiqueta, onclick }, texto);

const BADGE = { confirmada: "ok", aprobado: "ok", pendiente_pago: "warn", pendiente: "warn", cancelada: "err", expirada: "err", rechazado: "err", reembolsado: "" };
const ETIQUETA = { pendiente_pago: "Pendiente de pago", confirmada: "Confirmada", cancelada: "Cancelada", expirada: "Expirada", pendiente: "Pendiente", aprobado: "Aprobado", rechazado: "Rechazado", reembolsado: "Reembolsado" };
const ETIQUETA_PAGO = { pendiente: "Pago pendiente", aprobado: "Pago aprobado", rechazado: "Pago rechazado", reembolsado: "Reembolsado" };
const badge = (v, etiquetas = ETIQUETA) => el("span", { class: `badge ${BADGE[v] ? `badge--${BADGE[v]}` : ""}` }, etiquetas[v] || v || "—");

function mostrarErrorForm(box, mensaje) { box.hidden = false; vaciar(box).append(el("div", { class: "notice notice--error" }, mensaje)); }
const textoError = (error) => (error instanceof ApiError ? error.message : "No se pudo completar la operación.");

const ORDEN_DIAS = [1, 2, 3, 4, 5, 6, 0]; // la semana se muestra de lunes a domingo

// Formulario genérico para alta y edición.
//  - modo "crear": envía todos los campos completados.
//  - modo "editar": envía solo los que cambiaron.
// Campos: { name, label, type (text|number|date|select|checkbox|file), required, options, hint, parse, onChange }
// Un campo deshabilitado (p. ej. el precio de la consulta, que fija el sistema) no se envía.
function formulario({ titulo, modo, valores = {}, campos, textoGuardar, guardar }) {
  abrirDialogo(titulo, (dialog, cerrar) => {
    const errorBox = el("div", { class: "form-error", role: "alert", hidden: true });
    const controles = {};
    const form = el("form", { novalidate: true },
      errorBox,
      campos.map((c) => {
        const id = `f-${c.name}`;
        let control;
        if (c.type === "select") {
          control = el("select", { class: "input", id, name: c.name }, c.options.map((o) =>
            el("option", { value: o.value, selected: String(o.value) === String(valores[c.name] ?? "") }, o.label)));
        } else if (c.type === "checkbox") {
          control = el("input", { type: "checkbox", id, name: c.name, checked: Boolean(valores[c.name]) });
        } else if (c.type === "file") {
          control = el("input", { class: "input", type: "file", id, name: c.name, accept: "image/*" });
        } else if (c.type === "dias") {
          // Días de la semana (lunes a domingo): el valor es un arreglo de números 0-6 (0 = domingo).
          const marcados = new Set(valores[c.name] ?? DIAS_POR_DEFECTO);
          control = el("div", { class: "dias-selector", id, role: "group", "aria-labelledby": `${id}-label` },
            ORDEN_DIAS.map((d) => el("label", { class: "dia", title: DIAS_SEMANA[d] },
              el("input", { type: "checkbox", value: String(d), checked: marcados.has(d), "aria-label": DIAS_SEMANA[d] }),
              el("span", {}, DIAS_ABREV[d]))));
        } else if (c.type === "multi") {
          // Lista de casillas: el valor es un arreglo de ids.
          const marcados = new Set(valores[c.name] ?? []);
          control = el("div", { class: "checks", id, role: "group", "aria-labelledby": `${id}-label` },
            c.options.length
              ? c.options.map((o) => el("label", { class: "check" },
                  el("input", { type: "checkbox", value: o.value, checked: marcados.has(o.value) }),
                  el("span", {}, o.label, o.nota ? el("small", { class: "sub" }, o.nota) : null)))
              : el("p", { class: "field__hint" }, "Todavía no hay servicios creados."));
        } else {
          control = el("input", { class: "input", id, name: c.name, type: c.type || "text", value: valores[c.name] ?? "", min: c.min, step: c.step, required: c.required, maxlength: c.maxlength });
        }
        controles[c.name] = control;
        return c.type === "checkbox"
          ? el("div", { class: "field" }, el("label", { class: "check", for: id }, control, c.label))
          : el("div", { class: "field" }, el("label", { class: "field__label", id: `${id}-label`, for: c.type === "multi" || c.type === "dias" ? null : id }, c.label), control, c.hint ? el("p", { class: "field__hint" }, c.hint) : null);
      }),
      el("div", { class: "modal__acciones" },
        el("button", { type: "button", class: "btn btn--ghost", onclick: cerrar }, "Cancelar"),
        el("button", { type: "submit", class: "btn btn--primary" }, textoGuardar || "Guardar"),
      ),
    );

    for (const c of campos) {
      if (c.onChange) {
        controles[c.name].addEventListener("change", () => c.onChange(controles[c.name], controles));
        c.onChange(controles[c.name], controles);
      }
    }

    let guardando = false;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (guardando) return;
      const datos = {};
      let archivo = null;
      for (const c of campos) {
        const ctl = controles[c.name];
        if (c.type === "file") { archivo = ctl.files[0] || null; continue; }
        if (ctl.disabled) continue;
        if (c.type === "dias") {
          const dias = [...ctl.querySelectorAll("input:checked")].map((i) => Number(i.value)).sort((a, b) => a - b);
          if (!dias.length) { mostrarErrorForm(errorBox, `«${c.label}»: elige al menos un día.`); return; }
          const antes = [...(valores[c.name] ?? DIAS_POR_DEFECTO)].sort((a, b) => a - b).join(",");
          if (modo === "crear" || dias.join(",") !== antes) datos[c.name] = dias;
          continue;
        }
        if (c.type === "multi") {
          const ids = [...ctl.querySelectorAll("input:checked")].map((i) => i.value);
          const antes = [...(valores[c.name] ?? [])].sort().join(",");
          if (modo === "editar" ? ids.slice().sort().join(",") !== antes : ids.length) datos[c.name] = ids;
          continue;
        }
        let valor;
        if (c.type === "checkbox") valor = ctl.checked;
        else if (c.type === "number") valor = ctl.value === "" ? "" : Number(ctl.value);
        else valor = c.parse ? c.parse(ctl.value.trim()) : ctl.value.trim();
        if (c.required && (valor === "" || Number.isNaN(valor))) { mostrarErrorForm(errorBox, `«${c.label}» es obligatorio.`); return; }
        if (c.type === "number" && valor !== "" && Number.isNaN(valor)) { mostrarErrorForm(errorBox, `Revisa el campo «${c.label}».`); return; }
        if ((valor === "" || valor === null) && modo === "crear") continue;
        const original = valores[c.name];
        const igual = valor === original || ((valor === "" || valor === null) && (original === undefined || original === null || original === ""));
        if (modo === "editar" && igual) continue;
        if (c.type === "number" && valor === "") valor = null;
        datos[c.name] = valor;
      }
      if (modo === "editar" && !Object.keys(datos).length && !archivo) { mostrarErrorForm(errorBox, "No hay cambios para guardar."); return; }
      guardando = true;
      const boton = $("button[type=submit]", form);
      setCargando(boton, true, "Guardando…");
      errorBox.hidden = true;
      try {
        await guardar(datos, archivo);
        toast(modo === "crear" ? "Creado correctamente." : "Cambios guardados.", "ok");
        cerrar();
        recargar();
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) { cerrar(); return; }
        mostrarErrorForm(errorBox, textoError(error)); // los datos del formulario se conservan
      } finally {
        guardando = false;
        setCargando(boton, false);
      }
    });
    dialog.append(form);
  });
}

async function accionConfirmada({ titulo, mensaje, confirmarTexto, peligro, ejecutar, exito }) {
  if (!(await confirmar({ titulo, mensaje, confirmarTexto, peligro }))) return;
  try {
    await ejecutar();
    toast(exito, "ok");
    recargar();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return;
    toast(textoError(error), "error");
  }
}

// --- Reservas -------------------------------------------------------------------------------------
const nombreDe = (lista, id) => lista.find((x) => x._id === id)?.nombre;
const servicioDe = (r) => r.servicioNombre || nombreDe(estado.servicios, r.servicioId) || "Eliminado";
const especialistaDe = (r) => r.especialistaNombre || nombreDe(estado.especialistas, r.especialistaId) || "Eliminado";
// Las reservas anteriores al campo "tipo" se reconocen por el porcentaje de seña (100 = consulta).
const tipoDe = (r) => r.tipo ?? (r.porcentajeSena === 100 ? "consulta" : "tratamiento");
// Inserta puntos de corte permitidos antes del «@» y de cada «.»: el correo baja de línea solo ahí, nunca a mitad de palabra.
const correoEnLineas = (email) => String(email ?? "").split(/(?=[@.])/).flatMap((t, i) => (i ? [document.createElement("wbr"), t] : [t]));
const especialistaPorId = (id) => estado.especialistas.find((e) => e._id === id) ?? null;
const esActiva = (r) => r.estadoReserva === "pendiente_pago" || r.estadoReserva === "confirmada";

// Estado del pago + datos para ubicarlo en Mercado Pago (id de la orden) y, si se devolvió, cuánto.
// Asistencia: "asistio" | "no_asistio" | "sin_registrar" (confirmada cuyo turno ya empezó y nadie marcó) | null (no aplica todavía).
const asistenciaDe = (r) => {
  if (r.asistencia) return r.asistencia;
  return r.estadoReserva === "confirmada" && r.turnoIniciado ? "sin_registrar" : null;
};
const ETIQUETA_ASISTENCIA = { asistio: "Asistió", no_asistio: "No asistió", sin_registrar: "Asistencia sin registrar" };
const BADGE_ASISTENCIA = { asistio: "badge--ok", no_asistio: "badge--err", sin_registrar: "badge--warn" };

function celdaPago(r) {
  return el("span", {},
    badge(r.estadoPago, ETIQUETA_PAGO),
    r.estadoPago === "reembolsado" && r.montoReembolsado != null
      ? el("small", { class: "sub" }, `Devuelto ${formatearMoneda(r.montoReembolsado)}${r.reembolsoPorcentaje != null ? ` (${r.reembolsoPorcentaje} %)` : ""}`) : null,
    r.estadoReserva === "confirmada"
      ? el("small", { class: "sub" }, r.emailConfirmacionEnviadoEn ? "✉ Correo de confirmación enviado" : "✉ Correo de confirmación sin enviar") : null,
    r.estadoPago === "aprobado" && r.metodoPago === "transferencia" ? el("small", { class: "sub" }, "Por transferencia BROU") : null,
    r.mercadoPagoOrderId ? el("small", { class: "sub", title: "ID de la orden en Mercado Pago", style: "overflow-wrap:anywhere" }, `Orden ${r.mercadoPagoOrderId}`) : null);
}

// Consulta: valor fijo. Tratamiento: total acordado, seña (50 %) y lo que resta abonar en el local.
function celdaImporte(r) {
  if (tipoDe(r) !== "tratamiento") return formatearMoneda(r.precioTotal);
  return el("span", {}, formatearMoneda(r.precioTotal),
    el("small", { class: "sub" }, `Seña ${formatearMoneda(r.montoSena)} · Resta ${formatearMoneda(r.precioTotal - r.montoSena)} en el local`));
}

function reservasFiltradas() {
  const { texto, tipo, estadoReserva, estadoPago, asistencia, fecha, orden } = estado.filtros;
  const q = texto.trim().toLowerCase();
  const lista = estado.reservas.filter((r) =>
    (!q || [r.nombre, r.cedula, r.email, r.telefono, servicioDe(r), especialistaDe(r)].some((v) => String(v).toLowerCase().includes(q)))
    && (!tipo || tipoDe(r) === tipo)
    && (!estadoReserva || r.estadoReserva === estadoReserva)
    && (!estadoPago || r.estadoPago === estadoPago)
    && (!asistencia || asistenciaDe(r) === asistencia)
    && (!fecha || r.fecha === fecha));
  const clave = (r) => `${r.fecha} ${r.hora}`;
  lista.sort((a, b) => (orden === "fecha_asc" ? clave(a).localeCompare(clave(b)) : clave(b).localeCompare(clave(a))));
  return lista;
}

function pintarReservas() {
  const f = estado.filtros;
  const campo = (etiqueta, control) => el("div", { class: "field", style: "margin:0" }, el("label", { class: "visually-hidden" }, etiqueta), control);
  const select = (etiqueta, clave, opciones) => campo(etiqueta, el("select", {
    class: "input", "aria-label": etiqueta, onchange: (e) => { f[clave] = e.target.value; repintarLista(); },
  }, opciones.map(([v, t]) => el("option", { value: v, selected: f[clave] === v }, t))));

  const lista = el("div", { id: "lista-reservas" });
  const conteo = el("span", { class: "panel__count" });
  function repintarLista() {
    const filas = reservasFiltradas();
    conteo.textContent = `${filas.length} de ${estado.reservas.length}`;
    vaciar(lista).append(tabla(
      ["Cliente", "Servicio", "Fecha y hora", "Importe", "Estado", "Acciones"],
      filas.map((r) => [
        el("span", {}, el("strong", {}, r.nombre),
          r.cedula ? el("small", { class: "sub sub--dato" }, `CI ${formatearCedulaUY(r.cedula)}`) : null,
          el("small", { class: "sub sub--email" }, correoEnLineas(r.email)),
          r.telefono ? el("small", { class: "sub sub--dato" }, formatearTelefonoUY(r.telefono)) : null),
        el("span", {}, el("strong", {}, servicioDe(r)),
          el("small", { class: "sub" }, `${tipoDe(r) === "tratamiento" ? "Tratamiento" : "Consulta"} · ${especialistaDe(r)}`)),
        el("span", { class: "nowrap" }, formatearFechaCorta(r.fecha), el("small", { class: "sub" }, `${r.hora} hs`)),
        celdaImporte(r),
        el("div", { class: "estado" }, badge(r.estadoReserva),
          asistenciaDe(r) ? el("span", { class: `badge ${BADGE_ASISTENCIA[asistenciaDe(r)]}` }, ETIQUETA_ASISTENCIA[asistenciaDe(r)]) : null,
          celdaPago(r)),
        acciones(
          r.estadoReserva === "pendiente_pago" && tipoDe(r) === "tratamiento" && r.telefono ? botonFila("WhatsApp", `Enviar el pago por WhatsApp a ${r.nombre}`, () => reenviarWhatsappUI(r)) : null,
          r.estadoReserva === "confirmada" && r.turnoIniciado && !r.asistencia ? botonFila("Asistió", `Registrar que ${r.nombre} asistió`, () => asistenciaUI(r, "asistio")) : null,
          r.estadoReserva === "confirmada" && r.turnoIniciado && !r.asistencia ? botonFila("No asistió", `Registrar que ${r.nombre} no asistió`, () => asistenciaUI(r, "no_asistio")) : null,
          r.asistencia ? botonFila("Corregir asistencia", `Quitar la marca de asistencia de ${r.nombre}`, () => asistenciaUI(r, null)) : null,
          r.estadoReserva === "confirmada" ? botonFila("Reenviar correo", `Reenviar el correo de confirmación a ${r.nombre}`, () => reenviarCorreoUI(r)) : null,
          r.estadoReserva === "pendiente_pago" ? botonFila("Confirmar pago", `Confirmar el pago de ${r.nombre}`, () => confirmarPagoUI(r)) : null,
          esActiva(r) ? botonFila("Modificar", `Modificar reserva de ${r.nombre}`, () => modificarReservaUI(r)) : null,
          esActiva(r) ? botonFila("Cancelar", `Cancelar reserva de ${r.nombre}`, () => cancelarReservaUI(r)) : null,
          !esActiva(r) && r.estadoPago === "aprobado" ? botonFila("Reembolsar", `Reembolsar a ${r.nombre}`, () => reembolsarUI(r)) : null,
          !esActiva(r) && r.estadoPago === "aprobado" ? botonFila("Marcar reembolso", `Marcar como reembolsada la reserva de ${r.nombre}`, () => reembolsoUI(r)) : null,
          !esActiva(r) && r.estadoPago !== "aprobado" ? botonFila("Eliminar", `Eliminar reserva de ${r.nombre}`, () => eliminarReservaUI(r)) : null,
        ),
      ]),
      "No hay reservas que coincidan.",
    ));
  }

  vaciar(contenido).append(
    cabecera("Reservas", "", { texto: "Nuevo tratamiento", onclick: nuevaReservaTratamientoUI }),
    el("div", { class: "toolbar" },
      campo("Buscar", el("input", { class: "input", type: "search", placeholder: "Buscar cliente, correo, teléfono…", "aria-label": "Buscar reservas", value: f.texto, oninput: (e) => { f.texto = e.target.value; repintarLista(); } })),
      select("Tipo de reserva", "tipo", [["", "Consultas y tratamientos"], ["consulta", "Solo consultas"], ["tratamiento", "Solo tratamientos"]]),
      select("Estado de la reserva", "estadoReserva", [["", "Toda reserva"], ...Object.entries({ pendiente_pago: "Pendiente de pago", confirmada: "Confirmada", cancelada: "Cancelada", expirada: "Expirada" })]),
      select("Asistencia", "asistencia", [["", "Toda asistencia"], ["asistio", "Asistió"], ["no_asistio", "No asistió"], ["sin_registrar", "Sin registrar"]]),
      select("Estado del pago", "estadoPago", [["", "Todo pago"], ["pendiente", "Pendiente"], ["aprobado", "Aprobado"], ["rechazado", "Rechazado"], ["reembolsado", "Reembolsado"]]),
      campo("Fecha", el("input", { class: "input", type: "date", "aria-label": "Filtrar por fecha", value: f.fecha, onchange: (e) => { f.fecha = e.target.value; repintarLista(); } })),
      select("Orden", "orden", [["fecha_desc", "Más recientes primero"], ["fecha_asc", "Más antiguas primero"]]),
    ),
    conteo, lista,
  );
  repintarLista();
}

// Reprogramar: se elige una fecha y se muestran solo los horarios realmente libres del especialista.
function modificarReservaUI(r) {
  abrirDialogo("Reprogramar reserva", (dialog, cerrar) => {
    const errorBox = el("div", { class: "form-error", role: "alert", hidden: true });
    const fecha = el("input", { class: "input", id: "rp-fecha", type: "date", value: r.fecha, min: hoyISO(), required: true });
    const hora = el("select", { class: "input", id: "rp-hora" });
    const ayuda = el("p", { class: "field__hint" });
    const sugeridas = el("div", { class: "fechas-sugeridas" });
    const mostrarSugeridas = () => sugerirFechas({
      cont: sugeridas, especialista: especialistaPorId(r.especialistaId), actual: fecha.value,
      onElegir: (f) => { fecha.value = f; cargarHoras(); },
    });
    let solicitud = 0;

    async function cargarHoras() {
      const mia = ++solicitud;
      mostrarSugeridas();
      vaciar(hora).append(el("option", { value: "" }, "Cargando…"));
      ayuda.textContent = "";
      if (!fecha.value) { vaciar(hora).append(el("option", { value: "" }, "Elige una fecha")); return; }
      try {
        const { horariosDisponibles, atiendeEseDia, mensaje } = await api.disponibilidadDeReserva(r._id, fecha.value);
        if (mia !== solicitud) return;
        if (atiendeEseDia === false) {
          vaciar(hora).append(el("option", { value: "" }, "Elige otra fecha"));
          ayuda.textContent = mensaje;
          return;
        }
        vaciar(hora).append(el("option", { value: "" }, horariosDisponibles.length ? "Elige un horario" : "Sin horarios disponibles"),
          ...horariosDisponibles.map((h) => el("option", { value: h, selected: fecha.value === r.fecha && h === r.hora }, h)));
      } catch (error) {
        if (mia !== solicitud) return;
        vaciar(hora).append(el("option", { value: "" }, "No se pudieron cargar"));
        ayuda.textContent = textoError(error);
      }
    }
    fecha.addEventListener("change", cargarHoras);

    const form = el("form", { novalidate: true },
      el("p", { class: "modal__texto" }, `${r.nombre} · ${servicioDe(r)} · actualmente ${formatearFechaCorta(r.fecha)} a las ${r.hora}.`),
      errorBox,
      el("div", { class: "field" }, el("label", { class: "field__label", for: "rp-fecha" }, "Nueva fecha"), fecha, sugeridas),
      el("div", { class: "field" }, el("label", { class: "field__label", for: "rp-hora" }, "Nuevo horario"), hora, ayuda),
      el("div", { class: "modal__acciones" },
        el("button", { type: "button", class: "btn btn--ghost", onclick: cerrar }, "Cancelar"),
        el("button", { type: "submit", class: "btn btn--primary" }, "Guardar cambios")),
    );
    let guardando = false;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (guardando) return;
      if (!fecha.value || !hora.value) { mostrarErrorForm(errorBox, "Elige una fecha y un horario disponible."); return; }
      const cambios = {};
      if (fecha.value !== r.fecha) cambios.fecha = fecha.value;
      if (hora.value !== r.hora) cambios.hora = hora.value;
      if (!Object.keys(cambios).length) { mostrarErrorForm(errorBox, "No hay cambios para guardar."); return; }
      guardando = true;
      const boton = $("button[type=submit]", form);
      setCargando(boton, true, "Guardando…");
      errorBox.hidden = true;
      try {
        await api.modificarReserva(r._id, cambios);
        toast("Reserva reprogramada.", "ok");
        cerrar();
        recargar();
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) { cerrar(); return; }
        mostrarErrorForm(errorBox, textoError(error));
        cargarHoras(); // por si el horario se ocupó mientras tanto
      } finally {
        guardando = false;
        setCargando(boton, false);
      }
    });
    dialog.append(form);
    cargarHoras();
  });
}

// --- Alta de un tratamiento (lo hace el administrador) ----------------------------------------------------------
// Tras la consulta, si el cliente decide avanzar, el administrador agenda el tratamiento con el precio acordado.
// El cliente abona el 50 % de seña (Mercado Pago o transferencia BROU) y el resto en el local.
const SENA_PORCENTAJE_VISTA = 50; // solo para la vista previa: el importe real lo calcula el servidor

function whatsappUI(wa, titulo = "Enviar por WhatsApp") {
  abrirDialogo(titulo, (dialog, cerrar) => {
    const copiar = () => (navigator.clipboard?.writeText(wa.mensaje)
      .then(() => toast("Mensaje copiado.", "ok"))
      .catch(() => toast("No se pudo copiar el mensaje.", "error")));
    dialog.append(
      el("p", { class: "modal__texto" }, `Mensaje para ${formatearTelefonoUY(wa.telefono)}. Se abrirá WhatsApp con el texto listo: solo falta presionar «Enviar».`),
      el("pre", { class: "wa-preview", tabindex: "0" }, wa.mensaje),
      el("div", { class: "modal__acciones" },
        el("button", { type: "button", class: "btn btn--ghost", onclick: cerrar }, "Cerrar"),
        el("button", { type: "button", class: "btn btn--ghost", onclick: copiar }, "Copiar mensaje"),
        el("a", { class: "btn btn--primary", href: wa.url, target: "_blank", rel: "noopener" }, "Abrir WhatsApp")),
    );
  }, { ancho: "38rem" });
}

async function reenviarWhatsappUI(r) {
  try { whatsappUI(await api.whatsappDeReserva(r._id), "Enviar el pago por WhatsApp"); }
  catch (error) { if (!(error instanceof ApiError && error.status === 401)) toast(textoError(error), "error"); }
}

async function reenviarCorreoUI(r) {
  try {
    const { mensaje } = await api.reenviarConfirmacion(r._id);
    toast(mensaje, "ok");
    recargar();
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 401)) toast(textoError(error), "error");
  }
}

// Constancia de asistencia: se marca con un clic y se puede corregir quitando la marca.
async function asistenciaUI(r, asistencia) {
  try {
    const { mensaje } = await api.marcarAsistencia(r._id, asistencia);
    toast(mensaje, "ok");
    recargar();
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 401)) toast(textoError(error), "error");
  }
}

const confirmarPagoUI = (r) => accionConfirmada({
  titulo: "Confirmar pago",
  mensaje: `¿Recibiste el pago de ${formatearMoneda(r.montoSena)} de ${r.nombre} (por ejemplo por transferencia BROU)? La reserva quedará confirmada y se anulará el enlace de Mercado Pago para que no pague dos veces.`,
  confirmarTexto: "Confirmar pago",
  peligro: false,
  ejecutar: () => api.confirmarPago(r._id),
  exito: "Pago confirmado. La reserva quedó confirmada.",
});

function nuevaReservaTratamientoUI() {
  const tratamientos = estado.servicios.filter((s) => !s.esConsulta && s.activo && s.especialistaId);
  if (!tratamientos.length) {
    toast("No hay tratamientos activos con especialista asignado. Créalos en la sección Servicios.", "error");
    return;
  }

  abrirDialogo("Nuevo tratamiento", (dialog, cerrar) => {
    const errorBox = el("div", { class: "form-error", role: "alert", hidden: true });
    const campo = (id, etiqueta, control, hint) => el("div", { class: "field" },
      el("label", { class: "field__label", for: id }, etiqueta), control, hint ? el("p", { class: "field__hint" }, hint) : null);
    const entrada = (id, props) => el("input", { class: "input", id, ...props });

    // Autocompletar con un cliente que ya consultó
    const buscar = entrada("nt-buscar", { type: "search", placeholder: "Nombre, correo o teléfono…", autocomplete: "off" });
    const resultados = el("div", { class: "clientes", role: "listbox", "aria-label": "Clientes encontrados" });

    const nombre = entrada("nt-nombre", { type: "text", maxlength: 80, autocomplete: "off", required: true });
    const telefono = entrada("nt-telefono", { type: "tel", placeholder: "099 123 456", maxlength: 20, autocomplete: "off", required: true });
    const email = entrada("nt-email", { type: "email", maxlength: 120, autocomplete: "off", required: true });
    const cedula = entrada("nt-cedula", { type: "text", inputmode: "numeric", maxlength: 14, autocomplete: "off" });
    const nacimiento = entrada("nt-nac", { type: "date", max: hoyISO() });

    const servicio = el("select", { class: "input", id: "nt-servicio" },
      el("option", { value: "" }, "Elige un tratamiento"),
      ...tratamientos.map((s) => el("option", { value: s._id }, `${s.nombre} — ${nombreDe(estado.especialistas, s.especialistaId) ?? ""}`)));
    const fecha = entrada("nt-fecha", { type: "date", min: hoyISO(), required: true });
    const hora = el("select", { class: "input", id: "nt-hora" }, el("option", { value: "" }, "Elige tratamiento y fecha"));
    const ayudaHora = el("p", { class: "field__hint" }, "");
    const sugeridas = el("div", { class: "fechas-sugeridas" });
    const especialistaElegido = () => especialistaPorId(tratamientos.find((t) => t._id === servicio.value)?.especialistaId);
    const mostrarSugeridas = () => sugerirFechas({
      cont: sugeridas, especialista: especialistaElegido(), actual: fecha.value,
      onElegir: (f) => { fecha.value = f; cargarHoras(); },
    });
    const precio = entrada("nt-precio", { type: "number", min: "1", step: "0.01", placeholder: "Ej. 3000", required: true });
    const vista = el("p", { class: "preview" }, "Indica el precio para ver la seña.");

    const actualizarVista = () => {
      const p = Number(precio.value);
      if (!(p > 0)) { vista.textContent = "Indica el precio para ver la seña."; return; }
      const sena = Math.round(p * SENA_PORCENTAJE_VISTA) / 100;
      vista.textContent = `Seña del ${SENA_PORCENTAJE_VISTA} %: ${formatearMoneda(sena)} · Resta abonar en el local: ${formatearMoneda(p - sena)}`;
    };
    precio.addEventListener("input", actualizarVista);

    let solicitud = 0;
    async function cargarHoras() {
      const mia = ++solicitud;
      ayudaHora.textContent = "";
      mostrarSugeridas();
      if (!servicio.value || !fecha.value) { vaciar(hora).append(el("option", { value: "" }, "Elige tratamiento y fecha")); return; }
      vaciar(hora).append(el("option", { value: "" }, "Cargando…"));
      try {
        const { horariosDisponibles, atiendeEseDia, mensaje } = await api.disponibilidadAdmin(fecha.value, servicio.value);
        if (mia !== solicitud) return;
        if (atiendeEseDia === false) {
          vaciar(hora).append(el("option", { value: "" }, "Elige otra fecha"));
          ayudaHora.textContent = mensaje;
          return;
        }
        vaciar(hora).append(el("option", { value: "" }, horariosDisponibles.length ? "Elige un horario" : "Sin horarios disponibles"),
          ...horariosDisponibles.map((h) => el("option", { value: h }, h)));
      } catch (error) {
        if (mia !== solicitud) return;
        vaciar(hora).append(el("option", { value: "" }, "No se pudieron cargar"));
        ayudaHora.textContent = textoError(error);
      }
    }
    servicio.addEventListener("change", () => {
      const s = tratamientos.find((t) => t._id === servicio.value);
      if (s?.precio && !precio.value) { precio.value = s.precio; actualizarVista(); } // precio de referencia, editable
      cargarHoras();
    });
    fecha.addEventListener("change", cargarHoras);

    let temporizador;
    buscar.addEventListener("input", () => {
      clearTimeout(temporizador);
      const q = buscar.value.trim();
      if (q.length < 2) { vaciar(resultados); return; }
      temporizador = setTimeout(async () => {
        try {
          const clientes = await api.buscarClientes(q);
          vaciar(resultados).append(...(clientes.length ? clientes : [null]).map((c) => c
            ? el("button", { type: "button", class: "cliente", role: "option", onclick: () => {
                nombre.value = c.nombre ?? ""; email.value = c.email ?? ""; telefono.value = c.telefono ? formatearTelefonoUY(c.telefono) : "";
                cedula.value = c.cedula ?? ""; nacimiento.value = c.fechaNacimiento ? String(c.fechaNacimiento).slice(0, 10) : "";
                buscar.value = ""; vaciar(resultados);
              } }, el("strong", {}, c.nombre), el("small", { class: "sub" }, [c.email, c.telefono ? formatearTelefonoUY(c.telefono) : null].filter(Boolean).join(" · ")))
            : el("p", { class: "field__hint" }, "No hay clientes que coincidan: completa los datos a mano.")));
        } catch { /* la búsqueda es solo una ayuda */ }
      }, 250);
    });

    const form = el("form", { novalidate: true },
      errorBox,
      campo("nt-buscar", "Buscar cliente que ya consultó (opcional)", buscar, "Autocompleta los datos de quien ya reservó una consulta."), resultados,
      el("div", { class: "grid-2" }, campo("nt-nombre", "Nombre completo", nombre), campo("nt-telefono", "Teléfono celular", telefono, "Se le enviará el mensaje por WhatsApp.")),
      el("div", { class: "grid-2" }, campo("nt-email", "Correo electrónico", email), campo("nt-cedula", "Cédula (opcional)", cedula)),
      campo("nt-nac", "Fecha de nacimiento (opcional)", nacimiento),
      campo("nt-servicio", "Tratamiento", servicio),
      el("div", { class: "grid-2" }, campo("nt-fecha", "Fecha", fecha), campo("nt-hora", "Horario", hora, null)),
      ayudaHora,
      sugeridas,
      campo("nt-precio", "Precio total del tratamiento (UYU)", precio, "Lo defines tú para este cliente: puede variar de un cliente a otro."),
      vista,
      el("div", { class: "modal__acciones" },
        el("button", { type: "button", class: "btn btn--ghost", onclick: cerrar }, "Cancelar"),
        el("button", { type: "submit", class: "btn btn--primary" }, "Crear reserva")),
    );

    let guardando = false;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (guardando) return;
      const tel = normalizarTelefonoUY(telefono.value);
      const faltan = [];
      if (nombre.value.trim().length < 3) faltan.push("el nombre");
      if (!tel) faltan.push("un celular uruguayo válido (por ejemplo 099 123 456)");
      if (!email.value.trim() || !email.checkValidity()) faltan.push("un correo válido");
      if (!servicio.value) faltan.push("el tratamiento");
      if (!fecha.value || !hora.value) faltan.push("la fecha y el horario");
      if (!(Number(precio.value) > 0)) faltan.push("el precio");
      if (faltan.length) { mostrarErrorForm(errorBox, `Revisa: ${faltan.join(", ")}.`); return; }

      guardando = true;
      const boton = $("button[type=submit]", form);
      setCargando(boton, true, "Creando…");
      errorBox.hidden = true;
      try {
        const resultado = await api.crearReservaAdmin({
          nombre: nombre.value.trim(), telefono: tel, email: email.value.trim(),
          cedula: cedula.value.replace(/[.\-\s]/g, ""), fechaNacimiento: nacimiento.value,
          servicioId: servicio.value, fecha: fecha.value, hora: hora.value, precio: Number(precio.value),
        });
        toast("Reserva creada.", "ok");
        cerrar();
        recargar();
        whatsappUI(resultado.whatsapp, "Reserva creada: envía el pago por WhatsApp");
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) { cerrar(); return; }
        mostrarErrorForm(errorBox, textoError(error)); // los datos se conservan
        if (error instanceof ApiError && error.status === 409) cargarHoras();
      } finally {
        guardando = false;
        setCargando(boton, false);
      }
    });
    dialog.append(form);
  }, { ancho: "40rem" });
}

const cancelarReservaUI = (r) => accionConfirmada({
  titulo: "Cancelar reserva",
  mensaje: `¿Cancelar la reserva de ${r.nombre} del ${formatearFechaCorta(r.fecha)} a las ${r.hora}? El horario quedará libre.`
    + (r.estadoPago === "aprobado" ? " La seña ya fue pagada: después podrás devolverla con el botón «Reembolsar»." : ""),
  confirmarTexto: "Cancelar reserva",
  ejecutar: () => api.cancelarReserva(r._id),
  exito: "Reserva cancelada.",
});

// Devuelve el dinero a través de Mercado Pago (porcentaje configurable con REEMBOLSO_PORCENTAJE en el servidor).
const reembolsarUI = (r) => accionConfirmada({
  titulo: "Reembolsar pago",
  mensaje: `Se devolverán ${formatearMoneda(r.montoReembolsable)} (${r.porcentajeReembolsable} % de la seña de ${formatearMoneda(r.montoSena)}) a ${r.nombre} mediante Mercado Pago. `
    + `Orden ${r.mercadoPagoOrderId ?? "—"}. Esta acción mueve dinero y no se puede deshacer.`,
  confirmarTexto: `Reembolsar ${formatearMoneda(r.montoReembolsable)}`,
  ejecutar: () => api.reembolsarReserva(r._id),
  exito: "Reembolso realizado.",
});

// Para devoluciones hechas a mano en el panel de Mercado Pago: solo deja constancia en el sistema.
const reembolsoUI = (r) => accionConfirmada({
  titulo: "Marcar reembolso",
  mensaje: `Usa esto solo si ya devolviste el pago de ${r.nombre} a mano desde el panel de Mercado Pago (no se envía ningún dinero). La reserva quedará como reembolsada y podrás eliminarla.`,
  confirmarTexto: "Marcar como reembolsada",
  peligro: false,
  ejecutar: () => api.marcarReembolso(r._id),
  exito: "Reserva marcada como reembolsada.",
});

const eliminarReservaUI = (r) => accionConfirmada({
  titulo: "Eliminar reserva",
  mensaje: `¿Eliminar la reserva de ${r.nombre} del ${formatearFechaCorta(r.fecha)} a las ${r.hora}? Esta acción no se puede deshacer.`,
  ejecutar: () => api.eliminarReserva(r._id),
  exito: "Reserva eliminada.",
});

// --- Especialistas ----------------------------------------------------------------------------------------
const ROLES = [{ value: "Medico", label: "Médico" }, { value: "Cirujano", label: "Cirujano" }];

function pintarEspecialistas() {
  vaciar(contenido).append(
    cabecera("Especialistas", `${estado.especialistas.length} en total`, { texto: "Nuevo especialista", onclick: nuevoEspecialistaUI }),
    estado.especialistas.length
      ? el("div", { class: "cards" }, estado.especialistas.map((e) => el("article", { class: "card person" },
          el("div", { class: "person__top" },
            e.imagenPerfil ? el("img", { class: "avatar", src: fotoPerfil(e.imagenPerfil, 80), alt: `Foto de ${e.nombre}`, width: 80, height: 80, loading: "lazy", decoding: "async" }) : el("span", { class: "avatar", "aria-hidden": "true" }, iniciales(e.nombre)),
            el("div", {}, el("h2", {}, e.nombre), el("span", { class: "badge" }, ROLES.find((r) => r.value === e.rol)?.label || e.rol || "—"))),
          el("div", { class: "person__dias" },
            el("small", { class: "sub" }, `Atiende: ${textoDias(diasDe(e))}`),
            el("span", { class: "dias-pills", role: "img", "aria-label": `Días de atención: ${textoDias(diasDe(e))}` },
              ORDEN_DIAS.map((d) => el("span", { class: `dia-pill${diasDe(e).includes(d) ? " is-on" : ""}`, "aria-hidden": "true", title: DIAS_SEMANA[d] }, DIAS_ABREV[d].slice(0, 1))))),
          el("p", { class: "person__servicios" },
            el("small", { class: "sub" }, (e.servicios?.length ?? 0) === 0 ? "Sin servicios asignados" : `Servicios (${e.servicios.length})`),
            (e.servicios ?? []).length ? el("span", {}, e.servicios.map((x) => `${x.nombre} (${x.porcentaje === false ? "consulta" : "tratamiento"})`).join(" · ")) : null),
          el("div", { class: "person__actions" },
            botonFila("Modificar", `Modificar ${e.nombre}`, () => modificarEspecialistaUI(e)),
            botonFila("Eliminar", `Eliminar ${e.nombre}`, () => eliminarEspecialistaUI(e))))))
      : el("p", { class: "empty" }, "Todavía no hay especialistas registrados."),
  );
}

// Servicios que puede tener a cargo: todos; se avisa cuál tiene hoy otro especialista (al marcarlo se le quita).
const opcionesServicios = (especialistaId) => estado.servicios.map((s) => {
  const otro = s.especialistaId && s.especialistaId !== especialistaId ? nombreDe(estado.especialistas, s.especialistaId) : null;
  // Una consulta y un tratamiento pueden llamarse igual: se indica el tipo para distinguirlos.
  return { value: s._id, label: `${s.nombre} (${s.esConsulta ? "consulta" : "tratamiento"})`, nota: otro ? `Hoy a cargo de ${otro}` : null };
});

const camposEspecialista = (especialistaId) => [
  { name: "nombre", label: "Nombre", required: true, maxlength: 60 },
  { name: "rol", label: "Rol", type: "select", options: ROLES },
  { name: "diasDisponibles", label: "Días de atención", type: "dias", hint: "Los clientes y el panel solo permiten reservar los días marcados. Puedes cambiarlos cuando quieras: las reservas ya hechas no se cancelan." },
  { name: "serviciosIds", label: "Servicios a cargo", type: "multi", options: opcionesServicios(especialistaId) },
  { name: "imagen", label: "Foto de perfil", type: "file", hint: "Opcional. Máximo 5 MB." },
];

// El alta y el cambio de foto son dos pedidos: si la foto falla, el especialista ya quedó creado y se avisa.
async function guardarConFoto(crearORegistrar, archivo) {
  const id = await crearORegistrar();
  if (archivo) {
    try { await api.subirImagenEspecialista(id, archivo); }
    catch (error) { toast(`Se guardó, pero la foto no se pudo subir: ${textoError(error)}`, "error"); }
  }
}

const nuevoEspecialistaUI = () => formulario({
  titulo: "Nuevo especialista", modo: "crear", textoGuardar: "Crear especialista",
  valores: { rol: "Medico", diasDisponibles: DIAS_POR_DEFECTO },
  campos: camposEspecialista(null),
  guardar: (datos, archivo) => guardarConFoto(async () => (await api.crearEspecialista(datos)).especialista._id, archivo),
});

const modificarEspecialistaUI = (e) => formulario({
  titulo: "Modificar especialista", modo: "editar",
  valores: { ...e, diasDisponibles: diasDe(e), serviciosIds: estado.servicios.filter((s) => s.especialistaId === e._id).map((s) => s._id) },
  campos: camposEspecialista(e._id),
  guardar: (datos, archivo) => guardarConFoto(async () => {
    if (Object.keys(datos).length) {
      const { reservasFueraDeDia } = await api.modificarEspecialista(e._id, datos);
      // Cambiar los días no cancela reservas: se avisa cuántas quedaron en un día que ya no atiende.
      if (reservasFueraDeDia > 0) {
        toast(`${e.nombre} tiene ${reservasFueraDeDia} reserva(s) futura(s) en días que ya no atiende. Se mantienen: reprográmalas desde Reservas → Modificar.`, "error");
      }
    }
    return e._id;
  }, archivo),
});

// Se puede eliminar aunque tenga servicios: quedan "Sin asignar". Solo lo impiden los turnos futuros reservados.
const eliminarEspecialistaUI = (e) => {
  const aCargo = estado.servicios.filter((s) => s.especialistaId === e._id);
  accionConfirmada({
    titulo: "Eliminar especialista",
    mensaje: `¿Eliminar a ${e.nombre}? Esta acción no se puede deshacer.`
      + (aCargo.length ? ` Los servicios ${aCargo.map((s) => `«${s.nombre}»`).join(", ")} quedarán «Sin asignar» y no se podrán reservar hasta asignarles otro especialista.` : ""),
    ejecutar: () => api.eliminarEspecialista(e._id),
    exito: aCargo.length ? `Especialista eliminado. ${aCargo.length} servicio(s) quedaron sin asignar.` : "Especialista eliminado.",
  });
};

// --- Servicios -----------------------------------------------------------------------------------------------
const etiquetaTipo = (s) => (s.esConsulta ? "Consulta" : "Tratamiento");

function serviciosFiltrados() {
  const { texto, tipo } = estado.filtroServicios;
  const q = texto.trim().toLowerCase();
  return estado.servicios.filter((s) =>
    (!q || String(s.nombre).toLowerCase().includes(q) || String(nombreDe(estado.especialistas, s.especialistaId) ?? "").toLowerCase().includes(q))
    && (!tipo || (tipo === "consulta") === Boolean(s.esConsulta)));
}

function pintarServicios() {
  const f = estado.filtroServicios;
  const campo = (etiqueta, control) => el("div", { class: "field", style: "margin:0" }, el("label", { class: "visually-hidden" }, etiqueta), control);
  const lista = el("div", { id: "lista-servicios" });
  const conteo = el("span", { class: "panel__count" });

  function repintarLista() {
    const filas = serviciosFiltrados();
    conteo.textContent = `${filas.length} de ${estado.servicios.length}`;
    vaciar(lista).append(tabla(["Servicio", "Tipo y precio", "Cobro al reservar", "Especialista", "Estado", "Acciones"],
      filas.map((s) => [
        el("strong", {}, s.nombre),
        el("span", {}, s.esConsulta ? "Consulta · 30 min" : "Tratamiento · 1 h",
          el("small", { class: "sub" }, s.esConsulta ? formatearMoneda(s.precio) : (s.precio ? `Referencia ${formatearMoneda(s.precio)}` : "Precio a medida"))),
        s.esConsulta ? `${formatearMoneda(s.montoSena)} (valor fijo, lo reserva el cliente)` : `Seña ${s.porcentajeSena} % del precio acordado (lo agenda el administrador)`,
        nombreDe(estado.especialistas, s.especialistaId) || el("span", { class: "badge badge--warn" }, "Sin asignar"),
        el("span", { class: `badge ${s.activo ? "badge--ok" : ""}` }, s.activo ? "Activo" : "Inactivo"),
        acciones(
          botonFila("Modificar", `Modificar ${etiquetaTipo(s).toLowerCase()} ${s.nombre}`, () => modificarServicioUI(s)),
          botonFila("Eliminar", `Eliminar ${etiquetaTipo(s).toLowerCase()} ${s.nombre}`, () => eliminarServicioUI(s))),
      ]),
      estado.servicios.length ? "No hay servicios que coincidan." : "Todavía no hay servicios registrados.",
    ));
  }

  vaciar(contenido).append(
    cabecera("Servicios", "", { texto: "Nuevo servicio", onclick: nuevoServicioUI }),
    estado.servicios.length ? el("div", { class: "toolbar toolbar--servicios" },
      campo("Buscar", el("input", { class: "input", type: "search", placeholder: "Buscar servicio o especialista…", "aria-label": "Buscar servicios", value: f.texto, oninput: (e) => { f.texto = e.target.value; repintarLista(); } })),
      campo("Tipo de servicio", el("select", { class: "input", "aria-label": "Filtrar servicios por tipo", onchange: (e) => { f.tipo = e.target.value; repintarLista(); } },
        [["", "Consultas y tratamientos"], ["consulta", "Solo consultas"], ["tratamiento", "Solo tratamientos"]].map(([v, t]) => el("option", { value: v, selected: f.tipo === v }, t))))) : null,
    conteo, lista,
  );
  repintarLista();
}

// Cualquier especialista puede tener varios servicios; también se puede dejar el servicio "Sin asignar".
const opcionesEspecialista = () => [
  { value: "", label: "Sin asignar" },
  ...estado.especialistas.map((e) => ({ value: e._id, label: e.nombre })),
];

const camposServicio = (servicioActual) => [
  { name: "nombre", label: "Nombre", required: true, maxlength: 60 },
  {
    name: "esConsulta", label: "Tipo de servicio", type: "select", parse: (v) => v === "true",
    options: [
      { value: "true", label: "Consulta — la reserva el cliente en la web ($500 fijos, turnos de 30 min)" },
      { value: "false", label: "Tratamiento — lo agenda el administrador (seña del 50 %, turnos de 1 hora)" },
    ],
    onChange: (ctl, c) => {
      const consulta = ctl.value === "true";
      c.precio.disabled = consulta;
      c.precio.placeholder = consulta ? "Valor fijo definido por el sistema" : "Opcional: el precio real se define en cada reserva";
      if (consulta) c.precio.value = "";
      else if (!c.precio.value && servicioActual && !servicioActual.esConsulta && servicioActual.precio) c.precio.value = servicioActual.precio;
    },
  },
  { name: "precio", label: "Precio de referencia (UYU, solo tratamientos)", type: "number", min: 1, step: "0.01" },
  {
    name: "especialistaId", label: "Especialista a cargo", type: "select", parse: (v) => (v === "" ? null : v), options: opcionesEspecialista(),
    hint: "Cada servicio tiene un único especialista, que puede atender varios servicios. Sin especialista el servicio no se puede reservar.",
  },
  { name: "activo", label: "Disponible para reservar", type: "checkbox" },
];

const nuevoServicioUI = () => formulario({
  titulo: "Nuevo servicio", modo: "crear", textoGuardar: "Crear servicio",
  valores: { esConsulta: true, activo: true, especialistaId: null },
  campos: camposServicio(null),
  guardar: (datos) => api.crearServicio(datos),
});

const modificarServicioUI = (s) => formulario({
  titulo: "Modificar servicio", modo: "editar", valores: s,
  campos: camposServicio(s),
  guardar: (datos) => api.modificarServicio(s._id, datos),
});

const eliminarServicioUI = (s) => accionConfirmada({
  titulo: "Eliminar servicio",
  mensaje: `¿Eliminar ${s.esConsulta ? "la consulta" : "el tratamiento"} «${s.nombre}»? Su especialista quedará libre. Si solo quieres que no reciba nuevas reservas, desactívalo desde «Modificar».`,
  ejecutar: () => api.eliminarServicio(s._id),
  exito: "Servicio eliminado.",
});

// --- Inicio -------------------------------------------------------------------------------------------------------
// Tener un token guardado no implica sesión válida: el primer GET lo comprueba y, si falla, vuelve al login.
if (sesion.get()) mostrarPanel(); else mostrarLogin();
