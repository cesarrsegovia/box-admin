# Fase 3A — Self-service del alumno (backend)

**Fecha:** 2026-09-17
**Estado:** aprobado
**Fuente:** `docs/BoxAdmin_Fase3_SelfServiceAlumno.pdf`
**Base:** Fase 2 completa — ver `docs/superpowers/specs/2026-09-16-fase2-motor-recurrencia.md`

---

## 1. Objetivo y alcance

El PDF de la Fase 3 cubre dos disciplinas distintas: la API que permite a un alumno operar solo, y
una PWA en Next.js que hoy no existe en el monorepo. **Se parte en dos fases.**

Esta, la **3A**, construye el backend completo: invitaciones y auto-registro, disponibilidad
unificada, reservas y cancelaciones propias, lista de espera con asignación automática, y
comprobantes de pago con almacenamiento externo.

La **3B** construirá `apps/web` contra un contrato ya implementado y cubierto por e2e. Ese orden no
es cosmético: un frontend que se escribe a la vez que su API termina corrigiendo el contrato desde
la pantalla, que es la forma más cara de descubrir que un endpoint estaba mal pensado.

**Criterio de éxito de la 3A:** un alumno de prueba completa el ciclo entero contra la API sin que
un admin intervenga en el momento — se auto-registra con una clave, ve sus clases, reserva una
suelta, cancela otra, se anota en lista de espera, y sube un comprobante que el admin aprueba.

---

## 2. Decisiones cerradas

Ocho decisiones que el PDF deja abiertas, contradictorias o directamente rotas. Las ocho fueron
consultadas y aprobadas antes de escribir este documento.

### D1 — El alumno solo ve turnos de meses `HABILITADO`

La Fase 2 dejó escrito, con un comentario explícito en el modelo, que `MesCalendario.estado` no
habilitaba nada todavía y era "el enganche para la Fase 3". Esta es la fase donde se conecta.

Un turno solo aparece en el descubrimiento del alumno si su mes está publicado. El admin genera el
mes, lo revisa, resuelve sus conflictos y recién entonces lo abre.

**Matiz que importa:** el gate aplica a **descubrir** turnos, no a ver los propios. `GET
/mi-calendario` devuelve siempre las reservas del alumno. Si el admin despublicara un mes, las
clases ya reservadas no desaparecerían de la pantalla del alumno — hacer desaparecer una clase que
alguien tiene reservada es peor que mostrarla.

### D2 — Al liberarse un cupo, el primero de la cola entra automáticamente

El PDF ofrecía elegir entre asignar y notificar, "según configuración del tenant". Se asigna, sin
flag.

El motivo es que la rama "notificar" no notifica a nadie: el módulo de notificaciones llega en la
Fase 5. Implementarla hoy significaría pagar dos caminos, poder probar de verdad solo uno, y dejar
el punto del checklist ("cancelar un cupo con lista de espera dispara la asignación o notificación")
cumplido nada más que porque una columna booleana cambió de valor.

El hook de notificación **sí** queda preparado: una llamada inerte en el punto exacto donde la Fase
5 la va a necesitar.

### D3 — Almacenamiento como puerto con dos adaptadores

El bucket S3-compatible (Backblaze B2 o DigitalOcean Spaces) todavía no está contratado, y los tests
no pueden depender de credenciales que no existen.

Se define una interfaz `AlmacenDeArchivos` con dos implementaciones: S3 presignado para producción y
disco local para desarrollo y tests. El adaptador local **no es un mock**: expone rutas HTTP firmadas
y los e2e suben y descargan de verdad. El flujo de dos pasos —pedir URL, subir a esa URL— es justo
donde una integración de este tipo falla, y un mock lo dejaría sin ejercitar hasta la primera subida
real en producción.

### D4 — La configuración heredable vive en campos directos de `Tenant`

El PDF admite explícitamente esta opción ("para esta fase alcanza con campos directos en Tenant") y
es la que se toma. Son dos enteros y un booleano; una tabla 1-1 agregaría un join y un caso de "la
fila no existe" a cada consulta, y un `Json` perdería el tipado de Prisma — el mismo argumento por
el que en la Fase 1 `cancelacionTipo` dejó de ser un string libre.

### D5 — La clave de invitación lleva las salas y el pack

**Esto tapa un agujero del PDF.** Las reservas se validan contra `UsuarioSala`. Un alumno
auto-registrado según el PDF no tiene ninguna fila ahí: no vería ningún turno ni podría reservar
nada. El criterio de éxito del propio PDF —"sin que el admin intervenga manualmente"— sería
imposible de cumplir.

La `ClaveInvitacion` se crea con un conjunto de salas y un pack por defecto. El admin prepara una
clave "alumnos de Pilates" una vez y reparte el código; su intervención ocurre antes del alta, no
después. El alumno queda operativo en el mismo momento en que se registra.

`autoRegistrado: true` sigue marcando el alta para revisión posterior, pero es una bandeja de
auditoría, no un bloqueo.

### D6 — La rutina inicial no entra en esta fase

El criterio de éxito del PDF menciona "elegir rutina inicial", pero no hay ningún endpoint para eso
en su propia lista de endpoints ni ningún punto en su checklist de aceptación.

El alumno de la 3A reserva y cancela clases sueltas. Las rutinas fijas las carga el admin con el
`POST /rutinas` que ya existe desde la Fase 2. Dejar que un alumno se auto-asigne un lugar
recurrente todos los martes del año, sin que nadie lo apruebe, es una decisión de negocio que el PDF
no tomó y que esta fase no va a tomar por su cuenta.

### D7 — `Sala.exclusiva` sigue inerte

El campo existe en el schema desde la Fase 1 y **nunca se definió qué hace**: se buscó en los tres
PDFs, en los dos specs anteriores y en todo el código. Se declara y no se explica.

Mejor un campo almacenado sin efecto —como estuvo en las Fases 1 y 2— que una semántica inventada
aquí que después no coincida con lo que el negocio esperaba.

`soloCuposLiberados` estaba en la misma situación y **sí** se resuelve en esta fase: es exactamente
el estado `SOLO_ADMIN` del servicio de disponibilidad.

### D8 — Throttling por IP en las rutas públicas

`POST /auth/auto-registro` es público y acepta un código. Sin freno, adivinarlo por fuerza bruta es
viable aunque el código sea largo, y el intento no deja rastro.

Se agrega `@nestjs/throttler` con un límite permisivo global y uno estricto en las rutas públicas de
auth. De paso cubre `POST /auth/login`, que hoy no tiene ningún freno.

---

## 3. Modelo de datos

### 3.1 Correcciones al esquema del PDF

El PDF trae tres modelos que violan convenciones que el schema sostiene desde la Fase 1. Se
corrigen, y el motivo de cada corrección queda en un comentario en el propio `schema.prisma`.

| Qué trae el PDF | Qué se hace | Por qué |
|---|---|---|
| `ClaveInvitacion.codigo String @unique` (global) | `@@unique([tenantId, codigo])` | Un espacio de nombres global deja que un gimnasio descubra por sondeo si un código existe en otro. Es justo lo que todo el aislamiento del schema evita. El registro pide `tenantSlug` igual que el login, así que el tenant ya se conoce. |
| FK simples (`references: [id]`) en los tres modelos | FK **compuestas** por tenant | Es el patrón de todo el schema desde la Fase 1: Postgres rechaza físicamente que una fila de un gimnasio apunte a otra de otro, aunque un service se olvide de validarlo. |
| `Comprobante.urlArchivo String` | `claveArchivo String` | Guardar una URL es un error: una URL firmada caduca, y una permanente obligaría a que el bucket fuera público. Se guarda la clave dentro del almacén y se firma al leer. |
| `Comprobante.estado String @default("pendiente")` | `enum EstadoComprobante` | Un typo en un string libre es un bug silencioso; el enum lo convierte en un error de compilación. Mismo criterio que `TipoCancelacion` en la Fase 1. |
| `ListaEspera.posicion Int` | **se elimina**, la posición se deriva | Un entero guardado hay que renumerarlo en cada baja y es una carrera en cada alta. Se ordena por `createdAt, id`, igual que la Fase 1 derivó el conteo de clases en vez de guardar un contador. Elimina una familia entera de bugs. |
| `ListaEspera @@unique([turnoId, perfilId])` | `@@unique([tenantId, turnoId, perfilId])` | Coherencia con el resto del schema. |

### 3.2 Campos nuevos en modelos existentes

**`Tenant`** — la configuración heredable (D4):

```prisma
minMinutosCancelar    Int?
minMinutosAnotarse    Int?
listaEsperaHabilitada Boolean?
```

La resolución es en cascada: `Sala ?? Tenant ?? valor del sistema`. Los valores del sistema son `0`
minutos (sin ventana) y lista de espera **apagada**.

**No se agrega `Tenant.cupoBase`**, aunque `Sala` lo tenga y la simetría lo pida. El planificador de
la Fase 2 reporta `SALA_SIN_CUPO_BASE` como conflicto cuando la sala no lo define; un fallback en el
tenant cambiaría ese detector en silencio, y esta fase no tiene motivo para tocarlo.

**`Perfil`** — `autoRegistrado Boolean @default(false)`.

**`Comprobante`** — `subidoEn DateTime?`, que no está en el PDF. Distingue las filas que llegaron a
tener archivo de las que el alumno abandonó a mitad del flujo de dos pasos. El listado del admin
filtra por defecto las que tienen archivo, para que no vea enlaces rotos.

### 3.3 Modelos nuevos

Las relaciones se escriben completas, con FK compuestas por tenant, en la tarea del plan que toque
el schema. Aquí se muestran los campos y las restricciones.

```prisma
model ClaveInvitacion {
  id       String @id @default(cuid())
  tenantId String

  codigo String  // 32 caracteres aleatorios, generados por el servidor
  nombre String  // "Alumnos de Pilates", para que el admin la reconozca
  activa Boolean @default(true)

  usosMax      Int?      // null = ilimitado
  usosActuales Int       @default(0)
  expiraEn     DateTime?

  // El pack que recibe el alumno al registrarse. FK compuesta y opcional.
  packId String?

  @@unique([tenantId, codigo])
  @@unique([tenantId, id]) // destino de la FK compuesta de ClaveInvitacionSala
  @@index([tenantId])
  @@map("claves_invitacion")
}

model ClaveInvitacionSala {
  // Salas que la clave otorga. Mismo patron que UsuarioSala: tenantId propio y
  // FK compuestas, para que la fila quede atada a su gimnasio por si misma.
  tenantId String
  claveId  String
  salaId   String

  @@id([claveId, salaId])
  @@index([tenantId])
  @@map("claves_invitacion_salas")
}

model ListaEspera {
  id       String @id @default(cuid())
  tenantId String
  turnoId  String
  perfilId String

  // Sin `posicion`: se deriva del orden por (createdAt, id). Ver 3.1.
  notificado Boolean  @default(false)
  createdAt  DateTime @default(now())

  @@unique([tenantId, turnoId, perfilId])
  @@index([tenantId, turnoId])
  @@map("listas_espera")
}

model Comprobante {
  id       String @id @default(cuid())
  tenantId String
  perfilId String

  claveArchivo   String // clave dentro del almacen, NO una URL
  nombreOriginal String
  tipoMime       String
  subidoEn       DateTime?

  estado      EstadoComprobante @default(PENDIENTE)
  revisadoPor String?
  revisadoEn  DateTime?
  nota        String?

  createdAt DateTime @default(now())

  @@index([tenantId, perfilId])
  @@index([tenantId, estado])
  @@map("comprobantes")
}

enum EstadoComprobante {
  PENDIENTE
  APROBADO
  RECHAZADO
}
```

---

## 4. `DisponibilidadService`

Es el corazón de la fase y la pieza que se prueba de forma exhaustiva, como el planificador de la
Fase 2.

### 4.1 El problema que resuelve

Hoy en TurnoFit conviven dos mecanismos que el usuario percibe como features separadas y confusas:
"lista de espera" y "solo cupos liberados". Ambos se mantienen —cambiarlos rompería expectativas—
pero se exponen al frontend como **un solo concepto**.

### 4.2 El contrato

Para un turno y un perfil dados, un estado consolidado.

El contrato tiene **dos ejes separados a propósito**. `estado` describe el **turno** y no depende de
quién pregunte: un turno con cupo está `LIBRE` aunque el alumno que mira no pueda tomarlo.
`puedeReservar` y `motivo` describen a **ese alumno ahora**. Mezclarlos —hacer que el estado cambiara
según quién consulta— haría el contrato inservible para el frontend, que necesita pintar el turno y
el botón por separado.

| Estado | Cuándo |
|---|---|
| `LIBRE` | hay cupo |
| `SOLO_ADMIN` | hay cupo pero la sala es `soloCuposLiberados` y nadie canceló todavía |
| `LISTA_ESPERA` | sin cupo, con lista de espera habilitada |
| `LLENO` | sin cupo y sin lista de espera |

Acompañado de un `motivo` que explica el porqué cuando el estado no es `LIBRE`: `VENTANA_CERRADA`,
`SOLO_CUPOS_LIBERADOS`, `YA_RESERVADO`, `SIN_ACCESO_A_SALA`, `SALA_NO_VISIBLE`, `MES_NO_PUBLICADO`.

`SALA_NO_VISIBLE` cubre la regla de la Fase 1 por la que un `ALUMNO` solo ve salas con
`activa && visibleAlumnos`. Es distinta de `SIN_ACCESO_A_SALA`, que es la ausencia de fila en
`UsuarioSala`: una sala puede estar asignada al alumno y aun así estar oculta o dada de baja.

Los cuatro estados son el concepto único que pide el PDF; el `motivo` es lo que evita que la
pantalla tenga que adivinar por qué el botón está apagado. Es la misma forma que tienen los
`Conflicto` de la Fase 2.

### 4.3 Cómo se decide un "cupo liberado"

`soloCuposLiberados` significa que el alumno solo puede tomar lugares que alguien más soltó, no
lugares originales. Eso es **derivable**: hay al menos una reserva cancelada en ese turno. No hace
falta ninguna columna nueva ni ningún contador.

### 4.4 El pack advierte, no bloquea

Se mantiene la decisión D3 de la Fase 1. Un alumno que se pasa de su pack reserva igual y recibe la
advertencia `PACK_AGOTADO`. Lo mismo con `Pack.cancelacionesPermitidas`.

Cambiarlo aquí sería introducir una regla de negocio nueva por la puerta de atrás, en la fase que
menos lo espera.

---

## 5. Endpoints

### 5.1 Invitaciones

| Método | Ruta | Rol mínimo |
|---|---|---|
| POST | `/invitaciones` | `ADMIN_OPERATIVO` |
| GET | `/invitaciones` | `ADMIN_OPERATIVO` |
| PATCH | `/invitaciones/:id` | `ADMIN_OPERATIVO` |

`ADMIN_OPERATIVO` porque es el mismo rol que ya da de alta alumnos y les asigna salas en la Fase 1.
El código lo genera el servidor; el cliente nunca lo propone.

### 5.2 Auto-registro

| Método | Ruta | Acceso |
|---|---|---|
| POST | `/auth/auto-registro` | público, con throttle estricto |
| GET | `/usuarios?autoRegistrado=true` | `ADMIN_OPERATIVO` |

El filtro `autoRegistrado` se agrega al listado de usuarios que ya existe desde la Fase 1. Ojo: el
flag vive en `Perfil`, no en `Usuario`, así que el filtro se aplica **a través de la relación**
(`where: { perfil: { autoRegistrado: true } }`). Un usuario sin perfil nunca aparece con el filtro
activo, que es lo correcto: no hay alta de alumno que revisar.

El cuerpo trae `tenantSlug`, `codigo`, `nombreCompleto`, `email` y `password`. Devuelve el mismo par
de tokens que el login: el alumno queda logueado.

Todo ocurre en una transacción **Serializable**. `usosMax` es un cupo y tiene exactamente la misma
carrera que el cupo de un turno: sin aislamiento, dos registros simultáneos con una clave de un solo
uso leen ambos `usosActuales = 0` y ambos pasan. Reutiliza `conReintentoSerializable` de la Fase 1.

Dentro de la transacción: valida la clave (activa, no expirada, con usos disponibles), crea el
`Usuario` con rol `ALUMNO`, el `Perfil` con `autoRegistrado: true` y el pack de la clave, las filas
de `UsuarioSala`, e incrementa `usosActuales`.

Corre dentro de `runWithTenant(tenant.id, ...)`, porque no hay JWT del que sacar el contexto —
exactamente como hace `register` desde la Fase 0.

Un email ya dado de alta en ese gimnasio devuelve 409.

### 5.3 Self-service de calendario

| Método | Ruta | Rol mínimo |
|---|---|---|
| GET | `/mi-calendario?desde=&hasta=` | `ALUMNO` |
| GET | `/turnos-disponibles?salaId=&desde=&hasta=` | `ALUMNO` |
| POST | `/turnos/:id/mi-reserva` | `ALUMNO` |
| DELETE | `/mis-reservas/:id` | `ALUMNO` |
| POST | `/turnos/:id/lista-espera` | `ALUMNO` |
| DELETE | `/lista-espera/:id` | `ALUMNO` |

Todos operan sobre el perfil del actor, nunca sobre un `perfilId` del cuerpo. Un usuario sin perfil
—un admin, por ejemplo— recibe 404 en estas rutas, y eso es correcto: no tiene calendario propio.

`POST /turnos/:id/mi-reserva` crea la reserva con `origen: 'ALUMNO'` en una transacción Serializable,
con las mismas garantías de cupo que la reserva del admin de la Fase 1, y devuelve las advertencias
de pack.

**Cancelación fuera de ventana: se bloquea con 409.** El PDF dice "respetando las ventanas mínimas
configuradas" y se lee como bloqueo. La alternativa considerada era permitirla contándola como
`DEFINITIVA` —"cancelaste tarde, perdés la clase"—; se descartó por fidelidad al PDF. El admin
conserva la capacidad de cancelarla desde el endpoint de la Fase 1.

Cancelar dentro de ventana produce una cancelación `RECUPERABLE` e incrementa
`Perfil.cancelacionesUsadas`. Esa rama ya está escrita y probada desde la Fase 1, con un comentario
que decía que quedaba lista para la Fase 3; aquí se ejercita por primera vez de verdad.

### 5.4 Comprobantes

| Método | Ruta | Rol mínimo |
|---|---|---|
| POST | `/comprobantes` | `ALUMNO` |
| PATCH | `/comprobantes/:id/confirmar` | `ALUMNO` |
| GET | `/comprobantes?estado=` | `ALUMNO` (ve los suyos) / `ADMIN_OPERATIVO` (ve todos) |
| PATCH | `/comprobantes/:id/aprobar` | `ADMIN_OPERATIVO` |
| PATCH | `/comprobantes/:id/rechazar` | `ADMIN_OPERATIVO` |

El flujo es de tres pasos, que es el patrón estándar de subida presignada:

1. `POST /comprobantes` crea la fila en `PENDIENTE`, con `subidoEn: null`, y devuelve la URL firmada.
2. El cliente hace `PUT` del archivo directamente a esa URL — no pasa por la API.
3. `PATCH /comprobantes/:id/confirmar` marca `subidoEn`.

El tercer paso existe porque **ni S3 ni el adaptador local pueden avisar a la API** de que la subida
terminó. Sin él, la única forma de saber si un comprobante tiene archivo sería consultar el almacén
en cada listado.

Una fila que nunca se confirma queda con `subidoEn: null` y no aparece en el listado del admin, que
es justo lo que evita que vea enlaces rotos.

`GET` devuelve cada comprobante con una URL de descarga firmada de vida corta (5 minutos).

**Aprobar un comprobante pone `Perfil.pagoAlDia = true`.** Ese campo existe desde la Fase 1 sin que
nada lo escriba; esta es la fase donde encuentra su dueño. Rechazar acepta una nota y no lo toca.

---

## 6. Almacenamiento de archivos

```ts
interface AlmacenDeArchivos {
  urlDeSubida(clave: string, tipoMime: string): Promise<string>;
  urlDeDescarga(clave: string): Promise<string>;
  eliminar(clave: string): Promise<void>;
}
```

Dos adaptadores, elegidos por variable de entorno:

- **S3** — `@aws-sdk/client-s3` con `@aws-sdk/s3-request-presigner`. Sirve para Backblaze B2 y
  DigitalOcean Spaces sin cambios, porque ambos hablan el protocolo de S3.
- **Local** — guarda en disco y expone un par de rutas HTTP firmadas con HMAC y vida corta.

El adaptador local es lo que permite que los e2e ejerciten el flujo real de dos pasos sin
credenciales ni red. Ver D3.

---

## 7. Lista de espera

Anotarse solo es posible cuando `DisponibilidadService` devuelve `LISTA_ESPERA`. La posición se
deriva del orden por `(createdAt, id)` — determinista, sin contador guardado.

Al cancelarse una reserva, **dentro de la misma transacción**: se busca el primero de la cola, se le
crea la reserva con `origen: 'LISTA_ESPERA'`, se borra su fila de la lista, y se llama al hook de
notificación inerte.

La asignación **no re-valida** el pack ni la ventana del beneficiario. El lugar es suyo por posición
en la cola; las validaciones son del momento de anotarse. Si la reserva lo pasa de su pack, queda la
advertencia en el historial, igual que en cualquier otra reserva.

### 7.1 Impacto sobre la Fase 1

`ReservasService.cancelar` hoy **no** corre en Serializable, porque cancelar no competía por ningún
cupo. Al asignar el cupo liberado, pasa a competir.

Hay que subirlo a Serializable con reintento, como `crear` y `reasignar`. Es un cambio sobre un
método de la Fase 1 con tests existentes, y se trata como tal: los tests actuales tienen que seguir
pasando sin modificarse.

---

## 8. Auditoría

Toda escritura pasa por `HistorialService`, dentro de la transacción, como en las fases anteriores.
Entidades nuevas: `ClaveInvitacion`, `Comprobante`, `ListaEspera`. Las reservas creadas por
asignación automática se registran con su origen, para que un alumno pueda entender después por qué
apareció una clase que no reservó.

---

## 9. Pruebas

**Unitarias.** La tabla de decisión completa de `DisponibilidadService`, cubriendo cada combinación
de cupo, ventana, `soloCuposLiberados`, lista de espera, acceso a sala y mes publicado. Es la pieza
donde un caso olvidado se traduce en un alumno que no puede reservar sin saber por qué.

**e2e.** Los cinco del checklist del PDF, más tres que la fase hace necesarios:

1. Auto-registro completo con clave válida, y rechazo de clave inactiva, expirada o agotada.
2. Reserva propia respetando la ventana de anotación.
3. Cancelación propia dentro y fuera de ventana.
4. Anotación en lista de espera sobre un turno lleno.
5. Cancelación con lista de espera: el primero de la cola entra automáticamente.
6. Subida real de comprobante contra el almacén local, y aprobación que deja `pagoAlDia` en `true`.
7. Aislamiento: un alumno de un gimnasio no ve ni toca nada del otro.
8. **Concurrencia sobre `usosMax`**: diez auto-registros simultáneos con una clave de un solo uso
   deben producir exactamente un 201 y nueve rechazos.

---

## 10. Checklist de aceptación

Del PDF, restringido a lo que es backend:

1. Un alumno se auto-registra con una clave válida y queda con su pack y sus salas.
2. El alta queda marcada `autoRegistrado: true` y aparece en el listado de pendientes del admin.
3. Un alumno logueado ve su calendario y reserva o cancela una clase suelta respetando las ventanas.
4. Reservar un turno lleno ofrece lista de espera en vez de un error genérico.
5. Cancelar un cupo con lista de espera asigna al primero de la cola.
6. Un alumno sube un comprobante y lo ve en `PENDIENTE`; el admin lo aprueba o lo rechaza.
7. Los turnos de un mes no publicado no aparecen en el descubrimiento del alumno.
8. Las rutas públicas de auth tienen límite de peticiones.

---

## 11. Fuera de alcance

- **El frontend entero.** Va en la Fase 3B: `apps/web`, Next.js, PWA, manifest, service worker,
  offline de "mi calendario", React Query, las cinco pantallas.
- **Notificaciones reales** (push o email). Solo queda el hook, inerte. Llegan en la Fase 5.
- **`Sala.exclusiva`**, que sigue almacenado sin efecto. Ver D7.
- **`Tenant.cupoBase`**, deliberadamente no agregado. Ver 3.2.
- **Rutina inicial elegida por el alumno.** Ver D6.
- **Profesor vinculado al turno** (Fase 4), **pasarela de pagos** (Fase 5), **estadísticas**
  (Fase 6).
