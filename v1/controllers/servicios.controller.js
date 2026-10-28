import { guardarServicioService, obtenerServiciosService, obtenerServicioPorIdService, actualizarServicioService, eliminarServicioService } from "../services/servicios.services.js";
import { crearError } from "../utils/http-error.util.js";

export const guardarServicio = async (req, res) => {
    const servicio = await guardarServicioService(req.body);
    res.status(201).json({ mensaje: "Servicio guardado", servicio });
};

// Público: solo servicios activos. Con ?todos=true (y sesión de administrador) también los inactivos.
export const obtenerServicios = async (req, res) => {
    const incluirInactivos = req.query.todos === "true";

    if (incluirInactivos && !req.user) {
        throw crearError(401, "Acceso no autorizado.");
    }

    const servicios = await obtenerServiciosService({ incluirInactivos });
    res.status(200).json({ mensaje: "Servicios obtenidos", servicios });
};

export const obtenerServicioPorId = async (req, res) => {
    const servicio = await obtenerServicioPorIdService(req.params.id);
    res.status(200).json({ mensaje: "Servicio obtenido", servicio });
};

export const actualizarServicio = async (req, res) => {
    const servicio = await actualizarServicioService(req.params.id, req.body);
    res.status(200).json({ mensaje: "Servicio actualizado", servicio });
};

export const eliminarServicio = async (req, res) => {
    const servicio = await eliminarServicioService(req.params.id);
    res.status(200).json({ mensaje: "Servicio eliminado", servicio });
};
