import mongoose, { Schema } from "mongoose";

// Cliente de la estética. Se crea (o reutiliza) automáticamente al reservar.
// El administrador no vive aquí: sus credenciales están en las variables de entorno (ADMIN_USER / ADMIN_PASS).
const usuarioSchema = new Schema({
    nombre: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    // Móvil uruguayo en formato internacional (+598...). Se usa para enviar mensajes por WhatsApp.
    telefono: { type: String, default: null },
    cedula: { type: String, default: null },
    // Se guarda a las 00:00 UTC del día indicado (el día de calendario no cambia al leerlo con timeZone UTC).
    // Opcional: los clientes dados de alta por el administrador pueden no tenerla.
    fechaNacimiento: { type: Date, default: null },
}, {
    versionKey: false,
    timestamps: true,
});

// Un correo = un usuario. El filtro parcial evita conflictos con documentos antiguos sin correo.
usuarioSchema.index(
    { email: 1 },
    { unique: true, partialFilterExpression: { email: { $type: "string" } } }
);

export default mongoose.model("Usuario", usuarioSchema);
