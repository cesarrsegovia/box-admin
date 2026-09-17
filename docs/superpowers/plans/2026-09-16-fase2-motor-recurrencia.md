# Fase 2 — Motor de recurrencia · Plan de implementación

> **Para agentes ejecutores:** SUB-SKILL OBLIGATORIA: usa `superpowers:subagent-driven-development`
> (recomendado) o `superpowers:executing-plans` para implementar este plan tarea a tarea. Los pasos
> usan sintaxis de checkbox (`- [ ]`) para seguimiento.

**Objetivo:** que un admin cargue la rutina fija de un alumno una sola vez y el sistema genere los
meses futuros por su cuenta, listando antes de confirmar todo lo que necesita decisión humana.

**Arquitectura:** el algoritmo de generación es una **función pura** que no toca la base de datos:
recibe los datos ya cargados y devuelve un plan. Un cargador aparte hace el I/O, un service expone la
previsualización síncrona, y un worker de BullMQ ejecuta la publicación real. Esa separación es lo que
permite cubrir los ocho casos del checklist con tests unitarios sin base de datos ni cola.

**Stack:** NestJS 10, TypeScript strict, Prisma 7.10.0 + PostgreSQL 16, BullMQ 5 + Redis 7,
class-validator, Jest + Supertest, pnpm 9.12.0.

**Spec:** `docs/superpowers/specs/2026-09-16-fase2-motor-recurrencia.md`

---

## ⚠️ REGLAS DEL PROYECTO — LEER ANTES DE EMPEZAR

**NADIE COMMITEA MÁS QUE CESAR.**

Ningún agente ejecuta `git add`, `git commit`, `git push`, `git stash`, `git checkout` ni `git reset`.
`git status`, `git diff` y `git check-ignore` sí. Donde un plan normal diría "Commit", este dice
**"Anotar mensaje de commit sugerido"**: se escribe el mensaje en el informe y se deja el árbol de
trabajo sucio.

**Tampoco se mata ningún proceso por nombre** (`taskkill /IM node.exe` y equivalentes): hay una sesión
de Claude Code viva en la máquina. Si hay que matar algo, por PID concreto.

**`pnpm lint` está prohibido**: lleva `--fix` y reformatearía todo el repo, incluida la Fase 0, que
nunca se formateó de forma consistente. Para comprobar formato: `pnpm --filter @boxadmin/api exec
prettier --check "src/<lo-que-toques>/**/*.ts"`.

---

## Estado de partida (verificado el 2026-09-16)

- Fase 0 commiteada en `e610e88`. Fase 1 terminada y **sin commitear**: 326 tests unitarios + 56 e2e.
- `apps/api/prisma/schema.prisma` tiene 10 modelos y 4 enums. **Todas las relaciones internas usan
  claves foráneas compuestas por tenant** (`@relation(fields: [tenantId, xId], references: [tenantId,
  id])`), con `@@unique([tenantId, id])` en `Usuario`, `Sala`, `Perfil`, `Pack` y `Turno`.
- El aislamiento entre gimnasios lo aplica `apps/api/src/common/tenant/tenant-scoped.extension.ts`,
  que inyecta `where: { tenantId }` en cada query y **lanza si un modelo no está clasificado**.
- Existe `HistorialService` (`@Global()`), el tipo `ClientePrismaTx`, `conReintentoSerializable`, y
  los contratos compartidos en `packages/shared`.
- Hay un worker de BullMQ de ejemplo: `apps/api/src/jobs/health-check.processor.ts`.
- Postgres de desarrollo en **5434**, Postgres de test en **5433** (`postgres-test`, con `tmpfs`),
  Redis en **6379**.

## Comandos

```bash
# desde la raiz D:\Dev\box-admin
docker compose up -d postgres postgres-test redis
pnpm --filter @boxadmin/shared build     # OBLIGATORIO tras tocar packages/shared
pnpm --filter @boxadmin/shared test
pnpm --filter @boxadmin/api exec tsc --noEmit
pnpm --filter @boxadmin/api test
pnpm --filter @boxadmin/api test:e2e
```

⚠️ **No uses `pnpm --filter @boxadmin/api db:migrate -- --name X`**: pnpm pasa el `--` literal, Prisma
ignora el flag y se queda colgado en un prompt interactivo que no ves. Usa:

```bash
cd apps/api && pnpm exec dotenv -e ../../.env -- prisma migrate dev --name <nombre>
```

⚠️ **Y `migrate dev` tampoco sirve cuando la migracion trae un aviso** (por ejemplo al anadir una
restriccion de unicidad): Prisma pide confirmacion, no hay TTY y falla con *"Prisma Migrate has
detected that the environment is non-interactive"*. No se arregla con `--create-only` ni con
`echo y |`. La ruta que si funciona, verificada en la T1:

```bash
cd apps/api
mkdir -p prisma/migrations/<timestamp>_<nombre>
pnpm exec dotenv -e ../../.env -- prisma migrate diff   --from-config-datasource --to-schema prisma/schema.prisma --script   -o prisma/migrations/<timestamp>_<nombre>/migration.sql
# (aqui se edita el SQL a mano si hace falta)
pnpm exec dotenv -e ../../.env -- prisma migrate deploy
```

En Prisma 7 los flags `--from-url` y `--to-schema-datamodel` ya no existen; son
`--from-config-datasource` y `--to-schema`.

---

## Mapa de archivos

### Se crean

| Archivo | Responsabilidad |
|---|---|
| `packages/shared/src/calendario.ts` (+ spec) | Aritmética de meses: primer/último día, fechas de un mes que caen en un día de semana |
| `packages/shared/src/recurrencia.contracts.ts` | Tipos públicos: rutinas, vacaciones, ausencias, `PlanDeMes`, conflictos y exclusiones |
| `apps/api/src/rutinas/` | CRUD de rutinas fijas |
| `apps/api/src/vacaciones/` | Vacaciones de alumno |
| `apps/api/src/ausencias/` | Cierres de sala o de salón |
| `apps/api/src/jobs/generacion-mes/generacion-mes.service.ts` (+ spec) | **El planificador puro.** Sin base de datos, sin cola |
| `apps/api/src/calendario/calendario.datos.ts` | Carga desde la base la entrada del planificador. Lo usan la previsualización y el worker |
| `apps/api/src/calendario/calendario.service.ts` (+ spec) | Previsualizar, consultar estado del mes, encolar publicación |
| `apps/api/src/calendario/calendario.controller.ts`, `calendario.module.ts` | Rutas del calendario |
| `apps/api/src/jobs/generacion-mes/publicacion.service.ts` (+ spec) | La escritura transaccional del plan |
| `apps/api/src/jobs/generacion-mes/generacion-mes.processor.ts` | Worker de BullMQ: abre el contexto de tenant y orquesta |
| `apps/api/test/recurrencia.e2e-spec.ts` | e2e del checklist de la fase |

### Se modifican

| Archivo | Cambio |
|---|---|
| `apps/api/prisma/schema.prisma` | 4 modelos + 1 enum nuevos, índices únicos de idempotencia |
| `apps/api/prisma/migrations/<ts>_fase2_motor_recurrencia/migration.sql` | **Se edita a mano** para añadir el índice único parcial de reservas |
| `apps/api/src/common/tenant/tenant-scoped.extension.ts` | 4 modelos nuevos en `MODELOS_CON_TENANT` |
| `apps/api/src/common/filters/all-exceptions.filter.ts` (+ spec) | Traducir códigos de Prisma a HTTP (deuda de la Fase 1) |
| `apps/api/src/reservas/ventana-pack.ts` | Usar los helpers de mes de `packages/shared` en vez de sus copias privadas |
| `apps/api/src/app.module.ts` | Importar los módulos nuevos |
| `apps/api/test/helpers.ts` | `limpiarBaseDeDatos` con las 4 tablas nuevas |
| `packages/shared/src/index.ts` | Reexportar lo nuevo |
| `README.md`, `docs/superpowers/plans/PROGRESO.md` | Documentación y seguimiento |

---

## Tareas

> Los recuentos de tests que aparecen en cada tarea son **orientativos**. Lo que se verifica es que la
> suite quede entera en verde y que el número **suba**, no que coincida con la predicción. En la Fase 1
> varias predicciones salieron desfasadas y persiguiéndolas se pierde tiempo.

| # | Tarea | Bloquea a |
|---|---|---|
| T0 | Spike: ¿puede un worker de BullMQ operar con contexto de tenant? | **todo** |
| T1 | Schema, migración, índices de idempotencia y clasificación | T3–T10 |
| T2 | Traducir errores de Prisma a HTTP | T4–T10 |
| T3 | Utilidades de calendario y contratos compartidos | T4–T9 |
| T4 | Módulo `rutinas` | T7 |
| T5 | Módulos `vacaciones` y `ausencias` | T7 |
| T6 | **El planificador puro** | T7, T8 |
| T7 | Carga de datos y previsualización | T8 |
| T8 | Publicación: worker de BullMQ y escritura | T9 |
| T9 | e2e del checklist | T10 |
| T10 | Verificación final, README y cierre | — |

---

### Task 0: Spike — ¿puede un worker de BullMQ operar con contexto de tenant?

**Por qué existe esta tarea.** Todo el aislamiento entre gimnasios de BoxAdmin vive en un
`AsyncLocalStorage` que abre `TenantContextMiddleware` a partir del JWT de la request. **Un job no
tiene request.** Cuando el worker llame a Prisma, `getTenantContext()` devolverá `undefined` y la
extensión lanzará `MissingTenantContextError`.

Eso es el diseño fail-closed funcionando, no un fallo. Pero el motor de esta fase vive dentro de un
worker, así que hay que confirmar que envolver el trabajo en `runWithTenant` basta, y que el contexto
sobrevive a los `await` internos de BullMQ. Si no sobreviviera, el motor entero cambia de forma.

**Files:**
- Create (temporal): `apps/api/src/jobs/tenant-en-worker.spike.spec.ts`

- [ ] **Step 1: Levantar la infraestructura**

```bash
docker compose up -d postgres postgres-test redis
docker compose ps
```

Esperado: los tres contenedores `Up` y `healthy`. Si `docker info` falla, Docker Desktop no está
arrancado; arráncalo y espera a que el demonio responda antes de seguir.

- [ ] **Step 2: Escribir el spike**

Crear `apps/api/src/jobs/tenant-en-worker.spike.spec.ts`:

```ts
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { getTenantContext, runUnscoped, runWithTenant } from '../common/tenant/tenant-context';
import { MissingTenantContextError } from '../common/tenant/tenant-scoped.extension';

// Spike temporal: responde tres preguntas de las que depende toda la Fase 2.
// Se borra al terminar T0.
describe('spike: contexto de tenant dentro de un worker de BullMQ', () => {
  const COLA = `spike-tenant-${Date.now()}`;
  let prisma: PrismaService;
  let cola: Queue;
  let worker: Worker;
  let tenantId: string;

  const conexion = (): { host: string; port: number; maxRetriesPerRequest: null } => {
    const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
    return { host: url.hostname, port: Number(url.port || 6379), maxRetriesPerRequest: null };
  };

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService({ DATABASE_URL: process.env.DATABASE_URL } as Record<string, unknown>),
    );
    await prisma.onModuleInit();

    const tenant = await runUnscoped(
      async () =>
        await prisma.db.tenant.create({
          data: { nombre: 'Spike F2', slug: `spike-f2-${Date.now()}` },
        }),
    );
    tenantId = tenant.id;

    cola = new Queue(COLA, { connection: conexion() });
  });

  afterAll(async () => {
    await worker?.close();
    await cola?.close();
    await prisma.base.tenant.deleteMany({ where: { id: tenantId } });
    await prisma.onModuleDestroy();
  });

  /** Encola un job y espera a que el worker lo resuelva. */
  const ejecutar = <T>(procesar: (tenantId: string) => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      worker = new Worker(
        COLA,
        async (job) => await procesar(job.data.tenantId as string),
        { connection: conexion() },
      );
      worker.on('completed', (_job, resultado) => resolve(resultado as T));
      worker.on('failed', (_job, error) => reject(error));
      void cola.add('spike', { tenantId });
    });

  it('PREGUNTA 1: sin abrir contexto, Prisma falla (no filtra)', async () => {
    await expect(
      ejecutar(async () => await prisma.db.usuario.count()),
    ).rejects.toThrow(/contexto de tenant|MissingTenantContext/i);
  });

  it('PREGUNTA 2: runWithTenant dentro del worker si funciona', async () => {
    const n = await ejecutar(
      async (id) => await runWithTenant(id, async () => await prisma.db.usuario.count()),
    );

    expect(n).toBe(0);
  });

  it('PREGUNTA 3: el contexto sobrevive a varios await encadenados', async () => {
    const visto = await ejecutar(async (id) =>
      runWithTenant(id, async () => {
        await prisma.db.usuario.count();
        await new Promise((r) => setTimeout(r, 10));
        await prisma.db.sala.count();
        return getTenantContext();
      }),
    );

    expect(visto).toEqual({ kind: 'tenant', tenantId });
  });
});
```

- [ ] **Step 3: Ejecutar el spike**

```bash
cd apps/api
pnpm exec dotenv -e ../../.env -- jest src/jobs/tenant-en-worker.spike.spec.ts --runInBand --forceExit
```

`--forceExit` aquí es aceptable **solo porque es un spike** que crea una `Queue` y un `Worker` a mano,
fuera del ciclo de vida de Nest. No lo copies al código de producción ni a los e2e.

Resultado **A — las tres pasan**: es lo esperado. El motor se construye envolviendo el trabajo del
worker en `runWithTenant(job.data.tenantId, ...)`. Anótalo y salta al Step 5.

Resultado **B — la pregunta 2 o la 3 falla**: el `AsyncLocalStorage` no sobrevive al worker. **Para y
repórtalo**: el motor entero cambia de forma y hay que replantear el diseño antes de escribir código.

Resultado **C — la pregunta 1 pasa devolviendo un número en vez de fallar**: es lo más grave que puede
salir de aquí. Significaría que un job puede leer datos sin filtro de tenant. **Para, repórtalo y no
sigas.**

- [ ] **Step 4: Anotar la conclusión**

Una línea en el informe con cuál de los tres resultados salió. Esta respuesta la va a dar por supuesta
la Task 8.

- [ ] **Step 5: Borrar el spike**

```bash
rm apps/api/src/jobs/tenant-en-worker.spike.spec.ts
```

Era una pregunta, no un test de regresión. La cobertura permanente la da el e2e de aislamiento del
worker en la Task 9.

- [ ] **Step 6: Suite completa**

```bash
cd D:/Dev/box-admin
pnpm --filter @boxadmin/api test
```

Esperado: 326 tests en verde, igual que antes del spike (no se dejó nada).

- [ ] **Step 7: Anotar mensaje de commit sugerido**

No hay cambios que commitear. Anótalo igual en el informe.

---

### Task 1: Schema, migración, índices de idempotencia y clasificación

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create (generado y luego **editado a mano**): `apps/api/prisma/migrations/<ts>_fase2_motor_recurrencia/migration.sql`
- Modify: `apps/api/src/common/tenant/tenant-scoped.extension.ts`
- Modify: `apps/api/test/helpers.ts`

- [ ] **Step 1: Añadir el enum y los cuatro modelos**

En `apps/api/prisma/schema.prisma`, al final:

```prisma
enum EstadoMes {
  BORRADOR
  HABILITADO
}

model RutinaFija {
  // El patron semanal fijo de un alumno: "martes y jueves a las 18:00 en Pilates".
  //
  // Las relaciones venian corruptas en el PDF de la fase (tres @relation sueltos
  // sobre campos escalares). Aqui se reescriben con claves foraneas COMPUESTAS
  // por tenant, como todo el schema desde la Fase 1: asi la base impide por si
  // misma que una rutina cruce el perfil de un gimnasio con la sala de otro.
  id       String @id @default(cuid())
  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id])

  perfilId String
  perfil   Perfil @relation(fields: [tenantId, perfilId], references: [tenantId, id], onDelete: Cascade)
  salaId   String
  sala     Sala   @relation(fields: [tenantId, salaId], references: [tenantId, id], onDelete: Cascade)

  // Nombre del turno que generara esta rutina, p. ej. "Pilates". El PDF no lo
  // incluia, pero Turno.nombre es obligatorio y tiene que salir de algun sitio.
  nombre String

  diaSemana  Int    // 0 = domingo ... 6 = sabado
  horaInicio String // "HH:MM", misma convencion que Turno
  horaFin    String

  activa Boolean   @default(true)
  desde  DateTime  @db.Date
  hasta  DateTime? @db.Date // null = indefinida

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([tenantId, perfilId])
  @@index([tenantId, salaId, diaSemana])
  @@map("rutinas_fijas")
}

model MesCalendario {
  // Estado de publicacion de una sala en un mes, como maquina de estados
  // explicita. Su @@unique sirve ademas de cerrojo: la publicacion lo toma con
  // un updateMany condicional, asi dos publicaciones simultaneas del mismo mes
  // no se pisan.
  //
  // OJO: en la Fase 2, HABILITADO no habilita nada funcionalmente. No hay
  // self-service todavia, asi que ningun alumno ve ni reserva nada. Registra que
  // el mes se publico, cuando y quien, y es el enganche para la Fase 3. No
  // construyas logica sobre una garantia que aun no existe.
  id       String @id @default(cuid())
  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id])
  salaId   String
  sala     Sala   @relation(fields: [tenantId, salaId], references: [tenantId, id], onDelete: Cascade)

  anio Int
  mes  Int // 1-12

  estado EstadoMes @default(BORRADOR)

  publicadoEn DateTime?
  // Escalar sin FK, igual que HistorialAccion.usuarioId: es auditoria, no una
  // relacion de negocio.
  publicadoPor String?

  // Id del ultimo job de publicacion encolado para este mes. Es lo que permite
  // que GET /calendario/:sala/:anio/:mes informe del progreso sin que el cliente
  // tenga que acordarse del jobId que le devolvio el POST.
  ultimoJobId String?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([tenantId, salaId, anio, mes])
  @@map("meses_calendario")
}

model VacacionAlumno {
  id       String @id @default(cuid())
  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id])
  perfilId String
  perfil   Perfil @relation(fields: [tenantId, perfilId], references: [tenantId, id], onDelete: Cascade)

  desde  DateTime @db.Date
  hasta  DateTime @db.Date
  motivo String?

  // Se almacena y NO se aplica en esta fase. Con el conteo derivado de la Fase 1,
  // no generar la reserva ya equivale a no gastar la clase, asi que no hay nada
  // que devolver. Queda para cuando exista facturacion o creditos (Fase 5).
  devuelveClase Boolean @default(true)

  createdAt DateTime @default(now())

  @@index([tenantId, perfilId])
  @@map("vacaciones_alumnos")
}

model Ausencia {
  // Cierre de una sala o de todo el salon: feriado, evento, reforma. salaId null
  // = todo el salon. La Fase 6 la expondra completa en Mantenimiento; el motor
  // ya la respeta desde aqui.
  id       String @id @default(cuid())
  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id])

  salaId String?
  sala   Sala?   @relation(fields: [tenantId, salaId], references: [tenantId, id], onDelete: Cascade)

  // El PDF usaba DateTime completo junto a un todoElDia. Aqui las fechas son
  // @db.Date y el tramo horario va aparte en "HH:MM", la misma convencion que
  // Turno: cubre "cerramos el sabado de 14 a 18" sin arrastrar husos horarios.
  desde DateTime @db.Date
  hasta DateTime @db.Date

  todoElDia  Boolean @default(true)
  horaInicio String? // solo si todoElDia = false
  horaFin    String?

  recuperable Boolean @default(true)
  motivo      String?

  createdAt DateTime @default(now())

  @@index([tenantId, salaId])
  @@map("ausencias")
}
```

- [ ] **Step 2: Back-relations y el índice único de turnos**

En el modelo `Tenant`, junto a las que ya tiene:

```prisma
  rutinasFijas    RutinaFija[]
  mesesCalendario MesCalendario[]
  vacaciones      VacacionAlumno[]
  ausencias       Ausencia[]
```

En el modelo `Sala`:

```prisma
  rutinasFijas    RutinaFija[]
  mesesCalendario MesCalendario[]
  ausencias       Ausencia[]
```

En el modelo `Perfil`:

```prisma
  rutinasFijas RutinaFija[]
  vacaciones   VacacionAlumno[]
```

Y en el modelo `Turno`, añadir junto a sus índices:

```prisma
  // No hay dos clases a la vez en el mismo espacio. Ademas de ser cierto, el
  // motor de generacion lo necesita: es lo que hace que publicar dos veces no
  // duplique turnos.
  //
  // OJO: esto CAMBIA una regla de la Fase 1, donde si se podian crear dos turnos
  // en la misma sala, fecha y hora. Ningun test existente lo ejercitaba.
  @@unique([tenantId, salaId, fecha, horaInicio])
```

- [ ] **Step 3: Validar y generar la migración**

```bash
cd apps/api
pnpm exec prisma validate
pnpm exec dotenv -e ../../.env -- prisma migrate dev --name fase2_motor_recurrencia
```

Esperado: `The schema at prisma\schema.prisma is valid 🚀` y la migración creada y aplicada.

Si `migrate dev` se queda esperando una confirmación interactiva por el aviso de que se añade una
restricción de unicidad, es que hay filas que la violan en la base de desarrollo. Comprueba con:

```bash
docker exec -i box-admin-postgres-1 psql -U boxadmin -d boxadmin -c \
  'SELECT "tenantId","salaId",fecha,"horaInicio",count(*) FROM turnos GROUP BY 1,2,3,4 HAVING count(*)>1;'
```

Si devuelve filas, son datos de pruebas manuales: bórralos con un `DELETE` acotado a esos turnos y
vuelve a intentarlo. **No borres la base entera ni ejecutes `migrate reset`.**

- [ ] **Step 4: Añadir a mano el índice único parcial de reservas**

Prisma no declara índices parciales, así que se escribe en el SQL de la migración. Abrir
`apps/api/prisma/migrations/<timestamp>_fase2_motor_recurrencia/migration.sql` y **añadir al final**:

```sql
-- Idempotencia de la generacion: un perfil no puede tener dos reservas ACTIVAS
-- en el mismo turno. Es un indice PARCIAL (solo sobre las no canceladas), asi
-- que Prisma no puede declararlo en el schema y se escribe aqui a mano.
--
-- La Fase 1 dejaba esta unicidad solo en manos del service, dentro de la
-- transaccion Serializable. Sigue estando ahi; esto es la red de debajo, y es lo
-- que garantiza que publicar un mes dos veces no duplique reservas aunque el
-- service tuviera un bug.
CREATE UNIQUE INDEX "reservas_activas_unicas"
  ON "reservas" ("tenantId", "turnoId", "perfilId")
  WHERE "canceladaEn" IS NULL;
```

Aplicarlo:

```bash
cd apps/api
pnpm exec dotenv -e ../../.env -- prisma migrate deploy
```

Si `migrate deploy` dice que no hay nada que aplicar (porque el Step 3 ya marcó la migración como
aplicada), ejecuta el `CREATE UNIQUE INDEX` directamente contra la base de desarrollo y deja el SQL en
el archivo para que otras máquinas lo apliquen desde cero:

```bash
docker exec -i box-admin-postgres-1 psql -U boxadmin -d boxadmin -c \
  'CREATE UNIQUE INDEX "reservas_activas_unicas" ON "reservas" ("tenantId","turnoId","perfilId") WHERE "canceladaEn" IS NULL;'
```

- [ ] **Step 5: Comprobar que el índice parcial hace lo que debe**

```bash
docker exec -i box-admin-postgres-1 psql -U boxadmin -d boxadmin -c \
  "SELECT indexdef FROM pg_indexes WHERE indexname = 'reservas_activas_unicas';"
```

Esperado: la definición con `WHERE (\"canceladaEn\" IS NULL)`. Que el `WHERE` esté presente es el punto
entero: sin él, una reserva cancelada impediría volver a reservar ese turno.

- [ ] **Step 6: Clasificar los modelos nuevos**

En `apps/api/src/common/tenant/tenant-scoped.extension.ts`:

```ts
export const MODELOS_CON_TENANT = [
  'Usuario',
  'HistorialAccion',
  'Sala',
  'Perfil',
  'UsuarioSala',
  'Pack',
  'Turno',
  'Reserva',
  'RutinaFija',
  'MesCalendario',
  'VacacionAlumno',
  'Ausencia',
] as const;
```

- [ ] **Step 7: Verificar el centinela**

```bash
cd D:/Dev/box-admin
pnpm --filter @boxadmin/api db:generate
pnpm --filter @boxadmin/api test -- tenant-scoped.extension
```

Esperado: PASS. Hay un test que recorre todos los modelos del schema y falla si alguno no está
clasificado; si falla listando modelos, el Step 6 se saltó alguno. Ese es justo el fallo que el
centinela existe para encontrar.

- [ ] **Step 8: Ampliar la limpieza de la base de test**

Crítico: si falta una tabla, los e2e se contaminan entre sí con síntomas que no apuntan a la causa. En
`apps/api/test/helpers.ts`:

```ts
export async function limpiarBaseDeDatos(prisma: PrismaService): Promise<void> {
  await prisma.base.$executeRawUnsafe(
    'TRUNCATE TABLE ' +
      '"rutinas_fijas", "meses_calendario", "vacaciones_alumnos", "ausencias", ' +
      '"reservas", "usuarios_salas", "turnos", "perfiles", "packs", "salas", ' +
      '"refresh_tokens", "usuarios", "historial_acciones", "tenants" ' +
      'RESTART IDENTITY CASCADE',
  );
}
```

- [ ] **Step 9: Suite completa y tipos**

```bash
pnpm --filter @boxadmin/api exec tsc --noEmit
pnpm --filter @boxadmin/api test
pnpm --filter @boxadmin/api test:e2e
```

Esperado: `tsc` sin salida, 326 unitarios y 56 e2e en verde. Si algún e2e falla aquí, lo más probable
es un nombre de tabla mal escrito en el `TRUNCATE` del Step 8.

- [ ] **Step 10: Anotar mensaje de commit sugerido**

```
feat(db): modelo de datos de la Fase 2

RutinaFija, MesCalendario, VacacionAlumno y Ausencia, con claves foraneas
compuestas por tenant como el resto del schema. Se corrigen las relaciones
corruptas del PDF y las fechas de Ausencia pasan a @db.Date con tramo horario
aparte, en vez de DateTime + todoElDia.

Dos indices nuevos sostienen la idempotencia del motor: unicidad de turno por
(tenant, sala, fecha, horaInicio) —que ademas impide dos clases a la vez en el
mismo espacio, algo que la Fase 1 permitia— y un indice UNICO PARCIAL sobre
reservas activas, escrito a mano en el SQL porque Prisma no los declara.

Archivos: apps/api/prisma/schema.prisma
          apps/api/prisma/migrations/<ts>_fase2_motor_recurrencia/
          apps/api/src/common/tenant/tenant-scoped.extension.ts
          apps/api/test/helpers.ts
```

---
### Task 2: Traducir los errores de Prisma a HTTP

Deuda declarada en la Fase 1 que ahora **hay que pagar**: `AllExceptionsFilter` solo distingue
`HttpException`, así que cualquier error de Prisma sale como un 500 opaco. Con los dos índices únicos
que acaba de añadir la T1, un `P2002` es ahora un desenlace normal y frecuente, no una rareza.

Hay precedente reciente y caro: en la Fase 1, un conflicto de serialización que nadie traducía
producía un 500 intermitente que costó una sesión entera localizar.

**Files:**
- Modify: `apps/api/src/common/filters/all-exceptions.filter.ts`
- Modify: `apps/api/src/common/filters/all-exceptions.filter.spec.ts`

- [x] **Step 1: Escribir los tests (fallan)**

Añadir a `apps/api/src/common/filters/all-exceptions.filter.spec.ts`. Reutiliza los dobles de
`ArgumentsHost` que el archivo ya tiene; si su forma no encaja, replica el patrón del test que ya
existe para `HttpException`.

```ts
describe('errores de Prisma traducidos a HTTP', () => {
  it('P2002 (unicidad violada) es 409, no 500', () => {
    const { filtro, host, res } = crearEntorno();
    const error = Object.assign(new Error('Unique constraint failed'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2002',
      meta: { target: ['tenantId', 'turnoId', 'perfilId'] },
    });

    filtro.catch(error, host);

    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('P2003 (clave foranea) es 400', () => {
    const { filtro, host, res } = crearEntorno();
    const error = Object.assign(new Error('Foreign key constraint failed'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2003',
    });

    filtro.catch(error, host);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('P2025 (fila inexistente) es 404', () => {
    const { filtro, host, res } = crearEntorno();
    const error = Object.assign(new Error('Record to update not found'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2025',
    });

    filtro.catch(error, host);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('reconoce tambien la forma del driver adapter, que no trae code', () => {
    // Leccion de la Fase 1: con el adapter `pg` de Prisma 7, algunos errores
    // llegan como DriverAdapterError con `cause.kind` y SIN `code`. Comprobar
    // solo `code` dejo el reintento de serializacion como codigo muerto durante
    // toda una fase.
    const { filtro, host, res } = crearEntorno();
    const error = Object.assign(new Error('UniqueConstraintViolation'), {
      name: 'DriverAdapterError',
      cause: { kind: 'UniqueConstraintViolation', fields: ['turnoId'] },
    });

    filtro.catch(error, host);

    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('un codigo de Prisma no contemplado sigue siendo 500 opaco', () => {
    const { filtro, host, res } = crearEntorno();
    const error = Object.assign(new Error('algo raro'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P1001',
    });

    filtro.catch(error, host);

    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('la respuesta de un P2002 no filtra el mensaje interno de Prisma', () => {
    const { filtro, host, json } = crearEntorno();
    const error = Object.assign(new Error('Unique constraint failed on the fields: (`tokenHash`)'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2002',
    });

    filtro.catch(error, host);

    // El cliente merece saber que choco con algo existente, no como se llaman
    // nuestras columnas.
    expect(JSON.stringify(json.mock.calls[0][0])).not.toContain('tokenHash');
  });
});
```

- [x] **Step 2: Verificar que fallan**

```bash
pnpm --filter @boxadmin/api test -- all-exceptions
```

Esperado: los seis nuevos en rojo, los que ya existían en verde. Si el helper `crearEntorno()` no
existe en el archivo, créalo extrayendo el doble que usan los tests actuales — no dupliques.

- [x] **Step 3: Implementar**

En `apps/api/src/common/filters/all-exceptions.filter.ts`, añadir antes de la clase:

```ts
/**
 * Codigos de Prisma que son culpa del cliente, no nuestra, y que por tanto
 * merecen una respuesta util en vez de un 500 opaco.
 *
 * Deuda declarada en la Fase 1 y pagada aqui porque la Fase 2 anade dos indices
 * unicos: un P2002 pasa a ser un desenlace normal.
 */
const ESTADO_POR_CODIGO_PRISMA: Readonly<Record<string, { status: HttpStatus; mensaje: string }>> = {
  P2002: {
    status: HttpStatus.CONFLICT,
    mensaje: 'Ya existe un registro con esos datos',
  },
  P2003: {
    status: HttpStatus.BAD_REQUEST,
    mensaje: 'La operacion referencia un registro que no existe',
  },
  P2025: {
    status: HttpStatus.NOT_FOUND,
    mensaje: 'El registro no existe',
  },
};

/**
 * La misma condicion vista desde el driver adapter.
 *
 * Con el adapter `pg` de Prisma 7 algunos errores no llegan con `code`: el
 * adapter los traduce a `{ kind: ... }` y los envuelve en un DriverAdapterError.
 * En la Fase 1 comprobar solo `code` dejo el reintento de serializacion sin
 * dispararse ni una vez.
 */
const ESTADO_POR_KIND_DEL_ADAPTER: Readonly<Record<string, { status: HttpStatus; mensaje: string }>> =
  {
    UniqueConstraintViolation: ESTADO_POR_CODIGO_PRISMA.P2002,
    ForeignKeyConstraintViolation: ESTADO_POR_CODIGO_PRISMA.P2003,
  };

function traducirErrorDePrisma(
  exception: unknown,
): { status: HttpStatus; mensaje: string } | undefined {
  if (typeof exception !== 'object' || exception === null) return undefined;

  const { code, name, cause } = exception as { code?: unknown; name?: unknown; cause?: unknown };

  if (typeof code === 'string' && code in ESTADO_POR_CODIGO_PRISMA) {
    return ESTADO_POR_CODIGO_PRISMA[code];
  }

  if (name === 'DriverAdapterError' && typeof cause === 'object' && cause !== null) {
    const kind = (cause as { kind?: unknown }).kind;
    if (typeof kind === 'string' && kind in ESTADO_POR_KIND_DEL_ADAPTER) {
      return ESTADO_POR_KIND_DEL_ADAPTER[kind];
    }
  }

  return undefined;
}
```

Y dentro de `catch()`, **justo después** del bloque de `HttpException` y **antes** del de errores de
aislamiento:

```ts
    const traducido = traducirErrorDePrisma(exception);
    if (traducido) {
      // Se registra el error completo, pero al cliente solo le llega el mensaje
      // generico: los nombres de nuestras columnas no son asunto suyo.
      this.logger.warn(
        `Error de base traducido a ${traducido.status} en ${req.method} ${req.url}: ` +
          `${exception instanceof Error ? exception.message : String(exception)}`,
      );

      res.status(traducido.status).json({
        statusCode: traducido.status,
        path: req.url,
        timestamp: new Date().toISOString(),
        message: traducido.mensaje,
      });
      return;
    }
```

- [x] **Step 4: Verificar que pasan**

```bash
pnpm --filter @boxadmin/api test -- all-exceptions
```

Esperado: todos en verde.

- [x] **Step 5: Suite completa**

```bash
pnpm --filter @boxadmin/api exec tsc --noEmit
pnpm --filter @boxadmin/api test
```

Esperado: `tsc` limpio, ~332 tests en verde.

- [x] **Step 6: Anotar mensaje de commit sugerido**

```
fix(errores): traducir los codigos de Prisma a HTTP

AllExceptionsFilter solo distinguia HttpException, asi que cualquier error de
base salia como 500 opaco. Con los dos indices unicos que anade la Fase 2, un
P2002 pasa a ser un desenlace normal: ahora es 409, P2003 es 400 y P2025 es
404. Se reconoce tambien la forma del driver adapter, que no trae `code` —la
misma que en la Fase 1 dejo el reintento de serializacion sin dispararse.

El mensaje que llega al cliente es generico: el detalle de Prisma se registra
en el log, no se devuelve.

Archivos: apps/api/src/common/filters/all-exceptions.filter.ts (+ spec)
```

---

### Task 3: Utilidades de calendario y contratos compartidos

**Files:**
- Create: `packages/shared/src/calendario.ts` + `calendario.spec.ts`
- Create: `packages/shared/src/recurrencia.contracts.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `apps/api/src/reservas/ventana-pack.ts`

- [ ] **Step 1: Tests de las utilidades de calendario (fallan)**

Crear `packages/shared/src/calendario.spec.ts`:

```ts
import {
  diasDelMes,
  fechasDelMesEnDiaSemana,
  primerDiaDelMesUtc,
  rangosSeSolapan,
  ultimoDiaDelMesUtc,
} from './calendario';

describe('primerDiaDelMesUtc / ultimoDiaDelMesUtc', () => {
  it('acota un mes de 31 dias', () => {
    expect(primerDiaDelMesUtc(2026, 10).toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(ultimoDiaDelMesUtc(2026, 10).toISOString()).toBe('2026-10-31T00:00:00.000Z');
  });

  it('acota un mes de 30 dias', () => {
    expect(ultimoDiaDelMesUtc(2026, 11).toISOString()).toBe('2026-11-30T00:00:00.000Z');
  });

  it('acota febrero comun y bisiesto', () => {
    expect(ultimoDiaDelMesUtc(2026, 2).toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(ultimoDiaDelMesUtc(2028, 2).toISOString()).toBe('2028-02-29T00:00:00.000Z');
  });

  it('diciembre no se va al anio siguiente', () => {
    expect(ultimoDiaDelMesUtc(2026, 12).toISOString()).toBe('2026-12-31T00:00:00.000Z');
  });
});

describe('diasDelMes', () => {
  it.each([
    [2026, 1, 31],
    [2026, 2, 28],
    [2028, 2, 29],
    [2026, 4, 30],
    [2026, 12, 31],
  ])('%i-%i tiene %i dias', (anio, mes, esperado) => {
    expect(diasDelMes(anio, mes)).toBe(esperado);
  });
});

describe('fechasDelMesEnDiaSemana', () => {
  it('devuelve todos los martes de octubre de 2026', () => {
    // 2026-10-01 es jueves; los martes son 6, 13, 20 y 27.
    const martes = fechasDelMesEnDiaSemana(2026, 10, 2).map((f) => f.toISOString().slice(0, 10));

    expect(martes).toEqual(['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27']);
  });

  it('cuenta el domingo como 0', () => {
    const domingos = fechasDelMesEnDiaSemana(2026, 10, 0).map((f) => f.toISOString().slice(0, 10));

    expect(domingos).toEqual(['2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25']);
  });

  it('un mes puede tener cinco ocurrencias del mismo dia', () => {
    // Octubre de 2026 empieza en jueves, asi que tiene cinco.
    expect(fechasDelMesEnDiaSemana(2026, 10, 4)).toHaveLength(5);
  });

  it('devuelve fechas a medianoche UTC, para comparar con columnas @db.Date', () => {
    for (const fecha of fechasDelMesEnDiaSemana(2026, 10, 2)) {
      expect(fecha.toISOString().slice(10)).toBe('T00:00:00.000Z');
    }
  });

  it('rechaza un dia de semana fuera de 0..6', () => {
    expect(() => fechasDelMesEnDiaSemana(2026, 10, 7)).toThrow();
    expect(() => fechasDelMesEnDiaSemana(2026, 10, -1)).toThrow();
  });

  it('rechaza un mes fuera de 1..12', () => {
    expect(() => fechasDelMesEnDiaSemana(2026, 13, 2)).toThrow();
    expect(() => fechasDelMesEnDiaSemana(2026, 0, 2)).toThrow();
  });
});

describe('rangosSeSolapan', () => {
  const d = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

  it('detecta un solape parcial', () => {
    expect(rangosSeSolapan(d('2026-10-05'), d('2026-10-10'), d('2026-10-08'), d('2026-10-12'))).toBe(
      true,
    );
  });

  it('los extremos cuentan como solape', () => {
    expect(rangosSeSolapan(d('2026-10-05'), d('2026-10-10'), d('2026-10-10'), d('2026-10-12'))).toBe(
      true,
    );
  });

  it('rangos disjuntos no se solapan', () => {
    expect(rangosSeSolapan(d('2026-10-05'), d('2026-10-10'), d('2026-10-11'), d('2026-10-12'))).toBe(
      false,
    );
  });

  it('un fin nulo significa "sin limite"', () => {
    expect(rangosSeSolapan(d('2026-01-01'), null, d('2030-05-05'), d('2030-06-06'))).toBe(true);
  });
});
```

- [ ] **Step 2: Verificar que fallan**

```bash
pnpm --filter @boxadmin/shared test
```

Esperado: FAIL — `Cannot find module './calendario'`.

- [ ] **Step 3: Implementar**

Crear `packages/shared/src/calendario.ts`:

```ts
import { FechaInvalidaError } from './fechas';

/** Medianoche UTC del dia 1 del mes. */
export function primerDiaDelMesUtc(anio: number, mes: number): Date {
  exigirMesValido(mes);
  return new Date(Date.UTC(anio, mes - 1, 1));
}

/**
 * Medianoche UTC del ultimo dia del mes.
 *
 * El dia 0 del mes SIGUIENTE es el ultimo de este, y `Date.UTC` normaliza solo:
 * asi no hay que saberse cuantos dias tiene febrero ni que anios son bisiestos.
 */
export function ultimoDiaDelMesUtc(anio: number, mes: number): Date {
  exigirMesValido(mes);
  return new Date(Date.UTC(anio, mes, 0));
}

export function diasDelMes(anio: number, mes: number): number {
  return ultimoDiaDelMesUtc(anio, mes).getUTCDate();
}

/**
 * Todas las fechas del mes que caen en `diaSemana` (0 = domingo ... 6 = sabado),
 * a medianoche UTC para poder compararlas con las columnas `@db.Date` de Prisma.
 */
export function fechasDelMesEnDiaSemana(anio: number, mes: number, diaSemana: number): Date[] {
  exigirMesValido(mes);
  if (!Number.isInteger(diaSemana) || diaSemana < 0 || diaSemana > 6) {
    throw new RangeError(`diaSemana debe estar entre 0 y 6, y llego ${diaSemana}`);
  }

  const total = diasDelMes(anio, mes);
  const fechas: Date[] = [];

  for (let dia = 1; dia <= total; dia++) {
    const fecha = new Date(Date.UTC(anio, mes - 1, dia));
    if (fecha.getUTCDay() === diaSemana) fechas.push(fecha);
  }

  return fechas;
}

/**
 * ¿Se solapan dos rangos de fechas, con los extremos incluidos?
 *
 * Un `hasta` nulo significa "sin limite por ese lado", que es como se modelan
 * las rutinas indefinidas.
 */
export function rangosSeSolapan(
  desdeA: Date,
  hastaA: Date | null,
  desdeB: Date,
  hastaB: Date | null,
): boolean {
  const finA = hastaA?.getTime() ?? Number.POSITIVE_INFINITY;
  const finB = hastaB?.getTime() ?? Number.POSITIVE_INFINITY;

  return desdeA.getTime() <= finB && desdeB.getTime() <= finA;
}

function exigirMesValido(mes: number): void {
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
    throw new FechaInvalidaError(`mes ${String(mes)}`);
  }
}
```

- [ ] **Step 4: Verificar que pasan**

```bash
pnpm --filter @boxadmin/shared test
```

Esperado: todos en verde.

- [ ] **Step 5: Quitar la duplicación en `ventana-pack.ts`**

`apps/api/src/reservas/ventana-pack.ts` tiene sus propias copias privadas de `primerDiaDelMes` y
`ultimoDiaDelMes`. Duplicar aritmética de fechas es precisamente donde aparecen los bugs de febrero,
así que se borran y se usan las de `@boxadmin/shared`.

Borrar de ese archivo las funciones privadas `primerDiaDelMes` y `ultimoDiaDelMes`, añadir al import
de `@boxadmin/shared`:

```ts
import {
  primerDiaDelMesUtc,
  ultimoDiaDelMesUtc,
  type TipoPack,
} from '@boxadmin/shared';
```

y dentro de `ventanaDeConteo`, sustituir la rama `MENSUAL` por:

```ts
  if (pack.tipo === 'MENSUAL') {
    const anio = fechaDelTurno.getUTCFullYear();
    const mes = fechaDelTurno.getUTCMonth() + 1;
    return { gte: primerDiaDelMesUtc(anio, mes), lte: ultimoDiaDelMesUtc(anio, mes) };
  }
```

Los 9 tests de `ventana-pack.spec.ts` no cambian: si siguen pasando, la sustitución es correcta.

- [ ] **Step 6: Escribir los contratos**

Crear `packages/shared/src/recurrencia.contracts.ts`:

```ts
/** 0 = domingo ... 6 = sabado, como `Date.getUTCDay()`. */
export type DiaSemana = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface RutinaPublica {
  id: string;
  tenantId: string;
  perfilId: string;
  salaId: string;
  /** Nombre del turno que generara, p. ej. "Pilates". */
  nombre: string;
  diaSemana: DiaSemana;
  /** `HH:MM`. */
  horaInicio: string;
  horaFin: string;
  activa: boolean;
  /** `YYYY-MM-DD`. */
  desde: string;
  /** `YYYY-MM-DD`, o `null` si la rutina es indefinida. */
  hasta: string | null;
}

export interface VacacionPublica {
  id: string;
  tenantId: string;
  perfilId: string;
  desde: string;
  hasta: string;
  motivo: string | null;
  /** Se almacena y NO se aplica en la Fase 2. Ver D3 del spec. */
  devuelveClase: boolean;
}

export interface AusenciaPublica {
  id: string;
  tenantId: string;
  /** `null` = todo el salon. */
  salaId: string | null;
  desde: string;
  hasta: string;
  todoElDia: boolean;
  /** `HH:MM`, solo si `todoElDia` es false. */
  horaInicio: string | null;
  horaFin: string | null;
  recuperable: boolean;
  motivo: string | null;
}

// ---------------------------------------------------------------------------
// El plan de un mes
// ---------------------------------------------------------------------------

/**
 * Situaciones que EXIGEN una decision humana antes de publicar.
 *
 * Deliberadamente separadas de las exclusiones: un mes con tres alumnos de
 * vacaciones produciria decenas de "conflictos" que nadie tiene que resolver y
 * que esconderian los dos que si.
 */
export type TipoConflicto = 'CUPO_LLENO' | 'FUERA_DE_PACK' | 'SALA_SIN_CUPO_BASE';

/** Fechas que no generan reserva por datos cargados a proposito. Informativas. */
export type TipoExclusion = 'AUSENCIA_SALA' | 'VACACION_ALUMNO';

export interface Conflicto {
  tipo: TipoConflicto;
  /** `null` cuando el conflicto es de la sala y no de un alumno concreto. */
  perfilId: string | null;
  /** `YYYY-MM-DD`. */
  fecha: string;
  detalle: string;
}

export interface Exclusion {
  tipo: TipoExclusion;
  perfilId: string | null;
  fecha: string;
  detalle: string;
}

export interface TurnoPlanificado {
  salaId: string;
  nombre: string;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  cupo: number;
}

export interface ReservaPlanificada {
  perfilId: string;
  salaId: string;
  fecha: string;
  horaInicio: string;
}

export interface ResumenDelPlan {
  turnos: number;
  reservas: number;
  conflictos: number;
  exclusiones: number;
}

/**
 * Lo que devuelve el planificador.
 *
 * Desviacion respecto al PDF, que definia `turnosACrear` y `reservasACrear` como
 * simples numeros: aqui son las listas completas, porque `previsualizar` tiene
 * que ensenarselas al admin. El recuento va aparte, en `resumen`.
 */
export interface PlanDeMes {
  turnosACrear: TurnoPlanificado[];
  reservasACrear: ReservaPlanificada[];
  conflictos: Conflicto[];
  exclusiones: Exclusion[];
  resumen: ResumenDelPlan;
}

// ---------------------------------------------------------------------------
// Estado del mes y de su publicacion
// ---------------------------------------------------------------------------

export type EstadoMes = 'BORRADOR' | 'HABILITADO';

export type EstadoJob = 'sin_job' | 'en_cola' | 'procesando' | 'terminado' | 'fallido';

export interface EstadoPublicacion {
  jobId: string;
  estado: EstadoJob;
  /** Resumen del plan aplicado, disponible solo cuando el job termino bien. */
  resumen: ResumenDelPlan | null;
  error: string | null;
}

export interface MesCalendarioPublico {
  /** `null` si el mes todavia no tiene fila: nunca se previsualizo ni publico. */
  id: string | null;
  tenantId: string;
  salaId: string;
  anio: number;
  mes: number;
  estado: EstadoMes;
  publicadoEn: string | null;
  publicadoPor: string | null;
  publicacion: EstadoPublicacion | null;
}

export interface PublicacionEncolada {
  jobId: string;
  salaId: string;
  anio: number;
  mes: number;
}
```

- [ ] **Step 7: Reexportar y compilar**

`packages/shared/src/index.ts`:

```ts
export * from './roles';
export * from './auth.contracts';
export * from './fechas';
export * from './calendario';
export * from './nucleo.contracts';
export * from './recurrencia.contracts';
```

```bash
pnpm --filter @boxadmin/shared build
pnpm --filter @boxadmin/shared test
pnpm --filter @boxadmin/api exec tsc --noEmit
pnpm --filter @boxadmin/api test
```

Esperado: todo en verde. Los tests de `ventana-pack` son el centinela del Step 5.

- [ ] **Step 8: Anotar mensaje de commit sugerido**

```
feat(shared): aritmetica de meses y contratos del motor de recurrencia

primerDiaDelMesUtc, ultimoDiaDelMesUtc, diasDelMes, fechasDelMesEnDiaSemana y
rangosSeSolapan, mas los tipos publicos de rutinas, vacaciones, ausencias y
PlanDeMes. ventana-pack.ts deja de tener sus copias privadas de la aritmetica
de meses: duplicarla es donde aparecen los bugs de febrero.

Conflictos y exclusiones son tipos distintos a proposito: un mes con tres
alumnos de vacaciones no debe enterrar los dos casos que si hay que resolver.

Archivos: packages/shared/src/calendario.ts (+ spec)
          packages/shared/src/recurrencia.contracts.ts
          packages/shared/src/index.ts
          apps/api/src/reservas/ventana-pack.ts
```

---
### Task 4: Módulo `rutinas`

Punto 1 del checklist. Es un CRUD con las mismas reglas que una reserva manual: la rutina de un alumno
en una sala a la que no tiene acceso no debe poder crearse.

**Files:**
- Create: `apps/api/src/rutinas/dto/crear-rutina.dto.ts`, `dto/actualizar-rutina.dto.ts`
- Create: `apps/api/src/rutinas/rutinas.service.ts` + `rutinas.service.spec.ts`
- Create: `apps/api/src/rutinas/rutinas.controller.ts`, `rutinas.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [x] **Step 1: DTOs**

Crear `apps/api/src/rutinas/dto/crear-rutina.dto.ts`:

```ts
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PATRON_FECHA, PATRON_HORA } from '@boxadmin/shared';

export class CrearRutinaDto {
  @IsString()
  @IsNotEmpty()
  perfilId!: string;

  @IsString()
  @IsNotEmpty()
  salaId!: string;

  /** Nombre del turno que generara esta rutina. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  nombre!: string;

  /** 0 = domingo ... 6 = sabado, igual que Date.getUTCDay(). */
  @IsInt()
  @Min(0)
  @Max(6)
  diaSemana!: number;

  @Matches(PATRON_HORA, { message: 'horaInicio debe tener formato HH:MM en 24 h' })
  horaInicio!: string;

  @Matches(PATRON_HORA, { message: 'horaFin debe tener formato HH:MM en 24 h' })
  horaFin!: string;

  @Matches(PATRON_FECHA, { message: 'desde debe tener formato YYYY-MM-DD' })
  desde!: string;

  /** Ausente = rutina indefinida. */
  @IsOptional()
  @Matches(PATRON_FECHA, { message: 'hasta debe tener formato YYYY-MM-DD' })
  hasta?: string;

  @IsOptional()
  @IsBoolean()
  activa?: boolean;
}
```

Crear `apps/api/src/rutinas/dto/actualizar-rutina.dto.ts`: los mismos campos **menos `perfilId` y
`salaId`** (mover una rutina de alumno o de sala es borrarla y crear otra; hacerlo por PATCH dejaría
turnos ya generados colgando de un patrón que ya no existe), todos con `@IsOptional()`.

- [x] **Step 2: Test del service (falla)**

Crear `apps/api/src/rutinas/rutinas.service.spec.ts`:

```ts
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { JwtPayload } from '@boxadmin/shared';
import { RutinasService } from './rutinas.service';
import type { HistorialService } from '../common/historial/historial.service';
import type { PrismaService } from '../prisma/prisma.service';

const ADMIN: JwtPayload = { sub: 'usr-1', tenantId: 'gym-1', rol: 'ADMIN_OPERATIVO' };

const FILA = {
  id: 'rut-1',
  tenantId: 'gym-1',
  perfilId: 'perf-1',
  salaId: 'sala-1',
  nombre: 'Pilates',
  diaSemana: 2,
  horaInicio: '18:00',
  horaFin: '19:00',
  activa: true,
  desde: new Date('2026-10-01T00:00:00.000Z'),
  hasta: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const BASE = {
  perfilId: 'perf-1',
  salaId: 'sala-1',
  nombre: 'Pilates',
  diaSemana: 2,
  horaInicio: '18:00',
  horaFin: '19:00',
  desde: '2026-10-01',
};

function crearServicio() {
  const rutinaFija = {
    create: jest.fn().mockResolvedValue(FILA),
    findFirst: jest.fn().mockResolvedValue(FILA),
    findMany: jest.fn().mockResolvedValue([FILA]),
    update: jest.fn().mockResolvedValue(FILA),
  };
  const perfil = {
    findFirst: jest.fn().mockResolvedValue({
      id: 'perf-1',
      tenantId: 'gym-1',
      salas: [{ salaId: 'sala-1' }],
    }),
  };
  const sala = { findFirst: jest.fn().mockResolvedValue({ id: 'sala-1', activa: true }) };

  const db = {
    rutinaFija,
    perfil,
    sala,
    $transaction: jest.fn((fn: (tx: unknown) => unknown): unknown => fn(db)),
  };
  const prisma = { db } as unknown as PrismaService;
  const historial = { registrar: jest.fn().mockResolvedValue(undefined) };

  return {
    servicio: new RutinasService(prisma, historial as unknown as HistorialService),
    rutinaFija,
    perfil,
    sala,
    historial,
  };
}

describe('RutinasService.crear', () => {
  it('crea la rutina y la audita', async () => {
    const { servicio, rutinaFija, historial } = crearServicio();

    const creada = await servicio.crear(ADMIN, BASE);

    expect(rutinaFija.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenantId: 'gym-1', perfilId: 'perf-1', diaSemana: 2 }),
    });
    expect(historial.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ entidad: 'RutinaFija', accion: 'CREADA' }),
      expect.anything(),
    );
    expect(creada.id).toBe('rut-1');
  });

  it('guarda desde como medianoche UTC y lo devuelve como YYYY-MM-DD', async () => {
    const { servicio, rutinaFija } = crearServicio();

    const creada = await servicio.crear(ADMIN, BASE);

    expect(rutinaFija.create.mock.calls[0][0].data.desde.toISOString()).toBe(
      '2026-10-01T00:00:00.000Z',
    );
    expect(creada.desde).toBe('2026-10-01');
    expect(creada.hasta).toBeNull();
  });

  it('403 si el alumno no tiene acceso a la sala', async () => {
    const { servicio, perfil } = crearServicio();
    perfil.findFirst.mockResolvedValue({
      id: 'perf-1',
      tenantId: 'gym-1',
      salas: [{ salaId: 'sala-9' }],
    });

    // Misma regla que una reserva manual: sin acceso a la sala, la rutina
    // generaria mes tras mes reservas que el motor rechazaria.
    await expect(servicio.crear(ADMIN, BASE)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('404 si el perfil no existe en este gimnasio', async () => {
    const { servicio, perfil } = crearServicio();
    perfil.findFirst.mockResolvedValue(null);

    await expect(servicio.crear(ADMIN, BASE)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404 si la sala no existe en este gimnasio', async () => {
    const { servicio, sala } = crearServicio();
    sala.findFirst.mockResolvedValue(null);

    await expect(servicio.crear(ADMIN, BASE)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('400 si la sala esta dada de baja', async () => {
    const { servicio, sala } = crearServicio();
    sala.findFirst.mockResolvedValue({ id: 'sala-1', activa: false });

    await expect(servicio.crear(ADMIN, BASE)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('400 si horaFin no es posterior a horaInicio', async () => {
    const { servicio } = crearServicio();

    await expect(
      servicio.crear(ADMIN, { ...BASE, horaInicio: '19:00', horaFin: '18:00' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('400 si hasta es anterior a desde', async () => {
    const { servicio } = crearServicio();

    await expect(
      servicio.crear(ADMIN, { ...BASE, desde: '2026-10-10', hasta: '2026-10-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('acepta hasta igual a desde: una rutina de un solo dia es legitima', async () => {
    const { servicio } = crearServicio();

    await expect(
      servicio.crear(ADMIN, { ...BASE, desde: '2026-10-10', hasta: '2026-10-10' }),
    ).resolves.toBeDefined();
  });
});

describe('RutinasService.listar', () => {
  it('filtra por perfil y por sala', async () => {
    const { servicio, rutinaFija } = crearServicio();

    await servicio.listar(ADMIN, { perfilId: 'perf-1', salaId: 'sala-1' });

    expect(rutinaFija.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { perfilId: 'perf-1', salaId: 'sala-1' } }),
    );
  });

  it('sin filtros devuelve solo las activas: son las que generan', async () => {
    const { servicio, rutinaFija } = crearServicio();

    await servicio.listar(ADMIN, {});

    expect(rutinaFija.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { activa: true } }),
    );
  });

  it('activa:false permite ver el historico', async () => {
    const { servicio, rutinaFija } = crearServicio();

    await servicio.listar(ADMIN, { activa: false });

    expect(rutinaFija.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { activa: false } }),
    );
  });
});

describe('RutinasService.darDeBaja', () => {
  it('marca activa=false en vez de borrar', async () => {
    const { servicio, rutinaFija } = crearServicio();

    await servicio.darDeBaja(ADMIN, 'rut-1');

    // Borrarla perderia el rastro de por que existen los turnos ya generados.
    expect(rutinaFija.update).toHaveBeenCalledWith({
      where: { id: 'rut-1' },
      data: { activa: false },
    });
  });

  it('es idempotente: repetir la baja no vuelve a auditar', async () => {
    const { servicio, rutinaFija, historial } = crearServicio();
    rutinaFija.findFirst.mockResolvedValue({ ...FILA, activa: false });

    await servicio.darDeBaja(ADMIN, 'rut-1');

    expect(rutinaFija.update).not.toHaveBeenCalled();
    expect(historial.registrar).not.toHaveBeenCalled();
  });

  it('404 si la rutina no existe', async () => {
    const { servicio, rutinaFija } = crearServicio();
    rutinaFija.findFirst.mockResolvedValue(null);

    await expect(servicio.darDeBaja(ADMIN, 'rut-x')).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [x] **Step 3: Verificar que falla**

```bash
pnpm --filter @boxadmin/api test -- rutinas
```

Esperado: FAIL — `Cannot find module './rutinas.service'`.

- [x] **Step 4: Implementar el service**

Crear `apps/api/src/rutinas/rutinas.service.ts`:

```ts
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RutinaFija } from '@prisma/client';
import {
  aFechaISO,
  comparaHoras,
  desdeFechaISO,
  type DiaSemana,
  type JwtPayload,
  type RutinaPublica,
} from '@boxadmin/shared';
import { HistorialService } from '../common/historial/historial.service';
import { PrismaService, type ClientePrismaTx } from '../prisma/prisma.service';
import type { ActualizarRutinaDto } from './dto/actualizar-rutina.dto';
import type { CrearRutinaDto } from './dto/crear-rutina.dto';

export interface FiltroRutinas {
  perfilId?: string;
  salaId?: string;
  activa?: boolean;
}

export function aRutinaPublica(rutina: RutinaFija): RutinaPublica {
  return {
    id: rutina.id,
    tenantId: rutina.tenantId,
    perfilId: rutina.perfilId,
    salaId: rutina.salaId,
    nombre: rutina.nombre,
    diaSemana: rutina.diaSemana as DiaSemana,
    horaInicio: rutina.horaInicio,
    horaFin: rutina.horaFin,
    activa: rutina.activa,
    desde: aFechaISO(rutina.desde),
    hasta: rutina.hasta === null ? null : aFechaISO(rutina.hasta),
  };
}

@Injectable()
export class RutinasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly historial: HistorialService,
  ) {}

  async crear(actor: JwtPayload, dto: CrearRutinaDto): Promise<RutinaPublica> {
    this.exigirHorasCoherentes(dto.horaInicio, dto.horaFin);
    this.exigirVigenciaCoherente(dto.desde, dto.hasta);
    await this.exigirAccesoASala(dto.perfilId, dto.salaId);

    const rutina = await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      const creada = await cliente.rutinaFija.create({
        data: {
          tenantId: actor.tenantId,
          perfilId: dto.perfilId,
          salaId: dto.salaId,
          nombre: dto.nombre,
          diaSemana: dto.diaSemana,
          horaInicio: dto.horaInicio,
          horaFin: dto.horaFin,
          activa: dto.activa ?? true,
          desde: desdeFechaISO(dto.desde),
          hasta: dto.hasta ? desdeFechaISO(dto.hasta) : null,
        },
      });

      await this.historial.registrar(
        {
          actor,
          entidad: 'RutinaFija',
          entidadId: creada.id,
          accion: 'CREADA',
          detalle: {
            perfilId: dto.perfilId,
            salaId: dto.salaId,
            diaSemana: dto.diaSemana,
            horaInicio: dto.horaInicio,
          },
        },
        cliente,
      );

      return creada;
    });

    return aRutinaPublica(rutina);
  }

  async listar(actor: JwtPayload, filtro: FiltroRutinas): Promise<RutinaPublica[]> {
    const where: Record<string, unknown> = {};

    if (filtro.perfilId) where.perfilId = filtro.perfilId;
    if (filtro.salaId) where.salaId = filtro.salaId;
    // Sin filtro explicito se listan solo las activas: son las que generan. El
    // historico se pide a proposito con ?activa=false.
    where.activa = filtro.activa ?? true;

    const rutinas = await this.prisma.db.rutinaFija.findMany({
      where,
      orderBy: [{ diaSemana: 'asc' }, { horaInicio: 'asc' }],
    });

    return rutinas.map(aRutinaPublica);
  }

  async actualizar(
    actor: JwtPayload,
    id: string,
    dto: ActualizarRutinaDto,
  ): Promise<RutinaPublica> {
    const rutina = await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      const existente = await cliente.rutinaFija.findFirst({ where: { id } });
      if (!existente) throw new NotFoundException('Rutina inexistente');

      const inicio = dto.horaInicio ?? existente.horaInicio;
      const fin = dto.horaFin ?? existente.horaFin;
      this.exigirHorasCoherentes(inicio, fin);

      const desde = dto.desde ?? aFechaISO(existente.desde);
      const hasta =
        dto.hasta ?? (existente.hasta === null ? undefined : aFechaISO(existente.hasta));
      this.exigirVigenciaCoherente(desde, hasta);

      const actualizada = await cliente.rutinaFija.update({
        where: { id },
        data: {
          nombre: dto.nombre,
          diaSemana: dto.diaSemana,
          horaInicio: dto.horaInicio,
          horaFin: dto.horaFin,
          activa: dto.activa,
          desde: dto.desde ? desdeFechaISO(dto.desde) : undefined,
          hasta: dto.hasta ? desdeFechaISO(dto.hasta) : undefined,
        },
      });

      await this.historial.registrar(
        {
          actor,
          entidad: 'RutinaFija',
          entidadId: id,
          accion: 'ACTUALIZADA',
          detalle: { ...dto },
        },
        cliente,
      );

      return actualizada;
    });

    return aRutinaPublica(rutina);
  }

  async darDeBaja(actor: JwtPayload, id: string): Promise<RutinaPublica> {
    const rutina = await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      const existente = await cliente.rutinaFija.findFirst({ where: { id } });
      if (!existente) throw new NotFoundException('Rutina inexistente');

      // Idempotente: repetir el DELETE no vuelve a escribir una baja que ya
      // ocurrio. El historial no debe inventar acontecimientos.
      if (!existente.activa) return existente;

      const baja = await cliente.rutinaFija.update({
        where: { id },
        data: { activa: false },
      });

      await this.historial.registrar(
        { actor, entidad: 'RutinaFija', entidadId: id, accion: 'DADA_DE_BAJA' },
        cliente,
      );

      return baja;
    });

    return aRutinaPublica(rutina);
  }

  /**
   * Misma regla que una reserva manual: sin acceso a la sala, la rutina
   * generaria mes tras mes reservas que el motor acabaria rechazando.
   */
  private async exigirAccesoASala(perfilId: string, salaId: string): Promise<void> {
    const perfil = await this.prisma.db.perfil.findFirst({
      where: { id: perfilId },
      include: { salas: { select: { salaId: true } } },
    });
    if (!perfil) throw new NotFoundException('Perfil inexistente');

    const sala = await this.prisma.db.sala.findFirst({ where: { id: salaId } });
    if (!sala) throw new NotFoundException('Sala inexistente');
    if (!sala.activa) {
      throw new BadRequestException('No se pueden crear rutinas en una sala dada de baja');
    }

    const tieneAcceso = perfil.salas.some((union) => union.salaId === salaId);
    if (!tieneAcceso) {
      throw new ForbiddenException(
        'El usuario no tiene acceso a esa sala. Asignasela con PATCH /usuarios/:id/salas.',
      );
    }
  }

  private exigirHorasCoherentes(inicio: string, fin: string): void {
    if (comparaHoras(fin, inicio) <= 0) {
      throw new BadRequestException('horaFin debe ser posterior a horaInicio');
    }
  }

  private exigirVigenciaCoherente(desde: string, hasta: string | undefined): void {
    if (hasta && hasta < desde) {
      throw new BadRequestException('hasta no puede ser anterior a desde');
    }
  }
}
```

⚠️ `'RutinaFija'` tiene que existir en el tipo `EntidadAuditable` de
`apps/api/src/common/historial/historial.service.ts`. Añadirlo ahí junto a los demás, igual que
`'VacacionAlumno'`, `'Ausencia'` y `'MesCalendario'`, que harán falta en las tareas siguientes.

- [x] **Step 5: Verificar que pasan**

```bash
pnpm --filter @boxadmin/api test -- rutinas
```

Esperado: 15 PASS.

- [x] **Step 6: Controller y módulo**

Crear `apps/api/src/rutinas/rutinas.controller.ts` siguiendo el patrón de
`apps/api/src/salas/salas.controller.ts`: `@Controller('rutinas')`, `@Roles('ADMIN_OPERATIVO')` en las
cuatro rutas, `@Query` para `perfilId`, `salaId` y `activa` (este último con
`new ParseBoolPipe({ optional: true })`).

Crear `apps/api/src/rutinas/rutinas.module.ts` con el mismo patrón que `salas.module.ts`, exportando
`RutinasService`, y registrarlo en `apps/api/src/app.module.ts` (solo el import y la entrada en
`imports`; no reordenes ni reformatees el resto).

- [x] **Step 7: Suite completa**

```bash
pnpm --filter @boxadmin/api exec tsc --noEmit
pnpm --filter @boxadmin/api test
```

- [x] **Step 8: Anotar mensaje de commit sugerido**

```
feat(rutinas): CRUD de rutinas fijas

El patron semanal de un alumno, cargado una vez. Valida acceso a la sala con
la misma regla que una reserva manual: sin acceso, la rutina generaria mes
tras mes reservas que el motor rechazaria. La baja es logica e idempotente.

El PATCH no admite cambiar de perfil ni de sala: eso deja turnos ya generados
colgando de un patron que ya no existe, y para eso se borra y se crea otra.

Archivos: apps/api/src/rutinas/ (module, controller, service + spec, dto/)
          apps/api/src/common/historial/historial.service.ts
          apps/api/src/app.module.ts
```

---

### Task 5: Módulos `vacaciones` y `ausencias`

Dos CRUDs pequeños que alimentan al motor. Van juntos porque comparten forma y ninguno llega a media
tarea por su cuenta.

**Files:**
- Create: `apps/api/src/vacaciones/` (dto, service + spec, controller, module)
- Create: `apps/api/src/ausencias/` (dto, service + spec, controller, module)
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: DTOs**

Crear `apps/api/src/vacaciones/dto/crear-vacacion.dto.ts`:

```ts
import { IsBoolean, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PATRON_FECHA } from '@boxadmin/shared';

export class CrearVacacionDto {
  @IsString()
  @IsNotEmpty()
  perfilId!: string;

  @Matches(PATRON_FECHA, { message: 'desde debe tener formato YYYY-MM-DD' })
  desde!: string;

  @Matches(PATRON_FECHA, { message: 'hasta debe tener formato YYYY-MM-DD' })
  hasta!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  motivo?: string;

  /**
   * Se almacena y NO se aplica en la Fase 2: con el conteo derivado de clases,
   * no generar la reserva ya equivale a no gastarla. Ver D3 del spec.
   */
  @IsOptional()
  @IsBoolean()
  devuelveClase?: boolean;
}
```

Crear `apps/api/src/ausencias/dto/crear-ausencia.dto.ts`:

```ts
import { IsBoolean, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PATRON_FECHA, PATRON_HORA } from '@boxadmin/shared';

export class CrearAusenciaDto {
  /** Ausente = cierra todo el salon. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  salaId?: string;

  @Matches(PATRON_FECHA, { message: 'desde debe tener formato YYYY-MM-DD' })
  desde!: string;

  @Matches(PATRON_FECHA, { message: 'hasta debe tener formato YYYY-MM-DD' })
  hasta!: string;

  @IsOptional()
  @IsBoolean()
  todoElDia?: boolean;

  @IsOptional()
  @Matches(PATRON_HORA, { message: 'horaInicio debe tener formato HH:MM en 24 h' })
  horaInicio?: string;

  @IsOptional()
  @Matches(PATRON_HORA, { message: 'horaFin debe tener formato HH:MM en 24 h' })
  horaFin?: string;

  @IsOptional()
  @IsBoolean()
  recuperable?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  motivo?: string;
}
```

- [ ] **Step 2: Tests (fallan)**

Crear `apps/api/src/vacaciones/vacaciones.service.spec.ts` y
`apps/api/src/ausencias/ausencias.service.spec.ts` con el mismo patrón de doble de Prisma que
`rutinas.service.spec.ts` (incluida la anotación `: unknown` en el doble de `$transaction`, sin la cual
`tsc --strict` lanza TS7022 por inferencia circular).

Casos de **vacaciones**:

```ts
  it('crea el rango y lo audita');
  it('guarda las fechas a medianoche UTC y las devuelve como YYYY-MM-DD');
  it('400 si hasta es anterior a desde');
  it('acepta un unico dia (desde === hasta)');
  it('404 si el perfil no existe en este gimnasio');
  it('devuelveClase se almacena tal cual, aunque en esta fase no se aplique');
  it('listar filtra por perfilId');
  it('darDeBaja borra el rango: unas vacaciones mal cargadas se corrigen borrandolas');
  it('404 al borrar un rango inexistente');
```

Casos de **ausencias**:

```ts
  it('crea un cierre de todo el salon cuando salaId es null');
  it('crea un cierre de una sala concreta');
  it('404 si la sala indicada no existe en este gimnasio');
  it('400 si hasta es anterior a desde');
  it('400 si todoElDia es false y falta horaInicio o horaFin');
  it('400 si horaFin no es posterior a horaInicio');
  it('con todoElDia true ignora el tramo horario y lo guarda como null');
  it('listar filtra por sala incluyendo los cierres de todo el salon');
  it('listar filtra por rango de fechas solapado, no por contencion');
  it('darDeBaja borra el cierre y lo audita');
```

⚠️ El penúltimo es el que importa de verdad: un cierre **de todo el salón** (`salaId: null`) tiene que
aparecer cuando se filtra por una sala concreta, igual que un pack sin sala aparece al filtrar packs
por sala. Omitirlo haría que el admin no viera el feriado que sí afecta a esa sala.

Y el de solape: `?desde=&hasta=` debe devolver los cierres que **tocan** el rango pedido, no solo los
contenidos enteros en él. Un cierre del 28 de septiembre al 3 de octubre tiene que salir al preguntar
por octubre.

- [ ] **Step 3: Verificar que fallan y luego implementar**

```bash
pnpm --filter @boxadmin/api test -- vacaciones ausencias
```

Esperado: FAIL por módulos inexistentes.

Implementar `vacaciones.service.ts` y `ausencias.service.ts` siguiendo el patrón de
`rutinas.service.ts`: `$transaction` para escribir, `HistorialService` dentro de la transacción,
`findFirst` en lugar de `findUnique` (prohibido dentro del contexto de tenant), y proyecciones
`aVacacionPublica` / `aAusenciaPublica` a los contratos de `@boxadmin/shared`.

El `where` del filtro de ausencias por sala:

```ts
    // Un cierre de todo el salon (salaId null) afecta tambien a esta sala.
    if (filtro.salaId) {
      where.OR = [{ salaId: filtro.salaId }, { salaId: null }];
    }

    // Solape, no contencion: un cierre del 28/09 al 03/10 tiene que salir al
    // preguntar por octubre.
    if (filtro.desde) where.hasta = { gte: desdeFechaISO(filtro.desde) };
    if (filtro.hasta) where.desde = { lte: desdeFechaISO(filtro.hasta) };
```

Y la coherencia del tramo horario:

```ts
    const todoElDia = dto.todoElDia ?? true;

    if (!todoElDia) {
      if (!dto.horaInicio || !dto.horaFin) {
        throw new BadRequestException(
          'Un cierre parcial necesita horaInicio y horaFin. Si cierra el dia entero, usa todoElDia.',
        );
      }
      if (comparaHoras(dto.horaFin, dto.horaInicio) <= 0) {
        throw new BadRequestException('horaFin debe ser posterior a horaInicio');
      }
    }

    // Con todoElDia, el tramo horario no significa nada: se descarta en vez de
    // guardarse a medias y confundir al motor.
    const horaInicio = todoElDia ? null : (dto.horaInicio as string);
    const horaFin = todoElDia ? null : (dto.horaFin as string);
```

- [ ] **Step 4: Controllers y módulos**

`@Controller('vacaciones-alumnos')` con `@Roles('ADMIN_OPERATIVO')` en las tres rutas.

`@Controller('ausencias')` con **`@Roles('ADMIN_SALON')` en `POST` y `DELETE`** —cerrar el salón es un
acto de gestión— y `GET` sin `@Roles` (cualquier autenticado: a un profesor le interesa saber que el
salón cierra).

Registrar ambos módulos en `apps/api/src/app.module.ts`.

- [ ] **Step 5: Suite completa**

```bash
pnpm --filter @boxadmin/api exec tsc --noEmit
pnpm --filter @boxadmin/api test
pnpm --filter @boxadmin/api exec prettier --check "src/{rutinas,vacaciones,ausencias}/**/*.ts"
```

- [ ] **Step 6: Anotar mensaje de commit sugerido**

```
feat(vacaciones,ausencias): los dos calendarios que alimentan al motor

Vacaciones de un alumno y cierres de sala o de salon entero. Un cierre de todo
el salon aparece al filtrar por cualquier sala, y el filtro por fechas busca
solape y no contencion: un cierre del 28/09 al 03/10 sale al preguntar por
octubre.

devuelveClase se almacena y no se aplica: con el conteo derivado de clases, no
generar la reserva ya equivale a no gastarla.

Archivos: apps/api/src/vacaciones/, apps/api/src/ausencias/
          apps/api/src/app.module.ts
```

---
### Task 6: El planificador puro

**Esta es la tarea central de la fase.** Todo el algoritmo del §5 del PDF vive aquí, en una función que
**no toca la base de datos ni la cola**: recibe los datos ya cargados y devuelve un plan. Por eso los
ocho casos del checklist se pueden cubrir con tests unitarios de verdad, sin `beforeEach` que trunque
tablas ni workers que haya que esperar.

**Files:**
- Create: `apps/api/src/jobs/generacion-mes/generacion-mes.service.ts`
- Create: `apps/api/src/jobs/generacion-mes/generacion-mes.service.spec.ts`

- [ ] **Step 1: Escribir los tests (fallan)**

Crear `apps/api/src/jobs/generacion-mes/generacion-mes.service.spec.ts`:

```ts
import { planificarMes, type EntradaPlanificacion } from './generacion-mes.service';

const d = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

const SALA = { id: 'sala-1', nombre: 'Sala A', cupoBase: 2 };

/** Rutina de los martes a las 18:00, vigente desde siempre. */
const RUTINA_MARTES = {
  id: 'rut-1',
  perfilId: 'perf-1',
  salaId: 'sala-1',
  nombre: 'Pilates',
  diaSemana: 2,
  horaInicio: '18:00',
  horaFin: '19:00',
  desde: d('2020-01-01'),
  hasta: null,
};

const PERFIL_SIN_TOPE = {
  id: 'perf-1',
  vigenciaHasta: null,
  clasesExtra: 0,
  pack: null,
  clasesConsumidas: 0,
};

/** Octubre de 2026 tiene cuatro martes: 6, 13, 20 y 27. */
function entrada(parcial: Partial<EntradaPlanificacion> = {}): EntradaPlanificacion {
  return {
    sala: SALA,
    anio: 2026,
    mes: 10,
    rutinas: [RUTINA_MARTES],
    ausencias: [],
    vacaciones: [],
    turnosExistentes: [],
    reservasActivas: [],
    perfiles: [PERFIL_SIN_TOPE],
    ...parcial,
  };
}

describe('planificarMes — caso sin conflictos', () => {
  it('planifica un turno y una reserva por cada martes del mes', () => {
    const plan = planificarMes(entrada());

    expect(plan.turnosACrear).toHaveLength(4);
    expect(plan.reservasACrear).toHaveLength(4);
    expect(plan.conflictos).toEqual([]);
    expect(plan.exclusiones).toEqual([]);
    expect(plan.resumen).toEqual({ turnos: 4, reservas: 4, conflictos: 0, exclusiones: 0 });
  });

  it('las fechas planificadas son los martes reales de octubre de 2026', () => {
    const plan = planificarMes(entrada());

    expect(plan.turnosACrear.map((t) => t.fecha)).toEqual([
      '2026-10-06',
      '2026-10-13',
      '2026-10-20',
      '2026-10-27',
    ]);
  });

  it('el turno hereda el cupo de la sala y el nombre de la rutina', () => {
    const plan = planificarMes(entrada());

    expect(plan.turnosACrear[0]).toEqual({
      salaId: 'sala-1',
      nombre: 'Pilates',
      fecha: '2026-10-06',
      horaInicio: '18:00',
      horaFin: '19:00',
      cupo: 2,
    });
  });

  it('dos alumnos en la misma franja comparten un solo turno', () => {
    const plan = planificarMes(
      entrada({
        rutinas: [RUTINA_MARTES, { ...RUTINA_MARTES, id: 'rut-2', perfilId: 'perf-2' }],
        perfiles: [PERFIL_SIN_TOPE, { ...PERFIL_SIN_TOPE, id: 'perf-2' }],
      }),
    );

    expect(plan.turnosACrear).toHaveLength(4);
    expect(plan.reservasACrear).toHaveLength(8);
  });

  it('no planifica nada si el mes no tiene ese dia de semana en la vigencia', () => {
    const plan = planificarMes(
      entrada({ rutinas: [{ ...RUTINA_MARTES, desde: d('2027-01-01') }] }),
    );

    expect(plan.turnosACrear).toEqual([]);
    expect(plan.reservasACrear).toEqual([]);
  });
});

describe('planificarMes — vigencia de la rutina', () => {
  it('excluye las fechas anteriores a `desde`', () => {
    const plan = planificarMes(
      entrada({ rutinas: [{ ...RUTINA_MARTES, desde: d('2026-10-14') }] }),
    );

    expect(plan.reservasACrear.map((r) => r.fecha)).toEqual(['2026-10-20', '2026-10-27']);
  });

  it('excluye las fechas posteriores a `hasta`', () => {
    const plan = planificarMes(
      entrada({ rutinas: [{ ...RUTINA_MARTES, hasta: d('2026-10-14') }] }),
    );

    expect(plan.reservasACrear.map((r) => r.fecha)).toEqual(['2026-10-06', '2026-10-13']);
  });

  it('los extremos de la vigencia estan incluidos', () => {
    const plan = planificarMes(
      entrada({ rutinas: [{ ...RUTINA_MARTES, desde: d('2026-10-13'), hasta: d('2026-10-13') }] }),
    );

    expect(plan.reservasACrear.map((r) => r.fecha)).toEqual(['2026-10-13']);
  });
});

describe('planificarMes — cupo lleno', () => {
  it('registra CUPO_LLENO y no planifica la reserva', () => {
    const plan = planificarMes(
      entrada({
        sala: { ...SALA, cupoBase: 1 },
        rutinas: [RUTINA_MARTES, { ...RUTINA_MARTES, id: 'rut-2', perfilId: 'perf-2' }],
        perfiles: [PERFIL_SIN_TOPE, { ...PERFIL_SIN_TOPE, id: 'perf-2' }],
      }),
    );

    expect(plan.turnosACrear).toHaveLength(4);
    expect(plan.reservasACrear).toHaveLength(4);
    expect(plan.conflictos).toHaveLength(4);
    expect(plan.conflictos[0]).toEqual(
      expect.objectContaining({ tipo: 'CUPO_LLENO', perfilId: 'perf-2', fecha: '2026-10-06' }),
    );
  });

  it('un conflicto de cupo NO interrumpe el resto del mes', () => {
    // El punto 7 del algoritmo del PDF: el objetivo es que el admin revise una
    // lista acotada, no que un alumno bloquee el mes entero.
    const plan = planificarMes(
      entrada({
        sala: { ...SALA, cupoBase: 1 },
        rutinas: [RUTINA_MARTES, { ...RUTINA_MARTES, id: 'rut-2', perfilId: 'perf-2' }],
        perfiles: [PERFIL_SIN_TOPE, { ...PERFIL_SIN_TOPE, id: 'perf-2' }],
      }),
    );

    expect(plan.reservasACrear.map((r) => r.fecha)).toEqual([
      '2026-10-06',
      '2026-10-13',
      '2026-10-20',
      '2026-10-27',
    ]);
  });

  it('cuenta las reservas que ya ocupan un turno existente', () => {
    const plan = planificarMes(
      entrada({
        turnosExistentes: [
          {
            id: 'turno-1',
            fecha: d('2026-10-06'),
            horaInicio: '18:00',
            cupo: 1,
            reservasActivas: 1,
          },
        ],
      }),
    );

    expect(plan.turnosACrear).toHaveLength(3);
    expect(plan.conflictos).toEqual([
      expect.objectContaining({ tipo: 'CUPO_LLENO', fecha: '2026-10-06' }),
    ]);
  });
});

describe('planificarMes — sala sin cupo base', () => {
  it('registra SALA_SIN_CUPO_BASE una sola vez por franja y no planifica nada', () => {
    const plan = planificarMes(entrada({ sala: { ...SALA, cupoBase: null } }));

    expect(plan.turnosACrear).toEqual([]);
    expect(plan.reservasACrear).toEqual([]);
    expect(plan.conflictos).toHaveLength(4);
    expect(plan.conflictos[0]).toEqual(
      expect.objectContaining({ tipo: 'SALA_SIN_CUPO_BASE', perfilId: null }),
    );
  });

  it('no afecta a los turnos que ya existen: esos ya tienen cupo propio', () => {
    const plan = planificarMes(
      entrada({
        sala: { ...SALA, cupoBase: null },
        turnosExistentes: [
          {
            id: 'turno-1',
            fecha: d('2026-10-06'),
            horaInicio: '18:00',
            cupo: 5,
            reservasActivas: 0,
          },
        ],
      }),
    );

    expect(plan.reservasACrear).toHaveLength(1);
    expect(plan.conflictos).toHaveLength(3);
  });
});

describe('planificarMes — pack', () => {
  it('registra FUERA_DE_PACK cuando la vigencia del perfil ya vencio', () => {
    const plan = planificarMes(
      entrada({
        perfiles: [{ ...PERFIL_SIN_TOPE, vigenciaHasta: d('2026-10-14') }],
      }),
    );

    expect(plan.reservasACrear.map((r) => r.fecha)).toEqual(['2026-10-06', '2026-10-13']);
    expect(plan.conflictos.map((c) => c.fecha)).toEqual(['2026-10-20', '2026-10-27']);
    expect(plan.conflictos[0].tipo).toBe('FUERA_DE_PACK');
  });

  it('registra FUERA_DE_PACK al agotar el tope del pack, contando lo ya consumido', () => {
    const plan = planificarMes(
      entrada({
        perfiles: [
          {
            ...PERFIL_SIN_TOPE,
            pack: { tipo: 'MENSUAL', clasesPorMes: 3, clasesTotales: null },
            clasesConsumidas: 1,
          },
        ],
      }),
    );

    // Tope 3, ya gastada 1 -> caben 2 mas, la cuarta fecha es conflicto.
    expect(plan.reservasACrear).toHaveLength(2);
    expect(plan.conflictos).toHaveLength(2);
    expect(plan.conflictos[0].tipo).toBe('FUERA_DE_PACK');
  });

  it('clasesExtra amplia el tope', () => {
    const plan = planificarMes(
      entrada({
        perfiles: [
          {
            ...PERFIL_SIN_TOPE,
            pack: { tipo: 'MENSUAL', clasesPorMes: 2, clasesTotales: null },
            clasesExtra: 2,
            clasesConsumidas: 0,
          },
        ],
      }),
    );

    expect(plan.reservasACrear).toHaveLength(4);
    expect(plan.conflictos).toEqual([]);
  });

  it('un perfil sin pack no tiene tope', () => {
    const plan = planificarMes(entrada());

    expect(plan.conflictos).toEqual([]);
    expect(plan.reservasACrear).toHaveLength(4);
  });

  it('el cupo se comprueba ANTES que el pack, como manda el algoritmo del PDF', () => {
    const plan = planificarMes(
      entrada({
        sala: { ...SALA, cupoBase: 1 },
        turnosExistentes: [
          {
            id: 'turno-1',
            fecha: d('2026-10-06'),
            horaInicio: '18:00',
            cupo: 1,
            reservasActivas: 1,
          },
        ],
        perfiles: [{ ...PERFIL_SIN_TOPE, vigenciaHasta: d('2026-01-01') }],
      }),
    );

    // El 6 de octubre falla por las dos razones; debe reportarse la del cupo.
    const delSeis = plan.conflictos.find((c) => c.fecha === '2026-10-06');
    expect(delSeis?.tipo).toBe('CUPO_LLENO');
  });
});

describe('planificarMes — ausencias de sala', () => {
  it('una ausencia de todo el salon excluye la fecha', () => {
    const plan = planificarMes(
      entrada({ ausencias: [{ salaId: null, desde: d('2026-10-13'), hasta: d('2026-10-13') }] }),
    );

    expect(plan.reservasACrear.map((r) => r.fecha)).toEqual([
      '2026-10-06',
      '2026-10-20',
      '2026-10-27',
    ]);
    expect(plan.exclusiones).toEqual([
      expect.objectContaining({ tipo: 'AUSENCIA_SALA', fecha: '2026-10-13' }),
    ]);
  });

  it('una ausencia de OTRA sala no afecta', () => {
    const plan = planificarMes(
      entrada({ ausencias: [{ salaId: 'sala-9', desde: d('2026-10-13'), hasta: d('2026-10-13') }] }),
    );

    expect(plan.reservasACrear).toHaveLength(4);
    expect(plan.exclusiones).toEqual([]);
  });

  it('un rango de varios dias excluye todas las fechas que cubre', () => {
    const plan = planificarMes(
      entrada({ ausencias: [{ salaId: 'sala-1', desde: d('2026-10-12'), hasta: d('2026-10-21') }] }),
    );

    expect(plan.reservasACrear.map((r) => r.fecha)).toEqual(['2026-10-06', '2026-10-27']);
    expect(plan.exclusiones).toHaveLength(2);
  });

  it('una ausencia no crea el turno: si nadie puede venir, no hay clase', () => {
    const plan = planificarMes(
      entrada({ ausencias: [{ salaId: null, desde: d('2026-10-13'), hasta: d('2026-10-13') }] }),
    );

    expect(plan.turnosACrear.map((t) => t.fecha)).not.toContain('2026-10-13');
  });
});

describe('planificarMes — vacaciones del alumno', () => {
  it('excluyen solo a ese alumno, no el turno para el resto', () => {
    // Punto 6 del checklist, literal.
    const plan = planificarMes(
      entrada({
        rutinas: [RUTINA_MARTES, { ...RUTINA_MARTES, id: 'rut-2', perfilId: 'perf-2' }],
        perfiles: [PERFIL_SIN_TOPE, { ...PERFIL_SIN_TOPE, id: 'perf-2' }],
        vacaciones: [{ perfilId: 'perf-1', desde: d('2026-10-13'), hasta: d('2026-10-13') }],
      }),
    );

    expect(plan.turnosACrear).toHaveLength(4);
    expect(plan.reservasACrear).toHaveLength(7);
    expect(plan.exclusiones).toEqual([
      expect.objectContaining({ tipo: 'VACACION_ALUMNO', perfilId: 'perf-1', fecha: '2026-10-13' }),
    ]);
  });

  it('las vacaciones NO son un conflicto: no requieren decision humana', () => {
    const plan = planificarMes(
      entrada({
        vacaciones: [{ perfilId: 'perf-1', desde: d('2026-10-01'), hasta: d('2026-10-31') }],
      }),
    );

    expect(plan.conflictos).toEqual([]);
    expect(plan.exclusiones).toHaveLength(4);
  });
});

describe('planificarMes — idempotencia', () => {
  it('no planifica nada que ya exista', () => {
    // Punto 4 del checklist: correr la generacion dos veces no duplica.
    const turnos = ['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27'].map((fecha, i) => ({
      id: `turno-${i}`,
      fecha: d(fecha),
      horaInicio: '18:00',
      cupo: 2,
      reservasActivas: 1,
    }));

    const plan = planificarMes(
      entrada({
        turnosExistentes: turnos,
        reservasActivas: turnos.map((t) => ({ turnoId: t.id, perfilId: 'perf-1' })),
      }),
    );

    expect(plan.turnosACrear).toEqual([]);
    expect(plan.reservasACrear).toEqual([]);
    expect(plan.conflictos).toEqual([]);
  });

  it('una reserva ya existente no cuenta como conflicto de cupo', () => {
    const plan = planificarMes(
      entrada({
        turnosExistentes: [
          {
            id: 'turno-1',
            fecha: d('2026-10-06'),
            horaInicio: '18:00',
            cupo: 1,
            reservasActivas: 1,
          },
        ],
        reservasActivas: [{ turnoId: 'turno-1', perfilId: 'perf-1' }],
      }),
    );

    // El turno esta lleno, pero lo llena el propio alumno: no hay nada que hacer
    // ni nada que reportar.
    expect(plan.conflictos).toEqual([]);
  });

  it('planifica solo lo que falta cuando el mes esta a medias', () => {
    const plan = planificarMes(
      entrada({
        turnosExistentes: [
          {
            id: 'turno-1',
            fecha: d('2026-10-06'),
            horaInicio: '18:00',
            cupo: 2,
            reservasActivas: 1,
          },
        ],
        reservasActivas: [{ turnoId: 'turno-1', perfilId: 'perf-1' }],
      }),
    );

    expect(plan.turnosACrear).toHaveLength(3);
    expect(plan.reservasACrear).toHaveLength(3);
  });

  it('dos rutinas identicas del mismo alumno no producen dos reservas', () => {
    const plan = planificarMes(
      entrada({ rutinas: [RUTINA_MARTES, { ...RUTINA_MARTES, id: 'rut-duplicada' }] }),
    );

    expect(plan.reservasACrear).toHaveLength(4);
  });
});

describe('planificarMes — bordes de calendario', () => {
  it('acierta en un mes de 30 dias', () => {
    // Noviembre de 2026: martes 3, 10, 17 y 24.
    const plan = planificarMes(entrada({ mes: 11 }));

    expect(plan.reservasACrear.map((r) => r.fecha)).toEqual([
      '2026-11-03',
      '2026-11-10',
      '2026-11-17',
      '2026-11-24',
    ]);
  });

  it('acierta en febrero de un anio bisiesto', () => {
    // Febrero de 2028: martes 1, 8, 15, 22 y 29.
    const plan = planificarMes(entrada({ anio: 2028, mes: 2 }));

    expect(plan.reservasACrear.map((r) => r.fecha)).toEqual([
      '2028-02-01',
      '2028-02-08',
      '2028-02-15',
      '2028-02-22',
      '2028-02-29',
    ]);
  });

  it('diciembre no se desborda al anio siguiente', () => {
    const plan = planificarMes(entrada({ mes: 12 }));

    expect(plan.reservasACrear.every((r) => r.fecha.startsWith('2026-12'))).toBe(true);
  });

  it('el resultado es determinista: ordenado por fecha, hora y perfil', () => {
    const plan = planificarMes(
      entrada({
        rutinas: [
          { ...RUTINA_MARTES, id: 'rut-b', perfilId: 'perf-b' },
          { ...RUTINA_MARTES, id: 'rut-a', perfilId: 'perf-a' },
        ],
        perfiles: [
          { ...PERFIL_SIN_TOPE, id: 'perf-b' },
          { ...PERFIL_SIN_TOPE, id: 'perf-a' },
        ],
      }),
    );

    // Importa porque, con el cupo justo, quien entra y quien queda en conflicto
    // no puede depender del orden en que la base devolvio las filas.
    expect(plan.reservasACrear.slice(0, 2).map((r) => r.perfilId)).toEqual(['perf-a', 'perf-b']);
  });
});

describe('planificarMes — rutinas de otras salas', () => {
  it('ignora las rutinas que no son de la sala que se esta planificando', () => {
    const plan = planificarMes(
      entrada({ rutinas: [{ ...RUTINA_MARTES, salaId: 'sala-9' }] }),
    );

    expect(plan.turnosACrear).toEqual([]);
    expect(plan.reservasACrear).toEqual([]);
  });
});
```

- [ ] **Step 2: Verificar que fallan**

```bash
pnpm --filter @boxadmin/api test -- generacion-mes
```

Esperado: FAIL — `Cannot find module './generacion-mes.service'`.

- [ ] **Step 3: Implementar el planificador**

Crear `apps/api/src/jobs/generacion-mes/generacion-mes.service.ts`:

```ts
import {
  aFechaISO,
  fechasDelMesEnDiaSemana,
  type Conflicto,
  type Exclusion,
  type PlanDeMes,
  type ReservaPlanificada,
  type TipoPack,
  type TurnoPlanificado,
} from '@boxadmin/shared';
import { topeDelPack } from '../../reservas/ventana-pack';

// ---------------------------------------------------------------------------
// La entrada: todo lo que el planificador necesita, ya cargado
// ---------------------------------------------------------------------------

export interface SalaParaPlan {
  id: string;
  nombre: string;
  /** `null` = la sala no tiene de donde sacar el cupo de un turno nuevo. */
  cupoBase: number | null;
}

export interface RutinaParaPlan {
  id: string;
  perfilId: string;
  salaId: string;
  nombre: string;
  diaSemana: number;
  horaInicio: string;
  horaFin: string;
  desde: Date;
  hasta: Date | null;
}

export interface AusenciaParaPlan {
  /** `null` = todo el salon. */
  salaId: string | null;
  desde: Date;
  hasta: Date;
}

export interface VacacionParaPlan {
  perfilId: string;
  desde: Date;
  hasta: Date;
}

export interface TurnoExistenteParaPlan {
  id: string;
  fecha: Date;
  horaInicio: string;
  cupo: number;
  reservasActivas: number;
}

export interface ReservaExistenteParaPlan {
  turnoId: string;
  perfilId: string;
}

export interface PerfilParaPlan {
  id: string;
  /** `null` = sin fecha de fin de vigencia. */
  vigenciaHasta: Date | null;
  clasesExtra: number;
  pack: { tipo: TipoPack; clasesPorMes: number | null; clasesTotales: number | null } | null;
  /**
   * Clases ya consumidas dentro de la ventana del pack. Lo precalcula el
   * cargador de datos, porque derivarlo exige contar reservas en la base y el
   * planificador no la toca.
   */
  clasesConsumidas: number;
}

export interface EntradaPlanificacion {
  sala: SalaParaPlan;
  anio: number;
  mes: number;
  rutinas: RutinaParaPlan[];
  ausencias: AusenciaParaPlan[];
  vacaciones: VacacionParaPlan[];
  turnosExistentes: TurnoExistenteParaPlan[];
  reservasActivas: ReservaExistenteParaPlan[];
  perfiles: PerfilParaPlan[];
}

/** Una rutina aplicada a una fecha concreta del mes. */
interface Candidato {
  rutina: RutinaParaPlan;
  fecha: Date;
  fechaISO: string;
}

/** Estado de ocupacion de una franja horaria mientras se planifica. */
interface Franja {
  cupo: number | null;
  ocupadas: number;
  turnoExistenteId: string | null;
  perfilesConReserva: Set<string>;
}

const clave = (fechaISO: string, horaInicio: string): string => `${fechaISO}|${horaInicio}`;

function cubreFecha(fecha: Date, desde: Date, hasta: Date | null): boolean {
  if (fecha.getTime() < desde.getTime()) return false;
  return hasta === null || fecha.getTime() <= hasta.getTime();
}

/**
 * Convierte las rutinas de una sala en el plan de un mes.
 *
 * Es una funcion PURA a proposito: no toca la base de datos ni la cola. Todo el
 * I/O vive en el cargador (`calendario.datos.ts`) y en el worker. Gracias a eso
 * los ocho casos del checklist del PDF son tests unitarios de verdad, sin
 * truncar tablas ni esperar a un job.
 *
 * Sigue el orden del §5 del PDF: vigencia, ausencias, vacaciones, turno, cupo,
 * pack. Y su punto 7: un conflicto individual NUNCA aborta el resto. El objetivo
 * es que el admin revise una lista acotada, no que un alumno con el pack vencido
 * bloquee el mes entero.
 */
export function planificarMes(entrada: EntradaPlanificacion): PlanDeMes {
  const { sala, anio, mes } = entrada;

  const turnosACrear: TurnoPlanificado[] = [];
  const reservasACrear: ReservaPlanificada[] = [];
  const conflictos: Conflicto[] = [];
  const exclusiones: Exclusion[] = [];

  const perfilesPorId = new Map(entrada.perfiles.map((perfil) => [perfil.id, perfil]));
  const planificadasPorPerfil = new Map<string, number>();

  // --- Estado inicial de cada franja, a partir de lo que ya existe ----------
  const franjas = new Map<string, Franja>();
  for (const turno of entrada.turnosExistentes) {
    franjas.set(clave(aFechaISO(turno.fecha), turno.horaInicio), {
      cupo: turno.cupo,
      ocupadas: turno.reservasActivas,
      turnoExistenteId: turno.id,
      perfilesConReserva: new Set(),
    });
  }
  for (const reserva of entrada.reservasActivas) {
    for (const franja of franjas.values()) {
      if (franja.turnoExistenteId === reserva.turnoId) franja.perfilesConReserva.add(reserva.perfilId);
    }
  }

  // --- Candidatos: cada rutina de esta sala, en cada fecha que le toca ------
  const candidatos: Candidato[] = [];
  for (const rutina of entrada.rutinas) {
    if (rutina.salaId !== sala.id) continue;

    for (const fecha of fechasDelMesEnDiaSemana(anio, mes, rutina.diaSemana)) {
      if (!cubreFecha(fecha, rutina.desde, rutina.hasta)) continue;
      candidatos.push({ rutina, fecha, fechaISO: aFechaISO(fecha) });
    }
  }

  // Orden determinista. Importa: con el cupo justo, quien entra y quien queda
  // en conflicto no puede depender del orden en que la base devolvio las filas.
  candidatos.sort(
    (a, b) =>
      a.fechaISO.localeCompare(b.fechaISO) ||
      a.rutina.horaInicio.localeCompare(b.rutina.horaInicio) ||
      a.rutina.perfilId.localeCompare(b.rutina.perfilId),
  );

  for (const { rutina, fecha, fechaISO } of candidatos) {
    // 1. Ausencias de la sala o del salon entero.
    const ausencia = entrada.ausencias.find(
      (a) => (a.salaId === null || a.salaId === sala.id) && cubreFecha(fecha, a.desde, a.hasta),
    );
    if (ausencia) {
      exclusiones.push({
        tipo: 'AUSENCIA_SALA',
        perfilId: null,
        fecha: fechaISO,
        detalle:
          ausencia.salaId === null
            ? 'El salon esta cerrado ese dia'
            : `La sala ${sala.nombre} esta cerrada ese dia`,
      });
      continue;
    }

    // 2. Vacaciones del alumno. Excluyen SOLO a ese alumno: el turno sigue
    //    existiendo para los demas.
    const vacacion = entrada.vacaciones.find(
      (v) => v.perfilId === rutina.perfilId && cubreFecha(fecha, v.desde, v.hasta),
    );
    if (vacacion) {
      exclusiones.push({
        tipo: 'VACACION_ALUMNO',
        perfilId: rutina.perfilId,
        fecha: fechaISO,
        detalle: 'El alumno esta de vacaciones ese dia',
      });
      continue;
    }

    // 3. Resolver la franja: existente, ya planificada, o nueva.
    const llave = clave(fechaISO, rutina.horaInicio);
    let franja = franjas.get(llave);

    if (!franja) {
      if (sala.cupoBase === null) {
        // La sala no tiene de donde sacar el cupo. Se reporta una vez por franja
        // y no se inventa un valor por defecto.
        conflictos.push({
          tipo: 'SALA_SIN_CUPO_BASE',
          perfilId: null,
          fecha: fechaISO,
          detalle: `La sala ${sala.nombre} no tiene cupoBase, asi que no se puede crear el turno de las ${rutina.horaInicio}`,
        });
        franjas.set(llave, {
          cupo: null,
          ocupadas: 0,
          turnoExistenteId: null,
          perfilesConReserva: new Set(),
            });
        continue;
      }

      franja = {
        cupo: sala.cupoBase,
        ocupadas: 0,
        turnoExistenteId: null,
        perfilesConReserva: new Set(),
      };
      franjas.set(llave, franja);

      turnosACrear.push({
        salaId: sala.id,
        nombre: rutina.nombre,
        fecha: fechaISO,
        horaInicio: rutina.horaInicio,
        horaFin: rutina.horaFin,
        cupo: sala.cupoBase,
      });
    }

    // La franja quedo marcada como "sin cupo base" en una vuelta anterior.
    if (franja.cupo === null) continue;

    // 4. Idempotencia: si el alumno ya tiene reserva ahi, no hay nada que hacer
    //    ni nada que reportar.
    if (franja.perfilesConReserva.has(rutina.perfilId)) continue;

    // 5. Cupo. El PDF lo comprueba ANTES que el pack.
    if (franja.ocupadas >= franja.cupo) {
      conflictos.push({
        tipo: 'CUPO_LLENO',
        perfilId: rutina.perfilId,
        fecha: fechaISO,
        detalle: `El turno de las ${rutina.horaInicio} esta completo (${franja.ocupadas}/${franja.cupo})`,
      });
      continue;
    }

    // 6. Pack: vigencia y tope.
    const perfil = perfilesPorId.get(rutina.perfilId);
    const motivoPack = perfil ? motivoFueraDePack(perfil, fecha, planificadasPorPerfil) : 'Perfil desconocido';
    if (motivoPack) {
      conflictos.push({
        tipo: 'FUERA_DE_PACK',
        perfilId: rutina.perfilId,
        fecha: fechaISO,
        detalle: motivoPack,
      });
      continue;
    }

    // 7. Planificar.
    reservasACrear.push({
      perfilId: rutina.perfilId,
      salaId: sala.id,
      fecha: fechaISO,
      horaInicio: rutina.horaInicio,
    });
    franja.ocupadas += 1;
    franja.perfilesConReserva.add(rutina.perfilId);
    planificadasPorPerfil.set(
      rutina.perfilId,
      (planificadasPorPerfil.get(rutina.perfilId) ?? 0) + 1,
    );
  }

  return {
    turnosACrear,
    reservasACrear,
    conflictos,
    exclusiones,
    resumen: {
      turnos: turnosACrear.length,
      reservas: reservasACrear.length,
      conflictos: conflictos.length,
      exclusiones: exclusiones.length,
    },
  };
}

/** Devuelve el motivo por el que el perfil no puede reservar, o `null` si puede. */
function motivoFueraDePack(
  perfil: PerfilParaPlan,
  fecha: Date,
  planificadasPorPerfil: Map<string, number>,
): string | null {
  if (perfil.vigenciaHasta !== null && fecha.getTime() > perfil.vigenciaHasta.getTime()) {
    return `La vigencia del pack termino el ${aFechaISO(perfil.vigenciaHasta)}`;
  }

  const tope = topeDelPack(perfil.pack, {
    clasesExtra: perfil.clasesExtra,
    vigenciaDesde: null,
    vigenciaHasta: perfil.vigenciaHasta,
  });
  if (tope === null) return null;

  const consumidas = perfil.clasesConsumidas + (planificadasPorPerfil.get(perfil.id) ?? 0);
  if (consumidas >= tope) {
    return `El alumno ya tiene ${consumidas} de ${tope} clases de su pack en este periodo`;
  }

  return null;
}
```

- [ ] **Step 4: Verificar que pasan**

```bash
pnpm --filter @boxadmin/api test -- generacion-mes
```

Esperado: los ~30 tests en verde. Si falla el de determinismo, revisa el `sort` de candidatos; si
fallan los de bordes de calendario, el problema está en `fechasDelMesEnDiaSemana` (Task 3), no aquí.

- [ ] **Step 5: Suite completa**

```bash
pnpm --filter @boxadmin/api exec tsc --noEmit
pnpm --filter @boxadmin/api test
pnpm --filter @boxadmin/api exec prettier --check "src/jobs/generacion-mes/**/*.ts"
```

- [ ] **Step 6: Anotar mensaje de commit sugerido**

```
feat(generacion): el planificador de un mes, como funcion pura

planificarMes recibe los datos ya cargados y devuelve el plan: turnos y
reservas a crear, conflictos y exclusiones. No toca la base ni la cola, y por
eso los ocho casos del checklist del PDF son tests unitarios de verdad.

Sigue el orden del documento —vigencia, ausencias, vacaciones, turno, cupo,
pack— y su regla de que un conflicto individual nunca aborta el resto. Las
vacaciones y los cierres de sala son exclusiones, no conflictos: un mes con
tres alumnos de vacaciones no debe enterrar los dos casos que si hay que
resolver.

El resultado es determinista (ordenado por fecha, hora y perfil) porque con el
cupo justo, quien entra y quien queda fuera no puede depender del orden en que
la base devolvio las filas.

Archivos: apps/api/src/jobs/generacion-mes/generacion-mes.service.ts (+ spec)
```

---
### Task 7: Carga de datos y previsualización

El planificador de la T6 es puro. Esta tarea escribe lo que lo alimenta y lo expone por HTTP.

Puntos 2 y 3 del checklist: `previsualizar` devuelve la lista completa **sin escribir nada**.

**Files:**
- Create: `apps/api/src/calendario/calendario.datos.ts`
- Create: `apps/api/src/calendario/calendario.service.ts` + `calendario.service.spec.ts`
- Create: `apps/api/src/calendario/calendario.controller.ts`, `calendario.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: El cargador de datos**

Crear `apps/api/src/calendario/calendario.datos.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { primerDiaDelMesUtc, ultimoDiaDelMesUtc } from '@boxadmin/shared';
import { PrismaService, type ClientePrismaTx } from '../prisma/prisma.service';
import { topeDelPack, ventanaDeConteo } from '../reservas/ventana-pack';
import type {
  EntradaPlanificacion,
  PerfilParaPlan,
} from '../jobs/generacion-mes/generacion-mes.service';

/**
 * Traduce el estado de la base a la entrada del planificador.
 *
 * Vive aparte del planificador a proposito: alli no entra ni una query, y aqui
 * no entra ni una regla de negocio. Lo usan la previsualizacion (sincrona) y el
 * worker de publicacion, y tienen que ver exactamente los mismos datos o el plan
 * previsualizado no seria el que se aplica.
 */
@Injectable()
export class CalendarioDatos {
  constructor(private readonly prisma: PrismaService) {}

  async cargar(
    salaId: string,
    anio: number,
    mes: number,
    cliente: ClientePrismaTx = this.prisma.db,
  ): Promise<EntradaPlanificacion> {
    const inicio = primerDiaDelMesUtc(anio, mes);
    const fin = ultimoDiaDelMesUtc(anio, mes);

    const sala = await cliente.sala.findFirst({ where: { id: salaId } });
    if (!sala) throw new NotFoundException('Sala inexistente');

    // Rutinas activas de esta sala cuya vigencia toca el mes.
    const rutinas = await cliente.rutinaFija.findMany({
      where: {
        salaId,
        activa: true,
        desde: { lte: fin },
        OR: [{ hasta: null }, { hasta: { gte: inicio } }],
      },
    });

    const perfilIds = [...new Set(rutinas.map((rutina) => rutina.perfilId))];

    // Cierres de esta sala y del salon entero que tocan el mes.
    const ausencias = await cliente.ausencia.findMany({
      where: {
        OR: [{ salaId }, { salaId: null }],
        desde: { lte: fin },
        hasta: { gte: inicio },
      },
    });

    const vacaciones =
      perfilIds.length === 0
        ? []
        : await cliente.vacacionAlumno.findMany({
            where: { perfilId: { in: perfilIds }, desde: { lte: fin }, hasta: { gte: inicio } },
          });

    const turnos = await cliente.turno.findMany({
      where: { salaId, fecha: { gte: inicio, lte: fin } },
      include: { _count: { select: { reservas: { where: { canceladaEn: null } } } } },
    });

    const turnoIds = turnos.map((turno) => turno.id);
    const reservas =
      turnoIds.length === 0
        ? []
        : await cliente.reserva.findMany({
            where: { turnoId: { in: turnoIds }, canceladaEn: null },
            select: { turnoId: true, perfilId: true },
          });

    const perfiles = await this.cargarPerfiles(cliente, perfilIds, inicio);

    return {
      sala: { id: sala.id, nombre: sala.nombre, cupoBase: sala.cupoBase },
      anio,
      mes,
      rutinas: rutinas.map((rutina) => ({
        id: rutina.id,
        perfilId: rutina.perfilId,
        salaId: rutina.salaId,
        nombre: rutina.nombre,
        diaSemana: rutina.diaSemana,
        horaInicio: rutina.horaInicio,
        horaFin: rutina.horaFin,
        desde: rutina.desde,
        hasta: rutina.hasta,
      })),
      ausencias: ausencias.map((a) => ({ salaId: a.salaId, desde: a.desde, hasta: a.hasta })),
      vacaciones: vacaciones.map((v) => ({ perfilId: v.perfilId, desde: v.desde, hasta: v.hasta })),
      turnosExistentes: turnos.map((turno) => ({
        id: turno.id,
        fecha: turno.fecha,
        horaInicio: turno.horaInicio,
        cupo: turno.cupo,
        reservasActivas: (turno as unknown as { _count: { reservas: number } })._count.reservas,
      })),
      reservasActivas: reservas.map((r) => ({ turnoId: r.turnoId, perfilId: r.perfilId })),
      perfiles,
    };
  }

  /**
   * Carga los perfiles con su pack y, sobre todo, cuantas clases llevan
   * consumidas en la ventana del pack.
   *
   * Ese numero se deriva de las reservas (decision D2 de la Fase 1: no hay
   * contador almacenado), asi que hay que contarlo aqui y pasarselo hecho al
   * planificador, que no toca la base.
   */
  private async cargarPerfiles(
    cliente: ClientePrismaTx,
    perfilIds: string[],
    inicioDelMes: Date,
  ): Promise<PerfilParaPlan[]> {
    if (perfilIds.length === 0) return [];

    const filas = await cliente.perfil.findMany({
      where: { id: { in: perfilIds } },
      include: { pack: true },
    });

    return await Promise.all(
      filas.map(async (perfil) => {
        const pack = perfil.pack
          ? {
              tipo: perfil.pack.tipo,
              clasesPorMes: perfil.pack.clasesPorMes,
              clasesTotales: perfil.pack.clasesTotales,
            }
          : null;

        const tope = topeDelPack(pack, perfil);

        // Si no hay tope no hace falta contar nada: una query menos por alumno.
        const clasesConsumidas =
          tope === null
            ? 0
            : await cliente.reserva.count({
                where: {
                  perfilId: perfil.id,
                  OR: [{ canceladaEn: null }, { cancelacionTipo: 'DEFINITIVA' }],
                  turno: { fecha: ventanaDeConteo(pack, perfil, inicioDelMes) },
                },
              });

        return {
          id: perfil.id,
          vigenciaHasta: perfil.vigenciaHasta,
          clasesExtra: perfil.clasesExtra,
          pack,
          clasesConsumidas,
        };
      }),
    );
  }
}
```

- [ ] **Step 2: La definición de la cola**

Crear `apps/api/src/jobs/generacion-mes/cola.ts`:

```ts
export const GENERACION_MES_QUEUE = 'generacion-mes-queue';

/**
 * Lo que viaja en el job.
 *
 * `tenantId` es un DATO DE SEGURIDAD: el worker no tiene request ni JWT, asi que
 * es lo unico que le dice sobre que gimnasio puede operar. Lo pone el controller
 * a partir del token del actor, NUNCA del cuerpo de la peticion.
 */
export interface DatosGeneracionMes {
  tenantId: string;
  salaId: string;
  anio: number;
  mes: number;
  actorId: string;
}
```

- [ ] **Step 3: Test del service (falla)**

Crear `apps/api/src/calendario/calendario.service.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import type { JwtPayload, PlanDeMes } from '@boxadmin/shared';
import { CalendarioService } from './calendario.service';
import type { CalendarioDatos } from './calendario.datos';
import type { PrismaService } from '../prisma/prisma.service';
import type { Queue } from 'bullmq';

const ADMIN: JwtPayload = { sub: 'usr-1', tenantId: 'gym-1', rol: 'ADMIN_SALON' };

const ENTRADA = {
  sala: { id: 'sala-1', nombre: 'Sala A', cupoBase: 2 },
  anio: 2099,
  mes: 10,
  rutinas: [],
  ausencias: [],
  vacaciones: [],
  turnosExistentes: [],
  reservasActivas: [],
  perfiles: [],
};

function crearServicio() {
  const mesCalendario = {
    findFirst: jest.fn().mockResolvedValue(null),
    upsert: jest.fn(),
    create: jest.fn().mockResolvedValue({ id: 'mes-1' }),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const db = {
    mesCalendario,
    $transaction: jest.fn((fn: (tx: unknown) => unknown): unknown => fn(db)),
  };
  const prisma = { db } as unknown as PrismaService;

  const datos = { cargar: jest.fn().mockResolvedValue(ENTRADA) };
  const cola = {
    add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    getJob: jest.fn().mockResolvedValue(null),
  };

  return {
    servicio: new CalendarioService(
      prisma,
      datos as unknown as CalendarioDatos,
      cola as unknown as Queue,
    ),
    datos,
    cola,
    mesCalendario,
  };
}

describe('CalendarioService.previsualizar', () => {
  it('devuelve un plan y NO escribe nada en la base', async () => {
    const { servicio, mesCalendario } = crearServicio();

    const plan: PlanDeMes = await servicio.previsualizar(ADMIN, 'sala-1', 2099, 10);

    expect(plan.resumen).toEqual({ turnos: 0, reservas: 0, conflictos: 0, exclusiones: 0 });
    // Punto 2 del checklist, literal: previsualizar no toca la base.
    expect(mesCalendario.create).not.toHaveBeenCalled();
    expect(mesCalendario.updateMany).not.toHaveBeenCalled();
  });

  it('400 si el mes esta fuera de 1..12', async () => {
    const { servicio } = crearServicio();

    await expect(servicio.previsualizar(ADMIN, 'sala-1', 2099, 13)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('400 si el mes ya paso', async () => {
    const { servicio } = crearServicio();

    // Regenerar el pasado crearia reservas para clases que ya ocurrieron.
    await expect(servicio.previsualizar(ADMIN, 'sala-1', 2020, 1)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('CalendarioService.encolarPublicacion', () => {
  it('encola el job con el tenant del actor, nunca del cuerpo', async () => {
    const { servicio, cola } = crearServicio();

    const encolada = await servicio.encolarPublicacion(ADMIN, 'sala-1', 2099, 10);

    expect(cola.add).toHaveBeenCalledWith(
      'generar-mes',
      expect.objectContaining({
        tenantId: 'gym-1',
        salaId: 'sala-1',
        anio: 2099,
        mes: 10,
        actorId: 'usr-1',
      }),
      expect.anything(),
    );
    expect(encolada.jobId).toBe('job-1');
  });

  it('deja el mes en BORRADOR con el jobId antes de encolar', async () => {
    const { servicio, mesCalendario } = crearServicio();

    await servicio.encolarPublicacion(ADMIN, 'sala-1', 2099, 10);

    expect(mesCalendario.upsert).toHaveBeenCalled();
  });

  it('400 si el mes ya paso', async () => {
    const { servicio } = crearServicio();

    await expect(servicio.encolarPublicacion(ADMIN, 'sala-1', 2020, 1)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('CalendarioService.obtenerMes', () => {
  it('devuelve BORRADOR y sin publicacion si el mes no tiene fila', async () => {
    const { servicio } = crearServicio();

    const mes = await servicio.obtenerMes(ADMIN, 'sala-1', 2099, 10);

    expect(mes).toEqual(
      expect.objectContaining({ id: null, estado: 'BORRADOR', publicacion: null }),
    );
  });

  it('traduce el estado del job de BullMQ', async () => {
    const { servicio, mesCalendario, cola } = crearServicio();
    mesCalendario.findFirst.mockResolvedValue({
      id: 'mes-1',
      tenantId: 'gym-1',
      salaId: 'sala-1',
      anio: 2099,
      mes: 10,
      estado: 'HABILITADO',
      publicadoEn: new Date('2026-09-16T10:00:00.000Z'),
      publicadoPor: 'usr-1',
      ultimoJobId: 'job-1',
    });
    cola.getJob.mockResolvedValue({
      id: 'job-1',
      getState: jest.fn().mockResolvedValue('completed'),
      returnvalue: { turnos: 4, reservas: 4, conflictos: 0, exclusiones: 0 },
      failedReason: undefined,
    });

    const mes = await servicio.obtenerMes(ADMIN, 'sala-1', 2099, 10);

    expect(mes.estado).toBe('HABILITADO');
    expect(mes.publicacion).toEqual({
      jobId: 'job-1',
      estado: 'terminado',
      resumen: { turnos: 4, reservas: 4, conflictos: 0, exclusiones: 0 },
      error: null,
    });
  });

  it('un job fallido llega como fallido con su motivo', async () => {
    const { servicio, mesCalendario, cola } = crearServicio();
    mesCalendario.findFirst.mockResolvedValue({
      id: 'mes-1',
      tenantId: 'gym-1',
      salaId: 'sala-1',
      anio: 2099,
      mes: 10,
      estado: 'BORRADOR',
      publicadoEn: null,
      publicadoPor: null,
      ultimoJobId: 'job-1',
    });
    cola.getJob.mockResolvedValue({
      id: 'job-1',
      getState: jest.fn().mockResolvedValue('failed'),
      returnvalue: undefined,
      failedReason: 'Sala inexistente',
    });

    const mes = await servicio.obtenerMes(ADMIN, 'sala-1', 2099, 10);

    expect(mes.publicacion).toEqual(
      expect.objectContaining({ estado: 'fallido', error: 'Sala inexistente' }),
    );
  });
});
```

- [ ] **Step 4: Verificar que falla**

```bash
pnpm --filter @boxadmin/api test -- calendario
```

Esperado: FAIL — módulo inexistente.

- [ ] **Step 5: Implementar el service**

Crear `apps/api/src/calendario/calendario.service.ts`:

```ts
import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import type {
  EstadoJob,
  EstadoPublicacion,
  JwtPayload,
  MesCalendarioPublico,
  PlanDeMes,
  PublicacionEncolada,
  ResumenDelPlan,
} from '@boxadmin/shared';
import { PrismaService, type ClientePrismaTx } from '../prisma/prisma.service';
import { planificarMes } from '../jobs/generacion-mes/generacion-mes.service';
import { GENERACION_MES_QUEUE, type DatosGeneracionMes } from '../jobs/generacion-mes/cola';
import { CalendarioDatos } from './calendario.datos';

@Injectable()
export class CalendarioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly datos: CalendarioDatos,
    @InjectQueue(GENERACION_MES_QUEUE) private readonly cola: Queue,
  ) {}

  /**
   * Calcula el plan del mes sin escribir NADA.
   *
   * Es sincrono a proposito: no hay razon para mandar a una cola una operacion
   * de solo lectura que el admin esta esperando en pantalla. El job existe para
   * la publicacion, que si escribe y puede tardar.
   */
  async previsualizar(
    _actor: JwtPayload,
    salaId: string,
    anio: number,
    mes: number,
  ): Promise<PlanDeMes> {
    this.exigirMesGenerable(anio, mes);
    const entrada = await this.datos.cargar(salaId, anio, mes);
    return planificarMes(entrada);
  }

  async encolarPublicacion(
    actor: JwtPayload,
    salaId: string,
    anio: number,
    mes: number,
  ): Promise<PublicacionEncolada> {
    this.exigirMesGenerable(anio, mes);

    // Se comprueba que la sala existe ANTES de encolar: un 404 inmediato es
    // mucho mas util que un job que falla en segundo plano.
    await this.datos.cargar(salaId, anio, mes);

    const datosDelJob: DatosGeneracionMes = {
      tenantId: actor.tenantId,
      salaId,
      anio,
      mes,
      actorId: actor.sub,
    };

    const job = await this.cola.add('generar-mes', datosDelJob, {
      removeOnComplete: false,
      removeOnFail: false,
      attempts: 1,
    });

    const jobId = String(job.id);

    await this.prisma.db.mesCalendario.upsert({
      where: { tenantId_salaId_anio_mes: { tenantId: actor.tenantId, salaId, anio, mes } },
      create: { tenantId: actor.tenantId, salaId, anio, mes, ultimoJobId: jobId },
      update: { ultimoJobId: jobId },
    });

    return { jobId, salaId, anio, mes };
  }

  async obtenerMes(
    actor: JwtPayload,
    salaId: string,
    anio: number,
    mes: number,
  ): Promise<MesCalendarioPublico> {
    const fila = await this.prisma.db.mesCalendario.findFirst({
      where: { salaId, anio, mes },
    });

    if (!fila) {
      // Un mes que nunca se publico no tiene fila, y eso no es un error: es su
      // estado inicial.
      return {
        id: null,
        tenantId: actor.tenantId,
        salaId,
        anio,
        mes,
        estado: 'BORRADOR',
        publicadoEn: null,
        publicadoPor: null,
        publicacion: null,
      };
    }

    return {
      id: fila.id,
      tenantId: fila.tenantId,
      salaId: fila.salaId,
      anio: fila.anio,
      mes: fila.mes,
      estado: fila.estado,
      publicadoEn: fila.publicadoEn === null ? null : fila.publicadoEn.toISOString(),
      publicadoPor: fila.publicadoPor,
      publicacion: await this.estadoDePublicacion(fila.ultimoJobId),
    };
  }

  private async estadoDePublicacion(jobId: string | null): Promise<EstadoPublicacion | null> {
    if (!jobId) return null;

    const job = await this.cola.getJob(jobId);
    if (!job) return { jobId, estado: 'sin_job', resumen: null, error: null };

    const estado = traducirEstado(await job.getState());

    return {
      jobId,
      estado,
      resumen: estado === 'terminado' ? ((job.returnvalue ?? null) as ResumenDelPlan | null) : null,
      error: estado === 'fallido' ? (job.failedReason ?? 'Error desconocido') : null,
    };
  }

  /**
   * Regenerar un mes pasado crearia reservas para clases que ya ocurrieron, y
   * ninguna de las reglas del motor tiene sentido hacia atras.
   */
  private exigirMesGenerable(anio: number, mes: number): void {
    if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
      throw new BadRequestException('El mes debe estar entre 1 y 12');
    }

    const ahora = new Date();
    const actual = ahora.getUTCFullYear() * 12 + ahora.getUTCMonth();
    const pedido = anio * 12 + (mes - 1);

    if (pedido < actual) {
      throw new BadRequestException('No se puede generar un mes que ya paso');
    }
  }
}

function traducirEstado(estado: string): EstadoJob {
  switch (estado) {
    case 'completed':
      return 'terminado';
    case 'failed':
      return 'fallido';
    case 'active':
      return 'procesando';
    case 'waiting':
    case 'delayed':
    case 'prioritized':
      return 'en_cola';
    default:
      return 'sin_job';
  }
}
```

- [ ] **Step 6: Controller y módulo**

Crear `apps/api/src/calendario/calendario.controller.ts`:

```ts
import { Controller, Get, HttpCode, Param, ParseIntPipe, Post } from '@nestjs/common';
import type {
  Conflicto,
  JwtPayload,
  MesCalendarioPublico,
  PlanDeMes,
  PublicacionEncolada,
} from '@boxadmin/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CalendarioService } from './calendario.service';

@Controller('calendario/:salaId/:anio/:mes')
export class CalendarioController {
  constructor(private readonly calendario: CalendarioService) {}

  @Roles('ADMIN_OPERATIVO')
  @HttpCode(200)
  @Post('previsualizar')
  previsualizar(
    @CurrentUser() actor: JwtPayload,
    @Param('salaId') salaId: string,
    @Param('anio', ParseIntPipe) anio: number,
    @Param('mes', ParseIntPipe) mes: number,
  ): Promise<PlanDeMes> {
    return this.calendario.previsualizar(actor, salaId, anio, mes);
  }

  @Roles('ADMIN_OPERATIVO')
  @Get('conflictos')
  async conflictos(
    @CurrentUser() actor: JwtPayload,
    @Param('salaId') salaId: string,
    @Param('anio', ParseIntPipe) anio: number,
    @Param('mes', ParseIntPipe) mes: number,
  ): Promise<Conflicto[]> {
    const plan = await this.calendario.previsualizar(actor, salaId, anio, mes);
    return plan.conflictos;
  }

  // Publicar crea reservas para todo el salon de golpe: es gestion, no
  // operacion diaria.
  @Roles('ADMIN_SALON')
  @HttpCode(202)
  @Post('publicar')
  publicar(
    @CurrentUser() actor: JwtPayload,
    @Param('salaId') salaId: string,
    @Param('anio', ParseIntPipe) anio: number,
    @Param('mes', ParseIntPipe) mes: number,
  ): Promise<PublicacionEncolada> {
    return this.calendario.encolarPublicacion(actor, salaId, anio, mes);
  }

  @Roles('ADMIN_OPERATIVO')
  @Get()
  obtener(
    @CurrentUser() actor: JwtPayload,
    @Param('salaId') salaId: string,
    @Param('anio', ParseIntPipe) anio: number,
    @Param('mes', ParseIntPipe) mes: number,
  ): Promise<MesCalendarioPublico> {
    return this.calendario.obtenerMes(actor, salaId, anio, mes);
  }
}
```

Crear `apps/api/src/calendario/calendario.module.ts`:

```ts
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { GENERACION_MES_QUEUE } from '../jobs/generacion-mes/cola';
import { CalendarioController } from './calendario.controller';
import { CalendarioDatos } from './calendario.datos';
import { CalendarioService } from './calendario.service';

@Module({
  imports: [BullModule.registerQueue({ name: GENERACION_MES_QUEUE })],
  controllers: [CalendarioController],
  providers: [CalendarioDatos, CalendarioService],
  exports: [CalendarioDatos],
})
export class CalendarioModule {}
```

Registrar `CalendarioModule` en `apps/api/src/app.module.ts`.

- [ ] **Step 7: Verificar**

```bash
pnpm --filter @boxadmin/api exec tsc --noEmit
pnpm --filter @boxadmin/api test
pnpm --filter @boxadmin/api exec prettier --check "src/calendario/**/*.ts" "src/jobs/**/*.ts"
```

- [ ] **Step 8: Anotar mensaje de commit sugerido**

```
feat(calendario): carga de datos y previsualizacion sincrona

previsualizar calcula el plan del mes sin escribir nada y lo devuelve en el
acto: no hay razon para mandar a una cola una operacion de solo lectura que el
admin esta esperando en pantalla. El job queda para publicar.

El cargador vive aparte del planificador: alli no entra ni una query y aqui no
entra ni una regla de negocio. Lo comparten la previsualizacion y el worker, y
tienen que ver los mismos datos o el plan previsualizado no seria el que se
aplica.

Archivos: apps/api/src/calendario/ (module, controller, service + spec, datos)
          apps/api/src/jobs/generacion-mes/cola.ts
          apps/api/src/app.module.ts
```

---

> ⚠️ **ENMIENDA a la Task 7, aplicada durante la ejecucion.** El `mesCalendario.upsert` que
> dictaba el Step 5 **es imposible**: `upsert` esta en `OPERACIONES_UNICAS` de la extension de
> aislamiento, que lanza `UnsafeUniqueOperationError` siempre, tenga o no clave compuesta. Como el
> spec mockea Prisma entero, el test habria pasado en verde y el fallo habria aparecido en la primera
> publicacion real, con un 500.
>
> Sustituido por `findFirst` + `create`/`updateMany` dentro de un `$transaction`, que recupera la
> atomicidad. Y el test `expect(mesCalendario.upsert).toHaveBeenCalled()` se reemplazo por dos mas
> estrictos: que `create` reciba los campos correctos y que `upsert` NO se llame, y que una fila ya
> existente se reutilice via `updateMany` en vez de duplicarse.

### Task 8: Publicación — worker de BullMQ y escritura

Puntos 4 y 7 del checklist. Aquí se junta todo: el worker abre el contexto de tenant que confirmó la
T0, recarga los datos, replanifica y escribe.

**Files:**
- Create: `apps/api/src/jobs/generacion-mes/publicacion.service.ts` + `publicacion.service.spec.ts`
- Create: `apps/api/src/jobs/generacion-mes/generacion-mes.processor.ts`
- Modify: `apps/api/src/jobs/jobs.module.ts`

- [ ] **Step 1: Test de la escritura (falla)**

Crear `apps/api/src/jobs/generacion-mes/publicacion.service.spec.ts`. Doble de Prisma con
`turno.findFirst`, `turno.create`, `reserva.create`, `mesCalendario.updateMany`,
`mesCalendario.findFirst` y `$transaction` (con la anotación `: unknown` del retorno). Casos:

```ts
  it('crea los turnos del plan y despues sus reservas');
  it('resuelve el turnoId de cada reserva por sala+fecha+hora, no por indice');
  it('no crea nada si el plan viene vacio');
  it('marca el mes como HABILITADO con publicadoEn y publicadoPor');
  it('toma el cerrojo con updateMany antes de escribir');
  it('si el cerrojo devuelve count 0, otro job esta publicando y aborta sin escribir');
  it('un P2002 al crear una reserva no aborta el resto: la reserva ya existia');
  it('devuelve el resumen del plan aplicado');
  it('audita la publicacion con el resumen en el detalle');
```

El penúltimo es el importante: el índice único parcial de la T1 puede disparar si dos publicaciones
compiten, y eso significa "ya estaba", no "error". Se ignora y se sigue.

- [ ] **Step 2: Implementar la escritura**

Crear `apps/api/src/jobs/generacion-mes/publicacion.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import type { JwtPayload, PlanDeMes, ResumenDelPlan } from '@boxadmin/shared';
import { desdeFechaISO } from '@boxadmin/shared';
import { HistorialService } from '../../common/historial/historial.service';
import { PrismaService, type ClientePrismaTx } from '../../prisma/prisma.service';

/** Un P2002 al insertar significa "ya existia", no "fallo". */
function esDuplicado(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, name, cause } = error as { code?: unknown; name?: unknown; cause?: unknown };
  if (code === 'P2002') return true;
  if (name !== 'DriverAdapterError' || typeof cause !== 'object' || cause === null) return false;
  return (cause as { kind?: unknown }).kind === 'UniqueConstraintViolation';
}

@Injectable()
export class PublicacionService {
  private readonly logger = new Logger(PublicacionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly historial: HistorialService,
  ) {}

  /**
   * Aplica un plan ya calculado y deja el mes HABILITADO.
   *
   * Todo va en una transaccion. El cerrojo es la propia fila de MesCalendario:
   * se toma con un updateMany condicional, asi dos publicaciones simultaneas del
   * mismo mes no se pisan. La segunda encuentra count 0 y aborta sin escribir.
   */
  async aplicar(
    actor: JwtPayload,
    salaId: string,
    anio: number,
    mes: number,
    plan: PlanDeMes,
  ): Promise<ResumenDelPlan> {
    return await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      const tomado = await cliente.mesCalendario.updateMany({
        where: { salaId, anio, mes },
        data: { estado: 'HABILITADO', publicadoEn: new Date(), publicadoPor: actor.sub },
      });

      if (tomado.count === 0) {
        // La fila la crea `encolarPublicacion` antes de meter el job en la cola,
        // asi que llegar aqui sin fila significa que algo la borro por debajo.
        this.logger.warn(
          `No se pudo tomar el mes ${anio}-${mes} de la sala ${salaId}: no hay fila de MesCalendario`,
        );
        return { turnos: 0, reservas: 0, conflictos: 0, exclusiones: 0 };
      }

      // 1. Los turnos primero: las reservas cuelgan de ellos.
      const idPorFranja = new Map<string, string>();

      for (const turno of plan.turnosACrear) {
        const fecha = desdeFechaISO(turno.fecha);

        const creado = await cliente.turno.create({
          data: {
            tenantId: actor.tenantId,
            salaId: turno.salaId,
            nombre: turno.nombre,
            fecha,
            horaInicio: turno.horaInicio,
            horaFin: turno.horaFin,
            cupo: turno.cupo,
          },
        });

        idPorFranja.set(`${turno.fecha}|${turno.horaInicio}`, creado.id);
      }

      // 2. Las reservas. El turnoId se resuelve por sala+fecha+hora, no por
      //    indice: el plan puede referirse a turnos que ya existian.
      let reservasCreadas = 0;

      for (const reserva of plan.reservasACrear) {
        const franja = `${reserva.fecha}|${reserva.horaInicio}`;
        let turnoId = idPorFranja.get(franja);

        if (!turnoId) {
          const existente = await cliente.turno.findFirst({
            where: {
              salaId: reserva.salaId,
              fecha: desdeFechaISO(reserva.fecha),
              horaInicio: reserva.horaInicio,
            },
          });
          if (!existente) {
            this.logger.warn(`Sin turno para ${franja}; se omite la reserva`);
            continue;
          }
          turnoId = existente.id;
          idPorFranja.set(franja, turnoId);
        }

        try {
          await cliente.reserva.create({
            data: {
              tenantId: actor.tenantId,
              turnoId,
              perfilId: reserva.perfilId,
              origen: 'RUTINA',
            },
          });
          reservasCreadas += 1;
        } catch (error) {
          // El indice unico parcial sobre reservas activas es la red de debajo
          // de la idempotencia. Que dispare significa que la reserva ya estaba,
          // no que algo fallara: se sigue con el resto del mes.
          if (!esDuplicado(error)) throw error;
          this.logger.log(`Reserva ya existente en ${franja} para ${reserva.perfilId}`);
        }
      }

      const resumen: ResumenDelPlan = {
        turnos: plan.turnosACrear.length,
        reservas: reservasCreadas,
        conflictos: plan.conflictos.length,
        exclusiones: plan.exclusiones.length,
      };

      const fila = await cliente.mesCalendario.findFirst({ where: { salaId, anio, mes } });

      await this.historial.registrar(
        {
          actor,
          entidad: 'MesCalendario',
          entidadId: fila?.id ?? `${salaId}-${anio}-${mes}`,
          accion: 'PUBLICADA',
          detalle: { salaId, anio, mes, ...resumen },
        },
        cliente,
      );

      return resumen;
    });
  }
}
```

⚠️ `'MesCalendario'` debe estar en `EntidadAuditable` y `'PUBLICADA'` en `AccionAuditable`, ambos en
`apps/api/src/common/historial/historial.service.ts`.

- [ ] **Step 3: El worker**

Crear `apps/api/src/jobs/generacion-mes/generacion-mes.processor.ts`:

```ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { JwtPayload, ResumenDelPlan } from '@boxadmin/shared';
import { runWithTenant } from '../../common/tenant/tenant-context';
import { CalendarioDatos } from '../../calendario/calendario.datos';
import { GENERACION_MES_QUEUE, type DatosGeneracionMes } from './cola';
import { planificarMes } from './generacion-mes.service';
import { PublicacionService } from './publicacion.service';

@Processor(GENERACION_MES_QUEUE)
export class GeneracionMesProcessor extends WorkerHost {
  private readonly logger = new Logger(GeneracionMesProcessor.name);

  constructor(
    private readonly datos: CalendarioDatos,
    private readonly publicacion: PublicacionService,
  ) {
    super();
  }

  /**
   * Un job NO tiene request, asi que no hay middleware que abra el contexto de
   * tenant y `getTenantContext()` devolveria undefined. La extension de Prisma
   * lanzaria MissingTenantContextError en la primera query — que es el diseno
   * fail-closed funcionando, no un fallo.
   *
   * Por eso todo el trabajo va envuelto en `runWithTenant` con el tenantId del
   * payload. Ese tenantId es un DATO DE SEGURIDAD: lo pone el controller desde
   * el JWT del actor, nunca el cuerpo de la peticion.
   */
  async process(job: Job<DatosGeneracionMes>): Promise<ResumenDelPlan> {
    const { tenantId, salaId, anio, mes, actorId } = job.data;

    this.logger.log(`Generando ${anio}-${mes} de la sala ${salaId} (job ${job.id})`);

    return await runWithTenant(tenantId, async () => {
      // El actor se reconstruye a mano: aqui no hay JWT. El rol es el que
      // exigio el endpoint para poder encolar.
      const actor: JwtPayload = { sub: actorId, tenantId, rol: 'ADMIN_SALON' };

      // Se recargan los datos y se replanifica en vez de confiar en el plan que
      // vio el admin: entre la previsualizacion y la publicacion pueden haber
      // cambiado rutinas, cupos o vacaciones.
      const entrada = await this.datos.cargar(salaId, anio, mes);
      const plan = planificarMes(entrada);

      const resumen = await this.publicacion.aplicar(actor, salaId, anio, mes, plan);

      this.logger.log(
        `Mes ${anio}-${mes} publicado: ${resumen.turnos} turnos, ${resumen.reservas} reservas, ` +
          `${resumen.conflictos} conflictos`,
      );

      return resumen;
    });
  }
}
```

- [ ] **Step 4: Registrar el worker**

En `apps/api/src/jobs/jobs.module.ts`:

```ts
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CalendarioModule } from '../calendario/calendario.module';
import { GENERACION_MES_QUEUE } from './generacion-mes/cola';
import { GeneracionMesProcessor } from './generacion-mes/generacion-mes.processor';
import { PublicacionService } from './generacion-mes/publicacion.service';
import { HEALTH_CHECK_QUEUE, HealthCheckProcessor } from './health-check.processor';
import { JobsController } from './jobs.controller';

@Module({
  imports: [
    BullModule.registerQueue({ name: HEALTH_CHECK_QUEUE }),
    BullModule.registerQueue({ name: GENERACION_MES_QUEUE }),
    // CalendarioModule exporta CalendarioDatos, que el worker necesita para
    // recargar los datos antes de replanificar.
    CalendarioModule,
  ],
  controllers: [JobsController],
  providers: [HealthCheckProcessor, GeneracionMesProcessor, PublicacionService],
})
export class JobsModule {}
```

⚠️ `CalendarioModule` importa la cola de generación y `JobsModule` importa `CalendarioModule`. Eso **no
es un ciclo** (calendario no importa jobs), pero si Nest se queja de dependencia circular, la salida es
mover `CalendarioDatos` a su propio módulo `@Global()`, no usar `forwardRef`.

- [ ] **Step 5: Verificar**

```bash
pnpm --filter @boxadmin/api exec tsc --noEmit
pnpm --filter @boxadmin/api test
pnpm --filter @boxadmin/api exec prettier --check "src/jobs/**/*.ts"
```

Arrancar la API y comprobar que el worker se registra sin errores:

```bash
pnpm --filter @boxadmin/api start:dev
```

Esperado: en el log, el módulo `JobsModule` inicializado y ningún error de inyección de dependencias.
**Para el proceso por PID**, nunca por nombre.

- [ ] **Step 6: Anotar mensaje de commit sugerido**

```
feat(generacion): publicacion del mes en un worker de BullMQ

El endpoint responde 202 con el jobId y el worker hace el trabajo. Como un job
no tiene request, no hay middleware que abra el contexto de tenant: el worker
lo abre el mismo con runWithTenant a partir del tenantId del payload, que pone
el controller desde el JWT del actor y nunca el cuerpo de la peticion.

El worker recarga los datos y replanifica en vez de confiar en el plan que vio
el admin: entre previsualizar y publicar pueden haber cambiado rutinas, cupos
o vacaciones.

La escritura toma la fila de MesCalendario como cerrojo con un updateMany
condicional, y un P2002 del indice unico parcial de reservas se trata como "ya
estaba" y no interrumpe el resto del mes.

Archivos: apps/api/src/jobs/generacion-mes/publicacion.service.ts (+ spec)
          apps/api/src/jobs/generacion-mes/generacion-mes.processor.ts
          apps/api/src/jobs/jobs.module.ts
          apps/api/src/common/historial/historial.service.ts
```

---
### Task 9: e2e del checklist

Hasta aquí todo se ha probado con dobles de Jest: **ninguna regla ha tocado una base real, ni Redis, ni
el router de Nest**. Esta tarea es la que dice si la fase funciona.

**Files:**
- Modify: `apps/api/test/helpers.ts`
- Create: `apps/api/test/recurrencia.e2e-spec.ts`

- [ ] **Step 1: Helper de espera**

Añadir a `apps/api/test/helpers.ts`:

```ts
/**
 * Espera a que la publicacion de un mes termine, sondeando el endpoint de
 * estado.
 *
 * Los e2e de la fase no pueden hacer `await` sobre el job: el endpoint responde
 * 202 y el trabajo ocurre en el worker. Sondear el mismo endpoint que usaria un
 * cliente real es ademas la forma honesta de probarlo.
 */
export async function esperarPublicacion(
  servidor: Parameters<typeof request>[0],
  token: string,
  salaId: string,
  anio: number,
  mes: number,
  intentos = 60,
): Promise<Record<string, any>> {
  for (let i = 0; i < intentos; i++) {
    const { body } = await request(servidor)
      .get(`/calendario/${salaId}/${anio}/${mes}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const estado = body.publicacion?.estado;
    if (estado === 'terminado' || estado === 'fallido') return body;

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(
    `La publicacion de ${anio}-${mes} no termino tras ${intentos} intentos. ` +
      'Si el estado se quedo en "en_cola", lo mas probable es que el worker no este ' +
      'registrado o que Redis no responda.',
  );
}
```

- [ ] **Step 2: Escribir el e2e**

Crear `apps/api/test/recurrencia.e2e-spec.ts`. Estructura y casos:

```ts
import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplication } from '@nestjs/common';
import type { Queue } from 'bullmq';
import * as request from 'supertest';
import {
  crearAppDeTest,
  crearGimnasio,
  esperarPublicacion,
  limpiarBaseDeDatos,
  type GimnasioDeTest,
} from './helpers';
import { GENERACION_MES_QUEUE } from '../src/jobs/generacion-mes/cola';
import type { PrismaService } from '../src/prisma/prisma.service';

describe('Fase 2 — motor de recurrencia (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cola: Queue;
  let servidor: ReturnType<INestApplication['getHttpServer']>;
  let gym: GimnasioDeTest;

  // Un mes futuro fijo, para que los tests no caduquen. 2099-10 tiene cuatro
  // martes: 6, 13, 20 y 27.
  const ANIO = 2099;
  const MES = 10;
  const MARTES = ['2099-10-06', '2099-10-13', '2099-10-20', '2099-10-27'];

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const entorno = await crearAppDeTest();
    app = entorno.app;
    prisma = entorno.prisma;
    servidor = app.getHttpServer();
    cola = app.get<Queue>(getQueueToken(GENERACION_MES_QUEUE));
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await limpiarBaseDeDatos(prisma);
    // Los jobs viven en Redis, no en Postgres: truncar tablas no los borra, y
    // uno rezagado de otra corrida enturbiaria el sondeo de estado.
    await cola.obliterate({ force: true });
    gym = await crearGimnasio(app, 'boxrec');
  });

  // ... helpers locales: crearSala, crearAlumno, crearRutina, crearAusencia,
  //     crearVacacion, previsualizar, publicar
});
```

Escribe los helpers locales siguiendo el patrón de `apps/api/test/nucleo.e2e-spec.ts` (que ya existe y
hace exactamente esto para la Fase 1), y **verifica que la sala se crea con `cupoBase`**: sin él, todo
el motor devuelve `SALA_SIN_CUPO_BASE` y los tests fallarían por una razón que no es la que se está
probando.

Los casos, uno por punto del checklist:

```ts
  describe('checklist 1: cargar una rutina fija', () => {
    it('crea la rutina y la devuelve al listar');
    it('403 si el alumno no tiene acceso a la sala');
  });

  describe('checklist 2: previsualizar no escribe nada', () => {
    it('devuelve los cuatro turnos y las cuatro reservas del mes');
    it('la base sigue vacia de turnos y reservas despues de previsualizar');
    it('previsualizar dos veces devuelve exactamente lo mismo');
  });

  describe('checklist 3: los conflictos no interrumpen el proceso', () => {
    it('con cupo 1 y dos alumnos, planifica uno y reporta el otro en cada fecha');
    it('un pack vencido a mitad de mes deja las primeras fechas y reporta las ultimas');
    it('GET /conflictos devuelve solo los conflictos, sin las exclusiones');
  });

  describe('checklist 4: publicar es real e idempotente', () => {
    it('responde 202 con el jobId');
    it('crea los turnos y las reservas, y deja el mes HABILITADO');
    it('PUBLICAR DOS VECES no cambia el numero de reservas');
    it('publicar despues de anadir una rutina crea solo lo que falta');
    it('400 al publicar un mes que ya paso');
  });

  describe('checklist 5: una ausencia excluye la fecha para todos', () => {
    it('un cierre de todo el salon quita esa fecha del plan');
    it('un cierre no crea el turno: si nadie puede venir, no hay clase');
    it('tras publicar, esa fecha no tiene turno en la base');
  });

  describe('checklist 6: una vacacion excluye solo a su alumno', () => {
    it('el turno se crea igual y el otro alumno conserva su reserva');
    it('la vacacion aparece como exclusion, nunca como conflicto');
  });

  describe('checklist 7: el job corre en background', () => {
    it('POST /publicar responde en menos de un segundo aunque haya 10 rutinas');
  });

  describe('aislamiento entre gimnasios', () => {
    it('un job encolado para un gimnasio no crea nada en el otro');
    it('404 al previsualizar una sala de otro gimnasio');
  });

  describe('regresiones de la fase', () => {
    it('crear dos turnos en la misma sala, fecha y hora es 409, no 500');
    it('un alumno no puede tener dos reservas activas en el mismo turno');
  });
```

Cuatro de esos merecen que escribas el cuerpo con cuidado, porque son los que de verdad pueden fallar:

**«PUBLICAR DOS VECES no cambia el numero de reservas»** (punto 4 del checklist):

```ts
    it('PUBLICAR DOS VECES no cambia el numero de reservas', async () => {
      const salaId = await crearSala({ cupoBase: 5 });
      const alumno = await crearAlumno([salaId]);
      await crearRutina(alumno.perfilId, salaId, 2, '18:00');

      await publicar(salaId);
      await esperarPublicacion(servidor, gym.adminToken, salaId, ANIO, MES);

      const primeras = await prisma.base.reserva.count({ where: { tenantId: gym.tenantId } });
      const turnosPrimera = await prisma.base.turno.count({ where: { tenantId: gym.tenantId } });

      await publicar(salaId);
      await esperarPublicacion(servidor, gym.adminToken, salaId, ANIO, MES);

      expect(await prisma.base.reserva.count({ where: { tenantId: gym.tenantId } })).toBe(primeras);
      expect(await prisma.base.turno.count({ where: { tenantId: gym.tenantId } })).toBe(
        turnosPrimera,
      );
      expect(primeras).toBe(4);
    });
```

**«un job encolado para un gimnasio no crea nada en el otro»** — es el que verifica que el worker
respeta el aislamiento, que fue el riesgo que despejó la T0:

```ts
    it('un job encolado para un gimnasio no crea nada en el otro', async () => {
      const otro = await crearGimnasio(app, 'boxrec2');

      const salaId = await crearSala({ cupoBase: 5 });
      const alumno = await crearAlumno([salaId]);
      await crearRutina(alumno.perfilId, salaId, 2, '18:00');

      await publicar(salaId);
      await esperarPublicacion(servidor, gym.adminToken, salaId, ANIO, MES);

      expect(await prisma.base.turno.count({ where: { tenantId: otro.tenantId } })).toBe(0);
      expect(await prisma.base.reserva.count({ where: { tenantId: otro.tenantId } })).toBe(0);
      expect(await prisma.base.turno.count({ where: { tenantId: gym.tenantId } })).toBe(4);
    });
```

**«POST /publicar responde en menos de un segundo aunque haya 10 rutinas»** (punto 7):

```ts
    it('POST /publicar responde en menos de un segundo aunque haya 10 rutinas', async () => {
      const salaId = await crearSala({ cupoBase: 20 });
      for (let i = 0; i < 10; i++) {
        const alumno = await crearAlumno([salaId]);
        await crearRutina(alumno.perfilId, salaId, 2, '18:00');
      }

      const inicio = Date.now();
      const { body } = await publicar(salaId);
      const tardo = Date.now() - inicio;

      expect(body.jobId).toBeDefined();
      // El request encola y vuelve; la generacion ocurre en el worker.
      expect(tardo).toBeLessThan(1000);

      await esperarPublicacion(servidor, gym.adminToken, salaId, ANIO, MES);
      expect(await prisma.base.reserva.count({ where: { tenantId: gym.tenantId } })).toBe(40);
    });
```

**«crear dos turnos en la misma sala, fecha y hora es 409, no 500»** — verifica a la vez el índice
único de la T1 y la traducción de errores de la T2:

```ts
    it('crear dos turnos en la misma sala, fecha y hora es 409, no 500', async () => {
      const salaId = await crearSala({ cupoBase: 5 });
      const cuerpo = {
        salaId,
        nombre: 'Pilates',
        fecha: MARTES[0],
        horaInicio: '18:00',
        horaFin: '19:00',
        cupo: 5,
      };

      await request(servidor)
        .post('/turnos')
        .set(auth(gym.adminToken))
        .send(cuerpo)
        .expect(201);

      await request(servidor)
        .post('/turnos')
        .set(auth(gym.adminToken))
        .send(cuerpo)
        .expect(409);
    });
```

- [ ] **Step 3: Ejecutar**

```bash
docker compose up -d postgres postgres-test redis
pnpm --filter @boxadmin/api test:e2e
```

Esperado: los 56 e2e anteriores **y** los nuevos en verde, y Jest saliendo con código 0 **sin
`--forceExit`**.

Guía de diagnóstico, por orden de probabilidad:

- **La publicación se queda en `en_cola` para siempre** → el worker no está registrado o Redis no
  responde. Comprueba que `GeneracionMesProcessor` está en los `providers` de `JobsModule` y que
  `docker compose ps` muestra Redis sano. **No subas el número de intentos del sondeo para taparlo.**
- **La publicación sale `fallido`** → mira el `error` que devuelve el endpoint de estado y el log de
  la app. Si dice algo de contexto de tenant, el worker no está envolviendo el trabajo en
  `runWithTenant`.
- **Jest se queda colgado al terminar** → hay una conexión viva que sobrevive a `app.close()`. En la
  Fase 0 fue una instancia de Redis construida a mano. **No añadas `--forceExit` ni toques
  `jest-e2e.json`**: busca qué abre conexiones y repórtalo.
- **Fallan los tests de aislamiento** → es lo más grave que puede pasar en este proyecto. Para,
  repórtalo y no sigas.

Si un test falla porque **el test está mal escrito**, arréglalo. Si falla porque **el código de
producción está mal**, NO toques el test para ponerlo en verde: arregla el código si el arreglo es
evidente y acotado, o repórtalo si no lo es.

- [ ] **Step 4: Comprobar que los unitarios siguen en verde**

```bash
pnpm --filter @boxadmin/api test
```

- [ ] **Step 5: Anotar mensaje de commit sugerido**

```
test(e2e): checklist de la Fase 2, idempotencia y aislamiento del worker

Cubre los ocho puntos del checklist del documento. Los que de verdad importan:
publicar dos veces no cambia el numero de reservas, un job encolado para un
gimnasio no crea nada en el otro, y POST /publicar responde en menos de un
segundo con diez rutinas cargadas.

Archivos: apps/api/test/recurrencia.e2e-spec.ts
          apps/api/test/helpers.ts
```

---

### Task 10: Verificación final, README y cierre

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/PROGRESO.md`

- [ ] **Step 1: Verificación completa**

```bash
cd D:/Dev/box-admin
pnpm --filter @boxadmin/shared build
pnpm --filter @boxadmin/shared test
cd apps/api && pnpm exec dotenv -e ../../.env -- prisma migrate status && cd ../..
pnpm --filter @boxadmin/api exec tsc --noEmit
pnpm --filter @boxadmin/api test
pnpm --filter @boxadmin/api test:e2e
pnpm --filter @boxadmin/api exec prettier --check "src/{rutinas,vacaciones,ausencias,calendario}/**/*.ts" "src/jobs/**/*.ts"
```

⚠️ **No ejecutes `docker compose down -v` ni `prisma migrate reset`**: borran las bases. Si
`migrate status` reporta deriva, repórtalo en vez de resolverlo por tu cuenta.

- [ ] **Step 2: Recorrer el checklist a mano contra la API corriendo**

Levanta la API (`pnpm --filter @boxadmin/api start:dev`, en segundo plano; **párala por PID**, nunca
por nombre) y recorre el flujo entero con `curl`: crear tenant → admin → login → sala con `cupoBase` →
alumno → rutina → previsualizar → publicar → sondear el estado → comprobar turnos y reservas en la
base → publicar otra vez y comprobar que no cambia nada.

Esto no es redundante con los e2e: aquí se comprueba que el proceso arranca de verdad, que el worker
se registra en un proceso real y que las respuestas HTTP son las que vería un cliente.

Anota cada uno de los ocho puntos con ✅ o ❌. **Si alguno falla, arréglalo antes de cerrar.**

- [ ] **Step 3: README**

Añadir al `README.md` una sección "Fase 2 — motor de recurrencia" con las tres tablas de endpoints del
§7 del spec, una explicación corta de la diferencia entre **conflicto** y **exclusión**, la nota de que
`HABILITADO` todavía no habilita nada funcionalmente, y un ejemplo de flujo con `curl` incluyendo el
sondeo del estado del job. Lee la sección de la Fase 1 antes de escribir y respeta su tono.

- [ ] **Step 4: Cerrar `PROGRESO.md`**

Marcar las tareas, poner el recuento final de tests **medido por ti** y sustituir "Siguiente paso" por
un cierre de fase con la lista de mensajes de commit sugeridos.

- [ ] **Step 5: Comprobar que no se commiteó nada**

```bash
git status --short
git diff --cached --name-only
git check-ignore -v .env
git check-ignore -v .env.test
```

El índice debe estar vacío y los dos `.env` ignorados.

- [ ] **Step 6: Anotar mensaje de commit sugerido**

```
docs: endpoints y flujo de la Fase 2 en el README

Archivos: README.md
          docs/superpowers/plans/PROGRESO.md
```

---

> ⚠️ **TRAMPA DE ENTORNO descubierta al cerrar la fase.** Desarrollo y test **comparten Redis**
> (ambos `REDIS_URL=redis://localhost:6379`), asi que si la API de desarrollo (`start:dev`) esta
> levantada mientras corren los e2e, **su worker compite por los jobs de la cola** y los resuelve
> contra la base de desarrollo (5434) en vez de la de test (5433).
>
> El sintoma no apunta a la causa: un job recien encolado falla con `"Sala inexistente"` aunque la
> sala exista, de forma intermitente segun quien gane la carrera. Costo un buen rato diagnosticarlo,
> y llego a parecer un bug de produccion. **Para la API antes de `test:e2e`.**
>
> La solucion de fondo seria dar a los e2e un prefijo de cola o una base de Redis propia; queda
> anotado como deuda.

## Desviaciones respecto al PDF de la Fase 2

| # | Documento | Implementación | Motivo |
|---|---|---|---|
| D1 | Relaciones de `RutinaFija` corruptas (`tenantId String @relation(...)`) | Reescritas, con claves foráneas compuestas por tenant | El schema no valida, y todo el modelo usa FK compuestas desde la Fase 1 |
| D2 | `VacacionAlumno` y `Ausencia` sin relaciones | Añadidas, más las back-relations | Ídem |
| D3 | `Ausencia.desde/hasta` como `DateTime` + `todoElDia` | `@db.Date` + `horaInicio`/`horaFin` opcionales en `"HH:MM"` | Misma convención que `Turno`; cubre cierres parciales sin arrastrar husos |
| D4 | `RutinaFija` sin `nombre` | Añadido | `Turno.nombre` es obligatorio y tiene que salir de algún sitio |
| D5 | Nada sobre el cupo del turno generado | Sale de `Sala.cupoBase`; si es null, conflicto `SALA_SIN_CUPO_BASE` | Paga la deuda de la Fase 1 y evita inventar un cupo por defecto |
| D6 | Nada que garantice la idempotencia | `@@unique([tenantId, salaId, fecha, horaInicio])` en `Turno` y un índice único **parcial** en reservas activas | El checklist la exige; sin restricciones en la base depende de que ningún service se equivoque |
| D7 | `ResultadoGeneracionMes` con `turnosACrear: number` | Listas completas, y el recuento aparte en `resumen` | `previsualizar` tiene que enseñarle al admin **qué** se va a crear, no cuántos |
| D8 | Conflicto `AUSENCIA_ALUMNO` junto a los demás | Vacaciones y cierres son **exclusiones**, en una lista aparte | Un mes con tres alumnos de vacaciones enterraría los dos casos que sí hay que resolver |
| D9 | "correr la generación como job en background" | `previsualizar` síncrono, `publicar` en job | La previsualización no escribe y es interactiva; mandarla a una cola obliga a sondear para nada |
| D10 | `VacacionAlumno.devuelveClase` sin explicar | Se almacena y no se aplica | Con el conteo derivado de la Fase 1, no generar la reserva ya equivale a no gastarla |
| D11 | No define permisos | Configurar → ADMIN_SALON; operar → ADMIN_OPERATIVO. **Publicar y cerrar el salón son ADMIN_SALON** | Publicar crea reservas para todo el salón de golpe |
| D12 | Nada sobre meses pasados | `previsualizar` y `publicar` sobre un mes ya terminado devuelven 400 | Regenerar el pasado crearía reservas para clases que ya ocurrieron |
| D13 | Nada al respecto | Los errores de Prisma se traducen a HTTP (`P2002`→409, `P2003`→400, `P2025`→404) | Deuda de la Fase 1 que los índices nuevos vuelven urgente |
| D14 | Nada al respecto | El `jobId` lo genera el service antes de encolar, no BullMQ | La fila de `MesCalendario` es el cerrojo del worker y tiene que existir ANTES que el job. Encolando primero se perdia la primera publicacion en silencio |

## Deuda declarada para la Fase 3 y siguientes

- **Los e2e y la API de desarrollo comparten la cola de Redis.** Correrlos a la vez hace que el worker
  del `start:dev` robe jobs a los tests. Daria un prefijo de cola propio a los e2e, o una base de
  Redis distinta.
- **`MesCalendario.HABILITADO` no habilita nada funcionalmente.** No hay self-service todavía, así que
  ningún alumno ve ni reserva nada. Registra que el mes se publicó; es el enganche de la Fase 3.
- **No hay lista de espera** cuando el cupo está lleno: se registra el conflicto y nada más.
- **El motor solo crea.** No reasigna ni cancela nada que ya exista, así que borrar una rutina no
  retira las reservas ya generadas: eso lo decide el admin a mano.
- **`VacacionAlumno.devuelveClase` está inerte** hasta que exista facturación o créditos.
- **`Ausencia.recuperable` se almacena y no se aplica**, por lo mismo.
- **El tramo horario de una `Ausencia` parcial se almacena pero el motor lo ignora**: hoy una ausencia
  excluye el día entero. Afinarlo exige comparar franjas horarias y no lo pide el checklist.
- **No hay reintento del job.** Se encola con `attempts: 1` a propósito: reintentar una generación a
  medias sin saber qué escribió es peor que fallar y que el admin vuelva a publicar, que es idempotente.
- **El sondeo del estado depende de que el job siga en Redis.** Se encola con `removeOnComplete: false`
  para que el resumen siga disponible; si Redis se limpia, `GET` devuelve `sin_job` y el estado real
  del mes sigue siendo el de `MesCalendario`.
- Sigue pendiente de la Fase 1: los campos heredables de `Sala` (`minMinutosCancelar`,
  `minMinutosAnotarse`, `listaEsperaHabilitada`) se almacenan y no se consumen; no hay paginación en
  ningún listado; y el repo no pasa su propio `prettier --check` sobre el código de la Fase 0.
