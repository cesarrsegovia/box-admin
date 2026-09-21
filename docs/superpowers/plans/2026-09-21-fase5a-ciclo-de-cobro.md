# Fase 5A — El ciclo de cobro: plan de implementación

> **Para agentes:** SUB-SKILL OBLIGATORIA: usa `superpowers:subagent-driven-development` o
> `superpowers:executing-plans` para ejecutar este plan tarea a tarea. Los pasos usan casillas
> (`- [ ]`) para poder marcarlos.

**Objetivo:** que el admin tenga control del cobro — registrar pagos, aprobar comprobantes con
importe — y que "estar al día" deje de ser una bandera que nadie mantiene para ser una pregunta que
el sistema contesta solo.

**Arquitectura:** una función pura `estaAlDia` sin una sola query, un módulo `pagos` que la alimenta
desde la base, y la columna `Perfil.pagoAlDia` **borrada**. El patrón es el de siempre desde la Fase
2: la regla vive en una función que se prueba con una tabla de casos, y el I/O vive aparte.

**Stack:** NestJS 10 · Prisma 7 + PostgreSQL 16 · TypeScript estricto · Jest + Supertest.

**Spec:** `docs/superpowers/specs/2026-09-21-fase5a-ciclo-de-cobro.md`

---

## Antes de empezar: las trampas de este repositorio

1. **Nunca `docker compose up` a secas.** Solo `docker compose up -d postgres postgres-test redis`.
   Levantar el servicio `api` arranca una segunda API que **le roba los jobs a Redis**.
2. **Comprueba `docker info` antes de nada.** Docker Desktop se ha caído solo ocho veces desde la
   Fase 2; ya es lo normal, no la excepción.
3. **"El puerto está libre" no significa "no hay proceso vivo".** Comprueba los procesos y **mata por
   PID**, nunca por nombre: hay una sesión de Claude Code corriendo sobre node en esta máquina.
   ```bash
   powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { \$_.CommandLine -like '*box-admin*' } | Select-Object ProcessId, CommandLine"
   ```
4. **Nunca corras `pnpm lint`**: lleva `--fix` y reformatea código commiteado. Usa
   `pnpm exec prettier --check`, y `--write` solo sobre archivos nuevos de esta fase.
5. **`prisma migrate reset` y `docker compose down -v` necesitan permiso explícito de Cesar.**
6. **Después de tocar `schema.prisma`**, `pnpm exec dotenv -e ../../.env -- prisma generate`. Si no,
   `tsc` explota con decenas de `Parameter 'tx' implicitly has an 'any' type` que no mencionan
   Prisma.
7. **Los e2e necesitan `dotenv`.** `pnpm exec jest --config test/jest-e2e.json` a secas usa los
   límites estrictos del throttler y la suite muere con **429**. Usa `pnpm test:e2e`, o
   `pnpm exec dotenv -e ../../.env.test -- jest --config ./test/jest-e2e.json <archivo>`. Esta
   trampa costó una vuelta entera en la Fase 4.
8. **Para editar archivos con acentos desde Python**, trabaja en `str` y escribe con
   `encoding='utf-8'`. Un literal de bytes con `§` o `ñ` revienta con
   `SyntaxError: bytes can only contain ASCII literal characters`. Y **nunca** abras un archivo del
   repositorio en modo texto sin `newline=''`: en la Fase 3A eso convirtió un archivo entero de LF a
   CRLF y `core.autocrlf=true` lo ocultó en `git diff`.

**Los commits los hace Cesar.** No ejecutes `git add`, `git commit`, `git push`, `git stash`,
`git checkout` ni `git reset`. Cada tarea termina con un mensaje **sugerido**.

---

## Estructura de archivos

### Se crean

| Archivo | Responsabilidad |
|---|---|
| `apps/api/src/pagos/estado-de-pago.ts` | **Función pura**: ¿este alumno está al día? |
| `apps/api/src/pagos/estado-de-pago.spec.ts` | Su tabla de casos |
| `apps/api/src/pagos/pagos.service.ts` | Registrar, listar, anular y la cortesía |
| `apps/api/src/pagos/pagos.service.spec.ts` | Unitarios del servicio |
| `apps/api/src/pagos/pagos.controller.ts` | `/pagos` |
| `apps/api/src/pagos/pagos.module.ts` | El módulo |
| `apps/api/src/pagos/dto/crear-pago.dto.ts` | El alta |
| `apps/api/src/pagos/dto/estado-pago.dto.ts` | `{ alDia, cubreHasta?, nota? }` |
| `apps/api/src/comprobantes/dto/aprobar-comprobante.dto.ts` | `{ monto, cubreHasta, metodo?, nota? }` |
| `apps/api/test/pagos.e2e-spec.ts` | La cadena completa |

### Se modifican

| Archivo | Cambio |
|---|---|
| `apps/api/prisma/schema.prisma` | `Pago`, `MetodoPago`, `@@unique` en `Comprobante`, **borrar** `Perfil.pagoAlDia` |
| `apps/api/src/common/tenant/tenant-scoped.extension.ts` | Clasificar `Pago` |
| `apps/api/src/common/historial/historial.service.ts` | `'Pago'` y `'ANULADO'` |
| `apps/api/test/helpers.ts` | `"pagos"` en el TRUNCATE |
| `packages/shared/src/pagos.contracts.ts` | **Nuevo**, exportado desde el índice |
| `packages/shared/src/nucleo.contracts.ts` | `pagoAlDia` en `UsuarioResumen` |
| `apps/api/src/usuarios/usuarios.mapper.ts` | `pagoAlDia` entra por parámetro, no del perfil |
| `apps/api/src/usuarios/usuarios.service.ts` | Deriva el estado; `pagoAlDia` sale de los DTO |
| `apps/api/src/usuarios/usuarios.controller.ts` | `PATCH /:id/estado-pago` |
| `apps/api/src/usuarios/dto/crear-alumno.dto.ts` · `actualizar-usuario.dto.ts` | Quitar `pagoAlDia` |
| `apps/api/src/mi-calendario/mi-pack.service.ts` | Deriva el estado |
| `apps/api/src/comprobantes/comprobantes.service.ts` · `.controller.ts` | Aprobar crea el pago |
| `apps/api/test/selfservice.e2e-spec.ts` | Los tres tests que asumen el contrato viejo |
| `apps/api/src/app.module.ts` | `PagosModule` |
| `README.md` · `docs/superpowers/plans/PROGRESO.md` | Documentación y tracker |

---

## Task 0: El schema, la migración y la clasificación

**Files:**
- Modificar: `apps/api/prisma/schema.prisma`
- Modificar: `apps/api/src/common/tenant/tenant-scoped.extension.ts`
- Modificar: `apps/api/src/common/historial/historial.service.ts`
- Modificar: `apps/api/test/helpers.ts`

⚠️ **El orden importa**: `prisma generate` **antes** de correr los meta-tests de la extensión, que
comparan la clasificación contra el DMMF real. Al revés, el error apunta a la clasificación cuando el
problema es el cliente sin regenerar.

- [ ] **Step 1: Levantar la infraestructura**

```bash
cd /d/Dev/box-admin && docker info > /dev/null && docker compose up -d postgres postgres-test redis
docker compose ps --format "{{.Service}} {{.State}}"
```

Esperado: `postgres`, `postgres-test` y `redis` en `running`. Si `docker info` falla, arranca Docker
Desktop y espera a que responda.

- [ ] **Step 2: El enum y el modelo**

En `apps/api/prisma/schema.prisma`, junto a los demás enums (después de `EstadoComprobante`):

```prisma
/// Enum y no `String` libre como el PDF: un typo en un string libre es un bug
/// silencioso, y el enum lo convierte en error de compilacion. Mismo criterio
/// que TipoCancelacion (Fase 1) y EstadoComprobante (Fase 3A).
enum MetodoPago {
  EFECTIVO
  TRANSFERENCIA
  CORTESIA
  OTRO
}
```

Y al final del archivo:

```prisma
model Pago {
  // El registro de dinero que YA entro, fuera del sistema. No hay pasarela de
  // pago ni la pide ninguna fase.
  id       String @id @default(cuid())
  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id])

  // FK COMPUESTAS por tenant, como todo el schema desde la Fase 1.
  perfilId String
  perfil   Perfil @relation(fields: [tenantId, perfilId], references: [tenantId, id])

  monto  Decimal    @db.Decimal(10, 2)
  metodo MetodoPago

  /// Una sena reserva un lugar; no pone al alumno al dia.
  esSena Boolean @default(false)

  // El periodo que cubre. Es lo que hace que "al dia" se pueda DERIVAR en vez
  // de guardarse en un booleano que nadie mantiene: la pregunta es si hay algun
  // pago vigente que cubra hoy.
  cubreDesde DateTime @db.Date
  cubreHasta DateTime @db.Date

  comprobanteId String?
  comprobante   Comprobante? @relation(fields: [tenantId, comprobanteId], references: [tenantId, id])

  /// Escalar sin FK, igual que HistorialAccion.usuarioId: es auditoria.
  registradoPor String
  nota          String?

  // Un pago NO se borra: se anula. Es dinero, y borrar la fila reescribe la
  // caja que la Fase 6 va a leer. Ademas cubre el caso feo y real: el admin
  // tecleo 250000 en vez de 25000.
  anuladoEn  DateTime?
  anuladoPor String?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([tenantId, perfilId])
  // La pregunta "quien esta al dia" filtra por aqui.
  @@index([tenantId, cubreHasta])
  @@map("pagos")
}
```

- [ ] **Step 3: El `@@unique` que le faltaba a `Comprobante`**

`Pago.comprobante` es una FK compuesta, y Postgres exige que apunte a una restricción única sobre
exactamente esas columnas. Seis modelos ya lo tienen; `Comprobante` no, porque hasta ahora nadie le
apuntaba.

En `model Comprobante`, junto a sus índices:

```prisma
  // Destino de la FK compuesta de Pago.comprobante. Ver Usuario.
  @@unique([tenantId, id])
```

- [ ] **Step 4: Las relaciones inversas y borrar `pagoAlDia`**

En `model Perfil`, **borra la línea** `pagoAlDia Boolean @default(false)` y añade la relación:

```prisma
  pagos Pago[]
```

En `model Tenant`:

```prisma
  pagos Pago[]
```

En `model Comprobante`:

```prisma
  pagos Pago[]
```

⚠️ Un `Comprobante` puede tener varios pagos en el tipo aunque en la práctica tenga uno: Prisma
exige el lado inverso y una relación 1-1 pediría un `@unique` sobre `comprobanteId` que no hace
falta.

- [ ] **Step 5: Validar antes de migrar**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec dotenv -e ../../.env -- prisma validate
```

Esperado: `The schema at prisma\schema.prisma is valid 🚀`. Si se queja de una relación sin par,
vuelve al paso 4: es más barato que arreglarlo tras una migración a medias.

- [ ] **Step 6: Migrar las dos bases y generar el cliente**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec dotenv -e ../../.env -- prisma migrate dev --name fase5a_ciclo_de_cobro
pnpm exec dotenv -e ../../.env.test -- prisma migrate deploy
pnpm exec dotenv -e ../../.env -- prisma generate
```

Esperado: migración creada, `All migrations have been successfully applied` y `Generated Prisma
Client`.

⚠️ **La migración BORRA una columna con datos.** Prisma avisará. En desarrollo no hay nada que
perder; si algún día hubiera producción, esta migración necesitaría un paso previo que convirtiera
cada `pagoAlDia = true` en un `Pago` de cortesía. Déjalo anotado y sigue.

- [ ] **Step 7: Clasificar `Pago` en la extensión de aislamiento**

En `apps/api/src/common/tenant/tenant-scoped.extension.ts`, dentro de `MODELOS_CON_TENANT`, después
de `'HorarioProfesorAsignado'`:

```ts
  'HorarioProfesorAsignado',
  'Pago',
] as const;
```

Sin esto, **cualquier** query sobre el modelo se bloquea con `ModeloNoClasificadoError`, que es el
comportamiento correcto: la extensión falla cerrada.

- [ ] **Step 8: Correr los meta-tests de la extensión**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/common/tenant --silent
```

Esperado: 115 tests en verde.

- [ ] **Step 9: Ampliar las entidades auditables**

En `apps/api/src/common/historial/historial.service.ts`, en `EntidadAuditable` después de
`'HorarioProfesorAsignado'`:

```ts
  | 'HorarioProfesorAsignado'
  | 'Pago';
```

Y en `AccionAuditable`, después de `'ASISTENCIA_REGISTRADA'`:

```ts
  | 'ASISTENCIA_REGISTRADA'
  | 'ANULADO';
```

- [ ] **Step 10: Añadir la tabla al TRUNCATE**

En `apps/api/test/helpers.ts`, en la primera línea de la lista:

```ts
    'TRUNCATE TABLE ' +
      '"pagos", "horarios_profesor_asignados", "comprobantes", "listas_espera", ' +
```

Va primero por dependencia: cuelga de comprobantes y de perfiles.

- [ ] **Step 11: Ver qué rompió borrar la columna**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec tsc --noEmit
```

Esperado: **falla**, y es la señal buena. Los errores apuntan a los cuatro sitios que leían o
escribían `perfil.pagoAlDia`:

- `usuarios.mapper.ts` (lo devuelve en el detalle)
- `usuarios.service.ts` (lo escribe al crear y al actualizar)
- `mi-pack.service.ts` (lo devuelve al alumno)
- `comprobantes.service.ts` (lo pone en `true` al aprobar)

Son exactamente las tareas 5, 6 y 7. **Déjalo roto y sigue**: cerrarlo a medias ahora obliga a
tocarlo dos veces.

**Mensaje de commit sugerido para Cesar:**

```
feat(api): el modelo Pago, y pagoAlDia deja de ser una columna

Un pago cubre un periodo, asi que "estar al dia" pasa a poder derivarse
en vez de vivir en un booleano que nadie bajaba nunca. El metodo va como
enum y no como string libre, y un pago se anula en vez de borrarse:
es dinero, y borrarlo reescribe la caja que la Fase 6 va a leer.

Comprobante gana el @@unique([tenantId, id]) que le faltaba para poder
ser destino de una FK compuesta.
```

---

## Task 1: Los contratos compartidos

**Files:**
- Crear: `packages/shared/src/pagos.contracts.ts`
- Modificar: `packages/shared/src/index.ts`, `packages/shared/src/nucleo.contracts.ts`

- [ ] **Step 1: Escribir los contratos**

Crear `packages/shared/src/pagos.contracts.ts`:

```ts
// ---------------------------------------------------------------------------
// Fase 5A — El ciclo de cobro
// ---------------------------------------------------------------------------

export type MetodoPago = 'EFECTIVO' | 'TRANSFERENCIA' | 'CORTESIA' | 'OTRO';

/**
 * Un pago ya registrado.
 *
 * `monto` viaja como string con dos decimales, nunca como number: es dinero, y
 * un float binario no representa 25000.10 exactamente. Misma regla que el
 * precio de los packs desde la Fase 1.
 */
export interface PagoPublico {
  id: string;
  tenantId: string;
  perfilId: string;
  monto: string;
  metodo: MetodoPago;
  /** Una sena reserva un lugar; no pone al alumno al dia. */
  esSena: boolean;
  /** `YYYY-MM-DD`. */
  cubreDesde: string;
  cubreHasta: string;
  comprobanteId: string | null;
  /** Id del usuario que lo registro. */
  registradoPor: string;
  nota: string | null;
  /** ISO 8601 completo, o `null` si sigue vigente. */
  anuladoEn: string | null;
  anuladoPor: string | null;
  createdAt: string;
}
```

- [ ] **Step 2: `pagoAlDia` entra en el resumen**

En `packages/shared/src/nucleo.contracts.ts`, dentro de `UsuarioResumen`, después de `packId`:

```ts
  packId: string | null;
  /**
   * DERIVADO desde la Fase 5A: hay un pago vigente, no anulado y que no sea una
   * sena, cubriendo hoy. Antes era una columna que nadie bajaba nunca.
   */
  pagoAlDia: boolean;
```

`UsuarioDetalle` ya lo lleva y lo hereda de aquí: **borra la línea `pagoAlDia: boolean;` de
`UsuarioDetalle`** para no declararlo dos veces.

- [ ] **Step 3: Exportar**

En `packages/shared/src/index.ts`, después de `export * from './profesor.contracts';`:

```ts
export * from './pagos.contracts';
```

- [ ] **Step 4: Compilar**

```bash
cd /d/Dev/box-admin/packages/shared && pnpm build && pnpm exec jest --silent
```

Esperado: compila y los 86 tests siguen en verde.

**Mensaje de commit sugerido para Cesar:**

```
feat(shared): contratos de pagos y pagoAlDia en el resumen

El listado de usuarios pasa a llevar el estado de pago: el objetivo de la
fase es que el admin lo vea de un vistazo, no abriendo fichas de una en
una. El monto viaja como string con dos decimales, como los precios.
```

---
## Task 2: `estaAlDia`, la función pura

**Files:**
- Crear: `apps/api/src/pagos/estado-de-pago.ts`
- Test: `apps/api/src/pagos/estado-de-pago.spec.ts`

Es la regla de negocio entera de esta fase, en una función sin base de datos. Todo lo que pregunte
"¿está al día?" pasa por aquí: el listado de usuarios, el detalle, y `mi-pack` del alumno.

- [ ] **Step 1: Escribir la tabla de casos**

Crear `apps/api/src/pagos/estado-de-pago.spec.ts`:

```ts
import { estaAlDia, type PagoParaEstado } from './estado-de-pago';

const dia = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

/** Un momento cualquiera del 15 de septiembre, no su medianoche. */
const HOY = new Date('2026-09-15T14:30:00.000Z');

function pago(parcial: Partial<PagoParaEstado> = {}): PagoParaEstado {
  return {
    esSena: false,
    cubreDesde: dia('2026-09-01'),
    cubreHasta: dia('2026-09-30'),
    anuladoEn: null,
    ...parcial,
  };
}

describe('estaAlDia', () => {
  it('sin pagos, no esta al dia', () => {
    expect(estaAlDia([], HOY)).toBe(false);
  });

  it('un pago vigente lo pone al dia', () => {
    expect(estaAlDia([pago()], HOY)).toBe(true);
  });

  it('un pago vencido no cuenta', () => {
    expect(estaAlDia([pago({ cubreHasta: dia('2026-09-14') })], HOY)).toBe(false);
  });

  it('un pago que todavia no empezo no cuenta', () => {
    expect(estaAlDia([pago({ cubreDesde: dia('2026-09-16') })], HOY)).toBe(false);
  });

  it('el PRIMER dia del periodo cuenta', () => {
    expect(estaAlDia([pago({ cubreDesde: dia('2026-09-15') })], HOY)).toBe(true);
  });

  it('el ULTIMO dia del periodo cuenta ENTERO, no hasta su medianoche', () => {
    // El caso que mas facil es romper: cubreHasta es @db.Date, o sea medianoche
    // UTC, y `hoy` trae la hora. Comparar los dos en crudo deja fuera todo el
    // ultimo dia del periodo, que es justo el dia en que el alumno se acerca a
    // pagar.
    expect(estaAlDia([pago({ cubreHasta: dia('2026-09-15') })], HOY)).toBe(true);
  });

  it('un pago anulado no cuenta, aunque su periodo cubra hoy', () => {
    expect(estaAlDia([pago({ anuladoEn: new Date('2026-09-10T00:00:00.000Z') })], HOY)).toBe(false);
  });

  it('una sena no pone al dia', () => {
    // Decidido en la spec, no en el PDF: una sena reserva un lugar, no salda el
    // periodo.
    expect(estaAlDia([pago({ esSena: true })], HOY)).toBe(false);
  });

  it('basta con que UNO de varios cuente', () => {
    const pagos = [
      pago({ anuladoEn: new Date('2026-09-10T00:00:00.000Z') }),
      pago({ esSena: true }),
      pago(),
    ];
    expect(estaAlDia(pagos, HOY)).toBe(true);
  });

  it('dos periodos que se solapan no son un problema', () => {
    // Pagar dos meses por adelantado es normal. La pregunta es si hay alguno
    // que cubra hoy, no cual.
    const pagos = [pago(), pago({ cubreDesde: dia('2026-09-10'), cubreHasta: dia('2026-10-10') })];
    expect(estaAlDia(pagos, HOY)).toBe(true);
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/pagos --silent
```

Esperado: FALLA con `Cannot find module './estado-de-pago'`.

- [ ] **Step 3: Implementar**

Crear `apps/api/src/pagos/estado-de-pago.ts`:

```ts
import { comienzoDeHoyUtc, fechaEnRango } from '@boxadmin/shared';

/** Lo que la regla necesita saber de un pago. Nada mas. */
export interface PagoParaEstado {
  esSena: boolean;
  cubreDesde: Date;
  cubreHasta: Date;
  anuladoEn: Date | null;
}

/**
 * ¿Esta este alumno al dia?
 *
 * PURA: no toca la base. Es la regla de negocio entera de la Fase 5A, y todo lo
 * que la pregunte —el listado de usuarios, el detalle y `mi-pack`— pasa por
 * aqui. Una sola implementacion, un solo sitio donde equivocarse.
 *
 * `hoy` se normaliza a medianoche UTC antes de comparar. `cubreDesde` y
 * `cubreHasta` son `@db.Date`, o sea medianoche; comparar contra un `hoy` con
 * hora dejaria fuera todo el ultimo dia del periodo, que es justo el dia en que
 * el alumno se acerca a pagar.
 */
export function estaAlDia(pagos: PagoParaEstado[], hoy: Date = new Date()): boolean {
  const dia = comienzoDeHoyUtc(hoy);

  return pagos.some((pago) => cuenta(pago, dia));
}

function cuenta(pago: PagoParaEstado, dia: Date): boolean {
  if (pago.anuladoEn !== null) return false;
  // Una sena reserva un lugar; no salda el periodo.
  if (pago.esSena) return false;

  return fechaEnRango(dia, pago.cubreDesde, pago.cubreHasta);
}
```

- [ ] **Step 4: Correr y ver pasar**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/pagos --silent
```

Esperado: 10 tests en verde.

- [ ] **Step 5: Mutación — el borde del último día**

Cambia `const dia = comienzoDeHoyUtc(hoy);` por `const dia = hoy;`.

Esperado: falla `el ULTIMO dia del periodo cuenta ENTERO`. Si pasa, ese test no está probando el
borde y hay que arreglarlo antes de seguir.

**Deshaz la mutación.**

- [ ] **Step 6: Mutación — el filtro de anulados**

Borra la línea `if (pago.anuladoEn !== null) return false;`.

Esperado: fallan `un pago anulado no cuenta` y ninguno más.

**Deshaz la mutación.**

**Mensaje de commit sugerido para Cesar:**

```
feat(api): estaAlDia, la regla del cobro sin tocar la base

Un pago cuenta si no esta anulado, no es una sena y cubre hoy. `hoy` se
normaliza a medianoche UTC antes de comparar: cubreHasta es @db.Date, y
comparar contra una hora dejaria fuera el ultimo dia entero del periodo,
que es justo cuando el alumno se acerca a pagar.
```

---

## Task 3: El módulo de pagos

**Files:**
- Crear: `apps/api/src/pagos/dto/crear-pago.dto.ts`
- Crear: `apps/api/src/pagos/pagos.service.ts`
- Crear: `apps/api/src/pagos/pagos.controller.ts`
- Crear: `apps/api/src/pagos/pagos.module.ts`
- Test: `apps/api/src/pagos/pagos.service.spec.ts`
- Modificar: `apps/api/src/app.module.ts`

- [ ] **Step 1: El DTO**

Crear `apps/api/src/pagos/dto/crear-pago.dto.ts`:

```ts
import { IsBoolean, IsIn, IsOptional, IsString, IsNotEmpty, Matches, MaxLength } from 'class-validator';
import { PATRON_FECHA, type MetodoPago } from '@boxadmin/shared';

/** Hasta 8 enteros y como mucho 2 decimales: encaja en DECIMAL(10, 2). */
const PATRON_MONTO = /^\d{1,8}(\.\d{1,2})?$/;

const METODOS: MetodoPago[] = ['EFECTIVO', 'TRANSFERENCIA', 'CORTESIA', 'OTRO'];

export class CrearPagoDto {
  @IsString()
  @IsNotEmpty()
  perfilId!: string;

  /**
   * String, nunca number: es dinero, y un float binario no representa 25000.10
   * exactamente.
   */
  @Matches(PATRON_MONTO, {
    message: 'monto debe ser un numero con hasta 2 decimales, como "25000.00"',
  })
  monto!: string;

  @IsIn(METODOS)
  metodo!: MetodoPago;

  @Matches(PATRON_FECHA, { message: 'cubreDesde debe tener formato YYYY-MM-DD' })
  cubreDesde!: string;

  @Matches(PATRON_FECHA, { message: 'cubreHasta debe tener formato YYYY-MM-DD' })
  cubreHasta!: string;

  @IsOptional()
  @IsBoolean()
  esSena?: boolean;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  comprobanteId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  nota?: string;
}
```

- [ ] **Step 2: Escribir los tests del servicio**

Crear `apps/api/src/pagos/pagos.service.spec.ts`:

```ts
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PagosService } from './pagos.service';

const ACTOR = { sub: 'admin-1', tenantId: 't1', rol: 'ADMIN_OPERATIVO' } as never;

const dia = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

function baseDelAlta(parcial: Record<string, unknown> = {}) {
  return {
    perfilId: 'p1',
    monto: '25000.00',
    metodo: 'EFECTIVO',
    cubreDesde: '2026-09-01',
    cubreHasta: '2026-09-30',
    ...parcial,
  } as never;
}

function prismaFalso(estado: {
  perfil?: { id: string } | null;
  comprobante?: Record<string, unknown> | null;
  pagos?: Record<string, unknown>[];
} = {}) {
  const db = {
    perfil: {
      findFirst: jest
        .fn()
        .mockResolvedValue(estado.perfil === undefined ? { id: 'p1' } : estado.perfil),
    },
    comprobante: {
      findFirst: jest.fn().mockResolvedValue(estado.comprobante ?? null),
    },
    pago: {
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({
            id: 'pago-1',
            anuladoEn: null,
            anuladoPor: null,
            nota: null,
            comprobanteId: null,
            esSena: false,
            createdAt: new Date('2026-09-15T00:00:00.000Z'),
            ...data,
            monto: { toFixed: () => String(data.monto) },
          }),
        ),
      findFirst: jest.fn().mockResolvedValue(estado.pagos?.[0] ?? null),
      findMany: jest.fn().mockResolvedValue(estado.pagos ?? []),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(db)),
  };

  return db;
}

const historialFalso = { registrar: jest.fn().mockResolvedValue(undefined) } as never;

describe('PagosService.crear', () => {
  it('404 si el perfil no existe en este gimnasio', async () => {
    const db = prismaFalso({ perfil: null });
    const servicio = new PagosService({ db } as never, historialFalso);

    await expect(servicio.crear(ACTOR, baseDelAlta())).rejects.toThrow(NotFoundException);
  });

  it('400 si el periodo esta invertido', async () => {
    const db = prismaFalso();
    const servicio = new PagosService({ db } as never, historialFalso);

    await expect(
      servicio.crear(ACTOR, baseDelAlta({ cubreDesde: '2026-09-30', cubreHasta: '2026-09-01' })),
    ).rejects.toThrow(BadRequestException);
  });

  it('un periodo de un solo dia es valido', async () => {
    const db = prismaFalso();
    const servicio = new PagosService({ db } as never, historialFalso);

    await expect(
      servicio.crear(ACTOR, baseDelAlta({ cubreDesde: '2026-09-01', cubreHasta: '2026-09-01' })),
    ).resolves.toMatchObject({ id: 'pago-1' });
  });

  it('guarda quien lo registro, sin confiar en el cuerpo', async () => {
    const db = prismaFalso();
    const servicio = new PagosService({ db } as never, historialFalso);

    await servicio.crear(ACTOR, baseDelAlta());

    expect(db.pago.create.mock.calls[0]![0].data.registradoPor).toBe('admin-1');
  });

  it('404 si el comprobante no existe', async () => {
    const db = prismaFalso({ comprobante: null });
    const servicio = new PagosService({ db } as never, historialFalso);

    await expect(
      servicio.crear(ACTOR, baseDelAlta({ comprobanteId: 'c-fantasma' })),
    ).rejects.toThrow(NotFoundException);
  });

  it('400 si el comprobante es de OTRO perfil', async () => {
    // Enlazar el pago de un alumno al comprobante de otro mezclaria la
    // contabilidad de dos personas sin que nadie lo notara.
    const db = prismaFalso({
      comprobante: { id: 'c1', perfilId: 'otro', estado: 'APROBADO' },
    });
    const servicio = new PagosService({ db } as never, historialFalso);

    await expect(servicio.crear(ACTOR, baseDelAlta({ comprobanteId: 'c1' }))).rejects.toThrow(
      /otro alumno/i,
    );
  });

  it('409 si el comprobante no esta aprobado', async () => {
    const db = prismaFalso({
      comprobante: { id: 'c1', perfilId: 'p1', estado: 'PENDIENTE' },
    });
    const servicio = new PagosService({ db } as never, historialFalso);

    await expect(servicio.crear(ACTOR, baseDelAlta({ comprobanteId: 'c1' }))).rejects.toThrow(
      ConflictException,
    );
  });
});

describe('PagosService.anular', () => {
  it('marca la fila en vez de borrarla', async () => {
    const db = prismaFalso({ pagos: [{ id: 'pago-1', anuladoEn: null }] });
    const servicio = new PagosService({ db } as never, historialFalso);

    await servicio.anular(ACTOR, 'pago-1');

    const datos = db.pago.update.mock.calls[0]![0].data;
    expect(datos.anuladoEn).toBeInstanceOf(Date);
    expect(datos.anuladoPor).toBe('admin-1');
  });

  it('409 si ya estaba anulado', async () => {
    const db = prismaFalso({ pagos: [{ id: 'pago-1', anuladoEn: dia('2026-09-10') }] });
    const servicio = new PagosService({ db } as never, historialFalso);

    await expect(servicio.anular(ACTOR, 'pago-1')).rejects.toThrow(ConflictException);
  });
});

describe('PagosService.fijarEstado', () => {
  it('alDia true crea una cortesia de importe cero', async () => {
    const db = prismaFalso();
    const servicio = new PagosService({ db } as never, historialFalso);

    await servicio.fijarEstado(ACTOR, 'p1', { alDia: true, cubreHasta: '2026-09-30' });

    const datos = db.pago.create.mock.calls[0]![0].data;
    expect(datos.metodo).toBe('CORTESIA');
    expect(datos.monto).toBe('0.00');
  });

  it('alDia false anula SOLO las cortesias vigentes', async () => {
    // Un pago real no se toca desde aqui: para eso esta anular, que pide otro
    // rol. Nadie puede borrar un cobro desde el endpoint de estado.
    const db = prismaFalso();
    const servicio = new PagosService({ db } as never, historialFalso);

    await servicio.fijarEstado(ACTOR, 'p1', { alDia: false });

    const donde = db.pago.updateMany.mock.calls[0]![0].where;
    expect(donde.metodo).toBe('CORTESIA');
    expect(donde.anuladoEn).toBeNull();
    expect(db.pago.create).not.toHaveBeenCalled();
  });

  it('alDia true sin cubreHasta es 400', async () => {
    const db = prismaFalso();
    const servicio = new PagosService({ db } as never, historialFalso);

    await expect(servicio.fijarEstado(ACTOR, 'p1', { alDia: true })).rejects.toThrow(
      BadRequestException,
    );
  });
});
```

- [ ] **Step 3: Correr y ver fallar**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/pagos --silent
```

Esperado: FALLA con `Cannot find module './pagos.service'`.

- [ ] **Step 4: Implementar el servicio**

Crear `apps/api/src/pagos/pagos.service.ts`:

```ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  aFechaISO,
  comienzoDeHoyUtc,
  desdeFechaISO,
  type JwtPayload,
  type MetodoPago,
  type PagoPublico,
} from '@boxadmin/shared';
import { HistorialService } from '../common/historial/historial.service';
import { PrismaService, type ClientePrismaTx } from '../prisma/prisma.service';
import type { CrearPagoDto } from './dto/crear-pago.dto';
import type { EstadoPagoDto } from './dto/estado-pago.dto';
import { estaAlDia, type PagoParaEstado } from './estado-de-pago';

export interface FiltroPagos {
  perfilId?: string;
  desde?: string;
  hasta?: string;
}

/** Fila de Prisma tal como la devuelve la base. */
interface FilaPago {
  id: string;
  tenantId: string;
  perfilId: string;
  monto: { toFixed(digitos: number): string };
  metodo: MetodoPago;
  esSena: boolean;
  cubreDesde: Date;
  cubreHasta: Date;
  comprobanteId: string | null;
  registradoPor: string;
  nota: string | null;
  anuladoEn: Date | null;
  anuladoPor: string | null;
  createdAt: Date;
}

export function aPagoPublico(fila: FilaPago): PagoPublico {
  return {
    id: fila.id,
    tenantId: fila.tenantId,
    perfilId: fila.perfilId,
    // toFixed y no toString: es dinero, y convertir a number reintroduciria el
    // error de coma flotante que el Decimal existe para evitar.
    monto: fila.monto.toFixed(2),
    metodo: fila.metodo,
    esSena: fila.esSena,
    cubreDesde: aFechaISO(fila.cubreDesde),
    cubreHasta: aFechaISO(fila.cubreHasta),
    comprobanteId: fila.comprobanteId,
    registradoPor: fila.registradoPor,
    nota: fila.nota,
    anuladoEn: fila.anuladoEn === null ? null : fila.anuladoEn.toISOString(),
    anuladoPor: fila.anuladoPor,
    createdAt: fila.createdAt.toISOString(),
  };
}

/** Las columnas que `estaAlDia` necesita, y ninguna mas. */
const COLUMNAS_DE_ESTADO = {
  perfilId: true,
  esSena: true,
  cubreDesde: true,
  cubreHasta: true,
  anuladoEn: true,
} as const;

@Injectable()
export class PagosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly historial: HistorialService,
  ) {}

  async crear(actor: JwtPayload, dto: CrearPagoDto): Promise<PagoPublico> {
    const cubreDesde = desdeFechaISO(dto.cubreDesde);
    const cubreHasta = desdeFechaISO(dto.cubreHasta);
    if (cubreHasta.getTime() < cubreDesde.getTime()) {
      throw new BadRequestException('cubreHasta no puede ser anterior a cubreDesde');
    }

    const fila = await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      const perfil = await cliente.perfil.findFirst({ where: { id: dto.perfilId } });
      if (!perfil) throw new NotFoundException('Perfil inexistente');

      if (dto.comprobanteId !== undefined) {
        await this.exigirComprobanteUtilizable(cliente, dto.comprobanteId, dto.perfilId);
      }

      const creada = await cliente.pago.create({
        data: {
          tenantId: actor.tenantId,
          perfilId: dto.perfilId,
          monto: dto.monto,
          metodo: dto.metodo,
          esSena: dto.esSena ?? false,
          cubreDesde,
          cubreHasta,
          comprobanteId: dto.comprobanteId ?? null,
          // Del token, NUNCA del cuerpo: quien registra el cobro es quien esta
          // autenticado.
          registradoPor: actor.sub,
          nota: dto.nota ?? null,
        },
      });

      await this.historial.registrar(
        {
          actor,
          entidad: 'Pago',
          entidadId: creada.id,
          accion: 'CREADA',
          detalle: { perfilId: dto.perfilId, monto: dto.monto, metodo: dto.metodo },
        },
        cliente,
      );

      return creada;
    });

    return aPagoPublico(fila as unknown as FilaPago);
  }

  async listar(filtro: FiltroPagos): Promise<PagoPublico[]> {
    const where: Record<string, unknown> = {};
    if (filtro.perfilId) where.perfilId = filtro.perfilId;

    // El rango filtra por CUANDO ENTRO el dinero, no por el periodo que cubre.
    // Son dos preguntas distintas y la de la caja es esta.
    if (filtro.desde || filtro.hasta) {
      where.createdAt = {
        ...(filtro.desde ? { gte: desdeFechaISO(filtro.desde) } : {}),
        ...(filtro.hasta ? { lte: finDelDia(filtro.hasta) } : {}),
      };
    }

    const filas = await this.prisma.db.pago.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return (filas as unknown as FilaPago[]).map(aPagoPublico);
  }

  /**
   * Un pago no se borra: se anula. Es dinero, y borrar la fila reescribe la
   * caja que la Fase 6 va a leer.
   */
  async anular(actor: JwtPayload, id: string): Promise<PagoPublico> {
    await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      const existente = await cliente.pago.findFirst({ where: { id } });
      if (!existente) throw new NotFoundException('Pago inexistente');
      if (existente.anuladoEn !== null) throw new ConflictException('Ese pago ya estaba anulado');

      await cliente.pago.update({
        where: { id },
        data: { anuladoEn: new Date(), anuladoPor: actor.sub },
      });

      await this.historial.registrar(
        { actor, entidad: 'Pago', entidadId: id, accion: 'ANULADO' },
        cliente,
      );
    });

    const fila = await this.prisma.db.pago.findFirst({ where: { id } });
    return aPagoPublico(fila as unknown as FilaPago);
  }

  /**
   * El override del admin: una cortesia.
   *
   * Todo pasa por la tabla de pagos, asi que hay una sola verdad y la Fase 6 ve
   * la cortesia explicitamente en vez de encontrarse un alumno al dia que no
   * pago nada y no poder explicar por que.
   */
  async fijarEstado(
    actor: JwtPayload,
    perfilId: string,
    dto: EstadoPagoDto,
    ahora: Date = new Date(),
  ): Promise<void> {
    const hoy = comienzoDeHoyUtc(ahora);

    await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      const perfil = await cliente.perfil.findFirst({ where: { id: perfilId } });
      if (!perfil) throw new NotFoundException('Perfil inexistente');

      if (dto.alDia) {
        if (dto.cubreHasta === undefined) {
          throw new BadRequestException('Para ponerlo al dia hace falta cubreHasta');
        }

        await cliente.pago.create({
          data: {
            tenantId: actor.tenantId,
            perfilId,
            monto: '0.00',
            metodo: 'CORTESIA',
            esSena: false,
            cubreDesde: hoy,
            cubreHasta: desdeFechaISO(dto.cubreHasta),
            registradoPor: actor.sub,
            nota: dto.nota ?? null,
          },
        });
      } else {
        // SOLO las cortesias. Un pago real no se toca desde aqui: para eso esta
        // `anular`, que pide ADMIN_SALON.
        await cliente.pago.updateMany({
          where: {
            perfilId,
            metodo: 'CORTESIA',
            anuladoEn: null,
            cubreHasta: { gte: hoy },
          },
          data: { anuladoEn: new Date(), anuladoPor: actor.sub },
        });
      }

      await this.historial.registrar(
        {
          actor,
          entidad: 'Pago',
          entidadId: perfilId,
          accion: dto.alDia ? 'CREADA' : 'ANULADO',
          detalle: { cortesia: true, alDia: dto.alDia },
        },
        cliente,
      );
    });
  }

  /**
   * Cuales de estos perfiles estan al dia, en UNA sola consulta.
   *
   * El `where` es solo un prefiltro barato para no traerse el historico entero:
   * la decision la toma `estaAlDia`, que es la unica implementacion de la regla.
   * Repetirla aqui en SQL crearia dos copias que algun dia discrepan.
   */
  async perfilesAlDia(
    cliente: ClientePrismaTx,
    perfilIds: string[],
    ahora: Date = new Date(),
  ): Promise<Set<string>> {
    if (perfilIds.length === 0) return new Set();

    const hoy = comienzoDeHoyUtc(ahora);
    const filas = await cliente.pago.findMany({
      where: { perfilId: { in: perfilIds }, anuladoEn: null, cubreHasta: { gte: hoy } },
      select: COLUMNAS_DE_ESTADO,
    });

    const porPerfil = new Map<string, PagoParaEstado[]>();
    for (const fila of filas as unknown as (PagoParaEstado & { perfilId: string })[]) {
      const lista = porPerfil.get(fila.perfilId) ?? [];
      lista.push(fila);
      porPerfil.set(fila.perfilId, lista);
    }

    const alDia = new Set<string>();
    for (const [perfilId, pagos] of porPerfil) {
      if (estaAlDia(pagos, ahora)) alDia.add(perfilId);
    }

    return alDia;
  }

  /** Atajo para un solo perfil. */
  async perfilAlDia(
    cliente: ClientePrismaTx,
    perfilId: string,
    ahora: Date = new Date(),
  ): Promise<boolean> {
    return (await this.perfilesAlDia(cliente, [perfilId], ahora)).has(perfilId);
  }

  private async exigirComprobanteUtilizable(
    cliente: ClientePrismaTx,
    comprobanteId: string,
    perfilId: string,
  ): Promise<void> {
    const comprobante = await cliente.comprobante.findFirst({ where: { id: comprobanteId } });
    if (!comprobante) throw new NotFoundException('Comprobante inexistente');

    if (comprobante.perfilId !== perfilId) {
      throw new BadRequestException(
        'Ese comprobante es de otro alumno. Enlazarlo mezclaria la contabilidad de dos personas.',
      );
    }
    if (comprobante.estado !== 'APROBADO') {
      throw new ConflictException(
        `El comprobante esta ${comprobante.estado.toLowerCase()}: aprobalo antes de enlazar un pago.`,
      );
    }
  }
}

/**
 * El final del dia indicado, para que un filtro `hasta: 2026-09-30` incluya los
 * pagos de ese mismo dia y no solo los de su medianoche.
 */
function finDelDia(iso: string): Date {
  const dia = desdeFechaISO(iso);
  return new Date(dia.getTime() + 24 * 60 * 60 * 1000 - 1);
}
```

- [ ] **Step 5: El DTO del estado**

Crear `apps/api/src/pagos/dto/estado-pago.dto.ts`:

```ts
import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PATRON_FECHA } from '@boxadmin/shared';

/**
 * El override del admin. `alDia: true` crea una cortesia que cubre hasta la
 * fecha indicada; `alDia: false` anula las cortesias vigentes y NO toca los
 * pagos reales.
 */
export class EstadoPagoDto {
  @IsBoolean()
  alDia!: boolean;

  /** Obligatorio cuando `alDia` es true. Lo comprueba el servicio. */
  @IsOptional()
  @Matches(PATRON_FECHA, { message: 'cubreHasta debe tener formato YYYY-MM-DD' })
  cubreHasta?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  nota?: string;
}
```

- [ ] **Step 6: Correr y ver pasar**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/pagos --silent
```

Esperado: 10 de `estado-de-pago` + 12 del servicio, en verde.

- [ ] **Step 7: El controlador y el módulo**

Crear `apps/api/src/pagos/pagos.controller.ts`:

```ts
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import type { JwtPayload, PagoPublico } from '@boxadmin/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CrearPagoDto } from './dto/crear-pago.dto';
import { PagosService } from './pagos.service';

@Controller('pagos')
export class PagosController {
  constructor(private readonly pagos: PagosService) {}

  @Roles('ADMIN_OPERATIVO')
  @Post()
  crear(@CurrentUser() actor: JwtPayload, @Body() dto: CrearPagoDto): Promise<PagoPublico> {
    return this.pagos.crear(actor, dto);
  }

  @Roles('ADMIN_OPERATIVO')
  @Get()
  listar(
    @Query('perfilId') perfilId?: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
  ): Promise<PagoPublico[]> {
    return this.pagos.listar({ perfilId, desde, hasta });
  }

  // ADMIN_SALON y no ADMIN_OPERATIVO: registrar un cobro es operativo,
  // deshacerlo es contable.
  @Roles('ADMIN_SALON')
  @Patch(':id/anular')
  anular(@CurrentUser() actor: JwtPayload, @Param('id') id: string): Promise<PagoPublico> {
    return this.pagos.anular(actor, id);
  }
}
```

Crear `apps/api/src/pagos/pagos.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { PagosController } from './pagos.controller';
import { PagosService } from './pagos.service';

@Module({
  controllers: [PagosController],
  providers: [PagosService],
  exports: [PagosService],
})
export class PagosModule {}
```

En `apps/api/src/app.module.ts`, añade el import y `PagosModule` a la lista, después de
`ComprobantesModule`.

- [ ] **Step 8: Comprobar que compila lo nuevo**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec tsc --noEmit
```

Esperado: siguen **solo** los errores de la Task 0 (los cuatro sitios que leían `perfil.pagoAlDia`).
Cualquier otro es de esta tarea.

**Mensaje de commit sugerido para Cesar:**

```
feat(api): modulo de pagos con anulacion y cortesias

Registrar un cobro es ADMIN_OPERATIVO; anularlo, ADMIN_SALON: lo primero
es operativo y lo segundo contable. La cortesia del admin es un pago de
importe cero, para que la Fase 6 pueda explicar por que alguien esta al
dia sin haber pagado.

perfilesAlDia resuelve N perfiles con UNA consulta, y la decision la
sigue tomando estaAlDia: el where es solo un prefiltro, no una segunda
copia de la regla.
```

---
## Task 4: Derivar el estado donde antes se leía la columna

**Files:**
- Modificar: `apps/api/src/usuarios/usuarios.mapper.ts`
- Modificar: `apps/api/src/usuarios/usuarios.service.ts`
- Modificar: `apps/api/src/usuarios/usuarios.controller.ts`
- Modificar: `apps/api/src/usuarios/usuarios.module.ts`
- Modificar: `apps/api/src/usuarios/dto/crear-alumno.dto.ts`, `dto/actualizar-usuario.dto.ts`
- Modificar: `apps/api/src/mi-calendario/mi-pack.service.ts`
- Modificar: `apps/api/src/mi-calendario/mi-calendario.module.ts`

Aquí se cierran tres de los cuatro errores que dejó la Task 0.

- [ ] **Step 1: El mapper recibe el estado en vez de leerlo**

En `apps/api/src/usuarios/usuarios.mapper.ts`:

```ts
/**
 * Proyeccion de listado.
 *
 * `alDia` entra por parametro y no sale del perfil: desde la Fase 5A no es una
 * columna, es una pregunta que se contesta con los pagos vigentes. Sin default,
 * para que el compilador no deje olvidarlo en ningun punto de uso — el mismo
 * criterio que `incluyeFichaMedica`.
 */
export function aUsuarioResumen({ usuario, perfil, salas }: UsuarioConPerfil, alDia: boolean): UsuarioResumen {
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
    pagoAlDia: alDia,
    salaIds: salas.map((sala) => sala.id),
  };
}
```

Y en `aUsuarioDetalle`, pasa el parámetro y **borra** la línea `pagoAlDia: perfil.pagoAlDia,`:

```ts
export function aUsuarioDetalle(
  datos: UsuarioConPerfil,
  incluyeFichaMedica: boolean,
  alDia: boolean,
): UsuarioDetalle {
  const { perfil, pack, salas } = datos;

  return {
    ...aUsuarioResumen(datos, alDia),
    ...(incluyeFichaMedica ? { fichaMedica: perfil.fichaMedica } : {}),
    clasesExtra: perfil.clasesExtra,
    cancelacionesUsadas: perfil.cancelacionesUsadas,
    vigenciaDesde: perfil.vigenciaDesde === null ? null : aFechaISO(perfil.vigenciaDesde),
    vigenciaHasta: perfil.vigenciaHasta === null ? null : aFechaISO(perfil.vigenciaHasta),
    pack: pack === null ? null : aPackPublico(pack),
    salas: salas.map(aSalaPublica),
  };
}
```

- [ ] **Step 2: Escribir el test del listado**

En `apps/api/src/usuarios/usuarios.service.spec.ts`, al final:

```ts
describe('UsuariosService.listar y el estado de pago', () => {
  it('resuelve el estado de TODOS los perfiles con una sola llamada', async () => {
    // El listado devuelve N alumnos. Preguntarlo uno a uno serian N consultas,
    // y este endpoint es la pantalla principal del admin.
    const { servicio, pagos } = crearServicio();

    await servicio.listar(ADMIN, {});

    expect(pagos.perfilesAlDia).toHaveBeenCalledTimes(1);
  });
});
```

Adapta los nombres a la fábrica que ya exista en ese archivo; si `crearServicio` no devuelve el doble
de `PagosService`, añádelo igual que se hizo con `horarios` en `turnos.service.spec.ts` en la Fase 4:

```ts
  const pagos = {
    perfilesAlDia: jest.fn().mockResolvedValue(new Set<string>()),
    perfilAlDia: jest.fn().mockResolvedValue(false),
    fijarEstado: jest.fn().mockResolvedValue(undefined),
  };
```

y pásalo como tercer argumento del constructor.

- [ ] **Step 3: El servicio deriva**

En `apps/api/src/usuarios/usuarios.service.ts`:

Inyecta el servicio de pagos:

```ts
import { PagosService } from '../pagos/pagos.service';
```

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly historial: HistorialService,
    private readonly pagos: PagosService,
  ) {}
```

En `listar`, sustituye el `return` final:

```ts
    const datos = filas
      .map((fila) => aplanar(fila as UsuarioConRelaciones))
      .filter((d): d is NonNullable<typeof d> => d !== null);

    // UNA consulta para los N perfiles de la pagina, no una por alumno.
    const alDia = await this.pagos.perfilesAlDia(
      this.prisma.db,
      datos.map((d) => d.perfil.id),
    );

    return datos.map((d) => aUsuarioResumen(d, alDia.has(d.perfil.id)));
```

En `obtener`, donde se llama a `aUsuarioDetalle`, añade el tercer argumento:

```ts
    const alDia = await this.pagos.perfilAlDia(this.prisma.db, datos.perfil.id);
    return aUsuarioDetalle(datos, incluyeFicha, alDia);
```

Haz lo mismo en los demás puntos donde `tsc` señale que falta el argumento — el alta y la
actualización también devuelven detalle.

Y **quita `'pagoAlDia'` de `CAMPOS_DE_ALUMNO`**, y el campo de `DatosDeAlumno`, de `crearAlumno` y de
los dos `perfil.create` / `perfil.update`.

- [ ] **Step 4: Quitar `pagoAlDia` de los DTO**

Borra el bloque de `pagoAlDia` de `apps/api/src/usuarios/dto/crear-alumno.dto.ts` y de
`dto/actualizar-usuario.dto.ts`.

Con `forbidNonWhitelisted` activo, mandarlo pasa a devolver **400**, que es lo correcto: el estado de
pago ya no se declara, se paga.

- [ ] **Step 5: La ruta del override**

En `apps/api/src/usuarios/usuarios.controller.ts`, junto a las demás rutas de `:id`:

```ts
  @Roles('ADMIN_OPERATIVO')
  @Patch(':id/estado-pago')
  fijarEstadoDePago(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
    @Body() dto: EstadoPagoDto,
  ): Promise<UsuarioDetalle> {
    return this.usuarios.fijarEstadoDePago(actor, id, dto);
  }
```

con `import { EstadoPagoDto } from '../pagos/dto/estado-pago.dto';`.

Y en el servicio:

```ts
  /**
   * El override del admin, sobre el USUARIO: la ruta habla de usuarios porque
   * es donde vive el resto de la gestion, pero un pago cuelga del perfil.
   */
  async fijarEstadoDePago(
    actor: JwtPayload,
    id: string,
    dto: EstadoPagoDto,
  ): Promise<UsuarioDetalle> {
    const datos = await this.buscarConRelaciones(id);
    await this.pagos.fijarEstado(actor, datos.perfil.id, dto);

    return await this.obtener(actor, id);
  }
```

En `apps/api/src/usuarios/usuarios.module.ts`, añade `PagosModule` a `imports`.

- [ ] **Step 6: `mi-pack` también deriva**

En `apps/api/src/mi-calendario/mi-pack.service.ts`, inyecta `PagosService` y sustituye la línea:

```ts
      pagoAlDia: await this.pagos.perfilAlDia(this.prisma.db, perfil.id),
```

⚠️ El `await` va **antes** de construir el objeto si el linter se queja de un `await` dentro de un
literal; en ese caso saca la llamada a una constante justo encima del `return`.

En `apps/api/src/mi-calendario/mi-calendario.module.ts`, añade `PagosModule` a `imports`.

- [ ] **Step 7: Correr los unitarios**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec tsc --noEmit
```

Esperado: queda **un solo** error, el de `comprobantes.service.ts`, que cierra la Task 5.

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/usuarios src/mi-calendario --silent
```

Esperado: verde. Si algún test manda `pagoAlDia` en el alta, bórralo de ahí: ese campo ya no existe.

**Mensaje de commit sugerido para Cesar:**

```
refactor(api): el estado de pago se deriva, no se lee de una columna

Los tres sitios que leian perfil.pagoAlDia —el listado, el detalle y
mi-pack del alumno— preguntan ahora por los pagos vigentes. El listado lo
hace con UNA consulta para toda la pagina.

pagoAlDia sale del alta y del PATCH de usuario: el estado de pago ya no
se declara, se paga. Y PATCH /usuarios/:id/estado-pago da el override.
```

---

## Task 5: Aprobar un comprobante crea el pago

**Files:**
- Crear: `apps/api/src/comprobantes/dto/aprobar-comprobante.dto.ts`
- Modificar: `apps/api/src/comprobantes/comprobantes.service.ts`
- Modificar: `apps/api/src/comprobantes/comprobantes.controller.ts`
- Modificar: `apps/api/src/comprobantes/comprobantes.module.ts`
- Test: `apps/api/src/comprobantes/comprobantes.service.spec.ts`

- [ ] **Step 1: El DTO nuevo**

Crear `apps/api/src/comprobantes/dto/aprobar-comprobante.dto.ts`:

```ts
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PATRON_FECHA, type MetodoPago } from '@boxadmin/shared';

const PATRON_MONTO = /^\d{1,8}(\.\d{1,2})?$/;
const METODOS: MetodoPago[] = ['EFECTIVO', 'TRANSFERENCIA', 'CORTESIA', 'OTRO'];

/**
 * Aprobar deja de ser un clic: el admin esta mirando la foto de la
 * transferencia y es el unico que sabe de cuanto era y hasta cuando vale.
 *
 * `rechazar` sigue usando RevisarComprobanteDto, que solo lleva nota: rechazar
 * no mueve dinero.
 */
export class AprobarComprobanteDto {
  @Matches(PATRON_MONTO, {
    message: 'monto debe ser un numero con hasta 2 decimales, como "25000.00"',
  })
  monto!: string;

  @Matches(PATRON_FECHA, { message: 'cubreHasta debe tener formato YYYY-MM-DD' })
  cubreHasta!: string;

  /** Por defecto TRANSFERENCIA, que es lo que un comprobante es casi siempre. */
  @IsOptional()
  @IsIn(METODOS)
  metodo?: MetodoPago;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  nota?: string;
}
```

- [ ] **Step 2: Escribir los tests**

En `apps/api/src/comprobantes/comprobantes.service.spec.ts`, al final:

```ts
describe('ComprobantesService.aprobar y el pago', () => {
  it('crea el pago en la MISMA transaccion que la aprobacion', async () => {
    // Si el pago se creara fuera, un fallo entre las dos escrituras dejaria un
    // comprobante aprobado sin cobro registrado, y nadie lo notaria hasta
    // cuadrar la caja a fin de mes.
    const { servicio, db } = crearServicio();

    await servicio.aprobar(ADMIN, 'comp-1', {
      monto: '25000.00',
      cubreHasta: '2026-09-30',
    });

    expect(db.pago.create).toHaveBeenCalledTimes(1);
    const datos = db.pago.create.mock.calls[0]![0].data;
    expect(datos.monto).toBe('25000.00');
    expect(datos.comprobanteId).toBe('comp-1');
    expect(datos.metodo).toBe('TRANSFERENCIA');
  });

  it('el metodo se puede cambiar', async () => {
    const { servicio, db } = crearServicio();

    await servicio.aprobar(ADMIN, 'comp-1', {
      monto: '25000.00',
      cubreHasta: '2026-09-30',
      metodo: 'EFECTIVO',
    });

    expect(db.pago.create.mock.calls[0]![0].data.metodo).toBe('EFECTIVO');
  });

  it('el pago cubre desde HOY hasta la fecha indicada', async () => {
    const { servicio, db } = crearServicio();

    await servicio.aprobar(ADMIN, 'comp-1', { monto: '1.00', cubreHasta: '2026-09-30' });

    const datos = db.pago.create.mock.calls[0]![0].data;
    expect(datos.cubreHasta).toEqual(new Date('2026-09-30T00:00:00.000Z'));
    expect(datos.cubreDesde).toBeInstanceOf(Date);
  });

  it('rechazar NO crea ningun pago', async () => {
    const { servicio, db } = crearServicio();

    await servicio.rechazar(ADMIN, 'comp-1', 'la foto no se lee');

    expect(db.pago.create).not.toHaveBeenCalled();
  });
});
```

Añade `pago: { create: jest.fn().mockResolvedValue({ id: 'pago-1' }) }` al doble de Prisma de ese
archivo si no lo tiene.

- [ ] **Step 3: Correr y ver fallar**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/comprobantes --silent
```

Esperado: FALLA — `aprobar` no existe con esa firma.

- [ ] **Step 4: Implementar**

En `apps/api/src/comprobantes/comprobantes.service.ts`, sustituye `revisar` por dos métodos con
nombres propios. El cuerpo compartido se queda en un privado:

```ts
  async aprobar(
    actor: JwtPayload,
    id: string,
    dto: AprobarComprobanteDto,
  ): Promise<ComprobantePublico> {
    const cubreHasta = desdeFechaISO(dto.cubreHasta);

    const fila = await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      const existente = await this.exigirRevisable(cliente, id);

      const actualizado = (await cliente.comprobante.update({
        where: { id },
        data: {
          estado: 'APROBADO',
          revisadoPor: actor.sub,
          revisadoEn: new Date(),
          nota: dto.nota ?? null,
        },
      })) as FilaComprobante;

      // El pago nace en la MISMA transaccion. Si naciera fuera, un fallo entre
      // las dos escrituras dejaria un comprobante aprobado sin cobro
      // registrado, y eso no se descubre hasta cuadrar la caja a fin de mes.
      //
      // Aprobar es lo que pone al alumno al dia, y desde la Fase 5A eso no es
      // encender una bandera: es que exista un pago que cubra hoy.
      await cliente.pago.create({
        data: {
          tenantId: actor.tenantId,
          perfilId: existente.perfilId,
          monto: dto.monto,
          metodo: dto.metodo ?? 'TRANSFERENCIA',
          esSena: false,
          cubreDesde: comienzoDeHoyUtc(new Date()),
          cubreHasta,
          comprobanteId: id,
          registradoPor: actor.sub,
          nota: dto.nota ?? null,
        },
      });

      await this.historial.registrar(
        {
          actor,
          entidad: 'Comprobante',
          entidadId: id,
          accion: 'APROBADO',
          detalle: { perfilId: existente.perfilId, monto: dto.monto, nota: dto.nota ?? null },
        },
        cliente,
      );

      return actualizado;
    });

    return this.aPublico(fila, await this.firmarSiHayArchivo(fila));
  }

  async rechazar(
    actor: JwtPayload,
    id: string,
    nota: string | undefined,
  ): Promise<ComprobantePublico> {
    const fila = await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      await this.exigirRevisable(cliente, id);

      const actualizado = (await cliente.comprobante.update({
        where: { id },
        data: {
          estado: 'RECHAZADO',
          revisadoPor: actor.sub,
          revisadoEn: new Date(),
          nota: nota ?? null,
        },
      })) as FilaComprobante;

      await this.historial.registrar(
        { actor, entidad: 'Comprobante', entidadId: id, accion: 'RECHAZADO', detalle: { nota: nota ?? null } },
        cliente,
      );

      return actualizado;
    });

    return this.aPublico(fila, await this.firmarSiHayArchivo(fila));
  }

  /** Las dos comprobaciones que comparten aprobar y rechazar. */
  private async exigirRevisable(
    cliente: ClientePrismaTx,
    id: string,
  ): Promise<FilaComprobante> {
    const existente = (await cliente.comprobante.findFirst({
      where: { id },
    })) as FilaComprobante | null;
    if (!existente) throw new NotFoundException('Comprobante inexistente');
    if (existente.estado !== 'PENDIENTE') {
      throw new ConflictException(`El comprobante ya estaba ${existente.estado.toLowerCase()}`);
    }
    if (existente.subidoEn === null) {
      throw new ConflictException(
        'Este comprobante todavia no tiene archivo: el alumno no termino de subirlo.',
      );
    }

    return existente;
  }
```

Añade `comienzoDeHoyUtc` y `desdeFechaISO` al import de `@boxadmin/shared`, y el import del DTO
nuevo. **Borra el bloque que ponía `pagoAlDia: true`**: ya no existe esa columna.

En el controlador:

```ts
  @Roles('ADMIN_OPERATIVO')
  @Patch(':id/aprobar')
  aprobar(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
    @Body() dto: AprobarComprobanteDto,
  ): Promise<ComprobantePublico> {
    return this.comprobantes.aprobar(actor, id, dto);
  }

  @Roles('ADMIN_OPERATIVO')
  @Patch(':id/rechazar')
  rechazar(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
    @Body() dto: RevisarComprobanteDto,
  ): Promise<ComprobantePublico> {
    return this.comprobantes.rechazar(actor, id, dto.nota);
  }
```

- [ ] **Step 5: Correr todo**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec tsc --noEmit && pnpm test 2>&1 | tail -6
```

Esperado: `tsc` **limpio por primera vez desde la Task 0**. Algún unitario de comprobantes puede
seguir llamando a `revisar`; adáptalo a los nombres nuevos.

**Mensaje de commit sugerido para Cesar:**

```
feat(api): aprobar un comprobante registra el cobro

El admin pone el importe y hasta cuando vale: es el unico que esta
mirando la foto de la transferencia. El pago nace en la MISMA
transaccion que la aprobacion, porque un comprobante aprobado sin cobro
registrado no se descubre hasta cuadrar la caja a fin de mes.

revisar() se parte en aprobar() y rechazar(): ya no hacen lo mismo con un
parametro distinto.
```

---
## Task 6: Los e2e del ciclo completo

**Files:**
- Crear: `apps/api/test/pagos.e2e-spec.ts`
- Modificar: `apps/api/test/selfservice.e2e-spec.ts`

- [ ] **Step 1: Arreglar los tres e2e de la Fase 3A que asumen el contrato viejo**

En `apps/api/test/selfservice.e2e-spec.ts`:

1. En `ciclo completo: crear, SUBIR DE VERDAD, confirmar, aprobar`, el `.send({})` de aprobar pasa a
   llevar cuerpo:

```ts
      const aprobado = await request(servidor)
        .patch(`/comprobantes/${creado.body.comprobante.id}/aprobar`)
        .set('Authorization', `Bearer ${gym.adminToken}`)
        .send({ monto: '25000.00', cubreHasta: '2099-12-31' })
        .expect(200);
```

⚠️ **`cubreHasta` tiene que estar en el futuro**, o el alumno no queda al día y el `expect` de la
línea siguiente falla. Es la diferencia entre la bandera vieja —que no caducaba— y el periodo nuevo.

2. En `aprobar un comprobante sin archivo da 409`, el cuerpo también: el 409 salta después de validar
   el DTO, así que un `.send({})` daría **400** y el test pasaría por el motivo equivocado.

```ts
        .send({ monto: '1.00', cubreHasta: '2099-12-31' })
        .expect(409);
```

3. En `rechazar guarda la nota y NO pone pagoAlDia`, nada cambia en la llamada; el `expect` final
   sigue valiendo porque sin pagos el alumno no está al día.

- [ ] **Step 2: Escribir el e2e de la fase**

Crear `apps/api/test/pagos.e2e-spec.ts`:

```ts
import type { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import {
  crearAlumnoPorInvitacion,
  crearAppDeTest,
  crearGimnasio,
  limpiarBaseDeDatos,
  type EntornoE2E,
  type GimnasioDeTest,
} from './helpers';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Un periodo que no caduca durante la vida del test. */
const FUTURO = '2099-12-31';

describe('Fase 5A — el ciclo de cobro (e2e)', () => {
  let entorno: EntornoE2E;
  let app: INestApplication;
  let servidor: ReturnType<INestApplication['getHttpServer']>;
  let gym: GimnasioDeTest;
  let salaId: string;

  beforeAll(async () => {
    entorno = await crearAppDeTest();
    app = entorno.app;
    servidor = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await limpiarBaseDeDatos(entorno.prisma);
    gym = await crearGimnasio(app, `p5a${Date.now()}`);

    const sala = await request(servidor)
      .post('/salas')
      .set(auth(gym.adminToken))
      .send({ nombre: 'Sala A', cupoBase: 5 })
      .expect(201);
    salaId = sala.body.id;
  });

  async function alumno() {
    return await crearAlumnoPorInvitacion(app, gym, [salaId]);
  }

  async function detalleDe(usuarioId: string) {
    const { body } = await request(servidor)
      .get(`/usuarios/${usuarioId}`)
      .set(auth(gym.adminToken))
      .expect(200);

    return body;
  }

  it('un alumno recien dado de alta NO esta al dia', async () => {
    const a = await alumno();

    expect((await detalleDe(a.usuarioId)).pagoAlDia).toBe(false);
  });

  it('un pago manual sin comprobante lo pone al dia', async () => {
    const a = await alumno();

    const pago = await request(servidor)
      .post('/pagos')
      .set(auth(gym.adminToken))
      .send({
        perfilId: a.perfilId,
        monto: '25000.00',
        metodo: 'EFECTIVO',
        cubreDesde: '2020-01-01',
        cubreHasta: FUTURO,
        nota: 'pago en mano',
      })
      .expect(201);

    // El monto vuelve con dos decimales, como string: es dinero.
    expect(pago.body.monto).toBe('25000.00');
    expect(pago.body.registradoPor).toBe(gym.adminId);
    expect((await detalleDe(a.usuarioId)).pagoAlDia).toBe(true);
  });

  it('el estado tambien sale en el LISTADO, no solo en el detalle', async () => {
    const a = await alumno();
    await request(servidor)
      .post('/pagos')
      .set(auth(gym.adminToken))
      .send({
        perfilId: a.perfilId,
        monto: '1.00',
        metodo: 'EFECTIVO',
        cubreDesde: '2020-01-01',
        cubreHasta: FUTURO,
      })
      .expect(201);

    const { body } = await request(servidor)
      .get('/usuarios')
      .query({ tipo: 'alumno' })
      .set(auth(gym.adminToken))
      .expect(200);

    expect(body.find((u: any) => u.id === a.usuarioId).pagoAlDia).toBe(true);
  });

  it('un pago VENCIDO no pone al dia, sin que nadie toque nada', async () => {
    // El corazon de la fase: el estado caduca solo.
    const a = await alumno();
    await request(servidor)
      .post('/pagos')
      .set(auth(gym.adminToken))
      .send({
        perfilId: a.perfilId,
        monto: '25000.00',
        metodo: 'TRANSFERENCIA',
        cubreDesde: '2020-01-01',
        cubreHasta: '2020-01-31',
      })
      .expect(201);

    expect((await detalleDe(a.usuarioId)).pagoAlDia).toBe(false);
  });

  it('una sena no pone al dia', async () => {
    const a = await alumno();
    await request(servidor)
      .post('/pagos')
      .set(auth(gym.adminToken))
      .send({
        perfilId: a.perfilId,
        monto: '5000.00',
        metodo: 'EFECTIVO',
        cubreDesde: '2020-01-01',
        cubreHasta: FUTURO,
        esSena: true,
      })
      .expect(201);

    expect((await detalleDe(a.usuarioId)).pagoAlDia).toBe(false);
  });

  it('anular un pago lo saca del calculo sin borrar la fila', async () => {
    const a = await alumno();
    const pago = await request(servidor)
      .post('/pagos')
      .set(auth(gym.adminToken))
      .send({
        perfilId: a.perfilId,
        monto: '25000.00',
        metodo: 'EFECTIVO',
        cubreDesde: '2020-01-01',
        cubreHasta: FUTURO,
      })
      .expect(201);
    expect((await detalleDe(a.usuarioId)).pagoAlDia).toBe(true);

    await request(servidor)
      .patch(`/pagos/${pago.body.id}/anular`)
      .set(auth(gym.adminToken))
      .expect(200);

    expect((await detalleDe(a.usuarioId)).pagoAlDia).toBe(false);

    // La fila sigue ahi: es dinero, y borrarla reescribiria la caja.
    const listado = await request(servidor)
      .get('/pagos')
      .query({ perfilId: a.perfilId })
      .set(auth(gym.adminToken))
      .expect(200);
    expect(listado.body).toHaveLength(1);
    expect(listado.body[0].anuladoEn).not.toBeNull();
  });

  it('anular un pago pide ADMIN_SALON, no ADMIN_OPERATIVO', async () => {
    const a = await alumno();
    const pago = await request(servidor)
      .post('/pagos')
      .set(auth(gym.adminToken))
      .send({
        perfilId: a.perfilId,
        monto: '1.00',
        metodo: 'EFECTIVO',
        cubreDesde: '2020-01-01',
        cubreHasta: FUTURO,
      })
      .expect(201);

    // El alumno, que es el rol mas bajo con token, no puede.
    await request(servidor)
      .patch(`/pagos/${pago.body.id}/anular`)
      .set(auth(a.token))
      .expect(403);
  });

  it('la cortesia del admin pone al dia con importe cero', async () => {
    const a = await alumno();

    await request(servidor)
      .patch(`/usuarios/${a.usuarioId}/estado-pago`)
      .set(auth(gym.adminToken))
      .send({ alDia: true, cubreHasta: FUTURO, nota: 'beca' })
      .expect(200);

    expect((await detalleDe(a.usuarioId)).pagoAlDia).toBe(true);

    const { body } = await request(servidor)
      .get('/pagos')
      .query({ perfilId: a.perfilId })
      .set(auth(gym.adminToken))
      .expect(200);
    expect(body[0]).toMatchObject({ monto: '0.00', metodo: 'CORTESIA' });
  });

  it('quitar el estado anula la cortesia y NO el pago real', async () => {
    const a = await alumno();

    await request(servidor)
      .post('/pagos')
      .set(auth(gym.adminToken))
      .send({
        perfilId: a.perfilId,
        monto: '25000.00',
        metodo: 'EFECTIVO',
        cubreDesde: '2020-01-01',
        cubreHasta: FUTURO,
      })
      .expect(201);
    await request(servidor)
      .patch(`/usuarios/${a.usuarioId}/estado-pago`)
      .set(auth(gym.adminToken))
      .send({ alDia: true, cubreHasta: FUTURO })
      .expect(200);

    await request(servidor)
      .patch(`/usuarios/${a.usuarioId}/estado-pago`)
      .set(auth(gym.adminToken))
      .send({ alDia: false })
      .expect(200);

    const { body } = await request(servidor)
      .get('/pagos')
      .query({ perfilId: a.perfilId })
      .set(auth(gym.adminToken))
      .expect(200);

    const cortesia = body.find((p: any) => p.metodo === 'CORTESIA');
    const real = body.find((p: any) => p.metodo === 'EFECTIVO');
    expect(cortesia.anuladoEn).not.toBeNull();
    expect(real.anuladoEn).toBeNull();
    // Y sigue al dia, porque el pago de verdad nunca se toco.
    expect((await detalleDe(a.usuarioId)).pagoAlDia).toBe(true);
  });

  it('el alumno ve su propio estado en mi-pack', async () => {
    const a = await alumno();
    await request(servidor)
      .post('/pagos')
      .set(auth(gym.adminToken))
      .send({
        perfilId: a.perfilId,
        monto: '1.00',
        metodo: 'EFECTIVO',
        cubreDesde: '2020-01-01',
        cubreHasta: FUTURO,
      })
      .expect(201);

    const { body } = await request(servidor).get('/mi-pack').set(auth(a.token)).expect(200);

    expect(body.pagoAlDia).toBe(true);
  });

  it('pagoAlDia ya no se puede declarar en el alta', async () => {
    // forbidNonWhitelisted: mandar un campo que ya no existe es 400, no un
    // campo ignorado en silencio.
    const clave = await request(servidor)
      .post('/invitaciones')
      .set(auth(gym.adminToken))
      .send({ nombre: 'k', salaIds: [salaId] })
      .expect(201);

    await request(servidor)
      .post('/usuarios/alumnos')
      .set(auth(gym.adminToken))
      .send({
        nombreCompleto: 'Quien Sea',
        email: `declara-${Date.now()}@test.io`,
        salaIds: [salaId],
        pagoAlDia: true,
      })
      .expect(400);

    expect(clave.body.codigo).toHaveLength(32);
  });

  it('un pago no se puede enlazar al comprobante de otro alumno', async () => {
    const uno = await alumno();
    const otro = await alumno();

    const comprobante = await request(servidor)
      .post('/comprobantes')
      .set(auth(uno.token))
      .send({ nombreOriginal: 'x.pdf', tipoMime: 'application/pdf' })
      .expect(201);

    await request(servidor)
      .post('/pagos')
      .set(auth(gym.adminToken))
      .send({
        perfilId: otro.perfilId,
        monto: '1.00',
        metodo: 'TRANSFERENCIA',
        cubreDesde: '2020-01-01',
        cubreHasta: FUTURO,
        comprobanteId: comprobante.body.comprobante.id,
      })
      .expect(400);
  });
});
```

- [ ] **Step 3: Correr el e2e de la fase**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec dotenv -e ../../.env.test -- jest --config ./test/jest-e2e.json test/pagos.e2e-spec.ts --runInBand
```

⚠️ **Sin `dotenv` la suite muere con 429**: corre con los límites estrictos del throttler y cada test
crea su gimnasio.

Esperado: 12 en verde.

- [ ] **Step 4: Correr TODOS los e2e**

```bash
cd /d/Dev/box-admin/apps/api && pnpm test:e2e
```

Esperado: los 149 anteriores —con los tres de `selfservice` ya adaptados— más los 12 nuevos.

**Mensaje de commit sugerido para Cesar:**

```
test(api): e2e del ciclo de cobro

El alta sin pagos no esta al dia, un pago manual lo pone, uno vencido
deja de ponerlo sin que nadie toque nada, una sena no cuenta, y anular lo
saca del calculo dejando la fila. La cortesia se anula sin llevarse por
delante el pago real.

Los tres e2e de la Fase 3A que llamaban a aprobar con el cuerpo vacio
pasan a mandar importe y periodo.
```

---

## Task 7: Verificación final, README y tracker

**Files:**
- Modificar: `README.md`
- Modificar: `docs/superpowers/plans/PROGRESO.md`

- [ ] **Step 1: Verificación completa**

```bash
cd /d/Dev/box-admin/packages/shared && pnpm exec jest
cd ../../apps/api && pnpm exec tsc --noEmit && pnpm test && pnpm test:e2e
cd ../web && pnpm typecheck && pnpm test
cd /d/Dev/box-admin && pnpm exec prettier --check "apps/api/src/pagos/**/*.ts" "apps/api/test/pagos.e2e-spec.ts" "packages/shared/src/pagos.contracts.ts" "apps/api/src/comprobantes/dto/aprobar-comprobante.dto.ts"
```

Esperado: todo verde.

⚠️ **La PWA de la 3B no debería notar nada.** Lee `pagoAlDia` de `MiPackPublico`, que sigue
existiendo con el mismo tipo; solo cambió de dónde sale el valor. Si `pnpm typecheck` de `apps/web`
falla, algo se amplió de más.

- [ ] **Step 2: Comprobar el estado de git**

```bash
cd /d/Dev/box-admin && git diff --cached --stat
git status --short | grep -E "node_modules|\.next/|sw\.js" || echo "sin artefactos de build sin seguir"
```

Esperado: índice vacío y ningún artefacto suelto.

- [ ] **Step 3: Recorrer el checklist a mano**

Levanta la base y la API y recorre los seis puntos del §9 de la spec con `curl`. En las cinco fases
anteriores es donde aparecieron las sorpresas que ningún test había visto.

```bash
cd /d/Dev/box-admin && docker compose up -d postgres postgres-test redis
cd apps/api && THROTTLE_AUTH_LIMIT=100000 THROTTLE_GENERAL_LIMIT=100000 pnpm start:dev
```

Comprueba en particular las dos cosas que ningún unitario puede ver:

- Que **el último día del periodo cuenta entero**: un pago con `cubreHasta` = hoy deja al alumno al
  día durante todo el día de hoy, no hasta su medianoche.
- Que **el listado de usuarios no hace N+1**. Con el log de queries de Prisma activo, listar diez
  alumnos tiene que disparar **una** consulta a `pagos`, no diez.

- [ ] **Step 4: Documentar en el README**

Añade una sección "El ciclo de cobro — Fase 5A" antes de `## Tests` con:

- Que la Fase 5 se partió en dos y por qué.
- **Que "al día" se deriva y ya no es una columna**, y qué cuenta como pago válido.
- Que una seña no pone al día — y que esa regla se decidió aquí, no en el PDF.
- Que un pago **se anula, no se borra**, y por qué.
- Que aprobar un comprobante pide importe y periodo, y que el pago nace en la misma transacción.
- Que la cortesía del admin es un pago de importe cero.
- Que `pagoAlDia` ya no se puede mandar en el alta.

- [ ] **Step 5: Actualizar el tracker**

En `docs/superpowers/plans/PROGRESO.md`, añade el bloque de la Fase 5A con el formato de los
anteriores: las 8 tareas marcadas, las tres decisiones cerradas, la tabla del checklist verificada a
mano, **los errores de este plan que encontraste al ejecutarlo** —los hubo en las cinco fases
anteriores, sin excepción— y las trampas de entorno nuevas.

Anota también lo que esta fase deja declarado:

- **La migración borra una columna con datos.** En desarrollo no hay nada que perder; con producción
  haría falta un paso previo que convirtiera cada `pagoAlDia = true` en una cortesía.
- **La seña es una decisión propia**, no del PDF.
- **`GET /pagos` filtra por cuándo entró el dinero**, no por el periodo que cubre. La Fase 6 añadirá
  la otra pregunta si la necesita.
- **Queda la 5B entera**: SMTP cifrado, plantillas, los cuatro jobs y el push.

- [ ] **Step 6: Comprobar el README**

```bash
cd /d/Dev/box-admin && python -c "
import re
d=open('README.md','rb').read()
print('fences:', len(re.findall(rb'(?m)^\`\`\`', d)))
print('CRLF:', d.count(b'\r\n'))
"
```

Esperado: número **par** de bloques de código y **0** CRLF.

**Mensaje de commit sugerido para Cesar:**

```
docs: el ciclo de cobro en el README y el estado en el tracker
```

---

## Verificación del plan contra la spec

| Sección de la spec | Tarea |
|---|---|
| D1 — El pago cubre un periodo | T0 (modelo), T2 (la regla) |
| D2 — `pagoAlDia` se borra; el override es una cortesía | T0 (migración), T3 (`fijarEstado`), T4 (derivar) |
| D3 — El importe lo pone el admin al aprobar | T5 |
| §4 — Modelo de datos | T0 |
| §5 — Cómo se deriva | T2 |
| §5.1 — Sin N+1 | T3 (`perfilesAlDia`), T4 (el listado) |
| §6 — Los cinco endpoints | T3, T4, T5 |
| §6.1 — `POST /pagos` | T3 |
| §6.2 — `PATCH /usuarios/:id/estado-pago` | T3 y T4 |
| §6.3 — `PATCH /comprobantes/:id/aprobar` | T5 |
| §7 — Lo que se rompe | T4 (DTO), T6 (los e2e de la 3A) |
| §8 — Pruebas y mutación | T2, T3, T5, T6 |
| §9 — Checklist de aceptación | T6, T7 (a mano) |
| §10 — Fuera de alcance | T7 (declarado en el tracker) |

### Las dos mutaciones obligatorias

| Qué se muta | Tarea | Test que debe romperse |
|---|---|---|
| `comienzoDeHoyUtc(hoy)` → `hoy` | T2 | `el ULTIMO dia del periodo cuenta ENTERO` |
| Quitar el filtro de `anuladoEn` | T2 | `un pago anulado no cuenta` |

La primera es la que importa: sin normalizar la fecha, el estado se cae todo el último día del
periodo — justo el día en que el alumno se acerca a pagar, y justo el error que ningún test que use
medianoche como "hoy" llegaría a ver.
