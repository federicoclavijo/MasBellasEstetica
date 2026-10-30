// Página "Nosotros": muestra el equipo real (los especialistas cargados en el sistema).
import { listarEspecialistasPublico } from "./api.js";
import { el, $, vaciar, iniciales, fotoPerfil } from "./ui.js";

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
          ? el("img", { class: "avatar", src: fotoPerfil(e.imagenPerfil, 96), alt: `Foto de ${e.nombre}`, width: 96, height: 96, loading: "lazy", decoding: "async" })
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

// Fotos propias en "Nosotros": si existe un archivo con el nombre indicado en data-foto (extensión .jpg, .jpeg, .webp o .png)
// dentro de /img, reemplaza a la ilustración; si no existe, se sigue viendo la ilustración. Ver README / CAMBIOS.md.
const EXTENSIONES = ["jpg", "jpeg", "webp", "png"];

function usarFotoPropia(img) {
  const base = img.dataset.foto;
  const probar = (i) => {
    if (i >= EXTENSIONES.length) return;
    const prueba = new Image();
    prueba.onload = () => {
      img.src = prueba.src;
      img.alt = img.dataset.alt || img.alt;
      img.classList.add("is-foto");
      if (img.dataset.ratio) img.style.aspectRatio = img.dataset.ratio;
    };
    prueba.onerror = () => probar(i + 1);
    prueba.src = `${base}.${EXTENSIONES[i]}`;
  };
  probar(0);
}

document.querySelectorAll("img[data-foto]").forEach(usarFotoPropia);
