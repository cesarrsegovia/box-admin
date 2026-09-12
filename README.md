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
