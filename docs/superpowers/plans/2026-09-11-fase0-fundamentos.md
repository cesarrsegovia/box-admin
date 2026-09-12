# BoxAdmin Fase 0 — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar corriendo el esqueleto completo de BoxAdmin —monorepo, Postgres, Redis, NestJS, Prisma, auth JWT con roles y aislamiento por tenant verificado por tests— sin ninguna entidad de negocio del gimnasio.

**Architecture:** Monorepo pnpm con `apps/api` (NestJS) y `packages/shared` (tipos de auth). El aislamiento multi-tenant es row-level y se aplica en código: un `AsyncLocalStorage` guarda el tenant de la request y una extensión de Prisma Client inyecta `where: { tenantId }` en toda query sobre modelos con esa columna, lanzando error si no hay contexto.

**Tech Stack:** Node 20 LTS, pnpm, TypeScript, NestJS 10, Prisma 7 + PostgreSQL 16, Redis 7 + BullMQ, Passport JWT, argon2, Jest + Supertest, Docker Compose v2.

**Nota de versiones.** Nos quedamos en **NestJS 10**, así que sus paquetes acompañantes se fijan a la línea compatible (`@nestjs/config@^3`, `@nestjs/passport@^10`, `@nestjs/jwt@^10`, `@nestjs/bullmq@^10`): instalarlos sin rango trae majors que exigen Nest 11 o 12. Y `prisma` y `@prisma/client` se fijan a la **misma versión exacta**, porque el CLI y el cliente deben moverse siempre juntos — el `latest` del CLI llegó a apuntar a un release candidate mientras el del cliente seguía en estable.

---

## REGLA INVIOLABLE DE ESTE PLAN

**Nunca ejecutes `git add` ni `git commit`.** Los commits los hace únicamente Cesar. Cada tarea termina en un **Punto de commit** con el mensaje sugerido: preséntaselo y espera. El repo ya está inicializado (`master`, sin commits todavía).

---

## Mapa de archivos

```
box-admin/
├── .gitignore                      # T1
├── .env.example / .env / .env.test # T1
├── pnpm-workspace.yaml             # T1
├── package.json                    # T1 — raíz del workspace
├── docker-compose.yml              # T3
├── README.md                       # T14
├── packages/shared/                # T2
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                # re-exports
│       ├── roles.ts                # RolUsuario + jerarquía
│       └── auth.contracts.ts       # JwtPayload + respuestas de auth
└── apps/api/
    ├── Dockerfile.dev              # T3
    ├── prisma/schema.prisma        # T5
    ├── test/
    │   ├── jest-e2e.json           # T13
    │   ├── helpers.ts              # T13 — arranque de la app y limpieza de BD
    │   └── auth.e2e-spec.ts        # T13
    └── src/
        ├── main.ts                 # T4, endurecido en T11
        ├── app.module.ts           # T4, ampliado en T5/T8/T10/T12
        ├── prisma/
        │   ├── prisma.module.ts    # T5
        │   └── prisma.service.ts   # T5 — expone el cliente extendido como `.db`
        ├── common/
        │   ├── tenant/
        │   │   ├── tenant-context.ts               # T6
        │   │   ├── tenant-context.spec.ts          # T6
        │   │   ├── tenant-scoped.extension.ts      # T7
        │   │   ├── tenant-scoped.extension.spec.ts # T7
        │   │   └── tenant.middleware.ts            # T8
        │   ├── decorators/
        │   │   ├── public.decorator.ts             # T9
        │   │   ├── roles.decorator.ts              # T9
        │   │   └── current-user.decorator.ts       # T9
        │   ├── guards/
        │   │   ├── jwt-auth.guard.ts               # T9
        │   │   ├── roles.guard.ts                  # T9
        │   │   ├── roles.guard.spec.ts             # T9
        │   │   └── bootstrap-key.guard.ts          # T9
        │   └── filters/
        │       └── all-exceptions.filter.ts        # T11
        ├── auth/                                   # T10
        │   ├── auth.module.ts
        │   ├── auth.controller.ts
        │   ├── auth.service.ts
        │   ├── strategies/jwt.strategy.ts
        │   └── dto/{create-tenant,register,login,refresh}.dto.ts
        └── jobs/                                   # T12
            ├── jobs.module.ts
            ├── jobs.controller.ts
            └── health-check.processor.ts
```

**Por qué así:** el corazón del sistema (`common/tenant/`) vive aislado en tres archivos pequeños con una responsabilidad cada uno, porque es la única parte donde un bug significa fuga de datos entre gimnasios y conviene poder leerla entera de una sentada. `auth/` agrupa por dominio, no por capa técnica. `packages/shared` contiene solo lo que el futuro frontend necesitará compartir de verdad.

---

### Task 1: Andamiaje del monorepo

**Files:**
- Create: `.gitignore`
- Create: `pnpm-workspace.yaml`
- Create: `package.json`
- Create: `.env.example`
- Create: `.env`
- Create: `.env.test`

- [ ] **Step 1: Verificar Node y activar pnpm**

```bash
node --version
corepack enable
corepack prepare pnpm@latest --activate
pnpm --version
```

Esperado: `node --version` imprime `v20.x.x` y `pnpm --version` imprime 9.x o superior. Si Node no es 20 LTS, para y avisa a Cesar antes de seguir.

- [ ] **Step 2: Crear el `.gitignore`**

```gitignore
node_modules/
dist/
build/
coverage/

.env
.env.test
.env.local
!.env.example

*.log
npm-debug.log*
pnpm-debug.log*

.DS_Store
Thumbs.db

.idea/
.vscode/
```

- [ ] **Step 3: Crear `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 4: Crear el `package.json` de la raíz**

```json
{
  "name": "boxadmin",
  "version": "0.0.0",
  "private": true,
  "packageManager": "pnpm@9.12.0",
  "engines": {
    "node": ">=20 <21"
  },
  "scripts": {
    "api:dev": "pnpm --filter @boxadmin/api start:dev",
    "api:test": "pnpm --filter @boxadmin/api test",
    "api:test:e2e": "pnpm --filter @boxadmin/api test:e2e",
    "shared:build": "pnpm --filter @boxadmin/shared build"
  }
}
```

- [ ] **Step 5: Crear `.env.example`**

```dotenv
DATABASE_URL=postgresql://boxadmin:boxadmin_dev@localhost:5434/boxadmin?schema=public
REDIS_URL=redis://localhost:6379

JWT_SECRET=changeme_dev_secret
JWT_EXPIRES_IN=15m
JWT_REFRESH_SECRET=changeme_dev_refresh_secret
JWT_REFRESH_EXPIRES_IN=30d

BOOTSTRAP_KEY=changeme_bootstrap_key

PORT=3000
NODE_ENV=development
```

Nota: el `JWT_EXPIRES_IN` del PDF era `1d`. Se acorta a `15m` porque ahora hay refresh tokens con rotación; un access token de un día anula el beneficio de rotar.

- [ ] **Step 6: Crear `.env`**

Mismo contenido que `.env.example`. Los valores de desarrollo sirven tal cual; el archivo no se commitea.

- [ ] **Step 7: Crear `.env.test`**

```dotenv
DATABASE_URL=postgresql://boxadmin:boxadmin_dev@localhost:5433/boxadmin_test?schema=public
REDIS_URL=redis://localhost:6379

JWT_SECRET=test_secret
JWT_EXPIRES_IN=15m
JWT_REFRESH_SECRET=test_refresh_secret
JWT_REFRESH_EXPIRES_IN=30d

BOOTSTRAP_KEY=test_bootstrap_key

PORT=3001
NODE_ENV=test
```

El puerto 5433 es el `postgres-test` de la Task 3: contenedor distinto al de desarrollo.

- [ ] **Step 8: Verificar que git ignora lo que debe**

```bash
git status --short
```

Esperado: aparecen `.gitignore`, `package.json`, `pnpm-workspace.yaml`, `.env.example` y `docs/`. **No** deben aparecer `.env` ni `.env.test`. Si aparecen, el `.gitignore` está mal y hay que arreglarlo antes de seguir.

- [ ] **Step 9: Punto de commit**

No ejecutes git. Avisa a Cesar con este mensaje sugerido:

```
chore: andamiaje del monorepo pnpm y variables de entorno
```

---

### Task 2: `packages/shared` con los tipos de auth

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/roles.ts`
- Create: `packages/shared/src/auth.contracts.ts`
- Create: `packages/shared/src/index.ts`

Este paquete se consume de verdad desde `apps/api`, así el cableado del workspace queda validado desde el día uno en vez de descubrirse roto en la Fase 1.

- [ ] **Step 1: Crear `packages/shared/package.json`**

```json
{
  "name": "@boxadmin/shared",
  "version": "0.0.0",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsc -p tsconfig.json --watch"
  },
  "devDependencies": {
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2: Crear `packages/shared/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Crear `packages/shared/src/roles.ts`**

```ts
export const ROLES_USUARIO = [
  'SUPERADMIN',
  'ADMIN_SALON',
  'ADMIN_OPERATIVO',
  'PROFESOR',
  'ALUMNO',
  'FANTASMA',
] as const;

export type RolUsuario = (typeof ROLES_USUARIO)[number];

/**
 * Roles que pueden exigirse como mínimo en una ruta. FANTASMA queda fuera a
 * propósito: es un rol técnico, no un nivel de permiso, y admitirlo como umbral
 * abriría la ruta a todo el mundo porque su rango es 0.
 */
export type RolAsignable = Exclude<RolUsuario, 'FANTASMA'>;

/**
 * Jerarquía de roles: un número mayor incluye los permisos de los menores.
 * FANTASMA es un rol técnico (usuario placeholder que nunca se loguea), por eso
 * queda fuera de la escala con rango 0.
 */
export const JERARQUIA_ROLES: Record<RolUsuario, number> = {
  SUPERADMIN: 50,
  ADMIN_SALON: 40,
  ADMIN_OPERATIVO: 30,
  PROFESOR: 20,
  ALUMNO: 10,
  FANTASMA: 0,
};

/** ¿`rol` alcanza el nivel de `minimo`? */
export function rolAlcanza(rol: RolUsuario, minimo: RolAsignable): boolean {
  if (rol === 'FANTASMA' || (minimo as RolUsuario) === 'FANTASMA') return false;
  return JERARQUIA_ROLES[rol] >= JERARQUIA_ROLES[minimo];
}
```

Las dos capas contra FANTASMA son deliberadas. El tipo impide escribir `@Roles('FANTASMA')`, y la comprobación en ejecución cubre a un consumidor en JavaScript plano que se salte los tipos. Sin ellas la función falla **en abierto**: como el rango de FANTASMA es 0 y todos los demás son ≥ 0, exigir FANTASMA como mínimo dejaría pasar a cualquiera.

- [ ] **Step 4: Crear `packages/shared/src/auth.contracts.ts`**

```ts
import type { RolUsuario } from './roles';

/** Payload firmado en el access token. */
export interface JwtPayload {
  sub: string;
  tenantId: string;
  rol: RolUsuario;
  iat?: number;
  exp?: number;
}

/** Usuario tal como lo ve el cliente. Nunca incluye passwordHash. */
export interface UsuarioPublico {
  id: string;
  tenantId: string;
  nombreCompleto: string;
  email: string;
  rol: RolUsuario;
  activo: boolean;
}

export interface TenantPublico {
  id: string;
  nombre: string;
  slug: string;
  activo: boolean;
}

export interface TokensRespuesta {
  accessToken: string;
  refreshToken: string;
}

export interface LoginRespuesta extends TokensRespuesta {
  usuario: UsuarioPublico;
}
```

- [ ] **Step 5: Crear `packages/shared/src/index.ts`**

```ts
export * from './roles';
export * from './auth.contracts';
```

- [ ] **Step 6: Instalar y compilar**

```bash
pnpm install
pnpm --filter @boxadmin/shared build
ls packages/shared/dist
```

Esperado: `pnpm install` termina sin errores y `ls` muestra `index.js`, `index.d.ts`, `roles.js`, `roles.d.ts`, `auth.contracts.js`, `auth.contracts.d.ts`.

- [ ] **Step 7: Punto de commit**

No ejecutes git. Mensaje sugerido para Cesar:

```
feat(shared): tipos de roles y contratos de auth compartidos
```

---

### Task 3: Infraestructura Docker

**Files:**
- Create: `docker-compose.yml`
- Create: `apps/api/Dockerfile.dev`

El PDF referencia un `build` para la API pero no incluye el Dockerfile. Aquí se escribe, con hot-reload, para que `docker compose up` cumpla de verdad el criterio de "un solo comando".

- [ ] **Step 1: Crear `docker-compose.yml` en la raíz**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: boxadmin
      POSTGRES_PASSWORD: boxadmin_dev
      POSTGRES_DB: boxadmin
    ports:
      - "5434:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U boxadmin -d boxadmin"]
      interval: 5s
      timeout: 5s
      retries: 10

  postgres-test:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: boxadmin
      POSTGRES_PASSWORD: boxadmin_dev
      POSTGRES_DB: boxadmin_test
    ports:
      - "5433:5432"
    tmpfs:
      - /var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U boxadmin -d boxadmin_test"]
      interval: 5s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 10

  api:
    build:
      context: .
      dockerfile: ./apps/api/Dockerfile.dev
    env_file: .env
    environment:
      DATABASE_URL: postgresql://boxadmin:boxadmin_dev@postgres:5432/boxadmin?schema=public
      REDIS_URL: redis://redis:6379
    ports:
      - "3000:3000"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    volumes:
      - ./apps/api:/repo/apps/api
      - ./packages/shared:/repo/packages/shared
      - /repo/node_modules
      - /repo/apps/api/node_modules
      - /repo/packages/shared/node_modules

volumes:
  pgdata:
```

Tres diferencias deliberadas respecto al PDF, todas necesarias:

1. **`context: .`** en vez de `./apps/api`: el build necesita ver `packages/shared`, que vive fuera de `apps/api`.
2. **`DATABASE_URL` y `REDIS_URL` sobrescritos:** dentro de Docker los hosts son `postgres` y `redis`, no `localhost`. El `.env` usa `localhost` porque también sirve para correr comandos desde la máquina anfitriona.
3. **`postgres-test` con `tmpfs`:** la BD de tests vive en memoria, arranca limpia siempre y no deja volumen que limpiar. Ojo: tanto `docker compose down` como un simple `docker compose restart` la vacían, así que los e2e deben correr `prisma migrate deploy` de forma incondicional antes de cada tanda (la Task 13 lo hace con un `pretest:e2e`).
4. **`postgres` publicado en el 5434, no en el 5432.** Esta máquina tiene un PostgreSQL 18 nativo de Windows ocupando el 5432: los comandos lanzados desde el anfitrión (las migraciones de Prisma) acabarían en el Postgres nativo en vez de en el contenedor, con un error de autenticación desconcertante. El puerto *interno* sigue siendo 5432 y el servicio `api` sigue hablando por la red de Docker, así que este cambio solo afecta al `DATABASE_URL` del `.env`, que apunta a `localhost:5434`.

- [ ] **Step 2: Crear `apps/api/Dockerfile.dev`**

```dockerfile
FROM node:20-alpine

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

WORKDIR /repo

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/

RUN pnpm install --frozen-lockfile

COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

RUN pnpm --filter @boxadmin/shared build
RUN pnpm --filter @boxadmin/api exec prisma generate

WORKDIR /repo/apps/api

EXPOSE 3000

CMD ["pnpm", "start:dev"]
```

Los `COPY` de los `package.json` van antes que el código para que Docker cachee la capa de `pnpm install` y no reinstale dependencias en cada cambio de código.

Dos detalles que parecen menores y no lo son, ambos descubiertos al construir la imagen de verdad:

- **Copia el `pnpm-lock.yaml` y usa `--frozen-lockfile`.** Sin el lockfile, `pnpm install` resuelve el árbol desde cero dentro del contenedor y puede dar una resolución distinta a la probada en el anfitrión. Con Prisma 7 eso producía un symlink roto hacia `prisma/build/index.js` y el build moría.
- **Hace falta un `.dockerignore` en la raíz** (ver el paso siguiente). Sin él, `COPY apps/api ./apps/api` arrastra el `node_modules` del anfitrión dentro de la imagen y pisa el que acaba de instalar el paso anterior. Los symlinks de pnpm son rutas absolutas de Windows que dentro de un contenedor Linux no significan nada, y `prisma generate` fallaba con `Cannot find module 'prisma/config'`.

- [ ] **Step 2b: Crear `.dockerignore` en la raíz**

```
node_modules
dist
.git
docs
.env
.env.test
```

Vigila esto si en el futuro se añaden más `COPY` de directorios: es el mismo patrón el que vuelve a morder.

- [ ] **Step 3: Levantar solo la infraestructura y verificarla**

La API todavía no existe, así que se levantan únicamente los servicios de datos:

```bash
docker compose up -d postgres postgres-test redis
docker compose ps
```

Esperado: los tres servicios en estado `running` y `healthy`.

- [ ] **Step 4: Comprobar conectividad real**

```bash
docker compose exec postgres psql -U boxadmin -d boxadmin -c "SELECT 1;"
docker compose exec postgres-test psql -U boxadmin -d boxadmin_test -c "SELECT 1;"
docker compose exec redis redis-cli ping
```

Esperado: las dos consultas devuelven una fila con `1`, y Redis responde `PONG`.

- [ ] **Step 5: Punto de commit**

No ejecutes git. Mensaje sugerido para Cesar:

```
chore(infra): docker compose con postgres, postgres-test, redis y Dockerfile de desarrollo
```

---

### Task 4: Bootstrap de NestJS y dependencias

**Files:**
- Create: `apps/api/` (generado por el CLI de Nest)
- Modify: `apps/api/package.json`
- Modify: `apps/api/tsconfig.json`

- [ ] **Step 1: Generar el proyecto NestJS**

```bash
mkdir -p apps/api
cd apps/api
pnpm dlx @nestjs/cli@10 new . --package-manager pnpm --skip-git --skip-install
cd ../..
```

Esperado: se crean `apps/api/src/main.ts`, `apps/api/src/app.module.ts`, `apps/api/nest-cli.json`, `apps/api/tsconfig.json`. Si el CLI pregunta por sobrescribir el directorio, acepta.

- [ ] **Step 2: Renombrar el paquete y añadir el script de e2e**

En `apps/api/package.json`, cambia el campo `name` y añade `test:e2e`. El bloque resultante debe contener:

```json
{
  "name": "@boxadmin/api",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "build": "nest build",
    "start": "nest start",
    "prestart:dev": "pnpm --filter @boxadmin/shared build",
    "start:dev": "nest start --watch",
    "start:prod": "node dist/main",
    "lint": "eslint \"{src,test}/**/*.ts\" --fix",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:e2e": "jest --config ./test/jest-e2e.json --runInBand",
    "db:generate": "dotenv -e ../../.env -- prisma generate",
    "db:migrate": "dotenv -e ../../.env -- prisma migrate dev",
    "db:deploy": "dotenv -e ../../.env -- prisma migrate deploy",
    "db:studio": "dotenv -e ../../.env -- prisma studio"
  }
}
```

Los cuatro scripts `db:*` no son azúcar: **el `.env` vive en la raíz del monorepo y el CLI de Prisma no sube a buscarlo** — solo mira junto al `schema.prisma` y en el directorio desde el que se invoca, que aquí es `apps/api`. Sin envolverlos en `dotenv-cli`, `prisma migrate` no vería `DATABASE_URL` y fallaría. Requiere instalar la herramienta:

```bash
pnpm --filter @boxadmin/api add -D dotenv-cli
```

Conserva el resto de campos que generó el CLI (`jest`, `dependencies`, `devDependencies`), y dentro del bloque `jest` añade el mapeo del paquete compartido:

```json
{
  "jest": {
    "moduleNameMapper": {
      "^@boxadmin/shared$": "<rootDir>/../../../packages/shared/src/index.ts"
    }
  }
}
```

Sin ese mapeo, los tests unitarios de `RolesGuard` (Task 9) resolverían `@boxadmin/shared` contra su `dist` y fallarían cada vez que el paquete no estuviera recompilado. El `rootDir` que pone el CLI es `src`, de ahí los tres niveles.

**Activa además el modo estricto de TypeScript.** La plantilla del CLI de Nest viene con `strictNullChecks: false` y `noImplicitAny: false`, lo que significa que un `tenantId` o un `req.user` posiblemente `undefined` no daría error de compilación — justo el tipo de descuido que en las Tasks 7 y 10 se traduce en una fuga de datos entre gimnasios. Este es el momento más barato para activarlo, con solo el andamiaje generado. En `apps/api/tsconfig.json`, **elimina** `strictNullChecks`, `noImplicitAny` y `strictBindCallApply`, y deja:

```json
{
  "compilerOptions": {
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

(conservando el resto de opciones que puso el CLI). `strictPropertyInitialization` se queda activo: los DTOs de la Task 10 ya usan asignación definida (`nombre!: string`), así que no estorba y es una red más. Verifica que sigue compilando:

```bash
pnpm --filter @boxadmin/api exec tsc --noEmit -p tsconfig.json
```

Esperado: sin errores.

- [ ] **Step 3: Instalar las dependencias de dominio**

El CLI se ejecutó con `--skip-install`, así que primero hay que instalar lo que generó y después añadir lo de la Fase 0:

```bash
pnpm install
pnpm --filter @boxadmin/api add @nestjs/config@^3 @nestjs/jwt@^10 @nestjs/passport@^10 passport passport-jwt
pnpm --filter @boxadmin/api add @prisma/client@7.10.0 argon2 class-validator class-transformer
pnpm --filter @boxadmin/api add @nestjs/bullmq@^10 bullmq ioredis
pnpm --filter @boxadmin/api add helmet compression
pnpm --filter @boxadmin/api add @boxadmin/shared@workspace:*
pnpm --filter @boxadmin/api add -D prisma@7.10.0 @types/passport-jwt @types/compression
```

El PDF pide explícitamente **argon2**, no bcrypt ni bcryptjs.

Los rangos de los paquetes de Nest están fijados a propósito: sin ellos pnpm instala majors que exigen Nest 11 o 12, y este proyecto es Nest 10. `prisma` y `@prisma/client` van a la **misma versión exacta**, sin `^`, porque el CLI y el cliente deben moverse juntos; el `latest` del CLI llegó a apuntar a un release candidate mientras el del cliente seguía en estable.

Comprueba que quedaron alineados antes de seguir:

```bash
pnpm --filter @boxadmin/api exec prisma --version
```

Esperado: el CLI y `@prisma/client` muestran la misma versión mayor. Si difieren, el `prisma migrate` de la Task 5 fallará de forma confusa.

- [ ] **Step 4: Verificar que `@boxadmin/shared` se resuelve desde la API**

Crea temporalmente `apps/api/src/check-shared.ts`:

```ts
import { JERARQUIA_ROLES } from '@boxadmin/shared';

console.log(JERARQUIA_ROLES.ADMIN_SALON);
```

Y ejecuta:

```bash
pnpm --filter @boxadmin/api exec tsc --noEmit -p tsconfig.json
```

Esperado: compila sin errores. Si TypeScript no encuentra `@boxadmin/shared`, falta el build del paquete: corre `pnpm --filter @boxadmin/shared build` y repite.

- [ ] **Step 5: Borrar el archivo de comprobación**

```bash
rm apps/api/src/check-shared.ts
```

- [ ] **Step 6: Arrancar la API y comprobar que responde**

```bash
pnpm --filter @boxadmin/api start:dev
```

En otra terminal:

```bash
curl -i http://localhost:3000
```

Esperado: `HTTP/1.1 200 OK` y el cuerpo `Hello World!`. Después para el proceso con Ctrl+C.

- [ ] **Step 7: Punto de commit**

No ejecutes git. Mensaje sugerido para Cesar:

```
feat(api): bootstrap de NestJS con las dependencias de la Fase 0
```

---

### Task 5: Esquema Prisma, migración y `PrismaService`

**Files:**
- Create: `apps/api/prisma/schema.prisma`
- Create: `apps/api/src/prisma/prisma.service.ts`
- Create: `apps/api/src/prisma/prisma.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Crear `apps/api/prisma/schema.prisma`**

Es el esquema del PDF, literal:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
}

enum RolUsuario {
  SUPERADMIN
  ADMIN_SALON
  ADMIN_OPERATIVO
  PROFESOR
  ALUMNO
  FANTASMA
}

model Tenant {
  id        String   @id @default(cuid())
  nombre    String
  slug      String   @unique
  activo    Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  usuarios Usuario[]

  @@map("tenants")
}

model Usuario {
  id             String     @id @default(cuid())
  tenantId       String
  tenant         Tenant     @relation(fields: [tenantId], references: [id])
  nombreCompleto String
  email          String
  passwordHash   String
  rol            RolUsuario
  activo         Boolean    @default(true)
  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt

  refreshTokens RefreshToken[]

  // Un email es único DENTRO de un tenant, no globalmente
  @@unique([tenantId, email])
  @@index([tenantId])
  @@map("usuarios")
}

model RefreshToken {
  id        String    @id @default(cuid())
  usuarioId String
  usuario   Usuario   @relation(fields: [usuarioId], references: [id], onDelete: Cascade)
  tokenHash String
  expiresAt DateTime
  revokedAt DateTime?
  createdAt DateTime  @default(now())

  @@index([usuarioId])
  @@map("refresh_tokens")
}

model HistorialAccion {
  id        String   @id @default(cuid())
  tenantId  String
  usuarioId String?
  entidad   String
  entidadId String
  accion    String
  detalle   Json?
  createdAt DateTime @default(now())

  @@index([tenantId, entidad, entidadId])
  @@map("historial_acciones")
}
```

`HistorialAccion` no se usa todavía, pero se crea ahora a propósito: todas las fases siguientes escriben ahí y diseñarlo como añadido tardío sale mucho más caro.

**Ojo con el `datasource`:** Prisma 7 rechaza `url = env("DATABASE_URL")` dentro del schema (error P1012) y exige que la URL de conexión viva en la configuración. Por eso el bloque solo declara el `provider`, y la URL va en un archivo aparte.

- [ ] **Step 1b: Crear `apps/api/prisma.config.ts`**

```ts
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env['DATABASE_URL'] },
});
```

No hace falta cargar dotenv aquí: los scripts `db:*` de la Task 4 ya inyectan el `.env` de la raíz con `dotenv-cli` antes de que arranque el proceso que evalúa este archivo. Y `prisma generate` no necesita la URL, así que el build de Docker —que corre sin `.env`— sigue funcionando aunque quede `undefined`.

Este archivo vive en la raíz del paquete, no en `src/`, así que **hay que excluirlo del build** o `nest build` ensancha el `rootDir` y desplaza toda la salida a `dist/src/`, dejando roto el `node dist/main` de `start:prod`. En `apps/api/tsconfig.build.json`, añade `"prisma.config.ts"` al array `exclude`.

- [ ] **Step 2: Generar y aplicar la migración inicial**

Con los contenedores de la Task 3 levantados:

```bash
pnpm --filter @boxadmin/api exec dotenv -e ../../.env -- prisma migrate dev --name init
```

Esperado: se crea `apps/api/prisma/migrations/<timestamp>_init/migration.sql` y el CLI imprime `Your database is now in sync with your schema` seguido de `Generated Prisma Client`.

- [ ] **Step 3: Verificar las tablas en la base de datos**

```bash
docker compose exec postgres psql -U boxadmin -d boxadmin -c "\dt"
```

Esperado: aparecen `tenants`, `usuarios`, `refresh_tokens`, `historial_acciones` y `_prisma_migrations`.

- [ ] **Step 4: Crear `apps/api/src/prisma/prisma.service.ts`**

El cliente extendido se expone como `.db`. La extensión todavía no existe (Task 7); de momento el servicio envuelve al cliente crudo y en la Task 7 se conecta la extensión.

```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  /** Cliente base, sin extender. Solo para conectar, desconectar y limpieza en tests. */
  readonly base: PrismaClient;

  /** Cliente que debe usar TODO el código de aplicación. */
  readonly db: PrismaClient;

  constructor(config: ConfigService) {
    const connectionString = config.getOrThrow<string>('DATABASE_URL');

    this.base = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    this.db = this.base;
  }

  async onModuleInit(): Promise<void> {
    await this.base.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.base.$disconnect();
  }
}
```

Dos cosas aquí no son decorativas. Prisma 7 ya no acepta `new PrismaClient()` a secas: exige un **driver adapter** explícito, así que hay que instalar `@prisma/adapter-pg` y `pg` como dependencias de runtime:

```bash
pnpm --filter @boxadmin/api add @prisma/adapter-pg pg
```

Y la URL se pide con `getOrThrow` en vez de leer `process.env` directamente porque, si falta, el driver `pg` **no falla**: cae a sus defaults (`localhost:5432`, usuario del sistema, sin contraseña) e intenta conectar a lo que haya ahí. Ni el adapter ni `$connect()` protestan; el error asoma mucho después, en la primera query, como `SASL: client password must be a string`, que no menciona `DATABASE_URL` por ningún lado. En otra máquina podría incluso conectar con éxito a una base equivocada. Con `getOrThrow` falla en el arranque y diciendo qué falta.

- [ ] **Step 5: Crear `apps/api/src/prisma/prisma.module.ts`**

```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

- [ ] **Step 6: Cablear config y Prisma en `apps/api/src/app.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [`../../.env.${process.env.NODE_ENV ?? 'development'}`, '../../.env'],
    }),
    PrismaModule,
  ],
})
export class AppModule {}
```

El `.env` vive en la raíz del monorepo, dos niveles por encima de `apps/api`. Se eliminan `AppController` y `AppService` del módulo: no aportan nada y el `GET /` deja de existir.

- [ ] **Step 7: Borrar los archivos de ejemplo del CLI**

```bash
rm apps/api/src/app.controller.ts apps/api/src/app.service.ts apps/api/src/app.controller.spec.ts
```

- [ ] **Step 8: Comprobar que la app arranca con Prisma conectado**

```bash
pnpm --filter @boxadmin/api start:dev
```

Esperado: el log muestra `Nest application successfully started` sin errores de conexión a Postgres. Para con Ctrl+C.

- [ ] **Step 9: Punto de commit**

No ejecutes git. Mensaje sugerido para Cesar:

```
feat(api): esquema Prisma de la Fase 0, migración inicial y PrismaService
```

---

### Task 6: Contexto de tenant (`AsyncLocalStorage`)

**Files:**
- Create: `apps/api/src/common/tenant/tenant-context.ts`
- Test: `apps/api/src/common/tenant/tenant-context.spec.ts`

Esta es la primera pieza crítica: TDD estricto a partir de aquí.

Tres estados posibles y no dos. "Sin contexto" tiene que ser distinguible de "contexto sin tenant a propósito", porque el primero es un bug y el segundo es una decisión deliberada del programador.

- [ ] **Step 1: Escribir el test que falla**

`apps/api/src/common/tenant/tenant-context.spec.ts`:

```ts
import {
  getTenantContext,
  runUnscoped,
  runWithTenant,
} from './tenant-context';

describe('tenant-context', () => {
  it('no hay contexto fuera de runWithTenant/runUnscoped', () => {
    expect(getTenantContext()).toBeUndefined();
  });

  it('runWithTenant expone el tenantId dentro del callback', () => {
    const resultado = runWithTenant('tenant-a', () => getTenantContext());

    expect(resultado).toEqual({ kind: 'tenant', tenantId: 'tenant-a' });
  });

  it('runUnscoped marca el contexto como explícitamente sin tenant', () => {
    const resultado = runUnscoped(() => getTenantContext());

    expect(resultado).toEqual({ kind: 'unscoped' });
  });

  it('el contexto no sobrevive al callback', () => {
    runWithTenant('tenant-a', () => getTenantContext());

    expect(getTenantContext()).toBeUndefined();
  });

  it('runUnscoped anidado dentro de runWithTenant gana en su ámbito', () => {
    const visto = runWithTenant('tenant-a', () => ({
      dentro: runUnscoped(() => getTenantContext()),
      despues: getTenantContext(),
    }));

    expect(visto.dentro).toEqual({ kind: 'unscoped' });
    expect(visto.despues).toEqual({ kind: 'tenant', tenantId: 'tenant-a' });
  });

  // NO TOQUES ESTE TEST A LA LIGERA. Una prueba de mutación lo confirmó: si se
  // sustituye el AsyncLocalStorage por una variable de módulo con guardar/restaurar
  // —el error razonable de quien no conoce ALS— los otros cinco tests siguen pasando
  // y solo falla este. Es el único centinela contra una fuga de contexto entre
  // requests concurrentes de gimnasios distintos.
  it('dos flujos asíncronos concurrentes no se pisan el contexto', async () => {
    const flujo = (tenantId: string, esperaMs: number) =>
      runWithTenant(tenantId, async () => {
        await new Promise((r) => setTimeout(r, esperaMs));
        return getTenantContext();
      });

    const [a, b] = await Promise.all([flujo('tenant-a', 20), flujo('tenant-b', 5)]);

    expect(a).toEqual({ kind: 'tenant', tenantId: 'tenant-a' });
    expect(b).toEqual({ kind: 'tenant', tenantId: 'tenant-b' });
  });
});
```

El último test es el que de verdad importa: si el contexto se guardara en una variable de módulo en vez de en un `AsyncLocalStorage`, dos requests simultáneas de gimnasios distintos se pisarían y el test lo detecta.

- [ ] **Step 2: Ejecutar el test para verificar que falla**

```bash
pnpm --filter @boxadmin/api test -- tenant-context
```

Esperado: FAIL con `Cannot find module './tenant-context'`.

- [ ] **Step 3: Implementación mínima**

`apps/api/src/common/tenant/tenant-context.ts`:

```ts
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Contexto de tenant de la request actual.
 * - `tenant`: hay un gimnasio activo, toda query se filtra por él.
 * - `unscoped`: se decidió explícitamente operar fuera de cualquier tenant.
 * La ausencia de contexto (undefined) NO es un tercer modo válido: es un bug,
 * y la extensión de Prisma lo trata como error.
 */
export type TenantContext =
  | { kind: 'tenant'; tenantId: string }
  | { kind: 'unscoped' };

const storage = new AsyncLocalStorage<TenantContext>();

export class TenantIdInvalidoError extends Error {
  constructor(recibido: unknown) {
    super(
      'runWithTenant exige un tenantId que sea una cadena no vacia. Un tenantId vacio o ' +
        'undefined produce where: { tenantId: undefined }, que Prisma interpreta como ' +
        '"sin filtro" y devolveria las filas de todos los gimnasios.',
    );
    this.name = 'TenantIdInvalidoError';
  }
}

/** Ejecuta `fn` con todas las queries filtradas por `tenantId`. */
export function runWithTenant<T>(tenantId: string, fn: () => T): T {
  // La validacion no es defensiva por gusto: en Prisma `where: { tenantId: undefined }`
  // significa "ignora este filtro", no "compara con undefined" (a diferencia de null).
  // Un contexto envenenado con undefined devolveria las filas de todos los gimnasios
  // sin lanzar nada. Se valida aqui, no solo en el middleware, para cerrarlo a todos
  // los llamadores.
  if (typeof tenantId !== 'string' || tenantId.length === 0) {
    throw new TenantIdInvalidoError(tenantId);
  }

  return storage.run({ kind: 'tenant', tenantId }, fn);
}

/**
 * Ejecuta `fn` sin filtro de tenant. Es la única vía legítima de salir del
 * aislamiento: crear un tenant, buscar al usuario en el login antes de que
 * exista JWT, validar un refresh token. Debe quedar visible en el código.
 */
export function runUnscoped<T>(fn: () => T): T {
  return storage.run({ kind: 'unscoped' }, fn);
}

export function getTenantContext(): TenantContext | undefined {
  return storage.getStore();
}
```

- [ ] **Step 4: Ejecutar los tests y verificar que pasan**

```bash
pnpm --filter @boxadmin/api test -- tenant-context
```

Esperado: PASS, 6 tests.

- [ ] **Step 5: Punto de commit**

No ejecutes git. Mensaje sugerido para Cesar:

```
feat(api): contexto de tenant con AsyncLocalStorage y escape explícito
```

---

### Task 7: Extensión de Prisma con scoping por tenant

> ## ⚠️ ENMIENDA (2026-09-11, tras auditoría)
>
> **El código del Step 3 de esta tarea quedó obsoleto.** Una auditoría contra base de datos real demostró cinco agujeros en ese diseño, dos de ellos fugas entre gimnasios. La implementación real en `apps/api/src/common/tenant/tenant-scoped.extension.ts` es la fuente de verdad; léela antes de tocar nada. Resumen de lo que cambió:
>
> 1. **Los modelos se clasifican en tres categorías y un modelo sin clasificar rompe la build.** `MODELOS_CON_TENANT` (columna `tenantId` propia: `Usuario`, `HistorialAccion`), `MODELOS_POR_RELACION` (`RefreshToken` → relación `usuario`) y `MODELOS_GLOBALES` (`Tenant`). Antes `Tenant` y `RefreshToken` pasaban libres: `tenant.findMany({include:{usuarios:true}})` devolvía los usuarios de todos los gimnasios, y `refreshToken.findMany({})` los tokens de todos sin exigir contexto siquiera.
> 2. **Todas las categorías exigen contexto.** Por relación se inyecta `where.usuario.tenantId`; en los globales se fuerza `where.id = tenantId`, lo que neutraliza el `include` anidado.
> 3. **Se prohíbe reasignar el tenant.** `update`/`updateMany`/`updateManyAndReturn` cuyo `data` traiga `tenantId` o `tenant` lanzan `ReasignacionDeTenantError`. Sin esto se demostró un secuestro completo: crear un usuario en A con contraseña conocida, moverlo a B con `data:{tenantId:B}` y quedar como ADMIN_SALON dentro de B.
> 4. **Fail-closed por defecto.** El `return args` final se sustituyó por `OperacionNoSoportadaError`. Una mutación que borraba `updateMany` de la lista no la cazaba ningún test y era una fuga real.
> 5. **Las consultas raw se cortan en contexto de gimnasio.** Un `$allOperations` de primer nivel (fuera de `$allModels`) intercepta `$queryRaw`/`$executeRaw` y sus variantes `Unsafe` y lanza `RawQueryEnTenantError`; dentro de `runUnscoped()` siguen funcionando. `$transaction` no pasa por ahí, así que las transacciones no se ven afectadas.
> 6. **Un test compara las listas contra `Prisma.dmmf`**, de modo que un modelo nuevo en la Fase 1 que nadie clasifique hace fallar la suite.
>
> La creación de filas en categorías por relación y globales lanza `CreacionNoPermitidaError`: exige `runUnscoped()` explícito. El spec pasó de 15 a 83 tests (89 con los de `tenant-context`).

**Files:**
- Create: `apps/api/src/common/tenant/tenant-scoped.extension.ts`
- Test: `apps/api/src/common/tenant/tenant-scoped.extension.spec.ts`
- Modify: `apps/api/src/prisma/prisma.service.ts`

La pieza más importante del proyecto. Un fallo aquí es una fuga de datos entre gimnasios.

**Decisión de diseño sobre `findUnique`:** Prisma solo acepta campos únicos en el `where` de `findUnique`, así que no se le puede añadir `tenantId`. En vez de reescribir la operación por detrás (frágil y difícil de razonar), la extensión **lanza un error explícito** si se usa `findUnique`, `findUniqueOrThrow` o `upsert` sobre un modelo con tenant estando en contexto de tenant, indicando usar `findFirst`. En modo `unscoped` pasan sin tocarse, que es justo donde el login las necesita con el índice compuesto `tenantId_email`.

- [ ] **Step 1: Escribir el test que falla**

`apps/api/src/common/tenant/tenant-scoped.extension.spec.ts`:

```ts
import { runUnscoped, runWithTenant } from './tenant-context';
import {
  MissingTenantContextError,
  UnsafeUniqueOperationError,
  aplicarScopeDeTenant,
} from './tenant-scoped.extension';

describe('aplicarScopeDeTenant', () => {
  describe('modelos sin columna tenantId', () => {
    it('deja pasar la query aunque no haya contexto', () => {
      const args = { where: { slug: 'gimnasio-a' } };

      expect(aplicarScopeDeTenant('Tenant', 'findFirst', args)).toEqual(args);
    });

    it('deja pasar RefreshToken sin tocar', () => {
      const args = { where: { tokenHash: 'abc' } };

      expect(aplicarScopeDeTenant('RefreshToken', 'findFirst', args)).toEqual(args);
    });
  });

  describe('sin contexto', () => {
    it('lanza MissingTenantContextError en una lectura', () => {
      expect(() => aplicarScopeDeTenant('Usuario', 'findMany', {})).toThrow(
        MissingTenantContextError,
      );
    });

    it('lanza MissingTenantContextError en una escritura', () => {
      expect(() =>
        aplicarScopeDeTenant('Usuario', 'create', { data: { email: 'a@b.c' } }),
      ).toThrow(MissingTenantContextError);
    });
  });

  describe('en contexto unscoped', () => {
    it('deja la query intacta', () => {
      const args = { where: { email: 'a@b.c' } };

      expect(runUnscoped(() => aplicarScopeDeTenant('Usuario', 'findFirst', args))).toEqual(
        args,
      );
    });

    it('permite findUnique con el índice compuesto', () => {
      const args = { where: { tenantId_email: { tenantId: 't1', email: 'a@b.c' } } };

      expect(
        runUnscoped(() => aplicarScopeDeTenant('Usuario', 'findUnique', args)),
      ).toEqual(args);
    });
  });

  describe('en contexto de tenant', () => {
    it('inyecta el filtro en una query sin where', () => {
      const resultado = runWithTenant('t1', () =>
        aplicarScopeDeTenant('Usuario', 'findMany', {}),
      );

      expect(resultado).toEqual({ where: { tenantId: 't1' } });
    });

    it('conserva el where existente y añade el tenant', () => {
      const resultado = runWithTenant('t1', () =>
        aplicarScopeDeTenant('Usuario', 'findFirst', { where: { email: 'a@b.c' } }),
      );

      expect(resultado).toEqual({ where: { email: 'a@b.c', tenantId: 't1' } });
    });

    it('ignora un tenantId pasado a mano y usa siempre el del contexto', () => {
      const resultado = runWithTenant('t1', () =>
        aplicarScopeDeTenant('Usuario', 'findMany', { where: { tenantId: 't2' } }),
      );

      expect(resultado).toEqual({ where: { tenantId: 't1' } });
    });

    it('rellena el tenantId en un create', () => {
      const resultado = runWithTenant('t1', () =>
        aplicarScopeDeTenant('Usuario', 'create', { data: { email: 'a@b.c' } }),
      );

      expect(resultado).toEqual({ data: { email: 'a@b.c', tenantId: 't1' } });
    });

    it('rellena el tenantId en cada fila de un createMany', () => {
      const resultado = runWithTenant('t1', () =>
        aplicarScopeDeTenant('Usuario', 'createMany', {
          data: [{ email: 'a@b.c' }, { email: 'd@e.f' }],
        }),
      );

      expect(resultado).toEqual({
        data: [
          { email: 'a@b.c', tenantId: 't1' },
          { email: 'd@e.f', tenantId: 't1' },
        ],
      });
    });

    it('filtra tambien deleteMany y count', () => {
      expect(runWithTenant('t1', () => aplicarScopeDeTenant('Usuario', 'deleteMany', {}))).toEqual(
        { where: { tenantId: 't1' } },
      );
      expect(runWithTenant('t1', () => aplicarScopeDeTenant('Usuario', 'count', {}))).toEqual({
        where: { tenantId: 't1' },
      });
    });

    it('aplica el scope a HistorialAccion', () => {
      const resultado = runWithTenant('t1', () =>
        aplicarScopeDeTenant('HistorialAccion', 'findMany', {}),
      );

      expect(resultado).toEqual({ where: { tenantId: 't1' } });
    });

    it('rechaza findUnique porque no se le puede inyectar el filtro', () => {
      expect(() =>
        runWithTenant('t1', () =>
          aplicarScopeDeTenant('Usuario', 'findUnique', { where: { id: 'u1' } }),
        ),
      ).toThrow(UnsafeUniqueOperationError);
    });

    it('rechaza upsert por la misma razon', () => {
      expect(() =>
        runWithTenant('t1', () =>
          aplicarScopeDeTenant('Usuario', 'upsert', {
            where: { id: 'u1' },
            create: {},
            update: {},
          }),
        ),
      ).toThrow(UnsafeUniqueOperationError);
    });
  });
});
```

- [ ] **Step 2: Ejecutar el test para verificar que falla**

```bash
pnpm --filter @boxadmin/api test -- tenant-scoped
```

Esperado: FAIL con `Cannot find module './tenant-scoped.extension'`.

- [ ] **Step 3: Implementar la lógica de scoping**

`apps/api/src/common/tenant/tenant-scoped.extension.ts`:

```ts
import { Prisma } from '@prisma/client';
import { getTenantContext } from './tenant-context';

/** Modelos que tienen columna `tenantId` y por tanto se filtran automáticamente. */
export const MODELOS_CON_TENANT = ['Usuario', 'HistorialAccion'] as const;

/** Operaciones cuyo `where` admite campos no únicos: se les inyecta el filtro. */
const OPERACIONES_CON_WHERE = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
]);

/** Operaciones que escriben filas nuevas: se les rellena el `tenantId`. */
const OPERACIONES_DE_CREACION = new Set(['create', 'createMany', 'createManyAndReturn']);

/** Operaciones cuyo `where` solo admite campos únicos: no se les puede inyectar nada. */
const OPERACIONES_UNICAS = new Set(['findUnique', 'findUniqueOrThrow', 'upsert']);

export class MissingTenantContextError extends Error {
  constructor(modelo: string, operacion: string) {
    super(
      `${operacion} sobre ${modelo} se ejecuto sin contexto de tenant. ` +
        'Envuelve la llamada en runWithTenant() o, si es deliberadamente global, en runUnscoped().',
    );
    this.name = 'MissingTenantContextError';
  }
}

export class UnsafeUniqueOperationError extends Error {
  constructor(modelo: string, operacion: string) {
    super(
      `${operacion} sobre ${modelo} no admite el filtro de tenant porque su where ` +
        'solo acepta campos unicos. Usa findFirst / update con where no unico, ' +
        'o runUnscoped() si la operacion es realmente global.',
    );
    this.name = 'UnsafeUniqueOperationError';
  }
}

function esModeloConTenant(modelo: string | undefined): boolean {
  return !!modelo && (MODELOS_CON_TENANT as readonly string[]).includes(modelo);
}

/**
 * Núcleo del aislamiento, extraído como función pura para poder testearlo sin
 * base de datos. Devuelve los `args` que debe recibir Prisma.
 */
export function aplicarScopeDeTenant(
  modelo: string | undefined,
  operacion: string,
  args: any,
): any {
  if (!esModeloConTenant(modelo)) return args;

  const ctx = getTenantContext();
  if (!ctx) throw new MissingTenantContextError(modelo as string, operacion);
  if (ctx.kind === 'unscoped') return args;

  const { tenantId } = ctx;

  if (OPERACIONES_UNICAS.has(operacion)) {
    throw new UnsafeUniqueOperationError(modelo as string, operacion);
  }

  if (OPERACIONES_DE_CREACION.has(operacion)) {
    const data = args?.data;
    if (Array.isArray(data)) {
      return { ...args, data: data.map((fila: any) => ({ ...fila, tenantId })) };
    }
    return { ...args, data: { ...(data ?? {}), tenantId } };
  }

  if (OPERACIONES_CON_WHERE.has(operacion)) {
    return { ...args, where: { ...(args?.where ?? {}), tenantId } };
  }

  return args;
}

/** Extensión de Prisma Client que aplica el scoping a toda query. */
export const tenantScopedExtension = Prisma.defineExtension({
  name: 'tenantScoped',
  query: {
    $allModels: {
      $allOperations({ model, operation, args, query }) {
        return query(aplicarScopeDeTenant(model, operation, args));
      },
    },
  },
});
```

Separar `aplicarScopeDeTenant` de la extensión es deliberado: es una función pura de `(modelo, operación, args) → args`, así que los 15 tests de arriba corren en milisegundos sin base de datos, y el comportamiento contra Postgres real se verifica luego en el e2e de fuga entre tenants (Task 13).

- [ ] **Step 4: Ejecutar los tests y verificar que pasan**

```bash
pnpm --filter @boxadmin/api test -- tenant-scoped
```

Esperado: PASS, 15 tests.

- [ ] **Step 5: Conectar la extensión al `PrismaService`**

Reemplaza el contenido de `apps/api/src/prisma/prisma.service.ts`:

```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { tenantScopedExtension } from '../common/tenant/tenant-scoped.extension';

function crearClienteExtendido(base: PrismaClient) {
  return base.$extends(tenantScopedExtension);
}

export type ClientePrismaExtendido = ReturnType<typeof crearClienteExtendido>;

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  /**
   * Cliente base, SIN scoping. Reservado para conectar, desconectar y limpiar
   * la base en los tests. El código de aplicación nunca debe tocarlo.
   */
  readonly base: PrismaClient;

  /** Cliente con aislamiento por tenant. Es el que usa toda la aplicación. */
  readonly db: ClientePrismaExtendido;

  constructor(config: ConfigService) {
    const connectionString = config.getOrThrow<string>('DATABASE_URL');

    this.base = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    this.db = crearClienteExtendido(this.base);
  }

  async onModuleInit(): Promise<void> {
    await this.base.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.base.$disconnect();
  }
}
```

El cambio respecto a la Task 5 es solo el tipo de `db`: pasa de `PrismaClient` a `ClientePrismaExtendido`. `$extends` no abre una conexión nueva, solo envuelve al cliente existente, así que los hooks sobre `base` siguen sirviendo para los dos.

- [ ] **Step 6: Verificar que toda la suite sigue verde**

```bash
pnpm --filter @boxadmin/api test
```

Esperado: PASS, 21 tests (6 de contexto + 15 de scoping).

- [ ] **Step 7: Punto de commit**

No ejecutes git. Mensaje sugerido para Cesar:

```
feat(api): extension de Prisma que aisla por tenant y falla sin contexto
```

---

### Task 8: Middleware de contexto de tenant

**Files:**
- Create: `apps/api/src/common/tenant/tenant.middleware.ts`
- Modify: `apps/api/src/app.module.ts`

**El detalle de orden que hay que entender antes de escribir esto:** en NestJS los middlewares corren *antes* que los guards, así que cuando este middleware necesita el `tenantId` el JWT todavía no ha pasado por Passport. Por eso verifica la firma él mismo. `JwtAuthGuard` sigue siendo la única autoridad de autenticación; el middleware solo establece contexto y **nunca autoriza**: si el token es inválido llama a `next()` sin contexto y deja que el guard rechace la request.

- [ ] **Step 1: Crear `apps/api/src/common/tenant/tenant.middleware.ts`**

```ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { JwtPayload } from '@boxadmin/shared';
import type { NextFunction, Request, Response } from 'express';
import { runWithTenant } from './tenant-context';

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  use(req: Request, _res: Response, next: NextFunction): void {
    const header = req.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
      // Ruta publica, o token ausente: sin contexto. Si la ruta esta protegida,
      // JwtAuthGuard la rechazara despues.
      next();
      return;
    }

    let payload: JwtPayload;
    try {
      payload = this.jwt.verify<JwtPayload>(header.slice('Bearer '.length), {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
      });
    } catch {
      // Token invalido o expirado: no se abre contexto. La autorizacion no es
      // asunto de este middleware.
      next();
      return;
    }

    // Un JWT bien firmado pero con el payload incompleto no puede abrir un contexto
    // envenenado: `jwt.verify<JwtPayload>` es solo una asercion de tipo, en ejecucion
    // el payload trae lo que traiga. Sin tenantId usable se trata como token invalido.
    if (typeof payload.tenantId !== 'string' || payload.tenantId.length === 0) {
      next();
      return;
    }

    runWithTenant(payload.tenantId, () => next());
  }
}
```

- [ ] **Step 2: Registrar el middleware en `app.module.ts`**

```ts
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from './prisma/prisma.module';
import { TenantContextMiddleware } from './common/tenant/tenant.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [`../../.env.${process.env.NODE_ENV ?? 'development'}`, '../../.env'],
    }),
    JwtModule.register({ global: true }),
    PrismaModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }
}
```

`JwtModule.register({ global: true })` sin secreto fijo: el middleware pasa el secreto explícito en cada `verify`, y `AuthModule` hará lo propio al firmar, porque access y refresh usan secretos distintos.

- [ ] **Step 3: Comprobar que la app arranca con el middleware puesto**

```bash
pnpm --filter @boxadmin/api start:dev
```

Esperado: `Nest application successfully started` sin errores de inyección de dependencias. Para con Ctrl+C.

- [ ] **Step 4: Punto de commit**

No ejecutes git. Mensaje sugerido para Cesar:

```
feat(api): middleware que abre el contexto de tenant desde el JWT
```

---

### Task 9: Decorators y guards

**Files:**
- Create: `apps/api/src/common/decorators/public.decorator.ts`
- Create: `apps/api/src/common/decorators/roles.decorator.ts`
- Create: `apps/api/src/common/decorators/current-user.decorator.ts`
- Create: `apps/api/src/common/guards/jwt-auth.guard.ts`
- Create: `apps/api/src/common/guards/bootstrap-key.guard.ts`
- Create: `apps/api/src/common/guards/roles.guard.ts`
- Test: `apps/api/src/common/guards/roles.guard.spec.ts`

- [ ] **Step 1: Crear los tres decorators**

`apps/api/src/common/decorators/public.decorator.ts`:

```ts
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Excluye la ruta del JwtAuthGuard global. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

`apps/api/src/common/decorators/roles.decorator.ts`:

```ts
import { SetMetadata } from '@nestjs/common';
import type { RolAsignable } from '@boxadmin/shared';

export const ROLES_KEY = 'roles';

/** Exige que el rol del usuario alcance al menos uno de los indicados. */
export const Roles = (...roles: RolAsignable[]) => SetMetadata(ROLES_KEY, roles);
```

El parámetro es `RolAsignable`, no `RolUsuario`: así `@Roles('FANTASMA')` es un error de compilación en vez de una ruta abierta a todo el mundo.

`apps/api/src/common/decorators/current-user.decorator.ts`:

```ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { JwtPayload } from '@boxadmin/shared';

/** Inyecta el payload del JWT ya validado por JwtAuthGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload =>
    ctx.switchToHttp().getRequest().user,
);
```

- [ ] **Step 2: Escribir el test que falla del `RolesGuard`**

`apps/api/src/common/guards/roles.guard.spec.ts`:

```ts
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ROLES_USUARIO,
  rolAlcanza,
  type RolAsignable,
  type RolUsuario,
} from '@boxadmin/shared';
import { RolesGuard } from './roles.guard';

function contextoCon(user: { rol: RolUsuario } | undefined): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function guardQueExige(roles: RolAsignable[] | undefined): RolesGuard {
  const reflector = { getAllAndOverride: () => roles } as unknown as Reflector;
  return new RolesGuard(reflector);
}

describe('RolesGuard', () => {
  it('deja pasar cuando la ruta no declara roles', () => {
    expect(guardQueExige(undefined).canActivate(contextoCon({ rol: 'ALUMNO' }))).toBe(true);
  });

  it('deja pasar cuando el rol coincide exactamente', () => {
    expect(
      guardQueExige(['ADMIN_SALON']).canActivate(contextoCon({ rol: 'ADMIN_SALON' })),
    ).toBe(true);
  });

  it('deja pasar cuando el rol es superior en la jerarquia', () => {
    expect(
      guardQueExige(['ADMIN_OPERATIVO']).canActivate(contextoCon({ rol: 'ADMIN_SALON' })),
    ).toBe(true);
  });

  it('bloquea a un ALUMNO en una ruta de ADMIN_SALON', () => {
    expect(() =>
      guardQueExige(['ADMIN_SALON']).canActivate(contextoCon({ rol: 'ALUMNO' })),
    ).toThrow(ForbiddenException);
  });

  it('bloquea siempre a FANTASMA, que es un rol tecnico sin login', () => {
    expect(() =>
      guardQueExige(['ALUMNO']).canActivate(contextoCon({ rol: 'FANTASMA' })),
    ).toThrow(ForbiddenException);
  });

  it('bloquea si no hay usuario en la request', () => {
    expect(() => guardQueExige(['ALUMNO']).canActivate(contextoCon(undefined))).toThrow(
      ForbiddenException,
    );
  });
});

// El guard delega toda la decisión en rolAlcanza, así que la matriz completa se
// prueba aquí, sobre la función pura: es donde vive la lógica de autorización.
describe('rolAlcanza (matriz completa)', () => {
  const REALES: RolAsignable[] = [
    'SUPERADMIN',
    'ADMIN_SALON',
    'ADMIN_OPERATIVO',
    'PROFESOR',
    'ALUMNO',
  ];

  it('un rol alcanza su propio nivel y todos los inferiores, ninguno superior', () => {
    REALES.forEach((rol, i) => {
      REALES.forEach((minimo, j) => {
        // El array va de mayor a menor rango: i <= j significa "rol manda igual o mas".
        expect(rolAlcanza(rol, minimo)).toBe(i <= j);
      });
    });
  });

  it('FANTASMA como usuario no alcanza ningun nivel', () => {
    REALES.forEach((minimo) => {
      expect(rolAlcanza('FANTASMA', minimo)).toBe(false);
    });
  });

  it('FANTASMA como umbral no deja pasar a nadie', () => {
    // Si esto fallara, una ruta @Roles('FANTASMA') quedaria abierta a cualquiera:
    // su rango es 0 y todos los demas son >= 0. Los tipos ya lo impiden, pero un
    // consumidor en JavaScript plano se los saltaria.
    ROLES_USUARIO.forEach((rol) => {
      expect(rolAlcanza(rol, 'FANTASMA' as RolAsignable)).toBe(false);
    });
  });
});
```

- [ ] **Step 3: Ejecutar el test para verificar que falla**

```bash
pnpm --filter @boxadmin/api test -- roles.guard
```

Esperado: FAIL con `Cannot find module './roles.guard'`.

- [ ] **Step 4: Implementar el `RolesGuard`**

`apps/api/src/common/guards/roles.guard.ts`:

```ts
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { rolAlcanza, type JwtPayload, type RolAsignable } from '@boxadmin/shared';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requeridos = this.reflector.getAllAndOverride<RolAsignable[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requeridos || requeridos.length === 0) return true;

    const user: JwtPayload | undefined = context.switchToHttp().getRequest().user;
    if (!user) throw new ForbiddenException('Sin permisos para esta operacion');

    const autorizado = requeridos.some((minimo) => rolAlcanza(user.rol, minimo));
    if (!autorizado) throw new ForbiddenException('Sin permisos para esta operacion');

    return true;
  }
}
```

- [ ] **Step 5: Ejecutar el test y verificar que pasa**

```bash
pnpm --filter @boxadmin/api test -- roles.guard
```

Esperado: PASS, 9 tests (6 del guard + 3 de la matriz de rolAlcanza).

- [ ] **Step 6: Crear el `JwtAuthGuard`**

`apps/api/src/common/guards/jwt-auth.guard.ts`:

```ts
import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const esPublica = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (esPublica) return true;

    return super.canActivate(context);
  }
}
```

- [ ] **Step 7: Crear el `BootstrapKeyGuard`**

`apps/api/src/common/guards/bootstrap-key.guard.ts`:

```ts
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';

/**
 * Protege los endpoints de arranque (crear tenant, registrar el primer admin)
 * con una clave del .env, resolviendo el huevo y la gallina: al inicio no
 * existe ningun usuario con el que autenticarse.
 */
@Injectable()
export class BootstrapKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const esperada = this.config.getOrThrow<string>('BOOTSTRAP_KEY');
    const recibida = context.switchToHttp().getRequest().headers['x-bootstrap-key'];

    if (typeof recibida !== 'string' || !this.coincide(recibida, esperada)) {
      throw new UnauthorizedException('Clave de bootstrap invalida');
    }

    return true;
  }

  private coincide(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }
}
```

`timingSafeEqual` en vez de `===` para no filtrar la clave carácter a carácter midiendo tiempos de respuesta.

- [ ] **Step 8: Verificar que toda la suite sigue verde**

```bash
pnpm --filter @boxadmin/api test
```

Esperado: PASS, 30 tests.

- [ ] **Step 9: Punto de commit**

No ejecutes git. Mensaje sugerido para Cesar:

```
feat(api): decorators Public/Roles/CurrentUser y guards de JWT, roles y bootstrap
```

---

### Task 10: Módulo de autenticación

> ## ⚠️ LEE ESTO ANTES DE ESCRIBIR EL SERVICIO
>
> Las reglas de aislamiento endurecidas en la Task 7 obligan a envolver en **`runUnscoped()`** más operaciones de las que el código de abajo muestra. Con la lista exacta:
>
> - `tenant.create` y `tenant.findFirst({where:{slug}})` — crear el gimnasio y resolverlo en el login. Dentro de un contexto de tenant, `Tenant` queda restringido a `where.id`, así que nunca encontraría otro.
> - La búsqueda del usuario en el login, antes de que exista JWT.
> - **Todo lo que toque `RefreshToken` fuera de contexto**: crearlos al emitir tokens, y validarlos, rotarlos o revocarlos en `/auth/refresh`, que es público. `refreshToken.create` lanza `CreacionNoPermitidaError` incluso teniendo contexto, porque el modelo no tiene columna `tenantId` propia.
> - Cualquier `findUnique`/`findUniqueOrThrow`/`upsert` sobre `Usuario` o `Tenant`: dentro de un tenant lanzan `UnsafeUniqueOperationError`. Usa `findFirst`, o `runUnscoped()` si la operación es realmente global.
>
> **No** necesita `runUnscoped()` crear el usuario ADMIN_SALON inicial: basta `runWithTenant(nuevoTenantId, ...)` y el `tenantId` se rellena solo.
>
> **Trampa con `await`.** Las `PrismaPromise` son perezosas: `await runWithTenant(id, () => db.usuario.findMany())` **pierde el contexto**, porque el callback solo construye la promesa y la query se ejecuta en el `await` de fuera. Hay que poner el `await` dentro: `await runWithTenant(id, async () => await db.usuario.findMany())`. Desde la enmienda de la Task 7 esto falla ruidosamente con `MissingTenantContextError` en vez de colarse sin filtro, pero hay que escribirlo bien igualmente.

**Files:**
- Create: `apps/api/src/auth/dto/create-tenant.dto.ts`
- Create: `apps/api/src/auth/dto/register.dto.ts`
- Create: `apps/api/src/auth/dto/login.dto.ts`
- Create: `apps/api/src/auth/dto/refresh.dto.ts`
- Create: `apps/api/src/auth/strategies/jwt.strategy.ts`
- Create: `apps/api/src/auth/auth.service.ts`
- Create: `apps/api/src/auth/auth.controller.ts`
- Create: `apps/api/src/auth/auth.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Forma del refresh token:** es un JWT firmado con `JWT_REFRESH_SECRET` cuyo payload es `{ sub: usuarioId, jti: idDeLaFila }`. La fila `RefreshToken` guarda el argon2 del JWT completo. Así la firma y el vencimiento los valida el propio JWT, el `jti` localiza la fila (un hash argon2 lleva sal, no se puede buscar por él) y el `tokenHash` confirma que el token presentado es exactamente el emitido.

- [ ] **Step 1: Crear los cuatro DTOs**

`apps/api/src/auth/dto/create-tenant.dto.ts`:

```ts
import { IsString, Length, Matches } from 'class-validator';

export class CreateTenantDto {
  @IsString()
  @Length(2, 120)
  nombre!: string;

  @IsString()
  @Length(2, 60)
  @Matches(/^[a-z0-9-]+$/, {
    message: 'El slug solo admite minusculas, numeros y guiones',
  })
  slug!: string;
}
```

`apps/api/src/auth/dto/register.dto.ts`:

```ts
import { IsEmail, IsString, Length } from 'class-validator';

export class RegisterDto {
  @IsString()
  @Length(2, 60)
  tenantSlug!: string;

  @IsString()
  @Length(2, 160)
  nombreCompleto!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @Length(10, 200)
  password!: string;
}
```

`apps/api/src/auth/dto/login.dto.ts`:

```ts
import { IsEmail, IsString, Length } from 'class-validator';

export class LoginDto {
  @IsString()
  @Length(2, 60)
  tenantSlug!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @Length(1, 200)
  password!: string;
}
```

El `tenantSlug` es obligatorio porque el email solo es único dentro de un tenant: sin él, dos gimnasios con el mismo email serían indistinguibles.

`apps/api/src/auth/dto/refresh.dto.ts`:

```ts
import { IsString } from 'class-validator';

export class RefreshDto {
  @IsString()
  refreshToken!: string;
}
```

- [ ] **Step 2: Crear la estrategia JWT**

`apps/api/src/auth/strategies/jwt.strategy.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { JwtPayload } from '@boxadmin/shared';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  validate(payload: JwtPayload): JwtPayload {
    return payload;
  }
}
```

- [ ] **Step 3: Crear el `AuthService`**

`apps/api/src/auth/auth.service.ts`:

```ts
import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type {
  JwtPayload,
  LoginRespuesta,
  TenantPublico,
  TokensRespuesta,
  UsuarioPublico,
} from '@boxadmin/shared';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { runUnscoped, runWithTenant } from '../common/tenant/tenant-context';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateTenantDto } from './dto/create-tenant.dto';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';

/** Mismo mensaje para email inexistente y password incorrecta: no filtra qué emails están dados de alta. */
const CREDENCIALES_INVALIDAS = 'Credenciales invalidas';

interface RefreshPayload {
  sub: string;
  jti: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async crearTenant(dto: CreateTenantDto): Promise<TenantPublico> {
    const existente = await runUnscoped(() =>
      this.prisma.db.tenant.findUnique({ where: { slug: dto.slug } }),
    );
    if (existente) throw new ConflictException('Ya existe un tenant con ese slug');

    const tenant = await runUnscoped(() =>
      this.prisma.db.tenant.create({ data: { nombre: dto.nombre, slug: dto.slug } }),
    );

    return this.aTenantPublico(tenant);
  }

  /** Crea el primer usuario de un tenant, siempre con rol ADMIN_SALON. */
  async register(dto: RegisterDto): Promise<UsuarioPublico> {
    const tenant = await runUnscoped(() =>
      this.prisma.db.tenant.findUnique({ where: { slug: dto.tenantSlug } }),
    );
    if (!tenant) throw new UnauthorizedException('Tenant inexistente');

    return runWithTenant(tenant.id, async () => {
      const yaHayUsuarios = await this.prisma.db.usuario.count();
      if (yaHayUsuarios > 0) {
        throw new ConflictException('Este tenant ya tiene usuarios; usa el alta normal');
      }

      const usuario = await this.prisma.db.usuario.create({
        data: {
          nombreCompleto: dto.nombreCompleto,
          email: dto.email.toLowerCase(),
          passwordHash: await argon2.hash(dto.password, { type: argon2.argon2id }),
          rol: 'ADMIN_SALON',
        },
      });

      return this.aUsuarioPublico(usuario);
    });
  }

  async login(dto: LoginDto): Promise<LoginRespuesta> {
    const usuario = await runUnscoped(async () => {
      const tenant = await this.prisma.db.tenant.findUnique({
        where: { slug: dto.tenantSlug },
      });
      if (!tenant || !tenant.activo) return null;

      return this.prisma.db.usuario.findUnique({
        where: { tenantId_email: { tenantId: tenant.id, email: dto.email.toLowerCase() } },
      });
    });

    if (!usuario || !usuario.activo || usuario.rol === 'FANTASMA') {
      throw new UnauthorizedException(CREDENCIALES_INVALIDAS);
    }

    const passwordOk = await argon2.verify(usuario.passwordHash, dto.password);
    if (!passwordOk) throw new UnauthorizedException(CREDENCIALES_INVALIDAS);

    const tokens = await this.emitirTokens({
      id: usuario.id,
      tenantId: usuario.tenantId,
      rol: usuario.rol,
    });

    return { ...tokens, usuario: this.aUsuarioPublico(usuario) };
  }

  /**
   * Rotación con detección de reuso (OWASP): cada refresh revoca el token usado
   * y emite otro. Si llega un token ya revocado, se asume robo y se revocan
   * todas las sesiones del usuario.
   */
  async refresh(refreshToken: string): Promise<TokensRespuesta> {
    let payload: RefreshPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshPayload>(refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Refresh token invalido');
    }

    const fila = await this.prisma.db.refreshToken.findUnique({
      where: { id: payload.jti },
    });
    if (!fila || fila.usuarioId !== payload.sub) {
      throw new UnauthorizedException('Refresh token invalido');
    }

    if (fila.revokedAt) {
      await this.revocarTodasLasSesiones(fila.usuarioId);
      throw new UnauthorizedException('Refresh token reutilizado; sesiones revocadas');
    }

    if (fila.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Refresh token expirado');
    }

    const coincide = await argon2.verify(fila.tokenHash, refreshToken);
    if (!coincide) {
      await this.revocarTodasLasSesiones(fila.usuarioId);
      throw new UnauthorizedException('Refresh token invalido');
    }

    const usuario = await runUnscoped(() =>
      this.prisma.db.usuario.findUnique({ where: { id: fila.usuarioId } }),
    );
    if (!usuario || !usuario.activo) {
      throw new UnauthorizedException('Refresh token invalido');
    }

    await this.prisma.db.refreshToken.update({
      where: { id: fila.id },
      data: { revokedAt: new Date() },
    });

    return this.emitirTokens({
      id: usuario.id,
      tenantId: usuario.tenantId,
      rol: usuario.rol,
    });
  }

  async logout(usuarioId: string, refreshToken: string): Promise<void> {
    let payload: RefreshPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshPayload>(refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      // Logout es idempotente: un token ilegible ya no sirve para nada.
      return;
    }

    await this.prisma.db.refreshToken.updateMany({
      where: { id: payload.jti, usuarioId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async usuarioActual(payload: JwtPayload): Promise<UsuarioPublico> {
    const usuario = await this.prisma.db.usuario.findFirst({ where: { id: payload.sub } });
    if (!usuario) throw new UnauthorizedException('Usuario inexistente');

    return this.aUsuarioPublico(usuario);
  }

  private async emitirTokens(usuario: {
    id: string;
    tenantId: string;
    rol: UsuarioPublico['rol'];
  }): Promise<TokensRespuesta> {
    const accessToken = await this.jwt.signAsync(
      { sub: usuario.id, tenantId: usuario.tenantId, rol: usuario.rol } satisfies JwtPayload,
      {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
        expiresIn: this.config.getOrThrow<string>('JWT_EXPIRES_IN'),
      },
    );

    const jti = randomUUID();
    const expiresIn = this.config.getOrThrow<string>('JWT_REFRESH_EXPIRES_IN');
    const refreshToken = await this.jwt.signAsync(
      { sub: usuario.id, jti } satisfies RefreshPayload,
      { secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'), expiresIn },
    );

    const { exp } = this.jwt.decode(refreshToken) as { exp: number };

    await this.prisma.db.refreshToken.create({
      data: {
        id: jti,
        usuarioId: usuario.id,
        tokenHash: await argon2.hash(refreshToken, { type: argon2.argon2id }),
        expiresAt: new Date(exp * 1000),
      },
    });

    return { accessToken, refreshToken };
  }

  private async revocarTodasLasSesiones(usuarioId: string): Promise<void> {
    await this.prisma.db.refreshToken.updateMany({
      where: { usuarioId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private aUsuarioPublico(u: {
    id: string;
    tenantId: string;
    nombreCompleto: string;
    email: string;
    rol: UsuarioPublico['rol'];
    activo: boolean;
  }): UsuarioPublico {
    return {
      id: u.id,
      tenantId: u.tenantId,
      nombreCompleto: u.nombreCompleto,
      email: u.email,
      rol: u.rol,
      activo: u.activo,
    };
  }

  private aTenantPublico(t: {
    id: string;
    nombre: string;
    slug: string;
    activo: boolean;
  }): TenantPublico {
    return { id: t.id, nombre: t.nombre, slug: t.slug, activo: t.activo };
  }
}
```

Fíjate dónde aparece `runUnscoped`: crear un tenant, buscar el tenant y el usuario en el login, y recuperar al usuario en el refresh. Son exactamente las operaciones que ocurren *antes* de que exista un JWT, y el escape queda a la vista en cada una. `RefreshToken` no tiene columna `tenantId`, así que la extensión lo deja pasar sin necesidad de envolverlo.

- [ ] **Step 4: Crear el `AuthController`**

`apps/api/src/auth/auth.controller.ts`:

```ts
import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import type {
  JwtPayload,
  LoginRespuesta,
  TenantPublico,
  TokensRespuesta,
  UsuarioPublico,
} from '@boxadmin/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { BootstrapKeyGuard } from '../common/guards/bootstrap-key.guard';
import { AuthService } from './auth.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @UseGuards(BootstrapKeyGuard)
  @Post('tenants')
  crearTenant(@Body() dto: CreateTenantDto): Promise<TenantPublico> {
    return this.auth.crearTenant(dto);
  }

  @Public()
  @UseGuards(BootstrapKeyGuard)
  @Post('register')
  register(@Body() dto: RegisterDto): Promise<UsuarioPublico> {
    return this.auth.register(dto);
  }

  @Public()
  @HttpCode(200)
  @Post('login')
  login(@Body() dto: LoginDto): Promise<LoginRespuesta> {
    return this.auth.login(dto);
  }

  @Public()
  @HttpCode(200)
  @Post('refresh')
  refresh(@Body() dto: RefreshDto): Promise<TokensRespuesta> {
    return this.auth.refresh(dto.refreshToken);
  }

  @HttpCode(204)
  @Post('logout')
  async logout(
    @CurrentUser() user: JwtPayload,
    @Body() dto: RefreshDto,
  ): Promise<void> {
    await this.auth.logout(user.sub, dto.refreshToken);
  }

  @Get('me')
  me(@CurrentUser() user: JwtPayload): Promise<UsuarioPublico> {
    return this.auth.usuarioActual(user);
  }

  /** Endpoint de prueba del checklist: verifica que RolesGuard bloquea a un ALUMNO. */
  @Roles('ADMIN_SALON')
  @Get('admin-only')
  soloAdmin(@CurrentUser() user: JwtPayload): { ok: true; rol: JwtPayload['rol'] } {
    return { ok: true, rol: user.rol };
  }
}
```

`@Public()` junto a `@UseGuards(BootstrapKeyGuard)` no es contradictorio: `@Public()` desactiva el JWT (que aún no puede existir) y el guard de bootstrap pone la protección que sí corresponde en esa fase.

- [ ] **Step 5: Crear el `AuthModule`**

`apps/api/src/auth/auth.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [PassportModule],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
})
export class AuthModule {}
```

- [ ] **Step 6: Registrar los guards globales en `app.module.ts`**

```ts
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { TenantContextMiddleware } from './common/tenant/tenant.middleware';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [`../../.env.${process.env.NODE_ENV ?? 'development'}`, '../../.env'],
    }),
    JwtModule.register({ global: true }),
    PrismaModule,
    AuthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }
}
```

El orden importa: `JwtAuthGuard` va primero para que `request.user` ya exista cuando corra `RolesGuard`.

- [ ] **Step 7: Comprobar el flujo completo a mano**

Arranca la API (`pnpm --filter @boxadmin/api start:dev`) y en otra terminal:

```bash
curl -s -X POST http://localhost:3000/auth/tenants \
  -H "Content-Type: application/json" \
  -H "x-bootstrap-key: changeme_bootstrap_key" \
  -d '{"nombre":"Gimnasio Uno","slug":"gimnasio-uno"}'

curl -s -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -H "x-bootstrap-key: changeme_bootstrap_key" \
  -d '{"tenantSlug":"gimnasio-uno","nombreCompleto":"Ana Admin","email":"ana@uno.test","password":"password-larga-1"}'

curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"tenantSlug":"gimnasio-uno","email":"ana@uno.test","password":"password-larga-1"}'
```

Esperado: el primero devuelve el tenant con su `id`, el segundo el usuario con `rol: "ADMIN_SALON"`, el tercero `accessToken`, `refreshToken` y el usuario. Copia el `accessToken` y comprueba:

```bash
curl -s http://localhost:3000/auth/me -H "Authorization: Bearer <accessToken>"
curl -s -i http://localhost:3000/auth/me
```

Esperado: la primera devuelve los datos de Ana; la segunda, `HTTP/1.1 401 Unauthorized`.

- [ ] **Step 8: Punto de commit**

No ejecutes git. Mensaje sugerido para Cesar:

```
feat(api): autenticacion con argon2, JWT y refresh tokens con rotacion
```

---

### Task 11: Filtro de excepciones y endurecimiento de `main.ts`

**Files:**
- Create: `apps/api/src/common/filters/all-exceptions.filter.ts`
- Modify: `apps/api/src/main.ts`

- [ ] **Step 1: Crear el filtro global**

`apps/api/src/common/filters/all-exceptions.filter.ts`:

```ts
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  MissingTenantContextError,
  UnsafeUniqueOperationError,
} from '../tenant/tenant-scoped.extension';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const cuerpo = exception.getResponse();

      res.status(status).json({
        statusCode: status,
        path: req.url,
        timestamp: new Date().toISOString(),
        ...(typeof cuerpo === 'string' ? { message: cuerpo } : cuerpo),
      });
      return;
    }

    // Un fallo de scoping es un bug nuestro, nunca culpa del cliente: se registra
    // con todo el detalle y hacia fuera sale un 500 opaco.
    if (
      exception instanceof MissingTenantContextError ||
      exception instanceof UnsafeUniqueOperationError
    ) {
      this.logger.error(`FALLO DE AISLAMIENTO en ${req.method} ${req.url}`, exception.stack);
    } else {
      this.logger.error(`Error no controlado en ${req.method} ${req.url}`, exception);
    }

    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      path: req.url,
      timestamp: new Date().toISOString(),
      message: 'Error interno',
    });
  }
}
```

- [ ] **Step 2: Reescribir `apps/api/src/main.ts`**

```ts
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import compression from 'compression';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.use(helmet());
  app.use(compression());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  const config = app.get(ConfigService);
  await app.listen(config.get<number>('PORT') ?? 3000, '0.0.0.0');
}

void bootstrap();
```

`whitelist` + `forbidNonWhitelisted` significa que un campo que no esté en el DTO no se ignora en silencio: la request se rechaza. `'0.0.0.0'` es necesario para que el puerto publicado por Docker llegue al proceso.

- [ ] **Step 3: Verificar la validación y el formato de error**

Con la API arrancada:

```bash
curl -s -i -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"tenantSlug":"gimnasio-uno","email":"no-es-un-email","password":"x","sobra":"campo"}'
```

Esperado: `HTTP/1.1 400 Bad Request` y un cuerpo JSON con `statusCode`, `path`, `timestamp` y un `message` que incluye tanto el error de email como `property sobra should not exist`.

- [ ] **Step 4: Verificar que el login no filtra qué emails existen**

```bash
curl -s -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" \
  -d '{"tenantSlug":"gimnasio-uno","email":"noexiste@uno.test","password":"password-larga-1"}'

curl -s -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" \
  -d '{"tenantSlug":"gimnasio-uno","email":"ana@uno.test","password":"password-incorrecta"}'
```

Esperado: **las dos respuestas son idénticas**, 401 con `"message": "Credenciales invalidas"`. Si difieren, un atacante puede enumerar los emails dados de alta.

- [ ] **Step 5: Punto de commit**

No ejecutes git. Mensaje sugerido para Cesar:

```
feat(api): filtro global de excepciones, helmet, compression y validacion estricta
```

---

### Task 12: BullMQ y cola de health-check

**Files:**
- Create: `apps/api/src/jobs/health-check.processor.ts`
- Create: `apps/api/src/jobs/jobs.controller.ts`
- Create: `apps/api/src/jobs/jobs.module.ts`
- Modify: `apps/api/src/app.module.ts`

Se configura desde esta fase aunque no haya jobs reales, para no introducir la dependencia a mitad de proyecto.

- [ ] **Step 1: Crear el procesador**

`apps/api/src/jobs/health-check.processor.ts`:

```ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

export const HEALTH_CHECK_QUEUE = 'health-check-queue';

@Processor(HEALTH_CHECK_QUEUE)
export class HealthCheckProcessor extends WorkerHost {
  private readonly logger = new Logger(HealthCheckProcessor.name);

  async process(job: Job<{ pingAt: string }>): Promise<{ ok: true; pingAt: string }> {
    this.logger.log(`health-check procesado (job ${job.id})`);
    return { ok: true, pingAt: job.data.pingAt };
  }
}
```

- [ ] **Step 2: Crear el controlador**

`apps/api/src/jobs/jobs.controller.ts`:

```ts
import { InjectQueue } from '@nestjs/bullmq';
import { Controller, Post } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Roles } from '../common/decorators/roles.decorator';
import { HEALTH_CHECK_QUEUE } from './health-check.processor';

@Controller('jobs')
export class JobsController {
  constructor(@InjectQueue(HEALTH_CHECK_QUEUE) private readonly cola: Queue) {}

  /** Encola un job de prueba para comprobar que Redis y BullMQ responden. */
  @Roles('ADMIN_SALON')
  @Post('health-check')
  async encolar(): Promise<{ jobId: string | undefined }> {
    const job = await this.cola.add('ping', { pingAt: new Date().toISOString() });
    return { jobId: job.id };
  }
}
```

Requiere JWT y rol `ADMIN_SALON`: una cola abierta a cualquiera es un vector de denegación de servicio gratuito.

- [ ] **Step 3: Crear el módulo**

`apps/api/src/jobs/jobs.module.ts`:

```ts
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { HEALTH_CHECK_QUEUE, HealthCheckProcessor } from './health-check.processor';
import { JobsController } from './jobs.controller';

@Module({
  imports: [BullModule.registerQueue({ name: HEALTH_CHECK_QUEUE })],
  controllers: [JobsController],
  providers: [HealthCheckProcessor],
})
export class JobsModule {}
```

- [ ] **Step 4: Conectar BullMQ en `app.module.ts`**

Añade el import de `BullModule` y el módulo de jobs. El bloque `imports` queda así:

```ts
imports: [
  ConfigModule.forRoot({
    isGlobal: true,
    envFilePath: [`../../.env.${process.env.NODE_ENV ?? 'development'}`, '../../.env'],
  }),
  JwtModule.register({ global: true }),
  BullModule.forRootAsync({
    inject: [ConfigService],
    useFactory: (config: ConfigService) => {
      const url = new URL(config.getOrThrow<string>('REDIS_URL'));

      return {
        connection: {
          host: url.hostname,
          port: Number(url.port || 6379),
          username: url.username || undefined,
          password: url.password || undefined,
          maxRetriesPerRequest: null,
        },
      };
    },
  }),
  PrismaModule,
  AuthModule,
  JobsModule,
],
```

Con estos imports nuevos en la cabecera del archivo:

```ts
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { JobsModule } from './jobs/jobs.module';
```

No hace falta importar `ioredis` en `app.module.ts`: al pasar opciones en vez de una instancia, la dependencia queda dentro de BullMQ. Eso sí, `ioredis` debe estar fijado a `^5`, la misma línea que `bullmq` trae como dependencia propia; con dos copias en el árbol, TypeScript rechaza el tipo de la conexión.

Dos cosas aquí no son opcionales. La primera es la desviación respecto al PDF, que escribía `connection: { url: process.env.REDIS_URL }`: las opciones de ioredis **no admiten un campo `url`**, hay que desmontarla en sus partes.

La segunda es más sutil: se pasan **opciones** y no una instancia de `Redis` construida a mano, aunque el constructor sí acepte la URL entera. Una instancia creada ahí no la gestiona Nest, así que sobrevive a `app.close()` y deja el proceso vivo: en los e2e de la Task 13, Jest terminaba los 16 tests en verde y después se quedaba colgado para siempre. Con opciones, BullMQ crea y cierra sus propias conexiones dentro del ciclo de vida del módulo, y la suite sale limpia sin necesidad de `--forceExit`.

`maxRetriesPerRequest: null` lo exige BullMQ para sus workers.

- [ ] **Step 5: Verificar que la cola funciona de verdad**

Arranca la API y, con un `accessToken` de un `ADMIN_SALON` (el de la Task 10):

```bash
curl -s -X POST http://localhost:3000/jobs/health-check \
  -H "Authorization: Bearer <accessToken>"
```

Esperado: la respuesta es `{"jobId":"1"}` (o el número que toque) y en el log de la API aparece `health-check procesado (job 1)`. Si Redis no estuviera conectado, la petición se quedaría colgada o fallaría.

- [ ] **Step 6: Punto de commit**

No ejecutes git. Mensaje sugerido para Cesar:

```
feat(api): BullMQ conectado a Redis con la cola health-check
```

---

### Task 13: Tests e2e contra Postgres real

**Files:**
- Modify: `apps/api/package.json`
- Modify: `apps/api/src/app.module.ts`
- Create: `apps/api/test/jest-e2e.json`
- Create: `apps/api/test/helpers.ts`
- Create: `apps/api/test/auth.e2e-spec.ts`
- Delete: `apps/api/test/app.e2e-spec.ts` (el ejemplo del CLI, que apunta a un `GET /` que ya no existe)

Corren contra el contenedor `postgres-test` del puerto 5433, nunca contra la base de desarrollo.

- [ ] **Step 1: Ajustar los scripts de test**

`dotenv-cli` ya se instaló en la Task 4 (los scripts `db:*` lo usan). En `apps/api/package.json`, reemplaza los scripts de test por:

```json
{
  "test": "jest",
  "test:watch": "jest --watch",
  "db:test:deploy": "dotenv -e ../../.env.test -- prisma migrate deploy",
  "pretest:e2e": "pnpm db:test:deploy",
  "test:e2e": "dotenv -e ../../.env.test -- jest --config ./test/jest-e2e.json --runInBand"
}
```

`--runInBand` es obligatorio: los tests comparten una sola base de datos y en paralelo se pisarían el `TRUNCATE`.

- [ ] **Step 2: Comprobar que `ConfigModule` respeta el entorno de test**

Nada que cambiar: el `envFilePath` de la Task 5 ya contempla el entorno (`../../.env.${NODE_ENV}` primero, `../../.env` como respaldo). `dotenv-cli` pone `NODE_ENV=test` antes de que Jest arranque, así que la app de los tests carga `.env.test` y nunca puede acabar apuntando a la base de desarrollo por accidente. Verifícalo leyendo `apps/api/src/app.module.ts`.

- [ ] **Step 3: Crear `apps/api/test/jest-e2e.json`**

```json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": ".",
  "testEnvironment": "node",
  "testRegex": ".e2e-spec.ts$",
  "transform": {
    "^.+\\.(t|j)s$": "ts-jest"
  },
  "moduleNameMapper": {
    "^@boxadmin/shared$": "<rootDir>/../../../packages/shared/src/index.ts"
  }
}
```

El `moduleNameMapper` deja que los tests lean el paquete compartido directamente del fuente, sin depender de que su `dist` esté compilado.

- [ ] **Step 4: Crear `apps/api/test/helpers.ts`**

```ts
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/prisma/prisma.service';

export interface EntornoE2E {
  app: INestApplication;
  prisma: PrismaService;
}

/** Levanta la aplicación completa con la misma configuración que `main.ts`. */
export async function crearAppDeTest(): Promise<EntornoE2E> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();

  return { app, prisma: app.get(PrismaService) };
}

/** Vacía todas las tablas. Usa el cliente base, sin scoping: es limpieza, no lógica de negocio. */
export async function limpiarBaseDeDatos(prisma: PrismaService): Promise<void> {
  await prisma.base.$executeRawUnsafe(
    'TRUNCATE TABLE "refresh_tokens", "usuarios", "historial_acciones", "tenants" RESTART IDENTITY CASCADE',
  );
}

export const CLAVE_BOOTSTRAP = 'test_bootstrap_key';
```

- [ ] **Step 5: Borrar el e2e de ejemplo del CLI**

```bash
rm apps/api/test/app.e2e-spec.ts
```

Apunta a `GET /`, que se eliminó en la Task 5.

- [ ] **Step 6: Escribir el e2e de auth**

`apps/api/test/auth.e2e-spec.ts`:

```ts
import type { INestApplication } from '@nestjs/common';
import * as argon2 from 'argon2';
import request from 'supertest';
import {
  MissingTenantContextError,
} from '../src/common/tenant/tenant-scoped.extension';
import { runWithTenant } from '../src/common/tenant/tenant-context';
import type { PrismaService } from '../src/prisma/prisma.service';
import { CLAVE_BOOTSTRAP, crearAppDeTest, limpiarBaseDeDatos } from './helpers';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await crearAppDeTest());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await limpiarBaseDeDatos(prisma);
  });

  const http = () => request(app.getHttpServer());

  async function crearTenant(slug: string, nombre = `Gimnasio ${slug}`) {
    const res = await http()
      .post('/auth/tenants')
      .set('x-bootstrap-key', CLAVE_BOOTSTRAP)
      .send({ nombre, slug })
      .expect(201);
    return res.body as { id: string; slug: string };
  }

  async function registrarAdmin(slug: string, email: string) {
    const res = await http()
      .post('/auth/register')
      .set('x-bootstrap-key', CLAVE_BOOTSTRAP)
      .send({
        tenantSlug: slug,
        nombreCompleto: 'Admin de Prueba',
        email,
        password: 'password-larga-1',
      })
      .expect(201);
    return res.body as { id: string; email: string; rol: string };
  }

  async function login(slug: string, email: string, password = 'password-larga-1') {
    const res = await http()
      .post('/auth/login')
      .send({ tenantSlug: slug, email, password })
      .expect(200);
    return res.body as {
      accessToken: string;
      refreshToken: string;
      usuario: { id: string; email: string; tenantId: string };
    };
  }

  describe('bootstrap de tenants', () => {
    it('rechaza crear un tenant sin la clave de bootstrap', async () => {
      await http()
        .post('/auth/tenants')
        .send({ nombre: 'Gimnasio Uno', slug: 'uno' })
        .expect(401);
    });

    it('crea un tenant con la clave correcta', async () => {
      const tenant = await crearTenant('uno');

      expect(tenant.slug).toBe('uno');
      expect(tenant.id).toEqual(expect.any(String));
    });

    it('rechaza un slug duplicado', async () => {
      await crearTenant('uno');

      await http()
        .post('/auth/tenants')
        .set('x-bootstrap-key', CLAVE_BOOTSTRAP)
        .send({ nombre: 'Otro', slug: 'uno' })
        .expect(409);
    });
  });

  describe('registro', () => {
    it('crea el primer usuario como ADMIN_SALON', async () => {
      await crearTenant('uno');
      const usuario = await registrarAdmin('uno', 'ana@uno.test');

      expect(usuario.rol).toBe('ADMIN_SALON');
      expect(usuario.email).toBe('ana@uno.test');
      expect(usuario).not.toHaveProperty('passwordHash');
    });

    it('rechaza un segundo registro en el mismo tenant', async () => {
      await crearTenant('uno');
      await registrarAdmin('uno', 'ana@uno.test');

      await http()
        .post('/auth/register')
        .set('x-bootstrap-key', CLAVE_BOOTSTRAP)
        .send({
          tenantSlug: 'uno',
          nombreCompleto: 'Otro Admin',
          email: 'otro@uno.test',
          password: 'password-larga-1',
        })
        .expect(409);
    });
  });

  describe('login', () => {
    beforeEach(async () => {
      await crearTenant('uno');
      await registrarAdmin('uno', 'ana@uno.test');
    });

    it('devuelve access token, refresh token y usuario', async () => {
      const res = await login('uno', 'ana@uno.test');

      expect(res.accessToken).toEqual(expect.any(String));
      expect(res.refreshToken).toEqual(expect.any(String));
      expect(res.usuario.email).toBe('ana@uno.test');
    });

    it('da el mismo error para email inexistente y password incorrecta', async () => {
      const inexistente = await http()
        .post('/auth/login')
        .send({ tenantSlug: 'uno', email: 'nadie@uno.test', password: 'password-larga-1' })
        .expect(401);

      const passwordMala = await http()
        .post('/auth/login')
        .send({ tenantSlug: 'uno', email: 'ana@uno.test', password: 'password-larga-2' })
        .expect(401);

      expect(inexistente.body.message).toBe(passwordMala.body.message);
    });

    it('el mismo email en otro tenant es otro usuario distinto', async () => {
      await crearTenant('dos');
      await registrarAdmin('dos', 'ana@uno.test');

      const enUno = await login('uno', 'ana@uno.test');
      const enDos = await login('dos', 'ana@uno.test');

      expect(enUno.usuario.id).not.toBe(enDos.usuario.id);
      expect(enUno.usuario.tenantId).not.toBe(enDos.usuario.tenantId);
    });
  });

  describe('rutas protegidas', () => {
    it('rechaza /auth/me sin token', async () => {
      await http().get('/auth/me').expect(401);
    });

    it('devuelve el usuario correcto con token valido', async () => {
      await crearTenant('uno');
      await registrarAdmin('uno', 'ana@uno.test');
      const sesion = await login('uno', 'ana@uno.test');

      const res = await http()
        .get('/auth/me')
        .set('Authorization', `Bearer ${sesion.accessToken}`)
        .expect(200);

      expect(res.body.email).toBe('ana@uno.test');
      expect(res.body.tenantId).toBe(sesion.usuario.tenantId);
    });
  });

  describe('RolesGuard', () => {
    it('deja pasar a ADMIN_SALON y bloquea a ALUMNO en /auth/admin-only', async () => {
      const tenant = await crearTenant('uno');
      await registrarAdmin('uno', 'ana@uno.test');
      const admin = await login('uno', 'ana@uno.test');

      // El alumno se inserta con el cliente base, sin scoping: no hay endpoint de
      // alta de usuarios en la Fase 0 y esto es preparacion de datos, no negocio.
      await prisma.base.usuario.create({
        data: {
          tenantId: tenant.id,
          nombreCompleto: 'Luis Alumno',
          email: 'luis@uno.test',
          passwordHash: await argon2.hash('password-larga-1', { type: argon2.argon2id }),
          rol: 'ALUMNO',
        },
      });
      const alumno = await login('uno', 'luis@uno.test');

      await http()
        .get('/auth/admin-only')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      await http()
        .get('/auth/admin-only')
        .set('Authorization', `Bearer ${alumno.accessToken}`)
        .expect(403);
    });
  });

  describe('aislamiento entre tenants', () => {
    it('cada tenant solo ve sus propios usuarios y sin contexto la query falla', async () => {
      const uno = await crearTenant('uno');
      const dos = await crearTenant('dos');
      await registrarAdmin('uno', 'ana@uno.test');
      await registrarAdmin('dos', 'beto@dos.test');

      const vistosPorUno = await runWithTenant(uno.id, () =>
        prisma.db.usuario.findMany(),
      );
      const vistosPorDos = await runWithTenant(dos.id, () =>
        prisma.db.usuario.findMany(),
      );

      expect(vistosPorUno.map((u) => u.email)).toEqual(['ana@uno.test']);
      expect(vistosPorDos.map((u) => u.email)).toEqual(['beto@dos.test']);

      // Ni siquiera pidiendo explicitamente el otro tenant se filtran datos.
      const intentoDeFuga = await runWithTenant(uno.id, () =>
        prisma.db.usuario.findMany({ where: { tenantId: dos.id } }),
      );
      expect(intentoDeFuga).toEqual([]);

      // Y una query olvidada fuera de contexto no devuelve todo: revienta.
      await expect(prisma.db.usuario.findMany()).rejects.toThrow(MissingTenantContextError);
    });
  });

  describe('refresh tokens', () => {
    it('rota el token y detecta el reuso revocando todas las sesiones', async () => {
      await crearTenant('uno');
      await registrarAdmin('uno', 'ana@uno.test');
      const sesion = await login('uno', 'ana@uno.test');

      const rotado = await http()
        .post('/auth/refresh')
        .send({ refreshToken: sesion.refreshToken })
        .expect(200);

      expect(rotado.body.refreshToken).not.toBe(sesion.refreshToken);

      // Reusar el token viejo: se asume robo.
      await http()
        .post('/auth/refresh')
        .send({ refreshToken: sesion.refreshToken })
        .expect(401);

      // Y el token nuevo tambien queda invalidado por la revocacion en cascada.
      await http()
        .post('/auth/refresh')
        .send({ refreshToken: rotado.body.refreshToken })
        .expect(401);
    });

    it('logout revoca el refresh token', async () => {
      await crearTenant('uno');
      await registrarAdmin('uno', 'ana@uno.test');
      const sesion = await login('uno', 'ana@uno.test');

      await http()
        .post('/auth/logout')
        .set('Authorization', `Bearer ${sesion.accessToken}`)
        .send({ refreshToken: sesion.refreshToken })
        .expect(204);

      await http()
        .post('/auth/refresh')
        .send({ refreshToken: sesion.refreshToken })
        .expect(401);
    });

    // Este test existe porque una prueba de mutacion demostro que sin el nadie
    // detecta la regresion: al quitar la revocacion masiva, el reuso seguia
    // devolviendo 401 con el mismo mensaje, pero las demas sesiones del usuario
    // seguian vivas. El 401 del token reusado NO prueba que la cascada ocurrio.
    it('el reuso de un token rotado revoca tambien las demas sesiones vivas', async () => {
      await crearTenant('uno');
      await registrarAdmin('uno', 'ana@uno.test');

      const sesionA = await login('uno', 'ana@uno.test');
      const sesionB = await login('uno', 'ana@uno.test');

      // Rotacion legitima de A.
      await http()
        .post('/auth/refresh')
        .send({ refreshToken: sesionA.refreshToken })
        .expect(200);

      // Reuso del token viejo de A: se asume robo.
      await http()
        .post('/auth/refresh')
        .send({ refreshToken: sesionA.refreshToken })
        .expect(401);

      // La sesion B nunca se toco, y aun asi debe haber caido.
      await http()
        .post('/auth/refresh')
        .send({ refreshToken: sesionB.refreshToken })
        .expect(401);
    });

    // Sin el compare-and-swap en la revocacion, 10 peticiones simultaneas con el
    // mismo token devolvian seis 200 con pares distintos: todas leian revokedAt
    // null antes de que ninguna escribiera.
    it('con refresh concurrentes del mismo token solo uno gana', async () => {
      await crearTenant('uno');
      await registrarAdmin('uno', 'ana@uno.test');
      const sesion = await login('uno', 'ana@uno.test');

      const respuestas = await Promise.all(
        Array.from({ length: 10 }, () =>
          http().post('/auth/refresh').send({ refreshToken: sesion.refreshToken }),
        ),
      );

      const exitosas = respuestas.filter((r) => r.status === 200);
      expect(exitosas).toHaveLength(1);
      expect(respuestas.filter((r) => r.status === 401)).toHaveLength(9);
    });
  });
});
```

- [ ] **Step 7: Ejecutar los e2e**

Con `postgres-test` levantado:

```bash
pnpm --filter @boxadmin/api test:e2e
```

Esperado: primero corre `prisma migrate deploy` contra la base de tests y después PASS con 16 tests. Si falla la conexión, comprueba que `docker compose ps` muestra `postgres-test` como `healthy` en el puerto 5433.

- [ ] **Step 8: Ejecutar también los unitarios**

```bash
pnpm --filter @boxadmin/api test
```

Esperado: PASS, 30 tests.

- [ ] **Step 9: Punto de commit**

No ejecutes git. Mensaje sugerido para Cesar:

```
test(api): e2e de auth, roles, aislamiento entre tenants y rotacion de refresh
```

---

### Task 14: README y verificación del checklist de aceptación

**Files:**
- Create: `README.md`

- [ ] **Step 1: Escribir el `README.md`**

```markdown
# BoxAdmin

Sistema de gestión para gimnasios y estudios (Pilates, Yoga, funcional), multi-tenant desde el diseño.

**Estado:** Fase 0 — fundamentos. Sin lógica de negocio del gimnasio todavía.

## Requisitos

- Node.js 20 LTS
- Docker + Docker Compose v2
- pnpm (`corepack enable && corepack prepare pnpm@latest --activate`)

## Arranque

```bash
cp .env.example .env
docker compose up
```

La API queda en http://localhost:3000. La primera vez, aplica las migraciones:

```bash
pnpm --filter @boxadmin/api db:deploy
```

## Estructura

```
apps/api/          Backend NestJS
packages/shared/   Tipos y contratos compartidos con el futuro frontend
docs/              Especificaciones por fase
```

## Aislamiento por tenant

El aislamiento es row-level y se aplica en código, no con Row Level Security de Postgres:

1. `TenantContextMiddleware` verifica el JWT y abre un `AsyncLocalStorage` con el `tenantId`.
2. La extensión de Prisma (`common/tenant/tenant-scoped.extension.ts`) inyecta `where: { tenantId }` en toda query sobre modelos con esa columna.
3. Una query sobre un modelo con tenant **sin contexto lanza error** en vez de devolver todas las filas.

**Regla dura:** nunca pases `tenantId` a mano en un `where`. Si una operación es legítimamente global (crear un tenant, buscar al usuario en el login), envuélvela en `runUnscoped()` para que el escape quede visible.

## Endpoints de la Fase 0

| Método | Ruta | Protección |
|---|---|---|
| POST | `/auth/tenants` | `x-bootstrap-key` |
| POST | `/auth/register` | `x-bootstrap-key`, solo el primer usuario del tenant |
| POST | `/auth/login` | pública — `{ tenantSlug, email, password }` |
| POST | `/auth/refresh` | pública |
| POST | `/auth/logout` | JWT |
| GET | `/auth/me` | JWT |
| GET | `/auth/admin-only` | JWT + rol ADMIN_SALON |
| POST | `/jobs/health-check` | JWT + rol ADMIN_SALON |

El login pide `tenantSlug` porque el email solo es único dentro de un tenant.

## Tests

```bash
pnpm --filter @boxadmin/api test       # unitarios
pnpm --filter @boxadmin/api test:e2e   # e2e contra postgres-test (puerto 5433)
```
```

- [ ] **Step 2: Verificar el checklist de aceptación del PDF, punto por punto**

Con todo parado, arranca desde cero:

```bash
docker compose down -v
docker compose up -d
docker compose ps
```

Esperado (**punto 1 del checklist**): `postgres`, `postgres-test`, `redis` y `api` en `running`, la API sin errores en `docker compose logs api`.

```bash
pnpm --filter @boxadmin/api db:deploy
docker compose exec postgres psql -U boxadmin -d boxadmin -c "\dt"
```

Esperado (**punto 2**): las tablas `tenants`, `usuarios`, `refresh_tokens`, `historial_acciones`.

```bash
curl -s -X POST http://localhost:3000/auth/tenants -H "Content-Type: application/json" \
  -H "x-bootstrap-key: changeme_bootstrap_key" \
  -d '{"nombre":"Gimnasio Uno","slug":"uno"}'
```

Esperado (**punto 3**): 201 con el tenant.

```bash
curl -s -X POST http://localhost:3000/auth/register -H "Content-Type: application/json" \
  -H "x-bootstrap-key: changeme_bootstrap_key" \
  -d '{"tenantSlug":"uno","nombreCompleto":"Ana Admin","email":"ana@uno.test","password":"password-larga-1"}'
```

Esperado (**punto 4**): 201 con `"rol": "ADMIN_SALON"`.

```bash
curl -s -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" \
  -d '{"tenantSlug":"uno","email":"ana@uno.test","password":"password-larga-1"}'
```

Esperado (**punto 5**): 200 con `accessToken` y `refreshToken`.

```bash
curl -s http://localhost:3000/auth/me -H "Authorization: Bearer <accessToken>"
```

Esperado (**punto 6**): los datos de Ana con su `tenantId`.

**Puntos 7, 8 y 9** (fuga entre tenants, `RolesGuard` bloqueando a un `ALUMNO`, y el e2e de auth) los cubren los tests de la Task 13:

```bash
pnpm --filter @boxadmin/api test
pnpm --filter @boxadmin/api test:e2e
```

Esperado: PASS en las dos suites, 30 unitarios y 16 e2e.

- [ ] **Step 3: Dejar el entorno limpio**

```bash
docker compose down
```

- [ ] **Step 4: Punto de commit**

No ejecutes git. Mensaje sugerido para Cesar:

```
docs: README con arranque, aislamiento por tenant y endpoints de la Fase 0
```

- [ ] **Step 5: Informe final a Cesar**

Preséntale:
- La salida real de las dos suites de tests (no un resumen: el output).
- Los nueve puntos del checklist del PDF con su evidencia.
- Cualquier desviación respecto al PDF que hayas tenido que hacer y por qué.

No declares la Fase 0 terminada sin haber ejecutado y visto pasar las dos suites.

---

## Desviaciones respecto al PDF, en un solo sitio

Todas están justificadas en la tarea donde aparecen; se recogen aquí para revisarlas de un vistazo.

| # | PDF | Plan | Motivo |
|---|-----|------|--------|
| 1 | Monorepo dentro de `boxadmin/` | En la raíz del repo | `D:\Dev\box-admin` ya es la raíz; anidar sería redundante |
| 2 | `JWT_EXPIRES_IN=1d` | `15m` | Con refresh tokens rotatorios, un access token de un día anula el beneficio |
| 3 | `build: context: ./apps/api` | `context: .` + `Dockerfile.dev` propio | El build necesita ver `packages/shared`; el PDF no incluía Dockerfile |
| 4 | Sin BD de tests | Servicio `postgres-test` en el puerto 5433 | Los e2e no deben tocar los datos de desarrollo |
| 5 | `POST /auth/login` sin tenant | `{ tenantSlug, email, password }` | El email solo es único dentro del tenant (`@@unique([tenantId, email])`) |
| 6 | `/auth/tenants` "solo interno" | Guard `x-bootstrap-key` | Al arrancar no existe ningún usuario con el que autenticarse |
| 7 | `connection: { url: REDIS_URL }` | `new IORedis(REDIS_URL, ...)` | Las opciones de ioredis no admiten un campo `url` |
| 8 | Nada sobre `findUnique` | La extensión lo rechaza estando en contexto de tenant | Prisma solo acepta campos únicos en su `where`; no se le puede inyectar el filtro |
| 9 | Nada sobre el orden middleware/guard | El middleware verifica la firma del JWT él mismo | En NestJS los middlewares corren antes que los guards |
| 10 | `postgres` publicado en el 5432 | Publicado en el 5434 | Un PostgreSQL 18 nativo de Windows ya ocupa el 5432 en esta máquina |
| 11 | Nada sobre versiones de los paquetes de Nest | `@nestjs/config@^3`, `@nestjs/passport@^10`, `@nestjs/jwt@^10`, `@nestjs/bullmq@^10` | Sin fijar rango, pnpm instala majors que exigen Nest 11 o 12 |
| 12 | Nada sobre la versión de Prisma | `prisma` y `@prisma/client` a la misma versión exacta | El `latest` del CLI apuntaba a un release candidate y el del cliente a estable |
| 13 | `url = env("DATABASE_URL")` dentro del `datasource` | La URL vive en `prisma.config.ts`, y el cliente conecta por el driver adapter `@prisma/adapter-pg` | Prisma 7 rechaza la `url` en el schema (error P1012) y exige un adapter explícito |
| 14 | Nada sobre validación de entorno | `src/config/validar-entorno.ts` aborta el arranque si falta o está vacía cualquiera de las 7 variables críticas | Con `BOOTSTRAP_KEY` vacía, `timingSafeEqual` de dos buffers vacíos devuelve `true` y los endpoints de arranque quedan abiertos |
| 15 | "JwtAuthGuard global aplicado en `main.ts` vía APP_GUARD" | Los dos `APP_GUARD` se registran en `app.module.ts` | `APP_GUARD` es un provider: en NestJS no puede registrarse de otro modo |
| 16 | `tenant-scoped.extension.ts` en `src/prisma/` (§3.1) | En `src/common/tenant/`, junto al contexto y el middleware | El propio PDF se contradice: su árbol de carpetas de §3 ya lo sitúa ahí, y es donde tiene sentido |
| 17 | "Crear un módulo vacío `JobsModule` con una cola de ejemplo" | `JobsModule` incluye además un `JobsController` con `POST /jobs/health-check` | Sin un endpoint que encole, "validar que Redis y BullMQ están conectados" no se puede comprobar |
| 18 | `.env.example` sin `NODE_ENV` | Se añade `NODE_ENV` | Lo necesita el `envFilePath` de `ConfigModule` para elegir entre `.env` y `.env.test` |
