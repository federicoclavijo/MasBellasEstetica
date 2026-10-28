export const errorMiddleware = (err, req, res, next) => {
    if (res.headersSent) return next(err);

    let status = err.status || err.statusCode || 500;
    let mensaje = status < 500 || err.expose ? err.message : "Error interno del servidor";

    if (err.name === "MulterError") {
        status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
        mensaje = err.code === "LIMIT_FILE_SIZE" ? "La imagen no puede superar los 5 MB" : "No se pudo procesar el archivo";
    } else if (err.type === "entity.parse.failed") {
        status = 400;
        mensaje = "El cuerpo de la solicitud no es un JSON válido";
    } else if (err.name === "ValidationError" && err.errors) {
        status = 400;
        mensaje = Object.values(err.errors).map((e) => e.message).join(". ");
    } else if (err.name === "CastError") {
        status = 400;
        mensaje = "Alguno de los datos enviados no es válido";
    } else if (err.code === 11000) {
        status = 409;
        // MongoDB informa el campo en keyPattern; si no (otros motores), se intenta leer el nombre del índice del mensaje.
        const delIndice = /index: (\S+?)(?:_\d+)?\s/.exec(err.message ?? "")?.[1];
        const campos = Object.keys(err.keyPattern ?? err.keyValue ?? {}).length ? Object.keys(err.keyPattern ?? err.keyValue) : (delIndice ? [delIndice] : []);
        mensaje = campos.length ? `Ya existe un registro con el mismo valor en: ${campos.join(", ")}` : "Ya existe un registro con esos datos";
        console.error("Clave duplicada:", err.message);
    }

    // Los errores inesperados se registran; al cliente nunca se le muestran los detalles internos.
    if (status >= 500) console.error(err);

    res.status(status).json({ mensaje });
};
