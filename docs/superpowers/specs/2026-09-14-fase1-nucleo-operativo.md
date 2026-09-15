# Fase 1 — Núcleo operativo

**Fecha:** 2026-09-14
**Estado:** aprobado
**Fuente:** `docs/BoxAdmin_Fase1_NucleoOperativo.pdf`
**Base:** Fase 0 completa (auth, multi-tenancy, infraestructura) — ver `docs/superpowers/specs/2026-09-11-fase0-fundamentos.md`

---

## 1. Objetivo

Un admin configura su salón desde cero vía API — **sala → pack → alumno/profesor → turno → reserva
manual** — con las reglas de negocio base (cupo del turno, salas con acceso) validadas en el backend,
no solo en la base de datos.

Esta fase introduce las primeras entidades reales del dominio. Todo lo hace el admin a mano: no hay
automatismos, ni self-service, ni recurrencia. Eso llega en fases posteriores y está bien que así sea.

**Criterio de éxito:** dar de alta una sala, un pack, un alumno con ese pack, un profesor, un turno, y
asignarle una reserva manual respetando el cupo — todo por API, todo auditado.

---

## 2. Decisiones cerradas

Cuatro decisiones que el PDF deja abiertas y que cambian el trabajo. Las cuatro fueron consultadas y
aprobadas antes de escribir este documento.

### D1 — Contraseña en el alta de usuarios: temporal generada por el API

El alta de alumno o profesor crea un `Usuario` (identidad + auth, de Fase 0) además de su `Perfil`. El
API genera una contraseña aleatoria criptográficamente segura, la guarda hasheada con argon2id y la
devuelve **una sola vez** en el campo `passwordTemporal` de la respuesta del alta. Nunca se vuelve a
poder leer.

`POST /usuarios/:id/reset-password` funciona igual: genera una nueva y la devuelve una vez.

**Por qué:** el admin no tiene que inventar ni transmitir claves por un canal aparte, los DTOs de alta
no cargan un campo de contraseña, y encaja con la Fase 3 (self-service), donde el alumno cambiará la
suya al primer login.

**Descartado:** contraseña en el DTO (obliga al admin a inventarla); sin contraseña hasta Fase 3
(dejaría `/reset-password` a medias y habría que volver aquí).

### D2 — Clases consumidas: derivadas de las reservas, sin contador almacenado

No existe ningún campo `clasesUsadas`. El número se calcula:

```
clasesConsumidas = count(reservas del perfil
                         dentro de la ventana del pack
                         donde cancelacionTipo IS DISTINCT FROM 'RECUPERABLE')
```

Una cancelación **recuperable** deja de contar — ahí es literalmente donde "la clase vuelve al perfil".
Una **definitiva** sigue contando.

**Por qué:** un contador incrementado y decrementado a mano es exactamente el tipo de dato que se
desincroniza para siempre ante el primer bug o borrado manual, y es la deriva que ya se vio en
TurnoFit. El coste es un `COUNT` por consulta, que con el índice `[tenantId, perfilId]` es
despreciable a esta escala.

**Descartado:** contador en `Perfil` (lectura barata, verdad frágil); solo marcar sin contar (dejaría
el punto del checklist sin verificar de verdad).

### D3 — Pack agotado: se avisa, no se bloquea

La única regla dura de reserva en esta fase es el **cupo del turno** (409). Si el alumno ya consumió
todas las clases de su pack, la reserva se crea igual y la respuesta incluye una advertencia
`PACK_AGOTADO`.

**Por qué:** el §5 del PDF lista las reglas a validar y el pack no está entre ellas. El admin manda —
puede querer meter una clase extra, una de prueba, o una cortesía. Bloquear aquí pelearía con la
operativa real del salón.

### D4 — Concurrencia de cupo: transacción Serializable con reintento

`$transaction` con `isolationLevel: 'Serializable'`. Si Postgres aborta por conflicto de serialización
(Prisma `P2034`), se reintenta hasta **3 veces** con backoff corto; agotados los reintentos, se
devuelve 409.

**Por qué:** es lo que pide el §5 del PDF y usa solo el Client API. El `SELECT ... FOR UPDATE` que el
PDF sugiere literalmente exigiría SQL crudo, que la extensión de aislamiento de Fase 0 **bloquea a
propósito** dentro de contexto de tenant (`RawQueryEnTenantError`); habilitarlo obligaría a abrir una
excepción en el núcleo de seguridad del sistema, que es un precio desproporcionado.

**Corregido durante la verificación (importante).** La detección del conflicto miraba solo
`error.code` contra `P2034` / `40001` / `40P01`. Con el driver adapter `pg` de Prisma 7 eso **nunca
coincide**: el adapter traduce los SQLSTATE `40001` y `40P01` a `{ kind: 'TransactionWriteConflict' }`
y lo envuelve en un `DriverAdapterError`, que no tiene `code`. El reintento era **código muerto: no se
disparó ni una sola vez**.

No hubo sobrecupo en ningún momento —de eso se encarga el aislamiento `Serializable` por sí mismo—
pero una petición de cada ~20, bajo 10 simultáneas, recibía un **500 opaco** en vez de un 409. Se
detectó porque el e2e de concurrencia fallaba de forma intermitente: 1 creada, 8 rechazadas y una que
no era ni lo uno ni lo otro.

Además, agotar los reintentos ahora lanza `ConflictException` (409) en vez de propagar el error crudo,
que `AllExceptionsFilter` tampoco traduce, y los intentos por defecto pasan de 3 a 5.

Verificado tras el arreglo: 15 rondas de 10 peticiones simultáneas y 8 rondas de 20, todas con
exactamente una `201` y el resto `409`, sin un solo error en el log.

**Descartado:** contador materializado `Turno.reservasActivas` con `UPDATE ... WHERE reservasActivas <
cupo` (atómico y sin reintentos, pero reintroduce por la puerta de atrás el contador desincronizable
que D2 acaba de eliminar).

---

## 3. Riesgo técnico a despejar primero

**La extensión de aislamiento puede estar bloqueando las transacciones.**

`tenant-scoped.extension.ts` tiene un hook `$allOperations` de primer nivel cuya función es matar toda
operación con `model === undefined` dentro de contexto de tenant — así se cierra la puerta al SQL
crudo, que no se puede filtrar por tenant. Está verificado empíricamente contra Prisma 7.10.0 para
`$queryRaw`, `$queryRawUnsafe`, `$executeRaw` y `$executeRawUnsafe`.

**No está verificado para `$transaction` interactivo.** Si `$transaction` también atraviesa ese hook
con `model === undefined`, toda transacción dentro de una request autenticada lanzará
`RawQueryEnTenantError` y la fase entera es inviable tal como está diseñada.

La **primera tarea del plan** es un spike contra la base real que responda dos preguntas:

1. ¿Pasa `$transaction` por el `$allOperations` de primer nivel?
2. ¿Sobrevive el `AsyncLocalStorage` del tenant dentro del callback de la transacción, de modo que las
   queries internas se sigan filtrando?

Si (1) resulta afirmativo, `bloquearRawEnTenant` necesita una excepción explícita y documentada para
`$transaction` antes de escribir una línea de `reservas`. Si (2) resulta negativo, el contexto debe
re-abrirse dentro del callback.

Ninguna otra tarea de la fase puede empezar antes de cerrar este punto.

---

## 4. Modelo de datos

### 4.1 Correcciones al esquema del PDF

El schema del §2 del documento no compila ni funciona tal cual. Seis cambios, todos deliberados:

| # | Problema en el PDF | Corrección |
|---|---|---|
| C1 | `Perfil` declara `tenantId String` pero no el campo de relación `tenant` — los otros cinco modelos sí lo tienen | Añadir `tenant Tenant @relation(...)`, más las back-relations ausentes en `Tenant` (`perfiles`, `salas`, `packs`, `turnos`, `reservas`) y en `Usuario` (`perfil Perfil?`). Sin ellas el schema no valida |
| C2 | **`UsuarioSala` no tiene `tenantId`** | Añadírselo y clasificarlo en `MODELOS_CON_TENANT`. Sin columna propia, la extensión de Fase 0 lanza `CreacionNoPermitidaError` en cada alta y la tabla solo sería escribible por nested writes desde `Perfil`. Además es defensa en profundidad: la fila queda atada a su gimnasio aunque alguien la toque por otra vía |
| C3 | `cancelacionTipo String?` con valores mágicos `"recuperable"` / `"definitiva"` | `enum TipoCancelacion { RECUPERABLE, DEFINITIVA }`. Mismo criterio que `RolUsuario` y `TipoPack`: un typo en un string libre es un bug silencioso |
| C4 | `precio Decimal? @db.Decimal(10,2)` se serializa como objeto `Decimal.js` en JSON | Los DTOs de respuesta lo devuelven como **string** (`"12500.00"`). Nunca como `number`: los float binarios pierden centavos, y el precio es dinero |
| C5 | `fecha DateTime @db.Date` arrastra huso horario al serializar a ISO | En las respuestas viaja como `"YYYY-MM-DD"` puro. `horaInicio` / `horaFin` se validan contra `^([01]\d\|2[0-3]):[0-5]\d$` y se exige `horaFin > horaInicio` |
| C6 | `pnpm add nanoid` | **No se instala.** Ninguna entidad del modelo usa códigos cortos; todos los IDs son `cuid()`. YAGNI — se añadirá cuando exista el primer uso real |

### 4.2 Modelos nuevos

Seis modelos y tres enums nuevos, sobre los cuatro de Fase 0 (`Tenant`, `Usuario`, `RefreshToken`,
`HistorialAccion`).

**`Sala`** — un espacio físico con sus propias reglas. Los campos anulables (`cupoBase`,
`minMinutosCancelar`, `minMinutosAnotarse`, `listaEsperaHabilitada`) significan "hereda de la
configuración general del tenant"; la configuración del tenant no existe todavía, así que en esta fase
`null` simplemente queda sin efecto y se documenta como deuda de Fase 2.

**`Perfil`** — datos de negocio del alumno o profesor, separados de la tabla de auth. Relación 1:1 con
`Usuario` (`usuarioId @unique`, `onDelete: Cascade`). Los campos de alumno (`packId`, `clasesExtra`,
`cancelacionesUsadas`, `pagoAlDia`, `vigenciaDesde`, `vigenciaHasta`) son anulables o tienen default:
un perfil de profesor simplemente no los usa. **Esta separación es la que resuelve el problema de
TurnoFit**: el alta de un profesor no arrastra campos de alumno porque el DTO ni los acepta.

**`UsuarioSala`** — salas con acceso, N:M entre `Perfil` y `Sala`. PK compuesta `[perfilId, salaId]`,
más `tenantId` (C2) e índice por `salaId`.

**`Pack`** — catálogo de precios, sección propia y visible, no escondida dentro del alta de un alumno.
`salaId` nulo significa "vale para todas las salas". `precio` nulo significa "a consultar".

**`Turno`** — una clase puntual en una fecha concreta. En Fase 4 se le añadirá `profesorId`.

**`Reserva`** — la asignación de un perfil a un turno. Nunca se borra: se cancela, marcando
`canceladaEn` y `cancelacionTipo`.

```prisma
enum TipoPack       { MENSUAL TOTAL }
enum OrigenReserva  { ADMIN ALUMNO RUTINA PRUEBA LISTA_ESPERA EXTRA }
enum TipoCancelacion { RECUPERABLE DEFINITIVA }   // C3
```

El schema completo, con todas las correcciones aplicadas, se escribe en el plan de implementación.

### 4.3 Integridad

- **Doble reserva del mismo perfil en el mismo turno:** se rechaza con 409, comprobado con un
  `findFirst` dentro de la misma transacción Serializable que valida el cupo. No se usa índice único
  parcial: Prisma no los declara de forma nativa y el aislamiento Serializable ya cubre la carrera.
- **Reserva en una sala sin acceso:** se valida en el service contra `UsuarioSala`; devuelve 403.
- **Perfil de profesor con `packId`:** imposible por DTO — el de profesor no acepta el campo.
- **Relación que cruza de gimnasio:** imposible a nivel de base de datos. Ver 4.3.1.

#### 4.3.1 Claves foráneas calificadas por tenant

Añadido tras la revisión de la Task 1, y es la única desviación de este spec que no venía del PDF.

Todo el aislamiento de BoxAdmin se aplica **en código**, con una extensión de Prisma Client. Eso
garantiza el `tenantId` de la fila que se crea, pero no dice nada de los ids de relación que llegan en
el cuerpo de la petición. Sin más red, nada impide que una `Reserva` del gimnasio A apunte a un `Turno`
del gimnasio B, o que una fila de `UsuarioSala` cruce un perfil de A con una sala de B. Los servicios
resuelven cada id a través del cliente filtrado antes de usarlo, así que en la Fase 1 el hueco está
tapado — pero depende de que nadie se olvide nunca, en ninguna fase futura.

La corrección: `@@unique([tenantId, id])` en `Usuario`, `Sala`, `Perfil`, `Pack` y `Turno`, y claves
foráneas **compuestas** en las ocho relaciones internas:

```prisma
turno Turno @relation(fields: [tenantId, turnoId], references: [tenantId, id])
```

Postgres rechaza entonces el cruce por sí mismo, incluso saltándose la extensión. Verificado con Prisma
7.10.0, incluido el caso difícil de `Reserva` reutilizando el escalar `tenantId` en tres relaciones a
la vez.

**Por qué ahora:** no hay datos y la migración no está commiteada, así que cuesta una regeneración.
Hacerlo dentro de dos fases costaría migrar datos en producción. Y la Fase 0 dejó la lección: seis
agujeros de aislamiento demostrados en código que ya había pasado revisión con los tests en verde. Una
garantía estructural no depende de que nadie se despiste.

En relaciones opcionales (`Perfil.pack`, `Pack.sala`) la comprobación se omite cuando el id es `NULL`,
que es el comportamiento deseado.

### 4.4 Clasificación en la extensión de tenant

Los **seis** modelos nuevos van a `MODELOS_CON_TENANT`. Ninguno es global, ninguno se aísla por
relación. Sin esta clasificación, la extensión lanza `ModeloNoClasificadoError` y nada funciona — que
es exactamente el comportamiento fail-closed que se quiere.

---

## 5. Módulos

```
src/
  common/historial/           historial.service.ts   (+ spec)  ← escribe HistorialAccion
  salas/      module · controller · service · dto/
  usuarios/   module · controller · service · dto/{crear-alumno,crear-profesor,...}
  packs/      module · controller · service · dto/
  turnos/     module · controller · service · dto/
  reservas/   module · controller · service · dto/
```

Los contratos de respuesta (`SalaPublica`, `PerfilPublico`, `PackPublico`, `TurnoPublico`,
`ReservaPublica`, `Advertencia`, …) viven en `packages/shared`, junto a los de auth, para que el
frontend de fases posteriores los consuma sin duplicarlos.

`reservas` depende de `turnos` y de `usuarios`; `turnos` depende de `salas`; `packs` depende de
`salas`. Sin ciclos.

---

## 6. Endpoints

### 6.1 Salas

| Método | Ruta | Rol mínimo |
|---|---|---|
| POST | `/salas` | ADMIN_SALON |
| GET | `/salas` | autenticado |
| GET | `/salas/:id` | autenticado |
| PATCH | `/salas/:id` | ADMIN_SALON |
| DELETE | `/salas/:id` | ADMIN_SALON — baja lógica (`activa=false`); 409 si tiene turnos futuros |

A `ALUMNO` y `PROFESOR` los listados les devuelven solo salas con `activa && visibleAlumnos`.

### 6.2 Usuarios

| Método | Ruta | Rol mínimo | Notas |
|---|---|---|---|
| POST | `/usuarios/alumnos` | ADMIN_OPERATIVO | DTO propio: `nombreCompleto`, `email`, `telefono?`, `packId?`, `salaIds[]`, `pagoAlDia`, `vigenciaDesde?`, `vigenciaHasta?` |
| POST | `/usuarios/profesores` | ADMIN_OPERATIVO | DTO propio: `nombreCompleto`, `email`, `telefono?`, `salaIds[]`. **Sin pack, clases ni cancelaciones** |
| GET | `/usuarios?tipo=alumno\|profesor&salaId=&activo=` | ADMIN_OPERATIVO | Equivalente a "Administrar Usuarios" |
| GET | `/usuarios/:id` | ADMIN_OPERATIVO, o uno mismo | Detalle: perfil + salas + pack |
| PATCH | `/usuarios/:id` | ADMIN_OPERATIVO | Edición de perfil |
| PATCH | `/usuarios/:id/salas` | ADMIN_OPERATIVO | **400 si el array viene vacío** |
| POST | `/usuarios/:id/reset-password` | ADMIN_SALON | Devuelve `passwordTemporal` una vez |
| DELETE | `/usuarios/:id` | ADMIN_OPERATIVO | Baja lógica (`activo=false`) |

### 6.3 Packs

| Método | Ruta | Rol mínimo |
|---|---|---|
| POST | `/packs` | ADMIN_SALON |
| GET | `/packs?salaId=&activo=` | autenticado |
| PATCH | `/packs/:id` | ADMIN_SALON |
| DELETE | `/packs/:id` | ADMIN_SALON — baja lógica si tiene perfiles asociados |

### 6.4 Turnos

| Método | Ruta | Rol mínimo |
|---|---|---|
| POST | `/turnos` | ADMIN_OPERATIVO |
| GET | `/turnos?desde=&hasta=&salaId=&soloLibres=` | autenticado |
| PATCH | `/turnos/:id` | ADMIN_OPERATIVO — bajar el cupo por debajo de las reservas activas devuelve 409 |
| DELETE | `/turnos/:id` | ADMIN_OPERATIVO — borrado físico solo si no tiene reservas activas; 409 si las tiene |

### 6.5 Reservas

| Método | Ruta | Rol mínimo |
|---|---|---|
| POST | `/turnos/:turnoId/reservas` | ADMIN_OPERATIVO |
| DELETE | `/reservas/:id?tipo=recuperable\|definitiva` | ADMIN_OPERATIVO |
| PATCH | `/reservas/:id/reasignar` | ADMIN_OPERATIVO — body `{ turnoId }`; valida cupo del turno destino |

---

## 7. Reglas de negocio (service layer)

### 7.1 Crear reserva

```
$transaction(Serializable, reintento ×3 ante P2034) {
  turno   = findFirst({ id })                              → 404
  acceso  = perfil tiene turno.salaId en sus salas         → 403
  dup     = reserva activa (turnoId, perfilId)             → 409 RESERVA_DUPLICADA
  activas = count(reservas where canceladaEn: null)
  if (activas >= turno.cupo)                               → 409 CUPO_COMPLETO
  create(reserva)
  historial('Reserva', id, 'CREADA')
}
```

Si el pack está agotado (D3), la reserva se crea igual y la respuesta lleva `PACK_AGOTADO`.

### 7.2 Cancelar reserva

`RECUPERABLE` → la reserva deja de contar contra el pack. `DEFINITIVA` → sigue contando.

`Perfil.cancelacionesUsadas` **solo se incrementa cuando la cancelación la origina el alumno** dentro
de la ventana de reglas; las del admin no cuentan. En Fase 1 todas las cancelaciones son del admin, así
que el contador queda en 0 por diseño y el punto de extensión queda escrito y probado para la Fase 3.

### 7.3 Reasignar reserva

Mueve la reserva a otro turno validando el cupo y el acceso a sala del destino, dentro de la misma
transacción Serializable.

### 7.4 Ventana del pack

- `MENSUAL` → mes calendario de la fecha del turno, tope `pack.clasesPorMes`
- `TOTAL` → `vigenciaDesde .. vigenciaHasta` del perfil, tope `pack.clasesTotales`
- `Perfil.clasesExtra` se suma al tope.
- Sin pack, o con el tope en `null`, no hay límite y por tanto no hay advertencia.

### 7.5 Auditoría

`HistorialService` escribe en la tabla `historial_acciones`, creada en Fase 0 y hasta ahora sin uso.
Siempre **dentro** de la transacción que originó el cambio, con el `usuarioId` del ejecutor y un
`detalle` JSON mínimo.

Se audita: alta y baja de usuario, edición de salas con acceso, alta/baja de sala, pack y turno, y
creación, cancelación y reasignación de reserva.

---

## 8. Advertencias y errores

Las respuestas de alta y de reserva llevan `advertencias?: Advertencia[]`, donde
`Advertencia = { codigo, mensaje }`.

| Código | Cuándo | ¿Bloquea? |
|---|---|---|
| `SIN_SALAS` | Alta de alumno o profesor sin ninguna sala asignada | No — 201 con advertencia |
| `SIN_PACK` | Alta de alumno sin pack | No — 201 con advertencia |
| `PACK_AGOTADO` | Reserva por encima del tope del pack (D3) | No — 201 con advertencia |
| — | `PATCH /usuarios/:id/salas` con array vacío | **Sí — 400** |
| — | Turno lleno | **Sí — 409** |

La asimetría entre el alta (advierte) y `PATCH /salas` (rechaza) es deliberada: en el alta puede
faltar información legítimamente, pero una petición cuyo único propósito es fijar las salas y que
manda cero es siempre un error. Es el bug silencioso de "Sin sala" detectado en Wellness, cerrado por
las dos puntas — el PDF admitía como mínimo loguear una advertencia; aquí se hace ambas cosas.

---

## 9. Permisos

El PDF solo define los de `/salas`. El resto se deriva de la separación entre configurar el salón y
operarlo día a día:

- **Configuración** — `POST`/`PATCH`/`DELETE` de `/salas` y `/packs`, y `/usuarios/:id/reset-password`
  → **ADMIN_SALON**
- **Operación** — altas y edición de usuarios, `/turnos`, `/reservas` → **ADMIN_OPERATIVO**
- **Lectura de salas y packs** → cualquier autenticado, filtrando por `visibleAlumnos` para `ALUMNO` y
  `PROFESOR`
- **`GET /usuarios` y `GET /usuarios/:id`** → ADMIN_OPERATIVO, con la excepción de uno mismo
- **`Perfil.fichaMedica`** → nunca aparece en listados; en el detalle, solo para **ADMIN_SALON** o el
  propio usuario

Como `rolAlcanza` es jerárquico, ADMIN_SALON (40) cubre todo lo de ADMIN_OPERATIVO (30).

---

## 10. Pruebas

**Unitarias** — un spec por service con Prisma mockeado, sobre las reglas: cupo, ventana del pack,
filtro de `visibleAlumnos`, ocultación de `fichaMedica`, salas vacías, reintento ante `P2034`.

**Centinela nuevo** — un test que recorre `Prisma.dmmf.datamodel.models` y falla si algún modelo del
schema no está clasificado en `tenant-scoped.extension.ts`. Hoy pasaría de todas formas; su valor es
que la Fase 2 no pueda añadir un modelo y abrir una fuga sin que la suite lo grite. Este es el tipo de
test que habría cazado la fuga de `include` anidado de la Fase 0 antes de que existiera.

**e2e** — `test/nucleo.e2e-spec.ts`, cubriendo los diez puntos del checklist del §6 del PDF, más:

- **Concurrencia:** 10 reservas simultáneas sobre un turno de cupo 1 → exactamente **una 201 y nueve
  409**. Mismo patrón con el que se cazó la carrera del refresh token en Fase 0.
- **Aislamiento:** dos gimnasios, y para cada recurso nuevo se verifica que ninguno ve ni toca los
  datos del otro.

**`limpiarBaseDeDatos` debe incluir las seis tablas nuevas en el `TRUNCATE`.** Omitirlo contamina los
e2e entre sí con síntomas que no apuntan a la causa. Es un punto explícito del plan, no un detalle.

---

## 11. Checklist de aceptación

Los diez puntos del §6 del PDF, verbatim:

1. Se puede crear una sala y configurarla con sus reglas propias.
2. Se puede crear un pack en el catálogo, independiente de cualquier alumno puntual.
3. El alta de alumno y de profesor usan DTOs y validaciones distintas — un profesor nunca recibe un
   error de "clases mensuales requerido".
4. Un alumno sin salas asignadas genera un warning visible en la respuesta del API.
5. Se puede crear un turno puntual y asignarle una reserva manual respetando el cupo.
6. Intentar reservar un turno lleno devuelve 409, no un registro fuera de cupo.
7. Cancelar una reserva como "recuperable" devuelve la clase al perfil; como "definitiva", no.
8. Reasignar una reserva mueve el registro y valida el cupo del turno destino.
9. Cada operación relevante queda registrada en `historial_acciones`.
10. Tests e2e cubren alta de sala, pack, alumno con pack, profesor, turno, reserva manual y
    cancelación recuperable y definitiva.

---

## 12. Fuera de alcance

Del §7 del PDF: rutinas fijas, armado automático del mes, detección de conflictos, self-service del
alumno (PWA), profesor como entidad vinculada al turno, pagos con comprobante y estadísticas.

Añadidos por este spec:

- El pack **no bloquea** reservas, solo advierte (D3).
- `Perfil.cancelacionesUsadas` queda cableado pero inerte hasta que exista la cancelación por parte
  del alumno (Fase 3).
- Los campos "hereda del tenant" de `Sala` (`cupoBase`, `minMinutosCancelar`, `minMinutosAnotarse`,
  `listaEsperaHabilitada`) se almacenan pero no se consumen: no existe todavía configuración general
  del tenant de la que heredar.
- Lista de espera: el campo existe, la funcionalidad no.
- `nanoid` no se instala (C6).
