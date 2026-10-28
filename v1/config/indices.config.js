import mongoose from "mongoose";
import Servicio from "../models/servicio.model.js";
import Especialista from "../models/especialista.model.js";
import Usuario from "../models/usuario.model.js";
import Reserva from "../models/reserva.model.js";

// Mongoose crea los índices que declaran los modelos, pero NUNCA borra los que quedaron de versiones anteriores.
// Un índice único viejo (por ejemplo sobre `precio`, o sobre un campo que ya no existe) sigue bloqueando guardados
// aunque el código ya no lo pida: dos servicios con el mismo precio, o dos consultas de $500, darían error.
// Aquí se eliminan SOLO los índices únicos que ningún modelo declara. Los índices no únicos no se tocan.
const MODELOS = [Servicio, Especialista, Usuario, Reserva];

export const eliminarIndicesUnicosObsoletos = async (modelos = MODELOS) => {
    const eliminados = [];

    for (const Modelo of modelos) {
        const declarados = Modelo.schema.indexes().map(([campos]) => JSON.stringify(campos));

        let existentes;
        try {
            existentes = await Modelo.collection.indexes();
        } catch (error) {
            // La colección todavía no existe: no hay nada que limpiar.
            if (error?.code === 26 || /ns does not exist|NamespaceNotFound|not found/i.test(error?.message ?? "")) continue;
            throw error;
        }

        for (const indice of existentes) {
            if (indice.name === "_id_" || !indice.unique) continue;
            if (declarados.includes(JSON.stringify(indice.key))) continue;

            await Modelo.collection.dropIndex(indice.name);
            eliminados.push(`${Modelo.collection.name}.${indice.name}`);
            console.log(`Índice único obsoleto eliminado: ${Modelo.collection.name}.${indice.name}`);
        }
    }

    return eliminados;
};

export const prepararIndices = async () => {
    if (process.env.LIMPIAR_INDICES === "false") return;
    try {
        await eliminarIndicesUnicosObsoletos();
        await Promise.all(MODELOS.map((m) => m.init().catch((e) => console.error(`No se pudieron crear los índices de ${m.collection.name}:`, e.message))));
    } catch (error) {
        // No es fatal: la aplicación funciona igual; solo queda registrado.
        console.error("No se pudieron revisar los índices:", error.message);
    }
};
