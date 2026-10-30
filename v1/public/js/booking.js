// Vista pública: formulario de reserva. Orquesta API (api.js) y DOM (ui.js).
import { crearReserva, listarServiciosPublico, listarEspecialistasPublico, obtenerDisponibilidad, ApiError } from "./api.js";
import { STORAGE } from "./config.js";
import {
  el, $, vaciar, formatearMoneda, formatearFecha, formatearFechaCorta, hoyISO, fotoPerfil, primerDiaReservableISO, MIN_HORAS_ANTICIPACION, setCargando, iniciales, normalizarTelefonoUY, sugerirFechas, diasDe, textoDias,
} from "./ui.js";

const estado = {
  servicios: [],
  especialistas: [],
  servicioId: null,
  hora: null,
  horariosDisponibles: [],
  disponibilidadEstado: "idle", // idle | loading | loaded | closed (el especialista no atiende ese día) | error
  disponibilidadError: "",
  solicitudDisponibilidad: 0,
  enviando: false,
};
const form = $("#form-reserva");

const servicioElegido = () => estado.servicios.find((s) => s._id === estado.servicioId) ?? null;
const especialistaElegido = () => {
  const servicio = servicioElegido();
  return servicio ? estado.especialistas.find((e) => e._id === servicio.especialistaId) ?? null : null;
};
const duracionTexto = (min) => (min === 30 ? "30 min" : "1 h");
// Todas las consultas valen lo mismo (valor fijo) y duran 30 minutos.
const detalleCobro = (s) => `Valor fijo · ${duracionTexto(s.duracionMinutos)}`;


// --- Carga de catálogo ---------------------------------------------------------------
async function cargarCatalogo() {
  const aviso = $("#aviso-carga");
  try {
    const [servicios, especialistas] = await Promise.all([listarServiciosPublico(), listarEspecialistasPublico()]);
    estado.servicios = servicios;
    estado.especialistas = especialistas;
    aviso.hidden = true;
  } catch (error) {
    aviso.hidden = false;
    vaciar(aviso).append(
      el("div", { class: "notice notice--error" },
        el("span", { class: "notice__icon", "aria-hidden": "true" }, "⚠"),
        el("div", {},
          el("strong", {}, "No pudimos cargar las consultas."),
          el("p", {}, error instanceof ApiError ? error.message : "Revisa tu conexión e inténtalo nuevamente."),
          el("button", { type: "button", class: "btn btn--ghost btn--sm", style: "margin-top:.6rem", onclick: () => { iniciarCarga(); } }, "Reintentar"),
        ),
      ),
    );
  }
  renderServicios();
  renderEquipo();
}
const iniciarCarga = () => {
  vaciar($("#lista-servicios")).append(el("p", { class: "empty" }, "Cargando consultas…"));
  vaciar($("#lista-especialistas")).append(el("li", { class: "empty" }, "Cargando especialistas…"));
  return cargarCatalogo();
};

// --- Servicios (se pueden elegir) -------------------------------------------------------
function renderServicios() {
  const cont = vaciar($("#lista-servicios"));
  if (!estado.servicios.length) {
    cont.append(el("p", { class: "empty" }, "No hay consultas disponibles por el momento."));
    return;
  }
  for (const s of estado.servicios) {
    // Un servicio sin especialista asignado se muestra, pero todavía no se puede reservar.
    const sinEspecialista = !s.especialistaId;
    const input = el("input", { type: "radio", name: "servicio", id: `srv-${s._id}`, value: s._id, checked: estado.servicioId === s._id, required: true, disabled: sinEspecialista });
    input.addEventListener("change", () => {
      estado.servicioId = s._id;
      limpiarError("servicio");
      limpiarError("hora");
      renderEquipo();
      actualizarResumen();
      renderFechasSugeridas();
      cargarDisponibilidad();
    });
    cont.append(el("label", { class: `option${sinEspecialista ? " is-disabled" : ""}` }, input,
      el("span", { class: "option__body" },
        el("span", {},
          el("span", { class: "option__title" }, s.nombre),
          el("span", { class: "option__meta" }, formatearMoneda(s.precio)),
          el("span", { class: "option__meta" }, sinEspecialista ? "Disponible próximamente" : detalleCobro(s))))));
  }
}

// --- Equipo: todos los especialistas, resaltando el que está a cargo del servicio elegido ---------
function renderEquipo() {
  const cont = vaciar($("#lista-especialistas"));
  if (!estado.especialistas.length) {
    cont.append(el("li", { class: "empty" }, "No hay especialistas disponibles por el momento."));
    return;
  }
  const aCargo = especialistaElegido();
  const hayServicio = Boolean(servicioElegido());
  for (const e of estado.especialistas) {
    const activo = aCargo?._id === e._id;
    const aCargoDe = (e.servicios ?? []).map((x) => x.nombre);
    const avatar = e.imagenPerfil
      ? el("img", { class: "avatar", src: fotoPerfil(e.imagenPerfil, 72), alt: "", width: 72, height: 72, loading: "lazy", decoding: "async" })
      : el("span", { class: "avatar", "aria-hidden": "true" }, iniciales(e.nombre));
    cont.append(el("li", { class: `team__card${activo ? " is-active" : ""}${hayServicio && !activo ? " is-dim" : ""}`, "aria-current": activo ? "true" : null },
      avatar,
      el("span", {},
        el("span", { class: "option__title" }, e.nombre),
        el("span", { class: "option__meta" }, [e.rol, aCargoDe.length ? aCargoDe.join(", ") : "Sin consultas por el momento"].filter(Boolean).join(" · ")),
        el("span", { class: "option__meta" }, `Atiende: ${textoDias(diasDe(e))}`),
        activo ? el("span", { class: "team__badge" }, "A cargo de tu consulta") : null)));
  }
  $("#hint-equipo").textContent = aCargo
    ? `${aCargo.nombre} estará a cargo de «${servicioElegido().nombre}».`
    : "Cada consulta está a cargo de un especialista. Al elegir el tipo de consulta verás quién te atenderá.";
}

// --- Días de atención ---------------------------------------------------------------------------------
// Cada especialista atiende ciertos días de la semana (los define la administración): se avisa y se sugieren fechas válidas.
function renderFechasSugeridas() {
  sugerirFechas({
    cont: $("#fechas-sugeridas"),
    especialista: especialistaElegido(),
    actual: form.elements.fecha.value,
    desde: primerDiaReservableISO(),
    onElegir: (f) => {
      form.elements.fecha.value = f;
      limpiarError("fecha");
      renderFechasSugeridas();
      actualizarResumen();
      cargarDisponibilidad();
    },
  });
}

// --- Horarios ---------------------------------------------------------------------------------------
const textoAntelacion = () => `Las reservas online requieren al menos ${MIN_HORAS_ANTICIPACION} horas de antelación. Elige una fecha a partir de mañana.`;

function renderHoras() {
  const fecha = form.elements.fecha.value;
  const cont = vaciar($("#lista-horas"));
  cont.removeAttribute("aria-label");
  const mensaje = (texto, rol = "status") => cont.append(el("p", { class: "empty", role: rol }, texto));

  if (!fecha || !estado.servicioId) return mensaje("Elige un tipo de consulta y una fecha para ver los horarios disponibles.");
  if (estado.disponibilidadEstado === "loading") return mensaje("Consultando horarios disponibles…");
  if (estado.disponibilidadEstado === "closed") return mensaje(estado.disponibilidadError || "El especialista no atiende ese día. Elige otra fecha.");
  if (estado.disponibilidadEstado === "error") {
    mensaje(estado.disponibilidadError, "alert");
    cont.append(el("button", { type: "button", class: "btn btn--ghost btn--sm", style: "margin-top:.5rem", onclick: () => cargarDisponibilidad() }, "Reintentar"));
    return;
  }
  if (estado.disponibilidadEstado !== "loaded") {
    return mensaje(fecha < primerDiaReservableISO() ? textoAntelacion() : "Elige un tipo de consulta y una fecha para ver los horarios disponibles.");
  }
  if (!estado.horariosDisponibles.length) {
    return mensaje(fecha <= primerDiaReservableISO()
      ? `No quedan horarios para esa fecha: las reservas online requieren al menos ${MIN_HORAS_ANTICIPACION} horas de antelación. Prueba con otro día.`
      : "No hay horarios disponibles para esta fecha. Prueba con otro día.");
  }

  for (const hora of estado.horariosDisponibles) {
    const input = el("input", { type: "radio", name: "hora", value: hora, id: `hora-${hora}`, checked: estado.hora === hora });
    input.addEventListener("change", () => { estado.hora = hora; limpiarError("hora"); actualizarResumen(); });
    cont.append(el("label", { class: "slot" }, input, el("span", {}, hora)));
  }
}

async function cargarDisponibilidad() {
  const fecha = form.elements.fecha.value;
  const servicioId = estado.servicioId;
  const solicitud = ++estado.solicitudDisponibilidad;

  estado.hora = null;
  estado.horariosDisponibles = [];
  estado.disponibilidadError = "";
  limpiarError("hora");

  const servicio = servicioElegido();
  $("#hint-horario").textContent = servicio
    ? `Atendemos de 08:00 a 20:00. Los turnos de consulta son cada ${servicio.duracionMinutos === 30 ? "30 minutos" : "hora"}. Elige un único horario.`
    : "Atendemos de 08:00 a 20:00. Elige un único horario.";

  if (!fecha || !servicioId || fecha < primerDiaReservableISO()) {
    estado.disponibilidadEstado = "idle";
    renderHoras();
    actualizarResumen();
    return;
  }

  estado.disponibilidadEstado = "loading";
  renderHoras();
  actualizarResumen();
  try {
    const { horariosDisponibles, atiendeEseDia, mensaje } = await obtenerDisponibilidad(fecha, servicioId);
    if (solicitud !== estado.solicitudDisponibilidad) return;
    if (!Array.isArray(horariosDisponibles)) throw new Error("El servidor devolvió una disponibilidad inválida.");
    estado.horariosDisponibles = horariosDisponibles;
    estado.disponibilidadEstado = atiendeEseDia === false ? "closed" : "loaded";
    estado.disponibilidadError = atiendeEseDia === false ? (mensaje || "") : "";
  } catch (error) {
    if (solicitud !== estado.solicitudDisponibilidad) return;
    estado.disponibilidadEstado = "error";
    estado.disponibilidadError = error instanceof ApiError
      ? error.message
      : "No se pudieron cargar los horarios disponibles. Inténtalo nuevamente.";
  }
  renderHoras();
  actualizarResumen();
}

// --- Resumen ----------------------------------------------------------------------------------------------
function valorResumen(clave, texto) {
  const dd = $(`[data-r="${clave}"]`);
  dd.textContent = texto || "—";
  dd.classList.toggle("is-empty", !texto);
}

function actualizarResumen() {
  const servicio = servicioElegido();
  const especialista = especialistaElegido();
  valorResumen("nombre", form.elements.nombre.value.trim());
  valorResumen("cedula", form.elements.cedula.value.trim());
  valorResumen("email", form.elements.email.value.trim());
  valorResumen("telefono", form.elements.telefono.value.trim());
  valorResumen("fechaNacimiento", form.elements.fechaNacimiento.value ? formatearFechaCorta(form.elements.fechaNacimiento.value) : "");
  valorResumen("servicio", servicio?.nombre);
  valorResumen("especialista", especialista?.nombre);
  valorResumen("fecha", form.elements.fecha.value ? formatearFecha(form.elements.fecha.value) : "");
  valorResumen("hora", estado.hora);

  // El importe lo calcula el servidor: las consultas tienen un valor fijo que se abona completo al reservar.
  $("#r-sena").textContent = servicio ? formatearMoneda(servicio.montoSena) : "—";
  $("#nota-sena").textContent = servicio
    ? "Valor fijo de la consulta, que se abona completo al reservar. Si luego decides realizar un tratamiento, su valor y su seña se coordinan en el local."
    : "Elige un tipo de consulta para ver el importe a pagar.";
}

// --- Validación ---------------------------------------------------------------------------------------------------
const ERRORES = { nombre: "err-nombre", cedula: "err-cedula", email: "err-email", telefono: "err-telefono", fechaNacimiento: "err-fechaNacimiento", terminos: "err-terminos", servicio: "err-servicio", fecha: "err-fecha", hora: "err-hora" };
function mostrarError(campo, mensaje) {
  $(`#${ERRORES[campo]}`).textContent = mensaje;
  const input = form.elements[campo];
  if (input && input.setAttribute && input.type !== "radio") input.setAttribute("aria-invalid", "true");
}
function limpiarError(campo) {
  $(`#${ERRORES[campo]}`).textContent = "";
  const input = form.elements[campo];
  if (input && input.removeAttribute && input.type !== "radio") input.removeAttribute("aria-invalid");
}

function validar() {
  Object.keys(ERRORES).forEach(limpiarError);
  const errores = {};
  const cedulaLimpia = form.elements.cedula.value.replace(/[.\-\s]/g, "");
  const nacimiento = form.elements.fechaNacimiento.value;
  if (form.elements.nombre.value.trim().length < 3) errores.nombre = "Ingresa tu nombre completo.";
  if (!/^\d{6,9}$/.test(cedulaLimpia)) errores.cedula = "Ingresa una cédula válida (solo números).";
  if (!form.elements.email.value.trim() || !form.elements.email.checkValidity()) errores.email = "Ingresa un correo electrónico válido.";
  if (!normalizarTelefonoUY(form.elements.telefono.value.trim())) errores.telefono = "Ingresa un celular uruguayo válido (por ejemplo 099 123 456).";
  if (!nacimiento) errores.fechaNacimiento = "Ingresa tu fecha de nacimiento.";
  else if (nacimiento > hoyISO()) errores.fechaNacimiento = "La fecha de nacimiento no puede ser futura.";
  else if (nacimiento < "1900-01-01") errores.fechaNacimiento = "Ingresa una fecha de nacimiento válida.";
  if (!estado.servicioId) errores.servicio = "Elige un tipo de consulta.";
  if (!form.elements.fecha.value) errores.fecha = "Elige una fecha.";
  else if (form.elements.fecha.value < primerDiaReservableISO()) errores.fecha = textoAntelacion();
  if (estado.disponibilidadEstado === "closed") errores.fecha = estado.disponibilidadError || "El especialista no atiende ese día. Elige otra fecha.";
  else if (estado.disponibilidadEstado !== "loaded") errores.hora = "Espera a que se carguen los horarios disponibles.";
  else if (!estado.hora || !estado.horariosDisponibles.includes(estado.hora)) errores.hora = "Elige un horario disponible.";
  if (!form.elements.terminos.checked) errores.terminos = "Debes aceptar los términos y condiciones para reservar.";
  for (const [campo, mensaje] of Object.entries(errores)) mostrarError(campo, mensaje);
  const primero = Object.keys(errores)[0];
  if (primero) {
    const destino = form.elements[primero];
    const foco = destino instanceof RadioNodeList ? destino[0] : destino;
    (foco && !foco.disabled ? foco : $(`#${ERRORES[primero]}`)).scrollIntoView?.({ behavior: "smooth", block: "center" });
    foco?.focus?.({ preventScroll: true });
  }
  return !primero;
}

// --- Envío ---------------------------------------------------------------------------------------------------------------
function mostrarErrorEnvio(mensaje, extra) {
  const cont = $("#error-envio");
  cont.hidden = false;
  vaciar(cont).append(el("div", { class: "notice notice--error" },
    el("span", { class: "notice__icon", "aria-hidden": "true" }, "⚠"),
    el("div", {}, el("p", {}, mensaje), extra ? el("p", { style: "margin-top:.3rem" }, extra) : null),
  ));
}

function esUrlDeCheckoutValida(valor) {
  try { return new URL(valor).protocol === "https:"; } catch { return false; }
}

form.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (estado.enviando) return;
  $("#error-envio").hidden = true;
  if (!validar()) return;

  estado.enviando = true;
  const boton = $("#btn-enviar");
  setCargando(boton, true, "Creando tu reserva…");
  try {
    const respuesta = await crearReserva({
      nombre: form.elements.nombre.value.trim(),
      cedula: form.elements.cedula.value.replace(/[.\-\s]/g, ""),
      email: form.elements.email.value.trim(),
      telefono: normalizarTelefonoUY(form.elements.telefono.value.trim()),
      fechaNacimiento: form.elements.fechaNacimiento.value,
      servicioId: estado.servicioId,
      fecha: form.elements.fecha.value,
      hora: estado.hora,
    });
    if (respuesta.reservaId) {
      // localStorage (y no sessionStorage): si Mercado Pago abre el retorno en otra pestaña, el id sigue disponible.
      try { localStorage.setItem(STORAGE.ultimaReserva, respuesta.reservaId); } catch { /* opcional */ }
    }
    if (!esUrlDeCheckoutValida(respuesta.checkoutUrl)) {
      mostrarErrorEnvio(
        "Tu reserva fue registrada, pero no recibimos el enlace de pago.",
        "Contacta al centro indicando tu nombre y la fecha elegida.",
      );
      return;
    }
    window.location.assign(respuesta.checkoutUrl);
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      estado.hora = null;
      actualizarResumen();
      await cargarDisponibilidad();
      mostrarErrorEnvio(error.message, "Actualizamos los horarios disponibles; elige otra franja para continuar.");
    } else {
      mostrarErrorEnvio(
        error instanceof ApiError ? error.message : "No se pudo completar la reserva.",
        "Tus datos se conservaron: puedes corregirlos e intentar nuevamente.",
      );
    }
  } finally {
    estado.enviando = false;
    setCargando(boton, false);
  }
});

// --- Inicio ---------------------------------------------------------------------------------------------------------------
form.elements.fecha.min = primerDiaReservableISO();
form.elements.fechaNacimiento.max = hoyISO();
form.elements.fecha.addEventListener("change", () => {
  limpiarError("fecha");
  renderFechasSugeridas();
  actualizarResumen();
  cargarDisponibilidad();
});
form.elements.terminos.addEventListener("change", () => limpiarError("terminos"));
for (const campo of ["nombre", "cedula", "email", "telefono", "fechaNacimiento"]) {
  form.elements[campo].addEventListener("input", () => { limpiarError(campo); actualizarResumen(); });
}
renderHoras();
actualizarResumen();
iniciarCarga();
