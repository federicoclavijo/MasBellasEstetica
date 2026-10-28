import cloudinary from "../config/cloudinary.js";
import { uploadBufferToCloudinary } from "../utils/cloudinary.util.js";

export const subirImagenService = async (buffer, folder = "uploads") => {
    const result = await uploadBufferToCloudinary(
        cloudinary,
        buffer,
        {
            resource_type: "image",
            folder
        }
    );

    return result;
};