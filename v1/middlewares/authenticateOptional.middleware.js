import jwt from "jsonwebtoken";

// Rutas públicas que muestran más datos al administrador: si hay un token válido se carga req.user,
// y si no hay token (o es inválido) la solicitud continúa como pública.
export const authenticateOptionalMiddleware = (req, res, next) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (token) {
        try {
            req.user = jwt.verify(token, process.env.JWT_SECRET);
        } catch {
            // token inválido o vencido: se trata como visitante
        }
    }
    next();
};
