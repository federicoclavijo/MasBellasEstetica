import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

export const login = async (req, res) => {
    const { user, pass } = req.body ?? {};

    if (typeof user !== "string" || typeof pass !== "string" || !user || !pass) {
        return res.status(400).json({ mensaje: "Se requieren usuario y contraseña." });
    }

    if (user !== process.env.ADMIN_USER || !bcrypt.compareSync(pass, process.env.ADMIN_PASS)) {
        return res.status(401).json({ mensaje: "Usuario o contraseña incorrectos." });
    }

    const token = jwt.sign({ rol: "admin" }, process.env.JWT_SECRET, { expiresIn: "1d" });
    res.json({ mensaje: "Login de admin", token });
};
