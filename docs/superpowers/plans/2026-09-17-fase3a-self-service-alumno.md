# Fase 3A — Self-service del alumno (backend) — Plan de implementación

> **Para agentes ejecutores:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development`
> (recomendado) o `superpowers:executing-plans` para implementar este plan tarea por tarea. Los pasos
> usan sintaxis de checkbox (`- [ ]`) para seguimiento.

**Goal:** Que un alumno complete el ciclo entero contra la API sin que un admin intervenga en el
momento — se auto-registra con una clave de invitación, ve sus clases, reserva y cancela clases
sueltas dentro de las reglas, se anota en lista de espera, y sube un comprobante que el admin
aprueba.

**Architecture:** Se añaden cuatro modelos (`ClaveInvitacion`, `ClaveInvitacionSala`, `ListaEspera`,
`Comprobante`) siguiendo el patrón de FK compuestas por tenant del resto del schema. El corazón es
`DisponibilidadService`, que unifica "lista de espera" y "solo cupos liberados" en un solo estado
consolidado calculado por una **función pura** exhaustivamente testeada, igual que el planificador de
la Fase 2. Los archivos de comprobante salen por un **puerto** `AlmacenDeArchivos` con dos
adaptadores (S3 presignado y disco local firmado con HMAC), de modo que los e2e ejerciten la subida
real sin credenciales.

**Tech Stack:** NestJS 10, TypeScript strict, Prisma 7.10.0 + PostgreSQL 16, Redis 7 + BullMQ 5,
Jest + Supertest, `@nestjs/throttler`, `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`.

**Spec:** `docs/superpowers/specs/2026-09-17-fase3a-self-service-alumno.md`

---

## Reglas de esta casa (leer antes de la Task 1)

Estas no son preferencias: son restricciones del proyecto que ya causaron problemas reales.

1. **NUNCA hagas commit.** Ni `git add`, ni `git commit`, ni `git push`, ni `git stash`, ni
   `git checkout`, ni `git reset`. Los commits los hace Cesar y solo Cesar. Cada tarea termina con un
   **mensaje de commit sugerido** que él usará si quiere. `git status` y `git diff` sí puedes usarlos.
2. **NUNCA ejecutes `pnpm lint`.** El script lleva `--fix` y reformatearía todo el repo, incluido
   código ya commiteado. Para comprobar formato: `pnpm exec prettier --check "<ruta>"`.
3. **NUNCA uses `taskkill` por nombre de proceso** (`/IM node.exe` y similares). Hay una sesión de
   Claude Code viva en esta máquina. Mata solo por PID concreto.
4. **`prisma migrate reset` y `docker compose down -v` requieren permiso explícito de Cesar.** No los
   ejecutes por tu cuenta.
5. **No corras los e2e con la API de desarrollo levantada.** Comparten Redis; el worker de
   `start:dev` roba jobs a los tests y los resuelve contra la base de desarrollo (5434) en vez de la
   de test (5433). El síntoma —"Sala inexistente" en un job recién encolado— no apunta a la causa.
   Esto costó horas en la Fase 2.
6. **Si todo empieza a dar 500 de golpe, comprueba `docker info` antes de buscar el bug en el
   código.** Docker Desktop se cerró solo cuatro veces durante la Fase 2.

---

## Trampas conocidas del entorno

Heredadas de las fases anteriores. Cuestan horas si se descubren de cero.

| Trampa | Qué pasa | Qué hacer |
|---|---|---|
| `pnpm prisma migrate dev -- --name X` | pnpm pasa el `--` literal y Prisma espera en un prompt invisible: el comando cuelga para siempre | Usar la ruta documentada: `migrate diff` + `migrate deploy` (ver Task 2) |
| `migrate dev` con una migración que lleva un aviso | Falla en modo no interactivo sin explicar por qué | Misma ruta: `migrate diff` + `migrate deploy` |
| `findUnique` / `upsert` dentro de contexto de tenant | Lanzan `UnsafeUniqueOperationError` **siempre**. No hay excepción | Usar `findFirst` + `create`/`updateMany` dentro de un `$transaction` |
| Consultas raw dentro de contexto de tenant | Lanzan `RawQueryEnTenantError` | Usar el Client API, o `runUnscoped()` si es deliberadamente global |
| Un modelo nuevo sin clasificar en la extensión | Lanza `ModeloNoClasificadoError` en la primera query | Añadirlo a `MODELOS_CON_TENANT` (Task 2) |
| Conflictos de serialización en Prisma 7 | Llegan como `DriverAdapterError` con `cause.kind === 'TransactionWriteConflict'` y **sin `code`** | Usar `esConflictoDeSerializacion()`, que ya cubre ambas formas |
| Base de test vs. base de desarrollo | Puertos 5433 (test) y 5434 (desarrollo) | `pnpm test:e2e` ya carga `.env.test` por `dotenv-cli` |

---

## Estructura de archivos

### Paquete `packages/shared`

| Archivo | Responsabilidad |
|---|---|
| `src/selfservice.contracts.ts` | **Crear.** Contratos de la fase: disponibilidad, invitaciones, comprobantes, lista de espera, mis clases |
| `src/configuracion.ts` | **Crear.** Resolución en cascada `Sala ?? Tenant ?? sistema`. Función pura |
| `src/disponibilidad.ts` | **Crear.** `calcularDisponibilidad()`: la tabla de decisión, función pura |
| `src/fechas.ts` | **Modificar.** Añadir `instanteDelTurno()` |
| `src/index.ts` | **Modificar.** Reexportar los tres módulos nuevos |

Las tres piezas puras viven en `shared` y no en `apps/api` a propósito: la Fase 3B (el frontend) va a
necesitar `calcularDisponibilidad` para pintar el estado sin ir al servidor, y los tres archivos no
importan nada de Nest ni de Prisma.

### Aplicación `apps/api`

| Archivo | Responsabilidad |
|---|---|
| `prisma/schema.prisma` | **Modificar.** Cuatro modelos nuevos, un enum, campos en `Tenant` y `Perfil` |
| `src/common/tenant/tenant-scoped.extension.ts` | **Modificar.** Clasificar los cuatro modelos nuevos |
| `src/config/validar-entorno.ts` | **Modificar.** `ALMACEN_TIPO` requerido; las de S3 condicionales |
| `src/almacen/almacen.interface.ts` | **Crear.** El puerto `AlmacenDeArchivos` y su token de inyección |
| `src/almacen/almacen-local.ts` | **Crear.** Adaptador de disco con URLs firmadas por HMAC |
| `src/almacen/almacen-s3.ts` | **Crear.** Adaptador S3 presignado |
| `src/almacen/almacen-local.controller.ts` | **Crear.** `PUT`/`GET /archivos-locales/:clave`, públicos y firmados |
| `src/almacen/almacen.module.ts` | **Crear.** Elige el adaptador por `ALMACEN_TIPO` |
| `src/disponibilidad/disponibilidad.service.ts` | **Crear.** Carga los datos y delega en la función pura |
| `src/disponibilidad/disponibilidad.module.ts` | **Crear.** |
| `src/invitaciones/*` | **Crear.** Service, controller, DTOs del CRUD de claves |
| `src/auth/auth.service.ts` | **Modificar.** `autoRegistro()` |
| `src/auth/auth.controller.ts` | **Modificar.** Ruta pública `POST /auth/auto-registro` |
| `src/auth/dto/auto-registro.dto.ts` | **Crear.** |
| `src/usuarios/usuarios.service.ts` | **Modificar.** Filtro `autoRegistrado` |
| `src/mi-calendario/*` | **Crear.** Las seis rutas de self-service del alumno |
| `src/lista-espera/lista-espera.service.ts` | **Crear.** Anotarse, salirse, y `asignarPrimero` |
| `src/reservas/reservas.service.ts` | **Modificar.** `cancelar` pasa a Serializable y dispara la asignación |
| `src/notificaciones/notificaciones.service.ts` | **Crear.** El hook inerte de la Fase 5 |
| `src/comprobantes/*` | **Crear.** Service, controller, DTOs |
| `src/app.module.ts` | **Modificar.** Módulos nuevos y `ThrottlerGuard` como primer `APP_GUARD` |
| `test/helpers.ts` | **Modificar.** TRUNCATE de las tablas nuevas y helpers de alumno |
| `test/selfservice.e2e-spec.ts` | **Crear.** Los e2e de la fase |

Se crea un módulo por responsabilidad, siguiendo el patrón de las fases anteriores. `mi-calendario`
agrupa las seis rutas del alumno porque comparten la misma pregunta —"¿qué puede hacer *este*
alumno?"— y separarlas en seis módulos solo repartiría la misma dependencia seis veces.

---

## Task 0: Spike de riesgo técnico

**Nada de esta tarea se queda en el repo.** Sirve para despejar tres incógnitas antes de escribir
código que dependa de ellas. En la Fase 2 la tarea equivalente ahorró rehacer dos tareas enteras.

Las tres incógnitas:

1. **¿Qué versión de `@nestjs/throttler` sirve con Nest 10?** La v6 exige Nest 11. Instalar la
   equivocada rompe el arranque con un error de peer dependencies que no menciona la versión.
2. **¿En qué orden corren los `APP_GUARD`?** El throttler tiene que ejecutarse **antes** que
   `JwtAuthGuard`, o las rutas públicas quedarían sin freno mientras las privadas lo tienen al revés
   de lo que hace falta.
3. **¿`getSignedUrl` funciona sin red ni credenciales reales?** Si hiciera una llamada de red, los
   tests del adaptador S3 no podrían existir.

**Files:**
- Crear (temporal): `apps/api/src/spike-throttler.ts` — se borra al final de la tarea

- [ ] **Step 1: Instalar las dependencias de la fase**

```bash
cd apps/api
pnpm add @nestjs/throttler@^5 @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

- [ ] **Step 2: Verificar que la versión instalada es compatible con Nest 10**

```bash
cd apps/api
pnpm why @nestjs/throttler
node -e "console.log(require('@nestjs/throttler/package.json').peerDependencies)"
```

Esperado: `peerDependencies` que admitan `@nestjs/common` 10.x. Si dice `^11.0.0`, la instalación
eligió la v6: bajar con `pnpm add @nestjs/throttler@5.2.0` y repetir.

**Anota la versión exacta que quedó.** Se usa en la Task 7.

- [ ] **Step 3: Comprobar el orden de ejecución de los APP_GUARD**

Crear `apps/api/src/spike-throttler.ts`:

```ts
/* SPIKE TEMPORAL — se borra al terminar la Task 0 */
import { CanActivate, ExecutionContext, Injectable, Module } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { Controller, Get } from '@nestjs/common';

const orden: string[] = [];

@Injectable()
class GuardPrimero implements CanActivate {
  canActivate(_ctx: ExecutionContext): boolean {
    orden.push('primero');
    return true;
  }
}

@Injectable()
class GuardSegundo implements CanActivate {
  canActivate(_ctx: ExecutionContext): boolean {
    orden.push('segundo');
    return true;
  }
}

@Controller()
class SpikeController {
  @Get('spike')
  ping(): string[] {
    return orden;
  }
}

@Module({
  controllers: [SpikeController],
  providers: [
    { provide: APP_GUARD, useClass: GuardPrimero },
    { provide: APP_GUARD, useClass: GuardSegundo },
  ],
})
class SpikeModule {}

async function main(): Promise<void> {
  const app = await NestFactory.create(SpikeModule, { logger: false });
  await app.listen(3999);
  const res = await fetch('http://localhost:3999/spike');
  console.log('ORDEN DE GUARDS:', await res.json());
  await app.close();
}

void main();
```

- [ ] **Step 4: Ejecutar el spike de guards**

```bash
cd apps/api
pnpm exec ts-node -r tsconfig-paths/register src/spike-throttler.ts
```

Esperado: `ORDEN DE GUARDS: [ 'primero', 'segundo' ]` — es decir, **los guards corren en el orden en
que se declaran en el array `providers`**.

**Si sale al revés**, anótalo: en la Task 7 el `ThrottlerGuard` habrá que ponerlo al final del array
en vez de al principio. Lo que importa es el hecho verificado, no la suposición.

- [ ] **Step 5: Comprobar que `getSignedUrl` no necesita red**

Reemplazar el contenido de `apps/api/src/spike-throttler.ts` por:

```ts
/* SPIKE TEMPORAL — se borra al terminar la Task 0 */
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

async function main(): Promise<void> {
  const cliente = new S3Client({
    region: 'us-east-1',
    endpoint: 'https://s3.example.invalid',
    forcePathStyle: true,
    credentials: { accessKeyId: 'clave-falsa', secretAccessKey: 'secreto-falso' },
  });

  const inicio = Date.now();
  const url = await getSignedUrl(
    cliente,
    new PutObjectCommand({ Bucket: 'bucket-falso', Key: 'prueba.pdf', ContentType: 'application/pdf' }),
    { expiresIn: 300 },
  );
  console.log('TARDO_MS:', Date.now() - inicio);
  console.log('URL:', url.slice(0, 120));
  console.log('TIENE_FIRMA:', url.includes('X-Amz-Signature'));
}

void main();
```

- [ ] **Step 6: Ejecutar el spike de S3**

```bash
cd apps/api
pnpm exec ts-node src/spike-throttler.ts
```

Esperado: `TARDO_MS` de pocos milisegundos (si fueran segundos, estaría resolviendo DNS contra
`example.invalid`), una URL que empieza por `https://s3.example.invalid/...`, y
`TIENE_FIRMA: true`.

Esto confirma que **la firma es puramente local**: el adaptador S3 se puede testear sin red y sin
credenciales reales.

- [ ] **Step 7: Borrar el spike**

```bash
rm apps/api/src/spike-throttler.ts
cd apps/api && pnpm exec tsc --noEmit
```

Esperado: sin salida (compila limpio).

- [ ] **Step 8: Verificar que el árbol solo tiene cambios de dependencias**

```bash
cd /d/Dev/box-admin && git status --short
```

Esperado: solo `apps/api/package.json` y `pnpm-lock.yaml` modificados. **No hagas commit.**

**Mensaje de commit sugerido para Cesar:**

```
chore(api): dependencias de la Fase 3A (throttler, aws-sdk s3)
```

---

## Task 1: Contratos compartidos

Los tipos que atraviesan toda la fase. Van primero porque las diez tareas siguientes los importan, y
porque definirlos antes obliga a decidir la forma de los datos antes que la implementación.

**Files:**
- Crear: `packages/shared/src/selfservice.contracts.ts`
- Modificar: `packages/shared/src/index.ts`
- Modificar: `packages/shared/src/fechas.ts`
- Test: `packages/shared/src/fechas.spec.ts` (modificar)

- [ ] **Step 1: Escribir el test que falla de `instanteDelTurno`**

Añadir al final de `packages/shared/src/fechas.spec.ts`:

```ts
import { instanteDelTurno } from './fechas';

describe('instanteDelTurno', () => {
  it('combina la fecha del turno con su hora de inicio', () => {
    const fecha = new Date('2099-10-13T00:00:00.000Z');

    expect(instanteDelTurno(fecha, '18:30').toISOString()).toBe('2099-10-13T18:30:00.000Z');
  });

  it('acepta la medianoche', () => {
    const fecha = new Date('2099-10-13T00:00:00.000Z');

    expect(instanteDelTurno(fecha, '00:00').toISOString()).toBe('2099-10-13T00:00:00.000Z');
  });

  it('ignora la hora que traiga el Date de la fecha', () => {
    // Prisma devuelve las columnas @db.Date a medianoche UTC, pero si alguna vez
    // llegara con hora, la hora del turno manda.
    const fecha = new Date('2099-10-13T09:45:00.000Z');

    expect(instanteDelTurno(fecha, '18:00').toISOString()).toBe('2099-10-13T18:00:00.000Z');
  });

  it('rechaza una hora con formato invalido', () => {
    const fecha = new Date('2099-10-13T00:00:00.000Z');

    expect(() => instanteDelTurno(fecha, '25:00')).toThrow(FechaInvalidaError);
    expect(() => instanteDelTurno(fecha, '8:00')).toThrow(FechaInvalidaError);
  });
});
```

`FechaInvalidaError` ya está importado en ese archivo desde la Fase 1; si no lo estuviera, añádelo al
import existente de `./fechas`.

- [ ] **Step 2: Ejecutar el test y verlo fallar**

```bash
cd packages/shared && pnpm exec jest src/fechas.spec.ts -t instanteDelTurno
```

Esperado: FAIL — `instanteDelTurno is not a function`.

- [ ] **Step 3: Implementar `instanteDelTurno`**

Añadir al final de `packages/shared/src/fechas.ts`:

```ts
/**
 * El instante exacto en que empieza un turno, combinando su fecha (columna
 * `@db.Date`, que Prisma devuelve a medianoche UTC) con su `horaInicio` "HH:MM".
 *
 * LIMITACION CONOCIDA, deliberada: `horaInicio` es "hora local del salon" segun
 * el comentario del schema, pero el sistema no almacena la zona horaria de
 * ningun gimnasio. Aqui se interpreta como UTC, que es la misma convencion que
 * usa todo el resto del sistema desde la Fase 1 (fechas de turno, ventanas de
 * pack, generacion de meses). Cambiarlo solo aqui rompería la coherencia; si
 * algun dia se soportan husos, se cambia en todos los sitios a la vez.
 */
export function instanteDelTurno(fecha: Date, hora: string): Date {
  if (!esHoraValida(hora)) {
    throw new FechaInvalidaError(`Hora invalida: ${hora}. Se espera HH:MM en 24 h.`);
  }

  const [horas, minutos] = hora.split(':').map(Number);

  return new Date(
    Date.UTC(
      fecha.getUTCFullYear(),
      fecha.getUTCMonth(),
      fecha.getUTCDate(),
      horas,
      minutos,
      0,
      0,
    ),
  );
}
```

- [ ] **Step 4: Ejecutar el test y verlo pasar**

```bash
cd packages/shared && pnpm exec jest src/fechas.spec.ts -t instanteDelTurno
```

Esperado: PASS, 4 tests.

- [ ] **Step 5: Escribir los contratos de la fase**

Crear `packages/shared/src/selfservice.contracts.ts`:

```ts
import type { OrigenReserva } from './nucleo.contracts';

// ---------------------------------------------------------------------------
// Disponibilidad
// ---------------------------------------------------------------------------

/**
 * El estado consolidado de un TURNO, que unifica en un solo concepto lo que en
 * TurnoFit son dos features separadas y confusas ("lista de espera" y "solo
 * cupos liberados").
 */
export type EstadoDisponibilidad = 'LIBRE' | 'SOLO_ADMIN' | 'LISTA_ESPERA' | 'LLENO';

/** Por que ESTE alumno no puede reservar ESTE turno ahora mismo. */
export type MotivoNoDisponible =
  | 'VENTANA_CERRADA'
  | 'SOLO_CUPOS_LIBERADOS'
  | 'YA_RESERVADO'
  | 'SIN_ACCESO_A_SALA'
  | 'SALA_NO_VISIBLE'
  | 'MES_NO_PUBLICADO';

export interface Disponibilidad {
  turnoId: string;
  /** Situacion del turno, independiente de quien pregunte. */
  estado: EstadoDisponibilidad;
  cupo: number;
  ocupados: number;
  /** Si ESTE alumno puede reservar ahora. */
  puedeReservar: boolean;
  /** El porque de `puedeReservar: false`. Null cuando puede, o cuando el estado ya lo explica. */
  motivo: MotivoNoDisponible | null;
  enListaEspera: boolean;
  /** 1 = el proximo en entrar. Null si no esta anotado. */
  posicionEnLista: number | null;
}

// ---------------------------------------------------------------------------
// Configuracion heredable
// ---------------------------------------------------------------------------

/** La forma que comparten `Sala` y `Tenant`: null = "hereda del siguiente nivel". */
export interface ConfigHeredable {
  minMinutosCancelar: number | null;
  minMinutosAnotarse: number | null;
  listaEsperaHabilitada: boolean | null;
}

/** El resultado de resolver la cascada. Sin nulls: aqui ya hay un valor para todo. */
export interface ConfiguracionEfectiva {
  minMinutosCancelar: number;
  minMinutosAnotarse: number;
  listaEsperaHabilitada: boolean;
}

// ---------------------------------------------------------------------------
// Claves de invitacion
// ---------------------------------------------------------------------------

export interface ClaveInvitacionPublica {
  id: string;
  tenantId: string;
  codigo: string;
  nombre: string;
  activa: boolean;
  /** Null = ilimitada. */
  usosMax: number | null;
  usosActuales: number;
  expiraEn: string | null;
  packId: string | null;
  salaIds: string[];
}

// ---------------------------------------------------------------------------
// Comprobantes
// ---------------------------------------------------------------------------

export type EstadoComprobante = 'PENDIENTE' | 'APROBADO' | 'RECHAZADO';

export interface ComprobantePublico {
  id: string;
  tenantId: string;
  perfilId: string;
  nombreOriginal: string;
  tipoMime: string;
  /** Null mientras el alumno no confirmo la subida. */
  subidoEn: string | null;
  estado: EstadoComprobante;
  revisadoPor: string | null;
  revisadoEn: string | null;
  nota: string | null;
  createdAt: string;
  /** Firmada y de vida corta. Null si todavia no hay archivo. */
  urlDeDescarga: string | null;
}

/** Respuesta del POST: la fila recien creada y donde subir el archivo. */
export interface ComprobanteCreado {
  comprobante: ComprobantePublico;
  urlDeSubida: string;
}

// ---------------------------------------------------------------------------
// Lista de espera
// ---------------------------------------------------------------------------

export interface EntradaListaEspera {
  id: string;
  tenantId: string;
  turnoId: string;
  perfilId: string;
  /** Derivada del orden por (createdAt, id). 1 = el proximo en entrar. */
  posicion: number;
  notificado: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Vistas del alumno
// ---------------------------------------------------------------------------

/** Una clase que el alumno tiene reservada. */
export interface MiClase {
  reservaId: string;
  turnoId: string;
  salaId: string;
  nombre: string;
  /** YYYY-MM-DD */
  fecha: string;
  horaInicio: string;
  horaFin: string;
  origen: OrigenReserva;
  /** Si la ventana de cancelacion sigue abierta. */
  puedeCancelar: boolean;
}

/** Un turno que el alumno podria reservar, con su disponibilidad ya calculada. */
export interface TurnoDisponible {
  turnoId: string;
  salaId: string;
  nombre: string;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  disponibilidad: Disponibilidad;
}
```

- [ ] **Step 6: Reexportar los módulos nuevos**

Modificar `packages/shared/src/index.ts` para que quede:

```ts
export * from './roles';
export * from './auth.contracts';
export * from './fechas';
export * from './calendario';
export * from './configuracion';
export * from './disponibilidad';
export * from './nucleo.contracts';
export * from './recurrencia.contracts';
export * from './selfservice.contracts';
```

`./configuracion` y `./disponibilidad` todavía no existen: se crean en las Tasks 2 y 3. Añadirlos
ahora hará fallar la compilación hasta entonces, así que **crea los dos archivos vacíos con un
`export {};`** para que el paquete compile:

```bash
cd packages/shared
echo "export {};" > src/configuracion.ts
echo "export {};" > src/disponibilidad.ts
```

- [ ] **Step 7: Compilar el paquete compartido**

```bash
cd packages/shared && pnpm build && pnpm exec jest
```

Esperado: compilación limpia y todos los tests del paquete en verde (37 antes de esta tarea, 41
después).

- [ ] **Step 8: Verificar el formato**

```bash
cd /d/Dev/box-admin && pnpm exec prettier --check "packages/shared/src/**/*.ts"
```

Esperado: `All matched files use Prettier code style!`

**Mensaje de commit sugerido para Cesar:**

```
feat(shared): contratos de self-service y instanteDelTurno

Tipos de disponibilidad, invitaciones, comprobantes y lista de espera.
instanteDelTurno combina la fecha @db.Date con la hora "HH:MM" del turno.
```

---
## Task 2: Esquema de base de datos y migración

Cuatro modelos nuevos, un enum, y campos en dos modelos existentes. Todo con FK compuestas por
tenant, que es lo que hace que Postgres rechace físicamente una fila de un gimnasio apuntando a otra
de otro.

**Files:**
- Modificar: `apps/api/prisma/schema.prisma`
- Modificar: `apps/api/src/common/tenant/tenant-scoped.extension.ts`
- Modificar: `apps/api/test/helpers.ts`
- Crear: `apps/api/prisma/migrations/<timestamp>_fase3a_self_service/migration.sql`
- Test: `apps/api/src/common/tenant/tenant-scoped.extension.spec.ts` (modificar)

- [ ] **Step 1: Añadir la configuración heredable a `Tenant`**

En `apps/api/prisma/schema.prisma`, dentro de `model Tenant`, justo antes del bloque de relaciones:

```prisma
  // Configuracion heredable: la Sala manda, y donde la Sala dice null, manda
  // esto. Donde esto tambien dice null, manda el valor del sistema (0 minutos,
  // lista de espera apagada). Ver `resolverConfiguracion` en @boxadmin/shared.
  //
  // NO se agrega `cupoBase` aqui aunque Sala lo tenga: el planificador de la
  // Fase 2 reporta SALA_SIN_CUPO_BASE como conflicto cuando la sala no lo
  // define, y un fallback en el tenant cambiaria ese detector en silencio.
  minMinutosCancelar    Int?
  minMinutosAnotarse    Int?
  listaEsperaHabilitada Boolean?
```

Y añadir a la lista de relaciones de `Tenant`:

```prisma
  clavesInvitacion ClaveInvitacion[]
  comprobantes     Comprobante[]
  listasEspera     ListaEspera[]
```

- [ ] **Step 2: Añadir `autoRegistrado` a `Perfil`**

En `model Perfil`, junto a `pagoAlDia`:

```prisma
  // Marca las altas que entraron por auto-registro, para que el admin las
  // revise. Es una bandeja de auditoria, NO un bloqueo: el alumno queda
  // operativo desde el primer momento, con el pack y las salas que traia su
  // clave de invitacion.
  autoRegistrado Boolean @default(false)
```

Y a sus relaciones:

```prisma
  comprobantes Comprobante[]
  listasEspera ListaEspera[]
```

- [ ] **Step 3: Añadir la relación a `Turno`**

En `model Turno`, junto a `reservas`:

```prisma
  listasEspera ListaEspera[]
```

- [ ] **Step 4: Escribir los cuatro modelos nuevos**

Al final de `apps/api/prisma/schema.prisma`:

```prisma
model ClaveInvitacion {
  // Codigo que un alumno usa para darse de alta solo. Lleva consigo las salas y
  // el pack que recibira, y eso es lo que tapa un agujero del PDF de la fase: un
  // alumno auto-registrado SIN filas en UsuarioSala no podria ver ni reservar
  // nada, porque toda reserva se valida contra esa tabla.
  id       String @id @default(cuid())
  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id])

  // 32 caracteres aleatorios generados por el servidor. El cliente nunca lo
  // propone.
  codigo String
  // Para que el admin reconozca la clave en su listado: "Alumnos de Pilates".
  nombre String
  activa Boolean @default(true)

  usosMax      Int? // null = ilimitada
  usosActuales Int  @default(0)
  expiraEn     DateTime?

  // El pack que recibe el alumno. FK compuesta y OPCIONAL: en Postgres una FK
  // multicolumna usa MATCH SIMPLE, asi que con packId null la comprobacion se
  // omite, igual que en Perfil.pack.
  packId String?
  pack   Pack?   @relation(fields: [tenantId, packId], references: [tenantId, id])

  salas ClaveInvitacionSala[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // Desviacion respecto al PDF, que pedia `codigo String @unique` GLOBAL. Un
  // espacio de nombres global deja que un gimnasio descubra por sondeo si un
  // codigo existe en otro, que es justo lo que todo el aislamiento del schema
  // evita. El auto-registro pide tenantSlug igual que el login, asi que el
  // tenant ya se conoce antes de buscar el codigo.
  @@unique([tenantId, codigo])
  // Destino de la FK compuesta de ClaveInvitacionSala. Ver Usuario.
  @@unique([tenantId, id])
  @@index([tenantId])
  @@map("claves_invitacion")
}

model ClaveInvitacionSala {
  // Salas que otorga una clave (N:M). Mismo patron que UsuarioSala: tenantId
  // propio —sin el, la extension de aislamiento lanzaria
  // CreacionNoPermitidaError en cada alta— y FK compuestas, para que la fila
  // quede atada a su gimnasio por si misma.
  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id])

  claveId String
  clave   ClaveInvitacion @relation(fields: [tenantId, claveId], references: [tenantId, id], onDelete: Cascade)
  salaId  String
  sala    Sala            @relation(fields: [tenantId, salaId], references: [tenantId, id], onDelete: Cascade)

  @@id([claveId, salaId])
  @@index([tenantId])
  @@index([salaId])
  @@map("claves_invitacion_salas")
}

model ListaEspera {
  // Cola de un turno lleno. NO tiene campo `posicion`, a diferencia del PDF: un
  // entero guardado hay que renumerarlo en cada baja y es una carrera en cada
  // alta. La posicion se deriva del orden por (createdAt, id), igual que la
  // Fase 1 derivo el conteo de clases del pack en vez de guardar un contador.
  id       String @id @default(cuid())
  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id])

  turnoId  String
  turno    Turno  @relation(fields: [tenantId, turnoId], references: [tenantId, id], onDelete: Cascade)
  perfilId String
  perfil   Perfil @relation(fields: [tenantId, perfilId], references: [tenantId, id], onDelete: Cascade)

  // Lo escribira el modulo de notificaciones de la Fase 5. Hoy siempre false.
  notificado Boolean @default(false)

  createdAt DateTime @default(now())

  @@unique([tenantId, turnoId, perfilId])
  @@index([tenantId, turnoId])
  @@map("listas_espera")
}

enum EstadoComprobante {
  PENDIENTE
  APROBADO
  RECHAZADO
}

model Comprobante {
  id       String @id @default(cuid())
  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id])
  perfilId String
  perfil   Perfil @relation(fields: [tenantId, perfilId], references: [tenantId, id], onDelete: Cascade)

  // Desviacion respecto al PDF, que guardaba `urlArchivo String`. Guardar una
  // URL es un error: una URL firmada CADUCA, y una permanente obligaria a que
  // el bucket fuera publico. Se guarda la clave dentro del almacen y se firma
  // en el momento de leer.
  claveArchivo   String
  nombreOriginal String
  tipoMime       String
  // Null hasta que el alumno confirma la subida. Ni S3 ni el adaptador local
  // pueden avisar a la API de que el PUT termino, asi que hace falta un paso
  // explicito de confirmacion. Una fila sin confirmar no aparece en el listado
  // del admin: es lo que evita que vea enlaces rotos.
  subidoEn DateTime?

  // Enum y no `String @default("pendiente")` como el PDF: un typo en un string
  // libre es un bug silencioso, y el enum lo convierte en error de compilacion.
  // Mismo criterio que TipoCancelacion en la Fase 1.
  estado EstadoComprobante @default(PENDIENTE)
  // Escalar sin FK, igual que HistorialAccion.usuarioId: es auditoria.
  revisadoPor String?
  revisadoEn  DateTime?
  nota        String?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([tenantId, perfilId])
  @@index([tenantId, estado])
  @@map("comprobantes")
}
```

- [ ] **Step 5: Añadir la relación inversa en `Sala` y `Pack`**

En `model Sala`, junto a las demás relaciones:

```prisma
  clavesInvitacion ClaveInvitacionSala[]
```

En `model Pack`, junto a `perfiles`:

```prisma
  clavesInvitacion ClaveInvitacion[]
```

- [ ] **Step 6: Validar el schema**

```bash
cd apps/api && pnpm exec prisma validate
```

Esperado: `The schema at prisma/schema.prisma is valid 🚀`

Si se queja de que falta un `@@unique` para una FK compuesta, léelo literalmente: Prisma exige que el
destino de una FK multicolumna tenga una restricción única sobre **exactamente** esas columnas.

- [ ] **Step 7: Clasificar los modelos nuevos en la extensión de aislamiento**

Sin esto, la primera query sobre cualquiera de ellos lanza `ModeloNoClasificadoError`. Es
fail-closed funcionando, pero hay que completarlo.

En `apps/api/src/common/tenant/tenant-scoped.extension.ts`, añadir al array `MODELOS_CON_TENANT`:

```ts
  'ClaveInvitacion',
  'ClaveInvitacionSala',
  'ListaEspera',
  'Comprobante',
```

- [ ] **Step 8: Escribir el test que prueba la clasificación**

Añadir a `apps/api/src/common/tenant/tenant-scoped.extension.spec.ts`:

```ts
describe('modelos de la Fase 3A', () => {
  const MODELOS_NUEVOS = [
    'ClaveInvitacion',
    'ClaveInvitacionSala',
    'ListaEspera',
    'Comprobante',
  ] as const;

  it.each(MODELOS_NUEVOS)('a %s se le inyecta el tenantId en el where', (modelo) => {
    const args = runWithTenant('gym-1', () =>
      aplicarScopeDeTenant(modelo, 'findMany', { where: { activa: true } }),
    );

    expect(args).toEqual({ where: { activa: true, tenantId: 'gym-1' } });
  });

  it.each(MODELOS_NUEVOS)('a %s se le rellena el tenantId al crear', (modelo) => {
    const args = runWithTenant('gym-1', () =>
      aplicarScopeDeTenant(modelo, 'create', { data: { nombre: 'x' } }),
    );

    expect(args).toEqual({ data: { nombre: 'x', tenantId: 'gym-1' } });
  });
});
```

Los imports (`runWithTenant`, `aplicarScopeDeTenant`) ya existen en ese archivo desde la Fase 0.

- [ ] **Step 9: Regenerar el cliente de Prisma ANTES de correr los tests**

```bash
cd apps/api && pnpm exec dotenv -e ../../.env -- prisma generate
```

**Este paso es obligatorio aquí y no más abajo.** El spec de la extensión trae, desde la Fase 0, dos
meta-tests que comparan la clasificación contra el **DMMF real de Prisma**: "ningún modelo declarado
falta del esquema" y "todo modelo con columna `tenantId` está en `MODELOS_CON_TENANT`". Con el
cliente sin regenerar, el DMMF todavía no conoce los modelos nuevos y los dos fallan — sin que haya
nada mal en el código.

`prisma generate` no necesita base de datos, así que se puede hacer aquí sin más.

- [ ] **Step 10: Ejecutar el test y verlo pasar**

```bash
cd apps/api && pnpm exec jest src/common/tenant/tenant-scoped.extension.spec.ts
```

Esperado: PASS, 93 tests, incluidos los 8 casos nuevos y los dos meta-tests del DMMF.

- [ ] **Step 10: Generar la migración**

**NO uses `prisma migrate dev`.** Con pnpm, el `--` se pasa literal y Prisma se queda esperando en un
prompt invisible; y además `migrate dev` falla en modo no interactivo cuando la migración lleva un
aviso. La ruta que funciona, verificada en la Fase 2:

```bash
cd apps/api
TS=$(date +%Y%m%d%H%M%S)
mkdir -p "prisma/migrations/${TS}_fase3a_self_service"
pnpm exec dotenv -e ../../.env -- prisma migrate diff \
  --from-config-datasource --to-schema prisma/schema.prisma --script \
  -o "prisma/migrations/${TS}_fase3a_self_service/migration.sql"
cat "prisma/migrations/${TS}_fase3a_self_service/migration.sql"
```

Esperado: SQL con `CREATE TABLE "claves_invitacion"`, `"claves_invitacion_salas"`,
`"listas_espera"`, `"comprobantes"`, `CREATE TYPE "EstadoComprobante"`, y los `ALTER TABLE` de
`tenants` y `perfiles`.

**Lee el SQL antes de aplicarlo.** Comprueba que las FK compuestas aparecen como
`FOREIGN KEY ("tenantId", "salaId") REFERENCES "salas"("tenantId", "id")` y no como FK simples.

- [ ] **Step 11: Aplicar la migración**

```bash
cd apps/api && pnpm exec dotenv -e ../../.env -- prisma migrate deploy
```

Esperado: `X migrations found`, `Applying migration ...`, `All migrations have been successfully applied.`

Si falla con "no se puede conectar", comprueba primero `docker info` y luego que el contenedor de
Postgres esté arriba.

- [ ] **Step 12: Regenerar el cliente de Prisma**

```bash
cd apps/api && pnpm exec dotenv -e ../../.env -- prisma generate
pnpm exec tsc --noEmit
```

Esperado: cliente generado y compilación limpia.

- [ ] **Step 13: Aplicar la migración también a la base de test**

```bash
cd apps/api && pnpm db:test:deploy
```

Esperado: `All migrations have been successfully applied.` sobre la base del puerto 5433.

- [ ] **Step 14: Añadir las tablas nuevas al TRUNCATE de los tests**

En `apps/api/test/helpers.ts`, `limpiarBaseDeDatos` pasa a:

```ts
export async function limpiarBaseDeDatos(prisma: PrismaService): Promise<void> {
  await prisma.base.$executeRawUnsafe(
    'TRUNCATE TABLE ' +
      '"comprobantes", "listas_espera", "claves_invitacion_salas", "claves_invitacion", ' +
      '"rutinas_fijas", "meses_calendario", "vacaciones_alumnos", "ausencias", ' +
      '"reservas", "usuarios_salas", "turnos", "perfiles", "packs", "salas", ' +
      '"refresh_tokens", "usuarios", "historial_acciones", "tenants" ' +
      'RESTART IDENTITY CASCADE',
  );
}
```

- [ ] **Step 15: Verificar que no se rompió nada**

```bash
cd apps/api && pnpm test
```

Esperado: los 426 tests unitarios de antes siguen en verde, más los 8 nuevos de la extensión.

```bash
cd apps/api && pnpm test:e2e
```

Esperado: 79/79. **Acuérdate de que la API de desarrollo no puede estar levantada** (regla 5).

- [ ] **Step 16: Verificar migraciones y formato**

```bash
cd apps/api && pnpm exec dotenv -e ../../.env -- prisma migrate status
cd /d/Dev/box-admin && pnpm exec prettier --check "apps/api/src/common/tenant/*.ts" "apps/api/test/helpers.ts"
```

Esperado: `Database schema is up to date!` y `All matched files use Prettier code style!`

**Mensaje de commit sugerido para Cesar:**

```
feat(api): esquema de la Fase 3A

ClaveInvitacion, ClaveInvitacionSala, ListaEspera y Comprobante, todos con
FK compuestas por tenant. Configuracion heredable en Tenant y autoRegistrado
en Perfil. Tres desviaciones del PDF documentadas en el schema: codigo unico
por tenant y no global, claveArchivo en vez de urlArchivo, y ListaEspera sin
campo posicion.
```

---

## Task 3: Resolución de la configuración en cascada

Una función pura, y una trampa de JavaScript que merece su propio test.

**Files:**
- Modificar: `packages/shared/src/configuracion.ts` (hoy contiene `export {};`)
- Test: `packages/shared/src/configuracion.spec.ts` (crear)

- [ ] **Step 1: Escribir los tests que fallan**

Crear `packages/shared/src/configuracion.spec.ts`:

```ts
import { CONFIG_DEL_SISTEMA, resolverConfiguracion } from './configuracion';
import type { ConfigHeredable } from './selfservice.contracts';

const TODO_NULL: ConfigHeredable = {
  minMinutosCancelar: null,
  minMinutosAnotarse: null,
  listaEsperaHabilitada: null,
};

describe('resolverConfiguracion', () => {
  it('la sala manda sobre el tenant', () => {
    const sala: ConfigHeredable = {
      minMinutosCancelar: 120,
      minMinutosAnotarse: 30,
      listaEsperaHabilitada: true,
    };
    const tenant: ConfigHeredable = {
      minMinutosCancelar: 999,
      minMinutosAnotarse: 999,
      listaEsperaHabilitada: false,
    };

    expect(resolverConfiguracion(sala, tenant)).toEqual({
      minMinutosCancelar: 120,
      minMinutosAnotarse: 30,
      listaEsperaHabilitada: true,
    });
  });

  it('con la sala en null hereda del tenant, campo por campo', () => {
    const sala: ConfigHeredable = {
      minMinutosCancelar: null,
      minMinutosAnotarse: 15,
      listaEsperaHabilitada: null,
    };
    const tenant: ConfigHeredable = {
      minMinutosCancelar: 240,
      minMinutosAnotarse: 999,
      listaEsperaHabilitada: true,
    };

    expect(resolverConfiguracion(sala, tenant)).toEqual({
      // De tenant: la sala no opina.
      minMinutosCancelar: 240,
      // De sala: la sala opina, aunque el tenant tambien.
      minMinutosAnotarse: 15,
      listaEsperaHabilitada: true,
    });
  });

  it('con sala y tenant en null cae al valor del sistema', () => {
    expect(resolverConfiguracion(TODO_NULL, TODO_NULL)).toEqual(CONFIG_DEL_SISTEMA);
  });

  it('el valor del sistema es sin ventana y sin lista de espera', () => {
    expect(CONFIG_DEL_SISTEMA).toEqual({
      minMinutosCancelar: 0,
      minMinutosAnotarse: 0,
      listaEsperaHabilitada: false,
    });
  });

  // Este test existe por una razon concreta: con `||` en vez de `??`, un cero
  // configurado a proposito en la sala ("sin ventana en esta sala, aunque el
  // tenant tenga dos horas") se caeria al valor del tenant. Es el bug clasico
  // de esta forma de codigo y no lo veria nadie hasta que un alumno se quejara.
  it('un cero explicito en la sala NO se cae al tenant', () => {
    const sala: ConfigHeredable = {
      minMinutosCancelar: 0,
      minMinutosAnotarse: 0,
      listaEsperaHabilitada: null,
    };
    const tenant: ConfigHeredable = {
      minMinutosCancelar: 240,
      minMinutosAnotarse: 180,
      listaEsperaHabilitada: null,
    };

    expect(resolverConfiguracion(sala, tenant)).toEqual({
      minMinutosCancelar: 0,
      minMinutosAnotarse: 0,
      listaEsperaHabilitada: false,
    });
  });

  // Mismo razonamiento con el booleano: `false` es un valor, no una ausencia.
  it('un false explicito en la sala NO se cae al tenant', () => {
    const sala: ConfigHeredable = { ...TODO_NULL, listaEsperaHabilitada: false };
    const tenant: ConfigHeredable = { ...TODO_NULL, listaEsperaHabilitada: true };

    expect(resolverConfiguracion(sala, tenant).listaEsperaHabilitada).toBe(false);
  });
});
```

- [ ] **Step 2: Ejecutar los tests y verlos fallar**

```bash
cd packages/shared && pnpm exec jest src/configuracion.spec.ts
```

Esperado: FAIL — `resolverConfiguracion is not a function`.

- [ ] **Step 3: Implementar la cascada**

Reemplazar el contenido de `packages/shared/src/configuracion.ts`:

```ts
import type { ConfigHeredable, ConfiguracionEfectiva } from './selfservice.contracts';

/**
 * El ultimo escalon de la cascada: lo que rige cuando ni la sala ni el gimnasio
 * dicen nada. Sin ventanas (se puede reservar y cancelar hasta el ultimo
 * segundo) y sin lista de espera.
 *
 * Los dos valores son los conservadores: una ventana inventada rechazaria
 * operaciones legitimas, y una lista de espera encendida por defecto crearia
 * reservas que nadie pidio.
 */
export const CONFIG_DEL_SISTEMA: ConfiguracionEfectiva = {
  minMinutosCancelar: 0,
  minMinutosAnotarse: 0,
  listaEsperaHabilitada: false,
};

/**
 * Resuelve la cascada `Sala ?? Tenant ?? sistema`, campo por campo.
 *
 * OJO: `??` y no `||`. Son distintos y aqui la diferencia es un bug de negocio:
 * `0` y `false` son valores configurados a proposito ("en esta sala no hay
 * ventana", "en esta sala no hay lista de espera"), no ausencias. Con `||` se
 * caerian al nivel siguiente y la configuracion explicita de la sala se
 * ignoraria en silencio.
 */
export function resolverConfiguracion(
  sala: ConfigHeredable,
  tenant: ConfigHeredable,
): ConfiguracionEfectiva {
  return {
    minMinutosCancelar:
      sala.minMinutosCancelar ?? tenant.minMinutosCancelar ?? CONFIG_DEL_SISTEMA.minMinutosCancelar,
    minMinutosAnotarse:
      sala.minMinutosAnotarse ?? tenant.minMinutosAnotarse ?? CONFIG_DEL_SISTEMA.minMinutosAnotarse,
    listaEsperaHabilitada:
      sala.listaEsperaHabilitada ??
      tenant.listaEsperaHabilitada ??
      CONFIG_DEL_SISTEMA.listaEsperaHabilitada,
  };
}
```

- [ ] **Step 4: Ejecutar los tests y verlos pasar**

```bash
cd packages/shared && pnpm exec jest src/configuracion.spec.ts
```

Esperado: PASS, 6 tests.

- [ ] **Step 5: Verificar que el test del cero muerde**

Prueba de mutación: cambia temporalmente los tres `??` por `||` en `configuracion.ts` y vuelve a
correr.

```bash
cd packages/shared && pnpm exec jest src/configuracion.spec.ts
```

Esperado: **FAIL** en "un cero explicito en la sala NO se cae al tenant" y en "un false explicito...".
Si pasaran en verde, los tests no valen nada y hay que arreglarlos.

**Revierte la mutación** y confirma que vuelven a pasar.

- [ ] **Step 6: Compilar y comprobar formato**

```bash
cd packages/shared && pnpm build && pnpm exec jest
cd /d/Dev/box-admin && pnpm exec prettier --check "packages/shared/src/**/*.ts"
```

Esperado: compilación limpia, todos los tests en verde, formato correcto.

**Mensaje de commit sugerido para Cesar:**

```
feat(shared): resolucion en cascada de la configuracion

Sala ?? Tenant ?? sistema, campo por campo. Con `??` y no `||`: un cero o un
false configurados a proposito son valores, no ausencias.
```

---
## Task 4: `calcularDisponibilidad` — la tabla de decisión

El corazón de la fase. Es una **función pura**, como el planificador de la Fase 2, por la misma
razón: se puede probar exhaustivamente sin base de datos, y ahí es donde un caso olvidado se traduce
en un alumno que no puede reservar sin saber por qué.

**Files:**
- Modificar: `packages/shared/src/disponibilidad.ts` (hoy contiene `export {};`)
- Test: `packages/shared/src/disponibilidad.spec.ts` (crear)

### El orden importa

`estado` describe el **turno**; `puedeReservar` + `motivo` describen a **este alumno**. Son dos ejes
distintos y mezclarlos es el error que hace que un contrato así se vuelva inservible.

El `motivo` se resuelve con el primer criterio que se cumpla, en este orden exacto:

| # | Criterio | Motivo |
|---|---|---|
| 1 | El alumno no tiene la sala asignada | `SIN_ACCESO_A_SALA` |
| 2 | La sala está de baja o no es visible para alumnos | `SALA_NO_VISIBLE` |
| 3 | El mes no está publicado | `MES_NO_PUBLICADO` |
| 4 | Ya tiene una reserva activa en ese turno | `YA_RESERVADO` |
| 5 | La ventana de anotación ya cerró | `VENTANA_CERRADA` |
| 6 | La sala es `soloCuposLiberados` y nadie canceló todavía | `SOLO_CUPOS_LIBERADOS` |
| 7 | El turno está `LLENO` o en `LISTA_ESPERA` | `null` — el estado ya lo explica |

El orden va de lo más general a lo más específico a propósito: a un alumno que ni siquiera tiene la
sala asignada no le sirve que le digan "la ventana cerró".

- [ ] **Step 1: Escribir los tests que fallan**

Crear `packages/shared/src/disponibilidad.spec.ts`:

```ts
import { calcularDisponibilidad, type EntradaDisponibilidad } from './disponibilidad';

const AHORA = new Date('2099-10-01T10:00:00.000Z');
/** El turno empieza 24 h despues de AHORA. */
const FECHA_TURNO = new Date('2099-10-02T00:00:00.000Z');

function entrada(cambios: Partial<EntradaDisponibilidad> = {}): EntradaDisponibilidad {
  return {
    turno: {
      id: 'turno-1',
      salaId: 'sala-1',
      fecha: FECHA_TURNO,
      horaInicio: '10:00',
      cupo: 5,
    },
    sala: { activa: true, visibleAlumnos: true, soloCuposLiberados: false },
    config: { minMinutosCancelar: 0, minMinutosAnotarse: 0, listaEsperaHabilitada: false },
    ocupados: 0,
    huboCancelaciones: false,
    mesPublicado: true,
    tieneAccesoASala: true,
    yaReservado: false,
    enListaEspera: false,
    posicionEnLista: null,
    ahora: AHORA,
    ...cambios,
  };
}

describe('calcularDisponibilidad — estado del turno', () => {
  it('con cupo libre el turno esta LIBRE', () => {
    const d = calcularDisponibilidad(entrada({ ocupados: 3 }));

    expect(d.estado).toBe('LIBRE');
    expect(d.puedeReservar).toBe(true);
    expect(d.motivo).toBeNull();
    expect(d).toMatchObject({ turnoId: 'turno-1', cupo: 5, ocupados: 3 });
  });

  it('sin cupo y sin lista de espera el turno esta LLENO', () => {
    const d = calcularDisponibilidad(entrada({ ocupados: 5 }));

    expect(d.estado).toBe('LLENO');
    expect(d.puedeReservar).toBe(false);
    // El estado ya dice todo lo que hay que decir.
    expect(d.motivo).toBeNull();
  });

  it('sin cupo y con lista de espera habilitada el turno esta en LISTA_ESPERA', () => {
    const d = calcularDisponibilidad(
      entrada({
        ocupados: 5,
        config: { minMinutosCancelar: 0, minMinutosAnotarse: 0, listaEsperaHabilitada: true },
      }),
    );

    expect(d.estado).toBe('LISTA_ESPERA');
    expect(d.puedeReservar).toBe(false);
    expect(d.motivo).toBeNull();
  });

  it('mas ocupados que cupo sigue siendo LLENO, no negativo', () => {
    // Puede pasar si un admin baja el cupo de un turno que ya tenia reservas.
    const d = calcularDisponibilidad(entrada({ ocupados: 8, turno: { ...entrada().turno, cupo: 5 } }));

    expect(d.estado).toBe('LLENO');
    expect(d.ocupados).toBe(8);
  });
});

describe('calcularDisponibilidad — solo cupos liberados', () => {
  const SOLO_LIBERADOS = { activa: true, visibleAlumnos: true, soloCuposLiberados: true };

  it('con cupo original y sin cancelaciones el turno es SOLO_ADMIN', () => {
    const d = calcularDisponibilidad(
      entrada({ sala: SOLO_LIBERADOS, ocupados: 2, huboCancelaciones: false }),
    );

    expect(d.estado).toBe('SOLO_ADMIN');
    expect(d.puedeReservar).toBe(false);
    expect(d.motivo).toBe('SOLO_CUPOS_LIBERADOS');
  });

  it('en cuanto alguien cancela, el turno pasa a LIBRE', () => {
    const d = calcularDisponibilidad(
      entrada({ sala: SOLO_LIBERADOS, ocupados: 2, huboCancelaciones: true }),
    );

    expect(d.estado).toBe('LIBRE');
    expect(d.puedeReservar).toBe(true);
    expect(d.motivo).toBeNull();
  });

  it('sin cupo sigue mandando el cupo, no el flag', () => {
    const d = calcularDisponibilidad(
      entrada({ sala: SOLO_LIBERADOS, ocupados: 5, huboCancelaciones: false }),
    );

    expect(d.estado).toBe('LLENO');
  });
});

describe('calcularDisponibilidad — ventana de anotacion', () => {
  it('dentro de la ventana puede reservar', () => {
    // Faltan 24 h y la ventana pide 120 minutos.
    const d = calcularDisponibilidad(
      entrada({
        config: { minMinutosCancelar: 0, minMinutosAnotarse: 120, listaEsperaHabilitada: false },
      }),
    );

    expect(d.puedeReservar).toBe(true);
    expect(d.motivo).toBeNull();
  });

  it('fuera de la ventana el turno sigue LIBRE pero el alumno no puede', () => {
    // Faltan 24 h = 1440 minutos, y la ventana pide 2000.
    const d = calcularDisponibilidad(
      entrada({
        config: { minMinutosCancelar: 0, minMinutosAnotarse: 2000, listaEsperaHabilitada: false },
      }),
    );

    // El turno tiene cupo: el estado no miente por culpa de QUIEN pregunta.
    expect(d.estado).toBe('LIBRE');
    expect(d.puedeReservar).toBe(false);
    expect(d.motivo).toBe('VENTANA_CERRADA');
  });

  it('justo en el limite de la ventana todavia puede', () => {
    // El turno empieza a las 10:00 del dia 2; AHORA son las 10:00 del dia 1.
    // Faltan exactamente 1440 minutos.
    const d = calcularDisponibilidad(
      entrada({
        config: { minMinutosCancelar: 0, minMinutosAnotarse: 1440, listaEsperaHabilitada: false },
      }),
    );

    expect(d.puedeReservar).toBe(true);
  });

  it('un turno que ya empezo tiene la ventana cerrada aunque no haya ventana configurada', () => {
    const d = calcularDisponibilidad(
      entrada({ ahora: new Date('2099-10-02T11:00:00.000Z') }),
    );

    expect(d.puedeReservar).toBe(false);
    expect(d.motivo).toBe('VENTANA_CERRADA');
  });
});

describe('calcularDisponibilidad — bloqueos del alumno', () => {
  it('sin acceso a la sala', () => {
    const d = calcularDisponibilidad(entrada({ tieneAccesoASala: false }));

    expect(d.puedeReservar).toBe(false);
    expect(d.motivo).toBe('SIN_ACCESO_A_SALA');
  });

  it('sala dada de baja', () => {
    const d = calcularDisponibilidad(
      entrada({ sala: { activa: false, visibleAlumnos: true, soloCuposLiberados: false } }),
    );

    expect(d.motivo).toBe('SALA_NO_VISIBLE');
  });

  it('sala oculta a los alumnos', () => {
    const d = calcularDisponibilidad(
      entrada({ sala: { activa: true, visibleAlumnos: false, soloCuposLiberados: false } }),
    );

    expect(d.motivo).toBe('SALA_NO_VISIBLE');
  });

  it('mes sin publicar', () => {
    const d = calcularDisponibilidad(entrada({ mesPublicado: false }));

    expect(d.puedeReservar).toBe(false);
    expect(d.motivo).toBe('MES_NO_PUBLICADO');
  });

  it('ya tiene reserva activa en ese turno', () => {
    const d = calcularDisponibilidad(entrada({ yaReservado: true }));

    expect(d.puedeReservar).toBe(false);
    expect(d.motivo).toBe('YA_RESERVADO');
  });
});

describe('calcularDisponibilidad — precedencia de los motivos', () => {
  // Un alumno al que le faltan cuatro cosas tiene que oir la mas general
  // primero: decirle "la ventana cerro" cuando ni siquiera tiene la sala
  // asignada lo manda a resolver el problema equivocado.
  it('sin acceso a la sala gana a todo lo demas', () => {
    const d = calcularDisponibilidad(
      entrada({
        tieneAccesoASala: false,
        sala: { activa: false, visibleAlumnos: false, soloCuposLiberados: true },
        mesPublicado: false,
        yaReservado: true,
        config: { minMinutosCancelar: 0, minMinutosAnotarse: 9999, listaEsperaHabilitada: false },
      }),
    );

    expect(d.motivo).toBe('SIN_ACCESO_A_SALA');
  });

  it('la sala invisible gana al mes sin publicar', () => {
    const d = calcularDisponibilidad(
      entrada({
        sala: { activa: true, visibleAlumnos: false, soloCuposLiberados: false },
        mesPublicado: false,
      }),
    );

    expect(d.motivo).toBe('SALA_NO_VISIBLE');
  });

  it('el mes sin publicar gana a ya reservado', () => {
    const d = calcularDisponibilidad(entrada({ mesPublicado: false, yaReservado: true }));

    expect(d.motivo).toBe('MES_NO_PUBLICADO');
  });

  it('ya reservado gana a la ventana cerrada', () => {
    const d = calcularDisponibilidad(
      entrada({
        yaReservado: true,
        config: { minMinutosCancelar: 0, minMinutosAnotarse: 9999, listaEsperaHabilitada: false },
      }),
    );

    expect(d.motivo).toBe('YA_RESERVADO');
  });

  it('la ventana cerrada gana a solo cupos liberados', () => {
    const d = calcularDisponibilidad(
      entrada({
        sala: { activa: true, visibleAlumnos: true, soloCuposLiberados: true },
        huboCancelaciones: false,
        config: { minMinutosCancelar: 0, minMinutosAnotarse: 9999, listaEsperaHabilitada: false },
      }),
    );

    expect(d.motivo).toBe('VENTANA_CERRADA');
  });
});

describe('calcularDisponibilidad — lista de espera del alumno', () => {
  it('refleja que el alumno esta anotado y en que puesto', () => {
    const d = calcularDisponibilidad(
      entrada({
        ocupados: 5,
        enListaEspera: true,
        posicionEnLista: 2,
        config: { minMinutosCancelar: 0, minMinutosAnotarse: 0, listaEsperaHabilitada: true },
      }),
    );

    expect(d).toMatchObject({ estado: 'LISTA_ESPERA', enListaEspera: true, posicionEnLista: 2 });
  });

  it('sin anotarse, la posicion es null', () => {
    const d = calcularDisponibilidad(entrada());

    expect(d.enListaEspera).toBe(false);
    expect(d.posicionEnLista).toBeNull();
  });
});
```

- [ ] **Step 2: Ejecutar los tests y verlos fallar**

```bash
cd packages/shared && pnpm exec jest src/disponibilidad.spec.ts
```

Esperado: FAIL — `calcularDisponibilidad is not a function`.

- [ ] **Step 3: Implementar la función pura**

Reemplazar el contenido de `packages/shared/src/disponibilidad.ts`:

```ts
import { instanteDelTurno } from './fechas';
import type {
  ConfiguracionEfectiva,
  Disponibilidad,
  EstadoDisponibilidad,
  MotivoNoDisponible,
} from './selfservice.contracts';

/**
 * Todo lo que hace falta para decidir, ya cargado. La funcion es pura: no lee
 * la base ni el reloj —`ahora` entra como parametro— para que la tabla de
 * decision se pueda probar entera sin levantar nada.
 */
export interface EntradaDisponibilidad {
  turno: {
    id: string;
    salaId: string;
    /** Columna @db.Date: Prisma la devuelve a medianoche UTC. */
    fecha: Date;
    horaInicio: string;
    cupo: number;
  };
  sala: {
    activa: boolean;
    visibleAlumnos: boolean;
    soloCuposLiberados: boolean;
  };
  /** Ya resuelta por `resolverConfiguracion`. */
  config: ConfiguracionEfectiva;
  /** Reservas activas del turno. */
  ocupados: number;
  /** Si el turno tiene alguna reserva cancelada: es lo que hace "liberado" a un cupo. */
  huboCancelaciones: boolean;
  mesPublicado: boolean;
  tieneAccesoASala: boolean;
  yaReservado: boolean;
  enListaEspera: boolean;
  posicionEnLista: number | null;
  ahora: Date;
}

/**
 * El estado consolidado de un turno para un alumno concreto.
 *
 * Dos ejes distintos, deliberadamente separados:
 *
 * - `estado` describe el TURNO y no depende de quien pregunte. Un turno con
 *   cupo esta LIBRE aunque el alumno que mira no pueda tomarlo.
 * - `puedeReservar` y `motivo` describen a ESTE alumno AHORA.
 *
 * Mezclarlos —hacer que el estado cambiara segun quien pregunta— haria el
 * contrato inservible para el frontend, que necesita pintar el turno y el boton
 * por separado.
 */
export function calcularDisponibilidad(entrada: EntradaDisponibilidad): Disponibilidad {
  const estado = estadoDelTurno(entrada);
  const motivo = motivoDelAlumno(entrada, estado);

  return {
    turnoId: entrada.turno.id,
    estado,
    cupo: entrada.turno.cupo,
    ocupados: entrada.ocupados,
    puedeReservar: motivo === null && estado === 'LIBRE',
    motivo,
    enListaEspera: entrada.enListaEspera,
    posicionEnLista: entrada.enListaEspera ? entrada.posicionEnLista : null,
  };
}

function estadoDelTurno(e: EntradaDisponibilidad): EstadoDisponibilidad {
  // `>=` y no `===`: si un admin baja el cupo de un turno que ya tenia mas
  // reservas, `ocupados` puede superar al cupo y el turno sigue lleno.
  if (e.ocupados >= e.turno.cupo) {
    return e.config.listaEsperaHabilitada ? 'LISTA_ESPERA' : 'LLENO';
  }

  // "Solo cupos liberados": el alumno solo puede tomar lugares que alguien
  // solto, no lugares originales. Es derivable de que exista alguna reserva
  // cancelada en el turno, asi que no hace falta ninguna columna nueva.
  if (e.sala.soloCuposLiberados && !e.huboCancelaciones) return 'SOLO_ADMIN';

  return 'LIBRE';
}

/**
 * El primer criterio que se cumpla gana, de lo mas general a lo mas especifico.
 * A un alumno que ni siquiera tiene la sala asignada no le sirve que le digan
 * "la ventana cerro": lo mandaria a resolver el problema equivocado.
 */
function motivoDelAlumno(
  e: EntradaDisponibilidad,
  estado: EstadoDisponibilidad,
): MotivoNoDisponible | null {
  if (!e.tieneAccesoASala) return 'SIN_ACCESO_A_SALA';
  if (!e.sala.activa || !e.sala.visibleAlumnos) return 'SALA_NO_VISIBLE';
  if (!e.mesPublicado) return 'MES_NO_PUBLICADO';
  if (e.yaReservado) return 'YA_RESERVADO';
  if (ventanaCerrada(e)) return 'VENTANA_CERRADA';
  if (estado === 'SOLO_ADMIN') return 'SOLO_CUPOS_LIBERADOS';

  // LLENO y LISTA_ESPERA no necesitan motivo: el estado ya lo dice, y repetirlo
  // obligaria al frontend a mirar dos campos para decir lo mismo.
  return null;
}

/**
 * La ventana se mide contra el comienzo del turno. Un turno que ya empezo tiene
 * la ventana cerrada aunque no haya ninguna configurada: con
 * `minMinutosAnotarse: 0` el limite es el propio comienzo.
 */
function ventanaCerrada(e: EntradaDisponibilidad): boolean {
  const comienzo = instanteDelTurno(e.turno.fecha, e.turno.horaInicio);
  const limite = comienzo.getTime() - e.config.minMinutosAnotarse * 60_000;

  return e.ahora.getTime() > limite;
}

/**
 * La misma regla, aplicada a la cancelacion. Vive aqui y no en el servicio para
 * que el frontend de la Fase 3B pueda apagar el boton sin preguntar al
 * servidor.
 */
export function puedeCancelar(
  fecha: Date,
  horaInicio: string,
  config: ConfiguracionEfectiva,
  ahora: Date,
): boolean {
  const comienzo = instanteDelTurno(fecha, horaInicio);

  return ahora.getTime() <= comienzo.getTime() - config.minMinutosCancelar * 60_000;
}
```

- [ ] **Step 4: Ejecutar los tests y verlos pasar**

```bash
cd packages/shared && pnpm exec jest src/disponibilidad.spec.ts
```

Esperado: PASS, 22 tests.

- [ ] **Step 5: Escribir los tests de `puedeCancelar`**

Añadir al final de `packages/shared/src/disponibilidad.spec.ts`:

```ts
import { puedeCancelar } from './disponibilidad';

describe('puedeCancelar', () => {
  const SIN_VENTANA = { minMinutosCancelar: 0, minMinutosAnotarse: 0, listaEsperaHabilitada: false };
  const DOS_HORAS = { ...SIN_VENTANA, minMinutosCancelar: 120 };

  it('sin ventana se puede cancelar hasta el comienzo', () => {
    expect(puedeCancelar(FECHA_TURNO, '10:00', SIN_VENTANA, AHORA)).toBe(true);
  });

  it('sin ventana no se puede cancelar una clase que ya empezo', () => {
    expect(
      puedeCancelar(FECHA_TURNO, '10:00', SIN_VENTANA, new Date('2099-10-02T10:00:01.000Z')),
    ).toBe(false);
  });

  it('con dos horas de ventana, a tres horas del turno se puede', () => {
    expect(
      puedeCancelar(FECHA_TURNO, '10:00', DOS_HORAS, new Date('2099-10-02T07:00:00.000Z')),
    ).toBe(true);
  });

  it('con dos horas de ventana, a una hora del turno ya no', () => {
    expect(
      puedeCancelar(FECHA_TURNO, '10:00', DOS_HORAS, new Date('2099-10-02T09:00:00.000Z')),
    ).toBe(false);
  });

  it('justo en el limite todavia se puede', () => {
    expect(
      puedeCancelar(FECHA_TURNO, '10:00', DOS_HORAS, new Date('2099-10-02T08:00:00.000Z')),
    ).toBe(true);
  });
});
```

- [ ] **Step 6: Ejecutar y verificar**

```bash
cd packages/shared && pnpm exec jest src/disponibilidad.spec.ts
```

Esperado: PASS, 27 tests.

- [ ] **Step 7: Prueba de mutación — verificar que los tests muerden**

Haz estas tres mutaciones **de una en una**, corriendo los tests después de cada una, y revirtiendo
antes de la siguiente:

1. En `estadoDelTurno`, cambia `e.ocupados >= e.turno.cupo` por `e.ocupados === e.turno.cupo`.
   Esperado: **FAIL** en "mas ocupados que cupo sigue siendo LLENO".
2. En `motivoDelAlumno`, mueve la línea de `yaReservado` por encima de la de `mesPublicado`.
   Esperado: **FAIL** en "el mes sin publicar gana a ya reservado".
3. En `ventanaCerrada`, cambia `>` por `>=`.
   Esperado: **FAIL** en "justo en el limite de la ventana todavia puede".

Si alguna mutación pasa en verde, el test correspondiente no vale nada: arréglalo antes de seguir.
**Revierte las tres.**

- [ ] **Step 8: Compilar y comprobar formato**

```bash
cd packages/shared && pnpm build && pnpm exec jest
cd /d/Dev/box-admin && pnpm exec prettier --check "packages/shared/src/**/*.ts"
```

Esperado: todo en verde y formato correcto.

**Mensaje de commit sugerido para Cesar:**

```
feat(shared): calcularDisponibilidad, la tabla de decision de la fase

Unifica "lista de espera" y "solo cupos liberados" en un solo estado. Separa
dos ejes: `estado` describe el turno, `puedeReservar`/`motivo` describen a
este alumno. 27 tests, con las tres mutaciones clave verificadas.
```

---

## Task 5: `DisponibilidadService`

La capa que carga los datos y delega en la función pura. Aquí no hay reglas de negocio: si te
encuentras escribiendo un `if` sobre cupos o ventanas en este archivo, va en la Task 4.

**Files:**
- Crear: `apps/api/src/disponibilidad/disponibilidad.service.ts`
- Crear: `apps/api/src/disponibilidad/disponibilidad.module.ts`
- Test: `apps/api/src/disponibilidad/disponibilidad.service.spec.ts`

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/api/src/disponibilidad/disponibilidad.service.spec.ts`:

```ts
import type { JwtPayload } from '@boxadmin/shared';
import { DisponibilidadService } from './disponibilidad.service';
import type { PrismaService } from '../prisma/prisma.service';

const ALUMNO: JwtPayload = { sub: 'usr-1', tenantId: 'gym-1', rol: 'ALUMNO' };

const TURNO = {
  id: 'turno-1',
  salaId: 'sala-1',
  fecha: new Date('2099-10-02T00:00:00.000Z'),
  horaInicio: '10:00',
  horaFin: '11:00',
  nombre: 'Pilates',
  cupo: 5,
  sala: {
    activa: true,
    visibleAlumnos: true,
    soloCuposLiberados: false,
    minMinutosCancelar: null,
    minMinutosAnotarse: null,
    listaEsperaHabilitada: null,
  },
};

function crearServicio() {
  const db = {
    turno: { findFirst: jest.fn().mockResolvedValue(TURNO), findMany: jest.fn() },
    tenant: {
      findFirst: jest.fn().mockResolvedValue({
        minMinutosCancelar: null,
        minMinutosAnotarse: null,
        listaEsperaHabilitada: null,
      }),
    },
    reserva: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
    listaEspera: { findMany: jest.fn().mockResolvedValue([]) },
    usuarioSala: { findMany: jest.fn().mockResolvedValue([{ salaId: 'sala-1' }]) },
    mesCalendario: { findMany: jest.fn().mockResolvedValue([{ salaId: 'sala-1', anio: 2099, mes: 10 }]) },
  };

  return {
    servicio: new DisponibilidadService({ db } as unknown as PrismaService),
    db,
  };
}

describe('DisponibilidadService.paraTurno', () => {
  it('devuelve LIBRE cuando hay cupo y el alumno cumple todo', async () => {
    const { servicio } = crearServicio();

    const d = await servicio.paraTurno(ALUMNO, 'perfil-1', 'turno-1', new Date('2099-10-01T10:00:00.000Z'));

    expect(d).toMatchObject({ turnoId: 'turno-1', estado: 'LIBRE', puedeReservar: true, motivo: null });
  });

  it('el mes sin publicar bloquea al alumno', async () => {
    const { servicio, db } = crearServicio();
    db.mesCalendario.findMany.mockResolvedValue([]);

    const d = await servicio.paraTurno(ALUMNO, 'perfil-1', 'turno-1', new Date('2099-10-01T10:00:00.000Z'));

    expect(d.motivo).toBe('MES_NO_PUBLICADO');
  });

  it('sin acceso a la sala bloquea al alumno', async () => {
    const { servicio, db } = crearServicio();
    db.usuarioSala.findMany.mockResolvedValue([]);

    const d = await servicio.paraTurno(ALUMNO, 'perfil-1', 'turno-1', new Date('2099-10-01T10:00:00.000Z'));

    expect(d.motivo).toBe('SIN_ACCESO_A_SALA');
  });

  it('solo cuenta como publicado el mes HABILITADO de ESA sala', async () => {
    const { servicio, db } = crearServicio();
    // Publicado el mes correcto pero de OTRA sala.
    db.mesCalendario.findMany.mockResolvedValue([{ salaId: 'sala-9', anio: 2099, mes: 10 }]);

    const d = await servicio.paraTurno(ALUMNO, 'perfil-1', 'turno-1', new Date('2099-10-01T10:00:00.000Z'));

    expect(d.motivo).toBe('MES_NO_PUBLICADO');
  });

  it('404 si el turno no existe', async () => {
    const { servicio, db } = crearServicio();
    db.turno.findFirst.mockResolvedValue(null);

    await expect(
      servicio.paraTurno(ALUMNO, 'perfil-1', 'turno-9', new Date()),
    ).rejects.toThrow('Turno inexistente');
  });

  it('pide solo los meses HABILITADO', async () => {
    const { servicio, db } = crearServicio();

    await servicio.paraTurno(ALUMNO, 'perfil-1', 'turno-1', new Date('2099-10-01T10:00:00.000Z'));

    expect(db.mesCalendario.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ estado: 'HABILITADO' }) }),
    );
  });

  it('cuenta como ocupadas solo las reservas activas', async () => {
    const { servicio, db } = crearServicio();

    await servicio.paraTurno(ALUMNO, 'perfil-1', 'turno-1', new Date('2099-10-01T10:00:00.000Z'));

    expect(db.reserva.count).toHaveBeenCalledWith({
      where: { turnoId: 'turno-1', canceladaEn: null },
    });
  });
});
```

- [ ] **Step 2: Ejecutar el test y verlo fallar**

```bash
cd apps/api && pnpm exec jest src/disponibilidad
```

Esperado: FAIL — no existe el módulo.

- [ ] **Step 3: Implementar el servicio**

Crear `apps/api/src/disponibilidad/disponibilidad.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  calcularDisponibilidad,
  resolverConfiguracion,
  type ConfiguracionEfectiva,
  type Disponibilidad,
  type JwtPayload,
} from '@boxadmin/shared';
import { PrismaService, type ClientePrismaTx } from '../prisma/prisma.service';

/** Las columnas de Sala que hacen falta para decidir. */
const SALA_PARA_DISPONIBILIDAD = {
  activa: true,
  visibleAlumnos: true,
  soloCuposLiberados: true,
  minMinutosCancelar: true,
  minMinutosAnotarse: true,
  listaEsperaHabilitada: true,
} as const;

@Injectable()
export class DisponibilidadService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Disponibilidad de UN turno para UN alumno.
   *
   * Aqui no hay reglas de negocio: se cargan los datos y decide
   * `calcularDisponibilidad`. Si aparece un `if` sobre cupos o ventanas en este
   * archivo, esta en el sitio equivocado.
   *
   * `ahora` entra por parametro y no se lee del reloj aqui para que los tests
   * puedan fijarlo sin trucos de timers.
   */
  async paraTurno(
    actor: JwtPayload,
    perfilId: string,
    turnoId: string,
    ahora: Date = new Date(),
    cliente: ClientePrismaTx = this.prisma.db,
  ): Promise<Disponibilidad> {
    const turno = await cliente.turno.findFirst({
      where: { id: turnoId },
      include: { sala: { select: SALA_PARA_DISPONIBILIDAD } },
    });
    if (!turno) throw new NotFoundException('Turno inexistente');

    const config = await this.configuracionDeSala(turno.sala, cliente);

    const [ocupados, canceladas, misReservas, accesos, publicados, cola] = await Promise.all([
      cliente.reserva.count({ where: { turnoId, canceladaEn: null } }),
      cliente.reserva.count({ where: { turnoId, canceladaEn: { not: null } } }),
      cliente.reserva.findMany({ where: { turnoId, perfilId, canceladaEn: null } }),
      cliente.usuarioSala.findMany({ where: { perfilId, salaId: turno.salaId } }),
      cliente.mesCalendario.findMany({
        where: {
          salaId: turno.salaId,
          anio: turno.fecha.getUTCFullYear(),
          mes: turno.fecha.getUTCMonth() + 1,
          estado: 'HABILITADO',
        },
      }),
      cliente.listaEspera.findMany({
        where: { turnoId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    ]);

    // La posicion se deriva del orden: 1 = el proximo en entrar. No hay ningun
    // contador guardado que renumerar.
    const indice = cola.findIndex((fila) => fila.perfilId === perfilId);

    return calcularDisponibilidad({
      turno: {
        id: turno.id,
        salaId: turno.salaId,
        fecha: turno.fecha,
        horaInicio: turno.horaInicio,
        cupo: turno.cupo,
      },
      sala: turno.sala,
      config,
      ocupados,
      huboCancelaciones: canceladas > 0,
      mesPublicado: publicados.length > 0,
      tieneAccesoASala: accesos.length > 0,
      yaReservado: misReservas.length > 0,
      enListaEspera: indice >= 0,
      posicionEnLista: indice >= 0 ? indice + 1 : null,
      ahora,
    });
  }

  /**
   * Resuelve la cascada `Sala ?? Tenant ?? sistema`.
   *
   * En contexto de tenant, `findFirst()` sobre Tenant ya queda restringido al
   * propio gimnasio (la extension fuerza `where.id = tenantId`): no hace falta
   * —ni se debe— pasar el id a mano.
   */
  async configuracionDeSala(
    sala: {
      minMinutosCancelar: number | null;
      minMinutosAnotarse: number | null;
      listaEsperaHabilitada: boolean | null;
    },
    cliente: ClientePrismaTx = this.prisma.db,
  ): Promise<ConfiguracionEfectiva> {
    const tenant = await cliente.tenant.findFirst();

    return resolverConfiguracion(sala, {
      minMinutosCancelar: tenant?.minMinutosCancelar ?? null,
      minMinutosAnotarse: tenant?.minMinutosAnotarse ?? null,
      listaEsperaHabilitada: tenant?.listaEsperaHabilitada ?? null,
    });
  }
}
```

- [ ] **Step 4: Crear el módulo**

Crear `apps/api/src/disponibilidad/disponibilidad.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { DisponibilidadService } from './disponibilidad.service';

@Module({
  providers: [DisponibilidadService],
  exports: [DisponibilidadService],
})
export class DisponibilidadModule {}
```

- [ ] **Step 5: Registrar el módulo en la aplicación**

En `apps/api/src/app.module.ts`, añadir el import y meterlo en el array `imports`, después de
`HistorialModule`:

```ts
import { DisponibilidadModule } from './disponibilidad/disponibilidad.module';
```

```ts
    PrismaModule,
    HistorialModule,
    DisponibilidadModule,
    AuthModule,
```

- [ ] **Step 6: Ejecutar los tests y verlos pasar**

```bash
cd apps/api && pnpm exec jest src/disponibilidad
```

Esperado: PASS, 7 tests.

- [ ] **Step 7: Compilar y comprobar formato**

```bash
cd apps/api && pnpm exec tsc --noEmit
cd /d/Dev/box-admin && pnpm exec prettier --check "apps/api/src/disponibilidad/**/*.ts" "apps/api/src/app.module.ts"
```

Esperado: compilación limpia y formato correcto.

**Mensaje de commit sugerido para Cesar:**

```
feat(api): DisponibilidadService

Carga los datos y delega en la funcion pura de @boxadmin/shared. Resuelve la
cascada de configuracion y deriva la posicion en la lista de espera del orden
por (createdAt, id).
```

---
## Task 6: Claves de invitación

El CRUD que usa el admin para preparar las claves. Sigue el patrón exacto de `rutinas` (Fase 2):
service con `$transaction` + `HistorialService`, controller delgado, DTOs con `class-validator`.

**Files:**
- Crear: `apps/api/src/invitaciones/invitaciones.service.ts`
- Crear: `apps/api/src/invitaciones/invitaciones.controller.ts`
- Crear: `apps/api/src/invitaciones/invitaciones.module.ts`
- Crear: `apps/api/src/invitaciones/dto/crear-invitacion.dto.ts`
- Crear: `apps/api/src/invitaciones/dto/actualizar-invitacion.dto.ts`
- Modificar: `apps/api/src/common/historial/historial.service.ts`
- Modificar: `apps/api/src/app.module.ts`
- Test: `apps/api/src/invitaciones/invitaciones.service.spec.ts`

- [ ] **Step 1: Ampliar las entidades auditables**

En `apps/api/src/common/historial/historial.service.ts`, añadir al tipo `EntidadAuditable`:

```ts
  | 'ClaveInvitacion'
  | 'Comprobante'
  | 'ListaEspera'
```

Y al tipo `AccionAuditable`:

```ts
  | 'APROBADO'
  | 'RECHAZADO'
  | 'ANOTADO'
  | 'SALIDO'
  | 'ASIGNADA_DESDE_LISTA'
  | 'AUTO_REGISTRADO'
```

- [ ] **Step 2: Escribir los tests que fallan**

Crear `apps/api/src/invitaciones/invitaciones.service.spec.ts`:

```ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { JwtPayload } from '@boxadmin/shared';
import { InvitacionesService } from './invitaciones.service';
import type { HistorialService } from '../common/historial/historial.service';
import type { PrismaService } from '../prisma/prisma.service';

const ADMIN: JwtPayload = { sub: 'usr-1', tenantId: 'gym-1', rol: 'ADMIN_OPERATIVO' };

const FILA = {
  id: 'clave-1',
  tenantId: 'gym-1',
  codigo: 'a'.repeat(32),
  nombre: 'Alumnos de Pilates',
  activa: true,
  usosMax: 10,
  usosActuales: 0,
  expiraEn: null,
  packId: 'pack-1',
  salas: [{ salaId: 'sala-1' }, { salaId: 'sala-2' }],
};

function crearServicio() {
  const claveInvitacion = {
    findFirst: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([FILA]),
    create: jest.fn().mockResolvedValue(FILA),
    update: jest.fn().mockResolvedValue(FILA),
  };
  const claveInvitacionSala = {
    createMany: jest.fn().mockResolvedValue({ count: 2 }),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
  };
  const sala = { findMany: jest.fn().mockResolvedValue([{ id: 'sala-1' }, { id: 'sala-2' }]) };
  const pack = { findFirst: jest.fn().mockResolvedValue({ id: 'pack-1', activo: true }) };

  const db = {
    claveInvitacion,
    claveInvitacionSala,
    sala,
    pack,
    $transaction: jest.fn((fn: (tx: unknown) => unknown): unknown => fn(db)),
  };
  const historial = { registrar: jest.fn().mockResolvedValue(undefined) };

  return {
    servicio: new InvitacionesService(
      { db } as unknown as PrismaService,
      historial as unknown as HistorialService,
    ),
    claveInvitacion,
    claveInvitacionSala,
    sala,
    pack,
    historial,
  };
}

describe('InvitacionesService.crear', () => {
  it('genera un codigo de 32 caracteres que el cliente no propone', async () => {
    const { servicio, claveInvitacion } = crearServicio();

    await servicio.crear(ADMIN, { nombre: 'Alumnos de Pilates', salaIds: ['sala-1', 'sala-2'] });

    const data = claveInvitacion.create.mock.calls[0][0].data;
    expect(data.codigo).toMatch(/^[0-9a-f]{32}$/);
    expect(data.nombre).toBe('Alumnos de Pilates');
  });

  it('dos claves seguidas no comparten codigo', async () => {
    const { servicio, claveInvitacion } = crearServicio();

    await servicio.crear(ADMIN, { nombre: 'A', salaIds: ['sala-1'] });
    await servicio.crear(ADMIN, { nombre: 'B', salaIds: ['sala-1'] });

    const primero = claveInvitacion.create.mock.calls[0][0].data.codigo;
    const segundo = claveInvitacion.create.mock.calls[1][0].data.codigo;
    expect(primero).not.toBe(segundo);
  });

  it('crea las filas de salas que la clave otorga', async () => {
    const { servicio, claveInvitacionSala } = crearServicio();

    await servicio.crear(ADMIN, { nombre: 'A', salaIds: ['sala-1', 'sala-2'] });

    expect(claveInvitacionSala.createMany).toHaveBeenCalledWith({
      data: [
        { tenantId: 'gym-1', claveId: 'clave-1', salaId: 'sala-1' },
        { tenantId: 'gym-1', claveId: 'clave-1', salaId: 'sala-2' },
      ],
    });
  });

  it('rechaza una sala que no existe en este gimnasio', async () => {
    const { servicio, sala } = crearServicio();
    sala.findMany.mockResolvedValue([{ id: 'sala-1' }]);

    await expect(
      servicio.crear(ADMIN, { nombre: 'A', salaIds: ['sala-1', 'sala-fantasma'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza una clave sin ninguna sala', async () => {
    const { servicio } = crearServicio();

    // Una clave sin salas produciria alumnos que no pueden reservar nada: es
    // exactamente el agujero que esta fase viene a tapar.
    await expect(servicio.crear(ADMIN, { nombre: 'A', salaIds: [] })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rechaza un pack inexistente', async () => {
    const { servicio, pack } = crearServicio();
    pack.findFirst.mockResolvedValue(null);

    await expect(
      servicio.crear(ADMIN, { nombre: 'A', salaIds: ['sala-1'], packId: 'pack-fantasma' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('registra la creacion en el historial sin filtrar el codigo', async () => {
    const { servicio, historial } = crearServicio();

    await servicio.crear(ADMIN, { nombre: 'A', salaIds: ['sala-1'] });

    const entrada = historial.registrar.mock.calls[0][0];
    expect(entrada).toMatchObject({ entidad: 'ClaveInvitacion', accion: 'CREADA' });
    // El codigo es una credencial: no va al historial, que lo lee mas gente de
    // la que deberia poder darse de alta.
    expect(JSON.stringify(entrada.detalle ?? {})).not.toContain('a'.repeat(32));
  });
});

describe('InvitacionesService.listar', () => {
  it('devuelve las claves con sus salas aplanadas', async () => {
    const { servicio } = crearServicio();

    const claves = await servicio.listar(ADMIN);

    expect(claves[0]).toMatchObject({ id: 'clave-1', salaIds: ['sala-1', 'sala-2'] });
  });
});

describe('InvitacionesService.actualizar', () => {
  it('404 si la clave no existe', async () => {
    const { servicio } = crearServicio();

    await expect(servicio.actualizar(ADMIN, 'clave-9', { activa: false })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('desactiva la clave sin tocar sus salas', async () => {
    const { servicio, claveInvitacion, claveInvitacionSala } = crearServicio();
    claveInvitacion.findFirst.mockResolvedValue(FILA);

    await servicio.actualizar(ADMIN, 'clave-1', { activa: false });

    expect(claveInvitacion.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'clave-1' }, data: expect.objectContaining({ activa: false }) }),
    );
    expect(claveInvitacionSala.deleteMany).not.toHaveBeenCalled();
  });

  it('reemplaza las salas por completo cuando se mandan', async () => {
    const { servicio, claveInvitacion, claveInvitacionSala } = crearServicio();
    claveInvitacion.findFirst.mockResolvedValue(FILA);

    await servicio.actualizar(ADMIN, 'clave-1', { salaIds: ['sala-2'] });

    // Borrar y volver a crear, no diferencia incremental: es lo mismo que hace
    // PATCH /usuarios/:id/salas en la Fase 1 y evita reconciliaciones sutiles.
    expect(claveInvitacionSala.deleteMany).toHaveBeenCalledWith({ where: { claveId: 'clave-1' } });
    expect(claveInvitacionSala.createMany).toHaveBeenCalledWith({
      data: [{ tenantId: 'gym-1', claveId: 'clave-1', salaId: 'sala-2' }],
    });
  });

  it('rechaza dejar la clave sin salas', async () => {
    const { servicio, claveInvitacion } = crearServicio();
    claveInvitacion.findFirst.mockResolvedValue(FILA);

    await expect(servicio.actualizar(ADMIN, 'clave-1', { salaIds: [] })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
```

- [ ] **Step 3: Ejecutar los tests y verlos fallar**

```bash
cd apps/api && pnpm exec jest src/invitaciones
```

Esperado: FAIL — no existe el módulo.

- [ ] **Step 4: Escribir los DTOs**

Crear `apps/api/src/invitaciones/dto/crear-invitacion.dto.ts`:

```ts
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CrearInvitacionDto {
  /** Para que el admin reconozca la clave en su listado. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  nombre!: string;

  /**
   * Las salas que otorga. Obligatorias y al menos una: una clave sin salas
   * produce alumnos que no pueden reservar nada.
   */
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  salaIds!: string[];

  /** Ausente = el alumno queda sin pack, y el admin se lo asigna despues. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  packId?: string;

  /** Ausente = ilimitada. */
  @IsOptional()
  @IsInt()
  @Min(1)
  usosMax?: number;

  /** Ausente = no caduca. */
  @IsOptional()
  @IsISO8601()
  expiraEn?: string;
}
```

Crear `apps/api/src/invitaciones/dto/actualizar-invitacion.dto.ts`:

```ts
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * El `codigo` NO se puede cambiar: es una credencial ya repartida, y rotarla
 * silenciosamente dejaria fuera a quien la tuviera. Para eso se desactiva esta
 * clave y se crea otra.
 */
export class ActualizarInvitacionDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  nombre?: string;

  @IsOptional()
  @IsBoolean()
  activa?: boolean;

  /** Presente = reemplaza el conjunto entero. Debe traer al menos una sala. */
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  salaIds?: string[];

  @IsOptional()
  @IsString()
  packId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  usosMax?: number;

  @IsOptional()
  @IsISO8601()
  expiraEn?: string;
}
```

- [ ] **Step 5: Implementar el servicio**

Crear `apps/api/src/invitaciones/invitaciones.service.ts`:

```ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { ClaveInvitacionPublica, JwtPayload } from '@boxadmin/shared';
import { HistorialService } from '../common/historial/historial.service';
import { PrismaService, type ClientePrismaTx } from '../prisma/prisma.service';
import type { ActualizarInvitacionDto } from './dto/actualizar-invitacion.dto';
import type { CrearInvitacionDto } from './dto/crear-invitacion.dto';

/** Fila con sus salas, tal como la devuelven las consultas de este servicio. */
interface FilaConSalas {
  id: string;
  tenantId: string;
  codigo: string;
  nombre: string;
  activa: boolean;
  usosMax: number | null;
  usosActuales: number;
  expiraEn: Date | null;
  packId: string | null;
  salas: { salaId: string }[];
}

export function aClavePublica(fila: FilaConSalas): ClaveInvitacionPublica {
  return {
    id: fila.id,
    tenantId: fila.tenantId,
    codigo: fila.codigo,
    nombre: fila.nombre,
    activa: fila.activa,
    usosMax: fila.usosMax,
    usosActuales: fila.usosActuales,
    expiraEn: fila.expiraEn === null ? null : fila.expiraEn.toISOString(),
    packId: fila.packId,
    salaIds: fila.salas.map((union) => union.salaId),
  };
}

/**
 * 16 bytes = 32 caracteres hexadecimales, de `randomBytes` (CSPRNG). Es el unico
 * dato que el alumno necesita para darse de alta, asi que tiene que ser
 * impredecible: `Math.random()` no sirve aqui ni de lejos.
 */
function generarCodigo(): string {
  return randomBytes(16).toString('hex');
}

@Injectable()
export class InvitacionesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly historial: HistorialService,
  ) {}

  async crear(actor: JwtPayload, dto: CrearInvitacionDto): Promise<ClaveInvitacionPublica> {
    const fila = await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      await this.exigirSalasValidas(cliente, dto.salaIds);
      await this.exigirPackValido(cliente, dto.packId);

      const creada = await cliente.claveInvitacion.create({
        data: {
          tenantId: actor.tenantId,
          codigo: generarCodigo(),
          nombre: dto.nombre,
          packId: dto.packId ?? null,
          usosMax: dto.usosMax ?? null,
          expiraEn: dto.expiraEn ? new Date(dto.expiraEn) : null,
        },
      });

      await cliente.claveInvitacionSala.createMany({
        data: dto.salaIds.map((salaId) => ({
          tenantId: actor.tenantId,
          claveId: creada.id,
          salaId,
        })),
      });

      await this.historial.registrar(
        {
          actor,
          entidad: 'ClaveInvitacion',
          entidadId: creada.id,
          accion: 'CREADA',
          // El codigo NO va al detalle: es una credencial, y el historial lo
          // lee mas gente de la que deberia poder darse de alta.
          detalle: { nombre: dto.nombre, salaIds: dto.salaIds, usosMax: dto.usosMax ?? null },
        },
        cliente,
      );

      return { ...creada, salas: dto.salaIds.map((salaId) => ({ salaId })) };
    });

    return aClavePublica(fila as FilaConSalas);
  }

  async listar(_actor: JwtPayload): Promise<ClaveInvitacionPublica[]> {
    const filas = await this.prisma.db.claveInvitacion.findMany({
      include: { salas: { select: { salaId: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return (filas as FilaConSalas[]).map(aClavePublica);
  }

  async actualizar(
    actor: JwtPayload,
    id: string,
    dto: ActualizarInvitacionDto,
  ): Promise<ClaveInvitacionPublica> {
    const fila = await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      const existente = await cliente.claveInvitacion.findFirst({
        where: { id },
        include: { salas: { select: { salaId: true } } },
      });
      if (!existente) throw new NotFoundException('Clave de invitacion inexistente');

      if (dto.salaIds !== undefined) {
        await this.exigirSalasValidas(cliente, dto.salaIds);
      }
      if (dto.packId !== undefined) {
        await this.exigirPackValido(cliente, dto.packId);
      }

      const actualizada = await cliente.claveInvitacion.update({
        where: { id },
        data: {
          nombre: dto.nombre,
          activa: dto.activa,
          packId: dto.packId,
          usosMax: dto.usosMax,
          expiraEn: dto.expiraEn ? new Date(dto.expiraEn) : undefined,
        },
      });

      let salas = (existente as FilaConSalas).salas;

      if (dto.salaIds !== undefined) {
        // Borrar y volver a crear, no diferencia incremental: es lo mismo que
        // hace PATCH /usuarios/:id/salas desde la Fase 1 y evita
        // reconciliaciones sutiles que nadie prueba.
        await cliente.claveInvitacionSala.deleteMany({ where: { claveId: id } });
        await cliente.claveInvitacionSala.createMany({
          data: dto.salaIds.map((salaId) => ({
            tenantId: actor.tenantId,
            claveId: id,
            salaId,
          })),
        });
        salas = dto.salaIds.map((salaId) => ({ salaId }));
      }

      await this.historial.registrar(
        {
          actor,
          entidad: 'ClaveInvitacion',
          entidadId: id,
          accion: 'ACTUALIZADA',
          detalle: { ...dto },
        },
        cliente,
      );

      return { ...actualizada, salas };
    });

    return aClavePublica(fila as FilaConSalas);
  }

  /**
   * Las salas tienen que existir EN ESTE GIMNASIO. La extension de aislamiento
   * ya restringe el findMany al tenant del contexto, asi que basta comparar
   * cuantas se encontraron.
   */
  private async exigirSalasValidas(cliente: ClientePrismaTx, salaIds: string[]): Promise<void> {
    if (salaIds.length === 0) {
      throw new BadRequestException(
        'Una clave de invitacion necesita al menos una sala: sin salas, el alumno ' +
          'que se registre con ella no podria ver ni reservar ningun turno.',
      );
    }

    const unicas = [...new Set(salaIds)];
    const encontradas = await cliente.sala.findMany({
      where: { id: { in: unicas } },
      select: { id: true },
    });

    if (encontradas.length !== unicas.length) {
      const existentes = new Set(encontradas.map((s) => s.id));
      const faltan = unicas.filter((id) => !existentes.has(id));
      throw new BadRequestException(`Salas inexistentes en este gimnasio: ${faltan.join(', ')}`);
    }
  }

  private async exigirPackValido(
    cliente: ClientePrismaTx,
    packId: string | null | undefined,
  ): Promise<void> {
    if (!packId) return;

    const pack = await cliente.pack.findFirst({ where: { id: packId } });
    if (!pack) throw new NotFoundException('Pack inexistente');
    if (!pack.activo) {
      throw new BadRequestException('No se puede invitar con un pack dado de baja');
    }
  }
}
```

- [ ] **Step 6: Ejecutar los tests y verlos pasar**

```bash
cd apps/api && pnpm exec jest src/invitaciones
```

Esperado: PASS, 12 tests.

- [ ] **Step 7: Escribir el controller**

Crear `apps/api/src/invitaciones/invitaciones.controller.ts`:

```ts
import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import type { ClaveInvitacionPublica, JwtPayload } from '@boxadmin/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ActualizarInvitacionDto } from './dto/actualizar-invitacion.dto';
import { CrearInvitacionDto } from './dto/crear-invitacion.dto';
import { InvitacionesService } from './invitaciones.service';

// ADMIN_OPERATIVO en las tres: es el mismo rol que ya da de alta alumnos y les
// asigna salas desde la Fase 1, y una clave de invitacion no es mas que esa
// misma operacion preparada por adelantado.
@Controller('invitaciones')
export class InvitacionesController {
  constructor(private readonly invitaciones: InvitacionesService) {}

  @Roles('ADMIN_OPERATIVO')
  @Post()
  crear(
    @CurrentUser() actor: JwtPayload,
    @Body() dto: CrearInvitacionDto,
  ): Promise<ClaveInvitacionPublica> {
    return this.invitaciones.crear(actor, dto);
  }

  @Roles('ADMIN_OPERATIVO')
  @Get()
  listar(@CurrentUser() actor: JwtPayload): Promise<ClaveInvitacionPublica[]> {
    return this.invitaciones.listar(actor);
  }

  @Roles('ADMIN_OPERATIVO')
  @Patch(':id')
  actualizar(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ActualizarInvitacionDto,
  ): Promise<ClaveInvitacionPublica> {
    return this.invitaciones.actualizar(actor, id, dto);
  }
}
```

- [ ] **Step 8: Crear y registrar el módulo**

Crear `apps/api/src/invitaciones/invitaciones.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { InvitacionesController } from './invitaciones.controller';
import { InvitacionesService } from './invitaciones.service';

@Module({
  controllers: [InvitacionesController],
  providers: [InvitacionesService],
  exports: [InvitacionesService],
})
export class InvitacionesModule {}
```

En `apps/api/src/app.module.ts`, importar `InvitacionesModule` y añadirlo al array `imports` después
de `UsuariosModule`.

- [ ] **Step 9: Verificar compilación, tests y formato**

```bash
cd apps/api && pnpm exec tsc --noEmit && pnpm test
cd /d/Dev/box-admin && pnpm exec prettier --check "apps/api/src/invitaciones/**/*.ts"
```

Esperado: compilación limpia, todos los tests en verde, formato correcto.

**Mensaje de commit sugerido para Cesar:**

```
feat(api): CRUD de claves de invitacion

El codigo lo genera el servidor con randomBytes (32 hex) y nunca aparece en el
historial. Una clave exige al menos una sala: sin salas, el alumno que se
registre con ella no podria reservar nada.
```

---

## Task 7: Auto-registro

El endpoint público de la fase. Es el que más cuidado pide: sin JWT, sin contexto de tenant abierto
por el middleware, y con una carrera real sobre `usosMax`.

**Files:**
- Crear: `apps/api/src/auth/dto/auto-registro.dto.ts`
- Modificar: `apps/api/src/auth/auth.service.ts`
- Modificar: `apps/api/src/auth/auth.controller.ts`
- Modificar: `apps/api/src/auth/auth.module.ts`
- Test: `apps/api/src/auth/auth.service.spec.ts` (modificar)

- [ ] **Step 1: Escribir los tests que fallan**

Añadir a `apps/api/src/auth/auth.service.spec.ts`. Si el archivo tiene ya una fábrica de servicio,
reutilízala; si no, esta es autocontenida:

```ts
describe('AuthService.autoRegistro', () => {
  const DTO = {
    tenantSlug: 'gimnasio',
    codigo: 'a'.repeat(32),
    nombreCompleto: 'Ana Perez',
    email: 'Ana@Ejemplo.COM',
    password: 'Password123!',
  };

  const CLAVE = {
    id: 'clave-1',
    tenantId: 'gym-1',
    codigo: 'a'.repeat(32),
    activa: true,
    usosMax: 10,
    usosActuales: 0,
    expiraEn: null,
    packId: 'pack-1',
    salas: [{ salaId: 'sala-1' }, { salaId: 'sala-2' }],
  };

  function montar(cambios: Record<string, unknown> = {}) {
    const claveInvitacion = {
      findFirst: jest.fn().mockResolvedValue(CLAVE),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    const usuario = {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({
        id: 'usr-nuevo',
        tenantId: 'gym-1',
        nombreCompleto: 'Ana Perez',
        email: 'ana@ejemplo.com',
        rol: 'ALUMNO',
        activo: true,
      }),
    };
    const perfil = { create: jest.fn().mockResolvedValue({ id: 'perfil-nuevo' }) };
    const usuarioSala = { createMany: jest.fn().mockResolvedValue({ count: 2 }) };
    const tenant = { findFirst: jest.fn().mockResolvedValue({ id: 'gym-1', slug: 'gimnasio', activo: true }) };

    const db = {
      claveInvitacion,
      usuario,
      perfil,
      usuarioSala,
      tenant,
      refreshToken: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn((fn: (tx: unknown) => unknown): unknown => fn(db)),
      ...cambios,
    };

    return { db, claveInvitacion, usuario, perfil, usuarioSala };
  }

  it('crea el usuario como ALUMNO, nunca con el rol que pida el cuerpo', async () => {
    const { servicio, usuario } = crearAuthService(montar());

    await servicio.autoRegistro({ ...DTO, rol: 'ADMIN_SALON' } as never);

    expect(usuario.create.mock.calls[0][0].data.rol).toBe('ALUMNO');
  });

  it('normaliza el email a minusculas', async () => {
    const { servicio, usuario } = crearAuthService(montar());

    await servicio.autoRegistro(DTO);

    expect(usuario.create.mock.calls[0][0].data.email).toBe('ana@ejemplo.com');
  });

  it('marca el perfil como autoRegistrado y le pone el pack de la clave', async () => {
    const { servicio, perfil } = crearAuthService(montar());

    await servicio.autoRegistro(DTO);

    expect(perfil.create.mock.calls[0][0].data).toMatchObject({
      autoRegistrado: true,
      packId: 'pack-1',
    });
  });

  it('le da las salas de la clave: sin ellas no podria reservar nada', async () => {
    const { servicio, usuarioSala } = crearAuthService(montar());

    await servicio.autoRegistro(DTO);

    expect(usuarioSala.createMany).toHaveBeenCalledWith({
      data: [
        { tenantId: 'gym-1', perfilId: 'perfil-nuevo', salaId: 'sala-1' },
        { tenantId: 'gym-1', perfilId: 'perfil-nuevo', salaId: 'sala-2' },
      ],
    });
  });

  it('incrementa los usos con un updateMany CONDICIONAL', async () => {
    const { servicio, claveInvitacion } = crearAuthService(montar());

    await servicio.autoRegistro(DTO);

    // El where lleva usosActuales para que dos registros simultaneos no puedan
    // pasar los dos: es el mismo CAS que protege la rotacion de refresh tokens.
    expect(claveInvitacion.updateMany).toHaveBeenCalledWith({
      where: { id: 'clave-1', usosActuales: 0 },
      data: { usosActuales: 1 },
    });
  });

  it('si el CAS no afecta ninguna fila, la clave se agoto en la carrera', async () => {
    const montaje = montar();
    montaje.claveInvitacion.updateMany.mockResolvedValue({ count: 0 });
    const { servicio } = crearAuthService(montaje);

    await expect(servicio.autoRegistro(DTO)).rejects.toBeInstanceOf(ConflictException);
  });

  it('rechaza un codigo que no existe', async () => {
    const montaje = montar();
    montaje.claveInvitacion.findFirst.mockResolvedValue(null);
    const { servicio } = crearAuthService(montaje);

    await expect(servicio.autoRegistro(DTO)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rechaza una clave desactivada', async () => {
    const montaje = montar();
    montaje.claveInvitacion.findFirst.mockResolvedValue({ ...CLAVE, activa: false });
    const { servicio } = crearAuthService(montaje);

    await expect(servicio.autoRegistro(DTO)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rechaza una clave caducada', async () => {
    const montaje = montar();
    montaje.claveInvitacion.findFirst.mockResolvedValue({
      ...CLAVE,
      expiraEn: new Date('2020-01-01T00:00:00.000Z'),
    });
    const { servicio } = crearAuthService(montaje);

    await expect(servicio.autoRegistro(DTO)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rechaza una clave con los usos agotados', async () => {
    const montaje = montar();
    montaje.claveInvitacion.findFirst.mockResolvedValue({ ...CLAVE, usosMax: 3, usosActuales: 3 });
    const { servicio } = crearAuthService(montaje);

    await expect(servicio.autoRegistro(DTO)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('una clave sin usosMax es ilimitada', async () => {
    const montaje = montar();
    montaje.claveInvitacion.findFirst.mockResolvedValue({
      ...CLAVE,
      usosMax: null,
      usosActuales: 9999,
    });
    const { servicio } = crearAuthService(montaje);

    await expect(servicio.autoRegistro(DTO)).resolves.toMatchObject({ accessToken: expect.any(String) });
  });

  it('409 si el email ya existe en ese gimnasio', async () => {
    const montaje = montar();
    montaje.usuario.findFirst.mockResolvedValue({ id: 'usr-existente' });
    const { servicio } = crearAuthService(montaje);

    await expect(servicio.autoRegistro(DTO)).rejects.toBeInstanceOf(ConflictException);
  });

  it('corre en Serializable: usosMax es un cupo', async () => {
    const montaje = montar();
    const { servicio } = crearAuthService(montaje);

    await servicio.autoRegistro(DTO);

    expect(montaje.db.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: 'Serializable' }),
    );
  });
});
```

`crearAuthService(montaje)` es una fábrica que tienes que añadir al archivo de test si no existe ya:
construye el `AuthService` con el `db` del montaje, un `JwtService` que firma cualquier cosa y un
`ConfigService` que devuelve secretos falsos.

```ts
function crearAuthService(montaje: { db: Record<string, unknown> }) {
  const jwt = {
    signAsync: jest.fn().mockResolvedValue('token-falso'),
    decode: jest.fn().mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 3600 }),
    verifyAsync: jest.fn(),
  };
  const config = { getOrThrow: jest.fn().mockReturnValue('secreto') };

  return {
    servicio: new AuthService(
      { db: montaje.db } as unknown as PrismaService,
      jwt as unknown as JwtService,
      config as unknown as ConfigService,
    ),
    ...montaje,
  };
}
```

- [ ] **Step 2: Ejecutar los tests y verlos fallar**

```bash
cd apps/api && pnpm exec jest src/auth -t autoRegistro
```

Esperado: FAIL — `servicio.autoRegistro is not a function`.

- [ ] **Step 3: Escribir el DTO**

Crear `apps/api/src/auth/dto/auto-registro.dto.ts`:

```ts
import { IsEmail, IsNotEmpty, IsString, Length, MaxLength, MinLength } from 'class-validator';

export class AutoRegistroDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  tenantSlug!: string;

  /** 32 caracteres hexadecimales generados por el servidor al crear la clave. */
  @IsString()
  @Length(32, 32)
  codigo!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nombreCompleto!: string;

  @IsEmail()
  @MaxLength(180)
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
```

El DTO **no acepta `rol`**, y el `ValidationPipe` global corre con
`forbidNonWhitelisted: true`: mandar `rol` en el cuerpo devuelve 400 antes de llegar al servicio. El
servicio además lo fija a `ALUMNO` por su cuenta, porque una sola línea de defensa en un endpoint
público no es suficiente.

- [ ] **Step 4: Implementar `autoRegistro`**

Añadir a `apps/api/src/auth/auth.service.ts`, con los imports que haga falta
(`ConflictException`, `conReintentoSerializable`, `esConflictoDeSerializacion`, `ClientePrismaTx`,
`AutoRegistroDto`):

```ts
  /**
   * Alta de un alumno por su cuenta, con una clave de invitacion.
   *
   * Tres cosas que no son evidentes:
   *
   * 1. **Corre en Serializable con reintento.** `usosMax` es un cupo y tiene
   *    exactamente la misma carrera que el cupo de un turno: sin aislamiento,
   *    dos registros simultaneos con una clave de un solo uso leen ambos
   *    `usosActuales = 0` y ambos pasan. Ademas del aislamiento, el incremento
   *    se hace con un updateMany CONDICIONAL (compare-and-swap), como la
   *    rotacion de refresh tokens: cinturon y tirantes.
   * 2. **Todo va dentro de `runWithTenant`.** Es un endpoint publico: no hay JWT,
   *    asi que el middleware no abrio ningun contexto y la extension de Prisma
   *    lanzaria `MissingTenantContextError` en la primera query. El tenant sale
   *    del slug, igual que en `register` desde la Fase 0.
   * 3. **El rol se fija aqui a ALUMNO.** El DTO no lo acepta y el ValidationPipe
   *    rechazaria el campo, pero una sola linea de defensa en un endpoint
   *    publico no basta.
   */
  async autoRegistro(dto: AutoRegistroDto): Promise<LoginRespuesta> {
    const tenant = await runUnscoped(
      async () => await this.prisma.db.tenant.findUnique({ where: { slug: dto.tenantSlug } }),
    );
    if (!tenant || !tenant.activo) {
      throw new UnauthorizedException(CLAVE_INVALIDA);
    }

    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    const email = dto.email.toLowerCase();

    const usuario = await runWithTenant(tenant.id, () =>
      this.conReintentoDeClave(() =>
        this.prisma.db.$transaction(
          async (tx) => {
            const cliente = tx as ClientePrismaTx;

            const clave = await cliente.claveInvitacion.findFirst({
              where: { codigo: dto.codigo },
              include: { salas: { select: { salaId: true } } },
            });

            // Mismo mensaje para "no existe", "desactivada", "caducada" y
            // "agotada": un endpoint publico no tiene por que decirle a quien
            // prueba codigos cual de los cuatro acerto.
            if (!clave || !clave.activa) throw new UnauthorizedException(CLAVE_INVALIDA);
            if (clave.expiraEn !== null && clave.expiraEn.getTime() <= Date.now()) {
              throw new UnauthorizedException(CLAVE_INVALIDA);
            }
            if (clave.usosMax !== null && clave.usosActuales >= clave.usosMax) {
              throw new UnauthorizedException(CLAVE_INVALIDA);
            }

            const yaExiste = await cliente.usuario.findFirst({ where: { email } });
            if (yaExiste) {
              throw new ConflictException('Ya hay una cuenta con ese email en este gimnasio');
            }

            const creado = await cliente.usuario.create({
              data: {
                tenantId: tenant.id,
                nombreCompleto: dto.nombreCompleto,
                email,
                passwordHash,
                // Fijo, nunca del cuerpo. Ver el punto 3 del comentario.
                rol: 'ALUMNO',
              },
            });

            const perfil = await cliente.perfil.create({
              data: {
                tenantId: tenant.id,
                usuarioId: creado.id,
                packId: clave.packId,
                autoRegistrado: true,
              },
            });

            // Sin estas filas el alumno no veria ni podria reservar NADA: toda
            // reserva se valida contra UsuarioSala. Es el agujero que el PDF
            // de la fase dejaba abierto.
            if (clave.salas.length > 0) {
              await cliente.usuarioSala.createMany({
                data: clave.salas.map((union) => ({
                  tenantId: tenant.id,
                  perfilId: perfil.id,
                  salaId: union.salaId,
                })),
              });
            }

            // CAS: solo una de dos peticiones simultaneas puede afectar una fila.
            const consumida = await cliente.claveInvitacion.updateMany({
              where: { id: clave.id, usosActuales: clave.usosActuales },
              data: { usosActuales: clave.usosActuales + 1 },
            });
            if (consumida.count === 0) {
              throw new ConflictException(
                'Otra alta consumio esta clave al mismo tiempo; vuelve a intentarlo.',
              );
            }

            await cliente.historialAccion.create({
              data: {
                tenantId: tenant.id,
                usuarioId: creado.id,
                entidad: 'Usuario',
                entidadId: creado.id,
                accion: 'AUTO_REGISTRADO',
                detalle: { claveId: clave.id, salaIds: clave.salas.map((u) => u.salaId) },
              },
            });

            return creado;
          },
          { isolationLevel: 'Serializable' },
        ),
      ),
    );

    const tokens = await this.emitirTokens({
      id: usuario.id,
      tenantId: usuario.tenantId,
      rol: usuario.rol,
    });

    return { ...tokens, usuario: this.aUsuarioPublico(usuario) };
  }

  /**
   * Como `conReintentoDeCupo` en ReservasService: si los reintentos se agotan,
   * sale un 409 y no un 500. Que la base aborte por solape no es un fallo del
   * servidor, es un conflicto.
   */
  private async conReintentoDeClave<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await conReintentoSerializable(fn, { intentos: 5 });
    } catch (error) {
      if (esConflictoDeSerializacion(error)) {
        throw new ConflictException(
          'Varias altas estan usando esta clave ahora mismo; reintenta en unos segundos.',
        );
      }
      throw error;
    }
  }
```

Y añadir cerca de `CREDENCIALES_INVALIDAS`, al principio del archivo:

```ts
/** Mismo mensaje para las cuatro formas de clave no utilizable: no filtra cual acerto. */
const CLAVE_INVALIDA = 'Clave de invitacion invalida';
```

- [ ] **Step 5: Ejecutar los tests y verlos pasar**

```bash
cd apps/api && pnpm exec jest src/auth -t autoRegistro
```

Esperado: PASS, 13 tests.

- [ ] **Step 6: Exponer la ruta**

En `apps/api/src/auth/auth.controller.ts`, añadir el import de `AutoRegistroDto` y el método:

```ts
  // Publico y SIN BootstrapKeyGuard, a diferencia de /auth/register: quien se
  // registra aqui es un alumno con una clave que le dio su gimnasio, no alguien
  // montando un tenant. El freno contra fuerza bruta lo pone el throttler
  // (Task 8).
  @Public()
  @Post('auto-registro')
  autoRegistro(@Body() dto: AutoRegistroDto): Promise<LoginRespuesta> {
    return this.auth.autoRegistro(dto);
  }
```

- [ ] **Step 7: Verificar compilación, tests y formato**

```bash
cd apps/api && pnpm exec tsc --noEmit && pnpm test
cd /d/Dev/box-admin && pnpm exec prettier --check "apps/api/src/auth/**/*.ts"
```

Esperado: todo en verde.

**Mensaje de commit sugerido para Cesar:**

```
feat(api): auto-registro de alumnos con clave de invitacion

Serializable con reintento mas un CAS sobre usosActuales: usosMax es un cupo y
tiene la misma carrera que el cupo de un turno. El alumno queda con el pack y
las salas de la clave, operativo desde el primer momento. Rol fijado a ALUMNO
en el servicio, no solo en el DTO.
```

---

## Task 8: Throttling de las rutas públicas

**Files:**
- Modificar: `apps/api/src/app.module.ts`
- Modificar: `apps/api/src/auth/auth.controller.ts`
- Modificar: `apps/api/src/main.ts`
- Test: `apps/api/src/auth/throttler.spec.ts` (crear)

- [ ] **Step 1: Registrar el módulo y el guard**

En `apps/api/src/app.module.ts`, añadir los imports:

```ts
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
```

Añadir al array `imports`, justo después de `JwtModule.register(...)`:

```ts
    // Limite permisivo global: no esta para moderar el uso normal, sino para
    // que ningun endpoint quede completamente sin freno. Las rutas publicas de
    // auth llevan ademas un limite estricto propio (@Throttle en el controller).
    ThrottlerModule.forRoot([{ name: 'general', ttl: 60_000, limit: 300 }]),
```

Y en el array `providers`, **el primero de todos**:

```ts
  providers: [
    // Primero de los tres a proposito: los guards corren en el orden en que se
    // declaran (verificado en la Task 0), y el freno tiene que aplicarse ANTES
    // de que JwtAuthGuard gaste tiempo validando el token de un atacante.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
```

Si en la Task 0 comprobaste que el orden es el inverso, pon `ThrottlerGuard` al final y **deja un
comentario diciendo que se verificó empíricamente**.

- [ ] **Step 2: Poner el límite estricto en las tres rutas públicas de auth**

En `apps/api/src/auth/auth.controller.ts`, importar:

```ts
import { Throttle } from '@nestjs/throttler';
```

Y decorar `login`, `refresh` y `autoRegistro`:

```ts
  // Cinco intentos por minuto y por IP. Adivinar un codigo de 32 hex a este
  // ritmo tardaria mas que la vida del universo, y de paso el login deja de
  // estar sin ningun freno, que es como estaba desde la Fase 0.
  @Throttle({ general: { ttl: 60_000, limit: 5 } })
```

- [ ] **Step 3: Confiar en el proxy para que la IP sea la real**

En `apps/api/src/main.ts`, después de crear la app y antes de `listen`:

```ts
  // Sin esto, detras de un reverse proxy TODAS las peticiones comparten la IP
  // del proxy y el throttler las cuenta como un solo cliente: o no frena a
  // nadie, o los frena a todos a la vez. Express lee X-Forwarded-For solo si se
  // le dice que confie.
  app.set('trust proxy', 1);
```

Si `app` está tipada como `INestApplication`, usa
`app.getHttpAdapter().getInstance().set('trust proxy', 1);`.

- [ ] **Step 4: Escribir el test de humo del límite**

Crear `apps/api/src/auth/throttler.spec.ts`:

```ts
import { ThrottlerModule } from '@nestjs/throttler';

describe('configuracion del throttler', () => {
  it('el modulo se puede construir con la configuracion de la aplicacion', () => {
    // Test de humo deliberadamente pequeno: verifica que la version instalada
    // acepta la forma de array de configuracion (la v5 la acepta; versiones
    // anteriores usaban un objeto suelto). El comportamiento real del limite se
    // ejercita en los e2e, que es donde hay peticiones de verdad con IP.
    expect(() =>
      ThrottlerModule.forRoot([{ name: 'general', ttl: 60_000, limit: 300 }]),
    ).not.toThrow();
  });
});
```

- [ ] **Step 5: Ejecutar tests y comprobar que nada se rompió**

```bash
cd apps/api && pnpm exec tsc --noEmit && pnpm test
```

Esperado: todo en verde.

```bash
cd apps/api && pnpm test:e2e
```

Esperado: 79/79. **Si aparecen 429 inesperados**, el límite global es demasiado bajo para los tests,
que disparan muchas peticiones seguidas desde la misma IP: sube `limit` a 1000 y déjalo comentado.

- [ ] **Step 6: Comprobar formato**

```bash
cd /d/Dev/box-admin && pnpm exec prettier --check "apps/api/src/app.module.ts" "apps/api/src/main.ts" "apps/api/src/auth/**/*.ts"
```

**Mensaje de commit sugerido para Cesar:**

```
feat(api): throttling por IP en las rutas publicas

ThrottlerGuard como primer APP_GUARD, para que el freno se aplique antes de
validar el token. Cinco intentos por minuto en login, refresh y auto-registro.
`trust proxy` en main.ts, sin el cual todas las peticiones detras de un proxy
cuentan como un solo cliente.
```

---

## Task 9: Filtro de altas pendientes de revisión

**Files:**
- Modificar: `apps/api/src/usuarios/usuarios.service.ts`
- Modificar: `apps/api/src/usuarios/usuarios.controller.ts`
- Test: `apps/api/src/usuarios/usuarios.service.spec.ts` (modificar)

- [ ] **Step 1: Escribir el test que falla**

Añadir a `apps/api/src/usuarios/usuarios.service.spec.ts`:

```ts
describe('UsuariosService.listar con filtro autoRegistrado', () => {
  it('filtra a traves de la relacion perfil, no por un campo de Usuario', async () => {
    const { servicio, usuario } = crearServicio();

    await servicio.listar(ADMIN, { autoRegistrado: true });

    // El flag vive en Perfil. Un `where: { autoRegistrado: true }` a secas ni
    // siquiera compilaria contra el tipo generado de Prisma.
    expect(usuario.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ perfil: { autoRegistrado: true } }),
      }),
    );
  });

  it('sin el filtro no toca el where de perfil', async () => {
    const { servicio, usuario } = crearServicio();

    await servicio.listar(ADMIN, {});

    expect(usuario.findMany.mock.calls[0][0].where.perfil).toBeUndefined();
  });

  it('se combina con el filtro de sala en vez de pisarlo', async () => {
    const { servicio, usuario } = crearServicio();

    await servicio.listar(ADMIN, { autoRegistrado: true, salaId: 'sala-1' });

    expect(usuario.findMany.mock.calls[0][0].where.perfil).toEqual({
      autoRegistrado: true,
      salas: { some: { salaId: 'sala-1' } },
    });
  });
});
```

`crearServicio()` y `ADMIN` ya existen en ese archivo desde la Fase 1.

- [ ] **Step 2: Ejecutar el test y verlo fallar**

```bash
cd apps/api && pnpm exec jest src/usuarios -t autoRegistrado
```

Esperado: FAIL — el `where.perfil` no contiene `autoRegistrado`.

- [ ] **Step 3: Implementar el filtro**

En `apps/api/src/usuarios/usuarios.service.ts`, añadir al interfaz `FiltroUsuarios`:

```ts
  /** Altas entradas por auto-registro, pendientes de revision del admin. */
  autoRegistrado?: boolean;
```

Y reemplazar en `listar` la línea del filtro de sala por:

```ts
    // El flag `autoRegistrado` vive en Perfil, no en Usuario, asi que los dos
    // filtros que tocan el perfil se combinan en un solo objeto en vez de
    // pisarse el uno al otro.
    const filtroDePerfil: Record<string, unknown> = {};
    if (filtro.autoRegistrado !== undefined) {
      filtroDePerfil.autoRegistrado = filtro.autoRegistrado;
    }
    if (filtro.salaId) {
      filtroDePerfil.salas = { some: { salaId: filtro.salaId } };
    }
    if (Object.keys(filtroDePerfil).length > 0) {
      where.perfil = filtroDePerfil;
    }
```

- [ ] **Step 4: Exponer el parámetro en el controller**

En `apps/api/src/usuarios/usuarios.controller.ts`, en el método `listar`, añadir el parámetro y
pasarlo al servicio:

```ts
    @Query('autoRegistrado', new ParseBoolPipe({ optional: true })) autoRegistrado?: boolean,
```

- [ ] **Step 5: Ejecutar tests y verificar**

```bash
cd apps/api && pnpm exec jest src/usuarios
cd apps/api && pnpm exec tsc --noEmit
cd /d/Dev/box-admin && pnpm exec prettier --check "apps/api/src/usuarios/**/*.ts"
```

Esperado: todo en verde.

**Mensaje de commit sugerido para Cesar:**

```
feat(api): GET /usuarios?autoRegistrado=true

Bandeja de altas pendientes de revision. El flag vive en Perfil, asi que el
filtro va por la relacion y se combina con el de sala en vez de pisarlo.
```

---
## Task 10: El calendario del alumno (solo lectura)

Las dos rutas de consulta. Van antes que las de escritura porque son más simples y porque la de
escritura reutiliza lo que estas resuelven.

**Files:**
- Crear: `apps/api/src/mi-calendario/mi-calendario.service.ts`
- Crear: `apps/api/src/mi-calendario/mi-calendario.controller.ts`
- Crear: `apps/api/src/mi-calendario/mi-calendario.module.ts`
- Modificar: `apps/api/src/app.module.ts`
- Test: `apps/api/src/mi-calendario/mi-calendario.service.spec.ts`

### La regla que separa las dos rutas

El gate de mes `HABILITADO` aplica a **descubrir** turnos, no a ver los propios. `GET /mi-calendario`
devuelve siempre las reservas del alumno; si el admin despublicara un mes, las clases ya reservadas
no desaparecerían de su pantalla. Hacer desaparecer una clase que alguien tiene reservada es peor que
mostrarla.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `apps/api/src/mi-calendario/mi-calendario.service.spec.ts`:

```ts
import { NotFoundException } from '@nestjs/common';
import type { JwtPayload } from '@boxadmin/shared';
import { MiCalendarioService } from './mi-calendario.service';
import type { DisponibilidadService } from '../disponibilidad/disponibilidad.service';
import type { PrismaService } from '../prisma/prisma.service';

const ALUMNO: JwtPayload = { sub: 'usr-1', tenantId: 'gym-1', rol: 'ALUMNO' };

const SALA = {
  activa: true,
  visibleAlumnos: true,
  soloCuposLiberados: false,
  minMinutosCancelar: 120,
  minMinutosAnotarse: null,
  listaEsperaHabilitada: null,
};

const RESERVA = {
  id: 'reserva-1',
  turnoId: 'turno-1',
  perfilId: 'perfil-1',
  origen: 'ALUMNO' as const,
  canceladaEn: null,
  turno: {
    id: 'turno-1',
    salaId: 'sala-1',
    nombre: 'Pilates',
    fecha: new Date('2099-10-02T00:00:00.000Z'),
    horaInicio: '10:00',
    horaFin: '11:00',
    cupo: 5,
    sala: SALA,
  },
};

function crearServicio() {
  const db = {
    perfil: { findFirst: jest.fn().mockResolvedValue({ id: 'perfil-1' }) },
    reserva: { findMany: jest.fn().mockResolvedValue([RESERVA]) },
    turno: { findMany: jest.fn().mockResolvedValue([RESERVA.turno]) },
    usuarioSala: { findMany: jest.fn().mockResolvedValue([{ salaId: 'sala-1' }]) },
  };
  const disponibilidad = {
    configuracionDeSala: jest.fn().mockResolvedValue({
      minMinutosCancelar: 120,
      minMinutosAnotarse: 0,
      listaEsperaHabilitada: false,
    }),
    paraTurno: jest.fn().mockResolvedValue({
      turnoId: 'turno-1',
      estado: 'LIBRE',
      cupo: 5,
      ocupados: 1,
      puedeReservar: true,
      motivo: null,
      enListaEspera: false,
      posicionEnLista: null,
    }),
  };

  return {
    servicio: new MiCalendarioService(
      { db } as unknown as PrismaService,
      disponibilidad as unknown as DisponibilidadService,
    ),
    db,
    disponibilidad,
  };
}

describe('MiCalendarioService.misClases', () => {
  it('devuelve las reservas activas del alumno con los datos del turno', async () => {
    const { servicio } = crearServicio();

    const clases = await servicio.misClases(ALUMNO, {
      desde: '2099-10-01',
      hasta: '2099-10-31',
      ahora: new Date('2099-10-01T00:00:00.000Z'),
    });

    expect(clases).toHaveLength(1);
    expect(clases[0]).toMatchObject({
      reservaId: 'reserva-1',
      turnoId: 'turno-1',
      salaId: 'sala-1',
      nombre: 'Pilates',
      fecha: '2099-10-02',
      horaInicio: '10:00',
      horaFin: '11:00',
      origen: 'ALUMNO',
    });
  });

  it('pide solo las reservas NO canceladas del propio perfil', async () => {
    const { servicio, db } = crearServicio();

    await servicio.misClases(ALUMNO, { desde: '2099-10-01', hasta: '2099-10-31' });

    expect(db.reserva.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ perfilId: 'perfil-1', canceladaEn: null }),
      }),
    );
  });

  it('NO exige que el mes este publicado: son clases que el alumno ya tiene', async () => {
    const { servicio, db } = crearServicio();

    await servicio.misClases(ALUMNO, { desde: '2099-10-01', hasta: '2099-10-31' });

    const where = db.reserva.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).not.toContain('HABILITADO');
  });

  it('calcula puedeCancelar con la ventana de la sala', async () => {
    const { servicio } = crearServicio();

    // El turno empieza el 2 a las 10:00 y la ventana pide 120 minutos.
    const dentro = await servicio.misClases(ALUMNO, {
      desde: '2099-10-01',
      hasta: '2099-10-31',
      ahora: new Date('2099-10-02T07:00:00.000Z'),
    });
    expect(dentro[0].puedeCancelar).toBe(true);

    const fuera = await servicio.misClases(ALUMNO, {
      desde: '2099-10-01',
      hasta: '2099-10-31',
      ahora: new Date('2099-10-02T09:00:00.000Z'),
    });
    expect(fuera[0].puedeCancelar).toBe(false);
  });

  it('404 si el actor no tiene perfil', async () => {
    const { servicio, db } = crearServicio();
    db.perfil.findFirst.mockResolvedValue(null);

    await expect(
      servicio.misClases(ALUMNO, { desde: '2099-10-01', hasta: '2099-10-31' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('MiCalendarioService.turnosDisponibles', () => {
  it('solo mira las salas a las que el alumno tiene acceso', async () => {
    const { servicio, db } = crearServicio();

    await servicio.turnosDisponibles(ALUMNO, { desde: '2099-10-01', hasta: '2099-10-31' });

    expect(db.turno.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ salaId: { in: ['sala-1'] } }),
      }),
    );
  });

  it('con el alumno sin ninguna sala devuelve la lista vacia sin consultar turnos', async () => {
    const { servicio, db } = crearServicio();
    db.usuarioSala.findMany.mockResolvedValue([]);

    const turnos = await servicio.turnosDisponibles(ALUMNO, {
      desde: '2099-10-01',
      hasta: '2099-10-31',
    });

    expect(turnos).toEqual([]);
    // Un `in: []` funcionaria, pero pedir a la base que busque en un conjunto
    // vacio es trabajo tirado.
    expect(db.turno.findMany).not.toHaveBeenCalled();
  });

  it('acota a una sala cuando se pide, siempre dentro de las accesibles', async () => {
    const { servicio, db } = crearServicio();
    db.usuarioSala.findMany.mockResolvedValue([{ salaId: 'sala-1' }, { salaId: 'sala-2' }]);

    await servicio.turnosDisponibles(ALUMNO, {
      desde: '2099-10-01',
      hasta: '2099-10-31',
      salaId: 'sala-2',
    });

    expect(db.turno.findMany.mock.calls[0][0].where.salaId).toEqual({ in: ['sala-2'] });
  });

  it('pedir una sala a la que no tiene acceso devuelve vacio, no un 403', async () => {
    const { servicio, db } = crearServicio();

    const turnos = await servicio.turnosDisponibles(ALUMNO, {
      desde: '2099-10-01',
      hasta: '2099-10-31',
      salaId: 'sala-ajena',
    });

    // Vacio y no 403: contestar "no tienes acceso" confirmaria que esa sala
    // existe. Para descubrir un calendario, el silencio es la respuesta.
    expect(turnos).toEqual([]);
    expect(db.turno.findMany).not.toHaveBeenCalled();
  });

  it('adjunta la disponibilidad de cada turno', async () => {
    const { servicio } = crearServicio();

    const turnos = await servicio.turnosDisponibles(ALUMNO, {
      desde: '2099-10-01',
      hasta: '2099-10-31',
    });

    expect(turnos[0]).toMatchObject({
      turnoId: 'turno-1',
      fecha: '2099-10-02',
      disponibilidad: expect.objectContaining({ estado: 'LIBRE', puedeReservar: true }),
    });
  });
});
```

- [ ] **Step 2: Ejecutar los tests y verlos fallar**

```bash
cd apps/api && pnpm exec jest src/mi-calendario
```

Esperado: FAIL — no existe el módulo.

- [ ] **Step 3: Implementar el servicio**

Crear `apps/api/src/mi-calendario/mi-calendario.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  aFechaISO,
  desdeFechaISO,
  puedeCancelar,
  type JwtPayload,
  type MiClase,
  type TurnoDisponible,
} from '@boxadmin/shared';
import { DisponibilidadService } from '../disponibilidad/disponibilidad.service';
import { PrismaService, type ClientePrismaTx } from '../prisma/prisma.service';

export interface RangoDeConsulta {
  desde: string;
  hasta: string;
  salaId?: string;
  /** Inyectable para los tests; en produccion es el reloj. */
  ahora?: Date;
}

/** Columnas de Sala que hacen falta para resolver la ventana de cancelacion. */
const SALA_PARA_VENTANA = {
  activa: true,
  visibleAlumnos: true,
  soloCuposLiberados: true,
  minMinutosCancelar: true,
  minMinutosAnotarse: true,
  listaEsperaHabilitada: true,
} as const;

@Injectable()
export class MiCalendarioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly disponibilidad: DisponibilidadService,
  ) {}

  /**
   * El perfil del actor. Es la puerta de entrada de las seis rutas del alumno:
   * todas operan sobre SU perfil, nunca sobre un perfilId del cuerpo.
   *
   * Un usuario sin perfil —un admin, por ejemplo— recibe 404, y es correcto: no
   * tiene calendario propio que mostrar.
   */
  async perfilDelActor(
    actor: JwtPayload,
    cliente: ClientePrismaTx = this.prisma.db,
  ): Promise<{ id: string }> {
    const perfil = await cliente.perfil.findFirst({
      where: { usuarioId: actor.sub },
      select: { id: true },
    });
    if (!perfil) {
      throw new NotFoundException(
        'Este usuario no tiene perfil de alumno, asi que no tiene calendario propio.',
      );
    }

    return perfil;
  }

  /**
   * Las clases que el alumno tiene reservadas.
   *
   * NO exige que el mes este publicado, a diferencia de `turnosDisponibles`: el
   * gate de HABILITADO aplica a DESCUBRIR turnos, no a ver los propios. Si el
   * admin despublicara un mes, hacer desaparecer de la pantalla del alumno una
   * clase que tiene reservada seria peor que mostrarla.
   */
  async misClases(actor: JwtPayload, rango: RangoDeConsulta): Promise<MiClase[]> {
    const perfil = await this.perfilDelActor(actor);
    const ahora = rango.ahora ?? new Date();

    const reservas = await this.prisma.db.reserva.findMany({
      where: {
        perfilId: perfil.id,
        canceladaEn: null,
        turno: {
          fecha: { gte: desdeFechaISO(rango.desde), lte: desdeFechaISO(rango.hasta) },
          ...(rango.salaId ? { salaId: rango.salaId } : {}),
        },
      },
      include: { turno: { include: { sala: { select: SALA_PARA_VENTANA } } } },
      orderBy: [{ turno: { fecha: 'asc' } }, { turno: { horaInicio: 'asc' } }],
    });

    const clases: MiClase[] = [];

    for (const reserva of reservas) {
      const config = await this.disponibilidad.configuracionDeSala(reserva.turno.sala);

      clases.push({
        reservaId: reserva.id,
        turnoId: reserva.turno.id,
        salaId: reserva.turno.salaId,
        nombre: reserva.turno.nombre,
        fecha: aFechaISO(reserva.turno.fecha),
        horaInicio: reserva.turno.horaInicio,
        horaFin: reserva.turno.horaFin,
        origen: reserva.origen,
        puedeCancelar: puedeCancelar(
          reserva.turno.fecha,
          reserva.turno.horaInicio,
          config,
          ahora,
        ),
      });
    }

    return clases;
  }

  /**
   * Los turnos que el alumno puede descubrir, con su disponibilidad calculada.
   *
   * Solo de salas a las que tiene acceso. Pedir una sala ajena devuelve la lista
   * vacia y NO un 403: contestar "no tienes acceso" confirmaria que esa sala
   * existe, y para descubrir un calendario el silencio es la respuesta honesta.
   */
  async turnosDisponibles(
    actor: JwtPayload,
    rango: RangoDeConsulta,
  ): Promise<TurnoDisponible[]> {
    const perfil = await this.perfilDelActor(actor);
    const ahora = rango.ahora ?? new Date();

    const accesos = await this.prisma.db.usuarioSala.findMany({
      where: { perfilId: perfil.id },
      select: { salaId: true },
    });

    let salaIds = accesos.map((union) => union.salaId);
    if (rango.salaId) {
      salaIds = salaIds.filter((id) => id === rango.salaId);
    }
    // Sin salas no hay nada que buscar. Un `in: []` funcionaria, pero pedirle a
    // la base que busque en un conjunto vacio es trabajo tirado.
    if (salaIds.length === 0) return [];

    const turnos = await this.prisma.db.turno.findMany({
      where: {
        salaId: { in: salaIds },
        fecha: { gte: desdeFechaISO(rango.desde), lte: desdeFechaISO(rango.hasta) },
      },
      orderBy: [{ fecha: 'asc' }, { horaInicio: 'asc' }],
    });

    const disponibles: TurnoDisponible[] = [];

    for (const turno of turnos) {
      const disponibilidad = await this.disponibilidad.paraTurno(
        actor,
        perfil.id,
        turno.id,
        ahora,
      );

      // Los turnos que el alumno no puede ni descubrir no se listan: un mes sin
      // publicar o una sala oculta no deben aparecer en su calendario ni
      // siquiera en gris.
      if (
        disponibilidad.motivo === 'MES_NO_PUBLICADO' ||
        disponibilidad.motivo === 'SALA_NO_VISIBLE' ||
        disponibilidad.motivo === 'SIN_ACCESO_A_SALA'
      ) {
        continue;
      }

      disponibles.push({
        turnoId: turno.id,
        salaId: turno.salaId,
        nombre: turno.nombre,
        fecha: aFechaISO(turno.fecha),
        horaInicio: turno.horaInicio,
        horaFin: turno.horaFin,
        disponibilidad,
      });
    }

    return disponibles;
  }
}
```

- [ ] **Step 4: Ejecutar los tests y verlos pasar**

```bash
cd apps/api && pnpm exec jest src/mi-calendario
```

Esperado: PASS, 10 tests.

- [ ] **Step 5: Escribir el controller**

Crear `apps/api/src/mi-calendario/mi-calendario.controller.ts`:

```ts
import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import {
  esFechaValida,
  type JwtPayload,
  type MiClase,
  type TurnoDisponible,
} from '@boxadmin/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { MiCalendarioService } from './mi-calendario.service';

@Controller()
export class MiCalendarioController {
  constructor(private readonly miCalendario: MiCalendarioService) {}

  @Roles('ALUMNO')
  @Get('mi-calendario')
  misClases(
    @CurrentUser() actor: JwtPayload,
    @Query('desde') desde: string,
    @Query('hasta') hasta: string,
    @Query('salaId') salaId?: string,
  ): Promise<MiClase[]> {
    exigirRango(desde, hasta);
    return this.miCalendario.misClases(actor, { desde, hasta, salaId });
  }

  @Roles('ALUMNO')
  @Get('turnos-disponibles')
  turnosDisponibles(
    @CurrentUser() actor: JwtPayload,
    @Query('desde') desde: string,
    @Query('hasta') hasta: string,
    @Query('salaId') salaId?: string,
  ): Promise<TurnoDisponible[]> {
    exigirRango(desde, hasta);
    return this.miCalendario.turnosDisponibles(actor, { desde, hasta, salaId });
  }
}

/**
 * Los query params no pasan por el ValidationPipe de los DTOs, asi que se
 * validan a mano. Sin rango, la consulta traeria el historico entero.
 */
function exigirRango(desde: string, hasta: string): void {
  if (!desde || !hasta) {
    throw new BadRequestException('Hacen falta los parametros desde y hasta (YYYY-MM-DD)');
  }
  if (!esFechaValida(desde) || !esFechaValida(hasta)) {
    throw new BadRequestException('desde y hasta deben tener formato YYYY-MM-DD');
  }
  if (hasta < desde) {
    throw new BadRequestException('hasta no puede ser anterior a desde');
  }
}
```

- [ ] **Step 6: Crear y registrar el módulo**

Crear `apps/api/src/mi-calendario/mi-calendario.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { DisponibilidadModule } from '../disponibilidad/disponibilidad.module';
import { MiCalendarioController } from './mi-calendario.controller';
import { MiCalendarioService } from './mi-calendario.service';

@Module({
  imports: [DisponibilidadModule],
  controllers: [MiCalendarioController],
  providers: [MiCalendarioService],
  exports: [MiCalendarioService],
})
export class MiCalendarioModule {}
```

En `apps/api/src/app.module.ts`, importar `MiCalendarioModule` y añadirlo al array `imports`.

- [ ] **Step 7: Verificar**

```bash
cd apps/api && pnpm exec tsc --noEmit && pnpm test
cd /d/Dev/box-admin && pnpm exec prettier --check "apps/api/src/mi-calendario/**/*.ts"
```

**Mensaje de commit sugerido para Cesar:**

```
feat(api): GET /mi-calendario y GET /turnos-disponibles

El gate de mes HABILITADO aplica a descubrir turnos, no a ver los propios: una
clase ya reservada no desaparece de la pantalla del alumno si el admin
despublica el mes. Pedir una sala ajena devuelve vacio y no 403, para no
confirmar que existe.
```

---

## Task 11: El hook de notificaciones

Diez líneas que existen para que la Task 12 tenga dónde llamar. Va antes porque es su dependencia.

**Files:**
- Crear: `apps/api/src/notificaciones/notificaciones.service.ts`
- Crear: `apps/api/src/notificaciones/notificaciones.module.ts`
- Modificar: `apps/api/src/app.module.ts`
- Test: `apps/api/src/notificaciones/notificaciones.service.spec.ts`

- [ ] **Step 1: Escribir el test**

Crear `apps/api/src/notificaciones/notificaciones.service.spec.ts`:

```ts
import { NotificacionesService } from './notificaciones.service';

describe('NotificacionesService', () => {
  it('cupoAsignado no lanza y no devuelve nada', async () => {
    const servicio = new NotificacionesService();

    // Es un hook inerte a proposito: las notificaciones reales llegan en la
    // Fase 5. Lo que este test protege es que NUNCA lance, porque se llama
    // dentro de la transaccion que asigna un cupo: una excepcion aqui
    // revertiria una reserva perfectamente valida.
    await expect(
      servicio.cupoAsignado({
        tenantId: 'gym-1',
        perfilId: 'perfil-1',
        turnoId: 'turno-1',
        reservaId: 'reserva-1',
      }),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Ejecutar y ver fallar**

```bash
cd apps/api && pnpm exec jest src/notificaciones
```

Esperado: FAIL — no existe el módulo.

- [ ] **Step 3: Implementar el hook**

Crear `apps/api/src/notificaciones/notificaciones.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';

export interface CupoAsignado {
  tenantId: string;
  perfilId: string;
  turnoId: string;
  reservaId: string;
}

/**
 * El enganche que la Fase 5 va a llenar con push y email.
 *
 * Hoy solo deja rastro en el log. Existe igualmente porque el punto exacto
 * donde hay que notificar —dentro de la transaccion que asigna el cupo, cuando
 * ya se sabe que la reserva se creo— es facil de perder de vista despues, y
 * mucho mas barato de dejar marcado ahora.
 *
 * INVARIANTE: este metodo NUNCA debe lanzar. Se llama dentro de la transaccion
 * que asigna el cupo, asi que una excepcion aqui revertiria una reserva
 * perfectamente valida. Cuando la Fase 5 meta aqui una llamada de red, tiene
 * que ir envuelta en su propio try/catch o salir de la transaccion.
 */
@Injectable()
export class NotificacionesService {
  private readonly logger = new Logger(NotificacionesService.name);

  async cupoAsignado(evento: CupoAsignado): Promise<void> {
    this.logger.log(
      `Cupo liberado asignado desde lista de espera: perfil ${evento.perfilId}, ` +
        `turno ${evento.turnoId}, reserva ${evento.reservaId}. ` +
        'Sin notificacion real hasta la Fase 5.',
    );
  }
}
```

- [ ] **Step 4: Crear y registrar el módulo**

Crear `apps/api/src/notificaciones/notificaciones.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { NotificacionesService } from './notificaciones.service';

@Module({
  providers: [NotificacionesService],
  exports: [NotificacionesService],
})
export class NotificacionesModule {}
```

En `apps/api/src/app.module.ts`, importarlo y añadirlo al array `imports`.

- [ ] **Step 5: Verificar**

```bash
cd apps/api && pnpm exec jest src/notificaciones && pnpm exec tsc --noEmit
cd /d/Dev/box-admin && pnpm exec prettier --check "apps/api/src/notificaciones/**/*.ts"
```

**Mensaje de commit sugerido para Cesar:**

```
feat(api): hook inerte de notificaciones

Marca el punto exacto donde la Fase 5 tiene que notificar un cupo asignado.
Documentado el invariante de que nunca puede lanzar: corre dentro de la
transaccion que crea la reserva.
```

---

## Task 12: Lista de espera y asignación automática

La tarea más delicada de la fase: toca código de la Fase 1 que hoy funciona y está probado.

**Files:**
- Crear: `apps/api/src/lista-espera/lista-espera.service.ts`
- Crear: `apps/api/src/lista-espera/lista-espera.module.ts`
- Modificar: `apps/api/src/reservas/reservas.service.ts`
- Modificar: `apps/api/src/reservas/reservas.module.ts`
- Test: `apps/api/src/lista-espera/lista-espera.service.spec.ts`
- Test: `apps/api/src/reservas/reservas.service.spec.ts` (modificar)

### Por qué hay que tocar la Fase 1

`ReservasService.cancelar` hoy **no** corre en Serializable, porque cancelar no competía por ningún
cupo. Al asignar el cupo liberado, pasa a competir: dos cancelaciones simultáneas sobre el mismo
turno podrían asignar el mismo lugar a dos personas de la cola.

**Los tests actuales de `cancelar` tienen que seguir pasando sin modificarse.** Si alguno falla,
el cambio está mal hecho: no lo "arregles" editando el test.

- [ ] **Step 1: Escribir los tests de `ListaEsperaService`**

Crear `apps/api/src/lista-espera/lista-espera.service.spec.ts`:

```ts
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { JwtPayload } from '@boxadmin/shared';
import { ListaEsperaService } from './lista-espera.service';
import type { DisponibilidadService } from '../disponibilidad/disponibilidad.service';
import type { HistorialService } from '../common/historial/historial.service';
import type { NotificacionesService } from '../notificaciones/notificaciones.service';
import type { PrismaService } from '../prisma/prisma.service';

const ALUMNO: JwtPayload = { sub: 'usr-1', tenantId: 'gym-1', rol: 'ALUMNO' };

const EN_LISTA_ESPERA = {
  turnoId: 'turno-1',
  estado: 'LISTA_ESPERA' as const,
  cupo: 5,
  ocupados: 5,
  puedeReservar: false,
  motivo: null,
  enListaEspera: false,
  posicionEnLista: null,
};

function crearServicio() {
  const listaEspera = {
    findFirst: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({
      id: 'le-1',
      tenantId: 'gym-1',
      turnoId: 'turno-1',
      perfilId: 'perfil-1',
      notificado: false,
      createdAt: new Date('2099-10-01T00:00:00.000Z'),
    }),
    deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const reserva = {
    create: jest.fn().mockResolvedValue({ id: 'reserva-nueva' }),
    findFirst: jest.fn().mockResolvedValue(null),
  };
  const perfil = { findFirst: jest.fn().mockResolvedValue({ id: 'perfil-1' }) };

  const db = {
    listaEspera,
    reserva,
    perfil,
    $transaction: jest.fn((fn: (tx: unknown) => unknown): unknown => fn(db)),
  };
  const disponibilidad = { paraTurno: jest.fn().mockResolvedValue(EN_LISTA_ESPERA) };
  const historial = { registrar: jest.fn().mockResolvedValue(undefined) };
  const notificaciones = { cupoAsignado: jest.fn().mockResolvedValue(undefined) };

  return {
    servicio: new ListaEsperaService(
      { db } as unknown as PrismaService,
      disponibilidad as unknown as DisponibilidadService,
      historial as unknown as HistorialService,
      notificaciones as unknown as NotificacionesService,
    ),
    listaEspera,
    reserva,
    disponibilidad,
    historial,
    notificaciones,
    db,
  };
}

describe('ListaEsperaService.anotarse', () => {
  it('anota al alumno cuando el turno esta en LISTA_ESPERA', async () => {
    const { servicio, listaEspera } = crearServicio();

    const entrada = await servicio.anotarse(ALUMNO, 'turno-1');

    expect(listaEspera.create).toHaveBeenCalledWith({
      data: { tenantId: 'gym-1', turnoId: 'turno-1', perfilId: 'perfil-1' },
    });
    expect(entrada).toMatchObject({ id: 'le-1', turnoId: 'turno-1', posicion: 1 });
  });

  it('rechaza anotarse en un turno con cupo libre', async () => {
    const { servicio, disponibilidad } = crearServicio();
    disponibilidad.paraTurno.mockResolvedValue({ ...EN_LISTA_ESPERA, estado: 'LIBRE', ocupados: 1 });

    // Si hay cupo, lo que corresponde es reservar, no hacer cola.
    await expect(servicio.anotarse(ALUMNO, 'turno-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('rechaza anotarse en un turno LLENO sin lista de espera habilitada', async () => {
    const { servicio, disponibilidad } = crearServicio();
    disponibilidad.paraTurno.mockResolvedValue({ ...EN_LISTA_ESPERA, estado: 'LLENO' });

    await expect(servicio.anotarse(ALUMNO, 'turno-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('rechaza anotarse si el alumno no tiene acceso a la sala', async () => {
    const { servicio, disponibilidad } = crearServicio();
    disponibilidad.paraTurno.mockResolvedValue({
      ...EN_LISTA_ESPERA,
      motivo: 'SIN_ACCESO_A_SALA',
    });

    await expect(servicio.anotarse(ALUMNO, 'turno-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rechaza anotarse dos veces en el mismo turno', async () => {
    const { servicio, disponibilidad } = crearServicio();
    disponibilidad.paraTurno.mockResolvedValue({ ...EN_LISTA_ESPERA, enListaEspera: true, posicionEnLista: 3 });

    await expect(servicio.anotarse(ALUMNO, 'turno-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('la posicion sale del orden de la cola, no de un contador', async () => {
    const { servicio, listaEspera } = crearServicio();
    listaEspera.findMany.mockResolvedValue([
      { perfilId: 'otro-1' },
      { perfilId: 'otro-2' },
      { perfilId: 'perfil-1' },
    ]);

    const entrada = await servicio.anotarse(ALUMNO, 'turno-1');

    expect(entrada.posicion).toBe(3);
    expect(listaEspera.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    );
  });
});

describe('ListaEsperaService.salirse', () => {
  it('borra la fila del alumno', async () => {
    const { servicio, listaEspera } = crearServicio();
    listaEspera.findFirst.mockResolvedValue({ id: 'le-1', turnoId: 'turno-1', perfilId: 'perfil-1' });

    await servicio.salirse(ALUMNO, 'le-1');

    expect(listaEspera.deleteMany).toHaveBeenCalledWith({ where: { id: 'le-1' } });
  });

  it('404 si la entrada no existe', async () => {
    const { servicio } = crearServicio();

    await expect(servicio.salirse(ALUMNO, 'le-9')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('403 si la entrada es de otro alumno', async () => {
    const { servicio, listaEspera } = crearServicio();
    listaEspera.findFirst.mockResolvedValue({ id: 'le-1', turnoId: 'turno-1', perfilId: 'otro' });

    await expect(servicio.salirse(ALUMNO, 'le-1')).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('ListaEsperaService.asignarPrimero', () => {
  const PRIMERO = {
    id: 'le-1',
    tenantId: 'gym-1',
    turnoId: 'turno-1',
    perfilId: 'perfil-7',
    createdAt: new Date('2099-10-01T00:00:00.000Z'),
  };

  it('sin nadie en la cola no hace nada', async () => {
    const { servicio, reserva, db } = crearServicio();

    const asignada = await servicio.asignarPrimero(ALUMNO, 'turno-1', db as never);

    expect(asignada).toBeNull();
    expect(reserva.create).not.toHaveBeenCalled();
  });

  it('crea la reserva del primero con origen LISTA_ESPERA', async () => {
    const { servicio, listaEspera, reserva, db } = crearServicio();
    listaEspera.findMany.mockResolvedValue([PRIMERO]);

    await servicio.asignarPrimero(ALUMNO, 'turno-1', db as never);

    expect(reserva.create).toHaveBeenCalledWith({
      data: { tenantId: 'gym-1', turnoId: 'turno-1', perfilId: 'perfil-7', origen: 'LISTA_ESPERA' },
    });
  });

  it('borra la fila de la cola al asignar', async () => {
    const { servicio, listaEspera, db } = crearServicio();
    listaEspera.findMany.mockResolvedValue([PRIMERO]);

    await servicio.asignarPrimero(ALUMNO, 'turno-1', db as never);

    expect(listaEspera.deleteMany).toHaveBeenCalledWith({ where: { id: 'le-1' } });
  });

  it('toma al PRIMERO de la cola, ordenada por createdAt e id', async () => {
    const { servicio, listaEspera, reserva, db } = crearServicio();
    listaEspera.findMany.mockResolvedValue([PRIMERO, { ...PRIMERO, id: 'le-2', perfilId: 'perfil-8' }]);

    await servicio.asignarPrimero(ALUMNO, 'turno-1', db as never);

    expect(reserva.create.mock.calls[0][0].data.perfilId).toBe('perfil-7');
    expect(listaEspera.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    );
  });

  it('dispara el hook de notificacion', async () => {
    const { servicio, listaEspera, notificaciones, db } = crearServicio();
    listaEspera.findMany.mockResolvedValue([PRIMERO]);

    await servicio.asignarPrimero(ALUMNO, 'turno-1', db as never);

    expect(notificaciones.cupoAsignado).toHaveBeenCalledWith({
      tenantId: 'gym-1',
      perfilId: 'perfil-7',
      turnoId: 'turno-1',
      reservaId: 'reserva-nueva',
    });
  });

  it('salta a quien ya tenga una reserva activa en ese turno', async () => {
    const { servicio, listaEspera, reserva, db } = crearServicio();
    listaEspera.findMany.mockResolvedValue([PRIMERO, { ...PRIMERO, id: 'le-2', perfilId: 'perfil-8' }]);
    // El primero ya esta dentro: alguien lo reservo manualmente mientras hacia cola.
    reserva.findFirst.mockImplementation((args: { where: { perfilId: string } }) =>
      Promise.resolve(args.where.perfilId === 'perfil-7' ? { id: 'ya-tiene' } : null),
    );

    await servicio.asignarPrimero(ALUMNO, 'turno-1', db as never);

    expect(reserva.create.mock.calls[0][0].data.perfilId).toBe('perfil-8');
    // Y su fila de la cola se limpia igualmente: ya no pinta nada ahi.
    expect(listaEspera.deleteMany).toHaveBeenCalledWith({ where: { id: 'le-1' } });
  });
});
```

- [ ] **Step 2: Ejecutar los tests y verlos fallar**

```bash
cd apps/api && pnpm exec jest src/lista-espera
```

Esperado: FAIL — no existe el módulo.

- [ ] **Step 3: Implementar `ListaEsperaService`**

Crear `apps/api/src/lista-espera/lista-espera.service.ts`:

```ts
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { EntradaListaEspera, JwtPayload } from '@boxadmin/shared';
import { HistorialService } from '../common/historial/historial.service';
import { DisponibilidadService } from '../disponibilidad/disponibilidad.service';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import { PrismaService, type ClientePrismaTx } from '../prisma/prisma.service';

@Injectable()
export class ListaEsperaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly disponibilidad: DisponibilidadService,
    private readonly historial: HistorialService,
    private readonly notificaciones: NotificacionesService,
  ) {}

  /**
   * Anotarse solo es posible cuando el turno esta en LISTA_ESPERA. Delegar la
   * decision en DisponibilidadService en vez de repetir las reglas aqui es lo
   * que evita que "cuando se puede hacer cola" acabe definido en dos sitios que
   * se separan con el tiempo.
   */
  async anotarse(actor: JwtPayload, turnoId: string): Promise<EntradaListaEspera> {
    const perfil = await this.prisma.db.perfil.findFirst({
      where: { usuarioId: actor.sub },
      select: { id: true },
    });
    if (!perfil) throw new NotFoundException('Este usuario no tiene perfil de alumno');

    const estado = await this.disponibilidad.paraTurno(actor, perfil.id, turnoId);

    if (estado.motivo === 'SIN_ACCESO_A_SALA' || estado.motivo === 'SALA_NO_VISIBLE') {
      throw new ForbiddenException('No tienes acceso a la sala de este turno');
    }
    if (estado.motivo === 'MES_NO_PUBLICADO') {
      throw new ConflictException('El mes de este turno todavia no esta publicado');
    }
    if (estado.enListaEspera) {
      throw new ConflictException(
        `Ya estas en la lista de espera de este turno, en la posicion ${estado.posicionEnLista}`,
      );
    }
    if (estado.estado === 'LIBRE') {
      throw new ConflictException('Este turno tiene cupo: reservalo en vez de hacer cola');
    }
    if (estado.estado !== 'LISTA_ESPERA') {
      throw new ConflictException(
        'Este turno no admite lista de espera. Hablalo con el salon.',
      );
    }

    const entrada = await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      const creada = await cliente.listaEspera.create({
        data: { tenantId: actor.tenantId, turnoId, perfilId: perfil.id },
      });

      await this.historial.registrar(
        {
          actor,
          entidad: 'ListaEspera',
          entidadId: creada.id,
          accion: 'ANOTADO',
          detalle: { turnoId, perfilId: perfil.id },
        },
        cliente,
      );

      return creada;
    });

    return {
      ...this.aPublica(entrada),
      posicion: await this.posicionDe(turnoId, perfil.id),
    };
  }

  async salirse(actor: JwtPayload, id: string): Promise<void> {
    const perfil = await this.prisma.db.perfil.findFirst({
      where: { usuarioId: actor.sub },
      select: { id: true },
    });
    if (!perfil) throw new NotFoundException('Este usuario no tiene perfil de alumno');

    await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      const entrada = await cliente.listaEspera.findFirst({ where: { id } });
      if (!entrada) throw new NotFoundException('No estas en esa lista de espera');
      // 403 y no 404 a proposito, igual que en UsuariosService.obtener: el actor
      // sabe que el recurso existe porque acaba de pasar su id.
      if (entrada.perfilId !== perfil.id) {
        throw new ForbiddenException('Solo puedes salirte de tu propia lista de espera');
      }

      await cliente.listaEspera.deleteMany({ where: { id } });

      await this.historial.registrar(
        {
          actor,
          entidad: 'ListaEspera',
          entidadId: id,
          accion: 'SALIDO',
          detalle: { turnoId: entrada.turnoId },
        },
        cliente,
      );
    });
  }

  /**
   * Da el cupo recien liberado al primero de la cola.
   *
   * Se llama DENTRO de la transaccion que cancela la reserva, y recibe su
   * `cliente`: la asignacion tiene que revertirse con la cancelacion que la
   * origino. Si se hiciera fuera, una cancelacion que fallara despues dejaria
   * una reserva de la cola que nadie pidio.
   *
   * NO re-valida el pack ni la ventana del beneficiario. El lugar es suyo por
   * posicion en la cola; las validaciones son del momento de anotarse. Si la
   * reserva lo pasa de su pack, es la misma situacion que cualquier otra reserva
   * por encima del tope: se avisa, no se bloquea (decision D3 de la Fase 1).
   */
  async asignarPrimero(
    actor: JwtPayload,
    turnoId: string,
    cliente: ClientePrismaTx,
  ): Promise<{ reservaId: string; perfilId: string } | null> {
    const cola = await cliente.listaEspera.findMany({
      where: { turnoId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    for (const entrada of cola) {
      // Alguien puede haber entrado por otra via mientras hacia cola (un admin
      // se lo asigno a mano, por ejemplo). Su fila se limpia igual, porque ya no
      // pinta nada ahi, y el cupo pasa al siguiente.
      const yaDentro = await cliente.reserva.findFirst({
        where: { turnoId, perfilId: entrada.perfilId, canceladaEn: null },
      });

      await cliente.listaEspera.deleteMany({ where: { id: entrada.id } });

      if (yaDentro) continue;

      const reserva = await cliente.reserva.create({
        data: {
          tenantId: actor.tenantId,
          turnoId,
          perfilId: entrada.perfilId,
          origen: 'LISTA_ESPERA',
        },
      });

      await this.historial.registrar(
        {
          actor,
          entidad: 'Reserva',
          entidadId: reserva.id,
          accion: 'ASIGNADA_DESDE_LISTA',
          // El origen queda registrado para que el alumno pueda entender
          // despues por que aparecio una clase que no reservo.
          detalle: { turnoId, perfilId: entrada.perfilId, desdeListaEspera: entrada.id },
        },
        cliente,
      );

      await this.notificaciones.cupoAsignado({
        tenantId: actor.tenantId,
        perfilId: entrada.perfilId,
        turnoId,
        reservaId: reserva.id,
      });

      return { reservaId: reserva.id, perfilId: entrada.perfilId };
    }

    return null;
  }

  /** La posicion se deriva del orden: 1 = el proximo en entrar. */
  private async posicionDe(turnoId: string, perfilId: string): Promise<number> {
    const cola = await this.prisma.db.listaEspera.findMany({
      where: { turnoId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    return cola.findIndex((fila) => fila.perfilId === perfilId) + 1;
  }

  private aPublica(fila: {
    id: string;
    tenantId: string;
    turnoId: string;
    perfilId: string;
    notificado: boolean;
    createdAt: Date;
  }): EntradaListaEspera {
    return {
      id: fila.id,
      tenantId: fila.tenantId,
      turnoId: fila.turnoId,
      perfilId: fila.perfilId,
      posicion: 0, // lo sobrescribe quien llama
      notificado: fila.notificado,
      createdAt: fila.createdAt.toISOString(),
    };
  }
}
```

- [ ] **Step 4: Ejecutar los tests y verlos pasar**

```bash
cd apps/api && pnpm exec jest src/lista-espera
```

Esperado: PASS, 15 tests.

- [ ] **Step 5: Escribir el test de la asignación al cancelar**

Añadir a `apps/api/src/reservas/reservas.service.spec.ts`:

```ts
describe('ReservasService.cancelar dispara la lista de espera', () => {
  it('corre en Serializable: al asignar el cupo pasa a competir por el', async () => {
    const { servicio, db } = crearServicio();

    await servicio.cancelar(ADMIN, 'reserva-1', 'RECUPERABLE');

    // Antes de la Fase 3A esta transaccion no llevaba isolationLevel, porque
    // cancelar no competia por ningun cupo. Ahora si: dos cancelaciones
    // simultaneas sobre el mismo turno podrian dar el mismo lugar a dos
    // personas de la cola.
    expect(db.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: 'Serializable' }),
    );
  });

  it('llama a asignarPrimero con el MISMO cliente de la transaccion', async () => {
    const { servicio, listaEspera, db } = crearServicio();

    await servicio.cancelar(ADMIN, 'reserva-1', 'RECUPERABLE');

    // Mismo cliente = misma transaccion. Si se pasara `this.prisma.db`, una
    // cancelacion que fallara despues dejaria una reserva de la cola que nadie
    // pidio.
    expect(listaEspera.asignarPrimero).toHaveBeenCalledWith(ADMIN, 'turno-1', db);
  });

  it('asigna DESPUES de marcar la cancelacion, no antes', async () => {
    const { servicio, reserva, listaEspera } = crearServicio();

    await servicio.cancelar(ADMIN, 'reserva-1', 'RECUPERABLE');

    // Al reves, el cupo seguiria ocupado y la asignacion encontraria el turno
    // lleno.
    expect(reserva.update.mock.invocationCallOrder[0]).toBeLessThan(
      listaEspera.asignarPrimero.mock.invocationCallOrder[0],
    );
  });
});
```

Añade a la fábrica `crearServicio()` de ese archivo un doble de `ListaEsperaService`:

```ts
  const listaEspera = { asignarPrimero: jest.fn().mockResolvedValue(null) };
```

y pásalo como **tercer** argumento del constructor, después de `prisma` e `historial`.

- [ ] **Step 6: Ejecutar y ver fallar**

```bash
cd apps/api && pnpm exec jest src/reservas
```

Esperado: FAIL — el constructor no acepta ese argumento.

- [ ] **Step 7: Modificar `ReservasService.cancelar`**

En `apps/api/src/reservas/reservas.service.ts`, añadir la dependencia al constructor:

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly historial: HistorialService,
    private readonly listaEspera: ListaEsperaService,
  ) {}
```

Y reemplazar el cuerpo de `cancelar` por:

```ts
  /**
   * Cancela una reserva. Nunca borra la fila: el historial de un alumno se
   * calcula sobre sus reservas, y borrarlas reescribiria el pasado.
   *
   * RECUPERABLE deja de contar contra el pack; DEFINITIVA sigue contando. El
   * efecto es automatico porque el consumo se deriva de las reservas — no hay
   * ningun contador que ajustar aqui.
   *
   * CAMBIO DE LA FASE 3A: pasa a Serializable con reintento. Hasta ahora
   * cancelar no competia por ningun cupo, asi que no hacia falta; desde que
   * libera un lugar y se lo da al primero de la lista de espera, dos
   * cancelaciones simultaneas sobre el mismo turno podrian asignar el mismo
   * lugar a dos personas distintas.
   */
  async cancelar(actor: JwtPayload, id: string, tipo: TipoCancelacion): Promise<ReservaPublica> {
    return this.conReintentoDeCupo(() =>
      this.prisma.db.$transaction(
        async (tx) => {
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
          // correcciones del salon.
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

          // DESPUES de marcar la cancelacion: al reves, el cupo seguiria
          // ocupado y la asignacion encontraria el turno lleno. Y con el MISMO
          // cliente, para que la reserva asignada se revierta junto con la
          // cancelacion si algo falla mas abajo.
          await this.listaEspera.asignarPrimero(actor, reserva.turnoId, cliente);

          return aReservaPublica(cancelada);
        },
        { isolationLevel: 'Serializable' },
      ),
    );
  }
```

- [ ] **Step 8: Crear el módulo de lista de espera y conectar el de reservas**

Crear `apps/api/src/lista-espera/lista-espera.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { DisponibilidadModule } from '../disponibilidad/disponibilidad.module';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { ListaEsperaService } from './lista-espera.service';

@Module({
  imports: [DisponibilidadModule, NotificacionesModule],
  providers: [ListaEsperaService],
  exports: [ListaEsperaService],
})
export class ListaEsperaModule {}
```

En `apps/api/src/reservas/reservas.module.ts`, añadir `ListaEsperaModule` al array `imports`.

En `apps/api/src/app.module.ts`, importar y añadir `ListaEsperaModule`.

- [ ] **Step 9: Ejecutar todos los tests**

```bash
cd apps/api && pnpm exec jest src/reservas src/lista-espera
```

Esperado: PASS. **Los tests de `cancelar` que ya existían desde la Fase 1 tienen que seguir pasando
sin que los toques.** Si alguno falla, revisa el cambio: no edites el test.

- [ ] **Step 10: Verificar la suite entera y los e2e**

```bash
cd apps/api && pnpm exec tsc --noEmit && pnpm test && pnpm test:e2e
cd /d/Dev/box-admin && pnpm exec prettier --check "apps/api/src/lista-espera/**/*.ts" "apps/api/src/reservas/**/*.ts"
```

Esperado: todo en verde, 79/79 e2e.

**Mensaje de commit sugerido para Cesar:**

```
feat(api): lista de espera con asignacion automatica del cupo liberado

La posicion se deriva del orden por (createdAt, id), sin contador guardado.
cancelar pasa a Serializable con reintento: desde que asigna el cupo liberado
compite por el. La asignacion va dentro de la misma transaccion y salta a quien
ya tenga reserva activa en el turno.
```

---
## Task 13: Reservar y cancelar por cuenta propia

Las cuatro rutas de escritura del alumno. Se apoyan en todo lo anterior.

**Files:**
- Modificar: `apps/api/src/mi-calendario/mi-calendario.service.ts`
- Modificar: `apps/api/src/mi-calendario/mi-calendario.controller.ts`
- Modificar: `apps/api/src/mi-calendario/mi-calendario.module.ts`
- Test: `apps/api/src/mi-calendario/mi-reservas.service.spec.ts` (crear)

- [ ] **Step 1: Escribir los tests que fallan**

Crear `apps/api/src/mi-calendario/mi-reservas.service.spec.ts`:

```ts
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { JwtPayload } from '@boxadmin/shared';
import { MiCalendarioService } from './mi-calendario.service';
import type { DisponibilidadService } from '../disponibilidad/disponibilidad.service';
import type { HistorialService } from '../common/historial/historial.service';
import type { ListaEsperaService } from '../lista-espera/lista-espera.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { ReservasService } from '../reservas/reservas.service';

const ALUMNO: JwtPayload = { sub: 'usr-1', tenantId: 'gym-1', rol: 'ALUMNO' };

const LIBRE = {
  turnoId: 'turno-1',
  estado: 'LIBRE' as const,
  cupo: 5,
  ocupados: 1,
  puedeReservar: true,
  motivo: null,
  enListaEspera: false,
  posicionEnLista: null,
};

const RESERVA = {
  id: 'reserva-1',
  perfilId: 'perfil-1',
  turnoId: 'turno-1',
  canceladaEn: null,
  turno: {
    fecha: new Date('2099-10-02T00:00:00.000Z'),
    horaInicio: '10:00',
    sala: {
      activa: true,
      visibleAlumnos: true,
      soloCuposLiberados: false,
      minMinutosCancelar: 120,
      minMinutosAnotarse: null,
      listaEsperaHabilitada: null,
    },
  },
};

function crearServicio() {
  const db = {
    perfil: { findFirst: jest.fn().mockResolvedValue({ id: 'perfil-1' }) },
    reserva: { findFirst: jest.fn().mockResolvedValue(RESERVA), findMany: jest.fn() },
    turno: { findMany: jest.fn() },
    usuarioSala: { findMany: jest.fn() },
  };
  const disponibilidad = {
    paraTurno: jest.fn().mockResolvedValue(LIBRE),
    configuracionDeSala: jest.fn().mockResolvedValue({
      minMinutosCancelar: 120,
      minMinutosAnotarse: 0,
      listaEsperaHabilitada: false,
    }),
  };
  const reservas = {
    crear: jest.fn().mockResolvedValue({ id: 'reserva-nueva', advertencias: [] }),
    cancelar: jest.fn().mockResolvedValue({ id: 'reserva-1', canceladaEn: 'x' }),
  };

  return {
    servicio: new MiCalendarioService(
      { db } as unknown as PrismaService,
      disponibilidad as unknown as DisponibilidadService,
      reservas as unknown as ReservasService,
    ),
    db,
    disponibilidad,
    reservas,
  };
}

describe('MiCalendarioService.reservar', () => {
  it('delega en ReservasService con origen ALUMNO y el perfil del actor', async () => {
    const { servicio, reservas } = crearServicio();

    await servicio.reservar(ALUMNO, 'turno-1');

    // El perfilId sale del actor, NUNCA del cuerpo: si viniera del cliente, un
    // alumno podria reservar a nombre de otro.
    expect(reservas.crear).toHaveBeenCalledWith(ALUMNO, 'turno-1', {
      perfilId: 'perfil-1',
      origen: 'ALUMNO',
    });
  });

  it('propaga las advertencias de pack: el pack avisa, no bloquea', async () => {
    const { servicio, reservas } = crearServicio();
    reservas.crear.mockResolvedValue({
      id: 'reserva-nueva',
      advertencias: [{ codigo: 'PACK_AGOTADO', mensaje: 'x' }],
    });

    const creada = await servicio.reservar(ALUMNO, 'turno-1');

    // Decision D3 de la Fase 1, que esta fase mantiene: pasarse del pack no
    // impide reservar.
    expect(creada.advertencias).toHaveLength(1);
  });

  it('403 si no tiene acceso a la sala', async () => {
    const { servicio, disponibilidad } = crearServicio();
    disponibilidad.paraTurno.mockResolvedValue({
      ...LIBRE,
      puedeReservar: false,
      motivo: 'SIN_ACCESO_A_SALA',
    });

    await expect(servicio.reservar(ALUMNO, 'turno-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('409 con la ventana de anotacion cerrada', async () => {
    const { servicio, disponibilidad, reservas } = crearServicio();
    disponibilidad.paraTurno.mockResolvedValue({
      ...LIBRE,
      puedeReservar: false,
      motivo: 'VENTANA_CERRADA',
    });

    await expect(servicio.reservar(ALUMNO, 'turno-1')).rejects.toBeInstanceOf(ConflictException);
    expect(reservas.crear).not.toHaveBeenCalled();
  });

  it('409 con el mes sin publicar', async () => {
    const { servicio, disponibilidad } = crearServicio();
    disponibilidad.paraTurno.mockResolvedValue({
      ...LIBRE,
      puedeReservar: false,
      motivo: 'MES_NO_PUBLICADO',
    });

    await expect(servicio.reservar(ALUMNO, 'turno-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('409 en una sala de solo cupos liberados sin cancelaciones', async () => {
    const { servicio, disponibilidad } = crearServicio();
    disponibilidad.paraTurno.mockResolvedValue({
      ...LIBRE,
      estado: 'SOLO_ADMIN',
      puedeReservar: false,
      motivo: 'SOLO_CUPOS_LIBERADOS',
    });

    await expect(servicio.reservar(ALUMNO, 'turno-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('el mensaje de un turno en LISTA_ESPERA sugiere anotarse, no un error generico', async () => {
    const { servicio, disponibilidad } = crearServicio();
    disponibilidad.paraTurno.mockResolvedValue({
      ...LIBRE,
      estado: 'LISTA_ESPERA',
      ocupados: 5,
      puedeReservar: false,
      motivo: null,
    });

    // Punto del checklist del PDF: "reservar un turno lleno ofrece anotarse en
    // lista de espera en vez de un error generico".
    await expect(servicio.reservar(ALUMNO, 'turno-1')).rejects.toThrow(/lista de espera/i);
  });
});

describe('MiCalendarioService.cancelarPropia', () => {
  it('cancela como RECUPERABLE dentro de la ventana', async () => {
    const { servicio, reservas } = crearServicio();

    await servicio.cancelarPropia(ALUMNO, 'reserva-1', new Date('2099-10-02T07:00:00.000Z'));

    // Dentro de ventana la clase vuelve al pack. El alumno no elige el tipo:
    // lo decide la ventana.
    expect(reservas.cancelar).toHaveBeenCalledWith(ALUMNO, 'reserva-1', 'RECUPERABLE');
  });

  it('409 fuera de la ventana de cancelacion', async () => {
    const { servicio, reservas } = crearServicio();

    await expect(
      servicio.cancelarPropia(ALUMNO, 'reserva-1', new Date('2099-10-02T09:00:00.000Z')),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(reservas.cancelar).not.toHaveBeenCalled();
  });

  it('403 si la reserva es de otro alumno', async () => {
    const { servicio, db } = crearServicio();
    db.reserva.findFirst.mockResolvedValue({ ...RESERVA, perfilId: 'otro' });

    await expect(
      servicio.cancelarPropia(ALUMNO, 'reserva-1', new Date('2099-10-02T07:00:00.000Z')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('404 si la reserva no existe', async () => {
    const { servicio, db } = crearServicio();
    db.reserva.findFirst.mockResolvedValue(null);

    await expect(
      servicio.cancelarPropia(ALUMNO, 'reserva-9', new Date()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('409 si ya estaba cancelada', async () => {
    const { servicio, db } = crearServicio();
    db.reserva.findFirst.mockResolvedValue({ ...RESERVA, canceladaEn: new Date() });

    await expect(
      servicio.cancelarPropia(ALUMNO, 'reserva-1', new Date('2099-10-02T07:00:00.000Z')),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
```

- [ ] **Step 2: Ejecutar y ver fallar**

```bash
cd apps/api && pnpm exec jest src/mi-calendario/mi-reservas
```

Esperado: FAIL — `servicio.reservar is not a function`.

- [ ] **Step 3: Añadir `ReservasService` al constructor**

En `apps/api/src/mi-calendario/mi-calendario.service.ts`:

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly disponibilidad: DisponibilidadService,
    private readonly reservas: ReservasService,
  ) {}
```

**Esto rompe el test de la Task 10**, cuya fábrica construye el servicio con dos argumentos: bajo
`strict`, llamar a un constructor de tres con dos es un error de compilación, no un fallo en
ejecución. Añade el tercer doble a `crearServicio()` en
`apps/api/src/mi-calendario/mi-calendario.service.spec.ts`:

```ts
  const reservas = {
    crear: jest.fn().mockResolvedValue({ id: 'reserva-nueva', advertencias: [] }),
    cancelar: jest.fn().mockResolvedValue({ id: 'reserva-1' }),
  };
```

y pásalo como tercer argumento:

```ts
    servicio: new MiCalendarioService(
      { db } as unknown as PrismaService,
      disponibilidad as unknown as DisponibilidadService,
      reservas as unknown as ReservasService,
    ),
```

Los diez tests de la Task 10 tienen que seguir pasando **sin más cambios que ese**. Si alguno falla
por otra razón, el cambio está mal hecho.

- [ ] **Step 4: Implementar `reservar` y `cancelarPropia`**

Añadir a `apps/api/src/mi-calendario/mi-calendario.service.ts`:

```ts
  /**
   * Reserva del alumno para si mismo.
   *
   * Comprueba la disponibilidad ANTES de delegar, para poder dar un error
   * especifico. `ReservasService.crear` volveria a comprobar el cupo dentro de
   * su transaccion Serializable —que es la unica comprobacion con garantias—,
   * pero sus mensajes son los del admin y no saben nada de ventanas ni de mes
   * publicado.
   *
   * El `perfilId` sale del actor y NUNCA del cuerpo: si viniera del cliente, un
   * alumno podria reservar a nombre de otro.
   */
  async reservar(
    actor: JwtPayload,
    turnoId: string,
    ahora: Date = new Date(),
  ): Promise<ReservaCreada> {
    const perfil = await this.perfilDelActor(actor);
    const estado = await this.disponibilidad.paraTurno(actor, perfil.id, turnoId, ahora);

    this.exigirQuePuedaReservar(estado);

    return this.reservas.crear(actor, turnoId, { perfilId: perfil.id, origen: 'ALUMNO' });
  }

  /**
   * Traduce el `motivo` de la disponibilidad al error HTTP que le corresponde.
   *
   * 403 para lo que es cuestion de permisos y 409 para lo que es cuestion de
   * estado. El caso de LISTA_ESPERA tiene mensaje propio porque es un punto
   * explicito del checklist: un turno lleno tiene que OFRECER la cola, no
   * devolver un error generico.
   */
  private exigirQuePuedaReservar(estado: Disponibilidad): void {
    if (estado.puedeReservar) return;

    switch (estado.motivo) {
      case 'SIN_ACCESO_A_SALA':
      case 'SALA_NO_VISIBLE':
        throw new ForbiddenException('No tienes acceso a la sala de este turno');
      case 'MES_NO_PUBLICADO':
        throw new ConflictException('El mes de este turno todavia no esta publicado');
      case 'YA_RESERVADO':
        throw new ConflictException('Ya tienes una reserva activa en este turno');
      case 'VENTANA_CERRADA':
        throw new ConflictException(
          'Ya paso el plazo para anotarse a esta clase. Hablalo con el salon.',
        );
      case 'SOLO_CUPOS_LIBERADOS':
        throw new ConflictException(
          'En esta sala solo puedes tomar lugares que se liberen. Todavia no se libero ninguno.',
        );
      default:
        break;
    }

    if (estado.estado === 'LISTA_ESPERA') {
      throw new ConflictException(
        `Este turno esta completo (${estado.ocupados}/${estado.cupo}), pero puedes anotarte ` +
          'en la lista de espera con POST /turnos/:id/lista-espera.',
      );
    }

    throw new ConflictException(`Este turno esta completo (${estado.ocupados}/${estado.cupo}).`);
  }

  /**
   * Cancelacion de la propia reserva.
   *
   * DECISION DE LA FASE: fuera de la ventana se BLOQUEA con 409. El PDF dice
   * "respetando las ventanas minimas configuradas" y se lee como bloqueo. La
   * alternativa considerada era permitirla contandola como DEFINITIVA
   * ("cancelaste tarde, perdes la clase"); se descarto por fidelidad al PDF. El
   * admin conserva la capacidad de cancelarla desde DELETE /reservas/:id.
   *
   * El alumno NO elige el tipo: dentro de ventana siempre es RECUPERABLE, que
   * es lo que significa cancelar a tiempo.
   */
  async cancelarPropia(
    actor: JwtPayload,
    reservaId: string,
    ahora: Date = new Date(),
  ): Promise<ReservaPublica> {
    const perfil = await this.perfilDelActor(actor);

    const reserva = await this.prisma.db.reserva.findFirst({
      where: { id: reservaId },
      include: { turno: { include: { sala: { select: SALA_PARA_VENTANA } } } },
    });
    if (!reserva) throw new NotFoundException('Reserva inexistente');
    // 403 y no 404: el actor sabe que existe porque acaba de pasar su id.
    if (reserva.perfilId !== perfil.id) {
      throw new ForbiddenException('Solo puedes cancelar tus propias reservas');
    }
    if (reserva.canceladaEn !== null) {
      throw new ConflictException('La reserva ya estaba cancelada');
    }

    const config = await this.disponibilidad.configuracionDeSala(reserva.turno.sala);

    if (!puedeCancelar(reserva.turno.fecha, reserva.turno.horaInicio, config, ahora)) {
      throw new ConflictException(
        `Ya paso el plazo para cancelar esta clase (${config.minMinutosCancelar} minutos ` +
          'antes de que empiece). Hablalo con el salon.',
      );
    }

    return this.reservas.cancelar(actor, reservaId, 'RECUPERABLE');
  }
```

Añade a los imports de ese archivo: `ConflictException`, `ForbiddenException` de `@nestjs/common`;
`Disponibilidad`, `ReservaCreada`, `ReservaPublica` de `@boxadmin/shared`; y `ReservasService`.

- [ ] **Step 5: Ejecutar los tests y verlos pasar**

```bash
cd apps/api && pnpm exec jest src/mi-calendario
```

Esperado: PASS, 22 tests entre los dos archivos.

- [ ] **Step 6: Exponer las cuatro rutas**

Añadir a `apps/api/src/mi-calendario/mi-calendario.controller.ts`:

```ts
  @Roles('ALUMNO')
  @Post('turnos/:id/mi-reserva')
  reservar(
    @CurrentUser() actor: JwtPayload,
    @Param('id') turnoId: string,
  ): Promise<ReservaCreada> {
    return this.miCalendario.reservar(actor, turnoId);
  }

  @Roles('ALUMNO')
  @Delete('mis-reservas/:id')
  cancelarPropia(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
  ): Promise<ReservaPublica> {
    return this.miCalendario.cancelarPropia(actor, id);
  }

  @Roles('ALUMNO')
  @Post('turnos/:id/lista-espera')
  anotarse(
    @CurrentUser() actor: JwtPayload,
    @Param('id') turnoId: string,
  ): Promise<EntradaListaEspera> {
    return this.listaEspera.anotarse(actor, turnoId);
  }

  @Roles('ALUMNO')
  @HttpCode(204)
  @Delete('lista-espera/:id')
  salirse(@CurrentUser() actor: JwtPayload, @Param('id') id: string): Promise<void> {
    return this.listaEspera.salirse(actor, id);
  }
```

Con `ListaEsperaService` inyectado en el constructor del controller y los imports de `Delete`,
`HttpCode`, `Param`, `Post`.

- [ ] **Step 7: Conectar los módulos**

En `apps/api/src/mi-calendario/mi-calendario.module.ts`:

```ts
@Module({
  imports: [DisponibilidadModule, ListaEsperaModule, ReservasModule],
  controllers: [MiCalendarioController],
  providers: [MiCalendarioService],
  exports: [MiCalendarioService],
})
```

`ReservasModule` ya exporta `ReservasService` desde la Fase 1; comprueba que sea así y añádelo a su
array `exports` si falta.

- [ ] **Step 8: Verificar**

```bash
cd apps/api && pnpm exec tsc --noEmit && pnpm test
cd /d/Dev/box-admin && pnpm exec prettier --check "apps/api/src/mi-calendario/**/*.ts"
```

**Mensaje de commit sugerido para Cesar:**

```
feat(api): reserva y cancelacion propias del alumno

El perfilId sale del actor, nunca del cuerpo. Un turno lleno ofrece la lista de
espera en vez de un error generico. Fuera de la ventana de cancelacion se
bloquea con 409; dentro, la cancelacion es siempre RECUPERABLE.
```

---

## Task 14: El puerto `AlmacenDeArchivos`

Dos adaptadores. El local **no es un mock**: firma URLs y sirve archivos de verdad, para que los e2e
ejerciten el flujo de tres pasos sin credenciales.

**Files:**
- Crear: `apps/api/src/almacen/almacen.interface.ts`
- Crear: `apps/api/src/almacen/almacen-local.ts`
- Crear: `apps/api/src/almacen/almacen-local.controller.ts`
- Crear: `apps/api/src/almacen/almacen-s3.ts`
- Crear: `apps/api/src/almacen/almacen.module.ts`
- Modificar: `apps/api/src/config/validar-entorno.ts`
- Modificar: `.env.example`, `.env`, `.env.test`
- Test: `apps/api/src/almacen/almacen-local.spec.ts`

- [ ] **Step 1: Definir el puerto**

Crear `apps/api/src/almacen/almacen.interface.ts`:

```ts
/**
 * Token de inyeccion. Hace falta uno explicito porque `AlmacenDeArchivos` es
 * una interfaz de TypeScript, y las interfaces no existen en tiempo de
 * ejecucion: Nest no puede usarlas como clave del contenedor.
 */
export const ALMACEN_DE_ARCHIVOS = Symbol('ALMACEN_DE_ARCHIVOS');

export interface AlmacenDeArchivos {
  /** URL firmada donde el cliente hace PUT del archivo. */
  urlDeSubida(clave: string, tipoMime: string): Promise<string>;
  /** URL firmada de vida corta para leerlo. */
  urlDeDescarga(clave: string): Promise<string>;
  eliminar(clave: string): Promise<void>;
}

/** Vida de las URLs firmadas, en segundos. Corta a proposito: son credenciales. */
export const SEGUNDOS_DE_VIDA = 300;

/**
 * Una clave valida: letras, numeros, guiones, guiones bajos y puntos.
 *
 * Esto NO es cosmetica. La clave acaba siendo parte de una ruta del sistema de
 * ficheros en el adaptador local, asi que una barra o un `..` permitirian
 * escribir o leer fuera del directorio del almacen (path traversal). Se valida
 * en los dos adaptadores, no solo en el local: una clave con caracteres raros
 * tampoco tiene por que llegar a S3.
 */
export const PATRON_DE_CLAVE = /^[A-Za-z0-9_.-]{1,200}$/;

export class ClaveDeArchivoInvalidaError extends Error {
  constructor(clave: string) {
    super(
      `Clave de archivo invalida: ${clave}. Solo se admiten letras, numeros, ` +
        'guiones, guiones bajos y puntos, sin barras ni "..".',
    );
    this.name = 'ClaveDeArchivoInvalidaError';
  }
}

export function exigirClaveValida(clave: string): void {
  if (!PATRON_DE_CLAVE.test(clave) || clave.includes('..')) {
    throw new ClaveDeArchivoInvalidaError(clave);
  }
}
```

- [ ] **Step 2: Escribir los tests del adaptador local**

Crear `apps/api/src/almacen/almacen-local.spec.ts`:

```ts
import { ClaveDeArchivoInvalidaError, exigirClaveValida } from './almacen.interface';
import { AlmacenLocal, firmaDe } from './almacen-local';
import type { ConfigService } from '@nestjs/config';

function crearAlmacen() {
  const config = {
    getOrThrow: jest.fn((clave: string) =>
      clave === 'JWT_SECRET' ? 'secreto-de-prueba' : 'http://localhost:3000',
    ),
    get: jest.fn().mockReturnValue('./tmp-almacen'),
  };

  return new AlmacenLocal(config as unknown as ConfigService);
}

describe('exigirClaveValida', () => {
  it.each(['archivo.pdf', 'abc123', 'un-archivo_1.PNG'])('acepta %s', (clave) => {
    expect(() => exigirClaveValida(clave)).not.toThrow();
  });

  // Estas son las que importan: sin esta validacion, la clave se concatena a
  // una ruta del sistema de ficheros y se puede escribir fuera del almacen.
  it.each([
    '../../../etc/passwd',
    'sub/directorio.pdf',
    'a..b',
    '',
    'archivo\u0000.pdf',
  ])('rechaza %j', (clave) => {
    expect(() => exigirClaveValida(clave)).toThrow(ClaveDeArchivoInvalidaError);
  });
});

describe('AlmacenLocal', () => {
  it('la URL de subida lleva clave, caducidad y firma', async () => {
    const almacen = crearAlmacen();

    const url = new URL(await almacen.urlDeSubida('comprobante-1.pdf', 'application/pdf'));

    expect(url.pathname).toBe('/archivos-locales/comprobante-1.pdf');
    expect(url.searchParams.get('exp')).toMatch(/^\d+$/);
    expect(url.searchParams.get('firma')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('la firma depende de la clave: no vale para otro archivo', async () => {
    const almacen = crearAlmacen();

    const uno = new URL(await almacen.urlDeSubida('a.pdf', 'application/pdf'));
    const otro = new URL(await almacen.urlDeSubida('b.pdf', 'application/pdf'));

    expect(uno.searchParams.get('firma')).not.toBe(otro.searchParams.get('firma'));
  });

  it('la firma depende de la caducidad: no se puede estirar cambiando exp', () => {
    const conUna = firmaDe('secreto', 'a.pdf', 1000);
    const conOtra = firmaDe('secreto', 'a.pdf', 2000);

    expect(conUna).not.toBe(conOtra);
  });

  it('rechaza una clave con traversal antes de tocar el disco', async () => {
    const almacen = crearAlmacen();

    await expect(almacen.urlDeSubida('../secreto', 'application/pdf')).rejects.toBeInstanceOf(
      ClaveDeArchivoInvalidaError,
    );
  });
});
```

- [ ] **Step 3: Ejecutar y ver fallar**

```bash
cd apps/api && pnpm exec jest src/almacen
```

Esperado: FAIL — no existe el módulo.

- [ ] **Step 4: Implementar el adaptador local**

Crear `apps/api/src/almacen/almacen-local.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  exigirClaveValida,
  SEGUNDOS_DE_VIDA,
  type AlmacenDeArchivos,
} from './almacen.interface';

/**
 * HMAC-SHA256 sobre clave y caducidad juntas.
 *
 * Las dos entran en la firma a proposito: si solo entrara la clave, cualquiera
 * podria estirar la caducidad editando el query param; y si solo entrara la
 * caducidad, una firma valdria para cualquier archivo.
 */
export function firmaDe(secreto: string, clave: string, expira: number): string {
  return createHmac('sha256', secreto).update(`${clave}|${expira}`).digest('hex');
}

/** Comparacion en tiempo constante: comparar firmas con `===` filtra informacion. */
export function firmaValida(esperada: string, recibida: string): boolean {
  const a = Buffer.from(esperada, 'utf8');
  const b = Buffer.from(recibida, 'utf8');

  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Almacen de disco para desarrollo y tests.
 *
 * NO es un mock: firma URLs y sirve archivos de verdad, a traves de
 * `AlmacenLocalController`. Es lo que permite que los e2e ejerciten el flujo
 * completo de tres pasos —pedir URL, subir, confirmar— sin credenciales ni red.
 * Un mock dejaria ese flujo sin probar hasta la primera subida real en
 * produccion, que es justo donde este tipo de integracion falla.
 */
@Injectable()
export class AlmacenLocal implements AlmacenDeArchivos {
  private readonly secreto: string;
  private readonly baseUrl: string;
  private readonly directorio: string;

  constructor(config: ConfigService) {
    // Se reutiliza JWT_SECRET en vez de pedir otra variable: este adaptador no
    // corre en produccion, y una variable mas seria una mas que olvidar.
    this.secreto = config.getOrThrow<string>('JWT_SECRET');
    this.baseUrl = config.get<string>('API_BASE_URL') ?? 'http://localhost:3000';
    this.directorio = config.get<string>('ALMACEN_LOCAL_DIR') ?? './var/almacen';
  }

  async urlDeSubida(clave: string, _tipoMime: string): Promise<string> {
    return this.firmar(clave);
  }

  async urlDeDescarga(clave: string): Promise<string> {
    return this.firmar(clave);
  }

  async eliminar(clave: string): Promise<void> {
    exigirClaveValida(clave);
    await rm(this.rutaDe(clave), { force: true });
  }

  /** Ruta en disco. Solo se llama con claves ya validadas. */
  rutaDe(clave: string): string {
    exigirClaveValida(clave);
    return join(this.directorio, clave);
  }

  async asegurarDirectorio(): Promise<void> {
    await mkdir(this.directorio, { recursive: true });
  }

  private firmar(clave: string): string {
    exigirClaveValida(clave);

    const expira = Math.floor(Date.now() / 1000) + SEGUNDOS_DE_VIDA;
    const firma = firmaDe(this.secreto, clave, expira);

    return `${this.baseUrl}/archivos-locales/${clave}?exp=${expira}&firma=${firma}`;
  }

  verificar(clave: string, exp: string | undefined, firma: string | undefined): boolean {
    if (!exp || !firma) return false;

    const expira = Number(exp);
    if (!Number.isInteger(expira) || expira * 1000 <= Date.now()) return false;

    return firmaValida(firmaDe(this.secreto, clave, expira), firma);
  }
}
```

- [ ] **Step 5: Escribir el controller del almacén local**

Crear `apps/api/src/almacen/almacen-local.controller.ts`:

```ts
import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Public } from '../common/decorators/public.decorator';
import { AlmacenLocal } from './almacen-local';

/**
 * Las dos rutas que sirven el almacen local. Publicas en el sentido de que no
 * piden JWT, pero NO abiertas: exigen una firma HMAC con caducidad que solo el
 * servidor sabe generar. Es el mismo modelo que una URL presignada de S3.
 *
 * Este controller solo se registra cuando ALMACEN_TIPO es `local`.
 */
@Controller('archivos-locales')
export class AlmacenLocalController {
  constructor(private readonly almacen: AlmacenLocal) {}

  @Public()
  @Put(':clave')
  async subir(
    @Param('clave') clave: string,
    @Query('exp') exp: string,
    @Query('firma') firma: string,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    this.exigirFirma(clave, exp, firma);

    await this.almacen.asegurarDirectorio();
    await pipeline(req, createWriteStream(this.almacen.rutaDe(clave)));

    return { ok: true };
  }

  @Public()
  @Get(':clave')
  async descargar(
    @Param('clave') clave: string,
    @Query('exp') exp: string,
    @Query('firma') firma: string,
    @Res() res: Response,
  ): Promise<void> {
    this.exigirFirma(clave, exp, firma);

    const ruta = this.almacen.rutaDe(clave);
    await stat(ruta); // 404 via el filtro global si no existe

    createReadStream(ruta).pipe(res);
  }

  private exigirFirma(clave: string, exp: string, firma: string): void {
    if (!this.almacen.verificar(clave, exp, firma)) {
      // Mismo error para firma mala, caducada y ausente: no hay nada que ganar
      // diciendole a quien prueba cual de las tres fallo.
      throw new ForbiddenException('Enlace invalido o caducado');
    }
  }
}
```

**Importante:** el `PUT` lee el cuerpo como stream, así que este `Controller` no puede pasar por el
`body-parser` de Express. En `apps/api/src/main.ts`, antes de los middlewares globales:

```ts
  // El PUT del almacen local consume el cuerpo como stream, asi que el parser
  // de JSON no puede habersele adelantado: si lo hiciera, el request llegaria
  // ya consumido y el archivo se guardaria vacio.
  app.use('/archivos-locales', (req, _res, next) => {
    (req as { _body?: boolean })._body = true;
    next();
  });
```

- [ ] **Step 6: Implementar el adaptador S3**

Crear `apps/api/src/almacen/almacen-s3.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  exigirClaveValida,
  SEGUNDOS_DE_VIDA,
  type AlmacenDeArchivos,
} from './almacen.interface';

/**
 * Adaptador para cualquier almacen que hable el protocolo de S3: Backblaze B2,
 * DigitalOcean Spaces o el propio S3. Por eso el endpoint es una variable de
 * entorno y no una region fija.
 *
 * `forcePathStyle: true` porque B2 y Spaces no soportan el estilo de host
 * virtual (`bucket.endpoint`) de forma fiable.
 *
 * La firma es puramente local: `getSignedUrl` no hace ninguna llamada de red.
 * Verificado en la Task 0.
 */
@Injectable()
export class AlmacenS3 implements AlmacenDeArchivos {
  private readonly cliente: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    this.bucket = config.getOrThrow<string>('S3_BUCKET');
    this.cliente = new S3Client({
      region: config.getOrThrow<string>('S3_REGION'),
      endpoint: config.getOrThrow<string>('S3_ENDPOINT'),
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.getOrThrow<string>('S3_ACCESS_KEY_ID'),
        secretAccessKey: config.getOrThrow<string>('S3_SECRET_ACCESS_KEY'),
      },
    });
  }

  async urlDeSubida(clave: string, tipoMime: string): Promise<string> {
    exigirClaveValida(clave);

    return getSignedUrl(
      this.cliente,
      new PutObjectCommand({ Bucket: this.bucket, Key: clave, ContentType: tipoMime }),
      { expiresIn: SEGUNDOS_DE_VIDA },
    );
  }

  async urlDeDescarga(clave: string): Promise<string> {
    exigirClaveValida(clave);

    return getSignedUrl(
      this.cliente,
      new GetObjectCommand({ Bucket: this.bucket, Key: clave }),
      { expiresIn: SEGUNDOS_DE_VIDA },
    );
  }

  async eliminar(clave: string): Promise<void> {
    exigirClaveValida(clave);

    await this.cliente.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: clave }));
  }
}
```

- [ ] **Step 7: Escribir el módulo que elige el adaptador**

Crear `apps/api/src/almacen/almacen.module.ts`:

```ts
import { Module, type DynamicModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AlmacenLocal } from './almacen-local';
import { AlmacenLocalController } from './almacen-local.controller';
import { AlmacenS3 } from './almacen-s3';
import { ALMACEN_DE_ARCHIVOS } from './almacen.interface';

/**
 * El adaptador se elige en el arranque, no en cada llamada: asi un error de
 * configuracion sale al levantar la aplicacion y no la primera vez que alguien
 * sube un comprobante.
 *
 * El controller del almacen local SOLO se registra cuando ALMACEN_TIPO es
 * `local`. En produccion esas rutas no existen.
 */
@Module({})
export class AlmacenModule {
  static forRoot(): DynamicModule {
    const esLocal = (process.env.ALMACEN_TIPO ?? 'local') === 'local';

    return {
      module: AlmacenModule,
      controllers: esLocal ? [AlmacenLocalController] : [],
      providers: [
        AlmacenLocal,
        {
          provide: ALMACEN_DE_ARCHIVOS,
          inject: [ConfigService],
          useFactory: (config: ConfigService) =>
            esLocal ? new AlmacenLocal(config) : new AlmacenS3(config),
        },
      ],
      exports: [ALMACEN_DE_ARCHIVOS],
    };
  }
}
```

En `apps/api/src/app.module.ts`, añadir `AlmacenModule.forRoot()` al array `imports`.

- [ ] **Step 8: Validar la configuración del almacén al arrancar**

En `apps/api/src/config/validar-entorno.ts`, añadir `'ALMACEN_TIPO'` a `VARIABLES_REQUERIDAS`, y al
final de `validarEntorno`, antes del `return config`:

```ts
  const tipo = config.ALMACEN_TIPO;
  if (tipo !== 'local' && tipo !== 's3') {
    throw new Error(`ALMACEN_TIPO debe ser "local" o "s3", no ${String(tipo)}.`);
  }

  // Las variables de S3 solo se exigen si se va a usar S3. Pedirlas siempre
  // obligaria a inventar valores falsos en desarrollo y en los tests.
  if (tipo === 's3') {
    const DE_S3 = [
      'S3_ENDPOINT',
      'S3_REGION',
      'S3_BUCKET',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
    ] as const;

    for (const variable of DE_S3) {
      const valor = config[variable];
      if (typeof valor !== 'string' || valor.trim() === '') {
        throw new Error(
          `Variable de entorno requerida ausente o vacia: ${variable}. ` +
            'Es obligatoria cuando ALMACEN_TIPO=s3.',
        );
      }
    }
  }
```

- [ ] **Step 9: Añadir las variables a los `.env`**

En `.env`, `.env.test` y `.env.example` de la raíz del monorepo:

```
ALMACEN_TIPO=local
ALMACEN_LOCAL_DIR=./var/almacen
API_BASE_URL=http://localhost:3000
```

En `.env.test`, `API_BASE_URL` no importa (los e2e usan la dirección real del servidor de pruebas),
pero la variable tiene que existir.

Añade a `.gitignore`:

```
var/almacen/
```

- [ ] **Step 10: Ejecutar tests y verificar**

```bash
cd apps/api && pnpm exec jest src/almacen && pnpm exec tsc --noEmit && pnpm test
cd /d/Dev/box-admin && pnpm exec prettier --check "apps/api/src/almacen/**/*.ts" "apps/api/src/config/*.ts"
cd /d/Dev/box-admin && git check-ignore -v var/almacen/prueba.txt
```

Esperado: 9 tests del almacén en verde, suite completa en verde, y `git check-ignore` confirmando que
el directorio está ignorado.

**Mensaje de commit sugerido para Cesar:**

```
feat(api): puerto AlmacenDeArchivos con adaptadores local y S3

El adaptador local no es un mock: firma URLs con HMAC y sirve archivos de
verdad, para que los e2e ejerciten el flujo completo sin credenciales. La clave
se valida contra path traversal en los dos adaptadores. Las variables de S3
solo se exigen cuando ALMACEN_TIPO=s3.
```

---
## Task 15: Comprobantes de pago

El flujo de tres pasos y la revisión del admin.

**Files:**
- Crear: `apps/api/src/comprobantes/comprobantes.service.ts`
- Crear: `apps/api/src/comprobantes/comprobantes.controller.ts`
- Crear: `apps/api/src/comprobantes/comprobantes.module.ts`
- Crear: `apps/api/src/comprobantes/dto/crear-comprobante.dto.ts`
- Crear: `apps/api/src/comprobantes/dto/revisar-comprobante.dto.ts`
- Modificar: `apps/api/src/app.module.ts`
- Test: `apps/api/src/comprobantes/comprobantes.service.spec.ts`

### Por qué tres pasos

1. `POST /comprobantes` crea la fila en `PENDIENTE` con `subidoEn: null` y devuelve la URL firmada.
2. El cliente hace `PUT` del archivo a esa URL. **No pasa por la API.**
3. `PATCH /comprobantes/:id/confirmar` marca `subidoEn`.

El tercer paso existe porque **ni S3 ni el adaptador local pueden avisar a la API** de que el `PUT`
terminó. Sin él, la única forma de saber si un comprobante tiene archivo sería consultar el almacén
en cada listado.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `apps/api/src/comprobantes/comprobantes.service.spec.ts`:

```ts
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { JwtPayload } from '@boxadmin/shared';
import { ComprobantesService } from './comprobantes.service';
import type { AlmacenDeArchivos } from '../almacen/almacen.interface';
import type { HistorialService } from '../common/historial/historial.service';
import type { PrismaService } from '../prisma/prisma.service';

const ALUMNO: JwtPayload = { sub: 'usr-1', tenantId: 'gym-1', rol: 'ALUMNO' };
const ADMIN: JwtPayload = { sub: 'usr-admin', tenantId: 'gym-1', rol: 'ADMIN_OPERATIVO' };

const FILA = {
  id: 'comp-1',
  tenantId: 'gym-1',
  perfilId: 'perfil-1',
  claveArchivo: 'comp-1.pdf',
  nombreOriginal: 'transferencia.pdf',
  tipoMime: 'application/pdf',
  subidoEn: new Date('2099-10-01T10:00:00.000Z'),
  estado: 'PENDIENTE' as const,
  revisadoPor: null,
  revisadoEn: null,
  nota: null,
  createdAt: new Date('2099-10-01T09:00:00.000Z'),
};

function crearServicio() {
  const comprobante = {
    findFirst: jest.fn().mockResolvedValue(FILA),
    findMany: jest.fn().mockResolvedValue([FILA]),
    create: jest.fn().mockResolvedValue({ ...FILA, subidoEn: null }),
    update: jest.fn().mockResolvedValue(FILA),
  };
  const perfil = {
    findFirst: jest.fn().mockResolvedValue({ id: 'perfil-1' }),
    update: jest.fn().mockResolvedValue({}),
  };

  const db = {
    comprobante,
    perfil,
    $transaction: jest.fn((fn: (tx: unknown) => unknown): unknown => fn(db)),
  };
  const almacen = {
    urlDeSubida: jest.fn().mockResolvedValue('https://almacen/subir?firma=x'),
    urlDeDescarga: jest.fn().mockResolvedValue('https://almacen/bajar?firma=y'),
    eliminar: jest.fn().mockResolvedValue(undefined),
  };
  const historial = { registrar: jest.fn().mockResolvedValue(undefined) };

  return {
    servicio: new ComprobantesService(
      { db } as unknown as PrismaService,
      almacen as unknown as AlmacenDeArchivos,
      historial as unknown as HistorialService,
    ),
    comprobante,
    perfil,
    almacen,
    historial,
  };
}

describe('ComprobantesService.crear', () => {
  it('crea la fila en PENDIENTE sin subidoEn y devuelve la URL de subida', async () => {
    const { servicio, comprobante } = crearServicio();

    const creado = await servicio.crear(ALUMNO, {
      nombreOriginal: 'transferencia.pdf',
      tipoMime: 'application/pdf',
    });

    expect(comprobante.create.mock.calls[0][0].data).toMatchObject({
      tenantId: 'gym-1',
      perfilId: 'perfil-1',
      nombreOriginal: 'transferencia.pdf',
      tipoMime: 'application/pdf',
    });
    expect(creado.urlDeSubida).toBe('https://almacen/subir?firma=x');
    expect(creado.comprobante.subidoEn).toBeNull();
  });

  it('la clave del archivo la genera el servidor y lleva extension del mime', async () => {
    const { servicio, comprobante } = crearServicio();

    await servicio.crear(ALUMNO, { nombreOriginal: 'x.pdf', tipoMime: 'application/pdf' });

    // Nunca el nombre que manda el cliente: seria path traversal servido en
    // bandeja.
    expect(comprobante.create.mock.calls[0][0].data.claveArchivo).toMatch(/^[a-z0-9]+\.pdf$/);
  });

  it('rechaza un tipo de archivo no admitido', async () => {
    const { servicio } = crearServicio();

    await expect(
      servicio.crear(ALUMNO, { nombreOriginal: 'virus.exe', tipoMime: 'application/x-msdownload' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('404 si el actor no tiene perfil', async () => {
    const { servicio, perfil } = crearServicio();
    perfil.findFirst.mockResolvedValue(null);

    await expect(
      servicio.crear(ALUMNO, { nombreOriginal: 'x.pdf', tipoMime: 'application/pdf' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ComprobantesService.confirmar', () => {
  it('marca subidoEn', async () => {
    const { servicio, comprobante } = crearServicio();
    comprobante.findFirst.mockResolvedValue({ ...FILA, subidoEn: null });

    await servicio.confirmar(ALUMNO, 'comp-1');

    expect(comprobante.update).toHaveBeenCalledWith({
      where: { id: 'comp-1' },
      data: { subidoEn: expect.any(Date) },
    });
  });

  it('403 si el comprobante es de otro alumno', async () => {
    const { servicio, comprobante } = crearServicio();
    comprobante.findFirst.mockResolvedValue({ ...FILA, perfilId: 'otro', subidoEn: null });

    await expect(servicio.confirmar(ALUMNO, 'comp-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('es idempotente: confirmar dos veces no vuelve a escribir', async () => {
    const { servicio, comprobante } = crearServicio();

    // FILA ya viene con subidoEn.
    await servicio.confirmar(ALUMNO, 'comp-1');

    expect(comprobante.update).not.toHaveBeenCalled();
  });
});

describe('ComprobantesService.listar', () => {
  it('el alumno solo ve los suyos, aunque no lo pida', async () => {
    const { servicio, comprobante } = crearServicio();

    await servicio.listar(ALUMNO, {});

    expect(comprobante.findMany.mock.calls[0][0].where).toMatchObject({ perfilId: 'perfil-1' });
  });

  it('el admin ve los de todo el gimnasio', async () => {
    const { servicio, comprobante } = crearServicio();

    await servicio.listar(ADMIN, {});

    expect(comprobante.findMany.mock.calls[0][0].where.perfilId).toBeUndefined();
  });

  it('el admin solo ve los que tienen archivo', async () => {
    const { servicio, comprobante } = crearServicio();

    await servicio.listar(ADMIN, {});

    // Una fila sin confirmar no tiene archivo: mostrarsela al admin seria
    // darle un enlace roto.
    expect(comprobante.findMany.mock.calls[0][0].where.subidoEn).toEqual({ not: null });
  });

  it('adjunta una URL de descarga firmada a los que tienen archivo', async () => {
    const { servicio } = crearServicio();

    const lista = await servicio.listar(ADMIN, {});

    expect(lista[0].urlDeDescarga).toBe('https://almacen/bajar?firma=y');
  });

  it('no firma nada para una fila sin archivo', async () => {
    const { servicio, comprobante, almacen } = crearServicio();
    comprobante.findMany.mockResolvedValue([{ ...FILA, subidoEn: null }]);

    const lista = await servicio.listar(ALUMNO, {});

    expect(lista[0].urlDeDescarga).toBeNull();
    expect(almacen.urlDeDescarga).not.toHaveBeenCalled();
  });

  it('filtra por estado cuando se pide', async () => {
    const { servicio, comprobante } = crearServicio();

    await servicio.listar(ADMIN, { estado: 'PENDIENTE' });

    expect(comprobante.findMany.mock.calls[0][0].where.estado).toBe('PENDIENTE');
  });
});

describe('ComprobantesService.revisar', () => {
  it('aprobar deja el comprobante APROBADO y pone pagoAlDia en true', async () => {
    const { servicio, comprobante, perfil } = crearServicio();

    await servicio.revisar(ADMIN, 'comp-1', 'APROBADO', undefined);

    expect(comprobante.update.mock.calls[0][0].data).toMatchObject({
      estado: 'APROBADO',
      revisadoPor: 'usr-admin',
    });
    // pagoAlDia existe desde la Fase 1 sin que nada lo escriba: esta es la
    // fase donde encuentra su dueno.
    expect(perfil.update).toHaveBeenCalledWith({
      where: { id: 'perfil-1' },
      data: { pagoAlDia: true },
    });
  });

  it('rechazar NO toca pagoAlDia', async () => {
    const { servicio, perfil } = crearServicio();

    await servicio.revisar(ADMIN, 'comp-1', 'RECHAZADO', 'Ilegible');

    expect(perfil.update).not.toHaveBeenCalled();
  });

  it('rechazar guarda la nota', async () => {
    const { servicio, comprobante } = crearServicio();

    await servicio.revisar(ADMIN, 'comp-1', 'RECHAZADO', 'Ilegible');

    expect(comprobante.update.mock.calls[0][0].data).toMatchObject({
      estado: 'RECHAZADO',
      nota: 'Ilegible',
    });
  });

  it('409 si ya estaba revisado', async () => {
    const { servicio, comprobante } = crearServicio();
    comprobante.findFirst.mockResolvedValue({ ...FILA, estado: 'APROBADO' });

    await expect(servicio.revisar(ADMIN, 'comp-1', 'RECHAZADO', undefined)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('409 si todavia no tiene archivo', async () => {
    const { servicio, comprobante } = crearServicio();
    comprobante.findFirst.mockResolvedValue({ ...FILA, subidoEn: null });

    // Aprobar un comprobante sin archivo seria aprobar la nada.
    await expect(servicio.revisar(ADMIN, 'comp-1', 'APROBADO', undefined)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('404 si no existe', async () => {
    const { servicio, comprobante } = crearServicio();
    comprobante.findFirst.mockResolvedValue(null);

    await expect(servicio.revisar(ADMIN, 'comp-9', 'APROBADO', undefined)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
```

- [ ] **Step 2: Ejecutar y ver fallar**

```bash
cd apps/api && pnpm exec jest src/comprobantes
```

Esperado: FAIL — no existe el módulo.

- [ ] **Step 3: Escribir los DTOs**

Crear `apps/api/src/comprobantes/dto/crear-comprobante.dto.ts`:

```ts
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CrearComprobanteDto {
  /** Solo informativo: la clave real del archivo la genera el servidor. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  nombreOriginal!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  tipoMime!: string;
}
```

Crear `apps/api/src/comprobantes/dto/revisar-comprobante.dto.ts`:

```ts
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RevisarComprobanteDto {
  /** Motivo del rechazo, o cualquier apunte del admin al aprobar. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  nota?: string;
}
```

- [ ] **Step 4: Implementar el servicio**

Crear `apps/api/src/comprobantes/comprobantes.service.ts`:

```ts
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  rolAlcanza,
  type ComprobanteCreado,
  type ComprobantePublico,
  type EstadoComprobante,
  type JwtPayload,
} from '@boxadmin/shared';
import { ALMACEN_DE_ARCHIVOS, type AlmacenDeArchivos } from '../almacen/almacen.interface';
import { HistorialService } from '../common/historial/historial.service';
import { PrismaService, type ClientePrismaTx } from '../prisma/prisma.service';
import type { CrearComprobanteDto } from './dto/crear-comprobante.dto';

/**
 * Tipos admitidos, con la extension que les corresponde.
 *
 * Lista blanca y no negra: es lo unico que funciona cuando lo que se acepta son
 * archivos que despues alguien va a abrir. La extension sale de AQUI y no del
 * nombre que manda el cliente.
 */
const TIPOS_ADMITIDOS: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

interface FilaComprobante {
  id: string;
  tenantId: string;
  perfilId: string;
  claveArchivo: string;
  nombreOriginal: string;
  tipoMime: string;
  subidoEn: Date | null;
  estado: EstadoComprobante;
  revisadoPor: string | null;
  revisadoEn: Date | null;
  nota: string | null;
  createdAt: Date;
}

export interface FiltroComprobantes {
  estado?: EstadoComprobante;
}

@Injectable()
export class ComprobantesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ALMACEN_DE_ARCHIVOS) private readonly almacen: AlmacenDeArchivos,
    private readonly historial: HistorialService,
  ) {}

  async crear(actor: JwtPayload, dto: CrearComprobanteDto): Promise<ComprobanteCreado> {
    const extension = TIPOS_ADMITIDOS[dto.tipoMime];
    if (!extension) {
      throw new ConflictException(
        `Tipo de archivo no admitido: ${dto.tipoMime}. Se aceptan PDF, JPEG, PNG y WebP.`,
      );
    }

    const perfil = await this.perfilDelActor(actor);

    // La clave la genera el servidor. Usar el nombre del cliente seria path
    // traversal servido en bandeja, y ademas dos alumnos con el mismo nombre de
    // archivo se pisarian.
    const claveArchivo = `${randomUUID().replace(/-/g, '')}.${extension}`;

    const fila = await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      const creado = await cliente.comprobante.create({
        data: {
          tenantId: actor.tenantId,
          perfilId: perfil.id,
          claveArchivo,
          nombreOriginal: dto.nombreOriginal,
          tipoMime: dto.tipoMime,
        },
      });

      await this.historial.registrar(
        {
          actor,
          entidad: 'Comprobante',
          entidadId: creado.id,
          accion: 'CREADA',
          detalle: { perfilId: perfil.id, tipoMime: dto.tipoMime },
        },
        cliente,
      );

      return creado as FilaComprobante;
    });

    return {
      comprobante: this.aPublico(fila, null),
      urlDeSubida: await this.almacen.urlDeSubida(claveArchivo, dto.tipoMime),
    };
  }

  /**
   * Marca que el archivo llego.
   *
   * Existe porque ni S3 ni el adaptador local pueden avisar a la API de que el
   * PUT termino. Sin este paso, saber si un comprobante tiene archivo obligaria
   * a consultar el almacen en cada listado.
   */
  async confirmar(actor: JwtPayload, id: string): Promise<ComprobantePublico> {
    const perfil = await this.perfilDelActor(actor);

    const fila = (await this.prisma.db.comprobante.findFirst({
      where: { id },
    })) as FilaComprobante | null;
    if (!fila) throw new NotFoundException('Comprobante inexistente');
    if (fila.perfilId !== perfil.id) {
      throw new ForbiddenException('Solo puedes confirmar tus propios comprobantes');
    }

    // Idempotente: repetir la confirmacion no reescribe una fecha que ya existe.
    if (fila.subidoEn !== null) return this.aPublico(fila, await this.firmarSiHayArchivo(fila));

    const actualizado = (await this.prisma.db.comprobante.update({
      where: { id },
      data: { subidoEn: new Date() },
    })) as FilaComprobante;

    return this.aPublico(actualizado, await this.firmarSiHayArchivo(actualizado));
  }

  async listar(actor: JwtPayload, filtro: FiltroComprobantes): Promise<ComprobantePublico[]> {
    const esPersonal = rolAlcanza(actor.rol, 'ADMIN_OPERATIVO');
    const where: Record<string, unknown> = {};

    if (filtro.estado) where.estado = filtro.estado;

    if (esPersonal) {
      // Al admin no se le muestran filas sin archivo: serian enlaces rotos.
      where.subidoEn = { not: null };
    } else {
      const perfil = await this.perfilDelActor(actor);
      // El alumno si ve las suyas sin confirmar: son las que tiene que
      // terminar de subir.
      where.perfilId = perfil.id;
    }

    const filas = (await this.prisma.db.comprobante.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    })) as FilaComprobante[];

    const publicos: ComprobantePublico[] = [];
    for (const fila of filas) {
      publicos.push(this.aPublico(fila, await this.firmarSiHayArchivo(fila)));
    }

    return publicos;
  }

  async revisar(
    actor: JwtPayload,
    id: string,
    estado: 'APROBADO' | 'RECHAZADO',
    nota: string | undefined,
  ): Promise<ComprobantePublico> {
    const fila = await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

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

      const actualizado = (await cliente.comprobante.update({
        where: { id },
        data: {
          estado,
          revisadoPor: actor.sub,
          revisadoEn: new Date(),
          nota: nota ?? null,
        },
      })) as FilaComprobante;

      // Aprobar un comprobante es lo que pone al alumno al dia. `pagoAlDia`
      // existe desde la Fase 1 sin que nada lo escriba: esta es la fase donde
      // encuentra su dueno. Rechazar no lo toca, porque un rechazo no quita un
      // pago anterior que si estaba bien.
      if (estado === 'APROBADO') {
        await cliente.perfil.update({
          where: { id: existente.perfilId },
          data: { pagoAlDia: true },
        });
      }

      await this.historial.registrar(
        {
          actor,
          entidad: 'Comprobante',
          entidadId: id,
          accion: estado,
          detalle: { perfilId: existente.perfilId, nota: nota ?? null },
        },
        cliente,
      );

      return actualizado;
    });

    return this.aPublico(fila, await this.firmarSiHayArchivo(fila));
  }

  private async perfilDelActor(actor: JwtPayload): Promise<{ id: string }> {
    const perfil = await this.prisma.db.perfil.findFirst({
      where: { usuarioId: actor.sub },
      select: { id: true },
    });
    if (!perfil) {
      throw new NotFoundException('Este usuario no tiene perfil de alumno');
    }

    return perfil;
  }

  /** Sin archivo no hay nada que firmar, y firmar de todas formas daria un 404 al abrirlo. */
  private async firmarSiHayArchivo(fila: FilaComprobante): Promise<string | null> {
    if (fila.subidoEn === null) return null;

    return this.almacen.urlDeDescarga(fila.claveArchivo);
  }

  private aPublico(fila: FilaComprobante, urlDeDescarga: string | null): ComprobantePublico {
    return {
      id: fila.id,
      tenantId: fila.tenantId,
      perfilId: fila.perfilId,
      nombreOriginal: fila.nombreOriginal,
      tipoMime: fila.tipoMime,
      subidoEn: fila.subidoEn === null ? null : fila.subidoEn.toISOString(),
      estado: fila.estado,
      revisadoPor: fila.revisadoPor,
      revisadoEn: fila.revisadoEn === null ? null : fila.revisadoEn.toISOString(),
      nota: fila.nota,
      createdAt: fila.createdAt.toISOString(),
      urlDeDescarga,
    };
  }
}
```

- [ ] **Step 5: Ejecutar los tests y verlos pasar**

```bash
cd apps/api && pnpm exec jest src/comprobantes
```

Esperado: PASS, 18 tests.

- [ ] **Step 6: Escribir el controller**

Crear `apps/api/src/comprobantes/comprobantes.controller.ts`:

```ts
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import type {
  ComprobanteCreado,
  ComprobantePublico,
  EstadoComprobante,
  JwtPayload,
} from '@boxadmin/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ComprobantesService } from './comprobantes.service';
import { CrearComprobanteDto } from './dto/crear-comprobante.dto';
import { RevisarComprobanteDto } from './dto/revisar-comprobante.dto';

@Controller('comprobantes')
export class ComprobantesController {
  constructor(private readonly comprobantes: ComprobantesService) {}

  @Roles('ALUMNO')
  @Post()
  crear(
    @CurrentUser() actor: JwtPayload,
    @Body() dto: CrearComprobanteDto,
  ): Promise<ComprobanteCreado> {
    return this.comprobantes.crear(actor, dto);
  }

  @Roles('ALUMNO')
  @Patch(':id/confirmar')
  confirmar(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
  ): Promise<ComprobantePublico> {
    return this.comprobantes.confirmar(actor, id);
  }

  // Sin @Roles restrictivo: el propio service decide el alcance. Un ALUMNO ve
  // solo los suyos y un ADMIN_OPERATIVO los de todo el gimnasio, igual que
  // hace GET /usuarios/:id desde la Fase 1.
  @Roles('ALUMNO')
  @Get()
  listar(
    @CurrentUser() actor: JwtPayload,
    @Query('estado') estado?: EstadoComprobante,
  ): Promise<ComprobantePublico[]> {
    return this.comprobantes.listar(actor, { estado });
  }

  @Roles('ADMIN_OPERATIVO')
  @Patch(':id/aprobar')
  aprobar(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
    @Body() dto: RevisarComprobanteDto,
  ): Promise<ComprobantePublico> {
    return this.comprobantes.revisar(actor, id, 'APROBADO', dto.nota);
  }

  @Roles('ADMIN_OPERATIVO')
  @Patch(':id/rechazar')
  rechazar(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
    @Body() dto: RevisarComprobanteDto,
  ): Promise<ComprobantePublico> {
    return this.comprobantes.revisar(actor, id, 'RECHAZADO', dto.nota);
  }
}
```

- [ ] **Step 7: Crear y registrar el módulo**

Crear `apps/api/src/comprobantes/comprobantes.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AlmacenModule } from '../almacen/almacen.module';
import { ComprobantesController } from './comprobantes.controller';
import { ComprobantesService } from './comprobantes.service';

@Module({
  imports: [AlmacenModule.forRoot()],
  controllers: [ComprobantesController],
  providers: [ComprobantesService],
  exports: [ComprobantesService],
})
export class ComprobantesModule {}
```

En `apps/api/src/app.module.ts`, importar y añadir `ComprobantesModule`.

- [ ] **Step 8: Verificar**

```bash
cd apps/api && pnpm exec tsc --noEmit && pnpm test
cd /d/Dev/box-admin && pnpm exec prettier --check "apps/api/src/comprobantes/**/*.ts"
```

**Mensaje de commit sugerido para Cesar:**

```
feat(api): comprobantes de pago con subida presignada

Flujo de tres pasos: crear la fila, subir a la URL firmada, confirmar. El
tercer paso existe porque el almacen no puede avisar a la API. La clave del
archivo la genera el servidor con lista blanca de tipos. Aprobar un
comprobante pone pagoAlDia en true.
```

---

## Task 16: Tests end-to-end

Los ocho escenarios del spec, contra Postgres y Redis de verdad.

**Files:**
- Modificar: `apps/api/test/helpers.ts`
- Crear: `apps/api/test/selfservice.e2e-spec.ts`

- [ ] **Step 1: Añadir los helpers de alumno**

Añadir a `apps/api/test/helpers.ts`:

```ts
export interface AlumnoDeTest {
  usuarioId: string;
  perfilId: string;
  token: string;
  email: string;
}

/**
 * Crea una clave de invitacion y da de alta un alumno con ella. Es el camino
 * corto para los tests que necesitan un alumno operativo sin ejercitar el
 * auto-registro en si.
 */
export async function crearAlumnoPorInvitacion(
  app: INestApplication,
  gimnasio: GimnasioDeTest,
  salaIds: string[],
  opciones: { email?: string; packId?: string } = {},
): Promise<AlumnoDeTest> {
  const servidor = app.getHttpServer();
  const email = opciones.email ?? `alumno-${Date.now()}-${Math.random().toString(36).slice(2)}@test.io`;

  const clave = await request(servidor)
    .post('/invitaciones')
    .set('Authorization', `Bearer ${gimnasio.adminToken}`)
    .send({ nombre: 'Clave de test', salaIds, packId: opciones.packId })
    .expect(201);

  const alta = await request(servidor)
    .post('/auth/auto-registro')
    .send({
      tenantSlug: gimnasio.slug,
      codigo: clave.body.codigo,
      nombreCompleto: 'Alumno de Test',
      email,
      password: 'Password123!',
    })
    .expect(201);

  const detalle = await request(servidor)
    .get(`/usuarios/${alta.body.usuario.id}`)
    .set('Authorization', `Bearer ${gimnasio.adminToken}`)
    .expect(200);

  return {
    usuarioId: alta.body.usuario.id,
    perfilId: detalle.body.perfilId ?? detalle.body.perfil?.id,
    token: alta.body.accessToken,
    email,
  };
}

/**
 * Publica un mes y espera a que el worker termine. Sin esto, el alumno no ve
 * ningun turno: el gate de HABILITADO es la decision D1 de la fase.
 */
export async function publicarMes(
  app: INestApplication,
  token: string,
  salaId: string,
  anio: number,
  mes: number,
): Promise<void> {
  const servidor = app.getHttpServer();

  await request(servidor)
    .post(`/calendario/${salaId}/${anio}/${mes}/publicar`)
    .set('Authorization', `Bearer ${token}`)
    .expect(202);

  const estado = await esperarPublicacion(servidor, token, salaId, anio, mes);
  if (estado.publicacion?.estado !== 'terminado') {
    throw new Error(`La publicacion fallo: ${JSON.stringify(estado.publicacion)}`);
  }
}
```

Comprueba el nombre real del campo del perfil en la respuesta de `GET /usuarios/:id` y ajusta
`detalle.body.perfilId ?? detalle.body.perfil?.id` a lo que devuelva de verdad.

- [ ] **Step 2: Escribir los e2e**

Crear `apps/api/test/selfservice.e2e-spec.ts`. Es un archivo largo; estos son los ocho bloques que
tiene que cubrir, con el detalle suficiente para escribirlo sin inventar nada:

```ts
import type { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import {
  crearAlumnoPorInvitacion,
  crearAppDeTest,
  crearGimnasio,
  limpiarBaseDeDatos,
  publicarMes,
  type GimnasioDeTest,
} from './helpers';
import type { PrismaService } from '../src/prisma/prisma.service';

const ANIO = 2099;
const MES = 10;
const FECHA = `${ANIO}-${MES}-13`.replace('-10-', '-10-'); // 2099-10-13

describe('Fase 3A — self-service del alumno', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let gym: GimnasioDeTest;

  beforeAll(async () => {
    ({ app, prisma } = await crearAppDeTest());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await limpiarBaseDeDatos(prisma);
    gym = await crearGimnasio(app, `gym-${Date.now()}`);
  });

  // -------------------------------------------------------------------------
  // 1. Auto-registro
  // -------------------------------------------------------------------------
  describe('auto-registro', () => {
    it('un alumno se da de alta con una clave valida y queda operativo', async () => {
      // Crear sala con cupoBase, crear pack, crear invitacion con ambas.
      // POST /auth/auto-registro -> 201 con accessToken y usuario.rol === 'ALUMNO'.
      // GET /usuarios?autoRegistrado=true con el token del admin -> lo incluye.
      // GET /auth/me con el token del alumno -> devuelve su usuario.
    });

    it('rechaza una clave inactiva, caducada o agotada con 401', async () => {
      // Tres casos: PATCH /invitaciones/:id {activa:false}; una con expiraEn en
      // el pasado; una con usosMax 1 ya consumida. Los tres -> 401.
    });

    it('rechaza un email repetido en el mismo gimnasio con 409', async () => {});

    it('el mismo email SI puede registrarse en otro gimnasio', async () => {
      // El @@unique de Usuario es [tenantId, email], no email a secas.
    });

    // Este va COMPLETO porque es el que prueba la carrera, y una carrera mal
    // probada da falsos verdes: si el test fuera secuencial pasaria igual con
    // una implementacion sin aislamiento ninguno.
    it('CONCURRENCIA: diez altas simultaneas con una clave de un solo uso dan exactamente un 201', async () => {
      const servidor = app.getHttpServer();

      const sala = await request(servidor)
        .post('/salas')
        .set('Authorization', `Bearer ${gym.adminToken}`)
        .send({ nombre: 'Sala A', cupoBase: 10 })
        .expect(201);

      const clave = await request(servidor)
        .post('/invitaciones')
        .set('Authorization', `Bearer ${gym.adminToken}`)
        .send({ nombre: 'Una sola plaza', salaIds: [sala.body.id], usosMax: 1 })
        .expect(201);

      // Sin await entre medias: las diez salen a la vez. Con `for await` el
      // test pasaria aunque no hubiera ningun aislamiento.
      const respuestas = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          request(servidor)
            .post('/auth/auto-registro')
            .send({
              tenantSlug: gym.slug,
              codigo: clave.body.codigo,
              nombreCompleto: `Alumno ${i}`,
              email: `concurrente-${i}@test.io`,
              password: 'Password123!',
            }),
        ),
      );

      const creados = respuestas.filter((r) => r.status === 201);
      const rechazados = respuestas.filter((r) => r.status === 401 || r.status === 409);

      expect(creados).toHaveLength(1);
      expect(rechazados).toHaveLength(9);
      // Ni un 500: agotar una clave es un conflicto, no un fallo del servidor.
      expect(respuestas.filter((r) => r.status >= 500)).toHaveLength(0);

      const claves = await request(servidor)
        .get('/invitaciones')
        .set('Authorization', `Bearer ${gym.adminToken}`)
        .expect(200);

      expect(claves.body[0].usosActuales).toBe(1);

      // Y en la base hay exactamente un alumno, no diez.
      const alumnos = await request(servidor)
        .get('/usuarios?autoRegistrado=true')
        .set('Authorization', `Bearer ${gym.adminToken}`)
        .expect(200);

      expect(alumnos.body).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Descubrimiento de turnos
  // -------------------------------------------------------------------------
  describe('turnos disponibles', () => {
    it('los turnos de un mes SIN publicar no aparecen', async () => {
      // Crear turno, NO publicar el mes.
      // GET /turnos-disponibles con el token del alumno -> [].
    });

    it('tras publicar el mes, el turno aparece como LIBRE', async () => {
      // publicarMes(...) y luego GET /turnos-disponibles ->
      // [{ disponibilidad: { estado: 'LIBRE', puedeReservar: true } }].
    });

    it('una sala a la que el alumno no tiene acceso no aparece', async () => {});
  });

  // -------------------------------------------------------------------------
  // 3. Reserva y cancelacion propias
  // -------------------------------------------------------------------------
  describe('reserva propia', () => {
    it('el alumno reserva y la clase aparece en su calendario', async () => {
      // POST /turnos/:id/mi-reserva -> 201.
      // GET /mi-calendario?desde=&hasta= -> una clase con origen 'ALUMNO'.
    });

    it('reservar dos veces el mismo turno da 409', async () => {});

    it('fuera de la ventana de anotacion da 409', async () => {
      // PATCH /salas/:id { minMinutosAnotarse: 999999 } y luego reservar.
    });

    it('la ventana se hereda del tenant cuando la sala la tiene en null', async () => {
      // Requiere poder escribir la config del tenant. Si no hay endpoint,
      // escribirla directo con prisma.base dentro del test y dejarlo comentado:
      // es configuracion, no logica de negocio bajo prueba.
    });
  });

  describe('cancelacion propia', () => {
    it('dentro de la ventana cancela como RECUPERABLE', async () => {
      // DELETE /mis-reservas/:id -> 200 con cancelacionTipo 'RECUPERABLE'.
      // GET /mi-calendario -> ya no aparece.
    });

    it('fuera de la ventana da 409 y la reserva sigue activa', async () => {
      // PATCH /salas/:id { minMinutosCancelar: 999999 }.
    });

    it('cancelar la reserva de otro alumno da 403', async () => {});
  });

  // -------------------------------------------------------------------------
  // 4. Lista de espera
  // -------------------------------------------------------------------------
  describe('lista de espera', () => {
    it('un turno lleno OFRECE la lista de espera en vez de un error generico', async () => {
      // Sala con cupoBase 1 y listaEsperaHabilitada true.
      // Alumno A reserva; alumno B intenta -> 409 cuyo mensaje menciona
      // "lista de espera".
      // GET /turnos-disponibles de B -> estado 'LISTA_ESPERA'.
    });

    it('B se anota y ve su posicion', async () => {
      // POST /turnos/:id/lista-espera -> 201 con posicion 1.
    });

    // Va COMPLETO: es el punto 5 del checklist del PDF y el que mas piezas
    // encadena (cancelacion, cerrojo de la transaccion, asignacion, hook).
    it('PUNTO CLAVE: al cancelar A, B entra automaticamente', async () => {
      const servidor = app.getHttpServer();

      // Sala de UNA plaza, con lista de espera encendida.
      const sala = await request(servidor)
        .post('/salas')
        .set('Authorization', `Bearer ${gym.adminToken}`)
        .send({ nombre: 'Sala chica', cupoBase: 1, listaEsperaHabilitada: true })
        .expect(201);

      const a = await crearAlumnoPorInvitacion(app, gym, [sala.body.id], {
        email: 'alumno-a@test.io',
      });
      const b = await crearAlumnoPorInvitacion(app, gym, [sala.body.id], {
        email: 'alumno-b@test.io',
      });

      const turno = await request(servidor)
        .post('/turnos')
        .set('Authorization', `Bearer ${gym.adminToken}`)
        .send({
          salaId: sala.body.id,
          nombre: 'Pilates',
          fecha: `${ANIO}-10-13`,
          horaInicio: '18:00',
          horaFin: '19:00',
          cupo: 1,
        })
        .expect(201);

      await publicarMes(app, gym.adminToken, sala.body.id, ANIO, MES);

      // A se queda con la unica plaza.
      const reservaA = await request(servidor)
        .post(`/turnos/${turno.body.id}/mi-reserva`)
        .set('Authorization', `Bearer ${a.token}`)
        .expect(201);

      // B intenta y recibe la OFERTA de la cola, no un error generico.
      const rechazo = await request(servidor)
        .post(`/turnos/${turno.body.id}/mi-reserva`)
        .set('Authorization', `Bearer ${b.token}`)
        .expect(409);
      expect(rechazo.body.message).toMatch(/lista de espera/i);

      const enCola = await request(servidor)
        .post(`/turnos/${turno.body.id}/lista-espera`)
        .set('Authorization', `Bearer ${b.token}`)
        .expect(201);
      expect(enCola.body.posicion).toBe(1);

      // Antes de cancelar, B no tiene ninguna clase.
      const antes = await request(servidor)
        .get(`/mi-calendario?desde=${ANIO}-10-01&hasta=${ANIO}-10-31`)
        .set('Authorization', `Bearer ${b.token}`)
        .expect(200);
      expect(antes.body).toHaveLength(0);

      // A cancela: aqui es donde tiene que dispararse la asignacion.
      await request(servidor)
        .delete(`/mis-reservas/${reservaA.body.id}`)
        .set('Authorization', `Bearer ${a.token}`)
        .expect(200);

      const despues = await request(servidor)
        .get(`/mi-calendario?desde=${ANIO}-10-01&hasta=${ANIO}-10-31`)
        .set('Authorization', `Bearer ${b.token}`)
        .expect(200);

      expect(despues.body).toHaveLength(1);
      expect(despues.body[0]).toMatchObject({
        turnoId: turno.body.id,
        // El origen es lo que le permite a B entender despues por que le
        // aparecio una clase que no reservo.
        origen: 'LISTA_ESPERA',
      });

      // Y su fila de la cola desaparecio: ya no espera nada.
      const disponibles = await request(servidor)
        .get(`/turnos-disponibles?desde=${ANIO}-10-01&hasta=${ANIO}-10-31`)
        .set('Authorization', `Bearer ${b.token}`)
        .expect(200);

      const elTurno = disponibles.body.find(
        (t: { turnoId: string }) => t.turnoId === turno.body.id,
      );
      expect(elTurno.disponibilidad.enListaEspera).toBe(false);
      expect(elTurno.disponibilidad.motivo).toBe('YA_RESERVADO');
    });

    it('respeta el orden de la cola: entra el que se anoto primero', async () => {
      // Tres alumnos: A reserva, B y C se anotan en ese orden.
      // A cancela -> entra B, no C. C sigue en la cola, ahora en posicion 1.
    });

    it('salirse de la lista funciona y libera el puesto', async () => {});

    it('anotarse en un turno con cupo da 409', async () => {});
  });

  // -------------------------------------------------------------------------
  // 5. Comprobantes
  // -------------------------------------------------------------------------
  describe('comprobantes', () => {
    // Va COMPLETO porque es el unico test que ejercita la subida de verdad, que
    // es justo lo que un mock habria dejado sin probar hasta produccion.
    it('ciclo completo: crear, SUBIR DE VERDAD, confirmar, aprobar', async () => {
      const servidor = app.getHttpServer();

      const sala = await request(servidor)
        .post('/salas')
        .set('Authorization', `Bearer ${gym.adminToken}`)
        .send({ nombre: 'Sala A', cupoBase: 5 })
        .expect(201);

      const alumno = await crearAlumnoPorInvitacion(app, gym, [sala.body.id]);
      const CONTENIDO = Buffer.from('%PDF-1.4 comprobante de prueba');

      // 1. Crear la fila y pedir la URL firmada.
      const creado = await request(servidor)
        .post('/comprobantes')
        .set('Authorization', `Bearer ${alumno.token}`)
        .send({ nombreOriginal: 'transferencia.pdf', tipoMime: 'application/pdf' })
        .expect(201);

      expect(creado.body.comprobante.subidoEn).toBeNull();
      expect(creado.body.urlDeSubida).toContain('/archivos-locales/');

      // 2. Subir el archivo A ESA URL. Se le quita el origen porque supertest
      //    ataca a la misma app por su puerto efimero, no al host de la URL.
      const subida = new URL(creado.body.urlDeSubida);
      await request(servidor)
        .put(`${subida.pathname}${subida.search}`)
        .set('Content-Type', 'application/pdf')
        .send(CONTENIDO)
        .expect(200);

      // 3. Confirmar.
      const confirmado = await request(servidor)
        .patch(`/comprobantes/${creado.body.comprobante.id}/confirmar`)
        .set('Authorization', `Bearer ${alumno.token}`)
        .expect(200);

      expect(confirmado.body.subidoEn).not.toBeNull();

      // El admin ya lo ve, con su URL de descarga.
      const pendientes = await request(servidor)
        .get('/comprobantes?estado=PENDIENTE')
        .set('Authorization', `Bearer ${gym.adminToken}`)
        .expect(200);

      expect(pendientes.body).toHaveLength(1);
      expect(pendientes.body[0].urlDeDescarga).toContain('/archivos-locales/');

      // Y lo que se descarga es EXACTAMENTE lo que se subio. Sin esto, el test
      // probaria que las URLs se firman, no que el archivo llego.
      const descarga = new URL(pendientes.body[0].urlDeDescarga);
      const bajado = await request(servidor)
        .get(`${descarga.pathname}${descarga.search}`)
        .buffer(true)
        .parse((res, cb) => {
          const trozos: Buffer[] = [];
          res.on('data', (t: Buffer) => trozos.push(t));
          res.on('end', () => cb(null, Buffer.concat(trozos)));
        })
        .expect(200);

      expect(Buffer.from(bajado.body)).toEqual(CONTENIDO);

      // 4. Aprobar.
      const aprobado = await request(servidor)
        .patch(`/comprobantes/${creado.body.comprobante.id}/aprobar`)
        .set('Authorization', `Bearer ${gym.adminToken}`)
        .send({})
        .expect(200);

      expect(aprobado.body).toMatchObject({ estado: 'APROBADO', revisadoPor: gym.adminId });

      // Y el alumno queda al dia: es lo que le da sentido a todo el flujo.
      const detalle = await request(servidor)
        .get(`/usuarios/${alumno.usuarioId}`)
        .set('Authorization', `Bearer ${gym.adminToken}`)
        .expect(200);

      expect(detalle.body.pagoAlDia).toBe(true);
    });

    it('sin confirmar, el admin no lo ve', async () => {});

    it('aprobar un comprobante sin archivo da 409', async () => {});

    it('una URL de descarga con la firma cambiada da 403', async () => {
      // Cambiar un caracter del query param `firma`.
    });

    it('un alumno no ve los comprobantes de otro', async () => {});

    it('rechaza un tipo de archivo no admitido con 409', async () => {});
  });

  // -------------------------------------------------------------------------
  // 6. Aislamiento entre gimnasios
  // -------------------------------------------------------------------------
  describe('aislamiento', () => {
    it('un alumno de un gimnasio no ve turnos del otro', async () => {});

    it('un codigo de invitacion de un gimnasio no sirve en el otro', async () => {
      // Crear la clave en gym A y usarla con tenantSlug de gym B -> 401.
      // Es lo que protege el @@unique([tenantId, codigo]) en vez del global.
    });

    it('reservar un turno del otro gimnasio da 404, no 403', async () => {});
  });

  // -------------------------------------------------------------------------
  // 7. Throttling
  // -------------------------------------------------------------------------
  describe('throttling', () => {
    it('el sexto intento de auto-registro en un minuto da 429', async () => {
      // Seis POST /auth/auto-registro seguidos con codigo invalido.
      // Los cinco primeros 401; el sexto 429.
    });
  });
});
```

**Escribe los cuerpos completos**, no dejes los comentarios como están: son el guion, no el
resultado. Cada `it` tiene que tener sus `request(...).expect(...)` de verdad.

- [ ] **Step 3: Ejecutar los e2e**

**Antes de nada, comprueba que la API de desarrollo no esté levantada** (regla 5 de esta casa):

```bash
netstat -ano | grep ":3000" | head -5
docker info > /dev/null && echo "docker ok"
```

Si hay algo en el 3000, mátalo **por PID concreto**, nunca por nombre de proceso.

```bash
cd apps/api && pnpm test:e2e
```

Esperado: los 79 e2e anteriores más los nuevos, todos en verde.

- [ ] **Step 4: Ejecutar los e2e tres veces seguidas**

```bash
cd apps/api && for i in 1 2 3; do pnpm test:e2e || break; done
```

Esperado: tres corridas idénticas en verde. Los tests de lista de espera y de concurrencia tocan
carreras reales; un fallo intermitente aquí es un bug de verdad, no un test frágil.

- [ ] **Step 5: Comprobar formato**

```bash
cd /d/Dev/box-admin && pnpm exec prettier --check "apps/api/test/**/*.ts"
```

**Mensaje de commit sugerido para Cesar:**

```
test(api): e2e de la Fase 3A

Ocho bloques: auto-registro con concurrencia sobre usosMax, descubrimiento con
gate de mes publicado, reserva y cancelacion propias, lista de espera con
asignacion automatica, ciclo completo de comprobante con subida real contra el
almacen local, aislamiento entre gimnasios y throttling.
```

---

## Task 17: Verificación final, README y tracker

**Files:**
- Modificar: `README.md`
- Modificar: `docs/superpowers/plans/PROGRESO.md`

- [ ] **Step 1: Verificación completa**

```bash
cd packages/shared && pnpm exec jest
cd apps/api && pnpm exec tsc --noEmit && pnpm test && pnpm test:e2e
cd apps/api && pnpm exec dotenv -e ../../.env -- prisma migrate status
cd /d/Dev/box-admin && pnpm exec prettier --check "packages/shared/src/**/*.ts" "apps/api/src/**/*.ts" "apps/api/test/**/*.ts"
```

Esperado: todo en verde, `Database schema is up to date!`, formato correcto.

- [ ] **Step 2: Comprobar que no hay nada commiteado ni secretos sueltos**

```bash
cd /d/Dev/box-admin && git diff --cached --stat
git check-ignore -v .env .env.test var/almacen
git status --short
```

Esperado: índice vacío, los tres ignorados, y en `git status` solo los archivos de la fase.

- [ ] **Step 3: Recorrer el checklist de aceptación a mano**

Levanta la API (`pnpm api:dev`) y comprueba los ocho puntos del §10 del spec **con `curl`**, no solo
por e2e. Los e2e prueban que el código hace lo que el código dice; esto prueba que hace lo que hacía
falta.

Anota el resultado de cada punto: es lo que va en el tracker.

- [ ] **Step 4: Documentar los endpoints en el README**

Añadir a `README.md` una sección "Endpoints de la Fase 3A — self-service del alumno", con las cuatro
tablas (invitaciones, auto-registro, calendario del alumno, comprobantes), y estos avisos, que son lo
que no se deduce leyendo las rutas:

- **El alumno solo descubre turnos de meses `HABILITADO`**, pero ve siempre sus propias reservas.
- **El flujo de comprobantes es de tres pasos** y por qué.
- **`ALMACEN_TIPO`** y las variables que cada modo exige.
- **`Sala.exclusiva` sigue sin efecto.**
- El aviso de que **los e2e y la API de desarrollo comparten Redis**, si no está ya.

- [ ] **Step 5: Actualizar el tracker**

En `docs/superpowers/plans/PROGRESO.md`, marcar las 18 tareas (T0-T17) y escribir el bloque "Estado final de
la Fase 3A" con:

- Números de tests (shared, unitarios, e2e).
- La tabla del checklist verificada a mano.
- **Los errores de este plan que encontraste al ejecutarlo**, si los hubo. Los hubo en las Fases 1 y
  2 —tres en cada una—, y anotarlos es lo que hace que el siguiente plan sea mejor.
- Las trampas de entorno nuevas que aparecieran.

- [ ] **Step 6: Comprobar el README**

```bash
cd /d/Dev/box-admin && grep -c '^```' README.md
```

Esperado: un número **par** (los bloques de código están balanceados).

**Mensaje de commit sugerido para Cesar:**

```
docs: endpoints de la Fase 3A y estado en el tracker
```

---

## Verificación del plan contra el spec

| Sección del spec | Tarea que la implementa |
|---|---|
| §2 D1 — mes `HABILITADO` | T4 (`MES_NO_PUBLICADO`), T5, T10 |
| §2 D2 — asignación automática | T11, T12 |
| §2 D3 — puerto de almacenamiento | T14 |
| §2 D4 — config en `Tenant` | T2, T3 |
| §2 D5 — la clave lleva salas y pack | T2, T6, T7 |
| §2 D6 — sin rutina inicial | fuera de alcance, sin tarea |
| §2 D7 — `exclusiva` inerte | sin tarea, documentado en T17 |
| §2 D8 — throttling | T8 |
| §3.1 — correcciones del schema | T2 |
| §3.2 — campos nuevos | T2 |
| §3.3 — modelos nuevos | T2 |
| §4 — `DisponibilidadService` | T4 (pura), T5 (servicio) |
| §5.1 — invitaciones | T6 |
| §5.2 — auto-registro y filtro | T7, T9 |
| §5.3 — self-service de calendario | T10, T12, T13 |
| §5.4 — comprobantes | T15 |
| §6 — almacenamiento | T14 |
| §7 — lista de espera | T12 |
| §7.1 — impacto en la Fase 1 | T12 |
| §8 — auditoría | T6 (entidades), y en cada servicio |
| §9 — pruebas | T4 (tabla de decisión), T16 (e2e) |
| §10 — checklist de aceptación | T17 |
