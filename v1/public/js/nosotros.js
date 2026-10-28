// Página "Nosotros": muestra el equipo real (los especialistas cargados en el sistema).
import { listarEspecialistasPublico } from "./api.js";
import { el, $, vaciar, iniciales } from "./ui.js";

const ROLES = { Medico: "Médico", Cirujano: "Cirujano" };

async function cargarEquipo() {
  try {
    const especialistas = await listarEspecialistasPublico();
    if (!especialistas.length) return;

    const lista = vaciar($("#equipo-lista"));
    for (const e of especialistas) {
      const consultas = (e.servicios ?? []).map((s) => s.nombre);
      lista.append(el("li", { class: "card team-person" },
        e.imagenPerfil
          ? el("img", { class: "avatar", src: e.imagenPerfil, alt: `Foto de ${e.nombre}`, loading: "lazy" })
          : el("span", { class: "avatar", "aria-hidden": "true" }, iniciales(e.nombre)),
        el("h3", {}, e.nombre),
        el("span", { class: "role" }, ROLES[e.rol] ?? e.rol),
        consultas.length ? el("p", {}, consultas.join(" · ")) : null));
    }
    $("#equipo").hidden = false;
  } catch {
    // Sin conexión con la API la sección simplemente no se muestra: el resto de la página es estático.
  }
}

cargarEquipo();
