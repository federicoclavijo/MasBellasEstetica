import { obtenerOrden } from "../services/mercadoPago.services.js";

// Solo administración: la orden de Mercado Pago contiene datos del pagador.
export const obtenerOrdenPorId = async (req, res) => {
    try {
        const orden = await obtenerOrden(req.params.id);
        return res.status(200).json(orden);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ mensaje: "No se pudo consultar la orden" });
    }
};
