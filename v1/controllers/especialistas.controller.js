import { guardarEspecialistaService, obtenerEspecialistasService, obtenerEspecialistaPorIdService, actualizarEspecialistaService, eliminarEspecialistaService, subirImagenPerfilService } from "../services/especialistas.services.js";

export const agregarEspecialista = async (req, res) => {
    const especialista = await guardarEspecialistaService(req.body);
    res.status(201).json({ mensaje: "Especialista creado", especialista });
};

// Público: con sus servicios activos. Con sesión de administrador, con todos sus servicios.
export const obtenerEspecialistas = async (req, res) => {
    const especialistas = await obtenerEspecialistasService({ incluirInactivos: Boolean(req.user) });
    res.status(200).json({ mensaje: "Especialistas obtenidos", especialistas });
};

export const obtenerEspecialistaPorId = async (req, res) => {
    const especialista = await obtenerEspecialistaPorIdService(req.params.id);
    res.status(200).json({ mensaje: "Especialista obtenido", especialista });
};

export const actualizarEspecialista = async (req, res) => {
    const { especialista, reservasFueraDeDia } = await actualizarEspecialistaService(req.params.id, req.body);
    res.status(200).json({ mensaje: "Especialista actualizado", especialista, reservasFueraDeDia });
};

export const eliminarEspecialista = async (req, res) => {
    const { especialista, serviciosSinAsignar } = await eliminarEspecialistaService(req.params.id);
    res.status(200).json({ mensaje: "Especialista eliminado", especialista, serviciosSinAsignar });
};

export const subirImagenPerfil = async (req, res) => {
    const especialista = await subirImagenPerfilService(req.params.id, req.file);
    res.status(200).json({
        mensaje: "Imagen de perfil actualizada correctamente",
        imagenPerfil: especialista.imagenPerfil
    });
};
