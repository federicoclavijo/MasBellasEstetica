import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import v1Routes from "./v1/v1.routes.js"
import { notFoundMiddleware } from "./v1/middlewares/notFound.middleware.js"
import { connectDB } from "./v1/config/db.config.js"
import { errorMiddleware } from "./v1/middlewares/error.middleware.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

connectDB();

const app = express();

app.use(cors());

app.use(express.json());
app.use(express.static(path.join(__dirname, "v1", "public")));
app.use(express.urlencoded({ extended: true }))

app.use("/v1", v1Routes);

app.use(notFoundMiddleware);
app.use(errorMiddleware);

export default app;