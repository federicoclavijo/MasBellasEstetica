// Configuración central del frontend.

// Base de la API. Como Express sirve este frontend, se usa el mismo origen.
// Para apuntar a otro servidor, define window.MASBELLAS_API_BASE antes de cargar los módulos.
export const API_BASE = (window.MASBELLAS_API_BASE || `${window.location.origin}/v1`).replace(/\/$/, "");

export const MONEDA = { locale: "es-UY", currency: "UYU" };

export const STORAGE = {
  token: "mb_admin_token", // sessionStorage
  ultimaReserva: "mb_ultima_reserva", // localStorage (solo el id de la reserva)
};
