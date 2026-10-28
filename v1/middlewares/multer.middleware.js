import multer from "multer";
import { crearError } from "../utils/http-error.util.js";

const storage = multer.memoryStorage();

export const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) =>
        file.mimetype.startsWith("image/")
            ? cb(null, true)
            : cb(crearError(400, "El archivo debe ser una imagen")),
});
