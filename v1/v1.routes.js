import express from 'express';
import especialistasRoutes from './routes/especialistas.routes.js';
import reservasRoutes from './routes/reservas.routes.js';
import serviciosRoutes from './routes/servicios.routes.js';
import ordenesRoutes from './routes/orders.routes.js';
import usuariosRoutes from './routes/usuarios.routes.js';
import authRoutes from "./routes/auth.routes.js";
import webhooksRoutes from "./routes/webhooks.routes.js";
import { authenticateMiddleware } from './middlewares/authenticate.middleware.js';

const router = express.Router({ mergeParams: true });

router.use("/auth", authRoutes);

router.use("/reservas", reservasRoutes);
router.use("/especialistas", especialistasRoutes);
router.use("/servicios", serviciosRoutes);
router.use("/ordenes", ordenesRoutes);
router.use("/usuarios", usuariosRoutes);
router.use("/webhooks", webhooksRoutes);

export default router;

