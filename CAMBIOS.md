# MasBellas · Servidor — Cambios realizados

# Actualización 7 · Aviso a administradores, constancia de asistencia y animaciones hover

### Aviso por correo a los administradores cuando se paga una reserva
- Nuevas variables en el `.env`: **`ADMIN_EMAIL_1`** y **`ADMIN_EMAIL_2`**. Con una sola alcanza; si faltan las dos no se envía nada. Las direcciones inválidas se ignoran (queda un aviso en el log) y las repetidas se unifican.
- Se envía **un único correo** a todos los administradores (con el cliente en «Responder a») cuando la reserva queda pagada: por Mercado Pago, o cuando el administrador confirma una transferencia BROU. Trae cliente (cédula, correo, teléfono), consulta o tratamiento, especialista, fecha y hora, importe (en tratamientos: valor, seña y lo que resta cobrar en el local), medio de pago y referencia. Mismo diseño que el correo del cliente.
- **Se envía una sola vez** por reserva aunque Mercado Pago repita el aviso, y es independiente del correo al cliente: si uno falla, el otro igual sale, y nunca afecta al pago.
- Usa la misma configuración SMTP que la confirmación al cliente (`SMTP_HOST`, etc.): **sin `SMTP_HOST` no se envía ningún correo**.

### Constancia de asistencia (panel → Reservas)
- En las reservas **confirmadas cuyo turno ya empezó** aparecen los botones **Asistió** / **No asistió**. La marca se ve como etiqueta en la columna Estado (**Asistió**, **No asistió**, o **Asistencia sin registrar** si nadie la marcó todavía) y queda guardada con su fecha.
- **Corregir asistencia** quita la marca por si hubo un error. Hay un filtro nuevo «Asistencia» para ver quién asistió, quién no y qué falta registrar.
- Reglas: solo reservas confirmadas (pagadas); no se puede marcar antes del horario del turno; y una reserva con «Asistió» no se puede cancelar sin quitar antes la marca. La marca es solo constancia: **no cambia pagos ni reembolsos**.

### Animaciones hover
- **Botones de toda la aplicación** (públicos y panel: botones, pestañas, enlaces del menú, fechas sugeridas, selector de días, cierre de diálogos): se elevan 2 px y ganan una sombra suave en 0,2 s; al presionar vuelven a su lugar.
- **Tarjetas de «Nosotros»** (valores, pasos de «cómo trabajamos» y equipo): se elevan 4 px con sombra y borde dorado; el ícono / avatar crece apenas.
- Quien tiene activada la opción «reducir movimiento» en su sistema no ve el desplazamiento.

### Pruebas
- `npm test` (12) y `npm run test:integracion` (19, nuevas: aviso a administradores y asistencia) pasan. La prueba del aviso usa un servidor SMTP local y comprueba destinatarios, contenido, una sola vez y el caso de un solo administrador.

---

# Actualización 6 · Cédula y correo en la tabla, términos y condiciones, días de atención por especialista

### Tabla de reservas
- La **cédula** del cliente ahora se muestra en la columna Cliente (formato 4.123.456-7).
- **Correo cortado:** se partía a mitad de palabra. Ahora solo baja de línea en el «@» o en los puntos, y nunca recorta la columna de acciones. En celular se muestra completo.

### Términos y condiciones
- Nueva página `/terminos.html` (misma estética): resumen de lo importante, índice y 12 secciones (reserva y pago de la consulta, **sin asistencia no hay devolución**, reprogramación con 24 h, cancelación por parte de la clínica, tratamientos y seña del 50 %, disponibilidad de especialistas, salud y consentimiento, resultados, menores, datos personales —Ley 18.331—, cambios y contacto).
- Enlace en el pie de todas las páginas públicas y **casilla obligatoria «Acepto los términos»** en el formulario de reserva. Es una validación del formulario: no se guarda la aceptación en la base.
- El texto es genérico: que lo revise la clínica (y un abogado) antes de publicarlo. Los plazos (24 h, 10 min de tolerancia) son editables en `terminos.html`.
- El pie decía «Todos los días»: ahora «Lunes a sábado» (editable).

### Días de atención por especialista
- Cada especialista tiene `diasDisponibles` (0 = domingo … 6 = sábado). **Por defecto lunes a sábado**; el domingo no atiende nadie salvo que se marque. Los especialistas existentes toman ese valor por defecto: **hay que entrar a Especialistas → Modificar y dejar solo «Sáb» al que va únicamente los sábados.**
- Panel → Especialistas: selector de días (Lun…Dom) al crear/modificar y los días se ven en cada tarjeta. Se puede cambiar cuando se quiera.
- **Misma regla en todos lados** (la valida el servidor): formulario del cliente, alta de tratamiento del administrador y reprogramación. Una fecha en un día que no atiende devuelve «Dra. X no atiende los lunes. Atiende: sábados» y ningún horario.
- Formularios: al elegir servicio/tratamiento aparece «atiende los sábados» con las **próximas fechas válidas** para elegir con un toque (el calendario del navegador no permite bloquear días de la semana). Cada especialista muestra sus días en «Especialista a cargo».
- Si se quita un día que ya tiene reservas, **esas reservas se mantienen** y el panel avisa cuántas quedaron en un día que ya no atiende para reprogramarlas.
- Al menos un día es obligatorio.

### Pruebas
- `npm test` (12) y `npm run test:integracion` (17, nueva: días de atención) pasan. Las pruebas existentes ahora crean especialistas que atienden los 7 días para no depender del día en que se ejecutan.

---

# Actualización 5 · Varias consultas y mismo precio, tabla, responsive y correo de confirmación

### Varias consultas de $500 y servicios con el mismo precio
- **Causa probable:** el código nunca limitó la cantidad de consultas ni repetir precios (hay pruebas con 3 consultas de $500 y un tratamiento de $500). Lo que sí produce exactamente esos dos síntomas es un **índice único viejo sobre `precio`** en tu base: Mongoose crea índices pero **nunca los borra** cuando cambia el esquema, y como todas las consultas valen $500, la segunda chocaba con la primera. No puedo ver tu base, así que es la explicación más probable, no una certeza.
- **Arreglo:** al arrancar, el servidor elimina los **índices únicos que ningún modelo declara** (se informa en el log: «Índice único obsoleto eliminado…»). Los índices no únicos y los declarados (nombre del servicio, correo del cliente, horario de la reserva) no se tocan. Se desactiva con `LIMPIAR_INDICES=false`. Reproduje el problema (un índice único sobre `precio` bloquea la segunda consulta) y comprobé que la limpieza lo resuelve.
- Si hace falta hacerlo a mano en MongoDB: `db.servicios.dropIndex("precio_1")`.
- Los **errores de clave duplicada** ahora dicen qué campo se repite («Ya existe un registro con el mismo valor en: …»), para diagnosticar al instante. El **nombre** del servicio sigue siendo único (no puede haber dos servicios llamados igual).
- Cómo funciona (ya estaba así, ahora confirmado): en *Servicios → Nuevo servicio* eliges **Consulta** ($500 fijos, la reserva el cliente) o **Tratamiento** (lo agenda el administrador, con el precio de cada cliente y seña del 50 %). Puedes tener **todas las consultas que quieras**; en el formulario del cliente **solo aparecen las consultas**.

### Tabla de reservas
- Causas: el contenedor era angosto para 9 columnas, el contenedor recortaba lo que no entraba y el texto se partía letra por letra. Ahora: panel más ancho, **6 columnas** (Cliente · Servicio · Fecha y hora · Importe · Estado · Acciones), nada se recorta (si no entra, hay scroll), las etiquetas no se parten, y los botones de acción se acomodan en varias líneas. En celular se muestra como tarjetas.

### Revisión responsive
- Probé con un **Chromium real** a 360, 390, 768, 1024 y 1366 px las páginas públicas, el panel (reservas, servicios, especialistas) y los diálogos (nuevo tratamiento, nuevo servicio, mensaje de WhatsApp), con detección automática de desbordes y textos recortados y revisión de capturas. Corregí: la tabla, las pestañas del panel en pantallas angostas, **tarjetas de valores/equipo/especialistas con alturas desiguales** (una regla global `.card + .card` sumaba margen a todas menos a la primera) y la separación de campos en formularios de una columna. Las tablas de servicios y especialistas también se ajustan.
- No pude probar en dispositivos físicos: conviene una pasada rápida en tu celular.

### Correo de confirmación de reserva
- **Cuándo se envía:** cuando el pago queda acreditado (aviso de Mercado Pago, o la página de resultado si el aviso demora) y la reserva pasa a **confirmada**; también cuando el administrador confirma una **transferencia BROU**. Se envía **una sola vez** aunque Mercado Pago repita el aviso o varias vías confirmen a la vez.
- **Qué dice:** «¡Hola Lucía, tu reserva quedó confirmada!» con consulta o tratamiento, especialista, fecha, hora y duración, importe abonado (y, en tratamientos, valor total, seña y **saldo a abonar en el local**), referencia de reserva, y dirección/teléfono si los configuras. Va en HTML con la paleta de la marca y en texto plano; el nombre del cliente se escapa.
- **Configuración** (variables de entorno): `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_SECURE` (`true` para 465), `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`; opcionales `NEGOCIO_DIRECCION` y `NEGOCIO_TELEFONO`. Ejemplo con Gmail en `.env.example` (requiere «contraseña de aplicación»). **Sin `SMTP_HOST` todo funciona igual, pero no se envían correos** (el servidor lo avisa una vez en el log).
- **Si falla el correo** (servidor caído, dirección inválida), el pago y la reserva **no se ven afectados** (Mercado Pago recibe igualmente 200); el error queda en el log y el envío se reintenta con el siguiente aviso. En el panel, cada reserva confirmada muestra «✉ Correo de confirmación enviado / sin enviar» y tiene un botón **Reenviar correo**.
- Requiere `npm install` (nuevo: `nodemailer`; solo para pruebas: `smtp-server`, `mailparser`).

### Cosas a tener en cuenta
- **Producción:** Gmail limita ~500 correos/día y puede caer en spam. Para uso real conviene un servicio de envío (Brevo, Amazon SES, Resend, Mailgun…) con un dominio propio y **SPF/DKIM** configurados; solo cambias las variables SMTP.
- **«Una sola vez» entre varios servidores:** dentro de un proceso lo garantiza un cerrojo en memoria y entre procesos la actualización atómica de MongoDB (Atlas la ofrece). Mi base de pruebas no la ofrece, así que esa parte la verifiqué dentro de un proceso, no con concurrencia entre varios.
- El correo del cliente es un dato personal: menciónalo en tu política de privacidad.

---

# Actualización 4 · Marca +Bellas, «Nosotros» y reservas de consulta / tratamiento

> Esta actualización **cambia la lógica de negocio**: lo descrito en las secciones anteriores sobre «servicios con seña del 50 % reservables por el cliente» queda reemplazado por lo siguiente.

### Lógica de negocio
- **El cliente solo reserva consultas.** Cada consulta cuesta **$500 fijos** (se abona completo al reservar con Mercado Pago) y dura **30 minutos**. Ahora puede haber **varias consultas** (p. ej. facial, corporal, capilar): se eliminó el límite de una sola. El precio de una consulta siempre lo fija el sistema.
- **Un especialista sigue pudiendo tener varios servicios:** al elegir el tipo de consulta se resalta al especialista que atenderá. Las consultas y los tratamientos de un mismo especialista comparten agenda (no se pisan).
- **Los tratamientos los agenda el administrador** (menú *Reservas → Nuevo tratamiento*), cuando el cliente ya consultó y decide avanzar. Completa: cliente (nombre, teléfono, correo; cédula y nacimiento opcionales), tratamiento, fecha y horario (turnos de 1 hora) y el **precio total para ese cliente**. El sistema calcula la seña (**50 %**) y el resto se abona en el local.
  - El panel permite **buscar un cliente que ya consultó** y autocompleta sus datos.
  - En *Servicios*, el tipo se elige: *Consulta* (la reserva el cliente, $500 fijos) o *Tratamiento* (lo agenda el administrador; el precio es solo una referencia **opcional** que se precarga y se puede cambiar en cada reserva). Los tratamientos **ya no aparecen en el formulario público**.
- **Mensaje de WhatsApp:** al crear el tratamiento se genera un mensaje genérico con el valor, la seña, lo que resta en el local y los **medios de pago**: el enlace de pago de Mercado Pago y la **cuenta BROU**, que se cambia con `BROU_CUENTA` en el `.env` (y `BROU_TITULAR`, opcional). El texto se edita en `v1/utils/whatsapp.util.js`.
  - **Importante — no es un envío automático:** el panel abre WhatsApp con el mensaje y el número (+598) ya cargados mediante un enlace `wa.me`, y la persona del local solo presiona «Enviar» desde su propio WhatsApp. Es lo que se puede hacer sin cuenta de WhatsApp Business ni aprobación de plantillas. Un envío 100 % automático requiere la **API de WhatsApp Business (Cloud API)**: cuenta de Meta, número verificado y una plantilla de mensaje aprobada (los mensajes iniciados por la empresa fuera de las 24 h solo se permiten con plantilla). Si lo quieres, es una evolución natural de esta función.
  - Cada reserva pendiente tiene un botón **WhatsApp** para reenviar el mensaje.
- **Pago por transferencia BROU:** no se detecta sola, así que el botón **Confirmar pago** (en reservas pendientes) la confirma a mano y anula el enlace de Mercado Pago para que no se pague dos veces. Un pago por transferencia **no se reembolsa por Mercado Pago**: se devuelve desde el banco y se usa «Marcar reembolso».
- **Plazos:** la consulta web retiene el horario 15 min (`RESERVA_TTL_MINUTOS`). El tratamiento lo retiene **2 días** (`RESERVA_ADMIN_TTL_DIAS`), porque el cliente paga después de recibir el mensaje; el enlace de Mercado Pago se crea con `expiration_time` igual a ese plazo. Una consulta nueva del mismo cliente reemplaza a su consulta web pendiente, **pero no a su tratamiento**.

### Teléfono
- Campo obligatorio en el formulario de reserva y en el alta del tratamiento. Solo **celulares de Uruguay** (099 123 456, 99123456, +598 99 123 456…), porque se usa para WhatsApp. Se guarda normalizado (`+59899123456`) en la reserva y en el `Usuario`.

### Marca y diseño
- Título **+Bellas** con el «+» en degradado dorado. Tipografías: **Cormorant Garamond** (marca y títulos) + **DM Sans** (texto), usadas igual en todas las vistas.
- Fondo en **degradado** (blanco → rosado → dorado suave) fijo detrás del contenido, y paleta **rosado, blanco y dorado** en todas las pantallas (incluido el panel). Se mantienen el verde y el rojo suaves solo para los estados «aprobado/error» por legibilidad.
- Nueva página **Nosotros** (`/nosotros.html`, con enlace en el navbar de todas las páginas públicas): presentación, valores, «cómo trabajamos» (consulta → evaluación → plan → tratamiento), imágenes, equipo (se carga con los especialistas reales del sistema) y llamado a reservar. Incluye un pie de página con contacto y horario.
  - **Las imágenes son ilustraciones propias** (`public/img/*.svg`) en la paleta, porque no tengo acceso a fotos tuyas. Para usar fotos reales, reemplaza el `src` de las `<img>` en `nosotros.html`.
  - **Edita los datos de contacto del pie de página** (`nosotros.html`, `index.html`, `resultado.html`: están marcados con `EDITAR`): hoy son de ejemplo. El texto de «Nosotros» es genérico: ajústalo a tu historia real y no afirmes certificaciones o años de experiencia que no puedas respaldar.
  - El descriptor que aparece en el resumen de tarjeta (`statement_descriptor`) sigue siendo «Más Bellas»: los descriptores admiten pocos caracteres especiales y no quise arriesgar el cobro con un «+».

### Datos existentes
- Los servicios existentes **no se migran**: los que tenían `porcentaje: false` son consultas (se muestran al público); los demás son tratamientos (dejan de verse en el formulario y pasan a agendarse desde el panel). Las reservas anteriores no tienen teléfono (no muestran el botón de WhatsApp) y su tipo se deduce de la seña (100 % = consulta).
- Para un cliente ya registrado, el teléfono y la cédula se completan solo si le faltaban (no se pisan datos existentes).

### Rutas nuevas
`POST /v1/reservas/admin` (alta de tratamiento) · `GET /v1/reservas/:id/whatsapp` · `POST /v1/reservas/:id/confirmar-pago` · `GET /v1/usuarios?q=` (buscar clientes) · `GET /v1/reservas/disponibilidad` con sesión de administrador también devuelve horarios de tratamientos.

### Cosas a tener en cuenta / mejoras
- **No pude probar contra Mercado Pago real**: el campo `expiration_time` (para que el enlace dure lo mismo que la reserva) y el resto del pedido siguen su documentación y están probados contra una simulación; haz una compra de prueba del flujo de tratamiento. Tampoco pude ver las páginas en un navegador real (solo comprobé el comportamiento y revisé las ilustraciones): conviene que las mires en celular y escritorio.
- Hoy el sistema **no registra si el saldo (50 %) se pagó en el local**: sería una mejora simple («marcar saldo abonado») para tu control de caja.
- Los datos personales (teléfono, nacimiento) de clientes están en tu base: en Uruguay aplica la Ley 18.331 de protección de datos personales; conviene agregar una política de privacidad y un aviso de consentimiento en el formulario.

---

# Actualización 3 · Reembolsos desde el panel

### Cómo funciona
- En **Reservas**, las reservas canceladas o expiradas con pago aprobado tienen el botón **Reembolsar**. Muestra cuánto se devuelve, a quién y de qué orden, y al confirmar el servidor llama a `POST /v1/orders/{id}/refund` de Mercado Pago. Si responde bien, la reserva queda `reembolsado` (con monto, porcentaje, id del reembolso y fecha) y ya se puede eliminar.
- **Porcentaje configurable:** variable de entorno `REEMBOLSO_PORCENTAJE` (1 a 100). Por defecto **100** (se devuelve toda la seña). Ejemplo: `REEMBOLSO_PORCENTAJE=50` devuelve la mitad. Si el valor es inválido (vacío, 0, 150, texto…) se usa 100. Es de lectura en caliente en el código, pero en producción hay que reiniciar el servidor al cambiar el `.env`. Cada reserva guarda el porcentaje que se aplicó, así que cambiarlo después no altera el historial.
  - 100 % → reembolso **total** (cuerpo vacío, como exige la API). Menos de 100 % → reembolso **parcial** (se envía el id de la transacción de pago y el monto).
- **Cómo ubicar el pago en Mercado Pago:** la columna *Pago* ahora muestra el **ID de la orden** de cada reserva (y, si ya se devolvió, el monto y el porcentaje).
- **«Marcar reembolso»** sigue existiendo, pero solo para devoluciones hechas **a mano** en el panel de Mercado Pago (no envía dinero).

### Protecciones
- Solo administradores; solo reservas **canceladas o expiradas** con pago **aprobado**; una reserva activa hay que cancelarla primero.
- **Sin doble reembolso:** cerrojo por reserva (dos clics o dos administradores a la vez → el segundo recibe «ya hay un reembolso en curso»; un cerrojo colgado se ignora a los 2 minutos) y clave de idempotencia `reembolso-<reserva>-<porcentaje>` en Mercado Pago.
- Si Mercado Pago rechaza (saldo insuficiente, más de 180 días, ya reembolsada…), la reserva sigue como pagada, se muestra el motivo y se puede reintentar.
- Si la respuesta se pierde pero el reembolso sí ocurrió, el sistema lo detecta consultando la orden y lo registra igual. Si la orden ya figura reembolsada en Mercado Pago, solo se registra, sin pedirlo otra vez.

### Cosas a tener en cuenta
- **No pude probarlo contra el API real de Mercado Pago** (sin red ni credenciales): la forma del pedido sigue su documentación y está probada contra una simulación. Haz un reembolso real pequeño de prueba antes de confiar en él. Revisa especialmente el reembolso **total** (cuerpo vacío) y, si usas menos de 100 %, el parcial.
- Mercado Pago descuenta el reembolso del **saldo de tu cuenta**: si no alcanza, rechaza el pedido.
- Mercado Pago solo permite reembolsar dentro de los **180 días** de aprobado el pago.
- La seña se cobra por Checkout Pro; la comisión que Mercado Pago retiene por el cobro puede no devolverse según tus condiciones con ellos: eso se define en tu cuenta, no aquí.
- Rutas: `POST /v1/reservas/:id/reembolsar` (devuelve el dinero) y `POST /v1/reservas/:id/reembolso` (solo deja constancia).

---

# Actualización 2 · Un especialista con varios servicios

### Qué cambió
- **Relación N a 1:** un especialista puede tener **varios** servicios; cada servicio sigue teniendo **un** especialista (o ninguno).
  - La fuente única es `Servicio.especialistaId` (ahora opcional: `null` = **«Sin asignar»**).
  - Eliminé `Especialista.servicioId` (con varios servicios ya no tiene sentido) y lo reemplacé por el virtual `Especialista.servicios`, que la API devuelve en `GET /especialistas` y `GET /especialistas/:id` (el público solo ve los servicios activos). Sigue siendo bidireccional, sin dato duplicado que se desincronice.
- **Asignar desde los dos lados:** en el panel, el servicio elige su especialista (o «Sin asignar») y la ficha del especialista tiene una lista de casillas «Servicios a cargo». La API acepta `serviciosIds: [...]` en `POST/PATCH /especialistas`.
  - Al marcar un servicio que hoy tiene otro especialista, se le quita a ese (el formulario lo avisa: «Hoy a cargo de X»); lo que se desmarca queda «Sin asignar».
  - Todo se valida **antes** de aplicar (nada queda a medias).
- **Eliminar un especialista asignado:** ahora se puede. Sus servicios quedan en «Sin asignar» (`especialistaId = null`) y el panel lo avisa antes de confirmar y después de hacerlo.
  - Lo único que lo impide son los **turnos futuros reservados** con él (esos clientes se quedarían sin profesional): hay que cancelarlos o reprogramarlos primero. Mismo criterio al cambiar o quitar el especialista de un servicio que tiene turnos futuros.
  - Las reservas viejas conservan el nombre del especialista eliminado.
- **Servicio «Sin asignar» en el formulario público:** se muestra pero no se puede elegir («Disponible próximamente»), y el servidor también lo rechaza (409) si se intenta reservar o pedir horarios.
- **Turnos de distinta duración del mismo especialista:** ahora es una situación real (una consulta de 30 min y un tratamiento de 60 min del mismo especialista). Los cruces se detectan: una consulta a las 10:30 no entra si hay un tratamiento de 10:00 a 11:00, y un tratamiento a las 11:00 no entra si hay una consulta a las 11:00. Está cubierto por pruebas.
- **Tarjetas de especialistas desiguales:** la causa era la regla global `.card + .card { margin-top: 1rem }` de `styles.css`: dentro de la grilla le sumaba margen a todas las tarjetas menos a la primera, que parecía más grande. Se anuló para las tarjetas de la grilla (`.cards`) y las tarjetas pasan a estirarse a la misma altura. También muestran ahora los servicios que tienen a cargo.

### Cosas a tener en cuenta
- **Datos existentes:** ejecuta `node scripts/verificar-relaciones.js --reparar`. Elimina el campo viejo `servicioId` de los especialistas y deja «Sin asignar» a los servicios que apuntan a un especialista que ya no existe. (Si no lo ejecutas no pasa nada grave: el campo viejo simplemente se ignora.)
- Un servicio **activo pero «Sin asignar»** no se puede reservar. Si prefieres que al eliminar un especialista sus servicios también se desactiven, es un cambio de una línea; lo dejé como pediste (solo pierden el especialista).
- Al eliminar un especialista **no se borra su foto de Cloudinary** (queda huérfana). Conviene agregarlo si te preocupa el espacio.
- Si tienes código propio que lea `Especialista.servicioId`, ese campo ya no existe: usa `Especialista.servicios` o consulta `Servicio.especialistaId`.

---

# Actualización 1 · Cambios iniciales


Todo lo descrito está probado: 11 pruebas unitarias, 16 de integración (API + MongoDB + servidor SMTP real, Mercado Pago simulado), una prueba de comportamiento de las cuatro páginas (58 comprobaciones) y una auditoría responsive con un Chromium real ejecutadas contra la API real.

## 1. Cómo probarlo

```bash
npm install
cp .env.example .env        # o conserva tu .env actual (este zip NO incluye el tuyo)
node scripts/verificar-relaciones.js   # revisa datos viejos (ver sección 5)
npm run dev
npm test                                              # reglas puras
TEST_MONGO_URI=mongodb://.../base_descartable npm run test:integracion   # ¡borra esa base!
```

## 2. Qué se pidió y cómo quedó

### Especialista ⇄ Servicio
*(Reemplazado por la Actualización 2: ahora un especialista puede tener varios servicios.)*
- Cada servicio tiene un único especialista a cargo (o ninguno: «Sin asignar»); un especialista puede tener varios servicios.

### Seña del 50 % y consulta
- Se usa tu campo `porcentaje`: `true` = tratamiento (seña 50 %, turnos de 1 h); `false` = **consulta** (valor fijo **$500**, turnos de 30 min). Solo puede existir un servicio de consulta.
- El precio de la consulta lo fija el servidor (`config/negocio.config.js`); no se puede cambiar desde el panel.
- **Supuesto a confirmar:** tomé los $500 como el precio total de la consulta, que se cobra completo (guarda `porcentajeSena: 100`). Si en realidad $500 es solo la seña y la consulta vale más, hay que agregar un precio aparte.
- Turnos: 08:00–20:00. Tratamientos: 12 turnos (08:00…19:00). Consulta: 24 turnos (08:00…19:30). El servidor detecta cruces entre turnos de distinta duración.
- El servidor calcula y devuelve `montoSena`, `porcentajeSena`, `duracionMinutos`, `esConsulta`; el frontend ya no repite la regla.

### Formulario
- Se muestran todos los servicios (activos) y todos los especialistas; **solo se elige el servicio** y se resalta al especialista a cargo.
- La disponibilidad ahora se pide por servicio: `GET /v1/reservas/disponibilidad?fecha=AAAA-MM-DD&servicioId=…` (antes era por `especialistaId`).
- El cliente ya no envía `especialistaId`: el servidor lo toma del servicio (evita datos inconsistentes).

### Fecha de nacimiento → documento `Usuario`
- Nuevo modelo `Usuario { nombre, email (único), fechaNacimiento }`. Se crea al reservar y se reutiliza si el correo ya existe; la reserva guarda `usuarioId`.
- Si el correo ya existe **no se sobrescriben** sus datos (el formulario es público: cualquiera podría escribir el correo de otra persona).
- El `Usuario` anterior (user/pass) no se usaba: el login del admin siempre fue por `.env`. Eliminé `usuarios.controller.js` (código de otro proyecto, importaba funciones inexistentes).

### Mensajes de desarrollo
- Eliminados "Limitaciones de la API actual", los avisos de la API y de sesión del formulario, los comentarios "OJO…", la nota "importe estimado", y los logs de cada minuto y del JSON completo de Mercado Pago.

### Panel: altas, modificaciones y bajas
- **Alta** de servicio y de especialista (con foto opcional; la foto es un 2.º pedido: si falla, el alta queda y se avisa).
- **Reservas** — *Modificar* = reprogramar fecha/hora eligiendo entre horarios realmente libres; solo reservas activas y que no hayan empezado. *Cancelar* libera el horario (y cancela la orden en Mercado Pago si no estaba paga). *Eliminar* solo si no está activa ni tiene pago aprobado. *Marcar reembolso* para cerrar el caso de una reserva pagada y cancelada.
- **Servicios** — nombre sin duplicados (sin distinguir mayúsculas), precio, tipo, especialista, activo. *Eliminar* se bloquea con reservas futuras (sugiere desactivar) y libera al especialista.
- **Especialistas** — nombre sin duplicados y rol. *Eliminar* se bloquea si está a cargo de un servicio o tiene reservas futuras.
- Antes, modificar y eliminar **no funcionaban**: los validadores eran de otro proyecto (juegos/usuarios) y `eliminarReserva` pasaba un id donde Mongoose espera un filtro.

### Página de resultado que nunca se veía
Causas y arreglos:
1. A la orden le faltaba `auto_return: "approved"` (Mercado Pago no redirige solo sin eso). Ahora se envía **si `FRONTEND_URL` es https**.
2. Las URLs de retorno ahora llevan `?reserva=<id>`; antes dependían de `sessionStorage`, que se pierde si el pago termina en otra pestaña/dispositivo.
3. `resultado.js` consultaba `GET /reservas/:id`, que exige token de admin → siempre fallaba y mostraba "verificando". Ahora usa `GET /reservas/:id/estado` (público, sin datos personales).
4. La página se actualiza sola mientras el pago se acredita, y el servidor confirma la reserva al consultarla **aunque el webhook no haya llegado**.
5. Nuevas pantallas: pago rechazado, reserva ya no activa, reserva no encontrada.

## 3. Cosas que corregí por el camino (importantes)
- **La reserva vencía a 1 minuto** (valor de prueba): nadie alcanzaba a pagar. Ahora 15 min (`RESERVA_TTL_MINUTOS`).
- **En Vercel el `setInterval` de expiración nunca corre.** Ahora disponibilidad, reservas y bajas liberan lo vencido en el momento.
- Una reserva pagada podía quedar "pendiente" para siempre si el webhook se perdía; ahora se sincroniza con Mercado Pago (webhook, página de resultado y tarea de vencimiento comparten `pagos.services.js`).
- Si Mercado Pago rechaza crear la orden, el horario se libera enseguida (antes quedaba bloqueado).
- Un cliente mantiene **una sola** reserva pendiente: si reintenta, la anterior se cancela (evita "ese horario ya no está disponible" tras un pago rechazado).
- Doble reserva simultánea: el error del índice único ahora responde 409, no 500.
- Fechas/horas se calculan en `America/Montevideo` (el servidor corre en UTC) y se rechazan horarios pasados.
- `POST /reservas` no tenía validación (estaba comentada): ahora valida y descarta campos que el cliente no debe enviar (`estadoPago`, `montoSena`…).
- El login devolvía la contraseña en la respuesta (`body: req.body`) y fallaba con 500 si faltaba un dato.
- `GET /v1/ordenes/:id` era público y exponía datos del pagador: ahora requiere admin.
- Errores 500 ya no muestran mensajes internos; subida de imagen limitada a imágenes de 5 MB.
- Rutas con validación antes de la autenticación: invertido.

## 4. Archivos
Nuevos: `config/negocio.config.js`, `utils/{horarios,cobro,id,http-error}.util.js`, `services/pagos.services.js`, `middlewares/authenticateOptional.middleware.js`, `scripts/verificar-relaciones.js`, `test/`, `.env.example`.
Reescritos: modelos, servicios, controladores, validadores, rutas, `mercadoPago.services.js`, `server.js`, y en `public/`: `index.html`, `booking.js`, `admin.js`, `resultado.js`, `api.js`.

Rutas nuevas: `GET /reservas/:id/estado` (pública), `GET /reservas/:id/disponibilidad`, `POST /reservas/:id/cancelar`, `POST /reservas/:id/reembolso` (admin). `GET /servicios?todos=true` (admin) incluye inactivos; sin eso solo devuelve activos.

## 5. A tener en cuenta
- **Datos existentes:** ejecuta `node scripts/verificar-relaciones.js` (y `--reparar`). Un servicio viejo con `porcentaje: false` pasa a ser la consulta (precio forzado a $500, turnos de 30 min).
- **Mercado Pago en desarrollo:** con `FRONTEND_URL=http://localhost:3000` no hay redirección automática (el cliente usa "Volver al sitio") y los webhooks no llegan sin ngrok; la página de resultado igualmente confirma el pago. En producción usa https.
- **No pude probar contra el API real de Mercado Pago** (sin red ni credenciales): los campos `auto_return`, `success_url…` y el endpoint de cancelación están tomados de su documentación; pruébalo una vez con una compra de prueba.
- Los reembolsos se hacen desde el panel (ver Actualización 3).
- Los nombres de servicio y especialista se copian en cada reserva, así el historial sigue legible si luego se renombran o eliminan.
- La fecha de nacimiento se guarda a las 00:00 UTC del día indicado (léela con `timeZone: "UTC"`).
- **Seguridad:** el zip original incluía tu `.env` con credenciales reales (Mongo, Cloudinary, token de Mercado Pago). Conviene rotarlas. Este zip no incluye `.env`.

## 6. Mejoras sugeridas
- Límite de intentos (`express-rate-limit`) en `/auth/login` y `POST /reservas`; `helmet`; restringir CORS a tu dominio.
- Reembolso automático con la API de Mercado Pago y correo de confirmación/recordatorio al cliente.
- Cron externo (Vercel Cron) para expirar reservas en vez de depender del temporizador.
- Listado de clientes (`Usuario`) en el panel, con cumpleaños.
- Dependencias sin uso en `package.json`: `axios`, `groq-sdk`, `ngrok` (su instalación falla sin acceso a internet), `exports`, `module`.
- Paginación en el listado de reservas cuando crezca.
