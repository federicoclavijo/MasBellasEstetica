// Errores HTTP uniformes. `expose` indica si el mensaje es seguro de mostrar al cliente.
export const crearError = (status, mensaje, extra = {}) =>
    Object.assign(new Error(mensaje), {
        status,
        statusCode: status,
        expose: status < 500,
        ...extra,
    });
