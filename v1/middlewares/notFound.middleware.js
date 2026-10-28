export const notFoundMiddleware = (req, res) => {
	res.status(404).json({
		mensaje: "Recurso no encontrado",
		metodo: req.method,
		ruta: req.originalUrl
	});
};
