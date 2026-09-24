# Fase 5B — Comunicación

**Fuente:** `docs/BoxAdmin_Fase5_PagosComunicacion.pdf` (segunda mitad)
**Fecha:** 2026-09-22
**Estado:** aprobado por Cesar

---

## 1. Qué entra

La otra mitad de la Fase 5: SMTP propio por gimnasio con la credencial cifrada, plantillas de email,
los cuatro processors de BullMQ y las notificaciones push del navegador.

Se apoya en la 5A: el job de recordatorio de pago pregunta **quién no está al día**, y eso lo contesta
`estaAlDia`, que se escribió allí.

Y es la fase donde **el hook de notificaciones deja de estar inerte**. Existe desde la 3A con un
comentario que dice lo que hay que respetar aquí:

> INVARIANTE: este metodo NUNCA debe lanzar. Se llama dentro de la transaccion que asigna el cupo,
> asi que una excepcion aqui revertiria una reserva perfectamente valida. Cuando la Fase 5 meta aqui
> una llamada de red, tiene que ir envuelta en su propio try/catch o salir de la transaccion.

---

## 2. Tres agujeros del PDF

**No se puede conectar a un SMTP con lo que el PDF guarda.** `ConfiguracionSMTP` tiene `emailOrigen`,
`claveSMTPCifrada` y `emailDestino`, y **ni host, ni puerto, ni usuario**. Con eso nodemailer no
puede abrir una conexión. Lo resuelve la sección 4.

**El email de confirmación no distingue de dónde viene la reserva.** En este sistema las reservas
nacen en bloque: publicar un mes le genera cuatro a cada alumno con rutina. Lo resuelve **D3**.

**`ultima_clase` es una plantilla sin disparador.** El PDF la lista entre los tipos y no le da ningún
evento. Queda fuera (sección 11).

---

## 3. Decisiones cerradas

### D1 — Los envíos van por un puerto con adaptador

Una interfaz `EnviosDeEmail` con dos implementaciones: nodemailer contra el SMTP del gimnasio, y una
**en memoria** que guarda lo que se habría enviado. La elige `EMAIL_TIPO`, exactamente como
`ALMACEN_TIPO` elige entre disco y S3 desde la Fase 3A.

**Por qué.** Los tests comprueban destinatario, asunto y cuerpo **ya renderizado** sin red y sin
infraestructura nueva. Un Mailpit en docker-compose probaría además nodemailer, pero ataría la suite
a un contenedor más — y Docker ya se ha caído nueve veces desde la Fase 2.

```ts
export interface EnviosDeEmail {
  enviar(mensaje: MensajeDeEmail): Promise<void>;
}
```

Lo mismo para push: `ENVIOS_PUSH`, elegido por `PUSH_TIPO`.

### D2 — `APP_ENCRYPTION_KEY` es obligatoria, y lo cifrado lleva versión

Se suma a las variables que `validar-entorno` exige para arrancar, junto a `JWT_SECRET` y
`BOOTSTRAP_KEY`: sin ella el proceso muere con un mensaje accionable en vez de arrancar a medias.

Y el valor guardado lleva prefijo de versión:

```
v1:<iv en base64>:<tag en base64>:<cifrado en base64>
```

**Por qué la versión.** Sin ella, rotar la clave obliga a que cada gimnasio vuelva a teclear su
contraseña SMTP, y hasta que lo haga sus emails dejan de salir sin un error que lo explique. Con
ella, el día que haga falta se puede leer lo viejo con la clave vieja y reescribirlo. Son diez líneas
ahora.

Esta fase **no implementa la rotación**; implementa el formato que la hace posible.

### D3 — Solo confirma lo que el alumno no da por sabido

| Origen de la reserva | ¿Manda email? |
|---|---|
| El alumno reserva, o el admin le asigna una clase suelta | Sí, confirmación |
| Cualquier cancelación | Sí |
| Entra desde la lista de espera | Sí |
| **`RUTINA`** (la crea el motor al publicar el mes) | **No** |

**Por qué.** Publicar septiembre con treinta alumnos de rutina son ciento veinte correos en el mismo
minuto: es volumen que marca un dominio como spam, y el alumno ya sabe que va todos los martes. Lo
que no sabe es lo que cambia.

### D4 — Las claves VAPID son opcionales

Sin ellas, `POST /push/suscripcion` responde **503** con un mensaje claro y el paso de push se salta
en los processors. El email sigue saliendo.

**Por qué, a diferencia de D2.** La credencial SMTP es **por gimnasio** y va cifrada en la base: si la
clave de cifrado falta, hay filas ilegibles y eso es un estado roto. Las VAPID son una capacidad **del
despliegue**: un gimnasio que solo quiere email es un despliegue completo, y exigirlas obligaría a
cada desarrollador a generar un par de claves para levantar la API.

### D5 — Las plantillas por defecto son constantes del código

Un gimnasio sin `PlantillaEmail` propia usa la del código. No se siembran filas por tenant.

**Por qué.** Sembrar obliga a que cada alta de gimnasio cree cinco filas, y mejorar un texto por
defecto pasaría a ser una migración de datos en vez de un cambio de código.

### D6 — La anticipación del vencimiento es configuración del tenant

`Tenant.diasAvisoVencimiento Int @default(7)`. El checklist del PDF dice "notifica con la anticipación
configurada" y hoy no hay dónde configurarla.

---

## 4. Modelo de datos

```prisma
/// Enum y no `String` libre como el PDF. Mismo criterio que TipoCancelacion,
/// EstadoComprobante y MetodoPago: un typo en un string libre es un bug
/// silencioso; el enum lo convierte en error de compilacion.
enum TipoPlantilla {
  CONFIRMACION
  CANCELACION
  RECORDATORIO_PAGO
  LISTA_ESPERA
  VENCIMIENTO_PACK
}

model ConfiguracionSMTP {
  tenantId String @id
  tenant   Tenant @relation(fields: [tenantId], references: [id])

  // El PDF guardaba emailOrigen, la clave y emailDestino, y con eso nodemailer
  // no puede abrir una conexion: faltan el servidor, el puerto y el usuario.
  host    String
  puerto  Int
  seguro  Boolean @default(true)
  usuario String

  /// AES-256-GCM con APP_ENCRYPTION_KEY, con prefijo de version. NUNCA viaja
  /// de vuelta al cliente, ni cifrada.
  claveCifrada String

  emailOrigen String
  /// Copia interna al salon. `null` = no se copia a nadie.
  emailDestino String?

  updatedAt DateTime @updatedAt

  @@map("configuraciones_smtp")
}

model PlantillaEmail {
  id       String @id @default(cuid())
  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id])

  tipo       TipoPlantilla
  asunto     String
  cuerpoHtml String

  updatedAt DateTime @updatedAt

  @@unique([tenantId, tipo])
  @@map("plantillas_email")
}

model SuscripcionPush {
  id       String @id @default(cuid())
  // El PDF NO le ponia tenantId, asi que la extension de aislamiento no podria
  // clasificarla y toda query sobre ella se bloquearia.
  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id])

  perfilId String
  perfil   Perfil @relation(fields: [tenantId, perfilId], references: [tenantId, id], onDelete: Cascade)

  endpoint String
  p256dh   String
  auth     String

  createdAt DateTime @default(now())

  @@unique([tenantId, perfilId, endpoint])
  @@index([tenantId, perfilId])
  @@map("suscripciones_push")
}
```

Y `Tenant` gana `diasAvisoVencimiento Int @default(7)`.

Migración: `fase5b_comunicacion`.

---

## 5. Arquitectura

### 5.1 Nada se envía dentro de una transacción

```
reservar / cancelar ──► encola job ──► processor ──► render ──► email + push
     (transaccion)         (fuera)
```

El hook de la 3A pasa a encolar. Encolar es una escritura a Redis que puede fallar, así que también
va **envuelta en try/catch y fuera de la transacción**: un Redis caído no puede tumbar una reserva
válida. El invariante de la 3A sigue en pie, ahora con motivo.

### 5.2 Lo puro y lo que toca la red

```ts
/** Que plantilla gana y como queda renderizada. PURA. */
export function resolverMensaje(
  propia: PlantillaDelTenant | null,
  tipo: TipoPlantilla,
  datos: DatosDePlantilla,
): { asunto: string; html: string };
```

Toda la lógica —qué plantilla gana, qué datos entran, cómo se escapan— se prueba con una tabla de
casos. El processor solo junta los datos y llama al puerto.

### 5.3 Los cuatro processors

| Processor | Cuándo | Qué manda |
|---|---|---|
| `notificacion-reserva` | al reservar o cancelar | `CONFIRMACION` / `CANCELACION` |
| `notificacion-lista-espera` | al entrar desde la cola | `LISTA_ESPERA`. **NO marca `ListaEspera.notificado`**: esa fila se borra al asignar el cupo, asi que cuando el worker toma el job ya no existe. La marca de idempotencia vive en el job. |
| `recordatorio-pago` | diario | `RECORDATORIO_PAGO` a quien **no** está al día |
| `vencimiento-pack` | diario | `VENCIMIENTO_PACK` si la vigencia cae dentro de `diasAvisoVencimiento` |

⚠️ **Los recurrentes solo se registran si `JOBS_RECURRENTES=1`.** Apagado por defecto, y por tanto en
tests y en desarrollo. Un cron diario registrado al arrancar dispara en **cada** `jest` que levanta la
aplicación, y con dos instancias de API se duplicaría. Se registran además con un `jobId` fijo, que es
lo que hace que BullMQ deduplique entre instancias.

⚠️ **El recordatorio de pago no manda a todo el que no está al día**: manda a quien no está al día **y
tiene algo que perder** — un pack asignado y el usuario activo. Un alumno dado de baja hace seis meses
no debe recibir un recordatorio mensual para siempre.

---

## 6. Endpoints

| Método | Ruta | Rol |
|---|---|---|
| PUT | `/config/smtp` | `ADMIN_SALON` |
| GET | `/config/smtp` | `ADMIN_SALON` |
| GET | `/config/plantillas` | `ADMIN_SALON` |
| PUT | `/config/plantillas/:tipo` | `ADMIN_SALON` |
| POST | `/push/suscripcion` | `ALUMNO` |
| DELETE | `/push/suscripcion` | `ALUMNO` |

Todo lo de configuración pide **`ADMIN_SALON`** y no `ADMIN_OPERATIVO`: son credenciales y son los
textos que salen con el nombre del gimnasio.

### 6.1 La contraseña no vuelve nunca

`GET /config/smtp` devuelve host, puerto, usuario, origen, destino y **`tieneClave: boolean`**. No
devuelve la contraseña ni cifrada ni enmascarada: una máscara sigue confirmando su longitud.

El valor descifrado vive en memoria el tiempo de un envío. **No se loguea en ningún nivel**, ni en
debug — el manual de TurnoFit avisaba de esto explícitamente y es la clase de cosa que se cuela en un
`console.log` de depuración y se queda.

### 6.2 `PUT /config/smtp` valida antes de guardar

Como pide el checklist: abre la conexión y hace el `verify` de nodemailer; si falla, responde **400
con el motivo** y no guarda nada.

⚠️ Solo cuando `EMAIL_TIPO=smtp`. Con el adaptador en memoria no hay contra qué conectar, y el
adaptador declara que la verificación siempre pasa. Es una diferencia real de comportamiento entre
entornos y va documentada.

### 6.3 Las plantillas se escriben en HTML

Las renderiza Handlebars con `{{ }}`, que **escapa por defecto**. Un alumno llamado
`<script>alert(1)</script>` no se convierte en XSS contra el admin que previsualiza la plantilla.

`GET /config/plantillas` devuelve las cinco: las propias del gimnasio y, donde no haya, la del código
marcada con `esPorDefecto: true`.

---

## 7. El push en la PWA

Tres piezas en `apps/web`:

1. **El handler `push` en el service worker**, junto a la única regla de caché que ya tiene.
2. **Un botón en la pantalla de perfil** que pide permiso, se suscribe y manda la suscripción.
3. **Dos rutas del BFF** hacia `/push/suscripcion`, como las demás.

La clave pública VAPID llega por **`NEXT_PUBLIC_VAPID_PUBLIC_KEY`**. Esa **sí** lleva el prefijo
público, al contrario que `API_URL`: el navegador la necesita para suscribirse, y es pública por
diseño.

⚠️ **Una suscripción caduca.** Cuando `web-push` devuelve 404 o 410, la suscripción ya no existe en el
navegador: se borra la fila. Sin eso, la tabla se llena de endpoints muertos a los que se reintenta
cada día.

---

## 8. Pruebas

**Unitarias del cifrado**: cifrar y descifrar da la vuelta; el texto cifrado **no contiene** el claro;
descifrar con otra clave falla en vez de devolver basura; y el prefijo de versión está.

**Unitarias de `resolverMensaje`**, con tabla de casos: gana la del tenant, cae a la del código, los
datos se interpolan, y el HTML de un nombre con `<script>` sale escapado.

**Unitarias de los processors**: a quién se manda y a quién no. El de recordatorio, con un alumno al
día, uno pendiente y uno dado de baja.

**E2E**: configurar SMTP y que la contraseña **no aparezca** en la respuesta; reservar a mano y ver el
email en el adaptador de memoria; publicar un mes y ver que **no** salió ninguno; suscribirse a push
sin VAPID y recibir 503.

**Mutación en tres sitios:**

1. El filtro de `origen !== 'RUTINA'`: quitarlo tiene que romper el test de publicar el mes.
2. El escapado de Handlebars: pasar a `{{{ }}}` tiene que romper el test del `<script>`.
3. La comprobación de `JOBS_RECURRENTES`: quitarla tiene que romper el test de que los tests no
   registran crones.

---

## 9. Checklist de aceptación

Los cinco puntos del §5 del PDF que le tocan a esta mitad:

1. El admin configura su SMTP y **el sistema valida la conexión antes de guardar**.
2. Ninguna credencial aparece en texto plano en logs, respuestas ni base de datos.
3. El job de recordatorio corre diariamente y **solo** a los perfiles con pago pendiente real.
4. El job de vencimiento notifica con la anticipación configurada.
5. Confirmación y cancelación usan la plantilla del tenant o la del código.
6. Las notificaciones push llegan a un dispositivo suscripto vía PWA.

Y dos que añade esta fase:

7. Publicar un mes **no manda ningún email**.
8. Una suscripción push caducada se borra sola al primer 410.

---

## 10. Variables de entorno nuevas

| Variable | Obligatoria | Para qué |
|---|---|---|
| `APP_ENCRYPTION_KEY` | **Sí** | Cifrar la credencial SMTP (32 bytes en hex) |
| `EMAIL_TIPO` | Sí | `memoria` o `smtp` |
| `PUSH_TIPO` | Sí | `memoria` o `web-push` |
| `VAPID_PUBLIC_KEY` · `VAPID_PRIVATE_KEY` | No | Sin ellas, el push se desactiva (D4) |
| `VAPID_SUBJECT` | No | A quién reclama el navegador si algo va mal. Por defecto, un `mailto:` del propio sistema |
| `JOBS_RECURRENTES` | No | `1` registra los crones. Apagado por defecto |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | No | En `apps/web`, para suscribirse |

---

## 11. Fuera de alcance

- **`ultima_clase`**: el PDF la lista como plantilla y no le da disparador.
- **La rotación de la clave de cifrado**: esta fase implementa el formato que la hace posible, no el
  procedimiento.
- **SMS y WhatsApp**: no los pide ninguna fase.
- **`VacacionAlumno.devuelveClase`**, que sigue inerte. El schema decía "queda para cuando exista
  facturación o créditos (Fase 5)", y esta fase trae pagos pero **no créditos**: con el conteo
  derivado de la Fase 1, no generar la reserva ya equivale a no gastar la clase. Se reetiqueta a la
  Fase 6.
- **No repetir el aviso de vencimiento.** Sin un campo de "ya avisado", un pack que vence en siete
  días manda siete correos: el job es idempotente por día, pero se ejecuta todos los días de la
  ventana. Cumple el checklist del PDF tal como está escrito, y **Cesar lo quiere arreglado**, pero
  lo deja para una fase posterior a propósito: la solución es una columna de estado en `Perfil`, y
  añadir estado a mitad de fase es justo cómo se acumulan las columnas que nadie mantiene — que es lo
  que la 5A vino a quitar con `pagoAlDia`. Cuando se haga, conviene pensarlo junto al resto de
  "última vez que avisamos de X", no como un parche suelto.
- **Estadísticas y reportes agregados**: Fase 6, como dice el propio PDF.
