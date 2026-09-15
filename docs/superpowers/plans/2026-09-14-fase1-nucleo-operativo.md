# Fase 1 — Núcleo operativo · Plan de implementación

> **Para agentes ejecutores:** SUB-SKILL OBLIGATORIA: usa `superpowers:subagent-driven-development`
> (recomendado) o `superpowers:executing-plans` para implementar este plan tarea a tarea. Los pasos
> usan sintaxis de checkbox (`- [ ]`) para seguimiento.

**Objetivo:** que un admin pueda configurar su salón desde cero por API —sala → pack →
alumno/profesor → turno → reserva manual— con cupo, salas con acceso y auditoría validados en el
backend.

**Arquitectura:** cinco módulos NestJS nuevos (`salas`, `packs`, `usuarios`, `turnos`, `reservas`) más
un `HistorialService` compartido, sobre los seis modelos Prisma nuevos de esta fase. Todo el
aislamiento entre gimnasios lo sigue aplicando la extensión de Prisma de la Fase 0: los modelos nuevos
se clasifican en `MODELOS_CON_TENANT` y no se toca el núcleo de seguridad. La única regla de negocio
con concurrencia real —el cupo del turno— se resuelve con transacciones `Serializable` y reintento.

**Stack:** NestJS 10, TypeScript strict, Prisma 7.10.0 + PostgreSQL 16, argon2 0.44.0, class-validator,
Jest + Supertest, pnpm 9.12.0.

**Spec:** `docs/superpowers/specs/2026-09-14-fase1-nucleo-operativo.md`

---

## ⚠️ REGLA DEL PROYECTO — LEER ANTES DE EMPEZAR

**NADIE COMMITEA MÁS QUE CESAR.**

Ningún agente, en ninguna tarea, ejecuta `git add`, `git commit`, `git push`, `git stash`, `git
checkout` ni `git reset`. `git status`, `git diff` y `git check-ignore` sí están permitidos.

Donde un plan normal diría "Commit", este dice **"Anotar mensaje de commit sugerido"**: se escribe el
mensaje en `docs/superpowers/plans/PROGRESO.md` y se deja el árbol de trabajo sucio. Cesar commitea
cuando quiere.

**Tampoco se usa `taskkill /F /IM node.exe`** ni ningún equivalente que mate procesos por nombre: en la
Fase 0 un agente tiró todos los Node de la máquina, incluida la sesión que lo había lanzado. Si hay que
matar un proceso, se mata por PID concreto.

---

## Estado de partida (verificado el 2026-09-14)

- Fase 0 completa y commiteada en `e610e88`: 173 tests unitarios + 16 e2e en verde.
- `apps/api/prisma/schema.prisma` tiene 4 modelos: `Tenant`, `Usuario`, `RefreshToken`,
  `HistorialAccion`. La tabla `historial_acciones` existe pero **nadie escribe en ella todavía**.
- `MODELOS_CON_TENANT = ['Usuario', 'HistorialAccion']`, `MODELOS_POR_RELACION = { RefreshToken:
  'usuario' }`, `MODELOS_GLOBALES = ['Tenant']`.
- Postgres de desarrollo en **5434** (el 5432 lo ocupa un PostgreSQL 18 nativo de la máquina).
- Hay una **segunda** base, `postgres-test`, en el **5433**, con `tmpfs`: es la que usa `.env.test`.
  `docker compose up -d` sin argumentos intenta construir también la imagen de la API, así que levanta
  los servicios por nombre. Si los e2e no conectan, casi siempre es que `postgres-test` no está arriba.
- Los tests e2e corren con `pnpm --filter @boxadmin/api test:e2e`; su `pretest:e2e` aplica las
  migraciones a la base de test solo.

## Comandos que vas a usar

```bash
# desde la raíz del monorepo D:\Dev\box-admin
docker compose up -d postgres postgres-test redis  # 5434, 5433 y 6379
pnpm --filter @boxadmin/shared build              # compila los contratos compartidos
pnpm --filter @boxadmin/api db:migrate            # prisma migrate dev
pnpm --filter @boxadmin/api db:generate           # regenera el client
pnpm --filter @boxadmin/api test                  # unitarios
pnpm --filter @boxadmin/api test:e2e              # e2e (aplica migraciones a la base de test)
pnpm --filter @boxadmin/api exec tsc --noEmit     # comprobación de tipos estricta
```

**Después de tocar `packages/shared`, hay que reconstruirlo** antes de que `apps/api` vea los tipos
nuevos. Los scripts `prebuild` / `prestart:dev` lo hacen solos, pero `jest` y `tsc --noEmit` no.

---

## Mapa de archivos

### Se crean

| Archivo | Responsabilidad |
|---|---|
| `packages/shared/src/nucleo.contracts.ts` | Tipos públicos de salas, perfiles, packs, turnos, reservas y advertencias |
| `packages/shared/src/fechas.ts` | Conversión `Date ⇄ "YYYY-MM-DD"` y validación de `"HH:MM"` |
| `apps/api/src/common/historial/historial.service.ts` | Escribe `HistorialAccion` |
| `apps/api/src/common/historial/historial.module.ts` | Módulo global que expone el servicio |
| `apps/api/src/common/prisma/serializable.ts` | `conReintentoSerializable()` y detección de `P2034` |
| `apps/api/src/salas/{salas.module,salas.controller,salas.service}.ts` + `dto/` | CRUD de salas |
| `apps/api/src/packs/{packs.module,packs.controller,packs.service}.ts` + `dto/` | Catálogo de packs |
| `apps/api/src/usuarios/{usuarios.module,usuarios.controller,usuarios.service}.ts` + `dto/` | Altas separadas, listado, detalle, salas, reset de clave, baja |
| `apps/api/src/usuarios/password-temporal.ts` | Genera la contraseña temporal |
| `apps/api/src/turnos/{turnos.module,turnos.controller,turnos.service}.ts` + `dto/` | CRUD de turnos |
| `apps/api/src/reservas/{reservas.module,reservas.controller,reservas.service}.ts` + `dto/` | Crear, cancelar y reasignar reservas |
| `apps/api/src/reservas/ventana-pack.ts` | Cálculo puro de clases consumidas y tope del pack |
| `apps/api/test/nucleo.e2e-spec.ts` | e2e del checklist de la fase |

Cada servicio lleva su `*.spec.ts` al lado.

### Se modifican

| Archivo | Cambio |
|---|---|
| `apps/api/prisma/schema.prisma` | 6 modelos + 3 enums nuevos, back-relations en `Tenant` y `Usuario` |
| `apps/api/src/common/tenant/tenant-scoped.extension.ts` | 6 modelos nuevos en `MODELOS_CON_TENANT` |
| `apps/api/src/common/tenant/tenant-scoped.extension.spec.ts` | Centinela: todo modelo del schema debe estar clasificado |
| `apps/api/src/app.module.ts` | Importar los 5 módulos nuevos + `HistorialModule` |
| `apps/api/test/helpers.ts` | `limpiarBaseDeDatos` con las 6 tablas nuevas |
| `packages/shared/src/index.ts` | Reexportar los contratos nuevos |
| `docs/superpowers/plans/PROGRESO.md` | Seguimiento y mensajes de commit sugeridos |
| `README.md` | Endpoints de la Fase 1 |

---

## Tareas

> **Los numeros de tests que predice cada tarea estan desfasados.** Se calcularon al escribir el plan y
> desde entonces: (a) el bloque de la Task 6 tiene 12 casos, no 13 como se conto; (b) la Task 5b anadio
> una tanda de tests de regresion que el plan original no tenia. Trata las cifras como orden de
> magnitud: lo que importa es que la suite quede **entera en verde** y que el numero **suba**, nunca que
> coincida con la prediccion.


| # | Tarea | Bloquea a |
|---|---|---|
| T0 | Spike: ¿sobreviven las transacciones a la extensión de tenant? | **todo** |
| T1 | Schema, migración, clasificación y centinela | T2–T13 |
| T1b | Claves foraneas calificadas por tenant | T2-T13 |
| T2 | Contratos compartidos y utilidades de fecha | T4–T12 |
| T3 | `HistorialService` | T4–T11 |
| T4 | Módulo `salas` | T5, T6, T8 |
| T5 | Módulo `packs` | T6 |
| T6 | `usuarios` — altas de alumno y profesor | T7, T9 |
| T7 | `usuarios` — listado, detalle, edición, salas, reset, baja | T12 |
| T8 | Módulo `turnos` | T9 |
| T9 | `reservas` — crear con cupo y concurrencia | T10, T11 |
| T10 | `reservas` — cancelar y ventana del pack | T11 |
| T11 | `reservas` — reasignar | T12 |
| T12 | e2e del checklist, concurrencia y aislamiento | T13 |
| T13 | Verificación final, README y cierre | — |

---

### Task 0: Spike — ¿las transacciones atraviesan el bloqueo de raw?

**Por qué existe esta tarea.** `tenant-scoped.extension.ts` tiene un hook `$allOperations` de primer
nivel que lanza `RawQueryEnTenantError` ante toda operación con `model === undefined` dentro de un
contexto de tenant. Se verificó que `$queryRaw` y compañía llegan así. **No se verificó `$transaction`.**
Si `$transaction` también llega con `model === undefined`, toda la Fase 1 es inviable tal como está
diseñada, porque cupo, altas y reasignación son transaccionales.

Esta tarea no deja código de producción. Deja una respuesta y, si hace falta, un arreglo.

**Files:**
- Create (temporal): `apps/api/src/common/tenant/transaccion.spike.spec.ts`
- Posible modificación: `apps/api/src/common/tenant/tenant-scoped.extension.ts`

- [ ] **Step 1: Levantar la infraestructura**

```bash
docker compose up -d
docker compose ps
```

Esperado: `boxadmin-postgres` y `boxadmin-redis` en estado `running`. Postgres escucha en el **5434**
del host.

- [ ] **Step 2: Escribir el spike como test de integración**

Crear `apps/api/src/common/tenant/transaccion.spike.spec.ts`:

```ts
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { runUnscoped, runWithTenant, getTenantContext } from './tenant-context';

// Spike temporal: responde dos preguntas sobre Prisma 7.10.0 que no estaban
// verificadas y de las que depende toda la Fase 1. Se borra al terminar T0.
describe('spike: $transaction dentro de un contexto de tenant', () => {
  let prisma: PrismaService;
  let tenantId: string;

  beforeAll(async () => {
    const config = new ConfigService({
      DATABASE_URL: process.env.DATABASE_URL,
    } as Record<string, unknown>);
    prisma = new PrismaService(config);
    await prisma.onModuleInit();

    const tenant = await runUnscoped(() =>
      prisma.db.tenant.create({
        data: { nombre: 'Spike', slug: `spike-${Date.now()}` },
      }),
    );
    tenantId = tenant.id;
  });

  afterAll(async () => {
    await prisma.base.tenant.deleteMany({ where: { id: tenantId } });
    await prisma.onModuleDestroy();
  });

  it('PREGUNTA 1: $transaction no es bloqueada por el hook de raw', async () => {
    await expect(
      runWithTenant(tenantId, () =>
        prisma.db.$transaction(async (tx) => await tx.usuario.count()),
      ),
    ).resolves.toBe(0);
  });

  it('PREGUNTA 2: el contexto de tenant sobrevive dentro del callback', async () => {
    const visto = await runWithTenant(tenantId, () =>
      prisma.db.$transaction(async () => getTenantContext()),
    );

    expect(visto).toEqual({ kind: 'tenant', tenantId });
  });

  it('PREGUNTA 3: isolationLevel Serializable funciona', async () => {
    const n = await runWithTenant(tenantId, () =>
      prisma.db.$transaction(async (tx) => await tx.usuario.count(), {
        isolationLevel: 'Serializable',
      }),
    );

    expect(n).toBe(0);
  });
});
```

- [ ] **Step 3: Ejecutar el spike**

```bash
pnpm --filter @boxadmin/api exec dotenv -e ../../.env -- jest src/common/tenant/transaccion.spike.spec.ts --runInBand
```

Resultado posible **A — los tres pasan**: no hay que tocar nada. Anotarlo y saltar al Step 5.

Resultado posible **B — la pregunta 1 falla con `RawQueryEnTenantError`**: hay que arreglar la
extensión. Ir al Step 4.

Resultado posible **C — la pregunta 2 devuelve `undefined`**: el `AsyncLocalStorage` no se propaga al
callback. Es muy improbable (`AsyncLocalStorage` atraviesa `await` por diseño), pero si pasa, el plan
cambia: cada servicio tendría que re-abrir el contexto dentro del callback con `runWithTenant`. **Para
en ese caso y repórtalo antes de seguir** — es un cambio de diseño, no un arreglo puntual.

- [ ] **Step 4: (solo en el caso B) Permitir `$transaction` en el bloqueo de raw**

Modificar `bloquearRawEnTenant` en `apps/api/src/common/tenant/tenant-scoped.extension.ts`:

```ts
/**
 * Operaciones sin modelo que SÍ pueden pasar dentro de un contexto de tenant.
 *
 * `$transaction` no ejecuta SQL por sí misma: solo abre y cierra la transacción.
 * Las queries de dentro vuelven a entrar por el hook de `$allModels`, cada una
 * con su modelo, y ahí sí se les inyecta el filtro de tenant. Bloquearla no
 * añadiría seguridad y haría imposible toda escritura atómica.
 */
const OPERACIONES_SIN_MODELO_PERMITIDAS = new Set(['$transaction']);

export function bloquearRawEnTenant(modelo: string | undefined, operacion: string): void {
  if (modelo !== undefined) return;
  if (OPERACIONES_SIN_MODELO_PERMITIDAS.has(operacion)) return;
  const ctx = getTenantContext();
  if (ctx?.kind === 'tenant') throw new RawQueryEnTenantError(operacion);
}
```

Y añadir a `apps/api/src/common/tenant/tenant-scoped.extension.spec.ts`, junto a los demás tests de
`bloquearRawEnTenant`:

```ts
it('deja pasar $transaction: no ejecuta SQL propia y las queries de dentro se filtran solas', () => {
  runWithTenant('gym-1', () => {
    expect(() => bloquearRawEnTenant(undefined, '$transaction')).not.toThrow();
  });
});

it('sigue bloqueando $queryRaw, que no se puede filtrar', () => {
  runWithTenant('gym-1', () => {
    expect(() => bloquearRawEnTenant(undefined, '$queryRaw')).toThrow(RawQueryEnTenantError);
  });
});
```

Volver al Step 3 y comprobar que el spike pasa entero.

- [ ] **Step 5: Borrar el spike**

```bash
rm apps/api/src/common/tenant/transaccion.spike.spec.ts
```

El spike era una pregunta, no un test de regresión. La cobertura permanente la dan los tests de
`bloquearRawEnTenant` (si se ejecutó el Step 4) y los e2e de reservas de T12.

- [ ] **Step 6: Suite completa en verde**

```bash
pnpm --filter @boxadmin/api test
```

Esperado: 173 tests en verde (175 si se ejecutó el Step 4).

- [ ] **Step 7: Anotar mensaje de commit sugerido**

Si el Step 4 no hizo falta, no hay cambios que commitear; anotarlo igual en `PROGRESO.md`. Si sí:

```
fix(tenant): permitir $transaction dentro del contexto de tenant

El hook que bloquea SQL crudo mataba tambien $transaction, porque llega
con model === undefined. $transaction no ejecuta SQL propia: las queries
de dentro reentran por $allModels y se filtran una a una.

Archivos: apps/api/src/common/tenant/tenant-scoped.extension.ts
          apps/api/src/common/tenant/tenant-scoped.extension.spec.ts
```

---

### Task 1: Schema, migración, clasificación y centinela

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Modify: `apps/api/src/common/tenant/tenant-scoped.extension.ts`
- Modify: `apps/api/src/common/tenant/tenant-scoped.extension.spec.ts`
- Modify: `apps/api/test/helpers.ts`
- Create (generado): `apps/api/prisma/migrations/<timestamp>_fase1_nucleo_operativo/migration.sql`

- [ ] **Step 1: Escribir primero el test centinela (falla hoy)**

Este test es lo más valioso de la tarea: impide que una fase futura añada un modelo y abra una fuga
entre gimnasios sin que la suite lo grite. Añadir al final de
`apps/api/src/common/tenant/tenant-scoped.extension.spec.ts`:

```ts
describe('centinela de clasificacion', () => {
  it('todo modelo del schema esta clasificado en la extension', () => {
    const clasificados = new Set<string>([
      ...MODELOS_CON_TENANT,
      ...Object.keys(MODELOS_POR_RELACION),
      ...MODELOS_GLOBALES,
    ]);

    const sinClasificar = Prisma.dmmf.datamodel.models
      .map((modelo) => modelo.name)
      .filter((nombre) => !clasificados.has(nombre));

    // Si esto falla, alguien anadio un modelo al schema y no dijo como se
    // aisla. La extension lo bloquearia en tiempo de ejecucion con
    // ModeloNoClasificadoError, pero solo cuando alguien lo usara: este test
    // lo detecta al compilar la suite, que es cuando duele barato.
    expect(sinClasificar).toEqual([]);
  });
});
```

Asegurarse de que el fichero importa `Prisma` y los tres catálogos:

```ts
import { Prisma } from '@prisma/client';
import {
  MODELOS_CON_TENANT,
  MODELOS_GLOBALES,
  MODELOS_POR_RELACION,
} from './tenant-scoped.extension';
```

- [ ] **Step 2: Verificar que el centinela pasa con el schema actual**

```bash
pnpm --filter @boxadmin/api test -- tenant-scoped.extension
```

Esperado: PASS. Los 4 modelos de la Fase 0 están clasificados.

Si falla con `Cannot read properties of undefined (reading 'datamodel')`, es que `Prisma.dmmf` no está
expuesto por este generador. Sustituir la fuente de modelos por el propio schema:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function modelosDelSchema(): string[] {
  const schema = readFileSync(join(__dirname, '../../../prisma/schema.prisma'), 'utf8');
  return [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]);
}
```

y usar `modelosDelSchema()` en lugar de `Prisma.dmmf.datamodel.models.map(...)`.

- [ ] **Step 3: Añadir los enums y modelos al schema**

En `apps/api/prisma/schema.prisma`, **añadir** al final (no tocar lo existente salvo las
back-relations del Step 4):

```prisma
enum TipoPack {
  MENSUAL
  TOTAL
}

enum OrigenReserva {
  ADMIN
  ALUMNO
  RUTINA
  PRUEBA
  LISTA_ESPERA
  EXTRA
}

// Desviacion respecto al PDF, que usaba `cancelacionTipo String?` con los
// valores libres "recuperable" / "definitiva". Un typo en un string libre es un
// bug silencioso; el enum lo convierte en un error de compilacion.
enum TipoCancelacion {
  RECUPERABLE
  DEFINITIVA
}

model Sala {
  id       String @id @default(cuid())
  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id])

  nombre             String
  activa             Boolean @default(true)
  visibleAlumnos     Boolean @default(true)
  soloCuposLiberados Boolean @default(false)
  exclusiva          Boolean @default(false)

  // null = "hereda de la configuracion general del tenant". Esa configuracion
  // no existe todavia (llega en Fase 2), asi que en Fase 1 null significa "sin
  // efecto". Se almacenan ya para no migrar dos veces.
  cupoBase              Int?
  minMinutosCancelar    Int?
  minMinutosAnotarse    Int?
  listaEsperaHabilitada Boolean?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  usuarios UsuarioSala[]
  turnos   Turno[]
  packs    Pack[]

  @@index([tenantId])
  @@map("salas")
}

model Perfil {
  // Datos de negocio del alumno o profesor, separados de la tabla de auth.
  // Esta separacion es la que evita que el alta de un profesor arrastre campos
  // de alumno: el DTO de profesor ni siquiera los acepta.
  id        String  @id @default(cuid())
  tenantId  String
  tenant    Tenant  @relation(fields: [tenantId], references: [id])
  usuarioId String  @unique
  usuario   Usuario @relation(fields: [usuarioId], references: [id], onDelete: Cascade)

  telefono String?
  // Dato sensible: nunca aparece en listados y en el detalle solo lo ve
  // ADMIN_SALON o el propio usuario. La restriccion vive en el service.
  fichaMedica String?

  // Solo tienen sentido si el usuario es ALUMNO
  packId              String?
  pack                Pack?     @relation(fields: [packId], references: [id])
  clasesExtra         Int       @default(0)
  cancelacionesUsadas Int       @default(0)
  pagoAlDia           Boolean   @default(false)
  vigenciaDesde       DateTime?
  vigenciaHasta       DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  salas    UsuarioSala[]
  reservas Reserva[]

  @@index([tenantId])
  @@map("perfiles")
}

model UsuarioSala {
  // Salas con acceso de un perfil (N:M).
  //
  // Desviacion respecto al PDF, que no le ponia tenantId: sin columna propia la
  // extension de aislamiento lanza CreacionNoPermitidaError en cada alta, y la
  // tabla solo seria escribible por nested writes desde Perfil. Ademas es
  // defensa en profundidad: la fila queda atada a su gimnasio por si misma.
  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id])

  perfilId String
  perfil   Perfil @relation(fields: [perfilId], references: [id], onDelete: Cascade)
  salaId   String
  sala     Sala   @relation(fields: [salaId], references: [id], onDelete: Cascade)

  @@id([perfilId, salaId])
  @@index([tenantId])
  @@index([salaId])
  @@map("usuarios_salas")
}

model Pack {
  id       String @id @default(cuid())
  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id])

  nombre String // ej. "8 clases"

  salaId String? // null = vale para todas las salas
  sala   Sala?   @relation(fields: [salaId], references: [id])

  tipo   TipoPack @default(MENSUAL)
  // null = "a consultar". Decimal, no Float: esto es dinero.
  precio Decimal? @db.Decimal(10, 2)

  clasesPorMes            Int? // aplica si tipo = MENSUAL
  clasesTotales           Int? // aplica si tipo = TOTAL
  cancelacionesPermitidas Int? // null = el alumno mantiene su contador manual
  activo                  Boolean @default(true)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  perfiles Perfil[]

  @@index([tenantId])
  @@map("packs")
}

model Turno {
  id       String @id @default(cuid())
  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id])
  salaId   String
  sala     Sala   @relation(fields: [salaId], references: [id])

  nombre String // ej. "Pilates". En Fase 4 se agrega profesorId.

  fecha DateTime @db.Date
  // "HH:MM" en hora local del salon. String simple a proposito: no hay husos
  // que resolver y ordenar lexicograficamente equivale a ordenar por hora.
  horaInicio String
  horaFin    String

  cupo Int

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  reservas Reserva[]

  @@index([tenantId, salaId, fecha])
  @@map("turnos")
}

model Reserva {
  id       String @id @default(cuid())
  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id])
  turnoId  String
  turno    Turno  @relation(fields: [turnoId], references: [id])
  perfilId String
  perfil   Perfil @relation(fields: [perfilId], references: [id])

  origen        OrigenReserva
  esPrueba      Boolean       @default(false)
  pagoRealizado Boolean       @default(false)

  // Una reserva nunca se borra: se cancela. RECUPERABLE deja de contar contra
  // el pack ("la clase vuelve"); DEFINITIVA sigue contando.
  canceladaEn     DateTime?
  cancelacionTipo TipoCancelacion?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([tenantId, turnoId])
  @@index([tenantId, perfilId])
  @@map("reservas")
}
```

- [ ] **Step 4: Añadir las back-relations que faltan**

En el modelo `Tenant`, junto a `usuarios Usuario[]`:

```prisma
  perfiles      Perfil[]
  salas         Sala[]
  usuariosSalas UsuarioSala[]
  packs         Pack[]
  turnos        Turno[]
  reservas      Reserva[]
```

En el modelo `Usuario`, junto a `refreshTokens RefreshToken[]`:

```prisma
  perfil Perfil?
```

Sin estas líneas el schema **no valida**: Prisma exige que toda relación esté declarada por sus dos
extremos. El PDF las omitía.

- [ ] **Step 5: Validar el schema antes de migrar**

```bash
pnpm --filter @boxadmin/api exec prisma validate
```

Esperado: `The schema at prisma\schema.prisma is valid 🚀`.

Si sale `P1012` mencionando `url`, es la trampa de Prisma 7 que ya se resolvió en la Fase 0: la URL
vive en `prisma.config.ts`, no en el `datasource`. No volver a añadirla al schema.

- [ ] **Step 6: Generar la migración**

```bash
docker compose up -d
cd apps/api && pnpm exec dotenv -e ../../.env -- prisma migrate dev --name fase1_nucleo_operativo
```

Esperado: crea `apps/api/prisma/migrations/<timestamp>_fase1_nucleo_operativo/migration.sql` y aplica.
Abrir el SQL y comprobar que contiene los tres `CREATE TYPE` y los seis `CREATE TABLE`, con
`"precio" DECIMAL(10,2)` y `"fecha" DATE`.

- [ ] **Step 7: Clasificar los modelos nuevos**

En `apps/api/src/common/tenant/tenant-scoped.extension.ts`:

```ts
/** Modelos con columna `tenantId` propia. */
export const MODELOS_CON_TENANT = [
  'Usuario',
  'HistorialAccion',
  'Sala',
  'Perfil',
  'UsuarioSala',
  'Pack',
  'Turno',
  'Reserva',
] as const;
```

`MODELOS_POR_RELACION` y `MODELOS_GLOBALES` no cambian.

- [ ] **Step 8: Verificar que el centinela sigue pasando**

```bash
pnpm --filter @boxadmin/api test -- tenant-scoped.extension
```

Esperado: PASS. Si falla listando modelos, es que el Step 7 se saltó alguno — ese es justo el fallo que
el centinela existe para encontrar.

- [ ] **Step 9: Ampliar la limpieza de la base de test**

Esto es crítico y fácil de olvidar: sin ello los e2e se contaminan entre sí con síntomas que no apuntan
a la causa. En `apps/api/test/helpers.ts`:

```ts
/** Vacía todas las tablas. Usa el cliente base, sin scoping: es limpieza, no lógica de negocio. */
export async function limpiarBaseDeDatos(prisma: PrismaService): Promise<void> {
  await prisma.base.$executeRawUnsafe(
    'TRUNCATE TABLE ' +
      '"reservas", "usuarios_salas", "turnos", "perfiles", "packs", "salas", ' +
      '"refresh_tokens", "usuarios", "historial_acciones", "tenants" ' +
      'RESTART IDENTITY CASCADE',
  );
}
```

- [ ] **Step 10: Suite completa y tipos**

```bash
pnpm --filter @boxadmin/api db:generate
pnpm --filter @boxadmin/api exec tsc --noEmit
pnpm --filter @boxadmin/api test
pnpm --filter @boxadmin/api test:e2e
```

Esperado: `tsc` sin salida, 174 unitarios en verde, 16 e2e en verde. Los e2e deben seguir pasando
aunque no usen las tablas nuevas — si fallan aquí, el `TRUNCATE` del Step 9 tiene un nombre de tabla
mal escrito.

- [ ] **Step 11: Anotar mensaje de commit sugerido**

```
feat(db): modelo de datos de la Fase 1

Salas, perfiles, packs, turnos, reservas y la N:M usuarios_salas, mas los
enums TipoPack, OrigenReserva y TipoCancelacion. Los seis modelos se
clasifican en MODELOS_CON_TENANT.

Desviaciones respecto al PDF: UsuarioSala lleva tenantId propio (sin el, la
extension de aislamiento bloquea su creacion), cancelacionTipo es un enum y
no un string libre, y se anaden las back-relations que el documento omitia y
sin las que el schema no valida.

Nuevo centinela: la suite falla si un modelo del schema no esta clasificado.

Archivos: apps/api/prisma/schema.prisma
          apps/api/prisma/migrations/<timestamp>_fase1_nucleo_operativo/
          apps/api/src/common/tenant/tenant-scoped.extension.ts
          apps/api/src/common/tenant/tenant-scoped.extension.spec.ts
          apps/api/test/helpers.ts
```

---
### Task 2: Contratos compartidos y utilidades de fecha

**Files:**
- Create: `packages/shared/src/fechas.ts`
- Create: `packages/shared/src/fechas.spec.ts`
- Create: `packages/shared/src/nucleo.contracts.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `apps/api/src/prisma/prisma.service.ts` (tipo del cliente transaccional)

- [ ] **Step 1: Escribir los tests de fechas (fallan)**

Crear `packages/shared/src/fechas.spec.ts`:

```ts
import {
  aFechaISO,
  desdeFechaISO,
  esHoraValida,
  FechaInvalidaError,
  comparaHoras,
} from './fechas';

describe('aFechaISO', () => {
  it('devuelve solo la parte de fecha, en UTC', () => {
    expect(aFechaISO(new Date('2026-03-08T00:00:00.000Z'))).toBe('2026-03-08');
  });

  it('no se corre de dia con una hora avanzada', () => {
    expect(aFechaISO(new Date('2026-03-08T23:59:59.999Z'))).toBe('2026-03-08');
  });
});

describe('desdeFechaISO', () => {
  it('produce la medianoche UTC del dia indicado', () => {
    expect(desdeFechaISO('2026-03-08').toISOString()).toBe('2026-03-08T00:00:00.000Z');
  });

  it('ida y vuelta sin perdida', () => {
    expect(aFechaISO(desdeFechaISO('2026-12-31'))).toBe('2026-12-31');
  });

  it('rechaza un dia que no existe en vez de correrlo al mes siguiente', () => {
    expect(() => desdeFechaISO('2026-02-31')).toThrow(FechaInvalidaError);
  });

  it('rechaza formatos que no son YYYY-MM-DD', () => {
    expect(() => desdeFechaISO('08/03/2026')).toThrow(FechaInvalidaError);
    expect(() => desdeFechaISO('2026-3-8')).toThrow(FechaInvalidaError);
    expect(() => desdeFechaISO('')).toThrow(FechaInvalidaError);
  });
});

describe('esHoraValida', () => {
  it.each(['00:00', '09:30', '18:00', '23:59'])('acepta %s', (hora) => {
    expect(esHoraValida(hora)).toBe(true);
  });

  it.each(['24:00', '18:60', '8:00', '18:0', '1800', '', '18:00:00'])(
    'rechaza %s',
    (hora) => {
      expect(esHoraValida(hora)).toBe(false);
    },
  );
});

describe('comparaHoras', () => {
  it('ordena lexicograficamente, que con HH:MM equivale a ordenar por hora', () => {
    expect(comparaHoras('09:00', '18:00')).toBeLessThan(0);
    expect(comparaHoras('18:00', '09:00')).toBeGreaterThan(0);
    expect(comparaHoras('18:00', '18:00')).toBe(0);
  });
});
```

- [ ] **Step 2: Verificar que fallan**

```bash
pnpm --filter @boxadmin/shared test
```

Esperado: FAIL — `Cannot find module './fechas'`.

- [ ] **Step 3: Implementar `fechas.ts`**

Crear `packages/shared/src/fechas.ts`:

```ts
/** `YYYY-MM-DD`, sin hora ni huso. */
export const PATRON_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** `HH:MM` en 24 h. */
export const PATRON_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

export class FechaInvalidaError extends Error {
  constructor(recibido: string) {
    super(
      `Se esperaba una fecha con formato YYYY-MM-DD y se recibio ${JSON.stringify(recibido)}.`,
    );
    this.name = 'FechaInvalidaError';
  }
}

/**
 * Parte de fecha de un `Date`, en UTC.
 *
 * Las columnas `@db.Date` de Prisma vuelven como `Date` a medianoche UTC. Usar
 * `toISOString().slice(0, 10)` y no `getFullYear()` es deliberado: los getters
 * locales desplazarian el dia en cualquier maquina al oeste de Greenwich.
 */
export function aFechaISO(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/**
 * Convierte `"YYYY-MM-DD"` en la medianoche UTC de ese dia.
 *
 * Valida el ida y vuelta, no solo el patron: asi se rechaza `2026-02-31` en vez
 * de dejar que se convierta silenciosamente en el 3 de marzo.
 */
export function desdeFechaISO(iso: string): Date {
  if (!PATRON_FECHA.test(iso)) throw new FechaInvalidaError(iso);

  const fecha = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(fecha.getTime()) || aFechaISO(fecha) !== iso) {
    throw new FechaInvalidaError(iso);
  }

  return fecha;
}

export function esFechaValida(iso: string): boolean {
  try {
    desdeFechaISO(iso);
    return true;
  } catch {
    return false;
  }
}

export function esHoraValida(hora: string): boolean {
  return PATRON_HORA.test(hora);
}

/**
 * Compara dos horas `HH:MM`. Con ceros a la izquierda y 24 h, el orden
 * lexicografico coincide con el cronologico, asi que no hace falta parsear.
 */
export function comparaHoras(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Medianoche UTC de hoy. Util para "turnos futuros". */
export function comienzoDeHoyUtc(ahora: Date = new Date()): Date {
  return desdeFechaISO(aFechaISO(ahora));
}
```

- [ ] **Step 4: Verificar que pasan**

```bash
pnpm --filter @boxadmin/shared test
```

Esperado: PASS.

- [ ] **Step 5: Escribir los contratos**

Crear `packages/shared/src/nucleo.contracts.ts`:

```ts
import type { RolUsuario } from './roles';

// ---------------------------------------------------------------------------
// Advertencias
// ---------------------------------------------------------------------------

/**
 * Situaciones que no impiden completar la operacion pero que el admin debe ver.
 *
 * La alternativa —guardar en silencio— es exactamente el bug de "Sin sala" que
 * se detecto en Wellness: el alta funcionaba, el alumno quedaba inservible y
 * nadie se enteraba hasta que intentaba reservar.
 */
export type CodigoAdvertencia = 'SIN_SALAS' | 'SIN_PACK' | 'PACK_AGOTADO';

export interface Advertencia {
  codigo: CodigoAdvertencia;
  mensaje: string;
}

export interface ConAdvertencias {
  advertencias: Advertencia[];
}

// ---------------------------------------------------------------------------
// Salas
// ---------------------------------------------------------------------------

export interface SalaPublica {
  id: string;
  tenantId: string;
  nombre: string;
  activa: boolean;
  visibleAlumnos: boolean;
  soloCuposLiberados: boolean;
  exclusiva: boolean;
  /** `null` = hereda de la configuracion del tenant (que no existe hasta Fase 2). */
  cupoBase: number | null;
  minMinutosCancelar: number | null;
  minMinutosAnotarse: number | null;
  listaEsperaHabilitada: boolean | null;
}

// ---------------------------------------------------------------------------
// Packs
// ---------------------------------------------------------------------------

export type TipoPack = 'MENSUAL' | 'TOTAL';

export interface PackPublico {
  id: string;
  tenantId: string;
  nombre: string;
  /** `null` = vale para todas las salas. */
  salaId: string | null;
  tipo: TipoPack;
  /**
   * Decimal serializado como string (`"12500.00"`), nunca como number: los
   * float binarios pierden centavos y esto es dinero. `null` = a consultar.
   */
  precio: string | null;
  clasesPorMes: number | null;
  clasesTotales: number | null;
  cancelacionesPermitidas: number | null;
  activo: boolean;
}

// ---------------------------------------------------------------------------
// Usuarios de negocio (Usuario + Perfil)
// ---------------------------------------------------------------------------

export type TipoUsuarioNegocio = 'alumno' | 'profesor';

/** Lo que se devuelve en listados. Nunca incluye `fichaMedica`. */
export interface UsuarioResumen {
  id: string;
  tenantId: string;
  nombreCompleto: string;
  email: string;
  rol: RolUsuario;
  activo: boolean;
  perfilId: string;
  telefono: string | null;
  packId: string | null;
  salaIds: string[];
}

/** Detalle completo. `fichaMedica` solo viaja si el actor puede verla. */
export interface UsuarioDetalle extends UsuarioResumen {
  fichaMedica?: string | null;
  clasesExtra: number;
  cancelacionesUsadas: number;
  pagoAlDia: boolean;
  /** `YYYY-MM-DD` o `null`. */
  vigenciaDesde: string | null;
  vigenciaHasta: string | null;
  pack: PackPublico | null;
  salas: SalaPublica[];
}

/** El alta devuelve la contraseña temporal UNA sola vez. No se puede releer. */
export interface AltaUsuarioRespuesta extends UsuarioDetalle, ConAdvertencias {
  passwordTemporal: string;
}

export interface ResetPasswordRespuesta {
  usuarioId: string;
  passwordTemporal: string;
}

// ---------------------------------------------------------------------------
// Turnos
// ---------------------------------------------------------------------------

export interface TurnoPublico {
  id: string;
  tenantId: string;
  salaId: string;
  nombre: string;
  /** `YYYY-MM-DD`. */
  fecha: string;
  /** `HH:MM`. */
  horaInicio: string;
  horaFin: string;
  cupo: number;
  reservasActivas: number;
  lugaresLibres: number;
}

// ---------------------------------------------------------------------------
// Reservas
// ---------------------------------------------------------------------------

export type OrigenReserva =
  | 'ADMIN'
  | 'ALUMNO'
  | 'RUTINA'
  | 'PRUEBA'
  | 'LISTA_ESPERA'
  | 'EXTRA';

export type TipoCancelacion = 'RECUPERABLE' | 'DEFINITIVA';

export interface ReservaPublica {
  id: string;
  tenantId: string;
  turnoId: string;
  perfilId: string;
  origen: OrigenReserva;
  esPrueba: boolean;
  pagoRealizado: boolean;
  /** ISO 8601 completo, o `null` si sigue activa. */
  canceladaEn: string | null;
  cancelacionTipo: TipoCancelacion | null;
}

export interface ReservaCreada extends ReservaPublica, ConAdvertencias {}

/** Consumo del pack de un perfil, siempre derivado de las reservas. */
export interface ConsumoDePack {
  /** Reservas que cuentan: las no canceladas y las canceladas como DEFINITIVA. */
  clasesConsumidas: number;
  /** `null` = el pack no impone tope (o no hay pack). */
  tope: number | null;
  agotado: boolean;
}
```

- [ ] **Step 6: Reexportar**

`packages/shared/src/index.ts`:

```ts
export * from './roles';
export * from './auth.contracts';
export * from './fechas';
export * from './nucleo.contracts';
```

- [ ] **Step 7: Exponer el tipo del cliente transaccional**

Todos los servicios de esta fase reciben opcionalmente un cliente de transacción. Añadir al final de
`apps/api/src/prisma/prisma.service.ts`, **fuera de la clase**:

```ts
/**
 * Cliente utilizable dentro de un `$transaction`: el cliente extendido menos las
 * operaciones de conexion y la transaccion anidada, que Prisma no expone ahi.
 *
 * `this.prisma.db` tambien encaja en este tipo (tiene todo lo que pide y algo
 * mas), asi que un servicio puede declarar `cliente: ClientePrismaTx = this.prisma.db`
 * y funcionar tanto dentro como fuera de una transaccion.
 */
export type ClientePrismaTx = Omit<
  ClientePrismaExtendido,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;
```

- [ ] **Step 8: Compilar y comprobar tipos**

```bash
pnpm --filter @boxadmin/shared build
pnpm --filter @boxadmin/api exec tsc --noEmit
pnpm --filter @boxadmin/shared test
```

Esperado: `tsc` sin salida, tests de shared en verde.

Si `tsc` se queja de que `ClientePrismaTx` no es asignable desde `tx`, amplía el `Omit` con las claves
que falten; el objetivo del tipo es documentar la intención, no pelearse con Prisma.

- [ ] **Step 9: Anotar mensaje de commit sugerido**

```
feat(shared): contratos y utilidades de fecha de la Fase 1

Tipos publicos de salas, packs, usuarios de negocio, turnos y reservas, mas
el tipo Advertencia. Decimal viaja como string y las fechas como YYYY-MM-DD:
ni float para dinero ni ISO completo para un @db.Date.

Archivos: packages/shared/src/fechas.ts (+ spec)
          packages/shared/src/nucleo.contracts.ts
          packages/shared/src/index.ts
          apps/api/src/prisma/prisma.service.ts
```

---

### Task 3: HistorialService

El punto 9 del checklist ("cada operación relevante queda registrada en `historial_acciones`") depende
entero de esta tarea. La tabla existe desde la Fase 0 y **nadie ha escrito nunca en ella**.

**Files:**
- Create: `apps/api/src/common/historial/historial.service.ts`
- Create: `apps/api/src/common/historial/historial.service.spec.ts`
- Create: `apps/api/src/common/historial/historial.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Escribir el test (falla)**

Crear `apps/api/src/common/historial/historial.service.spec.ts`:

```ts
import { HistorialService } from './historial.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { JwtPayload } from '@boxadmin/shared';

const ACTOR: JwtPayload = { sub: 'usr-1', tenantId: 'gym-1', rol: 'ADMIN_SALON' };

function crearServicio() {
  const create = jest.fn().mockResolvedValue({ id: 'hist-1' });
  const prisma = { db: { historialAccion: { create } } } as unknown as PrismaService;
  return { servicio: new HistorialService(prisma), create, prisma };
}

describe('HistorialService', () => {
  it('escribe entidad, accion y el usuario que la ejecuto', async () => {
    const { servicio, create } = crearServicio();

    await servicio.registrar({
      actor: ACTOR,
      entidad: 'Sala',
      entidadId: 'sala-1',
      accion: 'CREADA',
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        tenantId: 'gym-1',
        usuarioId: 'usr-1',
        entidad: 'Sala',
        entidadId: 'sala-1',
        accion: 'CREADA',
      },
    });
  });

  it('incluye el detalle cuando se pasa', async () => {
    const { servicio, create } = crearServicio();

    await servicio.registrar({
      actor: ACTOR,
      entidad: 'Reserva',
      entidadId: 'res-1',
      accion: 'CANCELADA',
      detalle: { tipo: 'RECUPERABLE' },
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ detalle: { tipo: 'RECUPERABLE' } }),
    });
  });

  it('omite la clave detalle si no se pasa, en vez de mandar undefined', async () => {
    const { servicio, create } = crearServicio();

    await servicio.registrar({
      actor: ACTOR,
      entidad: 'Sala',
      entidadId: 'sala-1',
      accion: 'CREADA',
    });

    expect(Object.keys(create.mock.calls[0][0].data)).not.toContain('detalle');
  });

  it('usa el cliente de transaccion cuando se le pasa uno', async () => {
    const { servicio, create } = crearServicio();
    const createTx = jest.fn().mockResolvedValue({ id: 'hist-2' });
    const tx = { historialAccion: { create: createTx } };

    await servicio.registrar(
      { actor: ACTOR, entidad: 'Turno', entidadId: 'tur-1', accion: 'CREADA' },
      tx as never,
    );

    // La auditoria tiene que vivir o morir con el cambio que la origino: si
    // escribiera fuera de la transaccion, un rollback dejaria historial de algo
    // que nunca paso.
    expect(createTx).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Verificar que falla**

```bash
pnpm --filter @boxadmin/api test -- historial
```

Esperado: FAIL — `Cannot find module './historial.service'`.

- [ ] **Step 3: Implementar el servicio**

Crear `apps/api/src/common/historial/historial.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { JwtPayload } from '@boxadmin/shared';
import { PrismaService, type ClientePrismaTx } from '../../prisma/prisma.service';

/** Entidades de las que se guarda rastro. */
export type EntidadAuditable = 'Sala' | 'Pack' | 'Usuario' | 'Turno' | 'Reserva';

export type AccionAuditable =
  | 'CREADA'
  | 'ACTUALIZADA'
  | 'DADA_DE_BAJA'
  | 'ELIMINADA'
  | 'SALAS_ACTUALIZADAS'
  | 'PASSWORD_RESETEADA'
  | 'CANCELADA'
  | 'REASIGNADA';

export interface EntradaHistorial {
  /** Quien ejecuta. De el salen tanto el tenantId como el usuarioId. */
  actor: JwtPayload;
  entidad: EntidadAuditable;
  entidadId: string;
  accion: AccionAuditable;
  detalle?: Record<string, unknown>;
}

@Injectable()
export class HistorialService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registra una accion.
   *
   * `cliente` permite escribir dentro de la misma transaccion que provoco el
   * cambio, que es como debe usarse siempre que exista una: la auditoria tiene
   * que revertirse con el cambio que la origino. Sin transaccion, se usa el
   * cliente normal.
   */
  async registrar(
    entrada: EntradaHistorial,
    cliente: ClientePrismaTx = this.prisma.db,
  ): Promise<void> {
    await cliente.historialAccion.create({
      data: {
        // tenantId es redundante en tiempo de ejecucion (la extension lo
        // sobrescribe con el mismo valor del contexto), pero el tipo generado
        // por Prisma lo exige bajo strict.
        tenantId: entrada.actor.tenantId,
        usuarioId: entrada.actor.sub,
        entidad: entrada.entidad,
        entidadId: entrada.entidadId,
        accion: entrada.accion,
        // Se omite la clave entera si no hay detalle: una columna Json nullable
        // distingue entre `undefined` (no tocar) y `null` (guardar JSON null), y
        // mandar undefined explicito es pedir una sorpresa.
        ...(entrada.detalle === undefined ? {} : { detalle: entrada.detalle }),
      },
    });
  }
}
```

- [ ] **Step 4: Verificar que pasan**

```bash
pnpm --filter @boxadmin/api test -- historial
```

Esperado: 4 PASS.

- [ ] **Step 5: Crear el módulo global**

Crear `apps/api/src/common/historial/historial.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { HistorialService } from './historial.service';

// Global: lo usan los cinco modulos de la fase y todos los que vengan despues.
// Importarlo uno a uno seria ruido sin beneficio.
@Global()
@Module({
  providers: [HistorialService],
  exports: [HistorialService],
})
export class HistorialModule {}
```

- [ ] **Step 6: Registrarlo en `app.module.ts`**

Añadir el import y meterlo en `imports`, justo después de `PrismaModule`:

```ts
import { HistorialModule } from './common/historial/historial.module';
// ...
    PrismaModule,
    HistorialModule,
    AuthModule,
    JobsModule,
```

- [ ] **Step 7: Suite completa**

```bash
pnpm --filter @boxadmin/api exec tsc --noEmit
pnpm --filter @boxadmin/api test
```

Esperado: 178 tests en verde.

- [ ] **Step 8: Anotar mensaje de commit sugerido**

```
feat(historial): servicio de auditoria sobre historial_acciones

La tabla existia desde la Fase 0 sin que nadie escribiera en ella. El
servicio acepta un cliente de transaccion para que la auditoria se revierta
junto al cambio que la origino.

Archivos: apps/api/src/common/historial/historial.service.ts (+ spec)
          apps/api/src/common/historial/historial.module.ts
          apps/api/src/app.module.ts
```

---

### Task 4: Módulo `salas`

**Files:**
- Create: `apps/api/src/salas/dto/crear-sala.dto.ts`
- Create: `apps/api/src/salas/dto/actualizar-sala.dto.ts`
- Create: `apps/api/src/salas/salas.service.ts` + `salas.service.spec.ts`
- Create: `apps/api/src/salas/salas.controller.ts`
- Create: `apps/api/src/salas/salas.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Escribir los DTOs**

Crear `apps/api/src/salas/dto/crear-sala.dto.ts`:

```ts
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CrearSalaDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  nombre!: string;

  @IsOptional()
  @IsBoolean()
  visibleAlumnos?: boolean;

  @IsOptional()
  @IsBoolean()
  soloCuposLiberados?: boolean;

  @IsOptional()
  @IsBoolean()
  exclusiva?: boolean;

  // null explicito = "hereda del tenant". Por eso son opcionales y no tienen
  // default aqui: el default vive en el schema o en la herencia, no en el DTO.
  @IsOptional()
  @IsInt()
  @Min(1)
  cupoBase?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minMinutosCancelar?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minMinutosAnotarse?: number;

  @IsOptional()
  @IsBoolean()
  listaEsperaHabilitada?: boolean;
}
```

Crear `apps/api/src/salas/dto/actualizar-sala.dto.ts` (explícito, sin `PartialType`: `@nestjs/mapped-types`
no está instalado y no merece una dependencia nueva):

```ts
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class ActualizarSalaDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  nombre?: string;

  @IsOptional()
  @IsBoolean()
  activa?: boolean;

  @IsOptional()
  @IsBoolean()
  visibleAlumnos?: boolean;

  @IsOptional()
  @IsBoolean()
  soloCuposLiberados?: boolean;

  @IsOptional()
  @IsBoolean()
  exclusiva?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  cupoBase?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minMinutosCancelar?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minMinutosAnotarse?: number;

  @IsOptional()
  @IsBoolean()
  listaEsperaHabilitada?: boolean;
}
```

- [ ] **Step 2: Escribir el test del service (falla)**

Crear `apps/api/src/salas/salas.service.spec.ts`:

```ts
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { JwtPayload } from '@boxadmin/shared';
import { SalasService } from './salas.service';
import type { HistorialService } from '../common/historial/historial.service';
import type { PrismaService } from '../prisma/prisma.service';

const ADMIN: JwtPayload = { sub: 'usr-1', tenantId: 'gym-1', rol: 'ADMIN_SALON' };
const ALUMNO: JwtPayload = { sub: 'usr-2', tenantId: 'gym-1', rol: 'ALUMNO' };

const FILA = {
  id: 'sala-1',
  tenantId: 'gym-1',
  nombre: 'Sala A',
  activa: true,
  visibleAlumnos: true,
  soloCuposLiberados: false,
  exclusiva: false,
  cupoBase: null,
  minMinutosCancelar: null,
  minMinutosAnotarse: null,
  listaEsperaHabilitada: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function crearServicio() {
  const sala = {
    create: jest.fn().mockResolvedValue(FILA),
    findFirst: jest.fn().mockResolvedValue(FILA),
    findMany: jest.fn().mockResolvedValue([FILA]),
    update: jest.fn().mockResolvedValue(FILA),
  };
  const turno = { count: jest.fn().mockResolvedValue(0) };

  const db = {
    sala,
    turno,
    // El doble de $transaction ejecuta el callback con el propio db: basta para
    // comprobar la logica; que la transaccion sea real lo verifican los e2e.
    //
    // La anotacion `: unknown` del retorno no es decorativa: sin ella `db` se
    // referencia a si mismo dentro de su propio inicializador y tsc --strict
    // lanza TS7022/TS7024 por inferencia circular.
    $transaction: jest.fn((fn: (tx: unknown) => unknown): unknown => fn(db)),
  };

  const prisma = { db } as unknown as PrismaService;
  const historial = { registrar: jest.fn().mockResolvedValue(undefined) };

  return {
    servicio: new SalasService(prisma, historial as unknown as HistorialService),
    sala,
    turno,
    historial,
  };
}

describe('SalasService.crear', () => {
  it('crea la sala y deja rastro en el historial', async () => {
    const { servicio, sala, historial } = crearServicio();

    const creada = await servicio.crear(ADMIN, { nombre: 'Sala A' });

    expect(sala.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenantId: 'gym-1', nombre: 'Sala A' }),
    });
    expect(historial.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ entidad: 'Sala', entidadId: 'sala-1', accion: 'CREADA' }),
      expect.anything(),
    );
    expect(creada.id).toBe('sala-1');
  });

  it('no filtra createdAt ni updatedAt al cliente', async () => {
    const { servicio } = crearServicio();

    const creada = await servicio.crear(ADMIN, { nombre: 'Sala A' });

    expect(creada).not.toHaveProperty('createdAt');
    expect(creada).not.toHaveProperty('updatedAt');
  });
});

describe('SalasService.listar', () => {
  it('un admin ve todas las salas, incluidas las ocultas y las de baja', async () => {
    const { servicio, sala } = crearServicio();

    await servicio.listar(ADMIN);

    expect(sala.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it('un alumno solo ve las activas y visibles', async () => {
    const { servicio, sala } = crearServicio();

    await servicio.listar(ALUMNO);

    expect(sala.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { activa: true, visibleAlumnos: true } }),
    );
  });
});

describe('SalasService.obtener', () => {
  it('usa findFirst y no findUnique', async () => {
    const { servicio, sala } = crearServicio();

    await servicio.obtener(ADMIN, 'sala-1');

    // findUnique esta prohibido dentro del contexto de tenant: su where solo
    // admite campos unicos, asi que la extension no puede inyectarle el filtro
    // y lanza UnsafeUniqueOperationError.
    expect(sala.findFirst).toHaveBeenCalledWith({ where: { id: 'sala-1' } });
  });

  it('404 si la sala no existe en este gimnasio', async () => {
    const { servicio, sala } = crearServicio();
    sala.findFirst.mockResolvedValue(null);

    await expect(servicio.obtener(ADMIN, 'sala-x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404 para un alumno si la sala esta oculta: no confirma que existe', async () => {
    const { servicio, sala } = crearServicio();
    sala.findFirst.mockResolvedValue({ ...FILA, visibleAlumnos: false });

    await expect(servicio.obtener(ALUMNO, 'sala-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('SalasService.darDeBaja', () => {
  it('marca activa=false en vez de borrar', async () => {
    const { servicio, sala } = crearServicio();

    await servicio.darDeBaja(ADMIN, 'sala-1');

    expect(sala.update).toHaveBeenCalledWith({
      where: { id: 'sala-1' },
      data: { activa: false },
    });
  });

  it('409 si la sala tiene turnos futuros', async () => {
    const { servicio, turno, sala } = crearServicio();
    turno.count.mockResolvedValue(3);

    await expect(servicio.darDeBaja(ADMIN, 'sala-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(sala.update).not.toHaveBeenCalled();
  });

  it('404 si la sala no existe', async () => {
    const { servicio, sala } = crearServicio();
    sala.findFirst.mockResolvedValue(null);

    await expect(servicio.darDeBaja(ADMIN, 'sala-x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
```

- [ ] **Step 3: Verificar que falla**

```bash
pnpm --filter @boxadmin/api test -- salas
```

Esperado: FAIL — `Cannot find module './salas.service'`.

- [ ] **Step 4: Implementar el service**

Crear `apps/api/src/salas/salas.service.ts`:

```ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  comienzoDeHoyUtc,
  rolAlcanza,
  type JwtPayload,
  type SalaPublica,
} from '@boxadmin/shared';
import type { Sala } from '@prisma/client';
import { HistorialService } from '../common/historial/historial.service';
import { PrismaService, type ClientePrismaTx } from '../prisma/prisma.service';
import type { ActualizarSalaDto } from './dto/actualizar-sala.dto';
import type { CrearSalaDto } from './dto/crear-sala.dto';

/** Proyeccion al contrato publico. Deja fuera createdAt y updatedAt a proposito. */
export function aSalaPublica(sala: Sala): SalaPublica {
  return {
    id: sala.id,
    tenantId: sala.tenantId,
    nombre: sala.nombre,
    activa: sala.activa,
    visibleAlumnos: sala.visibleAlumnos,
    soloCuposLiberados: sala.soloCuposLiberados,
    exclusiva: sala.exclusiva,
    cupoBase: sala.cupoBase,
    minMinutosCancelar: sala.minMinutosCancelar,
    minMinutosAnotarse: sala.minMinutosAnotarse,
    listaEsperaHabilitada: sala.listaEsperaHabilitada,
  };
}

/** ¿El actor gestiona el salon, o solo lo usa? */
function esPersonal(actor: JwtPayload): boolean {
  return rolAlcanza(actor.rol, 'ADMIN_OPERATIVO');
}

@Injectable()
export class SalasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly historial: HistorialService,
  ) {}

  async crear(actor: JwtPayload, dto: CrearSalaDto): Promise<SalaPublica> {
    const sala = await this.prisma.db.$transaction(async (tx) => {
      const creada = await (tx as ClientePrismaTx).sala.create({
        data: {
          tenantId: actor.tenantId,
          nombre: dto.nombre,
          visibleAlumnos: dto.visibleAlumnos ?? true,
          soloCuposLiberados: dto.soloCuposLiberados ?? false,
          exclusiva: dto.exclusiva ?? false,
          cupoBase: dto.cupoBase ?? null,
          minMinutosCancelar: dto.minMinutosCancelar ?? null,
          minMinutosAnotarse: dto.minMinutosAnotarse ?? null,
          listaEsperaHabilitada: dto.listaEsperaHabilitada ?? null,
        },
      });

      await this.historial.registrar(
        {
          actor,
          entidad: 'Sala',
          entidadId: creada.id,
          accion: 'CREADA',
          detalle: { nombre: creada.nombre },
        },
        tx as ClientePrismaTx,
      );

      return creada;
    });

    return aSalaPublica(sala);
  }

  async listar(actor: JwtPayload): Promise<SalaPublica[]> {
    // A quien no gestiona el salon se le esconden las salas de baja y las no
    // visibles. El filtro va en el where, no en un .filter() posterior: asi la
    // base nunca llega a devolver filas que el actor no puede ver.
    const where = esPersonal(actor) ? {} : { activa: true, visibleAlumnos: true };

    const salas = await this.prisma.db.sala.findMany({
      where,
      orderBy: { nombre: 'asc' },
    });

    return salas.map(aSalaPublica);
  }

  async obtener(actor: JwtPayload, id: string): Promise<SalaPublica> {
    const sala = await this.buscar(id);

    // Mismo 404 para "no existe" y "no puedes verla": confirmar la existencia
    // de una sala oculta ya seria filtrar informacion.
    if (!esPersonal(actor) && (!sala.activa || !sala.visibleAlumnos)) {
      throw new NotFoundException('Sala inexistente');
    }

    return aSalaPublica(sala);
  }

  async actualizar(
    actor: JwtPayload,
    id: string,
    dto: ActualizarSalaDto,
  ): Promise<SalaPublica> {
    const sala = await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;
      const existente = await cliente.sala.findFirst({ where: { id } });
      if (!existente) throw new NotFoundException('Sala inexistente');

      const actualizada = await cliente.sala.update({ where: { id }, data: { ...dto } });

      await this.historial.registrar(
        { actor, entidad: 'Sala', entidadId: id, accion: 'ACTUALIZADA', detalle: { ...dto } },
        cliente,
      );

      return actualizada;
    });

    return aSalaPublica(sala);
  }

  async darDeBaja(actor: JwtPayload, id: string): Promise<SalaPublica> {
    const sala = await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;
      const existente = await cliente.sala.findFirst({ where: { id } });
      if (!existente) throw new NotFoundException('Sala inexistente');

      // Baja logica, nunca DELETE fisico. Y ni siquiera logica si quedan turnos
      // por delante: dejarlos colgando de una sala de baja produce un calendario
      // con clases que nadie puede usar y que nadie sabe por que estan ahi.
      const turnosFuturos = await cliente.turno.count({
        where: { salaId: id, fecha: { gte: comienzoDeHoyUtc() } },
      });
      if (turnosFuturos > 0) {
        throw new ConflictException(
          `La sala tiene ${turnosFuturos} turno(s) de hoy en adelante. ` +
            'Borralos o reasignalos antes de darla de baja.',
        );
      }

      const baja = await cliente.sala.update({ where: { id }, data: { activa: false } });

      await this.historial.registrar(
        { actor, entidad: 'Sala', entidadId: id, accion: 'DADA_DE_BAJA' },
        cliente,
      );

      return baja;
    });

    return aSalaPublica(sala);
  }

  /** Busca una sala del gimnasio actual o lanza 404. Reutilizable por otros modulos. */
  async buscar(id: string, cliente: ClientePrismaTx = this.prisma.db): Promise<Sala> {
    const sala = await cliente.sala.findFirst({ where: { id } });
    if (!sala) throw new NotFoundException('Sala inexistente');
    return sala;
  }
}
```

- [ ] **Step 5: Verificar que pasan**

```bash
pnpm --filter @boxadmin/api test -- salas
```

Esperado: 10 PASS.

- [ ] **Step 6: Controller y módulo**

Crear `apps/api/src/salas/salas.controller.ts`:

```ts
import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import type { JwtPayload, SalaPublica } from '@boxadmin/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ActualizarSalaDto } from './dto/actualizar-sala.dto';
import { CrearSalaDto } from './dto/crear-sala.dto';
import { SalasService } from './salas.service';

@Controller('salas')
export class SalasController {
  constructor(private readonly salas: SalasService) {}

  @Roles('ADMIN_SALON')
  @Post()
  crear(@CurrentUser() actor: JwtPayload, @Body() dto: CrearSalaDto): Promise<SalaPublica> {
    return this.salas.crear(actor, dto);
  }

  // Sin @Roles: cualquier usuario autenticado del gimnasio. El propio service
  // recorta el listado segun el rol.
  @Get()
  listar(@CurrentUser() actor: JwtPayload): Promise<SalaPublica[]> {
    return this.salas.listar(actor);
  }

  @Get(':id')
  obtener(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
  ): Promise<SalaPublica> {
    return this.salas.obtener(actor, id);
  }

  @Roles('ADMIN_SALON')
  @Patch(':id')
  actualizar(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ActualizarSalaDto,
  ): Promise<SalaPublica> {
    return this.salas.actualizar(actor, id, dto);
  }

  @Roles('ADMIN_SALON')
  @Delete(':id')
  darDeBaja(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
  ): Promise<SalaPublica> {
    return this.salas.darDeBaja(actor, id);
  }
}
```

Crear `apps/api/src/salas/salas.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { SalasController } from './salas.controller';
import { SalasService } from './salas.service';

@Module({
  controllers: [SalasController],
  providers: [SalasService],
  exports: [SalasService],
})
export class SalasModule {}
```

- [ ] **Step 7: Registrar en `app.module.ts`**

```ts
import { SalasModule } from './salas/salas.module';
// ...
    HistorialModule,
    AuthModule,
    SalasModule,
    JobsModule,
```

- [ ] **Step 8: Suite completa**

```bash
pnpm --filter @boxadmin/api exec tsc --noEmit
pnpm --filter @boxadmin/api test
```

Esperado: 188 tests en verde.

- [ ] **Step 9: Anotar mensaje de commit sugerido**

```
feat(salas): CRUD de salas con baja logica

ADMIN_SALON configura; cualquier autenticado lee. A alumnos y profesores se
les filtran las salas de baja y las no visibles en el where, no despues. La
baja es logica y se rechaza con 409 si quedan turnos de hoy en adelante.

Archivos: apps/api/src/salas/ (module, controller, service + spec, dto/)
          apps/api/src/app.module.ts
```

---
### Task 5: Módulo `packs`

El punto 2 del checklist pide que el catálogo de precios sea una sección propia, **no algo escondido
dentro del alta de un alumno**. Por eso `packs` es un módulo completo con su CRUD, y el alta de alumno
solo referencia un `packId` que ya existe.

**Files:**
- Create: `apps/api/src/packs/dto/crear-pack.dto.ts`, `dto/actualizar-pack.dto.ts`
- Create: `apps/api/src/packs/packs.service.ts` + `packs.service.spec.ts`
- Create: `apps/api/src/packs/packs.controller.ts`, `packs.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: DTOs**

Crear `apps/api/src/packs/dto/crear-pack.dto.ts`:

```ts
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import type { TipoPack } from '@boxadmin/shared';

/** Hasta 8 enteros y como mucho 2 decimales: encaja en DECIMAL(10, 2). */
const PATRON_PRECIO = /^\d{1,8}(\.\d{1,2})?$/;

export class CrearPackDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  nombre!: string;

  /** `undefined` = vale para todas las salas. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  salaId?: string;

  @IsIn(['MENSUAL', 'TOTAL'])
  tipo!: TipoPack;

  /**
   * String, nunca number: un float binario no representa 12500.10 exactamente y
   * esto es dinero. `undefined` = "a consultar".
   */
  @IsOptional()
  @Matches(PATRON_PRECIO, {
    message: 'precio debe ser un numero con hasta 2 decimales, como "12500.00"',
  })
  precio?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  clasesPorMes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  clasesTotales?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  cancelacionesPermitidas?: number;
}
```

Crear `apps/api/src/packs/dto/actualizar-pack.dto.ts`: igual que el anterior pero con **todos** los
campos opcionales (incluido `tipo`) y añadiendo:

```ts
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
```

- [ ] **Step 2: Test del service (falla)**

Crear `apps/api/src/packs/packs.service.spec.ts`:

```ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { JwtPayload } from '@boxadmin/shared';
import { PacksService } from './packs.service';
import type { HistorialService } from '../common/historial/historial.service';
import type { PrismaService } from '../prisma/prisma.service';

const ADMIN: JwtPayload = { sub: 'usr-1', tenantId: 'gym-1', rol: 'ADMIN_SALON' };
const ALUMNO: JwtPayload = { sub: 'usr-2', tenantId: 'gym-1', rol: 'ALUMNO' };

const FILA = {
  id: 'pack-1',
  tenantId: 'gym-1',
  nombre: '8 clases',
  salaId: null,
  tipo: 'MENSUAL' as const,
  precio: new Prisma.Decimal('12500.5'),
  clasesPorMes: 8,
  clasesTotales: null,
  cancelacionesPermitidas: 2,
  activo: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function crearServicio() {
  const pack = {
    create: jest.fn().mockResolvedValue(FILA),
    findFirst: jest.fn().mockResolvedValue(FILA),
    findMany: jest.fn().mockResolvedValue([FILA]),
    update: jest.fn().mockResolvedValue(FILA),
  };
  const sala = { findFirst: jest.fn().mockResolvedValue({ id: 'sala-1' }) };
  const db = {
    pack,
    sala,
    $transaction: jest.fn((fn: (tx: unknown) => unknown): unknown => fn(db)),
  };
  const prisma = { db } as unknown as PrismaService;
  const historial = { registrar: jest.fn().mockResolvedValue(undefined) };

  return {
    servicio: new PacksService(prisma, historial as unknown as HistorialService),
    pack,
    sala,
    historial,
  };
}

describe('PacksService.crear', () => {
  it('guarda el precio como Decimal, no como float', async () => {
    const { servicio, pack } = crearServicio();

    await servicio.crear(ADMIN, { nombre: '8 clases', tipo: 'MENSUAL', precio: '12500.50' });

    const enviado = pack.create.mock.calls[0][0].data.precio;
    expect(enviado).toBeInstanceOf(Prisma.Decimal);
    expect(enviado.toFixed(2)).toBe('12500.50');
  });

  it('devuelve el precio como string con dos decimales', async () => {
    const { servicio } = crearServicio();

    const creado = await servicio.crear(ADMIN, { nombre: '8 clases', tipo: 'MENSUAL' });

    expect(creado.precio).toBe('12500.50');
  });

  it('precio ausente significa "a consultar" y viaja como null', async () => {
    const { servicio, pack } = crearServicio();
    pack.create.mockResolvedValue({ ...FILA, precio: null });

    const creado = await servicio.crear(ADMIN, { nombre: 'A consultar', tipo: 'MENSUAL' });

    expect(creado.precio).toBeNull();
  });

  it('400 si un pack MENSUAL trae clasesTotales', async () => {
    const { servicio } = crearServicio();

    await expect(
      servicio.crear(ADMIN, { nombre: 'X', tipo: 'MENSUAL', clasesTotales: 10 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('400 si un pack TOTAL trae clasesPorMes', async () => {
    const { servicio } = crearServicio();

    await expect(
      servicio.crear(ADMIN, { nombre: 'X', tipo: 'TOTAL', clasesPorMes: 8 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404 si la sala indicada no existe en este gimnasio', async () => {
    const { servicio, sala } = crearServicio();
    sala.findFirst.mockResolvedValue(null);

    await expect(
      servicio.crear(ADMIN, { nombre: 'X', tipo: 'MENSUAL', salaId: 'sala-de-otro-gym' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('PacksService.listar', () => {
  it('un alumno solo ve los packs activos', async () => {
    const { servicio, pack } = crearServicio();

    await servicio.listar(ALUMNO, {});

    expect(pack.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { activo: true } }),
    );
  });

  it('un admin los ve todos salvo que filtre', async () => {
    const { servicio, pack } = crearServicio();

    await servicio.listar(ADMIN, {});

    expect(pack.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  it('filtra por sala incluyendo los packs sin sala, que valen para todas', async () => {
    const { servicio, pack } = crearServicio();

    await servicio.listar(ADMIN, { salaId: 'sala-1' });

    expect(pack.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ salaId: 'sala-1' }, { salaId: null }] },
      }),
    );
  });
});

describe('PacksService.darDeBaja', () => {
  it('marca activo=false sin borrar: los perfiles que lo tengan asignado siguen apuntando a el', async () => {
    const { servicio, pack } = crearServicio();

    await servicio.darDeBaja(ADMIN, 'pack-1');

    expect(pack.update).toHaveBeenCalledWith({
      where: { id: 'pack-1' },
      data: { activo: false },
    });
  });
});
```

- [ ] **Step 3: Verificar que falla**

```bash
pnpm --filter @boxadmin/api test -- packs
```

Esperado: FAIL — módulo no encontrado.

- [ ] **Step 4: Implementar el service**

Crear `apps/api/src/packs/packs.service.ts`:

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Pack } from '@prisma/client';
import { rolAlcanza, type JwtPayload, type PackPublico } from '@boxadmin/shared';
import { HistorialService } from '../common/historial/historial.service';
import { PrismaService, type ClientePrismaTx } from '../prisma/prisma.service';
import type { ActualizarPackDto } from './dto/actualizar-pack.dto';
import type { CrearPackDto } from './dto/crear-pack.dto';

export interface FiltroPacks {
  salaId?: string;
  activo?: boolean;
}

export function aPackPublico(pack: Pack): PackPublico {
  return {
    id: pack.id,
    tenantId: pack.tenantId,
    nombre: pack.nombre,
    salaId: pack.salaId,
    tipo: pack.tipo,
    // toFixed(2) sobre el Decimal, no Number(...): convertir a number aqui
    // reintroduciria el error de coma flotante que el Decimal existe para evitar.
    precio: pack.precio === null ? null : pack.precio.toFixed(2),
    clasesPorMes: pack.clasesPorMes,
    clasesTotales: pack.clasesTotales,
    cancelacionesPermitidas: pack.cancelacionesPermitidas,
    activo: pack.activo,
  };
}

@Injectable()
export class PacksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly historial: HistorialService,
  ) {}

  async crear(actor: JwtPayload, dto: CrearPackDto): Promise<PackPublico> {
    this.validarCoherencia(dto.tipo, dto.clasesPorMes, dto.clasesTotales);
    if (dto.salaId) await this.exigirSala(dto.salaId);

    const pack = await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;
      const creado = await cliente.pack.create({
        data: {
          tenantId: actor.tenantId,
          nombre: dto.nombre,
          salaId: dto.salaId ?? null,
          tipo: dto.tipo,
          precio: dto.precio === undefined ? null : new Prisma.Decimal(dto.precio),
          clasesPorMes: dto.clasesPorMes ?? null,
          clasesTotales: dto.clasesTotales ?? null,
          cancelacionesPermitidas: dto.cancelacionesPermitidas ?? null,
        },
      });

      await this.historial.registrar(
        {
          actor,
          entidad: 'Pack',
          entidadId: creado.id,
          accion: 'CREADA',
          detalle: { nombre: creado.nombre, tipo: creado.tipo },
        },
        cliente,
      );

      return creado;
    });

    return aPackPublico(pack);
  }

  async listar(actor: JwtPayload, filtro: FiltroPacks): Promise<PackPublico[]> {
    const where: Prisma.PackWhereInput = {};

    if (!rolAlcanza(actor.rol, 'ADMIN_OPERATIVO')) {
      where.activo = true;
    } else if (filtro.activo !== undefined) {
      where.activo = filtro.activo;
    }

    // Un pack sin sala vale para todas, asi que al filtrar por una sala concreta
    // hay que incluirlo. Omitirlo escondia medio catalogo.
    if (filtro.salaId) {
      where.OR = [{ salaId: filtro.salaId }, { salaId: null }];
    }

    const packs = await this.prisma.db.pack.findMany({ where, orderBy: { nombre: 'asc' } });
    return packs.map(aPackPublico);
  }

  async actualizar(
    actor: JwtPayload,
    id: string,
    dto: ActualizarPackDto,
  ): Promise<PackPublico> {
    const pack = await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;
      const existente = await cliente.pack.findFirst({ where: { id } });
      if (!existente) throw new NotFoundException('Pack inexistente');

      const tipo = dto.tipo ?? existente.tipo;
      const porMes = dto.clasesPorMes ?? existente.clasesPorMes ?? undefined;
      const totales = dto.clasesTotales ?? existente.clasesTotales ?? undefined;
      this.validarCoherencia(tipo, porMes, totales);

      if (dto.salaId) await this.exigirSala(dto.salaId, cliente);

      const actualizado = await cliente.pack.update({
        where: { id },
        data: {
          ...dto,
          precio: dto.precio === undefined ? undefined : new Prisma.Decimal(dto.precio),
        },
      });

      await this.historial.registrar(
        { actor, entidad: 'Pack', entidadId: id, accion: 'ACTUALIZADA', detalle: { ...dto } },
        cliente,
      );

      return actualizado;
    });

    return aPackPublico(pack);
  }

  async darDeBaja(actor: JwtPayload, id: string): Promise<PackPublico> {
    const pack = await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;
      const existente = await cliente.pack.findFirst({ where: { id } });
      if (!existente) throw new NotFoundException('Pack inexistente');

      // Siempre baja logica, tenga o no perfiles asignados. Borrar fisicamente
      // un pack que alguien contrato dejaria perfiles apuntando al vacio y
      // haria imposible calcular sus clases pasadas.
      const baja = await cliente.pack.update({ where: { id }, data: { activo: false } });

      await this.historial.registrar(
        { actor, entidad: 'Pack', entidadId: id, accion: 'DADA_DE_BAJA' },
        cliente,
      );

      return baja;
    });

    return aPackPublico(pack);
  }

  /** Busca un pack del gimnasio actual o lanza 404. La usa el alta de alumno. */
  async buscar(id: string, cliente: ClientePrismaTx = this.prisma.db): Promise<Pack> {
    const pack = await cliente.pack.findFirst({ where: { id } });
    if (!pack) throw new NotFoundException('Pack inexistente');
    return pack;
  }

  private validarCoherencia(
    tipo: 'MENSUAL' | 'TOTAL',
    clasesPorMes: number | undefined,
    clasesTotales: number | undefined,
  ): void {
    if (tipo === 'MENSUAL' && clasesTotales !== undefined && clasesTotales !== null) {
      throw new BadRequestException(
        'Un pack MENSUAL se mide en clasesPorMes; clasesTotales no aplica.',
      );
    }
    if (tipo === 'TOTAL' && clasesPorMes !== undefined && clasesPorMes !== null) {
      throw new BadRequestException(
        'Un pack TOTAL se mide en clasesTotales; clasesPorMes no aplica.',
      );
    }
  }

  private async exigirSala(
    salaId: string,
    cliente: ClientePrismaTx = this.prisma.db,
  ): Promise<void> {
    const sala = await cliente.sala.findFirst({ where: { id: salaId } });
    if (!sala) throw new NotFoundException('Sala inexistente');
  }
}
```

- [ ] **Step 5: Verificar que pasan**

```bash
pnpm --filter @boxadmin/api test -- packs
```

Esperado: 10 PASS.

- [ ] **Step 6: Controller y módulo**

Crear `apps/api/src/packs/packs.controller.ts`:

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseBoolPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { JwtPayload, PackPublico } from '@boxadmin/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ActualizarPackDto } from './dto/actualizar-pack.dto';
import { CrearPackDto } from './dto/crear-pack.dto';
import { PacksService } from './packs.service';

@Controller('packs')
export class PacksController {
  constructor(private readonly packs: PacksService) {}

  @Roles('ADMIN_SALON')
  @Post()
  crear(@CurrentUser() actor: JwtPayload, @Body() dto: CrearPackDto): Promise<PackPublico> {
    return this.packs.crear(actor, dto);
  }

  @Get()
  listar(
    @CurrentUser() actor: JwtPayload,
    @Query('salaId') salaId?: string,
    @Query('activo', new ParseBoolPipe({ optional: true })) activo?: boolean,
  ): Promise<PackPublico[]> {
    return this.packs.listar(actor, { salaId, activo });
  }

  @Roles('ADMIN_SALON')
  @Patch(':id')
  actualizar(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ActualizarPackDto,
  ): Promise<PackPublico> {
    return this.packs.actualizar(actor, id, dto);
  }

  @Roles('ADMIN_SALON')
  @Delete(':id')
  darDeBaja(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
  ): Promise<PackPublico> {
    return this.packs.darDeBaja(actor, id);
  }
}
```

Crear `apps/api/src/packs/packs.module.ts` (mismo patrón que `salas.module.ts`, con
`PacksController` / `PacksService`, exportando el service) y añadir `PacksModule` a `app.module.ts`.

- [ ] **Step 7: Suite completa**

```bash
pnpm --filter @boxadmin/api exec tsc --noEmit
pnpm --filter @boxadmin/api test
```

Esperado: 198 tests en verde.

- [ ] **Step 8: Anotar mensaje de commit sugerido**

```
feat(packs): catalogo de precios como seccion propia

Es un CRUD completo, no un campo escondido dentro del alta de alumno. El
precio se guarda y se devuelve como Decimal/string, nunca como float. Un
pack MENSUAL con clasesTotales (o al reves) es 400. Baja siempre logica.

Archivos: apps/api/src/packs/ (module, controller, service + spec, dto/)
          apps/api/src/app.module.ts
```

---

### Task 5b: arreglos de `salas` y `packs` (surgida de la revision de T3-T5)

Tarea no prevista en el plan original. La revision conjunta de T3-T5 encontro dos bugs, los dos en
`actualizar()`, que era **el unico metodo de los tres modulos sin un solo test**. Esa correlacion no es
casualidad y vale la pena recordarla.

**Bug A — `PATCH /salas/:id` con `{"activa": false}` esquivaba la proteccion de turnos futuros.**
El 409 vivia solo en `darDeBaja()`, pero `actualizar()` hacia `data: { ...dto }` y el DTO exponia
`activa`, asi que se conseguia lo mismo por la puerta de al lado, y ademas quedaba auditado como
`ACTUALIZADA`. Arreglo: la comprobacion pasa a un privado `exigirSinTurnosFuturos()` que usan los dos
caminos, y el PATCH que da de baja se audita como `DADA_DE_BAJA`. `activa: true` no comprueba nada:
reactivar siempre es seguro.

**Bug B — el `tipo` de un pack era inmutable en la practica.**
`actualizar()` heredaba el contador del tipo viejo para validar coherencia, asi que MENSUAL -> TOTAL
lanzaba siempre 400, y como el DTO no admite `null` no habia ninguna secuencia de PATCH que lo
permitiera: habia que borrar el pack y crear otro. Arreglo: al detectar cambio de tipo se ignora el
contador anterior y se anula explicitamente en el `data`, de modo que la fila quede coherente.

**Menores del mismo lote:**

| | Que estaba mal | Arreglo |
|---|---|---|
| C | `exigirSala()` corria fuera de la transaccion en `crear()` | Movida dentro. Evita un `P2003` sin traducir que salia como 500 opaco |
| D | Se podia colgar un pack de una sala dada de baja | 400, pero solo al crear o al cambiar de sala: un pack cuya sala se dio de baja despues sigue siendo editable |
| E | `visibleAlumnos: false` escondia la sala tambien a los **profesores** | Tres niveles: personal ve todo, `PROFESOR` ve las activas, `ALUMNO` ve las activas y visibles. Habria mordido en la Fase 4 |
| F | Repetir el `DELETE` volvia a auditar una baja que no ocurrio | Las bajas son idempotentes |
| G | Faltaba `GET /packs/:id` teniendo `GET /salas/:id` | Anadido, con el mismo criterio de visibilidad que el listado |

Tests de `salas` + `packs`: **20 -> 54**.

---

### Task 6: `usuarios` — altas de alumno y profesor

Esta es la tarea que resuelve el problema de TurnoFit y cubre los puntos 3 y 4 del checklist. **Dos
DTOs distintos, un mismo recurso.** El de profesor no acepta `packId`, `clasesExtra`,
`cancelaciones`, `pagoAlDia` ni vigencias — y como el `ValidationPipe` global corre con
`forbidNonWhitelisted: true`, mandárselos devuelve 400 en vez de ignorarlos en silencio.

**Files:**
- Create: `apps/api/src/usuarios/password-temporal.ts` + `password-temporal.spec.ts`
- Create: `apps/api/src/usuarios/usuarios.mapper.ts`
- Create: `apps/api/src/usuarios/dto/crear-alumno.dto.ts`, `dto/crear-profesor.dto.ts`
- Create: `apps/api/src/usuarios/usuarios.service.ts` + `usuarios.service.spec.ts`
- Create: `apps/api/src/usuarios/usuarios.controller.ts`, `usuarios.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Contraseña temporal — test primero**

Crear `apps/api/src/usuarios/password-temporal.spec.ts`:

```ts
import { generarPasswordTemporal } from './password-temporal';

describe('generarPasswordTemporal', () => {
  it('produce al menos 16 caracteres', () => {
    expect(generarPasswordTemporal().length).toBeGreaterThanOrEqual(16);
  });

  it('solo usa caracteres seguros en URL y al copiar y pegar', () => {
    for (let i = 0; i < 50; i++) {
      expect(generarPasswordTemporal()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('no repite: 200 generaciones dan 200 valores distintos', () => {
    const vistas = new Set(Array.from({ length: 200 }, () => generarPasswordTemporal()));
    expect(vistas.size).toBe(200);
  });
});
```

- [ ] **Step 2: Implementar**

Crear `apps/api/src/usuarios/password-temporal.ts`:

```ts
import { randomBytes } from 'node:crypto';

/**
 * Contraseña inicial de un usuario dado de alta por el admin.
 *
 * `randomBytes`, no `Math.random()`: esto protege una cuenta. 12 bytes en
 * base64url dan 16 caracteres y ~72 bits de entropia, de sobra para una clave
 * que solo vive hasta que el usuario la cambie, y corta como para dictarla por
 * telefono sin equivocarse.
 *
 * Se devuelve al admin UNA sola vez, en la respuesta del alta o del reset. En
 * la base solo queda su hash argon2id.
 */
export function generarPasswordTemporal(): string {
  return randomBytes(12).toString('base64url');
}
```

```bash
pnpm --filter @boxadmin/api test -- password-temporal
```

Esperado: 3 PASS.

- [ ] **Step 3: Los dos DTOs**

Crear `apps/api/src/usuarios/dto/crear-alumno.dto.ts`:

```ts
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { PATRON_FECHA } from '@boxadmin/shared';

export class CrearAlumnoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nombreCompleto!: string;

  @IsEmail()
  @MaxLength(180)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  telefono?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  fichaMedica?: string;

  /**
   * Obligatorio como campo, pero puede venir vacio: un alta sin salas devuelve
   * 201 con la advertencia SIN_SALAS. Exigirlo en el DTO obliga al cliente a
   * tomar una decision consciente en vez de omitirlo sin darse cuenta.
   */
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  salaIds!: string[];

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  packId?: string;

  @IsOptional()
  @IsBoolean()
  pagoAlDia?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  clasesExtra?: number;

  @IsOptional()
  @Matches(PATRON_FECHA, { message: 'vigenciaDesde debe tener formato YYYY-MM-DD' })
  vigenciaDesde?: string;

  @IsOptional()
  @Matches(PATRON_FECHA, { message: 'vigenciaHasta debe tener formato YYYY-MM-DD' })
  vigenciaHasta?: string;
}
```

Crear `apps/api/src/usuarios/dto/crear-profesor.dto.ts`:

```ts
import {
  ArrayUnique,
  IsArray,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * El alta de profesor NO acepta packId, clasesExtra, cancelaciones, pagoAlDia ni
 * vigencias. No es que los ignore: con `forbidNonWhitelisted: true` en el
 * ValidationPipe global, mandarlos devuelve 400.
 *
 * Esta es exactamente la limitacion de TurnoFit que la Fase 1 viene a romper —
 * alli el alta de profesor arrastraba campos de alumno y podia exigir "clases
 * mensuales" a alguien que da la clase.
 */
export class CrearProfesorDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nombreCompleto!: string;

  @IsEmail()
  @MaxLength(180)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  telefono?: string;

  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  salaIds!: string[];
}
```

- [ ] **Step 4: El mapper**

Crear `apps/api/src/usuarios/usuarios.mapper.ts`:

```ts
import { aFechaISO, type UsuarioDetalle, type UsuarioResumen } from '@boxadmin/shared';
import type { Pack, Perfil, Sala, Usuario } from '@prisma/client';
import { aPackPublico } from '../packs/packs.service';
import { aSalaPublica } from '../salas/salas.service';

export interface UsuarioConPerfil {
  usuario: Usuario;
  perfil: Perfil;
  salas: Sala[];
  pack: Pack | null;
}

/** Proyeccion de listado. Nunca incluye fichaMedica. */
export function aUsuarioResumen({ usuario, perfil, salas }: UsuarioConPerfil): UsuarioResumen {
  return {
    id: usuario.id,
    tenantId: usuario.tenantId,
    nombreCompleto: usuario.nombreCompleto,
    email: usuario.email,
    rol: usuario.rol,
    activo: usuario.activo,
    perfilId: perfil.id,
    telefono: perfil.telefono,
    packId: perfil.packId,
    salaIds: salas.map((sala) => sala.id),
  };
}

/**
 * Proyeccion de detalle.
 *
 * `incluyeFichaMedica` no tiene default: obliga a quien llama a decidirlo
 * explicitamente en cada punto de uso. Un default a `false` seria mas comodo y
 * haria que un olvido pasara desapercibido; un default a `true` filtraria el
 * dato. Sin default, el compilador no deja olvidarlo.
 */
export function aUsuarioDetalle(
  datos: UsuarioConPerfil,
  incluyeFichaMedica: boolean,
): UsuarioDetalle {
  const { perfil, pack, salas } = datos;

  return {
    ...aUsuarioResumen(datos),
    ...(incluyeFichaMedica ? { fichaMedica: perfil.fichaMedica } : {}),
    clasesExtra: perfil.clasesExtra,
    cancelacionesUsadas: perfil.cancelacionesUsadas,
    pagoAlDia: perfil.pagoAlDia,
    vigenciaDesde: perfil.vigenciaDesde === null ? null : aFechaISO(perfil.vigenciaDesde),
    vigenciaHasta: perfil.vigenciaHasta === null ? null : aFechaISO(perfil.vigenciaHasta),
    pack: pack === null ? null : aPackPublico(pack),
    salas: salas.map(aSalaPublica),
  };
}
```

- [ ] **Step 5: Test del alta (falla)**

Crear `apps/api/src/usuarios/usuarios.service.spec.ts`:

```ts
import { BadRequestException, ConflictException } from '@nestjs/common';
import type { JwtPayload } from '@boxadmin/shared';
import { UsuariosService } from './usuarios.service';
import type { HistorialService } from '../common/historial/historial.service';
import type { PrismaService } from '../prisma/prisma.service';

const ADMIN: JwtPayload = { sub: 'usr-admin', tenantId: 'gym-1', rol: 'ADMIN_SALON' };

const SALA = {
  id: 'sala-1',
  tenantId: 'gym-1',
  nombre: 'Sala A',
  activa: true,
  visibleAlumnos: true,
  soloCuposLiberados: false,
  exclusiva: false,
  cupoBase: null,
  minMinutosCancelar: null,
  minMinutosAnotarse: null,
  listaEsperaHabilitada: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const USUARIO = {
  id: 'usr-1',
  tenantId: 'gym-1',
  nombreCompleto: 'Ana Perez',
  email: 'ana@gym.com',
  passwordHash: 'hash',
  rol: 'ALUMNO' as const,
  activo: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const PERFIL = {
  id: 'perf-1',
  tenantId: 'gym-1',
  usuarioId: 'usr-1',
  telefono: null,
  fichaMedica: null,
  packId: null,
  clasesExtra: 0,
  cancelacionesUsadas: 0,
  pagoAlDia: false,
  vigenciaDesde: null,
  vigenciaHasta: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function crearServicio() {
  const usuario = {
    findFirst: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue(USUARIO),
    update: jest.fn().mockResolvedValue(USUARIO),
    findMany: jest.fn().mockResolvedValue([USUARIO]),
  };
  const perfil = {
    create: jest.fn().mockResolvedValue(PERFIL),
    findFirst: jest.fn().mockResolvedValue(PERFIL),
    findMany: jest.fn().mockResolvedValue([PERFIL]),
    update: jest.fn().mockResolvedValue(PERFIL),
  };
  const sala = { findMany: jest.fn().mockResolvedValue([SALA]) };
  const usuarioSala = {
    createMany: jest.fn().mockResolvedValue({ count: 1 }),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    findMany: jest.fn().mockResolvedValue([{ perfilId: 'perf-1', salaId: 'sala-1' }]),
  };
  const pack = { findFirst: jest.fn().mockResolvedValue(null) };

  const db = {
    usuario,
    perfil,
    sala,
    usuarioSala,
    pack,
    $transaction: jest.fn((fn: (tx: unknown) => unknown): unknown => fn(db)),
  };
  const prisma = { db } as unknown as PrismaService;
  const historial = { registrar: jest.fn().mockResolvedValue(undefined) };

  return {
    servicio: new UsuariosService(prisma, historial as unknown as HistorialService),
    usuario,
    perfil,
    sala,
    usuarioSala,
    pack,
    historial,
  };
}

describe('UsuariosService.crearAlumno', () => {
  it('crea el Usuario con rol ALUMNO y su Perfil', async () => {
    const { servicio, usuario, perfil } = crearServicio();

    await servicio.crearAlumno(ADMIN, {
      nombreCompleto: 'Ana Perez',
      email: 'Ana@Gym.com',
      salaIds: ['sala-1'],
    });

    expect(usuario.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ rol: 'ALUMNO', email: 'ana@gym.com' }),
    });
    expect(perfil.create).toHaveBeenCalledTimes(1);
  });

  it('devuelve la contrasena temporal una sola vez y no la guarda en claro', async () => {
    const { servicio, usuario } = crearServicio();

    const alta = await servicio.crearAlumno(ADMIN, {
      nombreCompleto: 'Ana',
      email: 'ana@gym.com',
      salaIds: ['sala-1'],
    });

    expect(alta.passwordTemporal).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    const guardado = usuario.create.mock.calls[0][0].data.passwordHash;
    expect(guardado).toMatch(/^\$argon2id\$/);
    expect(guardado).not.toContain(alta.passwordTemporal);
  });

  it('advierte SIN_SALAS en vez de guardar en silencio un alumno inservible', async () => {
    const { servicio, sala } = crearServicio();
    sala.findMany.mockResolvedValue([]);

    const alta = await servicio.crearAlumno(ADMIN, {
      nombreCompleto: 'Ana',
      email: 'ana@gym.com',
      salaIds: [],
    });

    expect(alta.advertencias.map((a) => a.codigo)).toContain('SIN_SALAS');
  });

  it('advierte SIN_PACK si el alumno no trae pack', async () => {
    const { servicio } = crearServicio();

    const alta = await servicio.crearAlumno(ADMIN, {
      nombreCompleto: 'Ana',
      email: 'ana@gym.com',
      salaIds: ['sala-1'],
    });

    expect(alta.advertencias.map((a) => a.codigo)).toContain('SIN_PACK');
  });

  it('no advierte nada cuando el alta viene completa', async () => {
    const { servicio, pack } = crearServicio();
    pack.findFirst.mockResolvedValue({
      id: 'pack-1',
      tenantId: 'gym-1',
      nombre: '8 clases',
      salaId: null,
      tipo: 'MENSUAL',
      precio: null,
      clasesPorMes: 8,
      clasesTotales: null,
      cancelacionesPermitidas: null,
      activo: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const alta = await servicio.crearAlumno(ADMIN, {
      nombreCompleto: 'Ana',
      email: 'ana@gym.com',
      salaIds: ['sala-1'],
      packId: 'pack-1',
    });

    expect(alta.advertencias).toEqual([]);
  });

  it('409 si el email ya existe en este gimnasio', async () => {
    const { servicio, usuario } = crearServicio();
    usuario.findFirst.mockResolvedValue(USUARIO);

    await expect(
      servicio.crearAlumno(ADMIN, {
        nombreCompleto: 'Ana',
        email: 'ana@gym.com',
        salaIds: [],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('busca el email con findFirst: findUnique esta prohibido dentro del tenant', async () => {
    const { servicio, usuario } = crearServicio();

    await servicio.crearAlumno(ADMIN, {
      nombreCompleto: 'Ana',
      email: 'ana@gym.com',
      salaIds: [],
    });

    expect(usuario.findFirst).toHaveBeenCalledWith({ where: { email: 'ana@gym.com' } });
  });

  it('400 si alguna sala no pertenece a este gimnasio', async () => {
    const { servicio, sala } = crearServicio();
    sala.findMany.mockResolvedValue([SALA]); // solo una de las dos pedidas

    await expect(
      servicio.crearAlumno(ADMIN, {
        nombreCompleto: 'Ana',
        email: 'ana@gym.com',
        salaIds: ['sala-1', 'sala-de-otro-gym'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('deja rastro del alta en el historial', async () => {
    const { servicio, historial } = crearServicio();

    await servicio.crearAlumno(ADMIN, {
      nombreCompleto: 'Ana',
      email: 'ana@gym.com',
      salaIds: ['sala-1'],
    });

    expect(historial.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ entidad: 'Usuario', accion: 'CREADA' }),
      expect.anything(),
    );
  });
});

describe('UsuariosService.crearProfesor', () => {
  it('crea el Usuario con rol PROFESOR y un Perfil sin datos de alumno', async () => {
    const { servicio, usuario, perfil } = crearServicio();

    await servicio.crearProfesor(ADMIN, {
      nombreCompleto: 'Luis Gomez',
      email: 'luis@gym.com',
      salaIds: ['sala-1'],
    });

    expect(usuario.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ rol: 'PROFESOR' }),
    });

    const datosPerfil = perfil.create.mock.calls[0][0].data;
    expect(datosPerfil.packId).toBeNull();
    expect(datosPerfil.pagoAlDia).toBe(false);
    expect(datosPerfil.clasesExtra).toBe(0);
  });

  it('nunca advierte SIN_PACK: un profesor no tiene pack', async () => {
    const { servicio } = crearServicio();

    const alta = await servicio.crearProfesor(ADMIN, {
      nombreCompleto: 'Luis',
      email: 'luis@gym.com',
      salaIds: ['sala-1'],
    });

    expect(alta.advertencias.map((a) => a.codigo)).not.toContain('SIN_PACK');
  });

  it('si advierte SIN_SALAS cuando se le olvidan las salas', async () => {
    const { servicio, sala } = crearServicio();
    sala.findMany.mockResolvedValue([]);

    const alta = await servicio.crearProfesor(ADMIN, {
      nombreCompleto: 'Luis',
      email: 'luis@gym.com',
      salaIds: [],
    });

    expect(alta.advertencias.map((a) => a.codigo)).toEqual(['SIN_SALAS']);
  });
});
```

- [ ] **Step 6: Verificar que falla**

```bash
pnpm --filter @boxadmin/api test -- usuarios.service
```

Esperado: FAIL — módulo no encontrado.

- [ ] **Step 7: Implementar el alta**

Crear `apps/api/src/usuarios/usuarios.service.ts` (esta tarea escribe el alta; la T7 añade el resto de
métodos a esta misma clase):

```ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import type { Pack, Perfil, Sala, Usuario } from '@prisma/client';
import {
  desdeFechaISO,
  type Advertencia,
  type AltaUsuarioRespuesta,
  type JwtPayload,
  type RolUsuario,
} from '@boxadmin/shared';
import { HistorialService } from '../common/historial/historial.service';
import { PrismaService, type ClientePrismaTx } from '../prisma/prisma.service';
import type { CrearAlumnoDto } from './dto/crear-alumno.dto';
import type { CrearProfesorDto } from './dto/crear-profesor.dto';
import { generarPasswordTemporal } from './password-temporal';
import { aUsuarioDetalle, type UsuarioConPerfil } from './usuarios.mapper';

/** Datos que solo tiene un alumno. Un profesor entra con esto en `undefined`. */
interface DatosDeAlumno {
  packId?: string;
  pagoAlDia?: boolean;
  clasesExtra?: number;
  vigenciaDesde?: string;
  vigenciaHasta?: string;
}

@Injectable()
export class UsuariosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly historial: HistorialService,
  ) {}

  crearAlumno(actor: JwtPayload, dto: CrearAlumnoDto): Promise<AltaUsuarioRespuesta> {
    return this.crear(actor, 'ALUMNO', dto, {
      packId: dto.packId,
      pagoAlDia: dto.pagoAlDia,
      clasesExtra: dto.clasesExtra,
      vigenciaDesde: dto.vigenciaDesde,
      vigenciaHasta: dto.vigenciaHasta,
    });
  }

  crearProfesor(actor: JwtPayload, dto: CrearProfesorDto): Promise<AltaUsuarioRespuesta> {
    // Sin datos de alumno. No es que se ignoren: el DTO ni los acepta.
    return this.crear(actor, 'PROFESOR', dto, undefined);
  }

  private async crear(
    actor: JwtPayload,
    rol: Extract<RolUsuario, 'ALUMNO' | 'PROFESOR'>,
    base: { nombreCompleto: string; email: string; telefono?: string; fichaMedica?: string; salaIds: string[] },
    alumno: DatosDeAlumno | undefined,
  ): Promise<AltaUsuarioRespuesta> {
    const email = base.email.toLowerCase();

    // findFirst y no findUnique: dentro de un contexto de tenant, findUnique
    // lanza UnsafeUniqueOperationError porque su where solo admite campos
    // unicos y la extension no puede inyectarle el tenantId. El filtro por
    // gimnasio lo pone ella sola sobre este findFirst.
    const yaExiste = await this.prisma.db.usuario.findFirst({ where: { email } });
    if (yaExiste) {
      throw new ConflictException('Ya hay un usuario con ese email en este gimnasio');
    }

    const salas = await this.resolverSalas(base.salaIds);
    const pack = alumno?.packId ? await this.resolverPack(alumno.packId) : null;

    // El hash se calcula FUERA de la transaccion: argon2id tarda ~40 ms a
    // proposito, y mantener una transaccion abierta ese tiempo por cada alta
    // castiga a todo el que este esperando una fila.
    const passwordTemporal = generarPasswordTemporal();
    const passwordHash = await argon2.hash(passwordTemporal, { type: argon2.argon2id });

    const creado = await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      const usuario = await cliente.usuario.create({
        data: {
          tenantId: actor.tenantId,
          nombreCompleto: base.nombreCompleto,
          email,
          passwordHash,
          rol,
        },
      });

      const perfil = await cliente.perfil.create({
        data: {
          tenantId: actor.tenantId,
          usuarioId: usuario.id,
          telefono: base.telefono ?? null,
          fichaMedica: base.fichaMedica ?? null,
          packId: alumno?.packId ?? null,
          pagoAlDia: alumno?.pagoAlDia ?? false,
          clasesExtra: alumno?.clasesExtra ?? 0,
          vigenciaDesde: alumno?.vigenciaDesde
            ? desdeFechaISO(alumno.vigenciaDesde)
            : null,
          vigenciaHasta: alumno?.vigenciaHasta
            ? desdeFechaISO(alumno.vigenciaHasta)
            : null,
        },
      });

      if (salas.length > 0) {
        await cliente.usuarioSala.createMany({
          data: salas.map((sala) => ({
            tenantId: actor.tenantId,
            perfilId: perfil.id,
            salaId: sala.id,
          })),
        });
      }

      await this.historial.registrar(
        {
          actor,
          entidad: 'Usuario',
          entidadId: usuario.id,
          accion: 'CREADA',
          detalle: { rol, email, salaIds: salas.map((s) => s.id) },
        },
        cliente,
      );

      return { usuario, perfil };
    });

    const datos: UsuarioConPerfil = { ...creado, salas, pack };

    return {
      ...aUsuarioDetalle(datos, true),
      passwordTemporal,
      advertencias: this.advertenciasDeAlta(rol, salas, pack),
    };
  }

  /**
   * Advertencias que no bloquean el alta pero que el admin tiene que ver.
   *
   * Guardar en silencio un alumno sin salas es el bug de "Sin sala" de
   * Wellness: el alta parecia funcionar y el alumno no podia reservar nada.
   */
  private advertenciasDeAlta(
    rol: RolUsuario,
    salas: Sala[],
    pack: Pack | null,
  ): Advertencia[] {
    const advertencias: Advertencia[] = [];

    if (salas.length === 0) {
      advertencias.push({
        codigo: 'SIN_SALAS',
        mensaje:
          'El usuario no tiene ninguna sala con acceso, asi que no podra reservar. ' +
          'Asignale salas con PATCH /usuarios/:id/salas.',
      });
    }

    if (rol === 'ALUMNO' && pack === null) {
      advertencias.push({
        codigo: 'SIN_PACK',
        mensaje: 'El alumno no tiene pack asignado; sus clases no tendran tope definido.',
      });
    }

    return advertencias;
  }

  /** Comprueba que todas las salas pedidas existen en este gimnasio. */
  private async resolverSalas(
    salaIds: string[],
    cliente: ClientePrismaTx = this.prisma.db,
  ): Promise<Sala[]> {
    if (salaIds.length === 0) return [];

    const salas = await cliente.sala.findMany({ where: { id: { in: salaIds } } });

    if (salas.length !== salaIds.length) {
      const encontradas = new Set(salas.map((sala) => sala.id));
      const faltan = salaIds.filter((id) => !encontradas.has(id));
      // 400 y no 404: el problema esta en el cuerpo de la peticion, y decir
      // cuales fallan ahorra una ronda de depuracion. Las salas de otro
      // gimnasio caen aqui tambien, porque la extension ya las filtro.
      throw new BadRequestException(`Salas inexistentes en este gimnasio: ${faltan.join(', ')}`);
    }

    return salas;
  }

  private async resolverPack(
    packId: string,
    cliente: ClientePrismaTx = this.prisma.db,
  ): Promise<Pack> {
    const pack = await cliente.pack.findFirst({ where: { id: packId } });
    if (!pack) throw new NotFoundException('Pack inexistente');
    return pack;
  }
}
```

- [ ] **Step 8: Verificar que pasan**

```bash
pnpm --filter @boxadmin/api test -- usuarios.service
```

Esperado: 13 PASS.

- [ ] **Step 9: Controller (solo las altas por ahora) y módulo**

Crear `apps/api/src/usuarios/usuarios.controller.ts`:

```ts
import { Body, Controller, Post } from '@nestjs/common';
import type { AltaUsuarioRespuesta, JwtPayload } from '@boxadmin/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CrearAlumnoDto } from './dto/crear-alumno.dto';
import { CrearProfesorDto } from './dto/crear-profesor.dto';
import { UsuariosService } from './usuarios.service';

@Controller('usuarios')
export class UsuariosController {
  constructor(private readonly usuarios: UsuariosService) {}

  @Roles('ADMIN_OPERATIVO')
  @Post('alumnos')
  crearAlumno(
    @CurrentUser() actor: JwtPayload,
    @Body() dto: CrearAlumnoDto,
  ): Promise<AltaUsuarioRespuesta> {
    return this.usuarios.crearAlumno(actor, dto);
  }

  @Roles('ADMIN_OPERATIVO')
  @Post('profesores')
  crearProfesor(
    @CurrentUser() actor: JwtPayload,
    @Body() dto: CrearProfesorDto,
  ): Promise<AltaUsuarioRespuesta> {
    return this.usuarios.crearProfesor(actor, dto);
  }
}
```

Crear `apps/api/src/usuarios/usuarios.module.ts` (mismo patrón que los anteriores) y registrarlo en
`app.module.ts` después de `PacksModule`.

- [ ] **Step 10: Suite completa**

```bash
pnpm --filter @boxadmin/api exec tsc --noEmit
pnpm --filter @boxadmin/api test
```

Esperado: 214 tests en verde.

- [ ] **Step 11: Anotar mensaje de commit sugerido**

```
feat(usuarios): alta separada de alumno y profesor

Dos DTOs distintos sobre el mismo recurso. El de profesor no acepta packId,
clases, cancelaciones ni vigencias, y con forbidNonWhitelisted mandarselos
es 400: un profesor no puede volver a recibir un error de "clases mensuales
requerido". El alta sin salas devuelve 201 con la advertencia SIN_SALAS en
vez de guardar en silencio un usuario inservible.

La contrasena temporal se genera con randomBytes, se devuelve una sola vez y
en la base solo queda su hash argon2id.

Archivos: apps/api/src/usuarios/ (module, controller, service + spec, mapper,
          password-temporal + spec, dto/)
          apps/api/src/app.module.ts
```

---
### Task 7: `usuarios` — listado, detalle, edición, salas, reset y baja

Se añaden métodos a la clase `UsuariosService` que ya existe y rutas al controller de la T6.

**Files:**
- Create: `apps/api/src/usuarios/dto/actualizar-usuario.dto.ts`, `dto/actualizar-salas.dto.ts`
- Modify: `apps/api/src/usuarios/usuarios.service.ts`, `usuarios.service.spec.ts`, `usuarios.controller.ts`
- Modify: `apps/api/src/usuarios/usuarios.mapper.ts`

- [ ] **Step 1: DTOs**

Crear `apps/api/src/usuarios/dto/actualizar-usuario.dto.ts`:

```ts
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { PATRON_FECHA } from '@boxadmin/shared';

/**
 * Edicion de perfil. Acepta los campos de alumno, pero el service los rechaza
 * con 400 si el usuario es PROFESOR: el DTO es uno solo porque la ruta es una
 * sola, y la separacion que importa —la del alta— ya esta hecha en dos DTOs.
 */
export class ActualizarUsuarioDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nombreCompleto?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  telefono?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  fichaMedica?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  packId?: string;

  @IsOptional()
  @IsBoolean()
  pagoAlDia?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  clasesExtra?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  cancelacionesUsadas?: number;

  @IsOptional()
  @Matches(PATRON_FECHA, { message: 'vigenciaDesde debe tener formato YYYY-MM-DD' })
  vigenciaDesde?: string;

  @IsOptional()
  @Matches(PATRON_FECHA, { message: 'vigenciaHasta debe tener formato YYYY-MM-DD' })
  vigenciaHasta?: string;
}
```

Crear `apps/api/src/usuarios/dto/actualizar-salas.dto.ts`:

```ts
import { ArrayNotEmpty, ArrayUnique, IsArray, IsString } from 'class-validator';

/**
 * `@ArrayNotEmpty` es el punto entero de este DTO.
 *
 * El alta admite cero salas y devuelve una advertencia, porque ahi puede faltar
 * informacion legitimamente. Pero una peticion cuyo unico proposito es fijar
 * las salas y que manda cero es siempre un error. Guardarla en silencio es el
 * bug de "Sin sala" de Wellness, y aqui se cierra con un 400.
 */
export class ActualizarSalasDto {
  @IsArray()
  @ArrayNotEmpty({
    message:
      'Un usuario sin salas no puede reservar nada. Manda al menos una sala, ' +
      'o da de baja al usuario si es lo que querias.',
  })
  @ArrayUnique()
  @IsString({ each: true })
  salaIds!: string[];
}
```

- [ ] **Step 2: Ampliar el mapper con el adaptador de la consulta anidada**

Añadir al final de `apps/api/src/usuarios/usuarios.mapper.ts`:

```ts
import type { Prisma } from '@prisma/client';

/** Forma que devuelve la consulta de listado y detalle. */
export type UsuarioConRelaciones = Prisma.UsuarioGetPayload<{
  include: { perfil: { include: { pack: true; salas: { include: { sala: true } } } } };
}>;

/**
 * Aplana la consulta anidada a la forma que consumen los mapeadores.
 *
 * Un Usuario sin Perfil no deberia existir —el alta crea los dos en la misma
 * transaccion— pero el tipo lo permite porque la relacion es opcional en el
 * schema. Devolver `null` y filtrarlo es preferible a un `!` que reventaria con
 * un TypeError opaco si alguna vez pasa.
 */
export function aplanar(fila: UsuarioConRelaciones): UsuarioConPerfil | null {
  if (!fila.perfil) return null;

  return {
    usuario: fila,
    perfil: fila.perfil,
    salas: fila.perfil.salas.map((union) => union.sala),
    pack: fila.perfil.pack,
  };
}
```

- [ ] **Step 3: Tests de los métodos nuevos (fallan)**

Añadir a `apps/api/src/usuarios/usuarios.service.spec.ts`. Extender primero el doble de Prisma del
`crearServicio()` que ya existe, sustituyendo `usuario.findMany` por una versión que devuelva la forma
anidada y añadiendo `usuario.findFirst` con relaciones:

```ts
const CON_RELACIONES = {
  ...USUARIO,
  perfil: { ...PERFIL, pack: null, salas: [{ sala: SALA }] },
};
```

y dentro de `crearServicio()`:

```ts
  usuario.findMany.mockResolvedValue([CON_RELACIONES]);
  const usuarioConRelaciones = jest.fn().mockResolvedValue(CON_RELACIONES);
  usuario.findFirst.mockImplementation((args: { include?: unknown }) =>
    args?.include ? usuarioConRelaciones() : null,
  );
```

Tests:

```ts
const OPERATIVO: JwtPayload = { sub: 'usr-op', tenantId: 'gym-1', rol: 'ADMIN_OPERATIVO' };
const PROPIO: JwtPayload = { sub: 'usr-1', tenantId: 'gym-1', rol: 'ALUMNO' };
const OTRO_ALUMNO: JwtPayload = { sub: 'usr-9', tenantId: 'gym-1', rol: 'ALUMNO' };

describe('UsuariosService.listar', () => {
  it('tipo=alumno filtra por rol ALUMNO', async () => {
    const { servicio, usuario } = crearServicio();

    await servicio.listar(ADMIN, { tipo: 'alumno' });

    expect(usuario.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ rol: 'ALUMNO' }) }),
    );
  });

  it('tipo=profesor filtra por rol PROFESOR', async () => {
    const { servicio, usuario } = crearServicio();

    await servicio.listar(ADMIN, { tipo: 'profesor' });

    expect(usuario.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ rol: 'PROFESOR' }) }),
    );
  });

  it('sin tipo devuelve alumnos y profesores, pero no administradores', async () => {
    const { servicio, usuario } = crearServicio();

    await servicio.listar(ADMIN, {});

    expect(usuario.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ rol: { in: ['ALUMNO', 'PROFESOR'] } }),
      }),
    );
  });

  it('filtra por sala con acceso', async () => {
    const { servicio, usuario } = crearServicio();

    await servicio.listar(ADMIN, { salaId: 'sala-1' });

    expect(usuario.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          perfil: { salas: { some: { salaId: 'sala-1' } } },
        }),
      }),
    );
  });

  it('nunca incluye fichaMedica en el listado', async () => {
    const { servicio } = crearServicio();

    const lista = await servicio.listar(ADMIN, {});

    expect(lista[0]).not.toHaveProperty('fichaMedica');
  });
});

describe('UsuariosService.obtener', () => {
  it('ADMIN_SALON ve la ficha medica', async () => {
    const { servicio } = crearServicio();

    const detalle = await servicio.obtener(ADMIN, 'usr-1');

    expect(detalle).toHaveProperty('fichaMedica');
  });

  it('ADMIN_OPERATIVO no ve la ficha medica de otro', async () => {
    const { servicio } = crearServicio();

    const detalle = await servicio.obtener(OPERATIVO, 'usr-1');

    expect(detalle).not.toHaveProperty('fichaMedica');
  });

  it('el propio usuario si ve su ficha medica', async () => {
    const { servicio } = crearServicio();

    const detalle = await servicio.obtener(PROPIO, 'usr-1');

    expect(detalle).toHaveProperty('fichaMedica');
  });

  it('403 si un alumno pide el detalle de otro', async () => {
    const { servicio } = crearServicio();

    await expect(servicio.obtener(OTRO_ALUMNO, 'usr-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('404 si el usuario no existe en este gimnasio', async () => {
    const { servicio, usuario } = crearServicio();
    usuario.findFirst.mockResolvedValue(null);

    await expect(servicio.obtener(ADMIN, 'usr-x')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('UsuariosService.actualizar', () => {
  it('400 si se intenta asignar un pack a un profesor', async () => {
    const { servicio, usuario } = crearServicio();
    usuario.findFirst.mockResolvedValue({
      ...CON_RELACIONES,
      rol: 'PROFESOR',
    });

    await expect(
      servicio.actualizar(ADMIN, 'usr-1', { packId: 'pack-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('un profesor si puede cambiar nombre y telefono', async () => {
    const { servicio, usuario, perfil } = crearServicio();
    usuario.findFirst.mockResolvedValue({ ...CON_RELACIONES, rol: 'PROFESOR' });

    await servicio.actualizar(ADMIN, 'usr-1', { telefono: '600123456' });

    expect(perfil.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ telefono: '600123456' }) }),
    );
  });
});

describe('UsuariosService.actualizarSalas', () => {
  it('reemplaza el conjunto de salas y lo audita', async () => {
    const { servicio, usuarioSala, historial } = crearServicio();

    await servicio.actualizarSalas(ADMIN, 'usr-1', { salaIds: ['sala-1'] });

    expect(usuarioSala.deleteMany).toHaveBeenCalledWith({ where: { perfilId: 'perf-1' } });
    expect(usuarioSala.createMany).toHaveBeenCalledWith({
      data: [{ tenantId: 'gym-1', perfilId: 'perf-1', salaId: 'sala-1' }],
    });
    expect(historial.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'SALAS_ACTUALIZADAS' }),
      expect.anything(),
    );
  });

  it('400 con lista vacia: no deja a nadie sin salas en silencio', async () => {
    const { servicio, usuarioSala } = crearServicio();

    await expect(
      servicio.actualizarSalas(ADMIN, 'usr-1', { salaIds: [] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(usuarioSala.deleteMany).not.toHaveBeenCalled();
  });
});

describe('UsuariosService.resetearPassword', () => {
  it('devuelve una clave nueva y guarda solo su hash', async () => {
    const { servicio, usuario } = crearServicio();

    const resultado = await servicio.resetearPassword(ADMIN, 'usr-1');

    expect(resultado.passwordTemporal).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    const guardado = usuario.update.mock.calls[0][0].data.passwordHash;
    expect(guardado).toMatch(/^\$argon2id\$/);
    expect(guardado).not.toContain(resultado.passwordTemporal);
  });

  it('lo deja registrado en el historial', async () => {
    const { servicio, historial } = crearServicio();

    await servicio.resetearPassword(ADMIN, 'usr-1');

    expect(historial.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'PASSWORD_RESETEADA' }),
      expect.anything(),
    );
  });
});

describe('UsuariosService.darDeBaja', () => {
  it('marca activo=false en vez de borrar', async () => {
    const { servicio, usuario } = crearServicio();

    await servicio.darDeBaja(ADMIN, 'usr-1');

    expect(usuario.update).toHaveBeenCalledWith({
      where: { id: 'usr-1' },
      data: { activo: false },
    });
  });
});
```

Añadir al bloque de imports del spec:

```ts
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
```

- [ ] **Step 4: Verificar que fallan**

```bash
pnpm --filter @boxadmin/api test -- usuarios.service
```

Esperado: FAIL — `servicio.listar is not a function`, etc.

- [ ] **Step 5: Implementar los métodos**

Añadir a `apps/api/src/usuarios/usuarios.service.ts` (y sus imports):

```ts
import { ForbiddenException } from '@nestjs/common';
import {
  rolAlcanza,
  type ResetPasswordRespuesta,
  type TipoUsuarioNegocio,
  type UsuarioDetalle,
  type UsuarioResumen,
} from '@boxadmin/shared';
import type { ActualizarSalasDto } from './dto/actualizar-salas.dto';
import type { ActualizarUsuarioDto } from './dto/actualizar-usuario.dto';
import { aUsuarioResumen, aplanar, type UsuarioConRelaciones } from './usuarios.mapper';

export interface FiltroUsuarios {
  tipo?: TipoUsuarioNegocio;
  salaId?: string;
  activo?: boolean;
}

/** Campos que solo tienen sentido en un alumno. */
const CAMPOS_DE_ALUMNO = [
  'packId',
  'pagoAlDia',
  'clasesExtra',
  'cancelacionesUsadas',
  'vigenciaDesde',
  'vigenciaHasta',
] as const;

const RELACIONES = {
  perfil: { include: { pack: true, salas: { include: { sala: true } } } },
} as const;
```

y los métodos, dentro de la clase:

```ts
  async listar(actor: JwtPayload, filtro: FiltroUsuarios): Promise<UsuarioResumen[]> {
    const where: Record<string, unknown> = {
      // Sin tipo se listan alumnos y profesores, nunca administradores: este
      // endpoint es "Administrar Usuarios" del salon, no la gestion de cuentas
      // del sistema.
      rol: filtro.tipo === undefined
        ? { in: ['ALUMNO', 'PROFESOR'] }
        : filtro.tipo === 'alumno'
          ? 'ALUMNO'
          : 'PROFESOR',
    };

    if (filtro.activo !== undefined) where.activo = filtro.activo;
    if (filtro.salaId) where.perfil = { salas: { some: { salaId: filtro.salaId } } };

    const filas = await this.prisma.db.usuario.findMany({
      where,
      include: RELACIONES,
      orderBy: { nombreCompleto: 'asc' },
    });

    return filas
      .map((fila) => aplanar(fila as UsuarioConRelaciones))
      .filter((datos): datos is NonNullable<typeof datos> => datos !== null)
      .map(aUsuarioResumen);
  }

  async obtener(actor: JwtPayload, id: string): Promise<UsuarioDetalle> {
    const esPersonal = rolAlcanza(actor.rol, 'ADMIN_OPERATIVO');
    // Un alumno solo puede pedir su propio detalle. 403 y no 404 a proposito:
    // aqui no hay nada que ocultar, el actor sabe perfectamente que el recurso
    // existe porque le acaba de pasar un id.
    if (!esPersonal && actor.sub !== id) {
      throw new ForbiddenException('Solo puedes consultar tu propio perfil');
    }

    const datos = await this.buscarConRelaciones(id);

    // La ficha medica es un dato de salud: la ven ADMIN_SALON y su dueno. Un
    // ADMIN_OPERATIVO gestiona turnos y reservas, no necesita el historial
    // clinico de nadie.
    const puedeVerFicha = rolAlcanza(actor.rol, 'ADMIN_SALON') || actor.sub === id;

    return aUsuarioDetalle(datos, puedeVerFicha);
  }

  async actualizar(
    actor: JwtPayload,
    id: string,
    dto: ActualizarUsuarioDto,
  ): Promise<UsuarioDetalle> {
    const datos = await this.buscarConRelaciones(id);

    if (datos.usuario.rol === 'PROFESOR') {
      const invalidos = CAMPOS_DE_ALUMNO.filter((campo) => dto[campo] !== undefined);
      if (invalidos.length > 0) {
        throw new BadRequestException(
          `Un profesor no tiene ${invalidos.join(', ')}. Esos campos son de alumno.`,
        );
      }
    }

    if (dto.packId) await this.resolverPack(dto.packId);

    await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      if (dto.nombreCompleto !== undefined) {
        await cliente.usuario.update({
          where: { id },
          data: { nombreCompleto: dto.nombreCompleto },
        });
      }

      await cliente.perfil.update({
        where: { id: datos.perfil.id },
        data: {
          telefono: dto.telefono,
          fichaMedica: dto.fichaMedica,
          packId: dto.packId,
          pagoAlDia: dto.pagoAlDia,
          clasesExtra: dto.clasesExtra,
          cancelacionesUsadas: dto.cancelacionesUsadas,
          vigenciaDesde: dto.vigenciaDesde ? desdeFechaISO(dto.vigenciaDesde) : undefined,
          vigenciaHasta: dto.vigenciaHasta ? desdeFechaISO(dto.vigenciaHasta) : undefined,
        },
      });

      await this.historial.registrar(
        { actor, entidad: 'Usuario', entidadId: id, accion: 'ACTUALIZADA', detalle: { ...dto } },
        cliente,
      );
    });

    return aUsuarioDetalle(await this.buscarConRelaciones(id), true);
  }

  async actualizarSalas(
    actor: JwtPayload,
    id: string,
    dto: ActualizarSalasDto,
  ): Promise<UsuarioDetalle> {
    // Doble cinturon: el DTO ya lleva @ArrayNotEmpty, pero el service tambien lo
    // comprueba para que la regla siga viva si alguien llama al servicio desde
    // otro sitio (un job, un seed) sin pasar por el ValidationPipe.
    if (dto.salaIds.length === 0) {
      throw new BadRequestException(
        'Un usuario sin salas no puede reservar nada. Manda al menos una sala.',
      );
    }

    const datos = await this.buscarConRelaciones(id);
    const salas = await this.resolverSalas(dto.salaIds);

    await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      // Reemplazo completo, no merge: el cliente manda el conjunto final.
      await cliente.usuarioSala.deleteMany({ where: { perfilId: datos.perfil.id } });
      await cliente.usuarioSala.createMany({
        data: salas.map((sala) => ({
          tenantId: actor.tenantId,
          perfilId: datos.perfil.id,
          salaId: sala.id,
        })),
      });

      await this.historial.registrar(
        {
          actor,
          entidad: 'Usuario',
          entidadId: id,
          accion: 'SALAS_ACTUALIZADAS',
          detalle: {
            antes: datos.salas.map((sala) => sala.id),
            despues: salas.map((sala) => sala.id),
          },
        },
        cliente,
      );
    });

    return aUsuarioDetalle(await this.buscarConRelaciones(id), true);
  }

  async resetearPassword(actor: JwtPayload, id: string): Promise<ResetPasswordRespuesta> {
    await this.buscarConRelaciones(id);

    const passwordTemporal = generarPasswordTemporal();
    const passwordHash = await argon2.hash(passwordTemporal, { type: argon2.argon2id });

    await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;
      await cliente.usuario.update({ where: { id }, data: { passwordHash } });
      await this.historial.registrar(
        { actor, entidad: 'Usuario', entidadId: id, accion: 'PASSWORD_RESETEADA' },
        cliente,
      );
    });

    return { usuarioId: id, passwordTemporal };
  }

  async darDeBaja(actor: JwtPayload, id: string): Promise<UsuarioDetalle> {
    await this.buscarConRelaciones(id);

    await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;
      // Baja logica. Las reservas futuras NO se cancelan aqui: eso es una
      // decision de negocio que el admin debe tomar a mano, y cancelarlas en
      // silencio borraria lugares que quiza queria conservar.
      await cliente.usuario.update({ where: { id }, data: { activo: false } });
      await this.historial.registrar(
        { actor, entidad: 'Usuario', entidadId: id, accion: 'DADA_DE_BAJA' },
        cliente,
      );
    });

    return aUsuarioDetalle(await this.buscarConRelaciones(id), true);
  }

  /** Carga usuario + perfil + salas + pack, o lanza 404. */
  private async buscarConRelaciones(
    id: string,
    cliente: ClientePrismaTx = this.prisma.db,
  ): Promise<UsuarioConPerfil> {
    const fila = await cliente.usuario.findFirst({ where: { id }, include: RELACIONES });
    if (!fila) throw new NotFoundException('Usuario inexistente');

    const datos = aplanar(fila as UsuarioConRelaciones);
    if (!datos) throw new NotFoundException('El usuario no tiene perfil de negocio');

    return datos;
  }
```

- [ ] **Step 6: Verificar que pasan**

```bash
pnpm --filter @boxadmin/api test -- usuarios.service
```

Esperado: 28 PASS.

- [ ] **Step 7: Completar el controller**

Añadir a `apps/api/src/usuarios/usuarios.controller.ts`:

```ts
  @Roles('ADMIN_OPERATIVO')
  @Get()
  listar(
    @CurrentUser() actor: JwtPayload,
    @Query('tipo') tipo?: TipoUsuarioNegocio,
    @Query('salaId') salaId?: string,
    @Query('activo', new ParseBoolPipe({ optional: true })) activo?: boolean,
  ): Promise<UsuarioResumen[]> {
    return this.usuarios.listar(actor, { tipo, salaId, activo });
  }

  // Sin @Roles: el propio service decide, porque un alumno puede pedir su
  // propio detalle y un @Roles('ADMIN_OPERATIVO') se lo impediria.
  @Get(':id')
  obtener(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
  ): Promise<UsuarioDetalle> {
    return this.usuarios.obtener(actor, id);
  }

  @Roles('ADMIN_OPERATIVO')
  @Patch(':id')
  actualizar(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ActualizarUsuarioDto,
  ): Promise<UsuarioDetalle> {
    return this.usuarios.actualizar(actor, id, dto);
  }

  @Roles('ADMIN_OPERATIVO')
  @Patch(':id/salas')
  actualizarSalas(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ActualizarSalasDto,
  ): Promise<UsuarioDetalle> {
    return this.usuarios.actualizarSalas(actor, id, dto);
  }

  @Roles('ADMIN_SALON')
  @HttpCode(200)
  @Post(':id/reset-password')
  resetearPassword(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
  ): Promise<ResetPasswordRespuesta> {
    return this.usuarios.resetearPassword(actor, id);
  }

  @Roles('ADMIN_OPERATIVO')
  @Delete(':id')
  darDeBaja(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
  ): Promise<UsuarioDetalle> {
    return this.usuarios.darDeBaja(actor, id);
  }
```

⚠️ **Orden de rutas.** `@Post('alumnos')` y `@Post('profesores')` deben quedar **antes** que
`@Post(':id/reset-password')` en el archivo. Express resuelve por orden de declaración y `:id` captura
cualquier cosa. Como las altas ya están escritas arriba desde la T6, basta con añadir esto al final.

Ajustar los imports del controller:

```ts
import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseBoolPipe, Patch, Post, Query,
} from '@nestjs/common';
import type {
  AltaUsuarioRespuesta, JwtPayload, ResetPasswordRespuesta,
  TipoUsuarioNegocio, UsuarioDetalle, UsuarioResumen,
} from '@boxadmin/shared';
import { ActualizarSalasDto } from './dto/actualizar-salas.dto';
import { ActualizarUsuarioDto } from './dto/actualizar-usuario.dto';
```

- [ ] **Step 8: Suite completa**

```bash
pnpm --filter @boxadmin/api exec tsc --noEmit
pnpm --filter @boxadmin/api test
```

Esperado: 229 tests en verde.

- [ ] **Step 9: Anotar mensaje de commit sugerido**

```
feat(usuarios): listado, detalle, edicion, salas, reset y baja

PATCH /usuarios/:id/salas rechaza la lista vacia con 400 en vez de dejar al
usuario sin salas en silencio. La ficha medica solo la ven ADMIN_SALON y el
propio usuario, y nunca aparece en listados. Editar campos de alumno sobre un
profesor es 400.

Archivos: apps/api/src/usuarios/usuarios.service.ts (+ spec)
          apps/api/src/usuarios/usuarios.controller.ts
          apps/api/src/usuarios/usuarios.mapper.ts
          apps/api/src/usuarios/dto/actualizar-usuario.dto.ts
          apps/api/src/usuarios/dto/actualizar-salas.dto.ts
```

---

### Task 8: Módulo `turnos`

**Files:**
- Create: `apps/api/src/turnos/dto/crear-turno.dto.ts`, `dto/actualizar-turno.dto.ts`
- Create: `apps/api/src/turnos/turnos.service.ts` + `turnos.service.spec.ts`
- Create: `apps/api/src/turnos/turnos.controller.ts`, `turnos.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: DTOs**

Crear `apps/api/src/turnos/dto/crear-turno.dto.ts`:

```ts
import { IsInt, IsNotEmpty, IsString, Matches, MaxLength, Min } from 'class-validator';
import { PATRON_FECHA, PATRON_HORA } from '@boxadmin/shared';

export class CrearTurnoDto {
  @IsString()
  @IsNotEmpty()
  salaId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  nombre!: string;

  @Matches(PATRON_FECHA, { message: 'fecha debe tener formato YYYY-MM-DD' })
  fecha!: string;

  @Matches(PATRON_HORA, { message: 'horaInicio debe tener formato HH:MM en 24 h' })
  horaInicio!: string;

  @Matches(PATRON_HORA, { message: 'horaFin debe tener formato HH:MM en 24 h' })
  horaFin!: string;

  @IsInt()
  @Min(1)
  cupo!: number;
}
```

Crear `apps/api/src/turnos/dto/actualizar-turno.dto.ts`: los mismos campos, todos con `@IsOptional()`
delante y sin `salaId` (mover un turno de sala invalidaría los accesos de quienes ya reservaron; si
hace falta, se borra y se recrea).

- [ ] **Step 2: Test del service (falla)**

Crear `apps/api/src/turnos/turnos.service.spec.ts`:

```ts
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { JwtPayload } from '@boxadmin/shared';
import { TurnosService } from './turnos.service';
import type { HistorialService } from '../common/historial/historial.service';
import type { PrismaService } from '../prisma/prisma.service';

const ADMIN: JwtPayload = { sub: 'usr-1', tenantId: 'gym-1', rol: 'ADMIN_OPERATIVO' };

const FILA = {
  id: 'turno-1',
  tenantId: 'gym-1',
  salaId: 'sala-1',
  nombre: 'Pilates',
  fecha: new Date('2026-10-05T00:00:00.000Z'),
  horaInicio: '18:00',
  horaFin: '19:00',
  cupo: 10,
  createdAt: new Date(),
  updatedAt: new Date(),
  _count: { reservas: 3 },
};

function crearServicio() {
  const turno = {
    create: jest.fn().mockResolvedValue(FILA),
    findFirst: jest.fn().mockResolvedValue(FILA),
    findMany: jest.fn().mockResolvedValue([FILA]),
    update: jest.fn().mockResolvedValue(FILA),
    delete: jest.fn().mockResolvedValue(FILA),
  };
  const sala = { findFirst: jest.fn().mockResolvedValue({ id: 'sala-1', activa: true }) };
  const reserva = { count: jest.fn().mockResolvedValue(3) };

  const db = {
    turno,
    sala,
    reserva,
    $transaction: jest.fn((fn: (tx: unknown) => unknown): unknown => fn(db)),
  };
  const prisma = { db } as unknown as PrismaService;
  const historial = { registrar: jest.fn().mockResolvedValue(undefined) };

  return {
    servicio: new TurnosService(prisma, historial as unknown as HistorialService),
    turno,
    sala,
    reserva,
    historial,
  };
}

describe('TurnosService.crear', () => {
  it('guarda la fecha como medianoche UTC del dia indicado', async () => {
    const { servicio, turno } = crearServicio();

    await servicio.crear(ADMIN, {
      salaId: 'sala-1',
      nombre: 'Pilates',
      fecha: '2026-10-05',
      horaInicio: '18:00',
      horaFin: '19:00',
      cupo: 10,
    });

    const guardada: Date = turno.create.mock.calls[0][0].data.fecha;
    expect(guardada.toISOString()).toBe('2026-10-05T00:00:00.000Z');
  });

  it('devuelve la fecha como YYYY-MM-DD, sin hora ni huso', async () => {
    const { servicio } = crearServicio();

    const creado = await servicio.crear(ADMIN, {
      salaId: 'sala-1',
      nombre: 'Pilates',
      fecha: '2026-10-05',
      horaInicio: '18:00',
      horaFin: '19:00',
      cupo: 10,
    });

    expect(creado.fecha).toBe('2026-10-05');
  });

  it('400 si horaFin no es posterior a horaInicio', async () => {
    const { servicio } = crearServicio();

    await expect(
      servicio.crear(ADMIN, {
        salaId: 'sala-1',
        nombre: 'Pilates',
        fecha: '2026-10-05',
        horaInicio: '19:00',
        horaFin: '18:00',
        cupo: 10,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('400 si las horas son iguales: un turno de duracion cero no existe', async () => {
    const { servicio } = crearServicio();

    await expect(
      servicio.crear(ADMIN, {
        salaId: 'sala-1',
        nombre: 'Pilates',
        fecha: '2026-10-05',
        horaInicio: '18:00',
        horaFin: '18:00',
        cupo: 10,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404 si la sala no existe en este gimnasio', async () => {
    const { servicio, sala } = crearServicio();
    sala.findFirst.mockResolvedValue(null);

    await expect(
      servicio.crear(ADMIN, {
        salaId: 'sala-de-otro-gym',
        nombre: 'Pilates',
        fecha: '2026-10-05',
        horaInicio: '18:00',
        horaFin: '19:00',
        cupo: 10,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('400 si la sala esta dada de baja', async () => {
    const { servicio, sala } = crearServicio();
    sala.findFirst.mockResolvedValue({ id: 'sala-1', activa: false });

    await expect(
      servicio.crear(ADMIN, {
        salaId: 'sala-1',
        nombre: 'Pilates',
        fecha: '2026-10-05',
        horaInicio: '18:00',
        horaFin: '19:00',
        cupo: 10,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('TurnosService.listar', () => {
  it('calcula lugares libres restando solo las reservas no canceladas', async () => {
    const { servicio } = crearServicio();

    const [turno] = await servicio.listar(ADMIN, {});

    expect(turno.cupo).toBe(10);
    expect(turno.reservasActivas).toBe(3);
    expect(turno.lugaresLibres).toBe(7);
  });

  it('cuenta solo reservas con canceladaEn null', async () => {
    const { servicio, turno } = crearServicio();

    await servicio.listar(ADMIN, {});

    expect(turno.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { _count: { select: { reservas: { where: { canceladaEn: null } } } } },
      }),
    );
  });

  it('filtra por rango de fechas', async () => {
    const { servicio, turno } = crearServicio();

    await servicio.listar(ADMIN, { desde: '2026-10-01', hasta: '2026-10-31' });

    expect(turno.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          fecha: {
            gte: new Date('2026-10-01T00:00:00.000Z'),
            lte: new Date('2026-10-31T00:00:00.000Z'),
          },
        }),
      }),
    );
  });

  it('soloLibres descarta los turnos completos', async () => {
    const { servicio, turno } = crearServicio();
    turno.findMany.mockResolvedValue([
      FILA,
      { ...FILA, id: 'turno-2', cupo: 3, _count: { reservas: 3 } },
    ]);

    const libres = await servicio.listar(ADMIN, { soloLibres: true });

    expect(libres.map((t) => t.id)).toEqual(['turno-1']);
  });
});

describe('TurnosService.actualizar', () => {
  it('409 si el cupo nuevo es menor que las reservas activas', async () => {
    const { servicio, reserva, turno } = crearServicio();
    reserva.count.mockResolvedValue(8);

    await expect(servicio.actualizar(ADMIN, 'turno-1', { cupo: 5 })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(turno.update).not.toHaveBeenCalled();
  });

  it('permite bajar el cupo justo hasta las reservas activas', async () => {
    const { servicio, reserva, turno } = crearServicio();
    reserva.count.mockResolvedValue(5);

    await servicio.actualizar(ADMIN, 'turno-1', { cupo: 5 });

    expect(turno.update).toHaveBeenCalled();
  });
});

describe('TurnosService.eliminar', () => {
  it('409 si el turno tiene reservas activas', async () => {
    const { servicio, reserva, turno } = crearServicio();
    reserva.count.mockResolvedValue(1);

    await expect(servicio.eliminar(ADMIN, 'turno-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(turno.delete).not.toHaveBeenCalled();
  });

  it('borra fisicamente si no queda ninguna reserva activa', async () => {
    const { servicio, reserva, turno, historial } = crearServicio();
    reserva.count.mockResolvedValue(0);

    await servicio.eliminar(ADMIN, 'turno-1');

    expect(turno.delete).toHaveBeenCalledWith({ where: { id: 'turno-1' } });
    expect(historial.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ entidad: 'Turno', accion: 'ELIMINADA' }),
      expect.anything(),
    );
  });
});
```

- [ ] **Step 3: Verificar que falla**

```bash
pnpm --filter @boxadmin/api test -- turnos
```

Esperado: FAIL — módulo no encontrado.

- [ ] **Step 4: Implementar el service**

Crear `apps/api/src/turnos/turnos.service.ts`:

```ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  aFechaISO,
  comparaHoras,
  desdeFechaISO,
  type JwtPayload,
  type TurnoPublico,
} from '@boxadmin/shared';
import { HistorialService } from '../common/historial/historial.service';
import { PrismaService, type ClientePrismaTx } from '../prisma/prisma.service';
import type { ActualizarTurnoDto } from './dto/actualizar-turno.dto';
import type { CrearTurnoDto } from './dto/crear-turno.dto';

export interface FiltroTurnos {
  desde?: string;
  hasta?: string;
  salaId?: string;
  soloLibres?: boolean;
}

/** Fila de turno con el recuento de reservas activas ya resuelto por Prisma. */
interface TurnoConRecuento {
  id: string;
  tenantId: string;
  salaId: string;
  nombre: string;
  fecha: Date;
  horaInicio: string;
  horaFin: string;
  cupo: number;
  _count: { reservas: number };
}

/**
 * Solo cuenta reservas con `canceladaEn: null`. Contarlas todas dejaria turnos
 * eternamente "llenos" de gente que ya cancelo.
 */
const RECUENTO_ACTIVAS = {
  _count: { select: { reservas: { where: { canceladaEn: null } } } },
} as const;

export function aTurnoPublico(turno: TurnoConRecuento): TurnoPublico {
  const reservasActivas = turno._count.reservas;

  return {
    id: turno.id,
    tenantId: turno.tenantId,
    salaId: turno.salaId,
    nombre: turno.nombre,
    fecha: aFechaISO(turno.fecha),
    horaInicio: turno.horaInicio,
    horaFin: turno.horaFin,
    cupo: turno.cupo,
    reservasActivas,
    // Nunca negativo: si el admin bajo el cupo por debajo de las reservas ya
    // hechas, "menos dos lugares libres" no significa nada para el cliente.
    lugaresLibres: Math.max(0, turno.cupo - reservasActivas),
  };
}

@Injectable()
export class TurnosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly historial: HistorialService,
  ) {}

  async crear(actor: JwtPayload, dto: CrearTurnoDto): Promise<TurnoPublico> {
    this.exigirHorasCoherentes(dto.horaInicio, dto.horaFin);

    const sala = await this.prisma.db.sala.findFirst({ where: { id: dto.salaId } });
    if (!sala) throw new NotFoundException('Sala inexistente');
    if (!sala.activa) {
      throw new BadRequestException('No se pueden crear turnos en una sala dada de baja');
    }

    const turno = await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      const creado = await cliente.turno.create({
        data: {
          tenantId: actor.tenantId,
          salaId: dto.salaId,
          nombre: dto.nombre,
          fecha: desdeFechaISO(dto.fecha),
          horaInicio: dto.horaInicio,
          horaFin: dto.horaFin,
          cupo: dto.cupo,
        },
      });

      await this.historial.registrar(
        {
          actor,
          entidad: 'Turno',
          entidadId: creado.id,
          accion: 'CREADA',
          detalle: { salaId: dto.salaId, fecha: dto.fecha, horaInicio: dto.horaInicio },
        },
        cliente,
      );

      return creado;
    });

    return aTurnoPublico({ ...turno, _count: { reservas: 0 } });
  }

  async listar(actor: JwtPayload, filtro: FiltroTurnos): Promise<TurnoPublico[]> {
    const where: Record<string, unknown> = {};

    if (filtro.salaId) where.salaId = filtro.salaId;

    if (filtro.desde || filtro.hasta) {
      where.fecha = {
        ...(filtro.desde ? { gte: desdeFechaISO(filtro.desde) } : {}),
        ...(filtro.hasta ? { lte: desdeFechaISO(filtro.hasta) } : {}),
      };
    }

    const turnos = await this.prisma.db.turno.findMany({
      where,
      include: RECUENTO_ACTIVAS,
      orderBy: [{ fecha: 'asc' }, { horaInicio: 'asc' }],
    });

    const publicos = (turnos as unknown as TurnoConRecuento[]).map(aTurnoPublico);

    // El filtro de "solo libres" se aplica despues del recuento porque depende
    // de el; no hay forma de expresarlo como where sin desnormalizar el cupo.
    return filtro.soloLibres ? publicos.filter((t) => t.lugaresLibres > 0) : publicos;
  }

  async obtener(id: string): Promise<TurnoPublico> {
    const turno = await this.prisma.db.turno.findFirst({
      where: { id },
      include: RECUENTO_ACTIVAS,
    });
    if (!turno) throw new NotFoundException('Turno inexistente');

    return aTurnoPublico(turno as unknown as TurnoConRecuento);
  }

  async actualizar(
    actor: JwtPayload,
    id: string,
    dto: ActualizarTurnoDto,
  ): Promise<TurnoPublico> {
    await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      const existente = await cliente.turno.findFirst({ where: { id } });
      if (!existente) throw new NotFoundException('Turno inexistente');

      const inicio = dto.horaInicio ?? existente.horaInicio;
      const fin = dto.horaFin ?? existente.horaFin;
      this.exigirHorasCoherentes(inicio, fin);

      if (dto.cupo !== undefined) {
        const activas = await cliente.reserva.count({
          where: { turnoId: id, canceladaEn: null },
        });
        // Dejar el cupo por debajo de las reservas ya hechas obligaria a elegir
        // a quien echar, y eso no lo decide un PATCH.
        if (dto.cupo < activas) {
          throw new ConflictException(
            `El turno ya tiene ${activas} reserva(s) activa(s); el cupo no puede bajar de ahi. ` +
              'Cancela reservas primero.',
          );
        }
      }

      await cliente.turno.update({
        where: { id },
        data: {
          nombre: dto.nombre,
          fecha: dto.fecha ? desdeFechaISO(dto.fecha) : undefined,
          horaInicio: dto.horaInicio,
          horaFin: dto.horaFin,
          cupo: dto.cupo,
        },
      });

      await this.historial.registrar(
        { actor, entidad: 'Turno', entidadId: id, accion: 'ACTUALIZADA', detalle: { ...dto } },
        cliente,
      );
    });

    return this.obtener(id);
  }

  async eliminar(actor: JwtPayload, id: string): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      const existente = await cliente.turno.findFirst({ where: { id } });
      if (!existente) throw new NotFoundException('Turno inexistente');

      const activas = await cliente.reserva.count({
        where: { turnoId: id, canceladaEn: null },
      });
      if (activas > 0) {
        throw new ConflictException(
          `El turno tiene ${activas} reserva(s) activa(s). Cancelalas antes de borrarlo.`,
        );
      }

      // Borrado fisico, a diferencia de salas y packs: un turno sin reservas
      // activas no es historia de nadie, y un calendario lleno de turnos
      // "de baja" es peor que uno vacio. Las reservas canceladas que cuelguen
      // de el se van con la fila por la FK.
      await cliente.turno.delete({ where: { id } });

      await this.historial.registrar(
        { actor, entidad: 'Turno', entidadId: id, accion: 'ELIMINADA' },
        cliente,
      );
    });
  }

  private exigirHorasCoherentes(inicio: string, fin: string): void {
    if (comparaHoras(fin, inicio) <= 0) {
      throw new BadRequestException('horaFin debe ser posterior a horaInicio');
    }
  }
}
```

⚠️ **Sobre `turno.delete`.** La extensión de tenant clasifica `delete` en `OPERACIONES_CON_WHERE` y le
inyecta `tenantId`, así que el borrado nunca puede alcanzar el turno de otro gimnasio. No hace falta
nada más aquí.

⚠️ **RESUELTO durante la ejecucion, no esperes a los e2e.** La FK `reservas_tenantId_turnoId_fkey`
era `ON DELETE RESTRICT`, asi que un turno cuyas reservas estaban todas CANCELADAS pasaba el
`count({ canceladaEn: null })` de `eliminar()` y despues reventaba. Verificado contra Postgres:

```
ERROR:  update or delete on table "turnos" violates foreign key constraint
        "reservas_tenantId_turnoId_fkey" on table "reservas"
DETAIL:  Key (tenantId, id)=(t1, tu1) is still referenced from table "reservas".
```

Como el error no esta traducido, habria salido como un **500 opaco**. Arreglado en la migracion
`20260914232909_reserva_turno_cascade`: la relacion `Reserva.turno` pasa a `onDelete: Cascade`. La
relacion `Reserva.perfil` se queda en RESTRICT a proposito: un usuario nunca se borra fisicamente, asi
que ese cascade no deberia ocurrir jamas y, si ocurre, queremos que falle ruidosamente.

- [ ] **Step 5: Verificar que pasan**

```bash
pnpm --filter @boxadmin/api test -- turnos
```

Esperado: 14 PASS.

- [ ] **Step 6: Controller y módulo**

Crear `apps/api/src/turnos/turnos.controller.ts` siguiendo el patrón de `salas.controller.ts`:
`@Roles('ADMIN_OPERATIVO')` en `POST`, `PATCH` y `DELETE`; `GET` y `GET /:id` sin `@Roles`; el `DELETE`
con `@HttpCode(204)` porque no devuelve cuerpo. Los query params `desde`, `hasta`, `salaId` como
`@Query(...)` string opcionales y `soloLibres` con `new ParseBoolPipe({ optional: true })`.

Crear `apps/api/src/turnos/turnos.module.ts` (mismo patrón) y registrarlo en `app.module.ts`.

- [ ] **Step 7: Suite completa**

```bash
pnpm --filter @boxadmin/api exec tsc --noEmit
pnpm --filter @boxadmin/api test
```

Esperado: 243 tests en verde.

- [ ] **Step 8: Anotar mensaje de commit sugerido**

```
feat(turnos): CRUD de turnos con recuento de lugares libres

Las fechas entran y salen como YYYY-MM-DD y se guardan a medianoche UTC; las
horas son HH:MM validadas, con horaFin estrictamente posterior. Los lugares
libres cuentan solo reservas sin cancelar. Bajar el cupo por debajo de las
reservas activas es 409, y borrar un turno con reservas activas tambien.

Archivos: apps/api/src/turnos/ (module, controller, service + spec, dto/)
          apps/api/src/app.module.ts
```

---
### Task 9: `reservas` — crear con cupo y concurrencia

El corazón de la fase. Puntos 5 y 6 del checklist.

**Files:**
- Create: `apps/api/src/common/prisma/serializable.ts` + `serializable.spec.ts`
- Create: `apps/api/src/reservas/ventana-pack.ts` + `ventana-pack.spec.ts`
- Create: `apps/api/src/reservas/dto/crear-reserva.dto.ts`
- Create: `apps/api/src/reservas/reservas.service.ts` + `reservas.service.spec.ts`
- Create: `apps/api/src/reservas/reservas.controller.ts`, `reservas.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Test del reintento (falla)**

Crear `apps/api/src/common/prisma/serializable.spec.ts`:

```ts
import {
  conReintentoSerializable,
  esConflictoDeSerializacion,
} from './serializable';

describe('esConflictoDeSerializacion', () => {
  it('reconoce el P2034 de Prisma', () => {
    expect(esConflictoDeSerializacion({ code: 'P2034' })).toBe(true);
  });

  it('reconoce el 40001 crudo de Postgres', () => {
    expect(esConflictoDeSerializacion({ code: '40001' })).toBe(true);
  });

  it('no confunde un error de negocio con un conflicto', () => {
    expect(esConflictoDeSerializacion(new Error('turno lleno'))).toBe(false);
    expect(esConflictoDeSerializacion({ code: 'P2002' })).toBe(false);
    expect(esConflictoDeSerializacion(null)).toBe(false);
    expect(esConflictoDeSerializacion(undefined)).toBe(false);
  });
});

describe('conReintentoSerializable', () => {
  it('no reintenta si va bien a la primera', async () => {
    const fn = jest.fn().mockResolvedValue('ok');

    await expect(conReintentoSerializable(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('reintenta ante un conflicto de serializacion y acaba bien', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce({ code: 'P2034' })
      .mockResolvedValue('ok');

    await expect(conReintentoSerializable(fn, { esperaBaseMs: 0 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('NO reintenta un error de negocio: un turno lleno sigue lleno', async () => {
    const error = new Error('CUPO_COMPLETO');
    const fn = jest.fn().mockRejectedValue(error);

    await expect(conReintentoSerializable(fn, { esperaBaseMs: 0 })).rejects.toBe(error);
    // Reintentar aqui castigaria al usuario con tres veces la latencia para
    // darle exactamente el mismo 409.
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('se rinde tras agotar los intentos y propaga el ultimo error', async () => {
    const fn = jest.fn().mockRejectedValue({ code: 'P2034' });

    await expect(
      conReintentoSerializable(fn, { intentos: 3, esperaBaseMs: 0 }),
    ).rejects.toEqual({ code: 'P2034' });
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 2: Implementar**

Crear `apps/api/src/common/prisma/serializable.ts`:

```ts
/**
 * Codigos que significan "la base aborto tu transaccion porque chocaba con
 * otra, vuelve a intentarlo".
 *
 * - `P2034` es como Prisma envuelve el conflicto.
 * - `40001` (serialization_failure) y `40P01` (deadlock_detected) son los
 *   SQLSTATE de Postgres, que a veces llegan sin envolver.
 *
 * Solo estos se reintentan. Un 409 de negocio —el turno esta lleno— no mejora
 * repitiendolo: reintentarlo triplicaria la latencia para dar la misma
 * respuesta.
 */
const CODIGOS_DE_CONFLICTO = new Set(['P2034', '40001', '40P01']);

export function esConflictoDeSerializacion(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const codigo = (error as { code?: unknown }).code;
  return typeof codigo === 'string' && CODIGOS_DE_CONFLICTO.has(codigo);
}

export interface OpcionesDeReintento {
  intentos?: number;
  esperaBaseMs?: number;
}

const esperar = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Ejecuta `fn` reintentando solo los conflictos de serializacion.
 *
 * Tres intentos con espera creciente (0, 10, 20 ms mas un jitter). El jitter
 * importa: sin el, dos transacciones que chocan vuelven a chocar a la vez al
 * reintentar, y el segundo conflicto es tan probable como el primero.
 */
export async function conReintentoSerializable<T>(
  fn: () => Promise<T>,
  opciones: OpcionesDeReintento = {},
): Promise<T> {
  const intentos = opciones.intentos ?? 3;
  const esperaBaseMs = opciones.esperaBaseMs ?? 10;

  for (let intento = 0; ; intento++) {
    try {
      return await fn();
    } catch (error) {
      const ultimo = intento >= intentos - 1;
      if (ultimo || !esConflictoDeSerializacion(error)) throw error;
      await esperar(esperaBaseMs * (intento + 1) + Math.floor(Math.random() * esperaBaseMs));
    }
  }
}
```

```bash
pnpm --filter @boxadmin/api test -- serializable
```

Esperado: 8 PASS.

- [ ] **Step 3: Ventana del pack — test primero**

Crear `apps/api/src/reservas/ventana-pack.spec.ts`:

```ts
import { topeDelPack, ventanaDeConteo } from './ventana-pack';

const PACK_MENSUAL = {
  tipo: 'MENSUAL' as const,
  clasesPorMes: 8,
  clasesTotales: null,
};

const PACK_TOTAL = {
  tipo: 'TOTAL' as const,
  clasesPorMes: null,
  clasesTotales: 20,
};

const SIN_VIGENCIA = { clasesExtra: 0, vigenciaDesde: null, vigenciaHasta: null };

describe('ventanaDeConteo', () => {
  it('un pack MENSUAL cuenta el mes calendario del turno', () => {
    const ventana = ventanaDeConteo(PACK_MENSUAL, SIN_VIGENCIA, new Date('2026-10-17T00:00:00.000Z'));

    expect(ventana).toEqual({
      gte: new Date('2026-10-01T00:00:00.000Z'),
      lte: new Date('2026-10-31T00:00:00.000Z'),
    });
  });

  it('acierta el ultimo dia en meses de 30 y de 28 dias', () => {
    expect(ventanaDeConteo(PACK_MENSUAL, SIN_VIGENCIA, new Date('2026-11-05T00:00:00.000Z')).lte)
      .toEqual(new Date('2026-11-30T00:00:00.000Z'));
    expect(ventanaDeConteo(PACK_MENSUAL, SIN_VIGENCIA, new Date('2026-02-05T00:00:00.000Z')).lte)
      .toEqual(new Date('2026-02-28T00:00:00.000Z'));
  });

  it('un pack TOTAL cuenta la vigencia del perfil', () => {
    const ventana = ventanaDeConteo(
      PACK_TOTAL,
      {
        clasesExtra: 0,
        vigenciaDesde: new Date('2026-09-01T00:00:00.000Z'),
        vigenciaHasta: new Date('2026-12-31T00:00:00.000Z'),
      },
      new Date('2026-10-17T00:00:00.000Z'),
    );

    expect(ventana).toEqual({
      gte: new Date('2026-09-01T00:00:00.000Z'),
      lte: new Date('2026-12-31T00:00:00.000Z'),
    });
  });

  it('un pack TOTAL sin vigencia cuenta todo el historial del perfil', () => {
    expect(ventanaDeConteo(PACK_TOTAL, SIN_VIGENCIA, new Date('2026-10-17T00:00:00.000Z')))
      .toEqual({});
  });
});

describe('topeDelPack', () => {
  it('un pack MENSUAL usa clasesPorMes', () => {
    expect(topeDelPack(PACK_MENSUAL, SIN_VIGENCIA)).toBe(8);
  });

  it('un pack TOTAL usa clasesTotales', () => {
    expect(topeDelPack(PACK_TOTAL, SIN_VIGENCIA)).toBe(20);
  });

  it('suma las clases extra concedidas al perfil', () => {
    expect(topeDelPack(PACK_MENSUAL, { ...SIN_VIGENCIA, clasesExtra: 2 })).toBe(10);
  });

  it('sin pack no hay tope', () => {
    expect(topeDelPack(null, SIN_VIGENCIA)).toBeNull();
  });

  it('un pack sin numero de clases tampoco impone tope', () => {
    expect(topeDelPack({ tipo: 'MENSUAL', clasesPorMes: null, clasesTotales: null }, SIN_VIGENCIA))
      .toBeNull();
  });
});
```

- [ ] **Step 4: Implementar el cálculo**

Crear `apps/api/src/reservas/ventana-pack.ts`:

```ts
import type { TipoPack } from '@boxadmin/shared';

/** Lo que hace falta de un pack para calcular su tope. */
export interface PackParaConteo {
  tipo: TipoPack;
  clasesPorMes: number | null;
  clasesTotales: number | null;
}

/** Lo que hace falta de un perfil. */
export interface PerfilParaConteo {
  clasesExtra: number;
  vigenciaDesde: Date | null;
  vigenciaHasta: Date | null;
}

/** Filtro de fecha para Prisma. Un objeto vacio significa "sin limites". */
export interface VentanaDeConteo {
  gte?: Date;
  lte?: Date;
}

function primerDiaDelMes(fecha: Date): Date {
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), 1));
}

/** Dia 0 del mes siguiente = ultimo dia de este. Acierta febrero y los bisiestos. */
function ultimoDiaDelMes(fecha: Date): Date {
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth() + 1, 0));
}

/**
 * Periodo sobre el que se cuentan las clases de un perfil.
 *
 * - `MENSUAL`: el mes calendario del turno que se esta reservando. Se usa la
 *   fecha del turno y no la de hoy porque reservar en octubre una clase de
 *   noviembre consume el cupo de noviembre.
 * - `TOTAL`: la vigencia del perfil. Sin vigencia, todo su historial.
 */
export function ventanaDeConteo(
  pack: PackParaConteo | null,
  perfil: PerfilParaConteo,
  fechaDelTurno: Date,
): VentanaDeConteo {
  if (pack === null) return {};

  if (pack.tipo === 'MENSUAL') {
    return { gte: primerDiaDelMes(fechaDelTurno), lte: ultimoDiaDelMes(fechaDelTurno) };
  }

  return {
    ...(perfil.vigenciaDesde ? { gte: perfil.vigenciaDesde } : {}),
    ...(perfil.vigenciaHasta ? { lte: perfil.vigenciaHasta } : {}),
  };
}

/** Numero maximo de clases, o `null` si no hay tope. */
export function topeDelPack(
  pack: PackParaConteo | null,
  perfil: PerfilParaConteo,
): number | null {
  if (pack === null) return null;

  const base = pack.tipo === 'MENSUAL' ? pack.clasesPorMes : pack.clasesTotales;
  if (base === null) return null;

  return base + perfil.clasesExtra;
}
```

```bash
pnpm --filter @boxadmin/api test -- ventana-pack
```

Esperado: 9 PASS.

- [ ] **Step 5: DTO**

Crear `apps/api/src/reservas/dto/crear-reserva.dto.ts`:

```ts
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import type { OrigenReserva } from '@boxadmin/shared';

const ORIGENES: OrigenReserva[] = [
  'ADMIN',
  'ALUMNO',
  'RUTINA',
  'PRUEBA',
  'LISTA_ESPERA',
  'EXTRA',
];

export class CrearReservaDto {
  /**
   * El id del Perfil, no el del Usuario. Los listados de usuarios devuelven
   * `perfilId` justamente para esto.
   */
  @IsString()
  @IsNotEmpty()
  perfilId!: string;

  /** Por defecto ADMIN: en la Fase 1 todas las reservas las asigna el admin. */
  @IsOptional()
  @IsIn(ORIGENES)
  origen?: OrigenReserva;

  @IsOptional()
  @IsBoolean()
  esPrueba?: boolean;

  @IsOptional()
  @IsBoolean()
  pagoRealizado?: boolean;
}
```

- [ ] **Step 6: Test del service (falla)**

Crear `apps/api/src/reservas/reservas.service.spec.ts`:

```ts
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { JwtPayload } from '@boxadmin/shared';
import { ReservasService } from './reservas.service';
import type { HistorialService } from '../common/historial/historial.service';
import type { PrismaService } from '../prisma/prisma.service';

const ADMIN: JwtPayload = { sub: 'usr-admin', tenantId: 'gym-1', rol: 'ADMIN_OPERATIVO' };

const TURNO = {
  id: 'turno-1',
  tenantId: 'gym-1',
  salaId: 'sala-1',
  nombre: 'Pilates',
  fecha: new Date('2026-10-17T00:00:00.000Z'),
  horaInicio: '18:00',
  horaFin: '19:00',
  cupo: 2,
};

const PERFIL = {
  id: 'perf-1',
  tenantId: 'gym-1',
  usuarioId: 'usr-1',
  clasesExtra: 0,
  cancelacionesUsadas: 0,
  vigenciaDesde: null,
  vigenciaHasta: null,
  packId: null,
  pack: null,
  salas: [{ salaId: 'sala-1' }],
};

const RESERVA = {
  id: 'res-1',
  tenantId: 'gym-1',
  turnoId: 'turno-1',
  perfilId: 'perf-1',
  origen: 'ADMIN' as const,
  esPrueba: false,
  pagoRealizado: false,
  canceladaEn: null,
  cancelacionTipo: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function crearServicio() {
  const turno = { findFirst: jest.fn().mockResolvedValue(TURNO) };
  const perfil = {
    findFirst: jest.fn().mockResolvedValue(PERFIL),
    update: jest.fn().mockResolvedValue(PERFIL),
  };
  const reserva = {
    findFirst: jest.fn().mockResolvedValue(null), // no hay duplicada
    count: jest.fn().mockResolvedValue(0), // turno vacio
    create: jest.fn().mockResolvedValue(RESERVA),
    update: jest.fn().mockResolvedValue(RESERVA),
  };

  const db = {
    turno,
    perfil,
    reserva,
    $transaction: jest.fn((fn: (tx: unknown) => unknown): unknown => fn(db)),
  };
  const prisma = { db } as unknown as PrismaService;
  const historial = { registrar: jest.fn().mockResolvedValue(undefined) };

  return {
    servicio: new ReservasService(prisma, historial as unknown as HistorialService),
    turno,
    perfil,
    reserva,
    historial,
    db,
  };
}

describe('ReservasService.crear', () => {
  it('crea la reserva cuando hay lugar', async () => {
    const { servicio, reserva } = crearServicio();

    const creada = await servicio.crear(ADMIN, 'turno-1', { perfilId: 'perf-1' });

    expect(reserva.create).toHaveBeenCalledTimes(1);
    expect(creada.id).toBe('res-1');
    expect(creada.advertencias).toEqual([]);
  });

  it('usa una transaccion Serializable', async () => {
    const { servicio, db } = crearServicio();

    await servicio.crear(ADMIN, 'turno-1', { perfilId: 'perf-1' });

    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it('409 si el turno esta lleno, y sin insertar nada', async () => {
    const { servicio, reserva } = crearServicio();
    reserva.count.mockResolvedValue(2); // cupo del turno = 2

    await expect(
      servicio.crear(ADMIN, 'turno-1', { perfilId: 'perf-1' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(reserva.create).not.toHaveBeenCalled();
  });

  it('cuenta solo las reservas sin cancelar al comprobar el cupo', async () => {
    const { servicio, reserva } = crearServicio();

    await servicio.crear(ADMIN, 'turno-1', { perfilId: 'perf-1' });

    expect(reserva.count).toHaveBeenCalledWith({
      where: { turnoId: 'turno-1', canceladaEn: null },
    });
  });

  it('409 si el perfil ya tiene una reserva activa en ese turno', async () => {
    const { servicio, reserva } = crearServicio();
    reserva.findFirst.mockResolvedValue(RESERVA);

    await expect(
      servicio.crear(ADMIN, 'turno-1', { perfilId: 'perf-1' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(reserva.create).not.toHaveBeenCalled();
  });

  it('403 si el perfil no tiene acceso a la sala del turno', async () => {
    const { servicio, perfil } = crearServicio();
    perfil.findFirst.mockResolvedValue({ ...PERFIL, salas: [{ salaId: 'sala-9' }] });

    await expect(
      servicio.crear(ADMIN, 'turno-1', { perfilId: 'perf-1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('404 si el turno no existe en este gimnasio', async () => {
    const { servicio, turno } = crearServicio();
    turno.findFirst.mockResolvedValue(null);

    await expect(
      servicio.crear(ADMIN, 'turno-x', { perfilId: 'perf-1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404 si el perfil no existe en este gimnasio', async () => {
    const { servicio, perfil } = crearServicio();
    perfil.findFirst.mockResolvedValue(null);

    await expect(
      servicio.crear(ADMIN, 'turno-1', { perfilId: 'perf-de-otro-gym' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('advierte PACK_AGOTADO pero crea igual la reserva', async () => {
    const { servicio, perfil, reserva } = crearServicio();
    perfil.findFirst.mockResolvedValue({
      ...PERFIL,
      packId: 'pack-1',
      pack: { tipo: 'MENSUAL', clasesPorMes: 4, clasesTotales: null },
    });
    // 2 llamadas a count: la del cupo (0) y la del consumo del pack (4)
    reserva.count.mockResolvedValueOnce(0).mockResolvedValueOnce(4);

    const creada = await servicio.crear(ADMIN, 'turno-1', { perfilId: 'perf-1' });

    // El admin manda: puede querer meter una clase de cortesia. Pero se entera.
    expect(reserva.create).toHaveBeenCalledTimes(1);
    expect(creada.advertencias.map((a) => a.codigo)).toEqual(['PACK_AGOTADO']);
  });

  it('no advierte nada si al alumno le quedan clases', async () => {
    const { servicio, perfil, reserva } = crearServicio();
    perfil.findFirst.mockResolvedValue({
      ...PERFIL,
      packId: 'pack-1',
      pack: { tipo: 'MENSUAL', clasesPorMes: 8, clasesTotales: null },
    });
    reserva.count.mockResolvedValueOnce(0).mockResolvedValueOnce(3);

    const creada = await servicio.crear(ADMIN, 'turno-1', { perfilId: 'perf-1' });

    expect(creada.advertencias).toEqual([]);
  });

  it('al contar el consumo del pack ignora las canceladas recuperables', async () => {
    const { servicio, perfil, reserva } = crearServicio();
    perfil.findFirst.mockResolvedValue({
      ...PERFIL,
      packId: 'pack-1',
      pack: { tipo: 'MENSUAL', clasesPorMes: 8, clasesTotales: null },
    });

    await servicio.crear(ADMIN, 'turno-1', { perfilId: 'perf-1' });

    expect(reserva.count).toHaveBeenLastCalledWith({
      where: {
        perfilId: 'perf-1',
        OR: [{ canceladaEn: null }, { cancelacionTipo: 'DEFINITIVA' }],
        turno: {
          fecha: {
            gte: new Date('2026-10-01T00:00:00.000Z'),
            lte: new Date('2026-10-31T00:00:00.000Z'),
          },
        },
      },
    });
  });

  it('deja rastro en el historial', async () => {
    const { servicio, historial } = crearServicio();

    await servicio.crear(ADMIN, 'turno-1', { perfilId: 'perf-1' });

    expect(historial.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ entidad: 'Reserva', entidadId: 'res-1', accion: 'CREADA' }),
      expect.anything(),
    );
  });
});
```

- [ ] **Step 7: Verificar que falla**

```bash
pnpm --filter @boxadmin/api test -- reservas
```

Esperado: FAIL — módulo no encontrado.

- [ ] **Step 8: Implementar el service**

Crear `apps/api/src/reservas/reservas.service.ts`:

```ts
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Reserva } from '@prisma/client';
import type {
  Advertencia,
  JwtPayload,
  ReservaCreada,
  ReservaPublica,
} from '@boxadmin/shared';
import { conReintentoSerializable } from '../common/prisma/serializable';
import { HistorialService } from '../common/historial/historial.service';
import { PrismaService, type ClientePrismaTx } from '../prisma/prisma.service';
import type { CrearReservaDto } from './dto/crear-reserva.dto';
import { topeDelPack, ventanaDeConteo } from './ventana-pack';

export function aReservaPublica(reserva: Reserva): ReservaPublica {
  return {
    id: reserva.id,
    tenantId: reserva.tenantId,
    turnoId: reserva.turnoId,
    perfilId: reserva.perfilId,
    origen: reserva.origen,
    esPrueba: reserva.esPrueba,
    pagoRealizado: reserva.pagoRealizado,
    canceladaEn: reserva.canceladaEn === null ? null : reserva.canceladaEn.toISOString(),
    cancelacionTipo: reserva.cancelacionTipo,
  };
}

/** El perfil con lo que hace falta para decidir sobre una reserva. */
const PERFIL_PARA_RESERVAR = { pack: true, salas: { select: { salaId: true } } } as const;

@Injectable()
export class ReservasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly historial: HistorialService,
  ) {}

  /**
   * Asigna una reserva a un turno.
   *
   * Todo va dentro de una transaccion Serializable porque el cupo es un
   * invariante que dos peticiones simultaneas pueden romper: sin aislamiento,
   * ambas leen "quedan 1" y ambas insertan. Postgres detecta el solape y aborta
   * una de las dos con 40001; `conReintentoSerializable` la repite, y la segunda
   * vez ya lee el cupo lleno y devuelve un 409 honesto.
   *
   * El reintento NO cubre los errores de negocio: un turno lleno sigue lleno.
   */
  async crear(
    actor: JwtPayload,
    turnoId: string,
    dto: CrearReservaDto,
  ): Promise<ReservaCreada> {
    return conReintentoSerializable(() =>
      this.prisma.db.$transaction(
        async (tx) => {
          const cliente = tx as ClientePrismaTx;

          const turno = await cliente.turno.findFirst({ where: { id: turnoId } });
          if (!turno) throw new NotFoundException('Turno inexistente');

          const perfil = await cliente.perfil.findFirst({
            where: { id: dto.perfilId },
            include: PERFIL_PARA_RESERVAR,
          });
          if (!perfil) throw new NotFoundException('Perfil inexistente');

          const tieneAcceso = perfil.salas.some((union) => union.salaId === turno.salaId);
          if (!tieneAcceso) {
            throw new ForbiddenException(
              'El usuario no tiene acceso a la sala de este turno. ' +
                'Asignasela con PATCH /usuarios/:id/salas.',
            );
          }

          const duplicada = await cliente.reserva.findFirst({
            where: { turnoId, perfilId: dto.perfilId, canceladaEn: null },
          });
          if (duplicada) {
            throw new ConflictException('El usuario ya tiene una reserva activa en este turno');
          }

          const activas = await cliente.reserva.count({
            where: { turnoId, canceladaEn: null },
          });
          if (activas >= turno.cupo) {
            throw new ConflictException(
              `El turno esta completo (${activas}/${turno.cupo}).`,
            );
          }

          // Se calcula ANTES de insertar: "agotado" significa que esta reserva
          // queda por encima del tope, no que lo alcanzo justo.
          const advertencias = await this.advertenciasDePack(cliente, perfil, turno.fecha);

          const creada = await cliente.reserva.create({
            data: {
              tenantId: actor.tenantId,
              turnoId,
              perfilId: dto.perfilId,
              origen: dto.origen ?? 'ADMIN',
              esPrueba: dto.esPrueba ?? false,
              pagoRealizado: dto.pagoRealizado ?? false,
            },
          });

          await this.historial.registrar(
            {
              actor,
              entidad: 'Reserva',
              entidadId: creada.id,
              accion: 'CREADA',
              detalle: { turnoId, perfilId: dto.perfilId, origen: creada.origen },
            },
            cliente,
          );

          return { ...aReservaPublica(creada), advertencias };
        },
        { isolationLevel: 'Serializable' },
      ),
    );
  }

  /**
   * ¿Esta reserva deja al alumno por encima de su pack?
   *
   * Cuenta las reservas que consumen clase: las que siguen activas y las
   * canceladas como DEFINITIVA. Las canceladas como RECUPERABLE no cuentan —
   * ahi es exactamente donde "la clase vuelve al perfil".
   */
  private async advertenciasDePack(
    cliente: ClientePrismaTx,
    perfil: {
      id: string;
      clasesExtra: number;
      vigenciaDesde: Date | null;
      vigenciaHasta: Date | null;
      pack: { tipo: 'MENSUAL' | 'TOTAL'; clasesPorMes: number | null; clasesTotales: number | null } | null;
    },
    fechaDelTurno: Date,
  ): Promise<Advertencia[]> {
    const tope = topeDelPack(perfil.pack, perfil);
    if (tope === null) return [];

    const ventana = ventanaDeConteo(perfil.pack, perfil, fechaDelTurno);

    const consumidas = await cliente.reserva.count({
      where: {
        perfilId: perfil.id,
        OR: [{ canceladaEn: null }, { cancelacionTipo: 'DEFINITIVA' }],
        turno: { fecha: ventana },
      },
    });

    if (consumidas < tope) return [];

    return [
      {
        codigo: 'PACK_AGOTADO',
        mensaje:
          `El alumno ya tiene ${consumidas} de ${tope} clases de su pack en este periodo. ` +
          'La reserva se creo igualmente.',
      },
    ];
  }
}
```

- [ ] **Step 9: Verificar que pasan**

```bash
pnpm --filter @boxadmin/api test -- reservas
```

Esperado: 12 PASS.

- [ ] **Step 10: Controller y módulo**

Crear `apps/api/src/reservas/reservas.controller.ts`. Ojo: hay **dos** rutas base, porque crear cuelga
del turno y el resto de la reserva:

```ts
import { Body, Controller, Param, Post } from '@nestjs/common';
import type { JwtPayload, ReservaCreada } from '@boxadmin/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CrearReservaDto } from './dto/crear-reserva.dto';
import { ReservasService } from './reservas.service';

@Controller('turnos/:turnoId/reservas')
export class ReservasDeTurnoController {
  constructor(private readonly reservas: ReservasService) {}

  @Roles('ADMIN_OPERATIVO')
  @Post()
  crear(
    @CurrentUser() actor: JwtPayload,
    @Param('turnoId') turnoId: string,
    @Body() dto: CrearReservaDto,
  ): Promise<ReservaCreada> {
    return this.reservas.crear(actor, turnoId, dto);
  }
}
```

Y `apps/api/src/reservas/reservas.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ReservasDeTurnoController } from './reservas.controller';
import { ReservasService } from './reservas.service';

@Module({
  controllers: [ReservasDeTurnoController],
  providers: [ReservasService],
  exports: [ReservasService],
})
export class ReservasModule {}
```

Registrar `ReservasModule` en `app.module.ts`.

- [ ] **Step 11: Suite completa**

```bash
pnpm --filter @boxadmin/api exec tsc --noEmit
pnpm --filter @boxadmin/api test
```

Esperado: 272 tests en verde.

- [ ] **Step 12: Anotar mensaje de commit sugerido**

```
feat(reservas): asignacion manual con cupo y concurrencia

La creacion va entera en una transaccion Serializable con reintento ante
P2034/40001: dos peticiones sobre el ultimo lugar no pueden pasar las dos.
Los errores de negocio no se reintentan. Un turno lleno es 409, una reserva
duplicada tambien, y una sala sin acceso es 403.

El pack no bloquea: si el alumno lo agoto, la reserva se crea con la
advertencia PACK_AGOTADO. Las clases consumidas se derivan de las reservas y
las canceladas como RECUPERABLE no cuentan; no hay contador almacenado.

Archivos: apps/api/src/reservas/ (module, controller, service + spec,
          ventana-pack + spec, dto/)
          apps/api/src/common/prisma/serializable.ts (+ spec)
          apps/api/src/app.module.ts
```

---

### Task 10: `reservas` — cancelar

Punto 7 del checklist: *recuperable devuelve la clase al perfil; definitiva, no*. Con el conteo
derivado de la T9, eso es automático: basta con marcar bien el tipo.

**Files:**
- Modify: `apps/api/src/reservas/reservas.service.ts`, `reservas.service.spec.ts`, `reservas.controller.ts`
- Create: `apps/api/src/reservas/dto/cancelar-reserva.dto.ts`

- [ ] **Step 1: DTO del query param**

Crear `apps/api/src/reservas/dto/cancelar-reserva.dto.ts`:

```ts
import { IsIn } from 'class-validator';
import type { TipoCancelacion } from '@boxadmin/shared';

/**
 * `?tipo=recuperable|definitiva` en minusculas, como pide el documento; se
 * normaliza al enum antes de guardar.
 */
export class CancelarReservaDto {
  @IsIn(['recuperable', 'definitiva'])
  tipo!: 'recuperable' | 'definitiva';
}

export function aTipoCancelacion(tipo: 'recuperable' | 'definitiva'): TipoCancelacion {
  return tipo === 'recuperable' ? 'RECUPERABLE' : 'DEFINITIVA';
}
```

- [ ] **Step 2: Tests (fallan)**

Añadir a `apps/api/src/reservas/reservas.service.spec.ts`. Primero, ampliar el doble: en
`crearServicio()`, hacer que `reserva.findFirst` devuelva la reserva con su perfil cuando se pida con
`include`:

```ts
  const RESERVA_CON_PERFIL = { ...RESERVA, perfil: { ...PERFIL, usuarioId: 'usr-1' } };
  reserva.findFirst.mockImplementation((args: { include?: unknown }) =>
    args?.include ? RESERVA_CON_PERFIL : null,
  );
```

Tests:

```ts
const ALUMNO_PROPIO: JwtPayload = { sub: 'usr-1', tenantId: 'gym-1', rol: 'ALUMNO' };

describe('ReservasService.cancelar', () => {
  it('marca canceladaEn y el tipo, sin borrar la fila', async () => {
    const { servicio, reserva } = crearServicio();

    await servicio.cancelar(ADMIN, 'res-1', 'RECUPERABLE');

    expect(reserva.update).toHaveBeenCalledWith({
      where: { id: 'res-1' },
      data: { canceladaEn: expect.any(Date), cancelacionTipo: 'RECUPERABLE' },
    });
  });

  it('una cancelacion DEFINITIVA se guarda como tal', async () => {
    const { servicio, reserva } = crearServicio();

    await servicio.cancelar(ADMIN, 'res-1', 'DEFINITIVA');

    expect(reserva.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ cancelacionTipo: 'DEFINITIVA' }) }),
    );
  });

  it('409 si la reserva ya estaba cancelada', async () => {
    const { servicio, reserva } = crearServicio();
    reserva.findFirst.mockResolvedValue({
      ...RESERVA,
      canceladaEn: new Date(),
      cancelacionTipo: 'DEFINITIVA',
      perfil: PERFIL,
    });

    await expect(servicio.cancelar(ADMIN, 'res-1', 'RECUPERABLE')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('404 si la reserva no existe en este gimnasio', async () => {
    const { servicio, reserva } = crearServicio();
    reserva.findFirst.mockResolvedValue(null);

    await expect(servicio.cancelar(ADMIN, 'res-x', 'RECUPERABLE')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('una cancelacion del ADMIN no toca cancelacionesUsadas', async () => {
    const { servicio, perfil } = crearServicio();

    await servicio.cancelar(ADMIN, 'res-1', 'RECUPERABLE');

    // El documento de relevamiento lo dice explicitamente: el contador mide las
    // cancelaciones del alumno, no las correcciones del salon.
    expect(perfil.update).not.toHaveBeenCalled();
  });

  it('si la origina el propio alumno, si incrementa su contador', async () => {
    const { servicio, perfil } = crearServicio();

    await servicio.cancelar(ALUMNO_PROPIO, 'res-1', 'RECUPERABLE');

    expect(perfil.update).toHaveBeenCalledWith({
      where: { id: 'perf-1' },
      data: { cancelacionesUsadas: { increment: 1 } },
    });
  });

  it('lo deja registrado en el historial con el tipo', async () => {
    const { servicio, historial } = crearServicio();

    await servicio.cancelar(ADMIN, 'res-1', 'DEFINITIVA');

    expect(historial.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        entidad: 'Reserva',
        accion: 'CANCELADA',
        detalle: expect.objectContaining({ tipo: 'DEFINITIVA' }),
      }),
      expect.anything(),
    );
  });
});
```

- [ ] **Step 3: Implementar**

Añadir a `ReservasService`:

```ts
  /**
   * Cancela una reserva. Nunca borra la fila: el historial de un alumno se
   * calcula sobre sus reservas, y borrarlas reescribiria el pasado.
   *
   * RECUPERABLE deja de contar contra el pack; DEFINITIVA sigue contando. El
   * efecto es automatico porque el consumo se deriva de las reservas — no hay
   * ningun contador que ajustar aqui.
   */
  async cancelar(
    actor: JwtPayload,
    id: string,
    tipo: TipoCancelacion,
  ): Promise<ReservaPublica> {
    return this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      const reserva = await cliente.reserva.findFirst({
        where: { id },
        include: { perfil: true },
      });
      if (!reserva) throw new NotFoundException('Reserva inexistente');
      if (reserva.canceladaEn !== null) {
        throw new ConflictException('La reserva ya estaba cancelada');
      }

      const cancelada = await cliente.reserva.update({
        where: { id },
        data: { canceladaEn: new Date(), cancelacionTipo: tipo },
      });

      // cancelacionesUsadas mide las cancelaciones DEL ALUMNO, no las
      // correcciones del salon. En la Fase 1 este endpoint solo lo alcanza el
      // personal, asi que la rama del alumno no se ejercita en produccion
      // todavia — pero la regla queda escrita y probada para la Fase 3.
      if (actor.sub === reserva.perfil.usuarioId) {
        await cliente.perfil.update({
          where: { id: reserva.perfilId },
          data: { cancelacionesUsadas: { increment: 1 } },
        });
      }

      await this.historial.registrar(
        {
          actor,
          entidad: 'Reserva',
          entidadId: id,
          accion: 'CANCELADA',
          detalle: { tipo, turnoId: reserva.turnoId, perfilId: reserva.perfilId },
        },
        cliente,
      );

      return aReservaPublica(cancelada);
    });
  }
```

Añadir `TipoCancelacion` al import de tipos de `@boxadmin/shared`.

- [ ] **Step 4: Verificar que pasan**

```bash
pnpm --filter @boxadmin/api test -- reservas
```

Esperado: 19 PASS.

- [ ] **Step 5: Ruta**

Añadir al final de `apps/api/src/reservas/reservas.controller.ts` un segundo controller:

```ts
@Controller('reservas')
export class ReservasController {
  constructor(private readonly reservas: ReservasService) {}

  @Roles('ADMIN_OPERATIVO')
  @Delete(':id')
  cancelar(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
    @Query() query: CancelarReservaDto,
  ): Promise<ReservaPublica> {
    return this.reservas.cancelar(actor, id, aTipoCancelacion(query.tipo));
  }
}
```

Registrarlo en `reservas.module.ts`:

```ts
  controllers: [ReservasDeTurnoController, ReservasController],
```

⚠️ El `ValidationPipe` global corre con `whitelist` y `forbidNonWhitelisted`, así que `@Query()` sobre
un DTO valida de verdad: `?tipo=loquesea` devuelve 400 y omitir `tipo` también. No hace falta un pipe
propio.

- [ ] **Step 6: Suite completa**

```bash
pnpm --filter @boxadmin/api exec tsc --noEmit
pnpm --filter @boxadmin/api test
```

Esperado: 279 tests en verde.

- [ ] **Step 7: Anotar mensaje de commit sugerido**

```
feat(reservas): cancelacion recuperable y definitiva

Nunca se borra la fila. RECUPERABLE deja de contar contra el pack y
DEFINITIVA sigue contando, sin tocar ningun contador: el consumo se deriva de
las reservas. cancelacionesUsadas solo se incrementa cuando la cancelacion la
origina el propio alumno, no cuando corrige el admin.

Archivos: apps/api/src/reservas/reservas.service.ts (+ spec)
          apps/api/src/reservas/reservas.controller.ts
          apps/api/src/reservas/dto/cancelar-reserva.dto.ts
          apps/api/src/reservas/reservas.module.ts
```

---

### Task 11: `reservas` — reasignar

Punto 8 del checklist.

**Files:**
- Create: `apps/api/src/reservas/dto/reasignar-reserva.dto.ts`
- Modify: `apps/api/src/reservas/reservas.service.ts`, `reservas.service.spec.ts`, `reservas.controller.ts`

- [ ] **Step 1: DTO**

Crear `apps/api/src/reservas/dto/reasignar-reserva.dto.ts`:

```ts
import { IsNotEmpty, IsString } from 'class-validator';

export class ReasignarReservaDto {
  /** Turno destino. El origen sale de la propia reserva. */
  @IsString()
  @IsNotEmpty()
  turnoId!: string;
}
```

- [ ] **Step 2: Tests (fallan)**

Añadir a `apps/api/src/reservas/reservas.service.spec.ts`:

```ts
describe('ReservasService.reasignar', () => {
  it('mueve la reserva al turno destino', async () => {
    const { servicio, turno, reserva } = crearServicio();
    turno.findFirst.mockResolvedValue({ ...TURNO, id: 'turno-2', cupo: 5 });

    await servicio.reasignar(ADMIN, 'res-1', { turnoId: 'turno-2' });

    expect(reserva.update).toHaveBeenCalledWith({
      where: { id: 'res-1' },
      data: { turnoId: 'turno-2' },
    });
  });

  it('valida el cupo del turno DESTINO, no el del origen', async () => {
    const { servicio, turno, reserva } = crearServicio();
    turno.findFirst.mockResolvedValue({ ...TURNO, id: 'turno-2', cupo: 2 });
    reserva.count.mockResolvedValue(2); // el destino ya esta lleno

    await expect(
      servicio.reasignar(ADMIN, 'res-1', { turnoId: 'turno-2' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(reserva.update).not.toHaveBeenCalled();
  });

  it('cuenta el cupo del destino, no el de cualquier turno', async () => {
    const { servicio, turno, reserva } = crearServicio();
    turno.findFirst.mockResolvedValue({ ...TURNO, id: 'turno-2', cupo: 5 });

    await servicio.reasignar(ADMIN, 'res-1', { turnoId: 'turno-2' });

    expect(reserva.count).toHaveBeenCalledWith({
      where: { turnoId: 'turno-2', canceladaEn: null },
    });
  });

  it('403 si el perfil no tiene acceso a la sala del destino', async () => {
    const { servicio, turno } = crearServicio();
    turno.findFirst.mockResolvedValue({ ...TURNO, id: 'turno-2', salaId: 'sala-9' });

    await expect(
      servicio.reasignar(ADMIN, 'res-1', { turnoId: 'turno-2' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('409 si se reasigna una reserva ya cancelada', async () => {
    const { servicio, reserva } = crearServicio();
    reserva.findFirst.mockResolvedValue({
      ...RESERVA,
      canceladaEn: new Date(),
      perfil: { ...PERFIL, salas: [{ salaId: 'sala-1' }] },
    });

    await expect(
      servicio.reasignar(ADMIN, 'res-1', { turnoId: 'turno-2' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('409 si el perfil ya tiene una reserva activa en el destino', async () => {
    const { servicio, turno, reserva } = crearServicio();
    turno.findFirst.mockResolvedValue({ ...TURNO, id: 'turno-2', cupo: 5 });
    // findFirst sin include = busqueda de duplicada: devuelve una
    reserva.findFirst.mockImplementation((args: { include?: unknown }) =>
      args?.include
        ? { ...RESERVA, perfil: { ...PERFIL, usuarioId: 'usr-1' } }
        : RESERVA,
    );

    await expect(
      servicio.reasignar(ADMIN, 'res-1', { turnoId: 'turno-2' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('deja rastro con turno de origen y de destino', async () => {
    const { servicio, turno, historial } = crearServicio();
    turno.findFirst.mockResolvedValue({ ...TURNO, id: 'turno-2', cupo: 5 });

    await servicio.reasignar(ADMIN, 'res-1', { turnoId: 'turno-2' });

    expect(historial.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        accion: 'REASIGNADA',
        detalle: expect.objectContaining({ desde: 'turno-1', hasta: 'turno-2' }),
      }),
      expect.anything(),
    );
  });
});
```

- [ ] **Step 3: Implementar**

Añadir a `ReservasService`:

```ts
  /**
   * Mueve una reserva a otro turno.
   *
   * Tambien va en Serializable: si el turno destino tiene un solo lugar y
   * alguien mas lo esta reservando en ese momento, es la misma carrera que en
   * `crear`.
   */
  async reasignar(
    actor: JwtPayload,
    id: string,
    dto: ReasignarReservaDto,
  ): Promise<ReservaPublica> {
    return conReintentoSerializable(() =>
      this.prisma.db.$transaction(
        async (tx) => {
          const cliente = tx as ClientePrismaTx;

          const reserva = await cliente.reserva.findFirst({
            where: { id },
            include: { perfil: { include: PERFIL_PARA_RESERVAR } },
          });
          if (!reserva) throw new NotFoundException('Reserva inexistente');
          if (reserva.canceladaEn !== null) {
            throw new ConflictException(
              'La reserva esta cancelada; crea una nueva en vez de reasignarla',
            );
          }

          const destino = await cliente.turno.findFirst({ where: { id: dto.turnoId } });
          if (!destino) throw new NotFoundException('Turno destino inexistente');

          const tieneAcceso = reserva.perfil.salas.some(
            (union) => union.salaId === destino.salaId,
          );
          if (!tieneAcceso) {
            throw new ForbiddenException(
              'El usuario no tiene acceso a la sala del turno destino',
            );
          }

          const duplicada = await cliente.reserva.findFirst({
            where: { turnoId: dto.turnoId, perfilId: reserva.perfilId, canceladaEn: null },
          });
          if (duplicada) {
            throw new ConflictException(
              'El usuario ya tiene una reserva activa en el turno destino',
            );
          }

          // El cupo que importa es el del destino: el origen solo se vacia.
          const activas = await cliente.reserva.count({
            where: { turnoId: dto.turnoId, canceladaEn: null },
          });
          if (activas >= destino.cupo) {
            throw new ConflictException(
              `El turno destino esta completo (${activas}/${destino.cupo}).`,
            );
          }

          const movida = await cliente.reserva.update({
            where: { id },
            data: { turnoId: dto.turnoId },
          });

          await this.historial.registrar(
            {
              actor,
              entidad: 'Reserva',
              entidadId: id,
              accion: 'REASIGNADA',
              detalle: { desde: reserva.turnoId, hasta: dto.turnoId },
            },
            cliente,
          );

          return aReservaPublica(movida);
        },
        { isolationLevel: 'Serializable' },
      ),
    );
  }
```

- [ ] **Step 4: Verificar que pasan**

```bash
pnpm --filter @boxadmin/api test -- reservas
```

Esperado: 26 PASS.

- [ ] **Step 5: Ruta**

Añadir a `ReservasController`:

```ts
  @Roles('ADMIN_OPERATIVO')
  @Patch(':id/reasignar')
  reasignar(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ReasignarReservaDto,
  ): Promise<ReservaPublica> {
    return this.reservas.reasignar(actor, id, dto);
  }
```

- [ ] **Step 6: Suite completa**

```bash
pnpm --filter @boxadmin/api exec tsc --noEmit
pnpm --filter @boxadmin/api test
```

Esperado: 286 tests en verde.

- [ ] **Step 7: Anotar mensaje de commit sugerido**

```
feat(reservas): reasignacion entre turnos

Valida el cupo y el acceso a sala del turno DESTINO, en la misma transaccion
Serializable que la creacion: mover una reserva al ultimo lugar de un turno es
la misma carrera. Reasignar una reserva cancelada es 409.

Archivos: apps/api/src/reservas/reservas.service.ts (+ spec)
          apps/api/src/reservas/reservas.controller.ts
          apps/api/src/reservas/dto/reasignar-reserva.dto.ts
```

---
### Task 12: e2e — checklist, concurrencia y aislamiento

Punto 10 del checklist, y la verificación real de los otros nueve. Los tests unitarios de las tareas
anteriores usan dobles de Prisma: **nada de lo escrito hasta aquí ha tocado una base de datos de
verdad.** Esta tarea es la que dice si la fase funciona.

**Files:**
- Modify: `apps/api/test/helpers.ts`
- Create: `apps/api/test/nucleo.e2e-spec.ts`

- [ ] **Step 1: Helper de alta de gimnasio**

Añadir a `apps/api/test/helpers.ts`:

```ts
import * as request from 'supertest';
import type { INestApplication } from '@nestjs/common';

export interface GimnasioDeTest {
  tenantId: string;
  slug: string;
  adminToken: string;
  adminId: string;
}

/**
 * Crea un gimnasio con su primer ADMIN_SALON y devuelve su access token.
 * Es la puerta de entrada de casi todos los tests de esta fase.
 */
export async function crearGimnasio(
  app: INestApplication,
  slug: string,
): Promise<GimnasioDeTest> {
  const servidor = app.getHttpServer();
  const email = `admin@${slug}.test`;
  const password = 'Password123!';

  const tenant = await request(servidor)
    .post('/auth/tenants')
    .set('x-bootstrap-key', CLAVE_BOOTSTRAP)
    .send({ nombre: slug, slug })
    .expect(201);

  const admin = await request(servidor)
    .post('/auth/register')
    .set('x-bootstrap-key', CLAVE_BOOTSTRAP)
    .send({ tenantSlug: slug, nombreCompleto: `Admin ${slug}`, email, password })
    .expect(201);

  const login = await request(servidor)
    .post('/auth/login')
    .send({ tenantSlug: slug, email, password })
    .expect(200);

  return {
    tenantId: tenant.body.id,
    slug,
    adminToken: login.body.accessToken,
    adminId: admin.body.id,
  };
}

/** Atajo para no repetir el header en cada petición. */
export const conToken = (token: string) => (peticion: request.Test) =>
  peticion.set('Authorization', `Bearer ${token}`);
```

- [ ] **Step 2: Escribir el e2e**

Crear `apps/api/test/nucleo.e2e-spec.ts`:

```ts
import type { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import {
  crearAppDeTest,
  crearGimnasio,
  limpiarBaseDeDatos,
  type GimnasioDeTest,
} from './helpers';
import type { PrismaService } from '../src/prisma/prisma.service';

describe('Fase 1 — nucleo operativo (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let servidor: ReturnType<INestApplication['getHttpServer']>;
  let gym: GimnasioDeTest;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const entorno = await crearAppDeTest();
    app = entorno.app;
    prisma = entorno.prisma;
    servidor = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await limpiarBaseDeDatos(prisma);
    gym = await crearGimnasio(app, 'boxuno');
  });

  // Helpers locales -------------------------------------------------------

  const crearSala = async (nombre = 'Sala A'): Promise<string> => {
    const { body } = await request(servidor)
      .post('/salas')
      .set(auth(gym.adminToken))
      .send({ nombre })
      .expect(201);
    return body.id;
  };

  const crearPack = async (extra: Record<string, unknown> = {}): Promise<string> => {
    const { body } = await request(servidor)
      .post('/packs')
      .set(auth(gym.adminToken))
      .send({ nombre: '8 clases', tipo: 'MENSUAL', clasesPorMes: 8, precio: '12500.00', ...extra })
      .expect(201);
    return body.id;
  };

  const crearAlumno = async (
    salaIds: string[],
    extra: Record<string, unknown> = {},
  ): Promise<{ id: string; perfilId: string; body: Record<string, any> }> => {
    const { body } = await request(servidor)
      .post('/usuarios/alumnos')
      .set(auth(gym.adminToken))
      .send({
        nombreCompleto: 'Ana Perez',
        email: `ana${Math.random().toString(36).slice(2)}@gym.test`,
        salaIds,
        ...extra,
      })
      .expect(201);
    return { id: body.id, perfilId: body.perfilId, body };
  };

  const crearTurno = async (
    salaId: string,
    extra: Record<string, unknown> = {},
  ): Promise<string> => {
    const { body } = await request(servidor)
      .post('/turnos')
      .set(auth(gym.adminToken))
      .send({
        salaId,
        nombre: 'Pilates',
        fecha: '2026-10-05',
        horaInicio: '18:00',
        horaFin: '19:00',
        cupo: 10,
        ...extra,
      })
      .expect(201);
    return body.id;
  };

  // 1 — Salas -------------------------------------------------------------

  describe('checklist 1: crear y configurar una sala', () => {
    it('crea una sala con reglas propias y la devuelve al listar', async () => {
      const { body } = await request(servidor)
        .post('/salas')
        .set(auth(gym.adminToken))
        .send({ nombre: 'Sala A', cupoBase: 12, minMinutosCancelar: 120, exclusiva: true })
        .expect(201);

      expect(body).toMatchObject({
        nombre: 'Sala A',
        cupoBase: 12,
        minMinutosCancelar: 120,
        exclusiva: true,
        activa: true,
      });

      const lista = await request(servidor)
        .get('/salas')
        .set(auth(gym.adminToken))
        .expect(200);

      expect(lista.body).toHaveLength(1);
    });

    it('la sala que no configura reglas las deja en null, para heredarlas mas adelante', async () => {
      const { body } = await request(servidor)
        .post('/salas')
        .set(auth(gym.adminToken))
        .send({ nombre: 'Sala B' })
        .expect(201);

      expect(body.cupoBase).toBeNull();
      expect(body.listaEsperaHabilitada).toBeNull();
    });

    it('la baja es logica y 409 si quedan turnos futuros', async () => {
      const salaId = await crearSala();
      await crearTurno(salaId, { fecha: '2099-01-01' });

      await request(servidor)
        .delete(`/salas/${salaId}`)
        .set(auth(gym.adminToken))
        .expect(409);
    });
  });

  // 2 — Packs -------------------------------------------------------------

  describe('checklist 2: catalogo de packs independiente', () => {
    it('crea un pack sin que exista ningun alumno', async () => {
      const { body } = await request(servidor)
        .post('/packs')
        .set(auth(gym.adminToken))
        .send({ nombre: '8 clases', tipo: 'MENSUAL', clasesPorMes: 8, precio: '12500.00' })
        .expect(201);

      // Precio como string: el JSON de un Decimal no puede ser un float.
      expect(body.precio).toBe('12500.00');
      expect(typeof body.precio).toBe('string');
    });

    it('un pack sin precio es "a consultar"', async () => {
      const { body } = await request(servidor)
        .post('/packs')
        .set(auth(gym.adminToken))
        .send({ nombre: 'A consultar', tipo: 'MENSUAL' })
        .expect(201);

      expect(body.precio).toBeNull();
    });

    it('un pack MENSUAL con clasesTotales es 400', async () => {
      await request(servidor)
        .post('/packs')
        .set(auth(gym.adminToken))
        .send({ nombre: 'X', tipo: 'MENSUAL', clasesTotales: 10 })
        .expect(400);
    });
  });

  // 3 y 4 — Altas ---------------------------------------------------------

  describe('checklist 3: DTOs distintos para alumno y profesor', () => {
    it('da de alta un alumno con pack y devuelve la clave temporal una vez', async () => {
      const salaId = await crearSala();
      const packId = await crearPack();

      const { body } = await request(servidor)
        .post('/usuarios/alumnos')
        .set(auth(gym.adminToken))
        .send({
          nombreCompleto: 'Ana Perez',
          email: 'ana@gym.test',
          salaIds: [salaId],
          packId,
        })
        .expect(201);

      expect(body.rol).toBe('ALUMNO');
      expect(body.pack.id).toBe(packId);
      expect(body.passwordTemporal).toMatch(/^[A-Za-z0-9_-]{16,}$/);
      expect(body.advertencias).toEqual([]);

      // La clave temporal sirve de verdad.
      await request(servidor)
        .post('/auth/login')
        .send({ tenantSlug: gym.slug, email: 'ana@gym.test', password: body.passwordTemporal })
        .expect(200);

      // Y el detalle ya no la devuelve.
      const detalle = await request(servidor)
        .get(`/usuarios/${body.id}`)
        .set(auth(gym.adminToken))
        .expect(200);

      expect(detalle.body).not.toHaveProperty('passwordTemporal');
    });

    it('da de alta un profesor sin pedirle nada de alumno', async () => {
      const salaId = await crearSala();

      const { body } = await request(servidor)
        .post('/usuarios/profesores')
        .set(auth(gym.adminToken))
        .send({ nombreCompleto: 'Luis Gomez', email: 'luis@gym.test', salaIds: [salaId] })
        .expect(201);

      expect(body.rol).toBe('PROFESOR');
      expect(body.advertencias).toEqual([]);
    });

    it('mandar campos de alumno al alta de profesor es 400, no un guardado silencioso', async () => {
      const salaId = await crearSala();
      const packId = await crearPack();

      // El bug de TurnoFit al reves: aqui el sistema dice que no.
      await request(servidor)
        .post('/usuarios/profesores')
        .set(auth(gym.adminToken))
        .send({
          nombreCompleto: 'Luis',
          email: 'luis2@gym.test',
          salaIds: [salaId],
          packId,
        })
        .expect(400);
    });

    it('un profesor nunca recibe un error de "clases mensuales requerido"', async () => {
      const salaId = await crearSala();

      const respuesta = await request(servidor)
        .post('/usuarios/profesores')
        .set(auth(gym.adminToken))
        .send({ nombreCompleto: 'Luis', email: 'luis3@gym.test', salaIds: [salaId] });

      expect(respuesta.status).toBe(201);
      expect(JSON.stringify(respuesta.body)).not.toMatch(/clase/i);
    });
  });

  describe('checklist 4: alumno sin salas genera un warning visible', () => {
    it('devuelve 201 con la advertencia SIN_SALAS', async () => {
      const { body } = await request(servidor)
        .post('/usuarios/alumnos')
        .set(auth(gym.adminToken))
        .send({ nombreCompleto: 'Ana', email: 'ana2@gym.test', salaIds: [] })
        .expect(201);

      expect(body.advertencias).toEqual(
        expect.arrayContaining([expect.objectContaining({ codigo: 'SIN_SALAS' })]),
      );
    });

    it('PATCH /usuarios/:id/salas con lista vacia es 400', async () => {
      const salaId = await crearSala();
      const alumno = await crearAlumno([salaId]);

      await request(servidor)
        .patch(`/usuarios/${alumno.id}/salas`)
        .set(auth(gym.adminToken))
        .send({ salaIds: [] })
        .expect(400);
    });

    it('la ficha medica no aparece en el listado', async () => {
      const salaId = await crearSala();
      await crearAlumno([salaId], { fichaMedica: 'asma' });

      const { body } = await request(servidor)
        .get('/usuarios')
        .set(auth(gym.adminToken))
        .expect(200);

      expect(JSON.stringify(body)).not.toContain('asma');
    });
  });

  // 5 y 6 — Turnos y cupo -------------------------------------------------

  describe('checklist 5 y 6: turno puntual, reserva manual y cupo', () => {
    it('crea un turno y le asigna una reserva', async () => {
      const salaId = await crearSala();
      const turnoId = await crearTurno(salaId, { cupo: 2 });
      const alumno = await crearAlumno([salaId]);

      const { body } = await request(servidor)
        .post(`/turnos/${turnoId}/reservas`)
        .set(auth(gym.adminToken))
        .send({ perfilId: alumno.perfilId })
        .expect(201);

      expect(body.turnoId).toBe(turnoId);
      expect(body.origen).toBe('ADMIN');
      expect(body.canceladaEn).toBeNull();

      const turnos = await request(servidor)
        .get('/turnos')
        .set(auth(gym.adminToken))
        .expect(200);

      expect(turnos.body[0]).toMatchObject({ cupo: 2, reservasActivas: 1, lugaresLibres: 1 });
      expect(turnos.body[0].fecha).toBe('2026-10-05');
    });

    it('reservar un turno lleno devuelve 409 y no crea nada fuera de cupo', async () => {
      const salaId = await crearSala();
      const turnoId = await crearTurno(salaId, { cupo: 1 });
      const uno = await crearAlumno([salaId]);
      const dos = await crearAlumno([salaId]);

      await request(servidor)
        .post(`/turnos/${turnoId}/reservas`)
        .set(auth(gym.adminToken))
        .send({ perfilId: uno.perfilId })
        .expect(201);

      await request(servidor)
        .post(`/turnos/${turnoId}/reservas`)
        .set(auth(gym.adminToken))
        .send({ perfilId: dos.perfilId })
        .expect(409);

      const activas = await prisma.base.reserva.count({
        where: { turnoId, canceladaEn: null },
      });
      expect(activas).toBe(1);
    });

    it('403 si el alumno no tiene acceso a la sala del turno', async () => {
      const salaA = await crearSala('Sala A');
      const salaB = await crearSala('Sala B');
      const turnoId = await crearTurno(salaB);
      const alumno = await crearAlumno([salaA]);

      await request(servidor)
        .post(`/turnos/${turnoId}/reservas`)
        .set(auth(gym.adminToken))
        .send({ perfilId: alumno.perfilId })
        .expect(403);
    });

    it('CONCURRENCIA: 10 peticiones simultaneas sobre un cupo de 1 dan exactamente una 201', async () => {
      const salaId = await crearSala();
      const turnoId = await crearTurno(salaId, { cupo: 1 });

      const alumnos = [];
      for (let i = 0; i < 10; i++) {
        alumnos.push(await crearAlumno([salaId]));
      }

      const respuestas = await Promise.all(
        alumnos.map((alumno) =>
          request(servidor)
            .post(`/turnos/${turnoId}/reservas`)
            .set(auth(gym.adminToken))
            .send({ perfilId: alumno.perfilId }),
        ),
      );

      const creadas = respuestas.filter((r) => r.status === 201);
      const rechazadas = respuestas.filter((r) => r.status === 409);

      // Este es EL test de la fase. Sin transaccion Serializable, aqui pasan
      // varias: todas leen "queda 1 lugar" antes de que ninguna inserte. Es la
      // misma carrera que en la Fase 0 dejaba pasar 6 de 10 refresh tokens.
      expect(creadas).toHaveLength(1);
      expect(rechazadas).toHaveLength(9);

      const enBase = await prisma.base.reserva.count({
        where: { turnoId, canceladaEn: null },
      });
      expect(enBase).toBe(1);
    });
  });

  // 7 — Cancelaciones -----------------------------------------------------

  describe('checklist 7: cancelacion recuperable y definitiva', () => {
    const prepararAlumnoConPack = async () => {
      const salaId = await crearSala();
      const packId = await crearPack({ clasesPorMes: 2 });
      const alumno = await crearAlumno([salaId], { packId });
      return { salaId, alumno };
    };

    const reservar = async (turnoId: string, perfilId: string) => {
      const { body } = await request(servidor)
        .post(`/turnos/${turnoId}/reservas`)
        .set(auth(gym.adminToken))
        .send({ perfilId });
      return body;
    };

    it('RECUPERABLE devuelve la clase: la siguiente reserva no advierte pack agotado', async () => {
      const { salaId, alumno } = await prepararAlumnoConPack();
      const t1 = await crearTurno(salaId, { fecha: '2026-10-05' });
      const t2 = await crearTurno(salaId, { fecha: '2026-10-06' });
      const t3 = await crearTurno(salaId, { fecha: '2026-10-07' });

      const r1 = await reservar(t1, alumno.perfilId);
      await reservar(t2, alumno.perfilId);

      // Consumidas 2 de 2. La tercera avisaria.
      await request(servidor)
        .delete(`/reservas/${r1.id}?tipo=recuperable`)
        .set(auth(gym.adminToken))
        .expect(200);

      const tercera = await reservar(t3, alumno.perfilId);
      expect(tercera.advertencias).toEqual([]);
    });

    it('DEFINITIVA no la devuelve: la siguiente reserva si advierte', async () => {
      const { salaId, alumno } = await prepararAlumnoConPack();
      const t1 = await crearTurno(salaId, { fecha: '2026-10-05' });
      const t2 = await crearTurno(salaId, { fecha: '2026-10-06' });
      const t3 = await crearTurno(salaId, { fecha: '2026-10-07' });

      const r1 = await reservar(t1, alumno.perfilId);
      await reservar(t2, alumno.perfilId);

      await request(servidor)
        .delete(`/reservas/${r1.id}?tipo=definitiva`)
        .set(auth(gym.adminToken))
        .expect(200);

      const tercera = await reservar(t3, alumno.perfilId);
      expect(tercera.advertencias).toEqual(
        expect.arrayContaining([expect.objectContaining({ codigo: 'PACK_AGOTADO' })]),
      );
    });

    it('cancelar libera el lugar del turno', async () => {
      const salaId = await crearSala();
      const turnoId = await crearTurno(salaId, { cupo: 1 });
      const uno = await crearAlumno([salaId]);
      const dos = await crearAlumno([salaId]);

      const r1 = await reservar(turnoId, uno.perfilId);

      await request(servidor)
        .delete(`/reservas/${r1.id}?tipo=recuperable`)
        .set(auth(gym.adminToken))
        .expect(200);

      await request(servidor)
        .post(`/turnos/${turnoId}/reservas`)
        .set(auth(gym.adminToken))
        .send({ perfilId: dos.perfilId })
        .expect(201);
    });

    it('REGRESION: un turno con reservas solo canceladas si se puede borrar', async () => {
      const salaId = await crearSala();
      const turnoId = await crearTurno(salaId);
      const alumno = await crearAlumno([salaId]);
      const r1 = await reservar(turnoId, alumno.perfilId);

      await request(servidor)
        .delete(`/reservas/${r1.id}?tipo=definitiva`)
        .set(auth(gym.adminToken))
        .expect(200);

      // Antes de la migracion reserva_turno_cascade esto devolvia 500: la FK era
      // ON DELETE RESTRICT y el count de eliminar() solo mira las ACTIVAS, asi que
      // pasaba la comprobacion y despues Postgres rechazaba el DELETE.
      await request(servidor)
        .delete(`/turnos/${turnoId}`)
        .set(auth(gym.adminToken))
        .expect(204);

      const quedan = await prisma.base.reserva.count({ where: { turnoId } });
      expect(quedan).toBe(0);
    });

    it('un tipo de cancelacion invalido es 400', async () => {
      const salaId = await crearSala();
      const turnoId = await crearTurno(salaId);
      const alumno = await crearAlumno([salaId]);
      const r1 = await reservar(turnoId, alumno.perfilId);

      await request(servidor)
        .delete(`/reservas/${r1.id}?tipo=loquesea`)
        .set(auth(gym.adminToken))
        .expect(400);
    });
  });

  // 8 — Reasignacion ------------------------------------------------------

  describe('checklist 8: reasignar valida el cupo del destino', () => {
    it('mueve la reserva al turno destino', async () => {
      const salaId = await crearSala();
      const origen = await crearTurno(salaId, { fecha: '2026-10-05' });
      const destino = await crearTurno(salaId, { fecha: '2026-10-06' });
      const alumno = await crearAlumno([salaId]);

      const { body: reserva } = await request(servidor)
        .post(`/turnos/${origen}/reservas`)
        .set(auth(gym.adminToken))
        .send({ perfilId: alumno.perfilId })
        .expect(201);

      const { body } = await request(servidor)
        .patch(`/reservas/${reserva.id}/reasignar`)
        .set(auth(gym.adminToken))
        .send({ turnoId: destino })
        .expect(200);

      expect(body.turnoId).toBe(destino);

      const turnos = await request(servidor)
        .get('/turnos')
        .set(auth(gym.adminToken))
        .expect(200);

      const porId = Object.fromEntries(turnos.body.map((t: any) => [t.id, t]));
      expect(porId[origen].reservasActivas).toBe(0);
      expect(porId[destino].reservasActivas).toBe(1);
    });

    it('409 si el turno destino esta lleno', async () => {
      const salaId = await crearSala();
      const origen = await crearTurno(salaId, { fecha: '2026-10-05', cupo: 5 });
      const destino = await crearTurno(salaId, { fecha: '2026-10-06', cupo: 1 });
      const uno = await crearAlumno([salaId]);
      const dos = await crearAlumno([salaId]);

      const { body: reserva } = await request(servidor)
        .post(`/turnos/${origen}/reservas`)
        .set(auth(gym.adminToken))
        .send({ perfilId: uno.perfilId })
        .expect(201);

      await request(servidor)
        .post(`/turnos/${destino}/reservas`)
        .set(auth(gym.adminToken))
        .send({ perfilId: dos.perfilId })
        .expect(201);

      await request(servidor)
        .patch(`/reservas/${reserva.id}/reasignar`)
        .set(auth(gym.adminToken))
        .send({ turnoId: destino })
        .expect(409);
    });
  });

  // 9 — Auditoria ---------------------------------------------------------

  describe('checklist 9: todo queda en historial_acciones', () => {
    it('registra alta de sala, pack, usuario, turno, reserva, cancelacion y reasignacion', async () => {
      const salaId = await crearSala();
      await crearPack();
      const t1 = await crearTurno(salaId, { fecha: '2026-10-05' });
      const t2 = await crearTurno(salaId, { fecha: '2026-10-06' });
      const alumno = await crearAlumno([salaId]);

      const { body: reserva } = await request(servidor)
        .post(`/turnos/${t1}/reservas`)
        .set(auth(gym.adminToken))
        .send({ perfilId: alumno.perfilId })
        .expect(201);

      await request(servidor)
        .patch(`/reservas/${reserva.id}/reasignar`)
        .set(auth(gym.adminToken))
        .send({ turnoId: t2 })
        .expect(200);

      await request(servidor)
        .delete(`/reservas/${reserva.id}?tipo=recuperable`)
        .set(auth(gym.adminToken))
        .expect(200);

      await request(servidor)
        .patch(`/usuarios/${alumno.id}/salas`)
        .set(auth(gym.adminToken))
        .send({ salaIds: [salaId] })
        .expect(200);

      const registros = await prisma.base.historialAccion.findMany({
        where: { tenantId: gym.tenantId },
      });

      const clave = registros.map((r) => `${r.entidad}:${r.accion}`);
      expect(clave).toEqual(
        expect.arrayContaining([
          'Sala:CREADA',
          'Pack:CREADA',
          'Turno:CREADA',
          'Usuario:CREADA',
          'Reserva:CREADA',
          'Reserva:REASIGNADA',
          'Reserva:CANCELADA',
          'Usuario:SALAS_ACTUALIZADAS',
        ]),
      );

      // Y siempre se sabe quien lo hizo.
      expect(registros.every((r) => r.usuarioId === gym.adminId)).toBe(true);
    });

    it('la auditoria se revierte con la operacion que falla', async () => {
      const salaId = await crearSala();
      const turnoId = await crearTurno(salaId, { cupo: 1 });
      const uno = await crearAlumno([salaId]);
      const dos = await crearAlumno([salaId]);

      await request(servidor)
        .post(`/turnos/${turnoId}/reservas`)
        .set(auth(gym.adminToken))
        .send({ perfilId: uno.perfilId })
        .expect(201);

      await request(servidor)
        .post(`/turnos/${turnoId}/reservas`)
        .set(auth(gym.adminToken))
        .send({ perfilId: dos.perfilId })
        .expect(409);

      // Una sola Reserva:CREADA. Si la auditoria escribiera fuera de la
      // transaccion, habria rastro de una reserva que nunca existio.
      const creadas = await prisma.base.historialAccion.count({
        where: { tenantId: gym.tenantId, entidad: 'Reserva', accion: 'CREADA' },
      });
      expect(creadas).toBe(1);
    });
  });

  // Aislamiento entre gimnasios -------------------------------------------

  describe('aislamiento entre gimnasios', () => {
    let otro: GimnasioDeTest;

    beforeEach(async () => {
      otro = await crearGimnasio(app, 'boxdos');
    });

    it('ningun gimnasio ve las salas ni los packs del otro', async () => {
      await crearSala('Sala del uno');
      await crearPack();

      const salas = await request(servidor)
        .get('/salas')
        .set(auth(otro.adminToken))
        .expect(200);
      const packs = await request(servidor)
        .get('/packs')
        .set(auth(otro.adminToken))
        .expect(200);

      expect(salas.body).toEqual([]);
      expect(packs.body).toEqual([]);
    });

    it('ningun gimnasio ve los usuarios ni los turnos del otro', async () => {
      const salaId = await crearSala();
      await crearTurno(salaId);
      await crearAlumno([salaId]);

      const usuarios = await request(servidor)
        .get('/usuarios')
        .set(auth(otro.adminToken))
        .expect(200);
      const turnos = await request(servidor)
        .get('/turnos')
        .set(auth(otro.adminToken))
        .expect(200);

      expect(usuarios.body).toEqual([]);
      expect(turnos.body).toEqual([]);
    });

    it('404 al pedir por id un recurso del otro gimnasio', async () => {
      const salaId = await crearSala();
      const alumno = await crearAlumno([salaId]);

      await request(servidor)
        .get(`/salas/${salaId}`)
        .set(auth(otro.adminToken))
        .expect(404);

      await request(servidor)
        .get(`/usuarios/${alumno.id}`)
        .set(auth(otro.adminToken))
        .expect(404);
    });

    it('no se puede reservar un turno del otro gimnasio', async () => {
      const salaId = await crearSala();
      const turnoId = await crearTurno(salaId);
      const alumno = await crearAlumno([salaId]);

      await request(servidor)
        .post(`/turnos/${turnoId}/reservas`)
        .set(auth(otro.adminToken))
        .send({ perfilId: alumno.perfilId })
        .expect(404);
    });

    it('un turno con el mismo nombre en cada gimnasio no se mezcla', async () => {
      const salaUno = await crearSala('Sala');
      await crearTurno(salaUno);

      const { body: salaDos } = await request(servidor)
        .post('/salas')
        .set(auth(otro.adminToken))
        .send({ nombre: 'Sala' })
        .expect(201);

      await request(servidor)
        .post('/turnos')
        .set(auth(otro.adminToken))
        .send({
          salaId: salaDos.id,
          nombre: 'Pilates',
          fecha: '2026-10-05',
          horaInicio: '18:00',
          horaFin: '19:00',
          cupo: 10,
        })
        .expect(201);

      const mios = await request(servidor)
        .get('/turnos')
        .set(auth(gym.adminToken))
        .expect(200);

      expect(mios.body).toHaveLength(1);
      expect(mios.body[0].salaId).toBe(salaUno);
    });
  });

  // Permisos --------------------------------------------------------------

  describe('permisos por rol', () => {
    const tokenDeAlumno = async (salaId: string): Promise<string> => {
      const email = `alu${Math.random().toString(36).slice(2)}@gym.test`;
      const { body } = await request(servidor)
        .post('/usuarios/alumnos')
        .set(auth(gym.adminToken))
        .send({ nombreCompleto: 'Ana', email, salaIds: [salaId] })
        .expect(201);

      const login = await request(servidor)
        .post('/auth/login')
        .send({ tenantSlug: gym.slug, email, password: body.passwordTemporal })
        .expect(200);

      return login.body.accessToken;
    };

    it('un alumno no puede crear salas, packs, turnos ni reservas', async () => {
      const salaId = await crearSala();
      const token = await tokenDeAlumno(salaId);
      const turnoId = await crearTurno(salaId);

      await request(servidor).post('/salas').set(auth(token)).send({ nombre: 'X' }).expect(403);
      await request(servidor)
        .post('/packs')
        .set(auth(token))
        .send({ nombre: 'X', tipo: 'MENSUAL' })
        .expect(403);
      await request(servidor)
        .post(`/turnos/${turnoId}/reservas`)
        .set(auth(token))
        .send({ perfilId: 'perf-x' })
        .expect(403);
      await request(servidor).get('/usuarios').set(auth(token)).expect(403);
    });

    it('un alumno no ve las salas ocultas ni las de baja', async () => {
      const visible = await crearSala('Visible');
      const { body: oculta } = await request(servidor)
        .post('/salas')
        .set(auth(gym.adminToken))
        .send({ nombre: 'Oculta', visibleAlumnos: false })
        .expect(201);

      const token = await tokenDeAlumno(visible);

      const lista = await request(servidor).get('/salas').set(auth(token)).expect(200);

      expect(lista.body.map((s: any) => s.id)).toEqual([visible]);

      await request(servidor).get(`/salas/${oculta.id}`).set(auth(token)).expect(404);
    });

    it('un alumno ve su propio detalle pero no el de otro', async () => {
      const salaId = await crearSala();
      const propio = await crearAlumno([salaId]);
      const ajeno = await crearAlumno([salaId]);

      const login = await request(servidor)
        .post('/auth/login')
        .send({
          tenantSlug: gym.slug,
          email: propio.body.email,
          password: propio.body.passwordTemporal,
        })
        .expect(200);

      const token = login.body.accessToken;

      await request(servidor).get(`/usuarios/${propio.id}`).set(auth(token)).expect(200);
      await request(servidor).get(`/usuarios/${ajeno.id}`).set(auth(token)).expect(403);
    });

    it('sin token, todo devuelve 401', async () => {
      await request(servidor).get('/salas').expect(401);
      await request(servidor).get('/turnos').expect(401);
      await request(servidor).get('/usuarios').expect(401);
    });
  });
});
```

- [ ] **Step 3: Ejecutar**

```bash
docker compose up -d
pnpm --filter @boxadmin/api test:e2e
```

Esperado: los 16 e2e de la Fase 0 **y** los ~35 nuevos en verde, y Jest saliendo con código 0 sin
`--forceExit`.

**Si Jest se queda colgado al terminar**, no es un test: es una conexión viva. En la Fase 0 la causa fue
una instancia de Redis construida a mano que sobrevivía a `app.close()`. Revisar qué se añadió que abra
conexiones, no tocar el `jest-e2e.json`.

**Si fallan los tests de aislamiento**, es lo más grave que puede pasar en este proyecto. Parar,
reportar, y no seguir hasta entenderlo: significa que la extensión de tenant tiene una fuga con alguno
de los modelos nuevos.

**Si falla el test de concurrencia con más de una 201**, la transacción Serializable no está haciendo
efecto — comprobar que el `isolationLevel` llega de verdad (`$transaction(fn, { isolationLevel:
'Serializable' })`, no dentro del primer argumento).

- [ ] **Step 4: Anotar mensaje de commit sugerido**

```
test(e2e): checklist de la Fase 1, concurrencia y aislamiento

Cubre los diez puntos del checklist del documento, mas 10 reservas
simultaneas sobre un cupo de 1 (exactamente una 201 y nueve 409) y el
aislamiento entre dos gimnasios para cada recurso nuevo.

Archivos: apps/api/test/nucleo.e2e-spec.ts
          apps/api/test/helpers.ts
```

---

### Task 13: Verificación final, README y cierre

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/PROGRESO.md`

- [ ] **Step 1: Verificación completa desde cero**

```bash
docker compose down -v
docker compose up -d
pnpm install
pnpm --filter @boxadmin/shared build
pnpm --filter @boxadmin/api db:deploy
pnpm --filter @boxadmin/api db:generate
pnpm --filter @boxadmin/api exec tsc --noEmit
pnpm --filter @boxadmin/api test
pnpm --filter @boxadmin/api test:e2e
# OJO: `pnpm lint` lleva --fix y reformatearia TODO el repo, incluida la Fase 0.
# La Fase 0 nunca se formateo de forma consistente (24 archivos fallan a ancho 80
# y 14 a ancho 100), asi que se acota el lint a lo que escribe esta fase.
pnpm --filter @boxadmin/api exec eslint "src/{salas,packs,usuarios,turnos,reservas,common/historial,common/prisma}/**/*.ts" 
```

Esperado: todo en verde partiendo de una base vacía. El `down -v` importa: borra los volúmenes y
comprueba que las migraciones aplican solas, que es lo que le pasará a Cesar en otra máquina.

- [ ] **Step 2: Recorrer el checklist del PDF a mano**

Con la API levantada (`pnpm --filter @boxadmin/api start:dev`), verificar uno por uno los diez puntos
del §6 del documento con peticiones reales. Anotar el resultado de cada uno en `PROGRESO.md` con un
✅ o un ❌ y, si falla alguno, **arreglarlo antes de cerrar la tarea**.

- [ ] **Step 3: Documentar los endpoints en el README**

Añadir una sección "Fase 1 — núcleo operativo" con las cinco tablas de endpoints del §6 del spec
(`docs/superpowers/specs/2026-09-14-fase1-nucleo-operativo.md`), el rol mínimo de cada uno, y un
ejemplo completo de flujo con `curl`: crear tenant → registrar admin → login → sala → pack → alumno →
turno → reserva.

- [ ] **Step 4: Cerrar `PROGRESO.md`**

Actualizar con las 14 tareas marcadas, el recuento final de tests y la lista ordenada de mensajes de
commit sugeridos, uno por tarea.

- [ ] **Step 5: Comprobar que no se commiteó nada**

```bash
git status --short
```

Esperado: muchos archivos sin seguimiento y ninguna entrada en el índice. Si aparece algo staged, un
agente se saltó la regla del proyecto — avisarlo explícitamente en el informe final.

```bash
git check-ignore -v .env .env.test
```

Esperado: ambos ignorados.

- [ ] **Step 6: Anotar mensaje de commit sugerido**

```
docs: endpoints y flujo de la Fase 1 en el README

Archivos: README.md
          docs/superpowers/plans/PROGRESO.md
```

---

## Desviaciones respecto al PDF de la Fase 1

Se mantienen aquí para que la Fase 2 no las descubra por sorpresa.

| # | Documento | Implementación | Motivo |
|---|---|---|---|
| D1 | `Perfil` sin campo de relación `tenant`; `Tenant` y `Usuario` sin back-relations | Se añaden todas | El schema no valida sin ellas |
| D2 | `UsuarioSala` sin `tenantId` | Lleva `tenantId` y relación a `Tenant` | Sin columna propia la extensión de aislamiento lanza `CreacionNoPermitidaError` en cada alta |
| D3 | `cancelacionTipo String?` | `enum TipoCancelacion` | Un string libre convierte un typo en un bug silencioso |
| D4 | `precio Decimal` sin decir cómo se serializa | String con 2 decimales | Un float binario pierde centavos |
| D5 | `fecha DateTime @db.Date` | Viaja como `"YYYY-MM-DD"` | El ISO completo arrastra huso horario |
| D6 | `pnpm add nanoid` | No se instala | Nada del modelo usa códigos cortos; los IDs son `cuid()` |
| D7 | `SELECT ... FOR UPDATE` para el cupo | `$transaction` Serializable + reintento | El SQL crudo está bloqueado dentro del contexto de tenant; abrirle una excepción al núcleo de seguridad es un precio desproporcionado |
| D8 | "el pack define las clases" | El pack **no bloquea** reservas, solo advierte | El §5 del PDF no lista el pack entre las reglas a validar; el admin manda |
| D9 | Contador de clases implícito | Consumo derivado de las reservas | Un contador almacenado se desincroniza; es la deriva vista en TurnoFit |
| D10 | `PATCH /usuarios/:id/salas` — "rechazar, **o al menos** loguear una advertencia" | Se rechaza con 400 **y** se audita | Se toma la lectura estricta: vaciar salas a propósito siempre es un error |
| D11 | Solo define los roles de `/salas` | Configuración → ADMIN_SALON; operación → ADMIN_OPERATIVO | El PDF no los define; queda explícito en el §9 del spec |
| D12 | `DELETE /packs/:id` "baja lógica si tiene perfiles asociados" | Siempre baja lógica | Borrar un pack contratado dejaría perfiles apuntando al vacío |
| D13 | No menciona la ficha médica en listados | Nunca aparece en listados; en el detalle solo para ADMIN_SALON o el propio usuario | Es un dato de salud |
| D14 | No menciona contraseñas en el alta | Temporal generada por el API, devuelta una sola vez | Decisión D1 del spec |
| D15 | `POST /turnos/:turnoId/reservas` sin especificar el cuerpo | El cuerpo lleva `perfilId`, no `usuarioId` | Los listados de usuarios ya devuelven `perfilId` |
| D16 | `DELETE /turnos/:id` sin especificar | Borrado físico si no hay reservas activas; 409 si las hay | Un calendario lleno de turnos "de baja" es peor que uno vacío |
| D17 | Nada al respecto | `@@unique([tenantId, id])` + claves foraneas compuestas en las 8 relaciones internas | La base rechaza por si misma que una reserva apunte al turno de otro gimnasio, sin depender de que ningun service se olvide de validar |
| D18 | Nada al respecto | `Reserva.turno` con `onDelete: Cascade` | Con el RESTRICT por defecto, borrar un turno con reservas canceladas daba un 500 opaco. Una reserva cancelada de una clase que ya no existe no es historia que valga la pena; la auditoria de `historial_acciones` es independiente porque no tiene clave foranea |

## Deuda declarada para la Fase 2 y siguientes

- Los campos "hereda del tenant" de `Sala` (`cupoBase`, `minMinutosCancelar`, `minMinutosAnotarse`,
  `listaEsperaHabilitada`) se almacenan pero **no se consumen**: no existe configuración general del
  tenant de la que heredar.
- `Perfil.cancelacionesUsadas` solo se incrementa si la cancelación la origina el propio alumno. En la
  Fase 1 ningún alumno alcanza ese endpoint, así que la rama está escrita y probada pero inerte hasta
  la Fase 3.
- `Pack.cancelacionesPermitidas` se almacena y no se aplica.
- Lista de espera: el campo existe, la funcionalidad no.
- Dar de baja un usuario **no** cancela sus reservas futuras.
- `Turno` no tiene `profesorId`: llega en la Fase 4.
- **Ningun error de Prisma se traduce a HTTP.** `AllExceptionsFilter` solo distingue `HttpException`,
  asi que un `P2002` (unicidad) o un `P2003` (clave foranea) sale como 500 "Error interno". Hoy apenas
  muerde porque no hay restricciones de unicidad de negocio —se pueden crear dos salas con el mismo
  nombre—, pero hay que mapearlos antes de anadir la primera.
- **`comienzoDeHoyUtc()` compara contra medianoche UTC.** Para un gimnasio en UTC-3, entre las 21:00 y
  las 24:00 hora local los turnos del dia en curso dejan de contar como "de hoy en adelante" y no
  bloquean la baja de una sala. Se arregla cuando el tenant tenga zona horaria configurable (Fase 2).
- **`GET /packs?salaId=X` no valida `X`.** Un alumno puede sondear que packs cuelgan de una sala que no
  puede ver. La fuga esta acotada a su propio gimnasio y solo revela precios, que son publicos de
  hecho, pero es informacion que no le corresponde.
- **Un PATCH vacio `{}` se trata como una operacion completa**: toca `updatedAt` y escribe una entrada
  de historial con `detalle: {}`. Ruido en la auditoria.
- **No hay forma de devolver un campo a `null` en un PATCH.** `Pack.precio` no puede volver a "a
  consultar" ni `Pack.salaId` a "vale para todas las salas": los DTO no admiten `null` y `undefined`
  significa "no tocar".
- **El repo no pasa su propio `prettier --check`, y viene de la Fase 0.** El codigo esta escrito a
  ancho ~90-100 pero `.prettierrc` no declaraba `printWidth`, asi que se aplicaba el default de 80.
  Se anadio `"printWidth": 100`, que es el que refleja como esta escrito el codigo, pero NO se
  reformateo la Fase 0: seria un diff enorme sobre archivos ya commiteados y ensuciaria el de esta
  fase. Merece un commit propio de Cesar, solo de formato, cuando quiera.
- `UsuarioSala` conserva `@@index([salaId])`, que tras las FK compuestas de la T1b ya solo es un
  prefijo parcial de la clave real `(tenantId, salaId)`. Cambiarlo a `@@index([tenantId, salaId])`
  seria algo mejor para el borrado en cascada de una sala. No se hace ahora porque a la escala de
  un salon no se nota y costaria una migracion mas.
- No hay paginación en ningún listado. A la escala de un salón no hace falta todavía, pero
  `GET /turnos` sin filtro de fechas crecerá sin límite.
