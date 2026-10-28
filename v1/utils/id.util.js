// isValidObjectId() de Mongoose acepta cualquier texto de 12 caracteres; aquí exigimos 24 hex.
export const esObjectIdValido = (id) => typeof id === "string" && /^[a-f\d]{24}$/i.test(id);
