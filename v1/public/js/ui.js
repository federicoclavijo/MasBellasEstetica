// Utilidades de interfaz: construcción segura del DOM, formatos, avisos y diálogos.
import { MONEDA } from "./config.js";

// Crea elementos con textContent (nunca innerHTML) para evitar XSS con datos del backend.
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const vaciar = (node) => { node.replaceChildren(); return node; };

// --- Formatos ----------------------------------------------------------------
const formatoMoneda = new Intl.NumberFormat(MONEDA.locale, { style: "currency", currency: MONEDA.currency });
export const formatearMoneda = (n) => (typeof n === "number" && Number.isFinite(n) ? formatoMoneda.format(n) : "—");

// fecha viene como "YYYY-MM-DD" (texto). Se parsea a mano para evitar corrimientos de zona horaria.
export function formatearFecha(fecha) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fecha || "");
  if (!m) return fecha || "—";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString("es-UY", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}
export const formatearFechaCorta = (fecha) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fecha || "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : fecha || "—";
};

export const hoyISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Duración de un turno: 30 -> "30 minutos", 60 -> "1 hora". `corto` -> "30 min" / "1 h".
export const duracionTexto = (min, corto = false) => (min === 60 ? (corto ? "1 h" : "1 hora") : (corto ? `${min} min` : `${min} minutos`));

// Antelación mínima para que un cliente reserve online (debe coincidir con RESERVA_MIN_HORAS del servidor, 24 por defecto).
export const MIN_HORAS_ANTICIPACION = 24;
// Primer día que ofrece reservas online: el turno más cercano posible es "ahora + 24 h", o sea, mañana.
export const primerDiaReservableISO = () => {
  const d = new Date(Date.now() + MIN_HORAS_ANTICIPACION * 3600 * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Foto de perfil nítida: las fotos se guardan en Cloudinary a tamaño original y el navegador las reducía a ~50 px,
// lo que las veía pixeladas y con el rostro diminuto. Se pide un recorte cuadrado centrado en el ROSTRO (g_face),
// al triple del tamaño mostrado (pantallas retina) y con la mejor calidad automática. Otras URL se dejan igual.
export const fotoPerfil = (url, pxMostrados = 80) => {
  if (!url || !/^https:\/\/res\.cloudinary\.com\/.+\/image\/upload\//.test(url) || /\/upload\/[^/]*c_fill/.test(url)) return url;
  const lado = Math.min(Math.round(pxMostrados * 3), 800);
  return url.replace("/upload/", `/upload/c_fill,g_face,w_${lado},h_${lado},q_auto:best,f_auto/`);
};

// --- Estados de botones ---------------------------------------------------------
export function setCargando(boton, cargando, textoCargando = "Procesando…") {
  if (!boton) return;
  if (cargando) {
    boton.dataset.textoOriginal = boton.textContent;
    boton.disabled = true;
    boton.classList.add("is-loading");
    boton.setAttribute("aria-busy", "true");
    boton.textContent = textoCargando;
  } else {
    boton.disabled = false;
    boton.classList.remove("is-loading");
    boton.removeAttribute("aria-busy");
    if (boton.dataset.textoOriginal) boton.textContent = boton.dataset.textoOriginal;
  }
}

// --- Avisos (toasts) ---------------------------------------------------------------
export function toast(mensaje, tipo = "info") {
  let zona = $("#toasts");
  if (!zona) {
    zona = el("div", { id: "toasts", class: "toasts", "aria-live": "polite", role: "status" });
    document.body.append(zona);
  }
  const t = el("div", { class: `toast toast--${tipo}` }, mensaje);
  zona.append(t);
  setTimeout(() => t.remove(), tipo === "error" ? 7000 : 4000);
}

// --- Diálogos -------------------------------------------------------------------------
// Abre un <dialog> modal. `construir(dialog, cerrar)` rellena el contenido.
export function abrirDialogo(titulo, construir, { ancho } = {}) {
  const dialog = el("dialog", { class: "modal", "aria-labelledby": "modal-titulo" });
  if (ancho) dialog.style.setProperty("--modal-ancho", ancho);
  const cerrar = () => dialog.close();
  dialog.append(
    el("div", { class: "modal__cabecera" },
      el("h2", { id: "modal-titulo", class: "modal__titulo" }, titulo),
      el("button", { type: "button", class: "icon-btn", "aria-label": "Cerrar", onclick: cerrar }, "✕"),
    ),
  );
  construir(dialog, cerrar);
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  return { dialog, cerrar };
}

export function confirmar({ titulo, mensaje, confirmarTexto = "Eliminar", peligro = true }) {
  return new Promise((resolve) => {
    let resultado = false;
    const { dialog } = abrirDialogo(titulo, (d, cerrar) => {
      d.append(
        el("p", { class: "modal__texto" }, mensaje),
        el("div", { class: "modal__acciones" },
          el("button", { type: "button", class: "btn btn--ghost", onclick: cerrar }, "Cancelar"),
          el("button", {
            type: "button", class: `btn ${peligro ? "btn--danger" : "btn--primary"}`,
            onclick: () => { resultado = true; cerrar(); },
          }, confirmarTexto),
        ),
      );
    }, { ancho: "26rem" });
    dialog.addEventListener("close", () => resolve(resultado));
  });
}

export const iniciales = (nombre = "") =>
  nombre.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";

// Celular uruguayo: 099 123 456 · 99123456 · +598 99 123 456  ->  +59899123456 (null si no es válido)
export function normalizarTelefonoUY(valor) {
  let d = String(valor ?? "").replace(/[\s().-]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  if (!/^\d+$/.test(d)) return null;
  if (d.startsWith("00598")) d = d.slice(2);
  if (d.startsWith("598")) d = d.slice(3);
  else if (d.startsWith("0")) d = d.slice(1);
  return /^9\d{7}$/.test(d) ? `+598${d}` : null;
}

// +59899123456 -> 099 123 456
export function formatearTelefonoUY(e164) {
  const m = /^\+598(9\d)(\d{3})(\d{3})$/.exec(e164 ?? "");
  return m ? `0${m[1]} ${m[2]} ${m[3]}` : (e164 ?? "");
}

// 4123456-7 -> 4.123.456-7 (la cédula se guarda solo con dígitos; 8 con dígito verificador, 7 en cédulas antiguas)
export function formatearCedulaUY(valor) {
  const d = String(valor ?? "").replace(/\D/g, "");
  if (d.length < 6 || d.length > 9) return String(valor ?? "");
  return `${d.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}-${d.slice(-1)}`;
}

// --- Días de atención de los especialistas --------------------------------------------------------
// 0 = domingo … 6 = sábado, igual que en el servidor (horarios.util.js).
export const DIAS_SEMANA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
export const DIAS_ABREV = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
export const DIAS_POR_DEFECTO = [1, 2, 3, 4, 5, 6];

// Día de la semana de "YYYY-MM-DD", sin depender de la zona horaria del navegador.
export const diaSemana = (fecha) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fecha || "");
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay() : null;
};

// Especialistas anteriores a la función no traen el campo: se les aplican los días por defecto.
export const diasDe = (especialista) =>
  Array.isArray(especialista?.diasDisponibles) ? [...new Set(especialista.diasDisponibles)].sort((a, b) => a - b) : DIAS_POR_DEFECTO;

const pluralDia = (d) => (d === 0 || d === 6 ? `${DIAS_SEMANA[d]}s` : DIAS_SEMANA[d]);
// [1, 3, 6] -> "lunes, miércoles y sábados"
export const textoDias = (dias) => {
  const n = dias.map(pluralDia);
  return n.length > 1 ? `${n.slice(0, -1).join(", ")} y ${n.at(-1)}` : (n[0] ?? "ningún día");
};

// Próximas fechas (desde hoy, inclusive) en que atiende, como "YYYY-MM-DD".
export function proximasFechas(dias, cantidad = 6, desde = hoyISO()) {
  const salida = [];
  if (!dias.length) return salida;
  const [a, m, d] = desde.split("-").map(Number);
  for (let i = 0; salida.length < cantidad && i < 400; i++) {
    const f = new Date(Date.UTC(a, m - 1, d + i));
    if (dias.includes(f.getUTCDay())) salida.push(f.toISOString().slice(0, 10));
  }
  return salida;
}

// --- Modalidad de atención: días de la semana O fechas puntuales ---------------------------------------
// Igual que en el servidor (horarios.util.js): solo una modalidad está activa a la vez.
export const modoDe = (especialista) => (especialista?.tipoDisponibilidad === "fechas" ? "fechas" : "semanal");

// Fechas puntuales de atención que todavía no pasaron (desde `desde`, inclusive), ordenadas.
export const fechasDe = (especialista, desde = hoyISO()) =>
  Array.isArray(especialista?.fechasDisponibles) ? [...new Set(especialista.fechasDisponibles)].filter((f) => f >= desde).sort() : [];

// "2026-11-07" -> "07/11"
const diaMes = (f) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;

// Texto corto de cuándo atiende: "lunes, miércoles y sábados" · "fechas puntuales (07/11, 21/11 y 3 más)".
export const textoDisponibilidad = (especialista) => {
  if (modoDe(especialista) === "semanal") return textoDias(diasDe(especialista));
  const f = fechasDe(especialista);
  if (!f.length) return "fechas puntuales (por ahora ninguna)";
  const muestra = f.slice(0, 4).map(diaMes).join(", ");
  return `fechas puntuales (${muestra}${f.length > 4 ? ` y ${f.length - 4} más` : ""})`;
};

// Próximas fechas en que atiende, según la modalidad activa.
export const proximasFechasDe = (especialista, cantidad = 6, desde = hoyISO()) =>
  modoDe(especialista) === "fechas" ? fechasDe(especialista, desde).slice(0, Math.max(cantidad, 8)) : proximasFechas(diasDe(especialista), cantidad, desde);

// "Dra. Ana atiende los sábados" (o "solo en fechas puntuales") + botones con las próximas fechas para elegir con un toque.
// El <input type="date"> del navegador no permite bloquear días, por eso se sugieren las fechas válidas.
export function sugerirFechas({ cont, especialista, actual, onElegir, desde }) {
  cont.replaceChildren();
  if (!especialista) return;
  const fechas = proximasFechasDe(especialista, 6, desde ?? hoyISO());
  const porFechas = modoDe(especialista) === "fechas";
  if (porFechas && !fechas.length) {
    cont.append(el("p", { class: "field__hint" }, `${especialista.nombre} no tiene fechas de atención disponibles por el momento.`));
    return;
  }
  cont.append(
    el("p", { class: "field__hint" }, porFechas
      ? `${especialista.nombre} atiende solo en fechas puntuales. Próximas fechas:`
      : `${especialista.nombre} atiende los ${textoDias(diasDe(especialista))}. Próximas fechas:`),
    el("div", { class: "chips" }, fechas.map((f) =>
      el("button", { type: "button", class: "chip", "aria-pressed": String(f === actual), onclick: () => onElegir(f) },
        `${DIAS_ABREV[diaSemana(f)]} ${diaMes(f)}`))),
  );
}

// --- Calendario para elegir varias fechas -------------------------------------------------------------
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const SEMANA_LUN = [1, 2, 3, 4, 5, 6, 0]; // la semana empieza el lunes
const iso = (a, m, d) => `${a}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

// Calendario mensual de selección múltiple. Se toca un día para marcarlo o desmarcarlo; solo se pueden elegir
// días entre `desde` y `hasta` (YYYY-MM-DD). `onChange(fechasOrdenadas)` se llama en cada cambio.
// Devuelve un elemento con `.fechas()` para leer el valor actual.
export function crearCalendarioFechas({ seleccionadas = [], desde = hoyISO(), hasta, onChange } = {}) {
  const elegidas = new Set(seleccionadas);
  const [ad, md] = desde.split("-").map(Number);
  const limite = hasta ?? (() => { const d = new Date(Date.UTC(ad + 1, md - 1, 1)); return d.toISOString().slice(0, 10); })();
  const [ah, mh] = limite.split("-").map(Number);
  let anio = ad, mes = md - 1;
  // Se abre en el mes de la primera fecha ya elegida (si la hay), para que se vea lo cargado.
  const primera = [...elegidas].filter((f) => f >= desde).sort()[0];
  if (primera) { anio = Number(primera.slice(0, 4)); mes = Number(primera.slice(5, 7)) - 1; }

  const raiz = el("div", { class: "cal" });
  const lista = el("div", { class: "cal__sel" });
  const todas = () => [...elegidas].sort();
  const cambio = () => { onChange?.(todas()); pintar(); };

  function alternar(f) { elegidas.has(f) ? elegidas.delete(f) : elegidas.add(f); cambio(); }

  function pintar() {
    const mesAnteriorOk = anio * 12 + mes > ad * 12 + (md - 1);
    const mesSiguienteOk = anio * 12 + mes < ah * 12 + (mh - 1);
    const primerDia = new Date(Date.UTC(anio, mes, 1)).getUTCDay();
    const huecos = SEMANA_LUN.indexOf(primerDia);
    const diasMes = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
    const hoy = hoyISO();

    const celdas = Array.from({ length: huecos }, () => el("span", { class: "cal__vacio", "aria-hidden": "true" }));
    for (let d = 1; d <= diasMes; d++) {
      const f = iso(anio, mes, d);
      const fuera = f < desde || f > limite;
      const marcado = elegidas.has(f);
      celdas.push(el("button", {
        type: "button", class: `cal__dia${marcado ? " is-on" : ""}${f === hoy ? " is-hoy" : ""}`, disabled: fuera,
        "aria-pressed": String(marcado),
        "aria-label": `${DIAS_SEMANA[diaSemana(f)]} ${d} de ${MESES[mes]} de ${anio}`,
        onclick: () => alternar(f),
      }, String(d)));
    }

    raiz.replaceChildren(
      el("div", { class: "cal__nav" },
        el("button", { type: "button", class: "icon-btn", "aria-label": "Mes anterior", disabled: !mesAnteriorOk, onclick: () => { mes--; if (mes < 0) { mes = 11; anio--; } pintar(); } }, "‹"),
        el("strong", { class: "cal__mes", "aria-live": "polite" }, `${MESES[mes][0].toUpperCase()}${MESES[mes].slice(1)} ${anio}`),
        el("button", { type: "button", class: "icon-btn", "aria-label": "Mes siguiente", disabled: !mesSiguienteOk, onclick: () => { mes++; if (mes > 11) { mes = 0; anio++; } pintar(); } }, "›")),
      el("div", { class: "cal__sem", "aria-hidden": "true" }, SEMANA_LUN.map((d) => el("span", {}, DIAS_ABREV[d].slice(0, 1)))),
      el("div", { class: "cal__grid" }, celdas),
    );

    const fechas = todas();
    lista.replaceChildren(
      el("p", { class: "field__hint", "aria-live": "polite", style: "margin:0" },
        fechas.length ? `${fechas.length} ${fechas.length === 1 ? "fecha seleccionada" : "fechas seleccionadas"}:` : "Toca los días en que atiende. Aún no hay fechas seleccionadas."),
      fechas.length ? el("div", { class: "chips cal__chips" },
        fechas.map((f) => el("button", { type: "button", class: `chip${f < hoy ? " is-pasada" : ""}`, "aria-label": `Quitar ${DIAS_SEMANA[diaSemana(f)]} ${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`, onclick: () => alternar(f) },
          `${DIAS_ABREV[diaSemana(f)]} ${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(2, 4)} ✕`)),
        el("button", { type: "button", class: "btn btn--ghost btn--sm", onclick: () => { elegidas.clear(); cambio(); } }, "Quitar todas")) : null,
    );
  }

  pintar();
  const contenedor = el("div", { class: "cal-wrap" }, raiz, lista);
  contenedor.fechas = todas;
  return contenedor;
}
