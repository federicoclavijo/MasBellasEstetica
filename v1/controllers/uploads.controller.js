import { upload } from "../middlewares/multer.middleware.js";
import { runMulterSingle } from "../utils/multer.util.js";
import { subirImagenService } from "../services/uploads.service.js";

export const subirImagen = async (req, res) => {
    try {
        await runMulterSingle(upload, "imagen", req, res);

        if (!req.file) {
            return res.status(400).json({
                error: "No se subió ningún archivo"
            });
        }

        const result = await subirImagenService(
            req.file.buffer,
            "uploads"
        );

        return res.status(200).json({
            url: result.secure_url,
            folder: result.folder
        });

    } catch (error) {
        console.error("Error al subir imagen:", error);

        return res.status(500).json({
            error: "Error al subir imagen"
        });
    }
};