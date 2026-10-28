import mongoose from "mongoose";
import { prepararIndices } from "./indices.config.js";

export const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log("Conexion a la base de datos establecida");
        await prepararIndices();
    }catch(e){
        console.log("Error al conectarse");
        console.log(e);
        process.exit(1);
    }
}