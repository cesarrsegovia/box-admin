# BoxAdmin — Fase 0: Fundamentos (spec de diseño)

**Fuente:** `docs/BoxAdmin_Fase0_Fundamentos.pdf`
**Fecha:** 2026-09-11
**Estado:** aprobada por Cesar

---

## 1. Objetivo

Dejar corriendo el esqueleto completo del proyecto —backend, base de datos, cache, autenticación con roles y aislamiento por tenant— **sin lógica de negocio del gimnasio**. Salas, Turnos, Reservas y Packs son Fase 1.

**Criterio de éxito:** un desarrollador levanta el entorno con un solo comando, crea un tenant, se loguea y recibe un JWT cuyos requests quedan filtrados automáticamente por `tenantId`.

## 2. Decisiones cerradas

Estas ocho decisiones resuelven puntos que el PDF deja abiertos. Fueron acordadas explícitamente y no se reabren:

| # | Tema | Decisión |
|---|------|----------|
| 1 | Bootstrap del primer tenant | Guard `BootstrapKeyGuard` que exige el header `x-bootstrap-key` igual a `BOOTSTRAP_KEY` del `.env`. Protege `POST /auth/tenants` y `POST /auth/register`. No hace falta seed ni SUPERADMIN global. |
| 2 | Entorno de desarrollo | Todo en Docker. Se escribe un `Dockerfile.dev` con hot-reload (el PDF lo referencia pero no lo incluye), de modo que `docker compose up` cumpla el criterio de "un solo comando". |
| 3 | Git | El repo ya existe (`git init` hecho, sin commits). Se crea el `.gitignore`. **Nunca se ejecuta `git add` ni `git commit`** — eso lo hace Cesar. |
| 4 | Testing | TDD en lo crítico (extensión de Prisma, `AsyncLocalStorage`, `RolesGuard`) + e2e completo de auth. Lo trivial (DTOs, módulos) sin test. |
| 5 | Escape del scoping | Helper explícito `runUnscoped()`. Una query sobre un modelo con `tenantId` **sin contexto alguno lanza error** en vez de devolver todo. El escape queda visible y auditable. |
| 6 | Refresh tokens | Rotación con detección de reuso (OWASP): cada refresh revoca el token usado y emite otro; si llega un token ya revocado se revocan **todas** las sesiones de ese usuario. |
| 7 | `packages/shared` | Se crea con tipos reales (`RolUsuario`, jerarquía, `JwtPayload`, contratos de respuesta de auth) consumidos de verdad por `apps/api`, para validar el cableado del workspace desde el día uno. |
| 8 | BD de tests | Servicio `postgres-test` separado en compose (puerto 5433) con su propio `.env.test`. Los e2e nunca tocan los datos de desarrollo. |

## 3. Correcciones al documento original

**3.1 El login necesita el tenant.** El esquema define `@@unique([tenantId, email])`: el email es único *dentro* de un tenant, no globalmente. Dos gimnasios pueden tener el mismo email. Por eso `POST /auth/login` recibe `{ tenantSlug, email, password }`. En Fase 1, cuando exista frontend, el slug puede venir del subdominio sin tocar el servicio.

**3.2 El monorepo va en la raíz.** El PDF dibuja `boxadmin/` como carpeta contenedora. El repo ya es `D:\Dev\box-admin`, así que no se anida una subcarpeta redundante.

**3.3 Orden middleware/guard.** En NestJS los middlewares corren *antes* que los guards, así que cuando `TenantContextMiddleware` necesita el `tenantId` el JWT todavía no ha pasado por Passport. Por eso el middleware verifica la firma él mismo. `JwtAuthGuard` sigue siendo la única autoridad de autenticación; el middleware solo establece contexto y **nunca autoriza**.

**3.4 `findUnique` es incompatible con la inyección de filtro.** Prisma solo acepta campos únicos en el `where` de `findUnique`, así que no se le puede añadir `tenantId`. En vez de reescribir la operación por detrás (frágil), la extensión **lanza un error explícito** si se usa `findUnique`/`findUniqueOrThrow`/`upsert` sobre un modelo con tenant *estando en contexto de tenant*, indicando usar `findFirst`. En modo `unscoped` pasan sin tocar, que es donde el login los necesita con el índice compuesto `tenantId_email`.

## 4. Arquitectura del aislamiento

Tres piezas en `apps/api/src/common/tenant/`:

**`tenant-context.ts`** — un `AsyncLocalStorage` con tres estados posibles: sin contexto, contexto con `tenantId`, o contexto marcado explícitamente como *unscoped*. Expone `runWithTenant(id, fn)`, `runUnscoped(fn)` y `getTenantContext()`.

**`tenant-scoped.extension.ts`** — extensión de Prisma Client que intercepta toda query sobre los modelos con columna `tenantId` (`Usuario`, `HistorialAccion`):

- hay tenant en contexto → inyecta `where: { tenantId }` y rellena `tenantId` en los `create`
- contexto *unscoped* → deja pasar la query sin tocarla
- **no hay contexto** → **lanza `MissingTenantContextError`**

Ese último punto es la diferencia entre una fuga de datos silenciosa y un fallo ruidoso en el primer test. Convierte la "regla dura" del documento en algo verificable por la máquina y no solo disciplina humana.

**`tenant.middleware.ts`** — lee `Authorization: Bearer`, verifica la firma con `JwtService` y abre `runWithTenant(payload.tenantId, next)`. Sin token llama a `next()` sin contexto: las rutas públicas no lo necesitan y las protegidas las rechaza después el guard.

## 5. Superficie de auth

| Método | Ruta | Protección |
|---|---|---|
| POST | `/auth/tenants` | `x-bootstrap-key` |
| POST | `/auth/register` | `x-bootstrap-key` + solo si el tenant aún no tiene usuarios |
| POST | `/auth/login` | público — `{ tenantSlug, email, password }` |
| POST | `/auth/refresh` | público (el refresh token es la credencial) |
| POST | `/auth/logout` | JWT |
| GET | `/auth/me` | JWT |
| GET | `/auth/admin-only` | JWT + `@Roles(ADMIN_SALON)` — endpoint de prueba del checklist |

`JwtAuthGuard` global vía `APP_GUARD` con decorator `@Public()`. Passwords con **argon2id**. Refresh tokens guardados hasheados con argon2.

Las operaciones que preceden al JWT (crear tenant, buscar usuario en login, validar refresh token) van envueltas en `runUnscoped()`.

## 6. Errores

`AllExceptionsFilter` global normaliza las respuestas. Dos reglas de seguridad:

- El login devuelve el mismo error genérico tanto si el email no existe como si la contraseña es incorrecta — no filtra qué emails están registrados.
- `MissingTenantContextError` se registra como error interno (500) sin exponer detalles al cliente.

## 7. Qué NO entra

Ninguna entidad del gimnasio: Salas, Turnos, Reservas, Packs. `HistorialAccion` se crea en el esquema pero no se escribe activamente todavía. Nada de Row Level Security de Postgres. Nada de frontend.
