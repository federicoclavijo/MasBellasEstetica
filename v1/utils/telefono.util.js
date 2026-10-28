// Teléfonos móviles de Uruguay (+598). Los mensajes se envían por WhatsApp, así que solo se aceptan celulares.
//   "099 123 456" · "99123456" · "+598 99 123 456" · "00598 99123456"  ->  "+59899123456"
export const normalizarTelefonoUY = (entrada) => {
    if (typeof entrada !== "string") return null;

    let digitos = entrada.replace(/[\s().-]/g, "");
    if (digitos.startsWith("+")) digitos = digitos.slice(1);
    if (!/^\d+$/.test(digitos)) return null;

    if (digitos.startsWith("00598")) digitos = digitos.slice(2);
    if (digitos.startsWith("598")) digitos = digitos.slice(3);
    else if (digitos.startsWith("0")) digitos = digitos.slice(1);

    // Celulares uruguayos: 9 + 7 dígitos (09X XXX XXX en formato local).
    if (!/^9\d{7}$/.test(digitos)) return null;

    return `+598${digitos}`;
};

// "+59899123456" -> "099 123 456" (formato local, para mostrar)
export const formatearTelefonoUY = (e164) => {
    const m = /^\+598(9\d)(\d{3})(\d{3})$/.exec(e164 ?? "");
    return m ? `0${m[1]} ${m[2]} ${m[3]}` : (e164 ?? "");
};

// "+59899123456" -> "59899123456" (formato que usa wa.me)
export const telefonoParaWhatsApp = (e164) => String(e164 ?? "").replace(/^\+/, "");
