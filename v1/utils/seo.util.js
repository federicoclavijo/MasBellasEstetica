import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

// Páginas que deben aparecer en Google (y en el sitemap). El panel y la página del resultado del pago NO se indexan.
export const PAGINAS_INDEXABLES = [
    { ruta: "/", archivo: "index.html", prioridad: "1.0", frecuencia: "weekly" },
    { ruta: "/nosotros.html", archivo: "nosotros.html", prioridad: "0.7", frecuencia: "monthly" },
    { ruta: "/terminos.html", archivo: "terminos.html", prioridad: "0.3", frecuencia: "yearly" },
];

// URL pública del sitio, sin barra final. Se recomienda fijar SITE_URL (p. ej. https://masbellas.com.uy) para que
// las URL canónicas y el sitemap no dependan del encabezado Host; si falta, se deduce de la solicitud.
export const urlDelSitio = (req) => {
    const configurada = process.env.SITE_URL?.trim().replace(/\/+$/, "");
    if (configurada) return configurada;
    const proto = (req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0].trim();
    return `${proto}://${req.get("host")}`;
};

const cache = new Map();

// Lee la página HTML y reemplaza {{SITE_URL}} (canonical, Open Graph y datos estructurados necesitan URL absolutas).
export const renderizarPagina = async (archivo, req) => {
    if (!cache.has(archivo)) cache.set(archivo, await fs.readFile(path.join(PUBLIC_DIR, archivo), "utf8"));
    return cache.get(archivo).replaceAll("{{SITE_URL}}", urlDelSitio(req));
};

export const crearRobotsTxt = (req) => [
    "User-agent: *",
    "Allow: /",
    "Disallow: /admin.html",
    "Disallow: /resultado.html",
    "Disallow: /v1/",
    "",
    `Sitemap: ${urlDelSitio(req)}/sitemap.xml`,
    "",
].join("\n");

export const crearSitemapXml = (req) => {
    const base = urlDelSitio(req);
    const urls = PAGINAS_INDEXABLES.map((p) =>
        `  <url>\n    <loc>${base}${p.ruta}</loc>\n    <changefreq>${p.frecuencia}</changefreq>\n    <priority>${p.prioridad}</priority>\n  </url>`);
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
};
