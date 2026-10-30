import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import v1Routes from "./v1/v1.routes.js"
import { notFoundMiddleware } from "./v1/middlewares/notFound.middleware.js"
import { connectDB } from "./v1/config/db.config.js"
import { errorMiddleware } from "./v1/middlewares/error.middleware.js";
import { PAGINAS_INDEXABLES, renderizarPagina, crearRobotsTxt, crearSitemapXml } from "./v1/utils/seo.util.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

connectDB();

const app = express();

app.use(cors());

app.use(express.json());

// --- SEO ------------------------------------------------------------------------------------------
// La API y las páginas privadas no se indexan (robots.txt solo "pide"; este encabezado es la instrucción firme).
app.use(["/v1", "/admin.html", "/resultado.html"], (req, res, next) => {
    res.set("X-Robots-Tag", "noindex, nofollow");
    next();
});

app.get("/robots.txt", (req, res) => res.type("text/plain").send(crearRobotsTxt(req)));
app.get("/sitemap.xml", (req, res) => res.type("application/xml").send(crearSitemapXml(req)));

// Páginas públicas: se sirven con la URL canónica real del sitio (ver {{SITE_URL}} en el HTML).
for (const { ruta, archivo } of PAGINAS_INDEXABLES) {
    const rutas = ruta === "/" ? ["/", "/index.html"] : [ruta];
    app.get(rutas, async (req, res, next) => {
        try {
            res.type("html").send(await renderizarPagina(archivo, req));
        } catch (error) {
            next(error);
        }
    });
}

app.use(express.static(path.join(__dirname, "v1", "public"), {
    // Imágenes: caché largo. CSS/JS/HTML se revalidan (etag) para que los cambios se vean enseguida.
    setHeaders: (res, archivo) => { if (/[\\/]img[\\/]/.test(archivo)) res.set("Cache-Control", "public, max-age=604800"); },
}));
app.use(express.urlencoded({ extended: true }))

app.use("/v1", v1Routes);

app.use(notFoundMiddleware);
app.use(errorMiddleware);

export default app;