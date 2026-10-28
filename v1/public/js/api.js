// Capa de red: único lugar donde se llama a fetch(). No toca el DOM.
import { API_BASE, STORAGE } from "./config.js";

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export const sesion = {
  get: () => {
    try { return sessionStorage.getItem(STORAGE.token); } catch { return null; }
  },
  set: (token) => {
    try { sessionStorage.setItem(STORAGE.token, token); } catch { /* sin almacenamiento */ }
  },
  clear: () => {
    try { sessionStorage.removeItem(STORAGE.token); } catch { /* sin almacenamiento */ }
  },
};

const MENSAJES_POR_ESTADO = {
  400: "El servidor rechazó los datos enviados.",
  401: "Tu sesión no es válida o expiró.",
  403: "No tienes permiso para realizar esta acción.",
  404: "No se encontró el elemento solicitado.",
  409: "Ya existe un elemento con esos datos.",
  500: "Ocurrió un error en el servidor. Inténtalo nuevamente.",
};

async function request(path, { method = "GET", body, formData, auth = false } = {}) {
  const headers = {};
  if (auth) {
    const token = sesion.get();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  let payload;
  if (formData) {
    payload = formData; // el navegador define el Content-Type multipart
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, { method, headers, body: payload });
  } catch {
    throw new ApiError(0, "No se pudo conectar con el servidor. Revisa tu conexión.");
  }

  let data = null;
  try { data = await response.json(); } catch { /* respuesta sin JSON */ }

  if (!response.ok) {
    if (auth && response.status === 401) {
      sesion.clear();
      window.dispatchEvent(new CustomEvent("mb:sesion-expirada"));
    }
    const mensaje = data?.mensaje || data?.error || MENSAJES_POR_ESTADO[response.status]
      || `Error inesperado (${response.status}).`;
    throw new ApiError(response.status, mensaje);
  }
  return data ?? {};
}

// --- Públicos -------------------------------------------------------------
export const crearReserva = (datos) => request("/reservas", { method: "POST", body: datos });
export const listarServiciosPublico = () => request("/servicios").then((d) => d.servicios ?? []);
export const listarEspecialistasPublico = () => request("/especialistas").then((d) => d.especialistas ?? []);
export const obtenerEstadoReserva = (id) => request(`/reservas/${encodeURIComponent(id)}/estado`);
export const obtenerDisponibilidad = (fecha, servicioId) => {
  const params = new URLSearchParams({ fecha, servicioId });
  return request(`/reservas/disponibilidad?${params}`);
};

// --- Administración (requieren JWT) ----------------------------------------
export const login = (user, pass) => request("/auth/login", { method: "POST", body: { user, pass } });

const id = encodeURIComponent;

export const listarReservas = () => request("/reservas", { auth: true }).then((d) => d.reservas ?? []);
export const modificarReserva = (rid, cambios) => request(`/reservas/${id(rid)}`, { method: "PATCH", body: cambios, auth: true });
export const cancelarReserva = (rid) => request(`/reservas/${id(rid)}/cancelar`, { method: "POST", auth: true });
export const reembolsarReserva = (rid) => request(`/reservas/${id(rid)}/reembolsar`, { method: "POST", auth: true });
export const crearReservaAdmin = (datos) => request("/reservas/admin", { method: "POST", body: datos, auth: true });
export const confirmarPago = (rid) => request(`/reservas/${id(rid)}/confirmar-pago`, { method: "POST", auth: true });
export const whatsappDeReserva = (rid) => request(`/reservas/${id(rid)}/whatsapp`, { auth: true }).then((d) => d.whatsapp);
export const buscarClientes = (q) => request(`/usuarios?${new URLSearchParams({ q })}`, { auth: true }).then((d) => d.clientes ?? []);
// Horarios libres de un servicio (con sesión de administrador también sirve para los tratamientos).
export const disponibilidadAdmin = (fecha, servicioId) =>
  request(`/reservas/disponibilidad?${new URLSearchParams({ fecha, servicioId })}`, { auth: true });
export const reenviarConfirmacion = (rid) => request(`/reservas/${id(rid)}/reenviar-confirmacion`, { method: "POST", auth: true });
export const marcarAsistencia = (rid, asistencia) => request(`/reservas/${id(rid)}/asistencia`, { method: "POST", body: { asistencia }, auth: true });
export const marcarReembolso = (rid) => request(`/reservas/${id(rid)}/reembolso`, { method: "POST", auth: true });
export const eliminarReserva = (rid) => request(`/reservas/${id(rid)}`, { method: "DELETE", auth: true });
export const disponibilidadDeReserva = (rid, fecha) =>
  request(`/reservas/${id(rid)}/disponibilidad?${new URLSearchParams({ fecha })}`, { auth: true });

export const listarServicios = () => request("/servicios?todos=true", { auth: true }).then((d) => d.servicios ?? []);
export const crearServicio = (datos) => request("/servicios", { method: "POST", body: datos, auth: true });
export const modificarServicio = (sid, cambios) => request(`/servicios/${id(sid)}`, { method: "PATCH", body: cambios, auth: true });
export const eliminarServicio = (sid) => request(`/servicios/${id(sid)}`, { method: "DELETE", auth: true });

export const listarEspecialistas = () => request("/especialistas", { auth: true }).then((d) => d.especialistas ?? []);
export const crearEspecialista = (datos) => request("/especialistas", { method: "POST", body: datos, auth: true });
export const modificarEspecialista = (eid, cambios) => request(`/especialistas/${id(eid)}`, { method: "PATCH", body: cambios, auth: true });
export const eliminarEspecialista = (eid) => request(`/especialistas/${id(eid)}`, { method: "DELETE", auth: true });
export const subirImagenEspecialista = (eid, archivo) => {
  const formData = new FormData();
  formData.append("imagen", archivo);
  return request(`/especialistas/imagen/${id(eid)}`, { method: "PATCH", formData, auth: true });
};
