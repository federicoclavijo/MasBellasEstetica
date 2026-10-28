import "dotenv/config";
import app from "./app.js";
import { expirarReservasPendientesService } from "./v1/services/reservas.services.js";

const PORT = process.env.PORT || 3000;
const INTERVALO_EXPIRACION = 60 * 1000; // 1 minuto

const ejecutarExpiracion = async () => {
    try {
        await expirarReservasPendientesService();
    } catch (error) {
        console.error("Error en la tarea de expiración:", error);
    }
};

app.listen(PORT, () => {
    console.log(`http://localhost:${PORT}`);

    // Libera las reservas cuyo plazo de pago venció, al iniciar y luego cada minuto.
    // (En hosting serverless como Vercel este temporizador no corre: por eso la disponibilidad
    // y las reservas también liberan lo vencido en el momento de consultarse.)
    ejecutarExpiracion();
    setInterval(ejecutarExpiracion, INTERVALO_EXPIRACION);
});
