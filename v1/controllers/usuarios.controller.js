import { buscarClientesService } from "../services/usuarios.services.js";

// Solo administración: busca clientes ya registrados para autocompletar el alta de un tratamiento.
export const buscarClientes = async (req, res) => {
    const clientes = await buscarClientesService(req.query.q);
    res.status(200).json({ mensaje: "Clientes encontrados", clientes });
};
