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

// "Dra. Ana atiende los sábados" + botones con las próximas fechas para elegir con un toque.
// El <input type="date"> del navegador no permite bloquear días de la semana, por eso se sugieren las fechas válidas.
export function sugerirFechas({ cont, especialista, actual, onElegir }) {
  cont.replaceChildren();
  if (!especialista) return;
  const dias = diasDe(especialista);
  cont.append(
    el("p", { class: "field__hint" }, `${especialista.nombre} atiende los ${textoDias(dias)}. Próximas fechas:`),
    el("div", { class: "chips" }, proximasFechas(dias).map((f) =>
      el("button", { type: "button", class: "chip", "aria-pressed": String(f === actual), onclick: () => onElegir(f) },
        `${DIAS_ABREV[diaSemana(f)]} ${f.slice(8, 10)}/${f.slice(5, 7)}`))),
  );
}
