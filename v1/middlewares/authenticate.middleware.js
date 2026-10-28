import jwt from "jsonwebtoken"

export const authenticateMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ mensaje: "Acceso no autorizado." });
    }
    const token = authHeader.split(" ")[1];
    if (!token) {
        return res.status(401).json({ mensaje: "Acceso no autorizado" });
    }
    // Aquí iría la lógica para verificar el token
    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).json({ mensaje: "Token invalido" })
        }
        req.user = decoded;
        next();
    })
};

