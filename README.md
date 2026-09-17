# BoxAdmin

BoxAdmin es un gestor de gimnasios multi-tenant: una misma instalación sirve a varios
gimnasios ("boxes"), cada uno con sus propios usuarios y datos, sin que se mezclen entre sí.

Este repositorio está en **Fase 0: fundamentos**. Todavía no hay lógica de negocio de
gimnasio (clases, reservas, pagos, etc.). Lo que existe es la base sobre la que se construirá
todo lo demás: autenticación, roles, y el mecanismo de aislamiento por tenant que garantiza
que un gimnasio nunca pueda ver ni tocar los datos de otro.

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
