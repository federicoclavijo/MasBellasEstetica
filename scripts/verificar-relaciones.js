// Revisa (y opcionalmente repara) datos creados con la versión anterior, donde la relación era 1 a 1.
//   node scripts/verificar-relaciones.js            -> solo informa
//   node scripts/verificar-relaciones.js --reparar  -> aplica las reparaciones indicadas abajo
//
// Ahora un especialista puede tener varios servicios: la fuente única es Servicio.especialistaId
// (null = "Sin asignar"). El campo viejo Especialista.servicioId ya no se usa.
import "dotenv/config";
import mongoose from "mongoose";
import Servicio from "../v1/models/servicio.model.js";
import Especialista from "../v1/models/especialista.model.js";

const reparar = process.argv.includes("--reparar");
await mongoose.connect(process.env.MONGO_URI);

const servicios = await Servicio.find().lean();
const especialistas = await Especialista.find().lean();
const colEspecialistas = mongoose.connection.collection("especialistas");
const problemas = [];

// 1. Servicios que apuntan a un especialista inexistente -> pasan a "Sin asignar".
for (const s of servicios) {
    if (!s.especialistaId) {
        problemas.push(`Servicio «${s.nombre}» está «Sin asignar»: no se podrá reservar hasta asignarle un especialista desde el panel.`);
    } else if (!especialistas.some((e) => String(e._id) === String(s.especialistaId))) {
        problemas.push(`Servicio «${s.nombre}» apunta a un especialista que ya no existe${reparar ? " -> pasó a «Sin asignar»" : ""}.`);
        if (reparar) await Servicio.updateOne({ _id: s._id }, { $set: { especialistaId: null } });
    }
}

// 2. Campo obsoleto Especialista.servicioId.
const conCampoViejo = await colEspecialistas.countDocuments({ servicioId: { $exists: true } });
if (conCampoViejo) {
    problemas.push(`${conCampoViejo} especialista(s) conservan el campo obsoleto «servicioId»${reparar ? " -> eliminado" : ""} (el vínculo real está en Servicio.especialistaId).`);
    if (reparar) await colEspecialistas.updateMany({}, { $unset: { servicioId: "" } });
}

// 3. Solo debe haber un servicio de consulta.
const consultas = servicios.filter((s) => s.porcentaje === false);
if (consultas.length > 1) problemas.push(`Hay ${consultas.length} servicios de consulta (porcentaje:false); solo debe haber uno.`);

console.log(problemas.length ? problemas.map((p) => `- ${p}`).join("\n") : "Todo en orden.");
await mongoose.disconnect();
