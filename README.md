# BoxAdmin

BoxAdmin es un gestor de gimnasios multi-tenant: una misma instalación sirve a varios
gimnasios ("boxes"), cada uno con sus propios usuarios y datos, sin que se mezclen entre sí.

Se construye por fases. Hasta ahora:

| Fase | Qué añadió |
|---|---|
| **0** — Fundamentos | Autenticación, roles y el aislamiento por tenant sobre el que se apoya todo lo demás |
| **1** — Núcleo operativo | Salas, packs, usuarios, turnos y reservas |
| **2** — Motor de recurrencia | Rutinas fijas y generación automática de los meses |
| **3A** — Self-service (API) | Auto-registro con clave, disponibilidad unificada, lista de espera y comprobantes |
| **3B** — La PWA | `apps/web`: la aplicación que usa el alumno, instalable en el teléfono |
| **4** — El profesor real | `Turno.profesorId` como relación, "mis clases", asistencia y la base de la liquidación |
| **5A** — El ciclo de cobro | Pagos con periodo; "al día" se deriva en vez de guardarse en una bandera |

Cada fase tiene su spec y su plan en `docs/superpowers/`, y su estado en
`docs/superpowers/plans/PROGRESO.md`.

## Requisitos

- Node 20 LTS
- Docker Compose v2 (`docker compose`, no `docker-compose`)
- pnpm, vía corepack (`corepack enable`; la versión fijada es `pnpm@9.12.0`, ver `packageManager` en `package.json`)

## Arranque

```bash
cp .env.example .env
docker compose up -d
docker compose ps
docker compose logs api --tail 40
```

Deberías ver los cuatro servicios (`postgres`, `postgres-test`, `redis`, `api`) arriba, y en
el log de `api` la línea `Nest application successfully started`.

El contenedor de la API **no aplica migraciones por sí solo**. Desde el host, con las
dependencias del monorepo instaladas (`pnpm install`):

```bash
pnpm --filter @boxadmin/api db:deploy
```

Con eso la API queda escuchando en `http://localhost:3000`.

### `packages/shared` hay que compilarlo

`packages/shared` publica sus tipos vía `dist/index.d.ts`, y `dist/` no está en el repo
(está en `.gitignore`). En un clon nuevo, antes de poder compilar o typechequear
`@boxadmin/api` hace falta construir el paquete compartido:

```bash
pnpm shared:build
```

`apps/api/package.json` ya trae un `prebuild` que lo hace automáticamente al correr
`pnpm --filter @boxadmin/api build` (y `start:dev` tiene su propio `prestart:dev`
equivalente), pero un `tsc --noEmit` suelto o un IDE con el paquete sin compilar seguirán
fallando con `TS2307: Cannot find module '@boxadmin/shared'` hasta que se ejecute al menos
una vez.

### Nota sobre el puerto 5434

El Postgres de `docker-compose.yml` se publica en el **5434** del host, no en el 5432. Es la
primera cosa con la que alguien va a tropezar si intenta conectarse "a mano" con un cliente
SQL. La razón: en máquinas con un PostgreSQL nativo de Windows ya instalado, ese PostgreSQL
ocupa el 5432, y el compose entraría en conflicto de puertos al levantar. Dentro de la red de
Docker el contenedor `api` habla con `postgres` por el puerto interno 5432 de siempre
(`postgres:5432`); el 5434 solo importa para acceder desde el host. `postgres-test`, el que
usan los tests e2e, se publica en el 5433 por la misma razón.

## Estructura del repo

```
apps/
  api/                 API NestJS (el único servicio de aplicación por ahora)
    src/
      auth/            Tenants, registro, login, refresh, /auth/me
      common/
        tenant/        AsyncLocalStorage + extensión de Prisma para el aislamiento
        guards/        JwtAuthGuard, RolesGuard, BootstrapKeyGuard
      jobs/             Cola BullMQ de prueba (health-check)
      prisma/           PrismaService (cliente base + cliente con scoping)
    prisma/
      schema.prisma    Modelos: Tenant, Usuario, RefreshToken, HistorialAccion
      migrations/
packages/
  shared/              Tipos y utilidades compartidas entre API y futuros paquetes
docker-compose.yml     postgres, postgres-test, redis, api
```

## Aislamiento por tenant

Este es el corazón del proyecto: ningún gimnasio puede ver los datos de otro, y esa garantía
no depende de que cada desarrollador recuerde añadir un `where: { tenantId }` en cada query.

**Cómo funciona:**

1. `TenantContextMiddleware` (`apps/api/src/common/tenant/tenant.middleware.ts`) corre en
   cada request. Si hay un JWT válido con `tenantId`, abre un contexto con
   [`AsyncLocalStorage`](apps/api/src/common/tenant/tenant-context.ts) que envuelve el resto
   del ciclo de vida de esa request: `runWithTenant(tenantId, () => next())`.
2. `PrismaService` expone dos clientes (`apps/api/src/prisma/prisma.service.ts`):
   - `base`: el cliente crudo de Prisma, sin ningún filtro. Reservado para conectar,
     desconectar y limpiar la base en tests. El código de aplicación nunca lo usa.
   - `db`: el cliente que extiende `base` con `tenantScopedExtension`
     (`apps/api/src/common/tenant/tenant-scoped.extension.ts`). Es el único que usa el resto
     de la aplicación.
3. La extensión intercepta **toda** operación de Prisma sobre modelos con tenant
   (`Usuario`, `HistorialAccion`, y `RefreshToken` a través de su relación con `Usuario`) y le
   inyecta `where: { tenantId }` (o el filtro equivalente por relación) leyendo el
   `tenantId` del contexto activo, no de ningún argumento que pase el llamador.

**La regla dura:** el código de aplicación **nunca** pasa `tenantId` a mano en un `where` o
`data`. Si una operación es legítimamente global (crear un tenant nuevo, buscar un usuario en
el login antes de que exista ningún JWT), se envuelve explícitamente en `runUnscoped()` para
que el escape del aislamiento quede visible en el código y sea auditable.

**Fail-closed, no fail-open:** una query sobre un modelo con tenant que se ejecuta **sin**
contexto (ni `runWithTenant` ni `runUnscoped`) no devuelve todas las filas de todos los
gimnasios: lanza `MissingTenantContextError`. Un modelo que no está clasificado en
`tenant-scoped.extension.ts` también bloquea la query en vez de dejarla pasar sin filtrar.

Dos restricciones adicionales, deliberadas:

- **`findUnique` (y `findUniqueOrThrow`, `upsert`) están prohibidos** sobre modelos con
  tenant mientras hay contexto activo: su `where` solo admite campos únicos, así que no hay
  forma de inyectarles el filtro sin arriesgarse a que un único global (p. ej. un `id`)
  devuelva una fila de otro gimnasio. Hay que usar `findFirst` con el campo único en el
  `where`, que sí admite el filtro añadido.
- **Las consultas raw (`$queryRaw`, `$queryRawUnsafe`, `$executeRaw`, `$executeRawUnsafe`)
  están bloqueadas** dentro de un contexto de tenant: Prisma no expone ni modelo ni `where`
  para ellas, así que no hay nada que la extensión pueda filtrar.

## Por qué el login pide `tenantSlug`

El email de un usuario es único **dentro de un tenant**, no globalmente (`@@unique([tenantId,
email])` en el modelo `Usuario`). Dos gimnasios distintos pueden tener cada uno un usuario
con el mismo email sin colisionar. Por eso `POST /auth/login` no puede resolver el usuario
solo con el email: necesita también el `tenantSlug` para saber en qué gimnasio buscarlo.

## Endpoints de la Fase 0

| Endpoint | Método | Protección |
|---|---|---|
| `/auth/tenants` | POST | Público + `x-bootstrap-key` (crea un tenant) |
| `/auth/register` | POST | Público + `x-bootstrap-key` (crea el primer usuario del tenant, siempre `ADMIN_SALON`) |
| `/auth/login` | POST | Público |
| `/auth/refresh` | POST | Público (valida el refresh token en el body) |
| `/auth/logout` | POST | JWT (access token) |
| `/auth/me` | GET | JWT (access token) |
| `/auth/admin-only` | GET | JWT + rol mínimo `ADMIN_SALON` (`RolesGuard`) |
| `/jobs/health-check` | POST | JWT + rol mínimo `ADMIN_SALON` (encola un job de prueba en BullMQ) |

`x-bootstrap-key` es un valor compartido definido en `.env` (`BOOTSTRAP_KEY`); solo protege el
alta inicial de tenants y del primer usuario de cada uno. `/auth/register` rechaza un segundo
registro sobre el mismo tenant: el alta normal de usuarios queda fuera del alcance de esta
fase.

## Endpoints de la Fase 1 — núcleo operativo

Todos exigen JWT. El rol indicado es el **mínimo**: la jerarquía es acumulativa, así que
`ADMIN_SALON` puede hacer todo lo de `ADMIN_OPERATIVO`, y `SUPERADMIN` todo lo demás. El PDF de la
fase solo definía los roles de `/salas`; el resto sale de separar **configurar** el salón de
**operarlo** día a día.

### Salas

| Método | Ruta | Rol mínimo |
|---|---|---|
| POST | `/salas` | `ADMIN_SALON` |
| GET | `/salas` | autenticado |
| GET | `/salas/:id` | autenticado |
| PATCH | `/salas/:id` | `ADMIN_SALON` |
| DELETE | `/salas/:id` | `ADMIN_SALON` — baja lógica; **409** si tiene turnos de hoy en adelante |

La visibilidad tiene tres niveles: el personal del salón ve todas las salas; un `PROFESOR` ve las
activas aunque no sean visibles para alumnos; un `ALUMNO` solo ve las activas y visibles. El filtro
va en el `where`, no en un `.filter()` posterior, así que la base nunca devuelve filas que el actor
no puede ver. Una sala que el actor no puede ver da **404**, no 403: confirmar que existe ya sería
filtrar información.

Dar de baja una sala por `PATCH` con `activa: false` aplica la misma comprobación de turnos futuros
que el `DELETE`, y se audita como baja. Reactivarla no comprueba nada.

### Packs (catálogo de precios)

| Método | Ruta | Rol mínimo |
|---|---|---|
| POST | `/packs` | `ADMIN_SALON` |
| GET | `/packs?salaId=&activo=` | autenticado |
| GET | `/packs/:id` | autenticado |
| PATCH | `/packs/:id` | `ADMIN_SALON` |
| DELETE | `/packs/:id` | `ADMIN_SALON` — baja lógica siempre |

El catálogo es una sección propia, no un campo escondido dentro del alta de un alumno. `precio` viaja
como **string** con dos decimales (`"12500.00"`), nunca como número: un float binario pierde centavos
y esto es dinero. `precio: null` significa "a consultar" y `salaId: null`, "vale para todas las
salas" — al filtrar por sala, esos packs se incluyen igualmente, porque omitirlos escondería medio
catálogo.

### Usuarios de negocio

| Método | Ruta | Rol mínimo |
|---|---|---|
| POST | `/usuarios/alumnos` | `ADMIN_OPERATIVO` |
| POST | `/usuarios/profesores` | `ADMIN_OPERATIVO` |
| GET | `/usuarios?tipo=alumno|profesor&salaId=&activo=` | `ADMIN_OPERATIVO` |
| GET | `/usuarios/:id` | `ADMIN_OPERATIVO`, o uno mismo |
| PATCH | `/usuarios/:id` | `ADMIN_OPERATIVO` |
| PATCH | `/usuarios/:id/salas` | `ADMIN_OPERATIVO` — **400** si el array viene vacío |
| POST | `/usuarios/:id/reset-password` | `ADMIN_SALON` |
| DELETE | `/usuarios/:id` | `ADMIN_OPERATIVO` — baja lógica |

**Las dos altas usan DTOs distintos.** El de profesor no acepta `packId`, `clasesExtra`, `pagoAlDia`
ni vigencias, y como el `ValidationPipe` global corre con `forbidNonWhitelisted`, mandárselos
devuelve **400** en vez de ignorarlos en silencio. Un profesor no puede recibir un error de "clases
mensuales requerido". Editar campos de alumno sobre un profesor también es 400.

El alta crea el `Usuario` (identidad y auth, de la Fase 0) y su `Perfil` (datos de negocio) en una
transacción, y devuelve una contraseña temporal en `passwordTemporal` **una sola vez**: no se puede
volver a leer. `POST /usuarios/:id/reset-password` funciona igual.

`Perfil.fichaMedica` es un dato de salud: nunca aparece en listados, y en el detalle solo la ven
`ADMIN_SALON` o el propio usuario.

### Turnos

| Método | Ruta | Rol mínimo |
|---|---|---|
| POST | `/turnos` | `ADMIN_OPERATIVO` |
| GET | `/turnos?desde=&hasta=&salaId=&soloLibres=` | autenticado |
| GET | `/turnos/:id` | autenticado |
| PATCH | `/turnos/:id` | `ADMIN_OPERATIVO` — **409** si el cupo nuevo es menor que las reservas activas |
| DELETE | `/turnos/:id` | `ADMIN_OPERATIVO` — borrado físico; **409** si tiene reservas activas |

`fecha` entra y sale como `"YYYY-MM-DD"`, sin hora ni huso; `horaInicio` y `horaFin` son `"HH:MM"` en
24 h, con `horaFin` estrictamente posterior. `lugaresLibres` cuenta solo reservas **sin cancelar**, y
nunca es negativo.

A diferencia de salas y packs, el borrado de un turno es **físico**: un turno sin reservas activas no
es historia de nadie, y un calendario lleno de turnos "de baja" es peor que uno vacío. Sus reservas
canceladas se van con él (`onDelete: Cascade`); la auditoría no se pierde, porque
`historial_acciones` no tiene clave foránea a ninguna de las dos tablas.

### Reservas

| Método | Ruta | Rol mínimo |
|---|---|---|
| POST | `/turnos/:turnoId/reservas` | `ADMIN_OPERATIVO` |
| DELETE | `/reservas/:id?tipo=recuperable\|definitiva` | `ADMIN_OPERATIVO` |
| PATCH | `/reservas/:id/reasignar` | `ADMIN_OPERATIVO` |

El cuerpo de la creación lleva `perfilId`, no `usuarioId`: los listados de usuarios ya lo devuelven.

**Una reserva nunca se borra, se cancela.** `RECUPERABLE` deja de contar contra el pack — ahí es
donde "la clase vuelve al perfil" — y `DEFINITIVA` sigue contando. No hay ningún contador almacenado:
las clases consumidas se **derivan** contando las reservas del perfil que siguen activas más las
canceladas como definitivas. Un contador que se incrementa y decrementa a mano se desincroniza para
siempre al primer bug.

La creación y la reasignación van dentro de una transacción `Serializable` con reintento ante
conflictos de serialización (`P2034` / `40001`), porque el cupo es un invariante que dos peticiones
simultáneas pueden romper. Los errores de negocio **no** se reintentan: un turno lleno sigue lleno.
Verificado con 10 peticiones simultáneas sobre un turno de cupo 1 — exactamente una `201` y nueve
`409`.

Reservar en una sala a la que el usuario no tiene acceso da **403**; reservar dos veces el mismo
turno, **409**.

### Advertencias

Las respuestas de alta y de reserva llevan `advertencias: [{ codigo, mensaje }]`. No bloquean la
operación: existen para que el admin se entere de algo que, guardado en silencio, produciría un
usuario inservible sin que nadie lo notara hasta que intentara reservar.

| Código | Cuándo |
|---|---|
| `SIN_SALAS` | Alta de alumno o profesor sin ninguna sala asignada |
| `SIN_PACK` | Alta de alumno sin pack |
| `PACK_AGOTADO` | La reserva deja al alumno por encima del tope de su pack |

La asimetría con `PATCH /usuarios/:id/salas`, que rechaza la lista vacía con **400**, es deliberada:
en un alta puede faltar información legítimamente, pero una petición cuyo único propósito es fijar
las salas y que manda cero es siempre un error.

El pack **no bloquea** reservas, solo avisa: la única regla dura es el cupo del turno. El admin manda
y puede querer meter una clase de cortesía.

### Auditoría

Cada alta, baja, edición de salas con acceso, cancelación y reasignación escribe una fila en
`historial_acciones` con la entidad, su id, la acción, el `usuarioId` de quien la ejecutó y un
`detalle` en JSON. Se escribe **dentro** de la misma transacción que provocó el cambio, así que un
rollback se lleva también el registro: nunca queda rastro de algo que no llegó a ocurrir.

### Flujo completo de ejemplo

```bash
API=http://localhost:3000

# 1. Bootstrap: tenant y primer admin (requieren x-bootstrap-key)
curl -X POST $API/auth/tenants -H 'Content-Type: application/json' \
  -H 'x-bootstrap-key: changeme_bootstrap_key' \
  -d '{"nombre":"Box Central","slug":"box-central"}'

curl -X POST $API/auth/register -H 'Content-Type: application/json' \
  -H 'x-bootstrap-key: changeme_bootstrap_key' \
  -d '{"tenantSlug":"box-central","nombreCompleto":"Admin","email":"admin@box.test","password":"Password123!"}'

TOKEN=$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' \
  -d '{"tenantSlug":"box-central","email":"admin@box.test","password":"Password123!"}' \
  | python -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")

AUTH="Authorization: Bearer $TOKEN"

# 2. Sala
curl -X POST $API/salas -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"nombre":"Sala A","cupoBase":12,"minMinutosCancelar":120}'

# 3. Pack en el catálogo
curl -X POST $API/packs -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"nombre":"8 clases","tipo":"MENSUAL","clasesPorMes":8,"precio":"12500.00"}'

# 4. Alumno con ese pack y acceso a la sala. La respuesta trae passwordTemporal
#    UNA sola vez, y perfilId, que es lo que necesitas para reservar.
curl -X POST $API/usuarios/alumnos -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"nombreCompleto":"Ana Perez","email":"ana@box.test","salaIds":["SALA_ID"],"packId":"PACK_ID"}'

# 5. Profesor: mismo recurso, DTO distinto, sin campos de alumno
curl -X POST $API/usuarios/profesores -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"nombreCompleto":"Luis Gomez","email":"luis@box.test","salaIds":["SALA_ID"]}'

# 6. Turno
curl -X POST $API/turnos -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"salaId":"SALA_ID","nombre":"Pilates","fecha":"2026-10-05","horaInicio":"18:00","horaFin":"19:00","cupo":10}'

# 7. Reserva manual
curl -X POST $API/turnos/TURNO_ID/reservas -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"perfilId":"PERFIL_ID"}'

# 8. Cancelar devolviendo la clase, y reasignar a otro turno
curl -X DELETE "$API/reservas/RESERVA_ID?tipo=recuperable" -H "$AUTH"

curl -X PATCH $API/reservas/RESERVA_ID/reasignar -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"turnoId":"OTRO_TURNO_ID"}'
```

## Endpoints de la Fase 2 — motor de recurrencia

El admin carga la rutina fija de un alumno **una sola vez** —"martes y jueves a las 18:00 en
Pilates"— y el sistema genera los turnos y reservas de cada mes futuro, mostrando antes de confirmar
todo lo que necesita una decisión humana.

Todos exigen JWT. El rol indicado es el **mínimo**.

### Rutinas fijas

| Método | Ruta | Rol mínimo |
|---|---|---|
| POST | `/rutinas` | `ADMIN_OPERATIVO` |
| GET | `/rutinas?perfilId=&salaId=&activa=` | `ADMIN_OPERATIVO` |
| PATCH | `/rutinas/:id` | `ADMIN_OPERATIVO` |
| DELETE | `/rutinas/:id` | `ADMIN_OPERATIVO` — baja lógica |

Crear una rutina valida que el alumno tenga **acceso a la sala**, con la misma regla que una reserva
manual: sin acceso, la rutina generaría mes tras mes reservas que el motor acabaría rechazando.

El `PATCH` no admite cambiar `perfilId` ni `salaId`: eso dejaría turnos ya generados colgando de un
patrón que ya no existe. Para eso se da de baja y se crea otra.

Sin filtro explícito, el listado devuelve **solo las activas** — son las que generan. El histórico se
pide a propósito con `?activa=false`.

### Calendario

| Método | Ruta | Rol mínimo |
|---|---|---|
| POST | `/calendario/:salaId/:anio/:mes/previsualizar` | `ADMIN_OPERATIVO` — **200** con el plan |
| GET | `/calendario/:salaId/:anio/:mes/conflictos` | `ADMIN_OPERATIVO` |
| POST | `/calendario/:salaId/:anio/:mes/publicar` | **`ADMIN_SALON`** — **202** con el `jobId` |
| GET | `/calendario/:salaId/:anio/:mes` | `ADMIN_OPERATIVO` — estado del mes y del último job |

**`previsualizar` es síncrono y no escribe nada.** No hay razón para mandar a una cola una operación
de solo lectura que el admin está esperando en pantalla.

**`publicar` devuelve 202 y el trabajo ocurre en un worker de BullMQ.** Publicar un mes crea reservas
para todo el salón de golpe, por eso es `ADMIN_SALON` y no operación diaria.

Regenerar un **mes que ya pasó** devuelve **400**: crearía reservas para clases que ya ocurrieron.

### Vacaciones y ausencias

| Método | Ruta | Rol mínimo |
|---|---|---|
| POST | `/vacaciones-alumnos` | `ADMIN_OPERATIVO` |
| GET | `/vacaciones-alumnos?perfilId=` | `ADMIN_OPERATIVO` |
| DELETE | `/vacaciones-alumnos/:id` | `ADMIN_OPERATIVO` |
| POST | `/ausencias` | **`ADMIN_SALON`** |
| GET | `/ausencias?salaId=&desde=&hasta=` | autenticado |
| DELETE | `/ausencias/:id` | **`ADMIN_SALON`** |

Una `Ausencia` con `salaId: null` cierra **todo el salón**, y aparece igualmente al filtrar por
cualquier sala concreta. El filtro por fechas busca **solape, no contención**: un cierre del 28 de
septiembre al 3 de octubre sale al preguntar por octubre.

### Conflictos y exclusiones: la distinción que importa

El plan de un mes separa dos cosas que es tentador mezclar:

| | Qué es | Tipos |
|---|---|---|
| **`conflictos`** | Requieren **decisión humana** | `CUPO_LLENO`, `FUERA_DE_PACK`, `SALA_SIN_CUPO_BASE` |
| **`exclusiones`** | Informativas: pasaron porque alguien cargó ese dato a propósito | `AUSENCIA_SALA`, `VACACION_ALUMNO` |

Mezclarlas haría que un mes con tres alumnos de vacaciones mostrara decenas de "conflictos" que nadie
tiene que resolver, y que esconderían los dos que sí. `GET /conflictos` devuelve solo los primeros.

**Un conflicto individual nunca aborta el resto del mes.** El objetivo es que el admin revise una
lista acotada, no que un alumno con el pack vencido bloquee la generación entera.

### Idempotencia

**Publicar dos veces no duplica nada, y es el caso normal**: se da de alta un alumno a mitad de mes,
se vuelve a publicar y solo se crea lo que falta. Tres capas lo sostienen:

1. El plan se calcula contra lo que ya existe, así que la segunda corrida no encuentra nada que crear.
2. La fila de `MesCalendario` es el **cerrojo**, tomado con un `updateMany` condicional: dos
   publicaciones simultáneas del mismo mes no se pisan.
3. Dos índices únicos en la base — uno de ellos **parcial**, sobre reservas activas — como red de
   debajo. Un `P2002` al insertar significa "ya estaba", no "falló".

De dónde salen el cupo y el nombre de un turno generado: el **cupo** de `Sala.cupoBase` y el
**nombre** de la rutina. Si la sala no tiene `cupoBase`, el motor no inventa un valor por defecto:
lo reporta como conflicto `SALA_SIN_CUPO_BASE`.

⚠️ `MesCalendario.estado = HABILITADO` **no habilita nada funcionalmente todavía**. No hay
self-service de alumno hasta la Fase 3, así que ningún alumno ve ni reserva nada. Registra que el mes
se publicó, cuándo y quién.

### Flujo completo de ejemplo

```bash
API=http://localhost:3000
AUTH="Authorization: Bearer $TOKEN"   # ver el flujo de la Fase 1 para obtener el token

# 1. Sala CON cupoBase: es de donde sale el cupo de los turnos generados
curl -X POST $API/salas -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"nombre":"Sala A","cupoBase":5}'

# 2. Rutina fija: martes (diaSemana 2) a las 18:00
curl -X POST $API/rutinas -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"perfilId":"PERFIL_ID","salaId":"SALA_ID","nombre":"Pilates","diaSemana":2,
       "horaInicio":"18:00","horaFin":"19:00","desde":"2099-01-01"}'

# 3. Opcional: cerrar el salón un día, o marcar vacaciones de un alumno
curl -X POST $API/ausencias -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"desde":"2099-10-13","hasta":"2099-10-13","motivo":"Feriado"}'

curl -X POST $API/vacaciones-alumnos -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"perfilId":"PERFIL_ID","desde":"2099-10-20","hasta":"2099-10-20","motivo":"Viaje"}'

# 4. Previsualizar: devuelve el plan completo SIN escribir nada
curl -X POST $API/calendario/SALA_ID/2099/10/previsualizar -H "$AUTH"

# 5. Publicar: 202 con el jobId; el worker hace el trabajo
curl -X POST $API/calendario/SALA_ID/2099/10/publicar -H "$AUTH"

# 6. Sondear hasta que la publicación termine
curl $API/calendario/SALA_ID/2099/10 -H "$AUTH"
# -> { "estado": "HABILITADO",
#      "publicacion": { "estado": "terminado",
#                       "resumen": { "turnos": 4, "reservas": 4, ... } } }
```

⚠️ **No corras los e2e con la API de desarrollo levantada.** Ambas comparten Redis, así que el worker
del `start:dev` compite por los jobs de la cola y los resuelve contra la base de **desarrollo** (5434)
en vez de la de test (5433). El síntoma es desconcertante: un job que acabas de encolar falla con
"Sala inexistente" aunque la sala exista. Pára la API antes de `test:e2e`.

## Endpoints de la Fase 3A — self-service del alumno

Un alumno entra con una clave de invitación, ve su calendario, reserva y cancela clases sueltas
dentro de las reglas, se anota en lista de espera y sube un comprobante de pago. Sin que el admin
intervenga en el momento.

⚠️ La **PWA no entra aquí**: la Fase 3 del PDF se partió en dos. Esta es la API; `apps/web` llega en
la Fase 3B, construida contra este contrato ya probado.

### Invitaciones

| Método | Ruta | Rol mínimo |
|---|---|---|
| POST | `/invitaciones` | `ADMIN_OPERATIVO` |
| GET | `/invitaciones` | `ADMIN_OPERATIVO` |
| PATCH | `/invitaciones/:id` | `ADMIN_OPERATIVO` |

**Una clave lleva consigo las salas y el pack** que recibirá el alumno, y exige al menos una sala.
Eso no es un adorno: las reservas se validan contra `UsuarioSala`, así que un alumno auto-registrado
sin salas no podría ver ni reservar nada. La intervención del admin ocurre **antes** del alta, al
preparar la clave, no después.

El `codigo` lo genera el servidor (32 caracteres hexadecimales de `randomBytes`), nunca lo propone el
cliente, y **no aparece en el historial**: es una credencial. Tampoco se puede cambiar — para rotarlo
se desactiva la clave y se crea otra.

### Auto-registro

| Método | Ruta | Acceso |
|---|---|---|
| POST | `/auth/auto-registro` | público, con throttle estricto |
| GET | `/usuarios?autoRegistrado=true` | `ADMIN_OPERATIVO` |

El cuerpo trae `tenantSlug`, `codigo`, `nombreCompleto`, `email` y `password`, y devuelve el mismo
par de tokens que el login: el alumno queda logueado.

**Corre en una transacción Serializable con reintento.** `usosMax` es un cupo y tiene exactamente la
misma carrera que el cupo de un turno: sin aislamiento, dos registros simultáneos con una clave de un
solo uso leen ambos `usosActuales = 0` y ambos pasan. Encima del aislamiento, el incremento va con un
`updateMany` condicional, el mismo compare-and-swap que protege la rotación de refresh tokens.

El rol se fija a `ALUMNO` **en el servicio**, no solo en el DTO: una sola línea de defensa en un
endpoint público no basta.

Las cuatro formas de clave inutilizable —inexistente, desactivada, caducada y agotada— devuelven el
**mismo 401 con el mismo mensaje**. A quien esté probando códigos no se le dice cuál acertó.

### Calendario del alumno

| Método | Ruta | Rol mínimo |
|---|---|---|
| GET | `/mi-calendario?desde=&hasta=&salaId=` | `ALUMNO` |
| GET | `/turnos-disponibles?desde=&hasta=&salaId=` | `ALUMNO` |
| POST | `/turnos/:id/mi-reserva` | `ALUMNO` |
| DELETE | `/mis-reservas/:id` | `ALUMNO` |
| POST | `/turnos/:id/lista-espera` | `ALUMNO` |
| DELETE | `/lista-espera/:id` | `ALUMNO` |

Todas operan sobre el perfil **del actor**, nunca sobre un `perfilId` del cuerpo. Un usuario sin
perfil —un admin, por ejemplo— recibe 404, y es correcto: no tiene calendario propio.

⚠️ **`MesCalendario.estado = HABILITADO` ya no es decorativo.** Desde esta fase, un turno solo
aparece en `turnos-disponibles` si su mes está publicado. Es el enganche que la Fase 2 dejó escrito.

Pero el gate aplica a **descubrir** turnos, no a ver los propios: `mi-calendario` devuelve siempre
las reservas del alumno. Si el admin despublicara un mes, hacer desaparecer de su pantalla una clase
que tiene reservada sería peor que mostrarla.

Pedir una sala a la que no se tiene acceso devuelve **lista vacía, no 403**: contestar "no tienes
acceso" confirmaría que esa sala existe.

### Disponibilidad: un solo concepto

`DisponibilidadService` unifica lo que en TurnoFit son dos features separadas y confusas —"lista de
espera" y "solo cupos liberados"— en un estado consolidado. El contrato tiene **dos ejes separados a
propósito**:

| Campo | Qué describe |
|---|---|
| `estado` | El **turno**, independiente de quién pregunte |
| `puedeReservar` + `motivo` | A **este alumno, ahora** |

| Estado | Cuándo |
|---|---|
| `LIBRE` | hay cupo |
| `SOLO_ADMIN` | hay cupo, pero la sala es `soloCuposLiberados` y nadie canceló todavía |
| `LISTA_ESPERA` | sin cupo, con lista de espera habilitada |
| `LLENO` | sin cupo y sin lista de espera |

Mezclar los dos ejes —hacer que el estado cambiara según quién consulta— haría el contrato inservible
para el frontend, que necesita pintar el turno y el botón por separado.

Los `motivo` posibles, resueltos **en este orden** (gana el primero que se cumpla): `SIN_ACCESO_A_SALA`,
`SALA_NO_VISIBLE`, `MES_NO_PUBLICADO`, `YA_RESERVADO`, `VENTANA_CERRADA`, `SOLO_CUPOS_LIBERADOS`. Va
de lo más general a lo más específico a propósito: a un alumno que ni siquiera tiene la sala asignada
no le sirve que le digan "la ventana cerró".

**Un cupo "liberado" es derivable**: existe alguna reserva cancelada en ese turno. No hizo falta
ninguna columna nueva.

### Configuración heredable

`minMinutosCancelar`, `minMinutosAnotarse` y `listaEsperaHabilitada` se resuelven en cascada:
**`Sala ?? Tenant ?? sistema`**, campo por campo. El valor del sistema es 0 minutos y lista de espera
apagada.

⚠️ Es `??` y no `||`, y la diferencia es un bug de negocio: `0` y `false` son valores configurados a
propósito ("en esta sala no hay ventana"), no ausencias. Hay dos tests que fallan si se cambia.

**`Tenant` no tiene `cupoBase`** aunque `Sala` sí. Es deliberado: el planificador de la Fase 2
reporta `SALA_SIN_CUPO_BASE` como conflicto cuando la sala no lo define, y un fallback en el tenant
cambiaría ese detector en silencio.

### Lista de espera

La posición **se deriva** del orden por `(createdAt, id)`. No hay columna `posicion`, a diferencia del
PDF: un entero guardado hay que renumerarlo en cada baja y es una carrera en cada alta. Mismo
razonamiento que el conteo de clases derivado de la Fase 1.

Al cancelarse una reserva, **dentro de la misma transacción**, el primero de la cola entra
automáticamente con `origen: 'LISTA_ESPERA'`. No se notifica a nadie todavía: el hook está preparado
e inerte hasta la Fase 5.

⚠️ **`ReservasService.cancelar` pasó a Serializable con reintento** en esta fase. Hasta ahora no
competía por ningún cupo; desde que reparte el liberado, dos cancelaciones simultáneas sobre el mismo
turno podrían dar el mismo lugar a dos personas.

La asignación **no re-valida** el pack ni la ventana del beneficiario: el lugar es suyo por posición
en la cola. Y salta a quien ya tenga reserva activa en ese turno, limpiando igualmente su fila.

### Comprobantes

| Método | Ruta | Rol mínimo |
|---|---|---|
| POST | `/comprobantes` | `ALUMNO` |
| PATCH | `/comprobantes/:id/confirmar` | `ALUMNO` |
| GET | `/comprobantes?estado=` | `ALUMNO` (los suyos) / `ADMIN_OPERATIVO` (todos) |
| PATCH | `/comprobantes/:id/aprobar` | `ADMIN_OPERATIVO` |
| PATCH | `/comprobantes/:id/rechazar` | `ADMIN_OPERATIVO` |

**El flujo es de tres pasos**, que es el patrón estándar de subida presignada:

1. `POST /comprobantes` crea la fila en `PENDIENTE` con `subidoEn: null` y devuelve la URL firmada.
2. El cliente hace `PUT` del archivo a esa URL. **No pasa por la API.**
3. `PATCH /comprobantes/:id/confirmar` marca `subidoEn`.

El tercer paso existe porque **ni S3 ni el adaptador local pueden avisar a la API** de que el `PUT`
terminó. Sin él, saber si un comprobante tiene archivo obligaría a consultar el almacén en cada
listado. Una fila sin confirmar no aparece en el listado del admin —así no ve enlaces rotos—, pero sí
en el del alumno, que es quien tiene que terminar de subirla.

La **clave del archivo la genera el servidor** (UUID + extensión sacada del *mime*, con lista blanca:
PDF, JPEG, PNG y WebP). Usar el nombre del cliente sería path traversal servido en bandeja. La clave
nunca sale en el contrato público: solo viaja la URL firmada, de 5 minutos de vida.

**Aprobar un comprobante pone `Perfil.pagoAlDia = true`.** Ese campo existía desde la Fase 1 sin que
nada lo escribiera. Rechazar no lo toca: un rechazo no invalida un pago anterior que sí estaba bien.

### Almacenamiento de archivos

Un puerto `AlmacenDeArchivos` con dos adaptadores, elegidos por `ALMACEN_TIPO` **en el arranque** —así
un error de configuración sale al levantar la aplicación, no en la primera subida—:

| Valor | Qué hace | Variables que exige |
|---|---|---|
| `local` | Guarda en disco y expone `PUT`/`GET /archivos-locales/:clave` firmadas con HMAC | `ALMACEN_LOCAL_DIR`, `API_BASE_URL` |
| `s3` | Presignado contra cualquier almacén compatible con S3 (Backblaze B2, DigitalOcean Spaces) | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |

Las variables de S3 **solo se exigen con `ALMACEN_TIPO=s3`**: pedirlas siempre obligaría a inventar
credenciales falsas en desarrollo, que es justo como acaban commiteadas.

**El adaptador local no es un mock.** Firma URLs y sirve archivos de verdad, así que los e2e
ejercitan el flujo completo de tres pasos sin credenciales ni red — incluido descargar el archivo y
comparar el buffer con lo que se subió. Sus rutas **solo se registran cuando `ALMACEN_TIPO=local`**:
en producción no existen.

La firma es HMAC-SHA256 sobre **clave y caducidad juntas**: si solo entrara la clave, cualquiera
podría estirar la caducidad editando el query param; si solo la caducidad, una firma valdría para
cualquier archivo. Se compara en tiempo constante.

### Throttling

`ThrottlerGuard` es el **primer** `APP_GUARD` de los tres: los guards corren en el orden en que se
declaran, y el freno tiene que aplicarse antes de que `JwtAuthGuard` gaste tiempo validando el token
de quien está probando credenciales.

Cinco intentos por minuto y por IP en `/auth/login`, `/auth/refresh` y `/auth/auto-registro`. Los
límites son configurables (`THROTTLE_AUTH_LIMIT`, `THROTTLE_AUTH_TTL`), **con los valores estrictos
como defecto**, de modo que olvidarse de definir la variable deja el sistema en el lado seguro.

⚠️ `.env.test` los sube a 100000 a propósito: `crearGimnasio` hace un login por cada `beforeEach` y un
solo archivo encadena más de treinta contra la misma IP. Con el límite de producción, los e2e
empezarían a dar 429 a partir del sexto test. El throttler se ejercita aparte en
`throttling.e2e-spec.ts`, que se baja el límite **antes de importar la aplicación** — tiene que ser
así porque `@Throttle` es metadata estática que se evalúa al definir la clase del controller.

`main.ts` hace `trust proxy` en **1**, no `true`: confiar en toda la cadena de `X-Forwarded-For`
dejaría falsificar la IP con una cabecera y saltarse el límite entero.

### Flujo completo de ejemplo

```bash
API=http://localhost:3000
AUTH="Authorization: Bearer $TOKEN_ADMIN"

# 1. Sala con cupoBase y lista de espera encendida
curl -X POST $API/salas -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"nombre":"Sala A","cupoBase":1,"listaEsperaHabilitada":true}'

# 2. Clave de invitacion CON salas: sin ellas el alumno no podria reservar nada
curl -X POST $API/invitaciones -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"nombre":"Alumnos de Pilates","salaIds":["SALA_ID"],"usosMax":20}'
# -> { "codigo": "a1b2c3...", ... }   <- esto es lo que se reparte

# 3. El alumno se da de alta solo, y queda logueado
curl -X POST $API/auth/auto-registro -H 'Content-Type: application/json' \
  -d '{"tenantSlug":"mi-gym","codigo":"a1b2c3...","nombreCompleto":"Ana Perez",
       "email":"ana@ejemplo.com","password":"Password123!"}'
# -> { "accessToken": "...", "usuario": { "rol": "ALUMNO" } }

# 4. El admin publica el mes: hasta aqui el alumno no ve NINGUN turno
curl -X POST $API/calendario/SALA_ID/2099/10/publicar -H "$AUTH"

# 5. Ya puede descubrir turnos, con su disponibilidad calculada
curl "$API/turnos-disponibles?desde=2099-10-01&hasta=2099-10-31" \
  -H "Authorization: Bearer $TOKEN_ALUMNO"
# -> [{ "turnoId": "...", "disponibilidad": { "estado": "LIBRE", "puedeReservar": true } }]

# 6. Reserva, y la clase aparece en su calendario
curl -X POST $API/turnos/TURNO_ID/mi-reserva -H "Authorization: Bearer $TOKEN_ALUMNO"
curl "$API/mi-calendario?desde=2099-10-01&hasta=2099-10-31" \
  -H "Authorization: Bearer $TOKEN_ALUMNO"

# 7. Si el turno esta lleno, el error OFRECE la cola en vez de ser generico
curl -X POST $API/turnos/TURNO_ID/mi-reserva -H "Authorization: Bearer $TOKEN_OTRO"
# -> 409 "Este turno esta completo (1/1), pero puedes anotarte en la lista de espera..."
curl -X POST $API/turnos/TURNO_ID/lista-espera -H "Authorization: Bearer $TOKEN_OTRO"
# -> { "posicion": 1 }

# 8. Al cancelar el primero, el de la cola entra SOLO
curl -X DELETE $API/mis-reservas/RESERVA_ID -H "Authorization: Bearer $TOKEN_ALUMNO"
curl "$API/mi-calendario?desde=2099-10-01&hasta=2099-10-31" \
  -H "Authorization: Bearer $TOKEN_OTRO"
# -> [{ "origen": "LISTA_ESPERA", ... }]

# 9. Comprobante de pago, en tres pasos
curl -X POST $API/comprobantes -H "Authorization: Bearer $TOKEN_ALUMNO" \
  -H 'Content-Type: application/json' \
  -d '{"nombreOriginal":"transferencia.pdf","tipoMime":"application/pdf"}'
# -> { "comprobante": {...}, "urlDeSubida": "http://localhost:3000/archivos-locales/..." }

curl -X PUT "URL_DE_SUBIDA" --data-binary @transferencia.pdf
curl -X PATCH $API/comprobantes/COMP_ID/confirmar -H "Authorization: Bearer $TOKEN_ALUMNO"

# 10. El admin lo aprueba, y el alumno queda al dia
curl -X PATCH $API/comprobantes/COMP_ID/aprobar -H "$AUTH" \
  -H 'Content-Type: application/json' -d '{}'
```

### Trampas del entorno

⚠️ **No corras los e2e con otra API viva contra el mismo Redis.** Ya estaba documentado para
`start:dev`, pero `docker compose up` sin argumentos levanta también un contenedor `api` que usa el
**mismo Redis** que alcanzan los tests desde el host: su worker les roba los jobs y los resuelve
contra la base de desarrollo. Levanta solo lo que hace falta:

```bash
docker compose up -d postgres postgres-test redis
```

⚠️ **Que el puerto 3000 esté libre NO significa que no haya una API viva.** Matar el proceso que
escucha en el puerto puede dejar en pie el de `nest start --watch` y su hijo `dist/main`, y **el
worker de BullMQ sigue robando jobs sin escuchar en ningún puerto**. El síntoma vuelve a ser
"Sala inexistente" en un job recién encolado. Para comprobarlo de verdad:

```bash
# Windows: lista los procesos node de ESTE repo, con su PID
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" |
  Where-Object { \$_.CommandLine -like '*box-admin*' } |
  Select-Object ProcessId, CommandLine"
```

Y mátalos **por PID concreto**, nunca por nombre de proceso.

⚠️ **Si todo empieza a dar 500 de golpe, comprueba `docker info` antes de buscar el bug en el
código.** Docker Desktop se cerró solo seis veces entre la Fase 2 y la 3A.

⚠️ **`Sala.exclusiva` sigue sin efecto.** Está en el schema desde la Fase 1 y nunca se definió qué
hace: se buscó en los tres PDFs, en los specs y en el código. Mejor un campo almacenado sin usar que
una semántica inventada. `soloCuposLiberados` estaba igual y **sí** se resolvió en esta fase.


## La PWA del alumno — Fase 3B

`apps/web`: un Next.js 15 instalable en el teléfono, contra la API de la Fase 3A. La Fase 3 del PDF
se partió en dos, y esta es la segunda mitad.

### Levantarlo

Las dos aplicaciones corren a la vez, en puertos distintos:

```bash
docker compose up -d postgres postgres-test redis   # NUNCA `up` a secas: ver la trampa de Redis
pnpm api:dev      # API de Nest, puerto 3000
pnpm web:dev      # la PWA,      puerto 3001
```

Después, `http://localhost:3001/<slug-del-gimnasio>/registro`.

### Las seis pantallas

| Ruta | Quién | Qué hace |
|---|---|---|
| `/[slug]/login` | público | Entrar |
| `/[slug]/registro` | público | Auto-registro con clave de invitación |
| `/[slug]/calendario` | alumno | Vista semanal: reservar, cancelar, lista de espera |
| `/[slug]/mi-pack` | alumno | Consumo, periodo, si está al día |
| `/[slug]/comprobantes` | alumno | Subir y ver estado |
| `/[slug]/perfil` | alumno | Datos y cerrar sesión |

El gimnasio va en la ruta y no en un subdominio: funciona en cualquier hosting sin DNS comodín ni
certificado wildcard, y en desarrollo funciona tal cual en `localhost`.

### Por qué hay un BFF en medio

**El JavaScript de la página nunca ve el token.** Vive en cookies `httpOnly` que un XSS no puede
leer, y como la API devuelve los tokens en el cuerpo del JSON, hace falta una capa de Next que los
recoja y los convierta en cookie.

| Ruta de Next | Qué hace |
|---|---|
| `POST /api/auth/login` | Llama a la API, siembra `bx_access`, `bx_refresh` y `bx_slug` |
| `POST /api/auth/auto-registro` | Igual, contra `/auth/auto-registro` |
| `POST /api/auth/logout` | Revoca en la API y borra las cookies |
| `ALL /api/bx/[...ruta]` | **Proxy genérico**: reenvía a la API con el `Authorization` de la cookie |

El proxy es genérico a propósito —un handler por endpoint serían veinte archivos casi idénticos—, y
el precio es que **la validación del destino tiene que ser seria**: un proxy que acepta cualquier
destino es un SSRF, porque corre dentro de la red donde vive la API. Esa validación vive aparte, en
`src/lib/api-url.ts`, con sus propios tests: comprueba la forma cruda y la decodificada de cada
segmento, y como red final que la URL compuesta no salga del origen de la API.

**La cookie del slug no es decorativa.** Las cookies son del dominio pero los tokens son de **un**
gimnasio: sin ella, alguien logueado en `/gym-a/` que abriera `/gym-b/calendario` vería los datos de
A bajo la URL de B, porque el JWT lleva su propio `tenantId` y la API respondería tan tranquila. El
layout del área de alumno compara el slug de la URL con el de la cookie y, si no coinciden, manda al
login.

### Variables de entorno

En `apps/web/.env.local`:

```
API_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3001
```

⚠️ **`API_URL` NO lleva el prefijo `NEXT_PUBLIC_`, y es deliberado.** Una variable con ese prefijo se
incrusta en el bundle del navegador. La dirección de la API no tiene por qué ser pública, y sobre
todo: si estuviera disponible en el cliente, sería una invitación a saltarse el BFF y volver a mandar
el token desde el navegador.

Y en la API, `WEB_ORIGIN=http://localhost:3001` habilita el CORS que necesita la subida de
comprobantes. Sin esa variable, el CORS no se habilita en absoluto: un despliegue solo-API no tiene
frontend al que abrirle la puerta.

### El comprobante, en tres pasos

1. `POST /comprobantes` crea la fila y devuelve una **URL firmada**.
2. El navegador hace `PUT` del archivo **a esa URL**, directo al almacén.
3. `PATCH /comprobantes/:id/confirmar` marca que llegó.

El segundo paso es **el único punto de toda la aplicación donde el navegador habla con otro origen**
— por eso la API necesita CORS acotado a `/archivos-locales`. Y el tercero existe porque ni S3 ni el
adaptador local pueden avisar a la API de que el `PUT` terminó.

El archivo va **crudo**, sin envolver en `FormData`: la URL se firmó para un `Content-Type` concreto,
y envolverlo cambiaría los bytes. Si el `PUT` falla, **no se confirma**, así que la fila sin archivo
no le aparece al admin en vez de darle un enlace roto.

### Qué funciona sin conexión

**Leer el calendario ya cargado, y nada más.** Una sola regla de caché, `NetworkFirst` con timeout
corto sobre `/api/bx/mi-calendario`: con red, datos frescos; sin red, lo último que se vio, con un
aviso de cuándo se cargó. Un calendario viejo **sin fecha** es peor que no tenerlo.

**Reservar y cancelar fallan** con un mensaje claro. Se descartó encolarlas con Background Sync: el
cupo puede agotarse mientras la petición espera, así que el alumno se enteraría de que no tenía plaza
mucho después de creer que sí. Y Safari no lo soporta, que es el navegador de la mitad de los
teléfonos.

El service worker lo genera **Serwist**, no `next-pwa` — esa última se publicó por última vez en
agosto de 2022, antes de que existiera el App Router que el propio PDF pide.

### Tests

```bash
pnpm web:test        # Vitest: 106 tests de logica y componentes
pnpm web:test:e2e    # Playwright: 5 tests de navegador real
```

⚠️ **Playwright corre contra el BUILD DE PRODUCCIÓN**, que él mismo construye y sirve en el 3002. El
service worker está desactivado en desarrollo, así que probar la PWA contra `next dev` no probaría
nada de lo que esta fase tiene que demostrar.

Necesita la API levantada aparte, y **con el throttler aflojado**, o falla con 429 a mitad de suite
—cada test crea su gimnasio con un login y un auto-registro—:

```bash
cd apps/api && THROTTLE_AUTH_LIMIT=100000 THROTTLE_GENERAL_LIMIT=100000 pnpm start:dev
```

⚠️ Esa API **comparte Redis con los e2e del backend**: no se pueden correr los dos a la vez.

### Trampas propias de esta fase

⚠️ **Instalar paquetes en `apps/web` borra el cliente generado de Prisma.** pnpm reescribe
`node_modules` y se lleva `.prisma/client` por delante; la API deja de compilar con decenas de
`Parameter 'tx' implicitly has an 'any' type`, que no mencionan Prisma por ningún lado. Se arregla
con:

```bash
cd apps/api && pnpm exec dotenv -e ../../.env -- prisma generate
```

⚠️ **Tres paquetes de test están fijados a propósito porque sus últimas versiones ya exigen Node 22**,
y el monorepo está en `>=20 <21`: `vitest@3`, `jsdom@26` y `@vitejs/plugin-react@5`. El de jsdom es el
más desagradable: la 30 arrastra `undici@8` y revienta al cargar con una traza que apunta a
`cachestorage.js` sin mencionar la versión de Node. **Si un paquete de test falla con una traza
incomprensible dentro de `node_modules`, mirá sus `engines` antes de depurar nada.**

⚠️ **La limpieza del DOM entre tests no es automática con Vitest.** Testing Library la engancha sola
solo en modo `globals: true`; aquí se registra a mano en `vitest.setup.ts`. Sin eso, los tests fallan
con "Found multiple elements with the role ..." — y el que falla es el segundo, mientras que el
culpable es el primero.

⚠️ **Si `WEB_ORIGIN` no es EXACTAMENTE el puerto desde el que mirás, el comprobante no sube.** Es el
único paso que cruza de origen, así que es el único que nota el desajuste: servir el build en el 3002
con `WEB_ORIGIN=http://localhost:3001` da un fallo de CORS en el `PUT`. Y el aviso que ve el alumno
dice **"Sin conexion"**, porque eso es literalmente todo lo que el navegador le cuenta al JavaScript
de una petición bloqueada por CORS: un `TypeError`, sin cuerpo ni estado. Si la subida falla sin
motivo aparente, mirá la consola antes que el código.

⚠️ **Cortar la red desde las DevTools NO cambia `navigator.onLine`.** El service worker sirve la
copia cacheada igual, pero el cartel de "Sin conexion" no aparece, porque depende de la propiedad y
del evento `offline`, no de que las peticiones fallen. `setOffline` de Playwright sí los cambia —por
eso el test automático lo ve y una comprobación a mano puede no verlo—. Para probarlo a mano hay que
usar el modo avión del sistema, o el conmutador de red de la propia pestaña.

### Lo que no entra

- **Salirse de la lista de espera desde la pantalla**: `TurnoDisponible` expone `enListaEspera` y
  `posicionEnLista` pero **no el id de la entrada en la cola**, que es lo que pide el endpoint. El
  hook `salirme` está escrito y probado para cuando el contrato lo incluya.
- **El subdominio por gimnasio**, que sería un middleware de reescritura sobre estas mismas rutas.
- **Notificaciones push**: llegan en la Fase 5, con el hook que la 3A dejó preparado e inerte.
- **Cualquier pantalla de administración**: esta aplicación es solo del alumno.


## El profesor — Fase 4

Hasta aquí, el vínculo entre una profesora y un horario era **una parte del nombre de la actividad**:
"Circuito (Fati)". No era una relación; era una cadena de texto que nadie podía filtrar, contar ni
liquidar. Esta fase lo convierte en `Turno.profesorId`, una FK de verdad.

### El horario no crea turnos: los etiqueta

`HorarioProfesorAsignado` es el patrón semanal de una profesora — "lunes 18:00 en Pilates" — y
**nunca genera un turno**. Los turnos siguen naciendo de donde nacían: de las rutinas fijas de los
alumnos y del alta manual del admin. Cuando nace uno, el motor busca si hay una profesora asignada a
esa sala, ese día y esa hora, y le pone el `profesorId`.

⚠️ **Esto no es un detalle de implementación: es lo que hace que la liquidación signifique algo.** Si
el horario creara el turno, toda hora contratada sería automáticamente una hora dictada. Con el
etiquetado, la franja que el gimnasio paga y donde no se anotó nadie queda **contratada y no
dictada**, que es justo el agujero que el relevamiento de TurnoFit encontró.

```
Lunes 18:00 · profesora contratada: Fati · rutinas de alumnos: 2
  -> se crea el turno, con profesorId = Fati

Martes 18:00 · profesora contratada: Fati · rutinas de alumnos: 0
  -> no se crea turno

Liquidacion del mes: contratadas 8 h | dictadas 4 h
```

La pertenencia es **por contención, no por hora exacta**: una profesora contratada de 18:00 a 19:00
se queda también el turno que empieza a las 18:30. Comparar `horaInicio` por igualdad dejaría fuera
el caso corriente de las clases escalonadas.

### El motor solo rellena huecos

Al regenerar un mes, el motor pone profesora **solo en los turnos que no la tienen**. Nunca pisa un
valor puesto.

| Situación | Al republicar el mes |
|---|---|
| Turno con profesora Ana (suplencia), el patrón dice Fati | Sigue Ana |
| Turno sin profesora, el patrón dice Fati | Queda Fati |
| Turno con profesora Fati, el patrón cambió a Ana | Sigue Fati |

No hace falta una columna que marque "lo puso un humano": **tener profesora ya significa que alguien
lo decidió**. Y la regla cubre los dos caminos reales de golpe — la suplencia sobrevive a cualquier
republicación, y dar de alta el horario *después* de publicar el mes rellena los turnos huérfanos.

El precio, aceptado: no se puede expresar "esta franja tiene patrón pero quiero que quede
deliberadamente sin profesora".

### Los dos solapes que rechaza el alta

`POST /horarios-profesor` devuelve **409** en dos casos:

```
Fati, Sala A, lunes 18:00-19:00   (existente)
Ana,  Sala A, lunes 18:30-19:30   -> 409, se pisan en la misma sala
Fati, Sala B, lunes 18:00-19:00   -> 409, no puede estar en dos salas a la vez
Ana,  Sala A, lunes 19:00-20:00   -> OK, son consecutivas
Ana,  Sala A, lunes 18:00, desde octubre (el de Fati termina en septiembre)  -> OK
```

El primero no es purismo: `Turno.profesorId` es uno solo, así que dos horarios que se pisan no se
pueden resolver, y cuál ganara dependería del orden en que Postgres devolviera las filas.

Las dos comprobaciones viven en el servicio y no en un `@@unique`, porque **un índice no sabe de
rangos de fechas que se cruzan**.

### Asignar una profesora exige que tenga acceso a la sala

Tanto `POST /horarios-profesor` como `PATCH /turnos/:id/profesor` devuelven **400** si la profesora
no tiene esa sala asignada. Sin esa puerta acabaría con un turno en una sala que no puede ni ver, y
las dos mitades del sistema dirían cosas distintas sobre la misma clase. Si el admin quiere la
suplencia, primero le da la sala.

### Lo que ve la profesora

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/mis-clases?desde=&hasta=` | Sus clases, con cupo y si ya pasó lista |
| GET | `/mis-clases/:turnoId/alumnos` | Nombre y asistencia. Nada más |
| POST | `/mis-clases/:turnoId/asistencia` | Pasar lista |

El filtro es `profesorId = su perfil` y nada más: el turno es suyo por definición. **El turno de otra
profesora devuelve 404 y no 403** — decir que existe ya sería contar algo de la agenda ajena. Un
admin que llame a `/mis-clases` recibe 404 igual que en `/mi-calendario`: no tiene clases propias.

De cada alumna ve **el nombre y si vino**. Ni teléfono ni ficha médica: desde la Fase 1 la ficha solo
la ve `ADMIN_SALON` o la propia persona, y esta fase no abre esa puerta.

**Pasar lista es una foto del turno entero**, no un incremento:

```
POST /mis-clases/:turnoId/asistencia
  { "presentes": ["perfil-1", "perfil-3"] }

perfil-1 -> asistio = true
perfil-2 -> asistio = false     (no estaba en la lista)
perfil-3 -> asistio = true
```

Así mandar dos veces la misma lista da el mismo resultado, y corregir un error es volver a mandar la
buena. **Las canceladas no se tocan**: quien canceló no faltó. Y un `perfilId` sin reserva activa es
un **400**, no un no-op: un id equivocado marcaría ausente a media clase en silencio.

Solo se puede pasar lista de una clase **que ya empezó**. Hacia atrás no hay límite: quien se olvidó
tres semanas puede ponerse al día, y el rastro queda en `historial_acciones`.

### La liquidación no multiplica

`GET /liquidacion/:profesorId?anio=&mes=` (rol `ADMIN_SALON`, porque enseña tarifas) devuelve una
sola lista de franjas con tres banderas ortogonales:

| `contratada` | `dictada` | `cerrada` | Qué es |
|---|---|---|---|
| sí | sí | no | La clase se dio |
| sí | no | no | **Nadie se anotó** |
| sí | no | sí | Feriado |
| no | sí | — | Suplencia sin contrato en esa franja |

⚠️ **Un día cerrado NO suma a horas contratadas.** Sale aparte, en `horasCerradas`, con su motivo.
Así "contratadas menos dictadas" significa una sola cosa —horas que nadie usó por falta de alumnos—
en vez de mezclar eso con feriados, que no son culpa de nadie y se negocian de otra manera.

**Dictadas cuenta todos sus turnos**, incluidas las suplencias y las clases donde todos cancelaron:
la profesora fue igual.

⚠️ **No hay ni un importe.** El cálculo en pesos —tarifas, ajustes, el "50% base"— es de la Fase 6, y
adelantarlo aquí duplicaría lógica de reportes en dos sitios. Lo que sí viaja es **la tarifa ya
resuelta** por la cascada horario → gimnasio, con su `origenTarifa`, para que la Fase 6 solo tenga
que multiplicar. `minutos` enteros es la verdad; las horas son un string con dos decimales, y la
Fase 6 multiplicará `minutos / 60 × tarifa` en `Decimal` sin pasar por un float.

`origenTarifa: null` no es un error: un gimnasio puede llevar los horarios sin haber cargado tarifas.

### La baja de un horario no reescribe el pasado

`DELETE /horarios-profesor/:id` es **baja lógica**: pone `activo = false` y además cierra `hasta` a
hoy si estaba abierto. Cada cosa sirve para algo distinto — `activo` es lo que filtran los listados y
el etiquetado, y `hasta` es lo que mira la liquidación, que **no filtra por `activo`**. Así, borrar
un horario deja de generar etiquetas de hoy en adelante pero no cambia lo que ya se liquidó en
agosto.


## El ciclo de cobro — Fase 5A

La Fase 5 del PDF se partió en dos, como se partió la 3. El cobro es pequeño y se entrega solo: el
admin gana control del dinero el mismo día. La comunicación —SMTP cifrado, plantillas, cuatro jobs y
push— es donde vive todo el riesgo, y además **depende** de esto: el job de recordatorio necesita
saber quién debe, y eso lo contesta esta mitad.

### "Al día" dejó de ser una columna

Hasta aquí, `Perfil.pagoAlDia` era un booleano que aprobar un comprobante ponía en `true` y **nada
bajaba jamás**. Después del primer pago, todo el mundo quedaba al día para siempre.

Ahora un `Pago` **cubre un periodo**, y estar al día es una pregunta:

```
1 de septiembre: pago que cubre del 01-09 al 30-09  -> al dia
1 de octubre:    ese pago ya no cubre hoy           -> pendiente

Nadie toco nada. Cambio la fecha.
```

Es el mismo criterio que el proyecto viene aplicando desde la Fase 1: el consumo del pack se cuenta
sobre las reservas en vez de guardarse en un contador, y la posición en la lista de espera se deriva
del orden. **Un dato guardado que nadie mantiene acaba mintiendo.**

La columna se borró. El contrato no cambió —`pagoAlDia: boolean` sigue en `UsuarioDetalle` y en
`MiPackPublico`, y la PWA de la 3B no se enteró de nada— y además **se añadió al listado**, porque el
objetivo del PDF es que el admin vea el estado de un vistazo, no abriendo fichas de una en una.

⚠️ **El listado no hace N+1.** `GET /usuarios` resuelve los N alumnos de la página con **una** consulta
a `pagos`; la decisión la sigue tomando la función pura. Hay un test que lo protege: si alguien
cambia a preguntar de uno en uno, falla.

### Qué cuenta como pago válido

Un pago cuenta para "al día" si cumple las tres:

1. **No está anulado.**
2. **No es una seña.** Una seña reserva un lugar, no salda el periodo.
3. **Cubre hoy**, con los dos extremos incluidos.

⚠️ **Lo de la seña no sale del PDF: se decidió en la spec de esta fase.** Si en tu gimnasio una seña
sí cuenta como "está pagando", es una línea en `estado-de-pago.ts`.

⚠️ **El último día del periodo cuenta entero.** `cubreHasta` es `@db.Date` —medianoche UTC— y "hoy"
trae la hora, así que comparar los dos en crudo dejaría fuera todo el último día: justo el día en que
el alumno se acerca a pagar. `estaAlDia` normaliza la fecha antes de comparar, y hay un test cuyo
"hoy" son las 14:30 precisamente para que ese error no pueda colarse.

### Un pago se anula, no se borra

`PATCH /pagos/:id/anular` marca la fila; nunca la elimina. Es dinero, y borrarlo reescribe la caja que
la Fase 6 va a leer. Además cubre el caso feo y real: el admin tecleó 250.000 en vez de 25.000.

Anular pide **`ADMIN_SALON`** y registrar solo `ADMIN_OPERATIVO`: cobrar es operativo, **deshacer un
cobro es contable**.

### Los cinco endpoints

| Método | Ruta | Rol |
|---|---|---|
| POST | `/pagos` | `ADMIN_OPERATIVO` |
| GET | `/pagos?perfilId=&desde=&hasta=` | `ADMIN_OPERATIVO` |
| PATCH | `/pagos/:id/anular` | `ADMIN_SALON` |
| PATCH | `/usuarios/:id/estado-pago` | `ADMIN_OPERATIVO` |
| PATCH | `/comprobantes/:id/aprobar` | `ADMIN_OPERATIVO` |

El rango de `GET /pagos` filtra por **cuándo entró el dinero**, no por el periodo que cubre. Son dos
preguntas distintas y la de la caja es la primera.

`monto` viaja como **string con dos decimales**, nunca como number: es dinero, y un float binario no
representa 25000.10 exactamente. Misma regla que el precio de los packs desde la Fase 1.

### Aprobar un comprobante registra el cobro

```
PATCH /comprobantes/:id/aprobar
  { "monto": "25000.00", "cubreHasta": "2026-09-30", "metodo": "TRANSFERENCIA" }
```

El importe y el periodo los pone **el admin**, que es quien está mirando la foto de la transferencia
y el único que sabe de cuánto era. Deducirlo del precio del pack registraría un número que nadie
verificó, y se equivocaría en todos los casos que existen de verdad: pagos parciales, señas, ajustes
y alumnos que cambiaron de pack desde que subieron la foto.

⚠️ **El pago nace en la MISMA transacción que la aprobación.** Si naciera fuera, un fallo entre las
dos escrituras dejaría un comprobante aprobado sin cobro registrado — y eso no se descubre hasta
cuadrar la caja a fin de mes.

`metodo` es opcional y por defecto `TRANSFERENCIA`. Rechazar sigue sin crear nada.

### La cortesía del admin

`PATCH /usuarios/:id/estado-pago` con `{ alDia: true, cubreHasta, nota }` crea **un pago de importe
cero** con método `CORTESIA`. El gimnasio diciendo "este mes lo doy por pagado".

Todo pasa por la misma tabla, así que hay una sola verdad, y la Fase 6 ve la cortesía explícitamente
en vez de encontrarse un alumno al día que no pagó nada y no poder explicar por qué.

Con `{ alDia: false }` **se anulan las cortesías vigentes y no se toca ningún pago real**: nadie
puede borrar un cobro desde ese endpoint.

### Lo que dejó de funcionar, a propósito

⚠️ **`pagoAlDia` ya no se puede mandar en el alta de un alumno ni en el PATCH de usuario.** Con
`forbidNonWhitelisted` activo, mandarlo devuelve **400**. Es lo correcto: el estado de pago ya no se
declara, se paga.

Y un alumno recién dado de alta queda **pendiente** hasta su primer pago. Antes también: el default
de la columna era `false`.


## Tests

Unitarios:

```bash
pnpm --filter @boxadmin/api test
```

End-to-end: antes de la primera corrida, copia `.env.test.example` a `.env.test`
(este último está en `.gitignore` y no se versiona):

```bash
cp .env.test.example .env.test
pnpm --filter @boxadmin/api test:e2e
```

Sin `.env.test`, `dotenv-cli` no falla si el archivo no existe: sigue adelante sin definir
`NODE_ENV`, y el suite e2e acabaría corriendo (y haciendo `TRUNCATE`) contra la base de
desarrollo en vez de la de pruebas. Si `test:e2e` no encuentra `NODE_ENV=test`, lo primero
a revisar es que `.env.test` exista.

Los e2e usan el Postgres de pruebas, publicado en el puerto **5433** (`postgres-test` en el
compose), con datos en `tmpfs`: el esquema se pierde en cada reinicio del contenedor, así que
el script `pretest:e2e` vuelve a aplicar las migraciones antes de cada corrida.
