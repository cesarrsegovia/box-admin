# Fase 4 — El profesor como entidad real: plan de implementación

> **Para agentes:** SUB-SKILL OBLIGATORIA: usa `superpowers:subagent-driven-development` o
> `superpowers:executing-plans` para ejecutar este plan tarea a tarea. Los pasos usan casillas
> (`- [ ]`) para poder marcarlos.

**Objetivo:** que `Turno.profesorId` sea una relación real, que la profesora tenga su vista de "mis
clases" con sus alumnos, y que quede el dato estructurado para liquidar por horas — sin tocar el
nombre de la actividad.

**Arquitectura:** dos funciones puras nuevas (`resolverProfesorDeFranja` y `calcularLiquidacion`) sin
una sola query dentro, más tres módulos de NestJS que las alimentan desde la base. El patrón es el
que dejó montada la Fase 2: la aritmética se prueba con tablas de casos y el I/O vive en el cargador.

**Stack:** NestJS 10 · Prisma 7 + PostgreSQL 16 · TypeScript estricto · Jest + Supertest ·
`@boxadmin/shared` para los contratos y los helpers de fecha.

**Spec:** `docs/superpowers/specs/2026-09-21-fase4-profesor-real.md`

---

## Antes de empezar: cinco trampas de este repositorio

Las cinco costaron tiempo en fases anteriores y están documentadas en
`docs/superpowers/plans/PROGRESO.md`. Léelas antes del primer comando.

1. **Nunca `docker compose up` a secas.** Solo `docker compose up -d postgres postgres-test redis`.
   Levantar el servicio `api` del compose arranca una segunda API que **le roba los jobs a Redis** y
   deja los e2e fallando con errores que no mencionan Redis por ningún lado.
2. **"El puerto está libre" no significa "no hay proceso vivo".** `nest start --watch` deja hijos que
   siguen consumiendo la cola. Comprueba los procesos, no el puerto:
   ```bash
   powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { \$_.CommandLine -like '*box-admin*' } | Select-Object ProcessId, CommandLine"
   ```
   Y **mata siempre por PID**, jamás por nombre: hay una sesión de Claude Code corriendo en esta
   misma máquina sobre node.
3. **Nunca corras `pnpm lint`** en `apps/api` ni en `packages/shared`: lleva `--fix` y reformatea
   código ya commiteado que no pasa Prettier. Usa `pnpm exec prettier --check` sobre lo que escribas.
4. **`prisma migrate reset` y `docker compose down -v` necesitan permiso explícito de Cesar.** No los
   ejecutes por tu cuenta.
5. **Prisma 7 no genera el cliente solo.** Después de tocar `schema.prisma`:
   ```bash
   cd apps/api && pnpm exec dotenv -e ../../.env -- prisma generate
   ```
   Si te saltas esto, `tsc` explota con decenas de `Parameter 'tx' implicitly has an 'any' type` que
   no mencionan Prisma.

**Los commits los hace Cesar.** No ejecutes `git add`, `git commit`, `git push`, `git stash`,
`git checkout` ni `git reset`. Cada tarea termina con un mensaje de commit **sugerido** para que él
lo use. `git status` y `git diff` sí puedes usarlos.

---

## Estructura de archivos

### Se crean

| Archivo | Responsabilidad |
|---|---|
| `packages/shared/src/profesor.contracts.ts` | Los contratos de esta fase, en su propio archivo |
| `apps/api/src/horarios-profesor/resolver-profesor.ts` | **Función pura**: qué horario cubre una franja |
| `apps/api/src/horarios-profesor/resolver-profesor.spec.ts` | Su tabla de casos |
| `apps/api/src/horarios-profesor/horarios-profesor.service.ts` | CRUD + las dos comprobaciones de solape |
| `apps/api/src/horarios-profesor/horarios-profesor.service.spec.ts` | Unitarios del servicio |
| `apps/api/src/horarios-profesor/horarios-profesor.controller.ts` | Las cuatro rutas |
| `apps/api/src/horarios-profesor/horarios-profesor.module.ts` | El módulo |
| `apps/api/src/horarios-profesor/dto/crear-horario-profesor.dto.ts` | DTO de alta |
| `apps/api/src/horarios-profesor/dto/actualizar-horario-profesor.dto.ts` | DTO de cambio |
| `apps/api/src/mis-clases/mis-clases.service.ts` | Las tres operaciones del rol `PROFESOR` |
| `apps/api/src/mis-clases/mis-clases.service.spec.ts` | Unitarios, sobre todo del aislamiento |
| `apps/api/src/mis-clases/mis-clases.controller.ts` | Las tres rutas |
| `apps/api/src/mis-clases/mis-clases.module.ts` | El módulo |
| `apps/api/src/mis-clases/dto/pasar-lista.dto.ts` | `{ presentes: string[] }` |
| `apps/api/src/liquidacion/calcular-liquidacion.ts` | **Función pura**: las horas del mes |
| `apps/api/src/liquidacion/calcular-liquidacion.spec.ts` | Su tabla de casos |
| `apps/api/src/liquidacion/liquidacion.datos.ts` | El cargador: base → entrada de la función pura |
| `apps/api/src/liquidacion/liquidacion.service.ts` | Validación del profesor y orquestación |
| `apps/api/src/liquidacion/liquidacion.controller.ts` | La ruta |
| `apps/api/src/liquidacion/liquidacion.module.ts` | El módulo |
| `apps/api/src/turnos/dto/asignar-profesor.dto.ts` | `{ profesorId: string \| null }` |
| `apps/api/test/profesor.e2e-spec.ts` | Los nueve puntos del checklist |

### Se modifican

| Archivo | Cambio |
|---|---|
| `apps/api/prisma/schema.prisma` | `Turno.profesorId`, `Reserva.asistio`, `Tenant.tarifaPorHoraProfesor`, modelo nuevo |
| `apps/api/src/common/tenant/tenant-scoped.extension.ts` | Clasificar `HorarioProfesorAsignado` |
| `apps/api/src/common/historial/historial.service.ts` | `'HorarioProfesorAsignado'` y `'ASISTENCIA_REGISTRADA'` |
| `apps/api/test/helpers.ts` | La tabla nueva en el TRUNCATE y un helper `crearProfesor` |
| `packages/shared/src/index.ts` | Exportar los contratos nuevos |
| `packages/shared/src/calendario.ts` | `fechaEnRango` y `horasSeSolapan` |
| `packages/shared/src/fechas.ts` | `minutosEntreHoras` |
| `packages/shared/src/nucleo.contracts.ts` | `TurnoPublico.profesor`, `ReservaPublica.asistio` |
| `apps/api/src/turnos/turnos.service.ts` | Profesora al crear, en la respuesta, y el filtro |
| `apps/api/src/turnos/turnos.controller.ts` | `?profesorId=` y `PATCH /:id/profesor` |
| `apps/api/src/turnos/dto/crear-turno.dto.ts` | `profesorId` opcional |
| `apps/api/src/turnos/turnos.module.ts` | Importar `HorariosProfesorModule` |
| `apps/api/src/jobs/generacion-mes/generacion-mes.service.ts` | Resolver profesora y emitir etiquetas |
| `apps/api/src/jobs/generacion-mes/publicacion.service.ts` | Aplicar las etiquetas |
| `apps/api/src/calendario/calendario.datos.ts` | Cargar los horarios y el `profesorId` de los turnos |
| `packages/shared/src/recurrencia.contracts.ts` | `TurnoPlanificado.profesorId`, `EtiquetaDeProfesor` |
| `apps/api/src/reservas/reservas.service.ts` | `asistio` en `aReservaPublica` |
| `apps/api/src/app.module.ts` | Los tres módulos nuevos |
| `README.md` · `docs/superpowers/plans/PROGRESO.md` | Documentación y tracker |

---

## Task 0: El schema, la migración y la clasificación

**Files:**
- Modificar: `apps/api/prisma/schema.prisma`
- Modificar: `apps/api/src/common/tenant/tenant-scoped.extension.ts:5-22`
- Modificar: `apps/api/src/common/historial/historial.service.ts:6-18`
- Modificar: `apps/api/test/helpers.ts:28-37`

⚠️ **El orden de esta tarea importa y no es negociable.** Los meta-tests de la extensión de
aislamiento comparan la clasificación contra el DMMF **real** de Prisma. Si corres los tests antes de
`prisma generate`, fallan con un mensaje que apunta a la clasificación cuando el problema es que el
cliente no conoce el modelo. En la Fase 3A esto costó una vuelta entera de depuración.

- [ ] **Step 1: Levantar la infraestructura**

```bash
cd /d/Dev/box-admin && docker compose up -d postgres postgres-test redis
docker compose ps
```

Esperado: tres contenedores `Up`. **`postgres` y `postgres-test` son dos bases distintas**, en 5433 y
5434; los e2e usan la segunda.

- [ ] **Step 2: Añadir los tres campos a los modelos existentes**

En `apps/api/prisma/schema.prisma`, dentro de `model Turno`, justo después de la línea `nombre String
// ej. "Pilates". En Fase 4 se agrega profesorId.` — y de paso corrige ese comentario, que ya no
anuncia el futuro:

```prisma
  nombre String // ej. "Pilates"

  // La relacion que esta fase viene a crear. Antes de ella, el vinculo con la
  // profesora vivia DENTRO de `nombre` ("Circuito (Fati)"), que es el hallazgo
  // central del relevamiento de TurnoFit.
  //
  // FK COMPUESTA por tenant, como todo el schema desde la Fase 1: la base
  // impide por si misma que un turno cuelgue de una profesora de otro gimnasio.
  profesorId String?
  profesor   Perfil? @relation("TurnoProfesor", fields: [tenantId, profesorId], references: [tenantId, id])
```

Y en los índices de `Turno`, junto a los que ya hay:

```prisma
  // El filtro ?profesorId= del calendario admin (§4 del PDF) y la vista de
  // "mis clases" preguntan las dos por esta columna.
  @@index([tenantId, profesorId])
```

En `model Reserva`, después de `pagoRealizado`:

```prisma
  // null = todavia no se paso lista. La asistencia es una propiedad de "este
  // alumno en esta clase", y eso es exactamente una Reserva: no hace falta una
  // tabla aparte donde la misma verdad pueda discrepar consigo misma.
  asistio Boolean?
```

En `model Tenant`, después de `listaEsperaHabilitada`:

```prisma
  // El eslabon que faltaba de la cascada de tarifas: HorarioProfesorAsignado
  // documenta "null = usa la tarifa general del tenant", y esa tarifa no
  // existia en ningun sitio. La Fase 6 la multiplica; esta fase solo la resuelve.
  tarifaPorHoraProfesor Decimal? @db.Decimal(10, 2)
```

- [ ] **Step 3: Añadir el modelo nuevo**

Al final de `schema.prisma`:

```prisma
model HorarioProfesorAsignado {
  // El patron semanal de una profesora: "lunes y miercoles 18:00 en Pilates".
  //
  // Conceptualmente es lo mismo que RutinaFija, pero para DICTAR en vez de para
  // tomar, y se mantiene como modelo aparte porque las reglas de negocio no se
  // parecen en nada: no consume pack, no tiene cancelaciones, y alimenta la
  // liquidacion en vez del consumo de clases.
  //
  // NO genera turnos. Solo los etiqueta (decision D1 de la fase): si generara,
  // toda hora contratada seria automaticamente una hora dictada y la metrica
  // que la liquidacion tiene que dar mediria siempre cero.
  id       String @id @default(cuid())
  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id])

  profesorId String
  profesor   Perfil @relation(fields: [tenantId, profesorId], references: [tenantId, id], onDelete: Cascade)
  salaId     String
  sala       Sala   @relation(fields: [tenantId, salaId], references: [tenantId, id], onDelete: Cascade)

  diaSemana  Int // 0 = domingo ... 6 = sabado, igual que RutinaFija
  horaInicio String // "HH:MM", misma convencion que Turno
  horaFin    String

  activo Boolean   @default(true)
  desde  DateTime  @db.Date
  hasta  DateTime? @db.Date // null = indefinido

  // null = usa Tenant.tarifaPorHoraProfesor. La cascada se resuelve en la
  // liquidacion, que la devuelve resuelta sin multiplicarla: el importe en
  // pesos es de la Fase 6.
  tarifaPorHora Decimal? @db.Decimal(10, 2)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([tenantId, profesorId])
  // El indice del etiquetado: el motor pregunta por sala + dia en cada franja
  // del mes que planifica.
  @@index([tenantId, salaId, diaSemana])
  @@map("horarios_profesor_asignados")
}
```

- [ ] **Step 4: Añadir las relaciones inversas**

Prisma exige el otro lado de cada relación. Sin esto la validación del schema falla antes de generar
nada.

En `model Perfil`, junto a `reservas`, `rutinasFijas`, etc.:

```prisma
  // El nombre de la relacion es obligatorio porque Perfil ya se relaciona con
  // Turno por otro camino (a traves de Reserva), y Prisma no sabria cual es cual.
  turnosComoProfesor Turno[]                   @relation("TurnoProfesor")
  horariosAsignados  HorarioProfesorAsignado[]
```

En `model Sala`:

```prisma
  horariosProfesor HorarioProfesorAsignado[]
```

En `model Tenant`:

```prisma
  horariosProfesor HorarioProfesorAsignado[]
```

- [ ] **Step 5: Validar el schema ANTES de migrar**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec dotenv -e ../../.env -- prisma validate
```

Esperado: `The schema at prisma\schema.prisma is valid 🚀`

Si se queja de una relación sin su par, vuelve al paso 4 — es más barato que arreglarlo después de
una migración a medias.

- [ ] **Step 6: Crear la migración**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec dotenv -e ../../.env -- prisma migrate dev --name fase4_profesor_real
```

Esperado: una carpeta nueva en `prisma/migrations/` y `Your database is now in sync with your schema.`

- [ ] **Step 7: Aplicar la migración a la base de tests**

Los e2e corren contra la base del 5434, que `migrate dev` no toca.

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec dotenv -e ../../.env.test -- prisma migrate deploy
```

Esperado: `All migrations have been successfully applied.`

- [ ] **Step 8: Generar el cliente**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec dotenv -e ../../.env -- prisma generate
```

Esperado: `Generated Prisma Client`.

**Esto es lo que hace que el paso siguiente pueda funcionar.** Sin cliente regenerado, la extensión
no conoce el modelo nuevo.

- [ ] **Step 9: Clasificar el modelo en la extensión de aislamiento**

En `apps/api/src/common/tenant/tenant-scoped.extension.ts`, dentro de `MODELOS_CON_TENANT`, después
de `'Comprobante'`:

```ts
  'Comprobante',
  'HorarioProfesorAsignado',
] as const;
```

Sin esto, **cualquier** query sobre el modelo se bloquea con `ModeloNoClasificadoError`, que es el
comportamiento correcto: la extensión falla cerrada.

- [ ] **Step 10: Correr los meta-tests de la extensión**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/common/tenant --silent
```

Esperado: todo en verde. Si aparece `El modelo HorarioProfesorAsignado no esta clasificado`, el paso
9 no se guardó; si aparece que sobra un modelo, es que el paso 8 no se corrió.

- [ ] **Step 11: Ampliar las entidades auditables**

En `apps/api/src/common/historial/historial.service.ts`, en `EntidadAuditable`, después de
`'ListaEspera'`:

```ts
  | 'ListaEspera'
  | 'HorarioProfesorAsignado';
```

Y en `AccionAuditable`, después de `'AUTO_REGISTRADO'`:

```ts
  | 'AUTO_REGISTRADO'
  | 'PROFESOR_ASIGNADO'
  | 'ASISTENCIA_REGISTRADA';
```

- [ ] **Step 12: Añadir la tabla al TRUNCATE de los e2e**

En `apps/api/test/helpers.ts`, dentro de `limpiarBaseDeDatos`, en la primera línea de la lista:

```ts
    'TRUNCATE TABLE ' +
      '"horarios_profesor_asignados", "comprobantes", "listas_espera", ' +
      '"claves_invitacion_salas", "claves_invitacion", ' +
```

Va primero por orden de dependencia, aunque `CASCADE` lo haría igual. Si se olvida, los tests de esta
fase se contaminan entre sí de una forma especialmente confusa: el solape de D5 empieza a dispararse
contra horarios de un test anterior.

- [ ] **Step 13: Comprobar que nada se rompió**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec tsc --noEmit && pnpm test
```

Esperado: `tsc` limpio y los 606 unitarios en verde. Todavía no hay nada nuevo que probar; esto
comprueba que los campos añadidos no rompieron ningún tipo existente.

**Mensaje de commit sugerido para Cesar:**

```
feat(api): el profesor como relacion real en el schema

Turno.profesorId apunta a un Perfil con FK compuesta por tenant, y no a
un trozo del nombre de la actividad. Reserva.asistio para pasar lista,
Tenant.tarifaPorHoraProfesor como eslabon que faltaba de la cascada de
tarifas, y HorarioProfesorAsignado para el patron semanal.

El modelo nuevo queda clasificado en la extension de aislamiento: sin
eso toda query sobre el se bloquea, que es como debe fallar.
```

---

## Task 1: Los contratos compartidos

**Files:**
- Crear: `packages/shared/src/profesor.contracts.ts`
- Modificar: `packages/shared/src/index.ts`
- Modificar: `packages/shared/src/nucleo.contracts.ts`
- Modificar: `packages/shared/src/calendario.ts`
- Modificar: `packages/shared/src/fechas.ts`
- Test: `packages/shared/src/calendario.spec.ts`, `packages/shared/src/fechas.spec.ts`

Esta tarea define de una vez todos los tipos que las demás usan. Escribirlos antes evita el error
clásico de bautizar la misma cosa de dos maneras en tareas distintas.

- [ ] **Step 1: Escribir los tests de los tres helpers nuevos**

En `packages/shared/src/calendario.spec.ts`, al final del archivo:

```ts
describe('fechaEnRango', () => {
  const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

  it('incluye los dos extremos', () => {
    expect(fechaEnRango(dia('2026-09-01'), dia('2026-09-01'), dia('2026-09-30'))).toBe(true);
    expect(fechaEnRango(dia('2026-09-30'), dia('2026-09-01'), dia('2026-09-30'))).toBe(true);
  });

  it('excluye lo que queda fuera', () => {
    expect(fechaEnRango(dia('2026-08-31'), dia('2026-09-01'), dia('2026-09-30'))).toBe(false);
    expect(fechaEnRango(dia('2026-10-01'), dia('2026-09-01'), dia('2026-09-30'))).toBe(false);
  });

  it('un hasta nulo no tiene limite por la derecha', () => {
    expect(fechaEnRango(dia('2099-01-01'), dia('2026-09-01'), null)).toBe(true);
  });
});

describe('horasSeSolapan', () => {
  it('dos tramos que se pisan', () => {
    expect(horasSeSolapan('18:00', '19:00', '18:30', '19:30')).toBe(true);
  });

  it('uno dentro del otro', () => {
    expect(horasSeSolapan('18:00', '20:00', '18:30', '19:00')).toBe(true);
  });

  it('pegados NO se solapan: el que termina a las 19:00 deja libre las 19:00', () => {
    expect(horasSeSolapan('18:00', '19:00', '19:00', '20:00')).toBe(false);
  });

  it('separados', () => {
    expect(horasSeSolapan('18:00', '19:00', '20:00', '21:00')).toBe(false);
  });
});
```

Y en `packages/shared/src/fechas.spec.ts`, al final:

```ts
describe('minutosEntreHoras', () => {
  it('una hora clavada', () => {
    expect(minutosEntreHoras('18:00', '19:00')).toBe(60);
  });

  it('hora y media', () => {
    expect(minutosEntreHoras('18:00', '19:30')).toBe(90);
  });

  it('cruzar la medianoche no se contempla: devuelve negativo y quien llame decide', () => {
    expect(minutosEntreHoras('23:00', '01:00')).toBe(-1320);
  });

  it('una hora invalida revienta en vez de mentir', () => {
    expect(() => minutosEntreHoras('25:00', '26:00')).toThrow(/Hora invalida/);
  });
});
```

Añade los tres nombres al `import` de cada archivo de test.

- [ ] **Step 2: Correr los tests y verlos fallar**

```bash
cd /d/Dev/box-admin/packages/shared && pnpm exec jest --silent
```

Esperado: FALLA con `fechaEnRango is not a function` (o un error de compilación de TypeScript sobre
el import). Es la señal de que el test prueba algo que todavía no existe.

- [ ] **Step 3: Implementar los helpers**

En `packages/shared/src/calendario.ts`, justo antes de `rangosSeSolapan`:

```ts
/**
 * ¿Cae esta fecha dentro del rango, con los dos extremos incluidos?
 *
 * Un `hasta` nulo significa "sin limite por ese lado", que es como se modelan
 * tanto las rutinas indefinidas como los horarios de profesora sin fecha de fin.
 */
export function fechaEnRango(fecha: Date, desde: Date, hasta: Date | null): boolean {
  if (fecha.getTime() < desde.getTime()) return false;
  return hasta === null || fecha.getTime() <= hasta.getTime();
}
```

Y después de `rangosSeSolapan`:

```ts
/**
 * ¿Se pisan dos tramos horarios del mismo dia?
 *
 * Los extremos NO cuentan: un tramo que termina a las 19:00 y otro que empieza
 * a las 19:00 son consecutivos, no simultaneos. Sin esa exclusion, dos clases
 * seguidas en la misma sala se rechazarian como solape.
 */
export function horasSeSolapan(
  inicioA: string,
  finA: string,
  inicioB: string,
  finB: string,
): boolean {
  return comparaHoras(inicioA, finB) < 0 && comparaHoras(inicioB, finA) < 0;
}
```

`comparaHoras` vive en `fechas.ts`; añade el import al principio de `calendario.ts`:

```ts
import { comparaHoras } from './fechas';
```

En `packages/shared/src/fechas.ts`, al final:

```ts
/**
 * Minutos entre dos horas "HH:MM" del mismo dia.
 *
 * No contempla cruzar la medianoche —devuelve un negativo y quien llame
 * decide—, porque en este sistema un turno nunca lo hace: `exigirHorasCoherentes`
 * rechaza un horaFin que no sea posterior al horaInicio desde la Fase 1.
 */
export function minutosEntreHoras(inicio: string, fin: string): number {
  if (!esHoraValida(inicio)) {
    throw new FechaInvalidaError(`Hora invalida: ${inicio}. Se espera HH:MM en 24 h.`);
  }
  if (!esHoraValida(fin)) {
    throw new FechaInvalidaError(`Hora invalida: ${fin}. Se espera HH:MM en 24 h.`);
  }

  const aMinutos = (hora: string): number => {
    const [hh, mm] = hora.split(':');
    return Number(hh) * 60 + Number(mm);
  };

  return aMinutos(fin) - aMinutos(inicio);
}
```

- [ ] **Step 4: Correr los tests y verlos pasar**

```bash
cd /d/Dev/box-admin/packages/shared && pnpm exec jest --silent
```

Esperado: 75 tests anteriores + los 11 nuevos, todos en verde.

- [ ] **Step 5: Reutilizar `fechaEnRango` en el planificador**

En `apps/api/src/jobs/generacion-mes/generacion-mes.service.ts` hay una copia privada del mismo
helper (`cubreFecha`, líneas 105-108). Ahora que el de verdad vive en `shared`, la copia sobra:
bórrala, añade `fechaEnRango` al import de `@boxadmin/shared` y sustituye las tres llamadas a
`cubreFecha(...)` por `fechaEnRango(...)`.

Es el mismo cálculo con la misma semántica; dejar dos copias garantiza que algún día discrepen.

- [ ] **Step 6: Escribir los contratos de la fase**

Crear `packages/shared/src/profesor.contracts.ts`:

```ts
// ---------------------------------------------------------------------------
// Fase 4 — El profesor como entidad real
// ---------------------------------------------------------------------------

/** Un horario fijo de una profesora, tal como lo ve el admin. */
export interface HorarioProfesorPublico {
  id: string;
  profesorId: string;
  /** El nombre va resuelto: un listado de ids no le sirve a nadie. */
  profesorNombre: string;
  salaId: string;
  salaNombre: string;
  /** 0 = domingo ... 6 = sabado. */
  diaSemana: number;
  horaInicio: string;
  horaFin: string;
  activo: boolean;
  /** `YYYY-MM-DD`. */
  desde: string;
  /** `YYYY-MM-DD` o null = indefinido. */
  hasta: string | null;
  /**
   * String con dos decimales, nunca number: es dinero, y un float binario no
   * representa 1500.10 exactamente. Misma regla que el precio de los packs
   * desde la Fase 1. `null` = usa la tarifa general del gimnasio.
   */
  tarifaPorHora: string | null;
}

/** Una clase de la profesora, en su propia vista. */
export interface ClaseDelProfesor {
  turnoId: string;
  salaId: string;
  salaNombre: string;
  nombre: string;
  /** `YYYY-MM-DD`. */
  fecha: string;
  horaInicio: string;
  horaFin: string;
  cupo: number;
  reservasActivas: number;
  /** Si ya se paso lista en esta clase. */
  listaPasada: boolean;
}

/**
 * Un alumno en la clase de la profesora.
 *
 * Deliberadamente escueto: nombre y si vino. Ni telefono ni ficha medica — desde
 * la Fase 1, `fichaMedica` solo la ve ADMIN_SALON o la propia persona, y esta
 * fase no abre esa puerta.
 */
export interface AlumnoEnClase {
  perfilId: string;
  nombreCompleto: string;
  /** `null` = todavia no se paso lista. */
  asistio: boolean | null;
}

/** De donde salio la tarifa de una franja. */
export type OrigenTarifa = 'HORARIO' | 'TENANT';

/**
 * Una franja de la liquidacion, con tres banderas ortogonales.
 *
 * | contratada | dictada | cerrada | que es                          |
 * |------------|---------|---------|---------------------------------|
 * | si         | si      | no      | la clase se dio                 |
 * | si         | no      | no      | NADIE SE ANOTO                  |
 * | si         | no      | si      | feriado: no suma a contratadas  |
 * | no         | si      | -       | suplencia sin contrato          |
 */
export interface FranjaDeLiquidacion {
  /** `YYYY-MM-DD`. */
  fecha: string;
  salaId: string;
  horaInicio: string;
  horaFin: string;
  /** Enteros: es la verdad. `horas` de arriba es una comodidad derivada. */
  minutos: number;
  contratada: boolean;
  dictada: boolean;
  cerrada: boolean;
  /** Solo cuando `cerrada`. */
  motivoCierre: string | null;
  /** El turno que la dicto, si lo hubo. */
  turnoId: string | null;
  /** String con dos decimales. `null` = no hay ninguna tarifa definida. */
  tarifaPorHora: string | null;
  origenTarifa: OrigenTarifa | null;
}

/**
 * Las horas de una profesora en un mes.
 *
 * NO lleva importes: el calculo en pesos —tarifas, ajustes, el "50% base"— es de
 * la Fase 6, y adelantarlo aqui duplicaria logica de reportes en dos sitios.
 * Lo que si lleva es la tarifa YA RESUELTA por franja, para que la Fase 6 solo
 * tenga que multiplicar.
 */
export interface LiquidacionProfesor {
  profesorId: string;
  profesorNombre: string;
  anio: number;
  mes: number;
  /** Enteros. Contratadas EXCLUYE las cerradas. */
  minutosContratados: number;
  minutosDictados: number;
  minutosCerrados: number;
  /** Los mismos numeros en horas, string con dos decimales. */
  horasContratadas: string;
  horasDictadas: string;
  horasCerradas: string;
  franjas: FranjaDeLiquidacion[];
}
```

- [ ] **Step 7: Ampliar dos contratos existentes**

En `packages/shared/src/nucleo.contracts.ts`, dentro de `TurnoPublico`, después de `lugaresLibres`:

```ts
  lugaresLibres: number;
  /**
   * `null` = sin profesora asignada. Desde la Fase 4 esto es una relacion real,
   * no una parte del `nombre`.
   */
  profesor: { id: string; nombreCompleto: string } | null;
```

Y dentro de `ReservaPublica`, al final de sus campos:

```ts
  /** `null` = todavia no se paso lista en esa clase. */
  asistio: boolean | null;
```

- [ ] **Step 8: Exportar el archivo nuevo**

En `packages/shared/src/index.ts`, después de `export * from './selfservice.contracts';`:

```ts
export * from './profesor.contracts';
```

- [ ] **Step 9: Compilar el paquete y ver qué se rompió**

```bash
cd /d/Dev/box-admin/packages/shared && pnpm build
cd ../../apps/api && pnpm exec tsc --noEmit
```

Esperado: `tsc` de la API **falla**, y es la señal buena: añadir dos campos obligatorios a
`TurnoPublico` y `ReservaPublica` rompe a quien los construye. Los errores te dicen exactamente
dónde hay que rellenarlos — `aTurnoPublico` en `turnos.service.ts` y `aReservaPublica` en
`reservas.service.ts`. Se arreglan en las tareas 5 y 10; **por ahora déjalo roto y sigue**.

Si prefieres no arrastrar el rojo, salta a la Task 5 y vuelve.

**Mensaje de commit sugerido para Cesar:**

```
feat(shared): contratos del profesor y tres helpers de fecha

HorarioProfesorPublico, ClaseDelProfesor, AlumnoEnClase y la liquidacion
con sus franjas de tres banderas. TurnoPublico gana profesor y
ReservaPublica gana asistio.

fechaEnRango sustituye a la copia privada que el planificador llevaba
desde la Fase 2; horasSeSolapan y minutosEntreHoras son nuevos.
```

---
## Task 2: `resolverProfesorDeFranja`, la función pura del etiquetado

**Files:**
- Crear: `apps/api/src/horarios-profesor/resolver-profesor.ts`
- Test: `apps/api/src/horarios-profesor/resolver-profesor.spec.ts`

Esta función es el corazón de la decisión D1: no crea nada, solo contesta "¿de quién es esta
franja?". Vive sola en su archivo porque la llaman tres sitios que no se conocen entre sí — el
planificador del mes, el alta manual de turnos y los tests.

- [ ] **Step 1: Escribir la tabla de casos**

Crear `apps/api/src/horarios-profesor/resolver-profesor.spec.ts`:

```ts
import { resolverProfesorDeFranja, type HorarioParaResolver } from './resolver-profesor';

const dia = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

// 2026-09-07 es lunes; 2026-09-08, martes.
const LUNES = dia('2026-09-07');
const MARTES = dia('2026-09-08');

function horario(parcial: Partial<HorarioParaResolver> = {}): HorarioParaResolver {
  return {
    id: 'h1',
    profesorId: 'fati',
    salaId: 'sala-a',
    diaSemana: 1,
    horaInicio: '18:00',
    horaFin: '19:00',
    desde: dia('2026-09-01'),
    hasta: null,
    ...parcial,
  };
}

describe('resolverProfesorDeFranja', () => {
  it('devuelve la profesora cuando coinciden sala, dia y hora', () => {
    expect(resolverProfesorDeFranja([horario()], 'sala-a', LUNES, '18:00')).toBe('fati');
  });

  it('el turno que EMPIEZA DENTRO de la franja tambien es suyo', () => {
    // Contratada de 18:00 a 19:00; la rutina del alumno empieza a las 18:30.
    // Comparar horaInicio por igualdad exacta dejaria este caso fuera, y es el
    // caso corriente en un gimnasio con clases escalonadas.
    expect(resolverProfesorDeFranja([horario()], 'sala-a', LUNES, '18:30')).toBe('fati');
  });

  it('el final de la franja NO le pertenece', () => {
    // Termina a las 19:00: el turno de las 19:00 es de la clase siguiente.
    expect(resolverProfesorDeFranja([horario()], 'sala-a', LUNES, '19:00')).toBeNull();
  });

  it('otro dia de la semana no es suyo', () => {
    expect(resolverProfesorDeFranja([horario()], 'sala-a', MARTES, '18:00')).toBeNull();
  });

  it('otra sala no es suya', () => {
    expect(resolverProfesorDeFranja([horario()], 'sala-b', LUNES, '18:00')).toBeNull();
  });

  it('antes de que empiece su contrato, no es suya', () => {
    const h = horario({ desde: dia('2026-09-08') });
    expect(resolverProfesorDeFranja([h], 'sala-a', LUNES, '18:00')).toBeNull();
  });

  it('el primer dia del contrato SI es suyo', () => {
    const h = horario({ desde: LUNES });
    expect(resolverProfesorDeFranja([h], 'sala-a', LUNES, '18:00')).toBe('fati');
  });

  it('el ultimo dia del contrato SI es suyo', () => {
    const h = horario({ hasta: LUNES });
    expect(resolverProfesorDeFranja([h], 'sala-a', LUNES, '18:00')).toBe('fati');
  });

  it('despues de que termine su contrato, no es suya', () => {
    const h = horario({ hasta: dia('2026-09-06') });
    expect(resolverProfesorDeFranja([h], 'sala-a', LUNES, '18:00')).toBeNull();
  });

  it('sin horarios no hay profesora', () => {
    expect(resolverProfesorDeFranja([], 'sala-a', LUNES, '18:00')).toBeNull();
  });

  it('con dos coincidencias elige siempre la misma, no la que llegue primero', () => {
    // D5 impide que esto ocurra al dar de alta, pero pueden existir datos
    // anteriores a esta fase o cargados a mano. Lo que NO puede pasar es que la
    // respuesta dependa del orden en que Postgres devolvio las filas: el mismo
    // mes republicado daria profesoras distintas.
    const a = horario({ id: 'h-b', profesorId: 'ana' });
    const b = horario({ id: 'h-a', profesorId: 'fati' });

    expect(resolverProfesorDeFranja([a, b], 'sala-a', LUNES, '18:00')).toBe('fati');
    expect(resolverProfesorDeFranja([b, a], 'sala-a', LUNES, '18:00')).toBe('fati');
  });
});
```

- [ ] **Step 2: Correr el test y verlo fallar**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/horarios-profesor --silent
```

Esperado: FALLA con `Cannot find module './resolver-profesor'`.

- [ ] **Step 3: Implementar la función**

Crear `apps/api/src/horarios-profesor/resolver-profesor.ts`:

```ts
import { comparaHoras, fechaEnRango } from '@boxadmin/shared';

/** Lo que la funcion necesita saber de un horario. Nada mas. */
export interface HorarioParaResolver {
  id: string;
  profesorId: string;
  salaId: string;
  /** 0 = domingo ... 6 = sabado. */
  diaSemana: number;
  horaInicio: string;
  horaFin: string;
  desde: Date;
  hasta: Date | null;
}

/**
 * ¿De quien es esta franja?
 *
 * PURA: no toca la base ni la cola. Es lo que permite que los once casos de su
 * spec sean tests de verdad y no un e2e disfrazado.
 *
 * La pertenencia es por CONTENCION, no por igualdad de `horaInicio`: un turno
 * que empieza a las 18:30 dentro de una franja contratada de 18:00 a 19:00 es
 * suyo. Es la misma nocion de solape con la que el alta rechaza dos horarios en
 * la misma sala, y las dos reglas tienen que decir lo mismo o el sistema se
 * contradice consigo mismo.
 */
export function resolverProfesorDeFranja(
  horarios: HorarioParaResolver[],
  salaId: string,
  fecha: Date,
  horaInicio: string,
): string | null {
  const diaSemana = fecha.getUTCDay();

  const coincidencias = horarios.filter(
    (h) =>
      h.salaId === salaId &&
      h.diaSemana === diaSemana &&
      // Dentro de [horaInicio, horaFin): el final pertenece a la clase siguiente.
      comparaHoras(horaInicio, h.horaInicio) >= 0 &&
      comparaHoras(horaInicio, h.horaFin) < 0 &&
      fechaEnRango(fecha, h.desde, h.hasta),
  );

  if (coincidencias.length === 0) return null;

  // Orden determinista. No deberia haber dos —el alta lo rechaza— pero si los
  // hubiera, republicar el mismo mes no puede dar profesoras distintas segun el
  // orden en que la base devolvio las filas.
  coincidencias.sort((a, b) => a.id.localeCompare(b.id));

  return coincidencias[0]!.profesorId;
}
```

- [ ] **Step 4: Correr el test y verlo pasar**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/horarios-profesor --silent
```

Esperado: 11 tests en verde.

- [ ] **Step 5: Mutación — comprobar que la contención muerde**

Cambia `comparaHoras(horaInicio, h.horaFin) < 0` por `<= 0` y corre los tests.

Esperado: falla `el final de la franja NO le pertenece`. Si pasan todos, el test de contención no
está probando nada y hay que arreglarlo antes de seguir.

**Deshaz la mutación.**

- [ ] **Step 6: Segunda mutación — el rango de fechas**

Cambia `fechaEnRango(fecha, h.desde, h.hasta)` por `true` y corre los tests.

Esperado: fallan tres (`antes de que empiece`, `despues de que termine`, y ninguno más). Si solo
falla uno, faltan casos de borde.

**Deshaz la mutación.**

**Mensaje de commit sugerido para Cesar:**

```
feat(api): resolverProfesorDeFranja, la funcion pura del etiquetado

De quien es una franja, sin tocar la base. La pertenencia es por
contencion y no por igualdad de horaInicio: un turno que empieza a las
18:30 dentro de una franja de 18:00 a 19:00 es de esa profesora.

Con dos coincidencias el desempate es determinista: republicar el mismo
mes no puede dar profesoras distintas segun el orden de las filas.
```

---

## Task 3: El módulo de horarios de profesora

**Files:**
- Crear: `apps/api/src/horarios-profesor/dto/crear-horario-profesor.dto.ts`
- Crear: `apps/api/src/horarios-profesor/dto/actualizar-horario-profesor.dto.ts`
- Crear: `apps/api/src/horarios-profesor/horarios-profesor.service.ts`
- Crear: `apps/api/src/horarios-profesor/horarios-profesor.controller.ts`
- Crear: `apps/api/src/horarios-profesor/horarios-profesor.module.ts`
- Test: `apps/api/src/horarios-profesor/horarios-profesor.service.spec.ts`
- Modificar: `apps/api/src/app.module.ts`

- [ ] **Step 1: Escribir los DTO**

Crear `apps/api/src/horarios-profesor/dto/crear-horario-profesor.dto.ts`:

```ts
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { PATRON_FECHA, PATRON_HORA } from '@boxadmin/shared';

/** Hasta 8 enteros y como mucho 2 decimales: encaja en DECIMAL(10, 2). */
const PATRON_TARIFA = /^\d{1,8}(\.\d{1,2})?$/;

export class CrearHorarioProfesorDto {
  @IsString()
  @IsNotEmpty()
  profesorId!: string;

  @IsString()
  @IsNotEmpty()
  salaId!: string;

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

  /** Ausente = indefinido. */
  @IsOptional()
  @Matches(PATRON_FECHA, { message: 'hasta debe tener formato YYYY-MM-DD' })
  hasta?: string;

  /**
   * String, nunca number: es dinero. Ausente = usa la tarifa general del
   * gimnasio.
   */
  @IsOptional()
  @Matches(PATRON_TARIFA, {
    message: 'tarifaPorHora debe ser un numero con hasta 2 decimales, como "1500.00"',
  })
  tarifaPorHora?: string;
}
```

Crear `apps/api/src/horarios-profesor/dto/actualizar-horario-profesor.dto.ts`:

```ts
import { IsBoolean, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { PATRON_FECHA, PATRON_HORA } from '@boxadmin/shared';

const PATRON_TARIFA = /^\d{1,8}(\.\d{1,2})?$/;

/**
 * Los mismos campos que al crear MENOS `profesorId` y `salaId`, por la misma
 * razon que ActualizarRutinaDto los excluye: mover un horario de profesora o de
 * sala por PATCH dejaria los turnos ya etiquetados colgando de un patron que ya
 * no existe. Para eso se da de baja y se crea otro.
 */
export class ActualizarHorarioProfesorDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  diaSemana?: number;

  @IsOptional()
  @Matches(PATRON_HORA, { message: 'horaInicio debe tener formato HH:MM en 24 h' })
  horaInicio?: string;

  @IsOptional()
  @Matches(PATRON_HORA, { message: 'horaFin debe tener formato HH:MM en 24 h' })
  horaFin?: string;

  @IsOptional()
  @Matches(PATRON_FECHA, { message: 'desde debe tener formato YYYY-MM-DD' })
  desde?: string;

  @IsOptional()
  @Matches(PATRON_FECHA, { message: 'hasta debe tener formato YYYY-MM-DD' })
  hasta?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @IsOptional()
  @Matches(PATRON_TARIFA, {
    message: 'tarifaPorHora debe ser un numero con hasta 2 decimales, como "1500.00"',
  })
  tarifaPorHora?: string;
}
```

- [ ] **Step 2: Escribir los tests del servicio**

Crear `apps/api/src/horarios-profesor/horarios-profesor.service.spec.ts`:

```ts
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { HorariosProfesorService } from './horarios-profesor.service';

const ACTOR = { sub: 'admin-1', tenantId: 't1', rol: 'ADMIN_OPERATIVO' } as never;

const dia = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

function baseDelAlta(parcial: Record<string, unknown> = {}) {
  return {
    profesorId: 'fati',
    salaId: 'sala-a',
    diaSemana: 1,
    horaInicio: '18:00',
    horaFin: '19:00',
    desde: '2026-09-01',
    ...parcial,
  } as never;
}

/**
 * Doble de Prisma con lo justo. `horarioProfesorAsignado.findMany` filtra de
 * verdad por `diaSemana` y por el OR de sala/profesora, porque un doble que
 * ignora el filtro convierte los tests de solape en teatro: pasarian igual con
 * el filtro borrado del servicio.
 */
function prismaFalso(estado: {
  perfil?: Record<string, unknown> | null;
  salas?: string[];
  horarios?: Record<string, unknown>[];
}) {
  const horarios = estado.horarios ?? [];

  const db = {
    perfil: {
      findFirst: jest.fn().mockResolvedValue(estado.perfil ?? null),
    },
    sala: {
      findFirst: jest.fn().mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve(
          (estado.salas ?? ['sala-a', 'sala-b']).includes(where.id)
            ? { id: where.id, nombre: `Sala ${where.id}`, activa: true }
            : null,
        ),
      ),
    },
    usuarioSala: {
      findFirst: jest.fn().mockImplementation(({ where }: { where: { salaId: string } }) =>
        Promise.resolve(
          (estado.salas ?? ['sala-a']).includes(where.salaId) ? { salaId: where.salaId } : null,
        ),
      ),
    },
    horarioProfesorAsignado: {
      findMany: jest.fn().mockImplementation(({ where }: { where: Record<string, any> }) =>
        Promise.resolve(
          horarios.filter((h: any) => {
            if (where.diaSemana !== undefined && h.diaSemana !== where.diaSemana) return false;
            if (where.activo !== undefined && h.activo !== where.activo) return false;
            if (where.id?.not !== undefined && h.id === where.id.not) return false;
            if (where.OR) {
              const encaja = where.OR.some(
                (c: any) =>
                  (c.salaId !== undefined && c.salaId === h.salaId) ||
                  (c.profesorId !== undefined && c.profesorId === h.profesorId),
              );
              if (!encaja) return false;
            }
            return true;
          }),
        ),
      ),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'nuevo', activo: true, tarifaPorHora: null, ...data }),
      ),
      update: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(db)),
  };

  return db;
}

const historialFalso = { registrar: jest.fn().mockResolvedValue(undefined) } as never;

const PROFESORA = { id: 'fati', usuario: { rol: 'PROFESOR', nombreCompleto: 'Fati' } };

describe('HorariosProfesorService.crear', () => {
  it('rechaza un perfil que no existe', async () => {
    const db = prismaFalso({ perfil: null });
    const servicio = new HorariosProfesorService({ db } as never, historialFalso);

    await expect(servicio.crear(ACTOR, baseDelAlta())).rejects.toThrow(NotFoundException);
  });

  it('rechaza un perfil que no es profesor', async () => {
    const db = prismaFalso({
      perfil: { id: 'fati', usuario: { rol: 'ALUMNO', nombreCompleto: 'Ana' } },
    });
    const servicio = new HorariosProfesorService({ db } as never, historialFalso);

    await expect(servicio.crear(ACTOR, baseDelAlta())).rejects.toThrow(BadRequestException);
  });

  it('rechaza una sala a la que la profesora no tiene acceso', async () => {
    // Sin esta puerta, la profesora acabaria con un turno en una sala que no
    // puede ni ver, y las dos mitades del sistema dirian cosas distintas sobre
    // la misma clase.
    const db = prismaFalso({ perfil: PROFESORA, salas: ['sala-a'] });
    const servicio = new HorariosProfesorService({ db } as never, historialFalso);

    await expect(servicio.crear(ACTOR, baseDelAlta({ salaId: 'sala-b' }))).rejects.toThrow(
      /acceso a la sala/i,
    );
  });

  it('rechaza horaFin anterior a horaInicio', async () => {
    const db = prismaFalso({ perfil: PROFESORA });
    const servicio = new HorariosProfesorService({ db } as never, historialFalso);

    await expect(
      servicio.crear(ACTOR, baseDelAlta({ horaInicio: '19:00', horaFin: '18:00' })),
    ).rejects.toThrow(BadRequestException);
  });

  it('rechaza hasta anterior a desde', async () => {
    const db = prismaFalso({ perfil: PROFESORA });
    const servicio = new HorariosProfesorService({ db } as never, historialFalso);

    await expect(
      servicio.crear(ACTOR, baseDelAlta({ desde: '2026-09-30', hasta: '2026-09-01' })),
    ).rejects.toThrow(BadRequestException);
  });

  it('409 si otra profesora ya cubre esa sala, dia y hora', async () => {
    const db = prismaFalso({
      perfil: PROFESORA,
      horarios: [
        {
          id: 'h-ana',
          profesorId: 'ana',
          salaId: 'sala-a',
          diaSemana: 1,
          horaInicio: '18:00',
          horaFin: '19:00',
          desde: dia('2026-09-01'),
          hasta: null,
          activo: true,
        },
      ],
    });
    const servicio = new HorariosProfesorService({ db } as never, historialFalso);

    await expect(servicio.crear(ACTOR, baseDelAlta())).rejects.toThrow(ConflictException);
  });

  it('409 aunque solo se pisen media hora', async () => {
    const db = prismaFalso({
      perfil: PROFESORA,
      horarios: [
        {
          id: 'h-ana',
          profesorId: 'ana',
          salaId: 'sala-a',
          diaSemana: 1,
          horaInicio: '18:30',
          horaFin: '19:30',
          desde: dia('2026-09-01'),
          hasta: null,
          activo: true,
        },
      ],
    });
    const servicio = new HorariosProfesorService({ db } as never, historialFalso);

    await expect(servicio.crear(ACTOR, baseDelAlta())).rejects.toThrow(ConflictException);
  });

  it('deja pasar dos clases seguidas en la misma sala', async () => {
    // 18:00-19:00 y 19:00-20:00 son consecutivas, no simultaneas.
    const db = prismaFalso({
      perfil: PROFESORA,
      horarios: [
        {
          id: 'h-ana',
          profesorId: 'ana',
          salaId: 'sala-a',
          diaSemana: 1,
          horaInicio: '19:00',
          horaFin: '20:00',
          desde: dia('2026-09-01'),
          hasta: null,
          activo: true,
        },
      ],
    });
    const servicio = new HorariosProfesorService({ db } as never, historialFalso);

    await expect(servicio.crear(ACTOR, baseDelAlta())).resolves.toMatchObject({
      profesorId: 'fati',
    });
  });

  it('deja pasar el relevo: uno termina y el otro empieza al dia siguiente', async () => {
    const db = prismaFalso({
      perfil: PROFESORA,
      horarios: [
        {
          id: 'h-ana',
          profesorId: 'ana',
          salaId: 'sala-a',
          diaSemana: 1,
          horaInicio: '18:00',
          horaFin: '19:00',
          desde: dia('2026-09-01'),
          hasta: dia('2026-09-30'),
          activo: true,
        },
      ],
    });
    const servicio = new HorariosProfesorService({ db } as never, historialFalso);

    await expect(
      servicio.crear(ACTOR, baseDelAlta({ desde: '2026-10-01' })),
    ).resolves.toMatchObject({ profesorId: 'fati' });
  });

  it('409 si la MISMA profesora ya esta en otra sala a esa hora', async () => {
    const db = prismaFalso({
      perfil: PROFESORA,
      salas: ['sala-a', 'sala-b'],
      horarios: [
        {
          id: 'h-otra',
          profesorId: 'fati',
          salaId: 'sala-b',
          diaSemana: 1,
          horaInicio: '18:00',
          horaFin: '19:00',
          desde: dia('2026-09-01'),
          hasta: null,
          activo: true,
        },
      ],
    });
    const servicio = new HorariosProfesorService({ db } as never, historialFalso);

    await expect(servicio.crear(ACTOR, baseDelAlta())).rejects.toThrow(/dos salas a la vez/i);
  });

  it('ignora los horarios dados de baja', async () => {
    const db = prismaFalso({
      perfil: PROFESORA,
      horarios: [
        {
          id: 'h-ana',
          profesorId: 'ana',
          salaId: 'sala-a',
          diaSemana: 1,
          horaInicio: '18:00',
          horaFin: '19:00',
          desde: dia('2026-09-01'),
          hasta: null,
          activo: false,
        },
      ],
    });
    const servicio = new HorariosProfesorService({ db } as never, historialFalso);

    await expect(servicio.crear(ACTOR, baseDelAlta())).resolves.toMatchObject({
      profesorId: 'fati',
    });
  });
});

describe('HorariosProfesorService.eliminar', () => {
  it('da de baja y ademas cierra el hasta abierto, sin borrar la fila', async () => {
    // La liquidacion mira desde/hasta y NO activo: cerrar el hasta es lo que
    // hace que borrar un horario no reescriba los meses ya liquidados.
    const db = prismaFalso({ perfil: PROFESORA });
    db.horarioProfesorAsignado.findFirst = jest.fn().mockResolvedValue({
      id: 'h1',
      profesorId: 'fati',
      salaId: 'sala-a',
      desde: dia('2026-09-01'),
      hasta: null,
      activo: true,
    });
    const servicio = new HorariosProfesorService({ db } as never, historialFalso);

    await servicio.eliminar(ACTOR, 'h1');

    const datos = db.horarioProfesorAsignado.update.mock.calls[0][0].data;
    expect(datos.activo).toBe(false);
    expect(datos.hasta).toBeInstanceOf(Date);
  });

  it('no toca un hasta que ya estaba en el pasado', async () => {
    const db = prismaFalso({ perfil: PROFESORA });
    db.horarioProfesorAsignado.findFirst = jest.fn().mockResolvedValue({
      id: 'h1',
      profesorId: 'fati',
      salaId: 'sala-a',
      desde: dia('2026-01-01'),
      hasta: dia('2026-01-31'),
      activo: true,
    });
    const servicio = new HorariosProfesorService({ db } as never, historialFalso);

    await servicio.eliminar(ACTOR, 'h1');

    const datos = db.horarioProfesorAsignado.update.mock.calls[0][0].data;
    expect(datos.activo).toBe(false);
    expect(datos.hasta).toBeUndefined();
  });
});
```

- [ ] **Step 3: Correr los tests y verlos fallar**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/horarios-profesor --silent
```

Esperado: FALLA con `Cannot find module './horarios-profesor.service'`.

- [ ] **Step 4: Implementar el servicio**

Crear `apps/api/src/horarios-profesor/horarios-profesor.service.ts`:

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
  horasSeSolapan,
  rangosSeSolapan,
  type HorarioProfesorPublico,
  type JwtPayload,
} from '@boxadmin/shared';
import { HistorialService } from '../common/historial/historial.service';
import { PrismaService, type ClientePrismaTx } from '../prisma/prisma.service';
import type { ActualizarHorarioProfesorDto } from './dto/actualizar-horario-profesor.dto';
import type { CrearHorarioProfesorDto } from './dto/crear-horario-profesor.dto';

export interface FiltroHorarios {
  profesorId?: string;
  salaId?: string;
}

/** La forma minima que necesita la comprobacion de solape. */
interface FranjaAComprobar {
  /** El id del propio horario cuando se esta editando: se excluye a si mismo. */
  id?: string;
  profesorId: string;
  salaId: string;
  diaSemana: number;
  horaInicio: string;
  horaFin: string;
  desde: Date;
  hasta: Date | null;
}

/** Fila de Prisma con las relaciones que el contrato publico necesita. */
interface HorarioConRelaciones {
  id: string;
  profesorId: string;
  salaId: string;
  diaSemana: number;
  horaInicio: string;
  horaFin: string;
  activo: boolean;
  desde: Date;
  hasta: Date | null;
  tarifaPorHora: { toFixed(digitos: number): string } | null;
  profesor?: { usuario: { nombreCompleto: string } } | null;
  sala?: { nombre: string } | null;
}

const CON_NOMBRES = {
  profesor: { include: { usuario: { select: { nombreCompleto: true } } } },
  sala: { select: { nombre: true } },
} as const;

export function aHorarioPublico(fila: HorarioConRelaciones): HorarioProfesorPublico {
  return {
    id: fila.id,
    profesorId: fila.profesorId,
    profesorNombre: fila.profesor?.usuario.nombreCompleto ?? '',
    salaId: fila.salaId,
    salaNombre: fila.sala?.nombre ?? '',
    diaSemana: fila.diaSemana,
    horaInicio: fila.horaInicio,
    horaFin: fila.horaFin,
    activo: fila.activo,
    desde: aFechaISO(fila.desde),
    hasta: fila.hasta === null ? null : aFechaISO(fila.hasta),
    // toFixed y no toString: es dinero, y convertir a number reintroduciria el
    // error de coma flotante que el Decimal existe para evitar. Misma regla que
    // `aPackPublico` desde la Fase 1.
    tarifaPorHora: fila.tarifaPorHora === null ? null : fila.tarifaPorHora.toFixed(2),
  };
}

@Injectable()
export class HorariosProfesorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly historial: HistorialService,
  ) {}

  async crear(
    actor: JwtPayload,
    dto: CrearHorarioProfesorDto,
  ): Promise<HorarioProfesorPublico> {
    this.exigirHorasCoherentes(dto.horaInicio, dto.horaFin);

    const desde = desdeFechaISO(dto.desde);
    const hasta = dto.hasta ? desdeFechaISO(dto.hasta) : null;
    this.exigirFechasCoherentes(desde, hasta);

    await this.exigirProfesoraConAccesoALaSala(this.prisma.db, dto.profesorId, dto.salaId);

    const creado = await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      await this.exigirSinSolape(cliente, {
        profesorId: dto.profesorId,
        salaId: dto.salaId,
        diaSemana: dto.diaSemana,
        horaInicio: dto.horaInicio,
        horaFin: dto.horaFin,
        desde,
        hasta,
      });

      const fila = await cliente.horarioProfesorAsignado.create({
        data: {
          tenantId: actor.tenantId,
          profesorId: dto.profesorId,
          salaId: dto.salaId,
          diaSemana: dto.diaSemana,
          horaInicio: dto.horaInicio,
          horaFin: dto.horaFin,
          desde,
          hasta,
          tarifaPorHora: dto.tarifaPorHora ?? null,
        },
      });

      await this.historial.registrar(
        {
          actor,
          entidad: 'HorarioProfesorAsignado',
          entidadId: fila.id,
          accion: 'CREADA',
          detalle: {
            profesorId: dto.profesorId,
            salaId: dto.salaId,
            diaSemana: dto.diaSemana,
            horaInicio: dto.horaInicio,
          },
        },
        cliente,
      );

      return fila;
    });

    return await this.obtener(creado.id);
  }

  async listar(filtro: FiltroHorarios): Promise<HorarioProfesorPublico[]> {
    const where: Record<string, unknown> = {};
    if (filtro.profesorId) where.profesorId = filtro.profesorId;
    if (filtro.salaId) where.salaId = filtro.salaId;

    const filas = await this.prisma.db.horarioProfesorAsignado.findMany({
      where,
      include: CON_NOMBRES,
      orderBy: [{ diaSemana: 'asc' }, { horaInicio: 'asc' }],
    });

    return (filas as unknown as HorarioConRelaciones[]).map(aHorarioPublico);
  }

  async obtener(id: string): Promise<HorarioProfesorPublico> {
    const fila = await this.prisma.db.horarioProfesorAsignado.findFirst({
      where: { id },
      include: CON_NOMBRES,
    });
    if (!fila) throw new NotFoundException('Horario inexistente');

    return aHorarioPublico(fila as unknown as HorarioConRelaciones);
  }

  async actualizar(
    actor: JwtPayload,
    id: string,
    dto: ActualizarHorarioProfesorDto,
  ): Promise<HorarioProfesorPublico> {
    await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      const existente = await cliente.horarioProfesorAsignado.findFirst({ where: { id } });
      if (!existente) throw new NotFoundException('Horario inexistente');

      const horaInicio = dto.horaInicio ?? existente.horaInicio;
      const horaFin = dto.horaFin ?? existente.horaFin;
      this.exigirHorasCoherentes(horaInicio, horaFin);

      const desde = dto.desde ? desdeFechaISO(dto.desde) : existente.desde;
      const hasta = dto.hasta ? desdeFechaISO(dto.hasta) : existente.hasta;
      this.exigirFechasCoherentes(desde, hasta);

      // Se vuelve a comprobar el solape sobre el RESULTADO, no sobre lo que
      // llego en el cuerpo: mover un horario media hora puede chocar con otro
      // que antes no molestaba.
      const activo = dto.activo ?? existente.activo;
      if (activo) {
        await this.exigirSinSolape(cliente, {
          id,
          profesorId: existente.profesorId,
          salaId: existente.salaId,
          diaSemana: dto.diaSemana ?? existente.diaSemana,
          horaInicio,
          horaFin,
          desde,
          hasta,
        });
      }

      await cliente.horarioProfesorAsignado.update({
        where: { id },
        data: {
          diaSemana: dto.diaSemana,
          horaInicio: dto.horaInicio,
          horaFin: dto.horaFin,
          desde: dto.desde ? desdeFechaISO(dto.desde) : undefined,
          hasta: dto.hasta ? desdeFechaISO(dto.hasta) : undefined,
          activo: dto.activo,
          tarifaPorHora: dto.tarifaPorHora,
        },
      });

      await this.historial.registrar(
        {
          actor,
          entidad: 'HorarioProfesorAsignado',
          entidadId: id,
          accion: 'ACTUALIZADA',
          detalle: { ...dto },
        },
        cliente,
      );
    });

    return await this.obtener(id);
  }

  /**
   * Baja logica, y ademas cierra el `hasta` si estaba abierto.
   *
   * Las dos cosas porque cada una sirve para algo distinto: `activo` es lo que
   * filtran los listados y el etiquetado, y `hasta` es lo que mira la
   * liquidacion. Sin cerrar el `hasta`, un horario dado de baja seguiria
   * contando horas contratadas hacia el futuro; borrando la fila, en cambio,
   * desaparecerian tambien las de agosto, que ya se liquidaron.
   */
  async eliminar(actor: JwtPayload, id: string): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      const existente = await cliente.horarioProfesorAsignado.findFirst({ where: { id } });
      if (!existente) throw new NotFoundException('Horario inexistente');

      const hoy = new Date();
      const cerrarHasta =
        existente.hasta === null || existente.hasta.getTime() > hoy.getTime()
          ? desdeFechaISO(aFechaISO(hoy))
          : undefined;

      await cliente.horarioProfesorAsignado.update({
        where: { id },
        data: { activo: false, hasta: cerrarHasta },
      });

      await this.historial.registrar(
        { actor, entidad: 'HorarioProfesorAsignado', entidadId: id, accion: 'DADA_DE_BAJA' },
        cliente,
      );
    });
  }

  /**
   * El perfil existe, su usuario es PROFESOR, y tiene acceso a la sala.
   *
   * Lo tercero es la puerta que sostiene el punto del checklist sobre "otras
   * salas fuera de su asignacion": si no se comprueba aqui, una profesora acaba
   * con un turno asignado en una sala que no puede ni ver.
   */
  async exigirProfesoraConAccesoALaSala(
    cliente: ClientePrismaTx,
    profesorId: string,
    salaId: string,
  ): Promise<void> {
    const perfil = await cliente.perfil.findFirst({
      where: { id: profesorId },
      include: { usuario: { select: { rol: true, nombreCompleto: true } } },
    });
    if (!perfil) throw new NotFoundException('Perfil inexistente');
    if (perfil.usuario.rol !== 'PROFESOR') {
      throw new BadRequestException('Ese perfil no es de una profesora');
    }

    const sala = await cliente.sala.findFirst({ where: { id: salaId } });
    if (!sala) throw new NotFoundException('Sala inexistente');

    const acceso = await cliente.usuarioSala.findFirst({
      where: { perfilId: profesorId, salaId },
    });
    if (!acceso) {
      throw new BadRequestException(
        `${perfil.usuario.nombreCompleto} no tiene acceso a la sala ${sala.nombre}. ` +
          'Dale acceso antes de asignarle el horario.',
      );
    }
  }

  private async exigirSinSolape(
    cliente: ClientePrismaTx,
    franja: FranjaAComprobar,
  ): Promise<void> {
    const candidatos = await cliente.horarioProfesorAsignado.findMany({
      where: {
        activo: true,
        diaSemana: franja.diaSemana,
        ...(franja.id ? { id: { not: franja.id } } : {}),
        // Solo puede chocar con algo de la misma sala o de la misma profesora.
        OR: [{ salaId: franja.salaId }, { profesorId: franja.profesorId }],
      },
    });

    for (const otro of candidatos) {
      if (!rangosSeSolapan(franja.desde, franja.hasta, otro.desde, otro.hasta)) continue;
      if (!horasSeSolapan(franja.horaInicio, franja.horaFin, otro.horaInicio, otro.horaFin)) {
        continue;
      }

      if (otro.salaId === franja.salaId && otro.profesorId !== franja.profesorId) {
        throw new ConflictException(
          'Ya hay otra profesora asignada a esa sala en ese dia y hora. ' +
            'Un turno tiene una sola profesora, asi que dos horarios que se pisan ' +
            'no se pueden resolver.',
        );
      }

      if (otro.profesorId === franja.profesorId && otro.salaId !== franja.salaId) {
        throw new ConflictException(
          'Esa profesora ya esta asignada a otra sala a esa hora, y no puede estar ' +
            'en dos salas a la vez.',
        );
      }

      throw new ConflictException('Esa profesora ya tiene ese horario en esa sala');
    }
  }

  private exigirHorasCoherentes(inicio: string, fin: string): void {
    if (comparaHoras(fin, inicio) <= 0) {
      throw new BadRequestException('horaFin debe ser posterior a horaInicio');
    }
  }

  private exigirFechasCoherentes(desde: Date, hasta: Date | null): void {
    if (hasta !== null && hasta.getTime() < desde.getTime()) {
      throw new BadRequestException('hasta no puede ser anterior a desde');
    }
  }
}
```

- [ ] **Step 5: Correr los tests y verlos pasar**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/horarios-profesor --silent
```

Esperado: 11 de `resolver-profesor` + 13 del servicio, todos en verde.

- [ ] **Step 6: Mutación — que el solape de fechas muerda**

En `exigirSinSolape`, cambia la línea del rango por `if (false) continue;` (es decir, ignora el
rango de fechas y considera que siempre se cruzan).

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/horarios-profesor --silent
```

Esperado: falla `deja pasar el relevo`. Si pasa, ese test no prueba nada.

**Deshaz la mutación.**

- [ ] **Step 7: Mutación — que el solape de horas muerda**

Cambia `horasSeSolapan(...)` por `true` en el mismo sitio.

Esperado: falla `deja pasar dos clases seguidas en la misma sala`.

**Deshaz la mutación.**

- [ ] **Step 8: El controlador**

Crear `apps/api/src/horarios-profesor/horarios-profesor.controller.ts`:

```ts
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import type { HorarioProfesorPublico, JwtPayload } from '@boxadmin/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ActualizarHorarioProfesorDto } from './dto/actualizar-horario-profesor.dto';
import { CrearHorarioProfesorDto } from './dto/crear-horario-profesor.dto';
import { HorariosProfesorService } from './horarios-profesor.service';

@Controller('horarios-profesor')
export class HorariosProfesorController {
  constructor(private readonly horarios: HorariosProfesorService) {}

  @Roles('ADMIN_OPERATIVO')
  @Post()
  crear(
    @CurrentUser() actor: JwtPayload,
    @Body() dto: CrearHorarioProfesorDto,
  ): Promise<HorarioProfesorPublico> {
    return this.horarios.crear(actor, dto);
  }

  @Roles('ADMIN_OPERATIVO')
  @Get()
  listar(
    @Query('profesorId') profesorId?: string,
    @Query('salaId') salaId?: string,
  ): Promise<HorarioProfesorPublico[]> {
    return this.horarios.listar({ profesorId, salaId });
  }

  @Roles('ADMIN_OPERATIVO')
  @Patch(':id')
  actualizar(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ActualizarHorarioProfesorDto,
  ): Promise<HorarioProfesorPublico> {
    return this.horarios.actualizar(actor, id, dto);
  }

  // 204 y baja logica: la fila se conserva porque la liquidacion de los meses
  // ya cerrados la sigue necesitando.
  @Roles('ADMIN_OPERATIVO')
  @HttpCode(204)
  @Delete(':id')
  eliminar(@CurrentUser() actor: JwtPayload, @Param('id') id: string): Promise<void> {
    return this.horarios.eliminar(actor, id);
  }
}
```

- [ ] **Step 9: El módulo, y engancharlo**

Crear `apps/api/src/horarios-profesor/horarios-profesor.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { HorariosProfesorController } from './horarios-profesor.controller';
import { HorariosProfesorService } from './horarios-profesor.service';

@Module({
  controllers: [HorariosProfesorController],
  providers: [HorariosProfesorService],
  exports: [HorariosProfesorService],
})
export class HorariosProfesorModule {}
```

En `apps/api/src/app.module.ts`, añade el import arriba y `HorariosProfesorModule` a la lista de
`imports`, justo después de `RutinasModule`.

- [ ] **Step 10: Comprobar que la aplicación arranca**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec tsc --noEmit
```

Esperado: solo los dos errores conocidos de la Task 1 (`profesor` falta en `aTurnoPublico`, `asistio`
falta en `aReservaPublica`). Cualquier otro error es de esta tarea.

**Mensaje de commit sugerido para Cesar:**

```
feat(api): CRUD de horarios de profesora con deteccion de solapes

Rechaza dos profesoras en la misma sala, dia y hora —un turno tiene una
sola profesora, y dos horarios que se pisan no se pueden resolver— y a
la misma profesora en dos salas a la vez.

El alta exige que la profesora tenga acceso a la sala: sin esa puerta
acabaria con turnos en salas que no puede ni ver. La baja es logica y
cierra el hasta, para que borrar un horario no reescriba los meses ya
liquidados.
```

---

## Task 4: `PATCH /turnos/:id/profesor`, la suplencia

**Files:**
- Crear: `apps/api/src/turnos/dto/asignar-profesor.dto.ts`
- Modificar: `apps/api/src/turnos/turnos.service.ts`
- Modificar: `apps/api/src/turnos/turnos.controller.ts`
- Modificar: `apps/api/src/turnos/turnos.module.ts`
- Test: `apps/api/src/turnos/turnos.service.spec.ts`

- [ ] **Step 1: El DTO**

Crear `apps/api/src/turnos/dto/asignar-profesor.dto.ts`:

```ts
import { IsOptional, IsString, ValidateIf } from 'class-validator';

/**
 * `profesorId: null` es un valor legitimo —quitar la profesora del turno—, asi
 * que no vale con @IsOptional: hay que aceptar el null explicito y distinguirlo
 * de "no vino la clave".
 */
export class AsignarProfesorDto {
  @ValidateIf((_objeto, valor) => valor !== null)
  @IsOptional()
  @IsString()
  profesorId!: string | null;
}
```

- [ ] **Step 2: Escribir los tests**

En `apps/api/src/turnos/turnos.service.spec.ts`, al final, añade:

```ts
describe('TurnosService.asignarProfesor', () => {
  it('asigna la profesora al turno', async () => {
    const db = prismaDeTurnos({
      turno: { id: 't1', salaId: 'sala-a', fecha: new Date('2026-09-07T00:00:00.000Z') },
    });
    const servicio = new TurnosService(
      { db } as never,
      historialFalso,
      horariosFalso(),
    );

    await servicio.asignarProfesor(ACTOR, 't1', { profesorId: 'fati' });

    expect(db.turno.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { profesorId: 'fati' } }),
    );
  });

  it('quitar la profesora es un null explicito, no una omision', async () => {
    const db = prismaDeTurnos({
      turno: { id: 't1', salaId: 'sala-a', fecha: new Date('2026-09-07T00:00:00.000Z') },
    });
    const servicio = new TurnosService({ db } as never, historialFalso, horariosFalso());

    await servicio.asignarProfesor(ACTOR, 't1', { profesorId: null });

    expect(db.turno.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { profesorId: null } }),
    );
  });

  it('rechaza una profesora sin acceso a la sala del turno', async () => {
    const db = prismaDeTurnos({
      turno: { id: 't1', salaId: 'sala-a', fecha: new Date('2026-09-07T00:00:00.000Z') },
    });
    const horarios = horariosFalso(
      new BadRequestException('Fati no tiene acceso a la sala Sala A'),
    );
    const servicio = new TurnosService({ db } as never, historialFalso, horarios);

    await expect(
      servicio.asignarProfesor(ACTOR, 't1', { profesorId: 'fati' }),
    ).rejects.toThrow(/acceso a la sala/i);
    expect(db.turno.update).not.toHaveBeenCalled();
  });

  it('404 si el turno no existe', async () => {
    const db = prismaDeTurnos({ turno: null });
    const servicio = new TurnosService({ db } as never, historialFalso, horariosFalso());

    await expect(
      servicio.asignarProfesor(ACTOR, 'fantasma', { profesorId: 'fati' }),
    ).rejects.toThrow(NotFoundException);
  });
});
```

Y arriba del archivo, junto a los dobles que ya tenga, añade los dos ayudantes que usan estos tests:

```ts
/**
 * Doble del servicio de horarios. Solo se le pide una cosa: validar que la
 * profesora existe y tiene acceso a la sala. Si se le pasa un error, lo lanza.
 */
function horariosFalso(error?: Error) {
  return {
    exigirProfesoraConAccesoALaSala: jest
      .fn()
      .mockImplementation(() => (error ? Promise.reject(error) : Promise.resolve())),
    resolverParaFranja: jest.fn().mockResolvedValue(null),
  } as never;
}

/** Doble de Prisma con lo justo para los turnos. */
function prismaDeTurnos(estado: { turno: Record<string, unknown> | null }) {
  const db = {
    turno: {
      findFirst: jest.fn().mockResolvedValue(estado.turno),
      update: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(db)),
  };
  return db;
}
```

Comprueba antes si el archivo ya define `ACTOR` y `historialFalso`; si los define, no los repitas.

- [ ] **Step 3: Correr los tests y verlos fallar**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/turnos --silent
```

Esperado: FALLA — `asignarProfesor is not a function` y el constructor con tres argumentos.

- [ ] **Step 4: Implementar**

En `apps/api/src/turnos/turnos.service.ts`, añade el import y el tercer parámetro del constructor:

```ts
import { HorariosProfesorService } from '../horarios-profesor/horarios-profesor.service';
import type { AsignarProfesorDto } from './dto/asignar-profesor.dto';
```

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly historial: HistorialService,
    private readonly horarios: HorariosProfesorService,
  ) {}
```

Y el método nuevo, después de `actualizar`:

```ts
  /**
   * La suplencia: cambia la profesora de UN turno sin tocar el patron semanal.
   *
   * No hay que hacer nada especial para que sobreviva a una republicacion del
   * mes: el motor solo rellena huecos (decision D4), y un turno con profesora
   * ya no es un hueco.
   */
  async asignarProfesor(
    actor: JwtPayload,
    id: string,
    dto: AsignarProfesorDto,
  ): Promise<TurnoPublico> {
    await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      const turno = await cliente.turno.findFirst({ where: { id } });
      if (!turno) throw new NotFoundException('Turno inexistente');

      if (dto.profesorId !== null) {
        await this.horarios.exigirProfesoraConAccesoALaSala(
          cliente,
          dto.profesorId,
          turno.salaId,
        );
      }

      await cliente.turno.update({
        where: { id },
        data: { profesorId: dto.profesorId },
      });

      await this.historial.registrar(
        {
          actor,
          entidad: 'Turno',
          entidadId: id,
          accion: 'PROFESOR_ASIGNADO',
          detalle: { profesorId: dto.profesorId },
        },
        cliente,
      );
    });

    return await this.obtener(id);
  }
```

En `apps/api/src/turnos/turnos.controller.ts`, añade la ruta **antes** de `@Patch(':id')`:

```ts
  @Roles('ADMIN_OPERATIVO')
  @Patch(':id/profesor')
  asignarProfesor(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
    @Body() dto: AsignarProfesorDto,
  ): Promise<TurnoPublico> {
    return this.turnos.asignarProfesor(actor, id, dto);
  }
```

con su import: `import { AsignarProfesorDto } from './dto/asignar-profesor.dto';`

⚠️ **El orden de las rutas importa.** `@Patch(':id')` declarado antes capturaría `:id/profesor`
como si `id` fuera el literal y `profesor` sobrara. Nest resuelve por orden de declaración.

En `apps/api/src/turnos/turnos.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { HorariosProfesorModule } from '../horarios-profesor/horarios-profesor.module';
import { TurnosController } from './turnos.controller';
import { TurnosService } from './turnos.service';

@Module({
  imports: [HorariosProfesorModule],
  controllers: [TurnosController],
  providers: [TurnosService],
  exports: [TurnosService],
})
export class TurnosModule {}
```

- [ ] **Step 5: Correr los tests y verlos pasar**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/turnos --silent
```

Esperado: los tests de turnos que ya existían + los 4 nuevos, en verde.

**Mensaje de commit sugerido para Cesar:**

```
feat(api): PATCH /turnos/:id/profesor para la suplencia

Cambia la profesora de un turno suelto sin tocar el patron semanal, y
exige que tenga acceso a la sala. profesorId: null la quita: es un valor
legitimo, no una omision, y el DTO los distingue.

La ruta va declarada ANTES de PATCH /:id, o Nest se la come.
```

---
## Task 5: El calendario admin ve a la profesora

**Files:**
- Modificar: `apps/api/src/turnos/turnos.service.ts`
- Modificar: `apps/api/src/turnos/turnos.controller.ts`
- Test: `apps/api/src/turnos/turnos.service.spec.ts`

Es el §4 del PDF: `GET /turnos` devuelve `profesor` en cada turno y acepta `?profesorId=`.

- [ ] **Step 1: Escribir los tests**

En `apps/api/src/turnos/turnos.service.spec.ts`, al final:

```ts
describe('TurnosService.listar con profesora', () => {
  function prismaConTurnos(turnos: Record<string, unknown>[]) {
    const db = {
      turno: {
        findMany: jest.fn().mockImplementation(({ where }: { where: Record<string, any> }) =>
          Promise.resolve(
            turnos.filter((t: any) =>
              where.profesorId === undefined ? true : t.profesorId === where.profesorId,
            ),
          ),
        ),
      },
    };
    return db;
  }

  const TURNO_BASE = {
    id: 't1',
    tenantId: 't',
    salaId: 'sala-a',
    nombre: 'Pilates',
    fecha: new Date('2026-09-07T00:00:00.000Z'),
    horaInicio: '18:00',
    horaFin: '19:00',
    cupo: 5,
    _count: { reservas: 2 },
  };

  it('devuelve la profesora con su nombre resuelto', async () => {
    const db = prismaConTurnos([
      {
        ...TURNO_BASE,
        profesorId: 'fati',
        profesor: { usuario: { nombreCompleto: 'Fati Gomez' } },
      },
    ]);
    const servicio = new TurnosService({ db } as never, historialFalso, horariosFalso());

    const [turno] = await servicio.listar(ACTOR, {});

    // Un id suelto no le sirve a nadie que este mirando un calendario.
    expect(turno!.profesor).toEqual({ id: 'fati', nombreCompleto: 'Fati Gomez' });
  });

  it('un turno sin profesora la devuelve como null, no como undefined', async () => {
    const db = prismaConTurnos([{ ...TURNO_BASE, profesorId: null, profesor: null }]);
    const servicio = new TurnosService({ db } as never, historialFalso, horariosFalso());

    const [turno] = await servicio.listar(ACTOR, {});

    expect(turno!.profesor).toBeNull();
  });

  it('el filtro ?profesorId= llega al where', async () => {
    const db = prismaConTurnos([
      { ...TURNO_BASE, id: 't1', profesorId: 'fati', profesor: { usuario: { nombreCompleto: 'Fati' } } },
      { ...TURNO_BASE, id: 't2', profesorId: 'ana', profesor: { usuario: { nombreCompleto: 'Ana' } } },
    ]);
    const servicio = new TurnosService({ db } as never, historialFalso, horariosFalso());

    const turnos = await servicio.listar(ACTOR, { profesorId: 'fati' });

    expect(turnos.map((t) => t.id)).toEqual(['t1']);
    expect(db.turno.findMany.mock.calls[0]![0].where.profesorId).toBe('fati');
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/turnos --silent
```

Esperado: FALLA — `profesor` no existe en el objeto devuelto.

- [ ] **Step 3: Implementar**

En `apps/api/src/turnos/turnos.service.ts`:

Amplía `FiltroTurnos`:

```ts
export interface FiltroTurnos {
  desde?: string;
  hasta?: string;
  salaId?: string;
  soloLibres?: boolean;
  /** El §4 del PDF: la carga horaria de una profesora, de un vistazo. */
  profesorId?: string;
}
```

Amplía `TurnoConRecuento`:

```ts
interface TurnoConRecuento {
  id: string;
  tenantId: string;
  salaId: string;
  nombre: string;
  fecha: Date;
  horaInicio: string;
  horaFin: string;
  cupo: number;
  profesorId: string | null;
  profesor?: { usuario: { nombreCompleto: string } } | null;
  _count: { reservas: number };
}
```

Sustituye la constante del include:

```ts
/**
 * Solo cuenta reservas con `canceladaEn: null`. Contarlas todas dejaria turnos
 * eternamente "llenos" de gente que ya cancelo.
 *
 * El nombre de la profesora viene resuelto en la misma query: un calendario que
 * devuelve ids obliga a quien lo pinta a hacer N consultas mas.
 */
const RECUENTO_Y_PROFESORA = {
  _count: { select: { reservas: { where: { canceladaEn: null } } } },
  profesor: { include: { usuario: { select: { nombreCompleto: true } } } },
} as const;
```

y reemplaza las tres apariciones de `RECUENTO_ACTIVAS` por `RECUENTO_Y_PROFESORA`.

En `aTurnoPublico`, añade el campo antes del cierre:

```ts
    lugaresLibres: Math.max(0, turno.cupo - reservasActivas),
    profesor:
      turno.profesorId === null || !turno.profesor
        ? null
        : { id: turno.profesorId, nombreCompleto: turno.profesor.usuario.nombreCompleto },
  };
```

En `listar`, junto a los demás filtros:

```ts
    if (filtro.salaId) where.salaId = filtro.salaId;
    if (filtro.profesorId) where.profesorId = filtro.profesorId;
```

En `apps/api/src/turnos/turnos.controller.ts`, en `listar`:

```ts
  @Get()
  listar(
    @CurrentUser() actor: JwtPayload,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('salaId') salaId?: string,
    @Query('soloLibres', new ParseBoolPipe({ optional: true })) soloLibres?: boolean,
    @Query('profesorId') profesorId?: string,
  ): Promise<TurnoPublico[]> {
    return this.turnos.listar(actor, { desde, hasta, salaId, soloLibres, profesorId });
  }
```

- [ ] **Step 4: Correr y ver pasar**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/turnos --silent
```

Esperado: verde. Y uno de los dos errores pendientes de `tsc` desaparece:

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec tsc --noEmit
```

Esperado: solo queda el de `aReservaPublica` (`asistio`), que se cierra en la Task 10.

**Mensaje de commit sugerido para Cesar:**

```
feat(api): GET /turnos devuelve la profesora y acepta ?profesorId=

El nombre viene resuelto en la misma query: un calendario que devuelve
ids obliga a quien lo pinta a hacer N consultas mas. El filtro es lo que
en TurnoFit no se podia hacer, porque el dato no existia como relacion.
```

---

## Task 6: El alta manual de un turno resuelve profesora

**Files:**
- Modificar: `apps/api/src/horarios-profesor/horarios-profesor.service.ts`
- Modificar: `apps/api/src/turnos/turnos.service.ts`
- Modificar: `apps/api/src/turnos/dto/crear-turno.dto.ts`
- Test: `apps/api/src/turnos/turnos.service.spec.ts`

- [ ] **Step 1: El método que une la base con la función pura**

En `apps/api/src/horarios-profesor/horarios-profesor.service.ts`, añade el import de la función pura:

```ts
import { resolverProfesorDeFranja } from './resolver-profesor';
```

y el método, después de `exigirProfesoraConAccesoALaSala`:

```ts
  /**
   * Quien dicta esta franja, segun los horarios vigentes.
   *
   * Es el puente entre la base y `resolverProfesorDeFranja`, que es pura. Toda
   * la logica de pertenencia vive alli; aqui solo se traen las filas.
   */
  async resolverParaFranja(
    cliente: ClientePrismaTx,
    salaId: string,
    fecha: Date,
    horaInicio: string,
  ): Promise<string | null> {
    const horarios = await cliente.horarioProfesorAsignado.findMany({
      where: {
        salaId,
        activo: true,
        diaSemana: fecha.getUTCDay(),
        desde: { lte: fecha },
        OR: [{ hasta: null }, { hasta: { gte: fecha } }],
      },
    });

    return resolverProfesorDeFranja(
      horarios.map((h) => ({
        id: h.id,
        profesorId: h.profesorId,
        salaId: h.salaId,
        diaSemana: h.diaSemana,
        horaInicio: h.horaInicio,
        horaFin: h.horaFin,
        desde: h.desde,
        hasta: h.hasta,
      })),
      salaId,
      fecha,
      horaInicio,
    );
  }
```

El `where` filtra por fecha aunque la función pura lo vuelva a comprobar. No es redundancia inútil:
sin ese filtro la query se traería todos los horarios históricos de la sala.

- [ ] **Step 2: Escribir los tests**

En `apps/api/src/turnos/turnos.service.spec.ts`, al final:

```ts
describe('TurnosService.crear con profesora', () => {
  function prismaParaCrear() {
    const db = {
      sala: { findFirst: jest.fn().mockResolvedValue({ id: 'sala-a', activa: true }) },
      turno: {
        create: jest.fn().mockResolvedValue({ id: 't-nuevo' }),
        findFirst: jest.fn().mockResolvedValue({
          id: 't-nuevo',
          tenantId: 't',
          salaId: 'sala-a',
          nombre: 'Pilates',
          fecha: new Date('2026-09-07T00:00:00.000Z'),
          horaInicio: '18:00',
          horaFin: '19:00',
          cupo: 5,
          profesorId: 'fati',
          profesor: { usuario: { nombreCompleto: 'Fati' } },
          _count: { reservas: 0 },
        }),
      },
      $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(db)),
    };
    return db;
  }

  const ALTA = {
    salaId: 'sala-a',
    nombre: 'Pilates',
    fecha: '2026-09-07',
    horaInicio: '18:00',
    horaFin: '19:00',
    cupo: 5,
  } as never;

  it('si el admin no manda profesora, la resuelve del patron', async () => {
    const db = prismaParaCrear();
    const horarios = horariosFalso();
    horarios.resolverParaFranja = jest.fn().mockResolvedValue('fati');
    const servicio = new TurnosService({ db } as never, historialFalso, horarios);

    await servicio.crear(ACTOR, ALTA);

    expect(db.turno.create.mock.calls[0]![0].data.profesorId).toBe('fati');
  });

  it('si el admin manda profesora, gana la suya y NO se consulta el patron', async () => {
    const db = prismaParaCrear();
    const horarios = horariosFalso();
    horarios.resolverParaFranja = jest.fn().mockResolvedValue('ana');
    const servicio = new TurnosService({ db } as never, historialFalso, horarios);

    await servicio.crear(ACTOR, { ...(ALTA as object), profesorId: 'fati' } as never);

    expect(db.turno.create.mock.calls[0]![0].data.profesorId).toBe('fati');
    expect(horarios.resolverParaFranja).not.toHaveBeenCalled();
  });

  it('sin patron que aplique, el turno nace sin profesora', async () => {
    const db = prismaParaCrear();
    const horarios = horariosFalso();
    horarios.resolverParaFranja = jest.fn().mockResolvedValue(null);
    const servicio = new TurnosService({ db } as never, historialFalso, horarios);

    await servicio.crear(ACTOR, ALTA);

    expect(db.turno.create.mock.calls[0]![0].data.profesorId).toBeNull();
  });
});
```

- [ ] **Step 3: Correr y ver fallar**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/turnos --silent
```

Esperado: FALLA — `data.profesorId` es `undefined`.

- [ ] **Step 4: Implementar**

En `apps/api/src/turnos/dto/crear-turno.dto.ts`, añade el campo:

```ts
  /**
   * Ausente = se resuelve del patron semanal. Presente = manda el admin, y el
   * motor no lo pisara nunca (decision D4).
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  profesorId?: string;
```

con `IsOptional` y `IsString` en el import si no estaban.

En `apps/api/src/turnos/turnos.service.ts`, dentro de `crear`, reemplaza el cuerpo de la transacción:

```ts
    const turno = await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      const fecha = desdeFechaISO(dto.fecha);

      // La del admin manda; si no viene, se mira el patron. Nunca al reves: un
      // alta manual es una decision humana y el patron no la discute.
      let profesorId: string | null = null;
      if (dto.profesorId !== undefined) {
        await this.horarios.exigirProfesoraConAccesoALaSala(cliente, dto.profesorId, dto.salaId);
        profesorId = dto.profesorId;
      } else {
        profesorId = await this.horarios.resolverParaFranja(
          cliente,
          dto.salaId,
          fecha,
          dto.horaInicio,
        );
      }

      const creado = await cliente.turno.create({
        data: {
          tenantId: actor.tenantId,
          salaId: dto.salaId,
          nombre: dto.nombre,
          fecha,
          horaInicio: dto.horaInicio,
          horaFin: dto.horaFin,
          cupo: dto.cupo,
          profesorId,
        },
      });

      await this.historial.registrar(
        {
          actor,
          entidad: 'Turno',
          entidadId: creado.id,
          accion: 'CREADA',
          detalle: { salaId: dto.salaId, fecha: dto.fecha, horaInicio: dto.horaInicio, profesorId },
        },
        cliente,
      );

      return creado;
    });

    // Se relee en vez de componer la respuesta a mano: la fila recien creada no
    // trae la relacion con la profesora, y `profesor` es parte del contrato.
    return await this.obtener(turno.id);
```

- [ ] **Step 5: Correr y ver pasar**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/turnos --silent
```

Esperado: verde.

**Mensaje de commit sugerido para Cesar:**

```
feat(api): el alta manual de un turno resuelve la profesora del patron

Si el admin manda profesorId, gana el suyo y el patron ni se consulta:
un alta manual es una decision humana. Si no lo manda, se mira el
horario asignado de esa sala, dia y hora.
```

---

## Task 7: El planificador etiqueta

**Files:**
- Modificar: `packages/shared/src/recurrencia.contracts.ts`
- Modificar: `apps/api/src/jobs/generacion-mes/generacion-mes.service.ts`
- Test: `apps/api/src/jobs/generacion-mes/generacion-mes.service.spec.ts`

Aquí se implementa la decisión D4, que es la que hace que la suplencia sobreviva.

- [ ] **Step 1: Ampliar los contratos del plan**

En `packages/shared/src/recurrencia.contracts.ts`, en `TurnoPlanificado`, añade:

```ts
  /** `null` = ningun horario de profesora cubre esa franja. */
  profesorId: string | null;
```

Y un tipo nuevo, junto a los demás del plan:

```ts
/**
 * Un turno que YA EXISTE y al que hay que ponerle profesora.
 *
 * Solo se emiten para turnos SIN profesora: el motor rellena huecos y nunca
 * pisa lo que un humano decidio (decision D4 de la Fase 4). Sin esa regla, la
 * suplencia que el admin puso a mano duraria hasta la proxima publicacion del
 * mes y desapareceria sin que nadie se entere.
 */
export interface EtiquetaDeProfesor {
  turnoId: string;
  profesorId: string;
}
```

Y en `PlanDeMes`, junto a `turnosACrear` y `reservasACrear`:

```ts
  etiquetasDeProfesor: EtiquetaDeProfesor[];
```

Recompila el paquete:

```bash
cd /d/Dev/box-admin/packages/shared && pnpm build
```

- [ ] **Step 2: Escribir los tests del planificador**

En `apps/api/src/jobs/generacion-mes/generacion-mes.service.spec.ts`, al final:

```ts
describe('planificarMes y la profesora', () => {
  const dia = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

  // Septiembre de 2026: los lunes caen 7, 14, 21 y 28.
  function entradaConHorario(parcial: Partial<EntradaPlanificacion> = {}): EntradaPlanificacion {
    return {
      sala: { id: 'sala-a', nombre: 'Sala A', cupoBase: 5 },
      anio: 2026,
      mes: 9,
      rutinas: [
        {
          id: 'r1',
          perfilId: 'alumno-1',
          salaId: 'sala-a',
          nombre: 'Pilates',
          diaSemana: 1,
          horaInicio: '18:00',
          horaFin: '19:00',
          desde: dia('2026-09-01'),
          hasta: null,
        },
      ],
      ausencias: [],
      vacaciones: [],
      turnosExistentes: [],
      reservasActivas: [],
      perfiles: [
        { id: 'alumno-1', vigenciaHasta: null, clasesExtra: 0, pack: null, clasesConsumidas: 0 },
      ],
      horarios: [
        {
          id: 'h1',
          profesorId: 'fati',
          salaId: 'sala-a',
          diaSemana: 1,
          horaInicio: '18:00',
          horaFin: '19:00',
          desde: dia('2026-09-01'),
          hasta: null,
        },
      ],
      ...parcial,
    };
  }

  it('los turnos nuevos nacen etiquetados', () => {
    const plan = planificarMes(entradaConHorario());

    expect(plan.turnosACrear).toHaveLength(4);
    expect(plan.turnosACrear.every((t) => t.profesorId === 'fati')).toBe(true);
  });

  it('sin horario que cubra la franja, nacen sin profesora', () => {
    const plan = planificarMes(entradaConHorario({ horarios: [] }));

    expect(plan.turnosACrear.every((t) => t.profesorId === null)).toBe(true);
  });

  it('un turno que YA existe SIN profesora se etiqueta', () => {
    const plan = planificarMes(
      entradaConHorario({
        turnosExistentes: [
          {
            id: 't-viejo',
            fecha: dia('2026-09-07'),
            horaInicio: '18:00',
            cupo: 5,
            reservasActivas: 0,
            profesorId: null,
          },
        ],
      }),
    );

    expect(plan.etiquetasDeProfesor).toEqual([{ turnoId: 't-viejo', profesorId: 'fati' }]);
  });

  it('un turno que YA TIENE profesora no se toca: la suplencia sobrevive', () => {
    // Este es el segundo punto del checklist del PDF. Si el motor re-resolviera
    // siempre, la suplencia duraria hasta la proxima publicacion del mes.
    const plan = planificarMes(
      entradaConHorario({
        turnosExistentes: [
          {
            id: 't-viejo',
            fecha: dia('2026-09-07'),
            horaInicio: '18:00',
            cupo: 5,
            reservasActivas: 0,
            profesorId: 'ana',
          },
        ],
      }),
    );

    expect(plan.etiquetasDeProfesor).toEqual([]);
  });

  it('etiqueta turnos existentes aunque ninguna rutina los cubra este mes', () => {
    // El admin dio de alta el horario DESPUES de publicar el mes. Los turnos
    // huerfanos se rellenan igual, aunque el alumno de esa rutina se diera de
    // baja y ya no haya candidatos.
    const plan = planificarMes(
      entradaConHorario({
        rutinas: [],
        perfiles: [],
        turnosExistentes: [
          {
            id: 't-huerfano',
            fecha: dia('2026-09-14'),
            horaInicio: '18:00',
            cupo: 5,
            reservasActivas: 3,
            profesorId: null,
          },
        ],
      }),
    );

    expect(plan.turnosACrear).toHaveLength(0);
    expect(plan.etiquetasDeProfesor).toEqual([{ turnoId: 't-huerfano', profesorId: 'fati' }]);
  });

  it('no etiqueta un turno existente que ningun horario cubre', () => {
    const plan = planificarMes(
      entradaConHorario({
        turnosExistentes: [
          {
            id: 't-otro',
            fecha: dia('2026-09-08'), // martes
            horaInicio: '18:00',
            cupo: 5,
            reservasActivas: 0,
            profesorId: null,
          },
        ],
      }),
    );

    expect(plan.etiquetasDeProfesor).toEqual([]);
  });
});
```

Añade `horarios: []` a cualquier constructor de `EntradaPlanificacion` que ya existiera en el archivo
y `profesorId: null` a los `turnosExistentes` que ya tuviera, o el `tsc` de los tests se queja.

- [ ] **Step 3: Correr y ver fallar**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/jobs/generacion-mes/generacion-mes.service.spec.ts --silent
```

Esperado: FALLA — `etiquetasDeProfesor` no existe en el plan.

- [ ] **Step 4: Implementar**

En `apps/api/src/jobs/generacion-mes/generacion-mes.service.ts`:

Importa la función pura y el tipo:

```ts
import {
  resolverProfesorDeFranja,
  type HorarioParaResolver,
} from '../../horarios-profesor/resolver-profesor';
```

y añade `type EtiquetaDeProfesor` al import de `@boxadmin/shared`.

Amplía `TurnoExistenteParaPlan`:

```ts
export interface TurnoExistenteParaPlan {
  id: string;
  fecha: Date;
  horaInicio: string;
  cupo: number;
  reservasActivas: number;
  /** `null` = nadie le ha puesto profesora todavia. Es lo que lo hace un hueco. */
  profesorId: string | null;
}
```

Amplía `EntradaPlanificacion`:

```ts
  perfiles: PerfilParaPlan[];
  /** Los horarios de profesora vigentes en esta sala durante el mes. */
  horarios: HorarioParaResolver[];
```

Dentro de `planificarMes`, junto a los demás acumuladores:

```ts
  const etiquetasDeProfesor: EtiquetaDeProfesor[] = [];
```

Justo después del bloque que construye el estado inicial de las franjas (el que recorre
`entrada.turnosExistentes` y `entrada.reservasActivas`), añade el recorrido de etiquetado:

```ts
  // --- Turnos que ya existen y estan SIN profesora --------------------------
  //
  // Se recorren todos, no solo los de las franjas con rutina: el admin puede
  // haber dado de alta el horario DESPUES de publicar el mes, y esos turnos no
  // tienen por que coincidir con ningun candidato de esta vuelta.
  //
  // Los que YA tienen profesora no se tocan (decision D4): tener profesora
  // significa que alguien lo decidio, y republicar el mes no puede deshacerlo.
  for (const turno of entrada.turnosExistentes) {
    if (turno.profesorId !== null) continue;

    const profesorId = resolverProfesorDeFranja(
      entrada.horarios,
      sala.id,
      turno.fecha,
      turno.horaInicio,
    );
    if (profesorId !== null) {
      etiquetasDeProfesor.push({ turnoId: turno.id, profesorId });
    }
  }
```

En el `turnosACrear.push({...})`, añade el campo:

```ts
      turnosACrear.push({
        salaId: sala.id,
        nombre: rutina.nombre,
        fecha: fechaISO,
        horaInicio: rutina.horaInicio,
        horaFin: rutina.horaFin,
        cupo: sala.cupoBase,
        profesorId: resolverProfesorDeFranja(entrada.horarios, sala.id, fecha, rutina.horaInicio),
      });
```

Y en el `return`:

```ts
  return {
    turnosACrear,
    reservasACrear,
    etiquetasDeProfesor,
    conflictos,
    exclusiones,
    resumen: {
```

`ResumenDelPlan` **no se toca**: añadirle un contador cambiaría la respuesta de publicar y obligaría
a retocar e2e de la Fase 2 que no tienen nada que ver con esto. El recuento de etiquetas va al
historial, en la tarea siguiente.

- [ ] **Step 5: Correr y ver pasar**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/jobs --silent
```

Esperado: los tests del planificador que ya existían + los 6 nuevos, en verde.

- [ ] **Step 6: Mutación — que "solo rellena huecos" muerda**

Quita la línea `if (turno.profesorId !== null) continue;`.

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/jobs --silent
```

Esperado: falla `un turno que YA TIENE profesora no se toca`. **Es la mutación más importante de la
fase**: si pasa, D4 no está probada y la suplencia se pierde en silencio en producción.

**Deshaz la mutación.**

**Mensaje de commit sugerido para Cesar:**

```
feat(api): el planificador etiqueta la profesora de cada franja

Los turnos nuevos nacen con profesorId resuelto del patron, y los que ya
existen se rellenan SOLO si no tienen: tener profesora significa que
alguien lo decidio, y republicar el mes no puede deshacerlo.

Se recorren todos los turnos existentes, no solo los de franjas con
rutina: el horario puede haberse dado de alta despues de publicar el mes.
```

---

## Task 8: Cargar los horarios y aplicar las etiquetas

**Files:**
- Modificar: `apps/api/src/calendario/calendario.datos.ts`
- Modificar: `apps/api/src/jobs/generacion-mes/publicacion.service.ts`
- Test: `apps/api/src/jobs/generacion-mes/publicacion.service.spec.ts`

- [ ] **Step 1: Cargar los horarios del mes**

En `apps/api/src/calendario/calendario.datos.ts`, después del bloque de `rutinas`:

```ts
    // Horarios de profesora vigentes en esta sala durante el mes. Mismo patron
    // de vigencia que las rutinas: activos y con el rango tocando el mes.
    const horarios = await cliente.horarioProfesorAsignado.findMany({
      where: {
        salaId,
        activo: true,
        desde: { lte: fin },
        OR: [{ hasta: null }, { hasta: { gte: inicio } }],
      },
    });
```

En el `turnos.findMany`, no hace falta cambiar nada —`profesorId` es una columna del modelo y ya
viene—, pero sí en el mapeo. Sustituye el bloque `turnosExistentes` y añade `horarios` al objeto que
se devuelve:

```ts
      turnosExistentes: turnos.map((turno) => ({
        id: turno.id,
        fecha: turno.fecha,
        horaInicio: turno.horaInicio,
        cupo: turno.cupo,
        reservasActivas: (turno as unknown as { _count: { reservas: number } })._count.reservas,
        profesorId: turno.profesorId,
      })),
      reservasActivas: reservas.map((r) => ({ turnoId: r.turnoId, perfilId: r.perfilId })),
      perfiles,
      horarios: horarios.map((h) => ({
        id: h.id,
        profesorId: h.profesorId,
        salaId: h.salaId,
        diaSemana: h.diaSemana,
        horaInicio: h.horaInicio,
        horaFin: h.horaFin,
        desde: h.desde,
        hasta: h.hasta,
      })),
    };
```

- [ ] **Step 2: Escribir el test del aplicador**

En `apps/api/src/jobs/generacion-mes/publicacion.service.spec.ts`, al final:

```ts
describe('PublicacionService y las etiquetas de profesora', () => {
  it('aplica cada etiqueta con un updateMany condicionado a que siga sin profesora', async () => {
    const db = prismaDePublicacion();
    const servicio = new PublicacionService({ db } as never, historialFalso);

    await servicio.aplicar(ACTOR, 'sala-a', 2026, 9, {
      turnosACrear: [],
      reservasACrear: [],
      etiquetasDeProfesor: [{ turnoId: 't1', profesorId: 'fati' }],
      conflictos: [],
      exclusiones: [],
      resumen: { turnos: 0, reservas: 0, conflictos: 0, exclusiones: 0 },
    } as never);

    // El `profesorId: null` del where no es decoracion: entre planificar y
    // aplicar, el admin puede haber puesto una suplencia a mano. Sin esa
    // condicion, el plan la pisaria.
    expect(db.turno.updateMany).toHaveBeenCalledWith({
      where: { id: 't1', profesorId: null },
      data: { profesorId: 'fati' },
    });
  });

  it('el turno recien creado lleva la profesora que trae el plan', async () => {
    const db = prismaDePublicacion();
    const servicio = new PublicacionService({ db } as never, historialFalso);

    await servicio.aplicar(ACTOR, 'sala-a', 2026, 9, {
      turnosACrear: [
        {
          salaId: 'sala-a',
          nombre: 'Pilates',
          fecha: '2026-09-07',
          horaInicio: '18:00',
          horaFin: '19:00',
          cupo: 5,
          profesorId: 'fati',
        },
      ],
      reservasACrear: [],
      etiquetasDeProfesor: [],
      conflictos: [],
      exclusiones: [],
      resumen: { turnos: 1, reservas: 0, conflictos: 0, exclusiones: 0 },
    } as never);

    expect(db.turno.create.mock.calls[0]![0].data.profesorId).toBe('fati');
  });
});
```

Si el archivo no tiene ya un `prismaDePublicacion`, añádelo:

```ts
function prismaDePublicacion() {
  const db = {
    mesCalendario: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest.fn().mockResolvedValue({ id: 'mes-1' }),
    },
    turno: {
      create: jest.fn().mockResolvedValue({ id: 't-nuevo' }),
      findFirst: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    reserva: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(db)),
  };
  return db;
}
```

- [ ] **Step 3: Correr y ver fallar**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/jobs/generacion-mes/publicacion.service.spec.ts --silent
```

Esperado: FALLA — `db.turno.updateMany` no se llamó.

- [ ] **Step 4: Implementar**

En `apps/api/src/jobs/generacion-mes/publicacion.service.ts`, dentro de `aplicar`:

En el `turno.create`, añade el campo:

```ts
            cupo: turno.cupo,
            profesorId: turno.profesorId,
          },
        });
```

Y después del bucle de reservas, antes de construir el `resumen`:

```ts
      // 4. Las etiquetas de profesora sobre turnos que ya existian.
      //
      // El `profesorId: null` del where es una segunda red: el plan ya solo trae
      // huecos, pero entre planificar y aplicar puede haber pasado un rato, y en
      // ese rato el admin puede haber puesto una suplencia a mano. Con la
      // condicion, la escritura simplemente no afecta a ninguna fila.
      let etiquetadas = 0;

      for (const etiqueta of plan.etiquetasDeProfesor) {
        const { count } = await cliente.turno.updateMany({
          where: { id: etiqueta.turnoId, profesorId: null },
          data: { profesorId: etiqueta.profesorId },
        });
        etiquetadas += count;
      }
```

Y en el `detalle` del historial, para que el recuento quede en algún sitio sin cambiar el contrato
de `ResumenDelPlan`:

```ts
          detalle: { salaId, anio, mes, ...resumen, etiquetadas },
```

- [ ] **Step 5: Correr y ver pasar**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/jobs --silent && pnpm exec tsc --noEmit
```

Esperado: los tests en verde. `tsc` sigue con el error pendiente de `aReservaPublica`.

- [ ] **Step 6: Mutación — que la condición del where muerda**

Quita `profesorId: null` del `where` del `updateMany`.

Esperado: falla el primer test del paso 2, que compara el objeto completo. Si no falla, el test está
comprobando de menos.

**Deshaz la mutación.**

**Mensaje de commit sugerido para Cesar:**

```
feat(api): la publicacion del mes aplica las etiquetas de profesora

El updateMany va condicionado a que el turno siga sin profesora: entre
planificar y aplicar puede haber entrado una suplencia a mano, y sin esa
condicion el plan la pisaria.

El cargador trae los horarios vigentes de la sala con el mismo criterio
de vigencia que ya usaba para las rutinas.
```

---
## Task 9: `/mis-clases`, la vista de la profesora

**Files:**
- Crear: `apps/api/src/mis-clases/mis-clases.service.ts`
- Crear: `apps/api/src/mis-clases/mis-clases.controller.ts`
- Crear: `apps/api/src/mis-clases/mis-clases.module.ts`
- Test: `apps/api/src/mis-clases/mis-clases.service.spec.ts`
- Modificar: `apps/api/src/app.module.ts`

- [ ] **Step 1: Escribir los tests del aislamiento**

Crear `apps/api/src/mis-clases/mis-clases.service.spec.ts`:

```ts
import { NotFoundException } from '@nestjs/common';
import { MisClasesService } from './mis-clases.service';

const ACTOR = { sub: 'usuario-fati', tenantId: 't1', rol: 'PROFESOR' } as never;

const historialFalso = { registrar: jest.fn().mockResolvedValue(undefined) } as never;

function prismaFalso(estado: {
  perfil?: { id: string } | null;
  turnos?: Record<string, unknown>[];
  reservas?: Record<string, unknown>[];
}) {
  const turnos = estado.turnos ?? [];

  const db = {
    perfil: { findFirst: jest.fn().mockResolvedValue(estado.perfil ?? { id: 'fati' }) },
    turno: {
      // Filtra de verdad por profesorId: un doble que lo ignora convierte los
      // tests de aislamiento en teatro — pasarian igual con el filtro borrado.
      findMany: jest.fn().mockImplementation(({ where }: { where: Record<string, any> }) =>
        Promise.resolve(turnos.filter((t: any) => t.profesorId === where.profesorId)),
      ),
      findFirst: jest.fn().mockImplementation(({ where }: { where: Record<string, any> }) =>
        Promise.resolve(
          turnos.find(
            (t: any) =>
              t.id === where.id &&
              (where.profesorId === undefined || t.profesorId === where.profesorId),
          ) ?? null,
        ),
      ),
    },
    reserva: {
      findMany: jest.fn().mockResolvedValue(estado.reservas ?? []),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(db)),
  };

  return db;
}

const TURNO_DE_FATI = {
  id: 't-fati',
  profesorId: 'fati',
  salaId: 'sala-a',
  nombre: 'Pilates',
  fecha: new Date('2026-09-07T00:00:00.000Z'),
  horaInicio: '18:00',
  horaFin: '19:00',
  cupo: 5,
  sala: { nombre: 'Sala A' },
  reservas: [{ asistio: null }, { asistio: null }],
};

const TURNO_DE_ANA = { ...TURNO_DE_FATI, id: 't-ana', profesorId: 'ana' };

describe('MisClasesService.misClases', () => {
  it('devuelve solo las clases propias', async () => {
    const db = prismaFalso({ turnos: [TURNO_DE_FATI, TURNO_DE_ANA] });
    const servicio = new MisClasesService({ db } as never, historialFalso);

    const clases = await servicio.misClases(ACTOR, { desde: '2026-09-01', hasta: '2026-09-30' });

    expect(clases.map((c) => c.turnoId)).toEqual(['t-fati']);
  });

  it('listaPasada es false mientras nadie paso lista', async () => {
    const db = prismaFalso({ turnos: [TURNO_DE_FATI] });
    const servicio = new MisClasesService({ db } as never, historialFalso);

    const [clase] = await servicio.misClases(ACTOR, { desde: '2026-09-01', hasta: '2026-09-30' });

    expect(clase!.listaPasada).toBe(false);
    expect(clase!.reservasActivas).toBe(2);
  });

  it('listaPasada es true en cuanto alguna reserva tiene la marca', async () => {
    const db = prismaFalso({
      turnos: [{ ...TURNO_DE_FATI, reservas: [{ asistio: true }, { asistio: null }] }],
    });
    const servicio = new MisClasesService({ db } as never, historialFalso);

    const [clase] = await servicio.misClases(ACTOR, { desde: '2026-09-01', hasta: '2026-09-30' });

    expect(clase!.listaPasada).toBe(true);
  });

  it('un usuario sin perfil no tiene clases propias: 404', async () => {
    // Un admin, por ejemplo. No es un error del sistema: sencillamente no tiene
    // una vista de "mis clases" que mostrar.
    const db = prismaFalso({ perfil: null });
    const servicio = new MisClasesService({ db } as never, historialFalso);

    await expect(
      servicio.misClases(ACTOR, { desde: '2026-09-01', hasta: '2026-09-30' }),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('MisClasesService.alumnos', () => {
  it('devuelve nombre y asistencia, y nada mas', async () => {
    const db = prismaFalso({
      turnos: [TURNO_DE_FATI],
      reservas: [
        {
          perfilId: 'p1',
          asistio: true,
          perfil: { usuario: { nombreCompleto: 'Ana Perez' } },
        },
      ],
    });
    const servicio = new MisClasesService({ db } as never, historialFalso);

    const alumnos = await servicio.alumnos(ACTOR, 't-fati');

    // Ni telefono ni ficha medica: desde la Fase 1 la ficha solo la ve
    // ADMIN_SALON o la propia persona.
    expect(alumnos).toEqual([{ perfilId: 'p1', nombreCompleto: 'Ana Perez', asistio: true }]);
  });

  it('el turno de otra profesora no existe para esta: 404', async () => {
    // 404 y no 403: confirmar que el turno existe pero es de otra ya seria
    // contar algo de la agenda ajena.
    const db = prismaFalso({ turnos: [TURNO_DE_FATI, TURNO_DE_ANA] });
    const servicio = new MisClasesService({ db } as never, historialFalso);

    await expect(servicio.alumnos(ACTOR, 't-ana')).rejects.toThrow(NotFoundException);
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/mis-clases --silent
```

Esperado: FALLA con `Cannot find module './mis-clases.service'`.

- [ ] **Step 3: Implementar el servicio (lectura)**

Crear `apps/api/src/mis-clases/mis-clases.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  aFechaISO,
  desdeFechaISO,
  type AlumnoEnClase,
  type ClaseDelProfesor,
  type JwtPayload,
} from '@boxadmin/shared';
import { HistorialService } from '../common/historial/historial.service';
import { PrismaService, type ClientePrismaTx } from '../prisma/prisma.service';

export interface RangoDeClases {
  desde: string;
  hasta: string;
}

/** Fila de turno con lo que la vista de la profesora necesita. */
interface TurnoDeProfesor {
  id: string;
  salaId: string;
  nombre: string;
  fecha: Date;
  horaInicio: string;
  horaFin: string;
  cupo: number;
  sala: { nombre: string };
  reservas: { asistio: boolean | null }[];
}

/** Fila de reserva con el nombre del alumno resuelto. */
interface ReservaConAlumno {
  perfilId: string;
  asistio: boolean | null;
  perfil: { usuario: { nombreCompleto: string } };
}

@Injectable()
export class MisClasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly historial: HistorialService,
  ) {}

  /**
   * El perfil del actor. Es la puerta de las tres rutas de la profesora: todas
   * operan sobre SU perfil, nunca sobre un profesorId del cuerpo o de la URL.
   *
   * Un usuario sin perfil —un admin— recibe 404, y es correcto: no tiene clases
   * propias que mostrar. Mismo patron que `/mi-calendario` desde la Fase 3A.
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
        'Este usuario no tiene perfil de profesora, asi que no tiene clases propias.',
      );
    }

    return perfil;
  }

  async misClases(actor: JwtPayload, rango: RangoDeClases): Promise<ClaseDelProfesor[]> {
    const perfil = await this.perfilDelActor(actor);

    const turnos = await this.prisma.db.turno.findMany({
      where: {
        // El unico filtro que hace falta: el turno es suyo por definicion, asi
        // que no hay que cruzarlo ademas con las salas a las que tiene acceso.
        profesorId: perfil.id,
        fecha: { gte: desdeFechaISO(rango.desde), lte: desdeFechaISO(rango.hasta) },
      },
      include: {
        sala: { select: { nombre: true } },
        reservas: { where: { canceladaEn: null }, select: { asistio: true } },
      },
      orderBy: [{ fecha: 'asc' }, { horaInicio: 'asc' }],
    });

    return (turnos as unknown as TurnoDeProfesor[]).map((turno) => ({
      turnoId: turno.id,
      salaId: turno.salaId,
      salaNombre: turno.sala.nombre,
      nombre: turno.nombre,
      fecha: aFechaISO(turno.fecha),
      horaInicio: turno.horaInicio,
      horaFin: turno.horaFin,
      cupo: turno.cupo,
      reservasActivas: turno.reservas.length,
      // Basta con que una tenga la marca: pasar lista escribe todas de golpe.
      listaPasada: turno.reservas.some((reserva) => reserva.asistio !== null),
    }));
  }

  async alumnos(actor: JwtPayload, turnoId: string): Promise<AlumnoEnClase[]> {
    const perfil = await this.perfilDelActor(actor);
    await this.exigirTurnoPropio(this.prisma.db, turnoId, perfil.id);

    return await this.listaDeAlumnos(this.prisma.db, turnoId);
  }

  /**
   * El turno existe Y es de esta profesora.
   *
   * 404 en los dos casos, deliberadamente: contestar 403 cuando el turno existe
   * pero es de otra profesora ya seria contar algo de la agenda ajena.
   */
  protected async exigirTurnoPropio(
    cliente: ClientePrismaTx,
    turnoId: string,
    perfilId: string,
  ): Promise<{ id: string; fecha: Date; horaInicio: string }> {
    const turno = await cliente.turno.findFirst({
      where: { id: turnoId, profesorId: perfilId },
      select: { id: true, fecha: true, horaInicio: true },
    });
    if (!turno) throw new NotFoundException('No tenes ninguna clase con ese id');

    return turno;
  }

  protected async listaDeAlumnos(
    cliente: ClientePrismaTx,
    turnoId: string,
  ): Promise<AlumnoEnClase[]> {
    const reservas = await cliente.reserva.findMany({
      where: { turnoId, canceladaEn: null },
      include: { perfil: { include: { usuario: { select: { nombreCompleto: true } } } } },
      orderBy: { perfil: { usuario: { nombreCompleto: 'asc' } } },
    });

    return (reservas as unknown as ReservaConAlumno[]).map((reserva) => ({
      perfilId: reserva.perfilId,
      nombreCompleto: reserva.perfil.usuario.nombreCompleto,
      asistio: reserva.asistio,
    }));
  }
}
```

- [ ] **Step 4: Correr y ver pasar**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/mis-clases --silent
```

Esperado: 6 tests en verde.

- [ ] **Step 5: Mutación — que el aislamiento muerda**

Quita `profesorId: perfil.id` del `where` de `misClases`.

Esperado: falla `devuelve solo las clases propias`. **Es la segunda mutación crítica de la fase**: si
pasa, el tercer punto del checklist no está probado.

**Deshaz la mutación.**

- [ ] **Step 6: El controlador y el módulo (solo lectura por ahora)**

Crear `apps/api/src/mis-clases/mis-clases.controller.ts`:

```ts
import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { esFechaValida, type AlumnoEnClase, type ClaseDelProfesor, type JwtPayload } from '@boxadmin/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { MisClasesService } from './mis-clases.service';

@Controller('mis-clases')
export class MisClasesController {
  constructor(private readonly misClases: MisClasesService) {}

  @Roles('PROFESOR')
  @Get()
  listar(
    @CurrentUser() actor: JwtPayload,
    @Query('desde') desde: string,
    @Query('hasta') hasta: string,
  ): Promise<ClaseDelProfesor[]> {
    exigirRango(desde, hasta);
    return this.misClases.misClases(actor, { desde, hasta });
  }

  @Roles('PROFESOR')
  @Get(':turnoId/alumnos')
  alumnos(
    @CurrentUser() actor: JwtPayload,
    @Param('turnoId') turnoId: string,
  ): Promise<AlumnoEnClase[]> {
    return this.misClases.alumnos(actor, turnoId);
  }
}

/**
 * Los dos extremos del rango son obligatorios y tienen que ser fechas. Sin
 * esto, un `desde` vacio se convierte en Invalid Date y Prisma devuelve el
 * historial entero de la profesora.
 */
function exigirRango(desde: string, hasta: string): void {
  if (!esFechaValida(desde) || !esFechaValida(hasta)) {
    throw new BadRequestException('desde y hasta son obligatorios, con formato YYYY-MM-DD');
  }
  if (desde > hasta) {
    throw new BadRequestException('desde no puede ser posterior a hasta');
  }
}
```

Crear `apps/api/src/mis-clases/mis-clases.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { MisClasesController } from './mis-clases.controller';
import { MisClasesService } from './mis-clases.service';

@Module({
  controllers: [MisClasesController],
  providers: [MisClasesService],
  exports: [MisClasesService],
})
export class MisClasesModule {}
```

Y en `apps/api/src/app.module.ts`, añade `MisClasesModule` a `imports`, después de `MiCalendarioModule`.

**Mensaje de commit sugerido para Cesar:**

```
feat(api): GET /mis-clases y su lista de alumnos

La profesora ve las clases donde profesorId es su perfil, y nada mas: no
hace falta cruzar ademas por sala, porque el turno es suyo por
definicion. El turno de otra profesora devuelve 404 y no 403 — decir que
existe ya seria contar algo de la agenda ajena.

De cada alumna, nombre y si vino. Ni telefono ni ficha medica.
```

---

## Task 10: Pasar lista

**Files:**
- Crear: `apps/api/src/mis-clases/dto/pasar-lista.dto.ts`
- Modificar: `apps/api/src/mis-clases/mis-clases.service.ts`
- Modificar: `apps/api/src/mis-clases/mis-clases.controller.ts`
- Modificar: `apps/api/src/reservas/reservas.service.ts`
- Test: `apps/api/src/mis-clases/mis-clases.service.spec.ts`

- [ ] **Step 1: El DTO**

Crear `apps/api/src/mis-clases/dto/pasar-lista.dto.ts`:

```ts
import { ArrayUnique, IsArray, IsString } from 'class-validator';

/**
 * Una FOTO de la clase entera, no un incremento: quien no esta en `presentes`
 * queda marcado como ausente. Asi pasar lista dos veces con la misma entrada da
 * el mismo resultado, y corregir un error es volver a mandar la lista buena.
 *
 * Un array vacio es valido y significa "no vino nadie".
 */
export class PasarListaDto {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  presentes!: string[];
}
```

- [ ] **Step 2: Escribir los tests**

En `apps/api/src/mis-clases/mis-clases.service.spec.ts`, al final:

```ts
describe('MisClasesService.pasarLista', () => {
  const AYER = new Date('2026-09-07T20:00:00.000Z');

  function prismaParaLista(reservas: { perfilId: string }[]) {
    const db = prismaFalso({
      turnos: [TURNO_DE_FATI],
      reservas: reservas.map((r) => ({
        ...r,
        asistio: null,
        perfil: { usuario: { nombreCompleto: r.perfilId } },
      })),
    });
    return db;
  }

  it('marca presentes y ausentes en la misma pasada', async () => {
    const db = prismaParaLista([{ perfilId: 'p1' }, { perfilId: 'p2' }, { perfilId: 'p3' }]);
    const servicio = new MisClasesService({ db } as never, historialFalso);

    await servicio.pasarLista(ACTOR, 't-fati', { presentes: ['p1', 'p3'] }, AYER);

    const llamadas = db.reserva.updateMany.mock.calls.map((c: any) => c[0]);
    expect(llamadas).toContainEqual({
      where: { turnoId: 't-fati', canceladaEn: null, perfilId: { in: ['p1', 'p3'] } },
      data: { asistio: true },
    });
    expect(llamadas).toContainEqual({
      where: { turnoId: 't-fati', canceladaEn: null, perfilId: { notIn: ['p1', 'p3'] } },
      data: { asistio: false },
    });
  });

  it('con la lista vacia marca ausentes a todos, sin un notIn vacio', async () => {
    // `notIn: []` es una condicion que Prisma resuelve de formas discutibles
    // segun la version. Se evita generandola solo cuando hay presentes.
    const db = prismaParaLista([{ perfilId: 'p1' }]);
    const servicio = new MisClasesService({ db } as never, historialFalso);

    await servicio.pasarLista(ACTOR, 't-fati', { presentes: [] }, AYER);

    const llamadas = db.reserva.updateMany.mock.calls.map((c: any) => c[0]);
    expect(llamadas).toEqual([
      { where: { turnoId: 't-fati', canceladaEn: null }, data: { asistio: false } },
    ]);
  });

  it('rechaza a alguien que no tiene reserva en esa clase', async () => {
    // Un id equivocado marcaria ausente a media clase en silencio.
    const db = prismaParaLista([{ perfilId: 'p1' }]);
    const servicio = new MisClasesService({ db } as never, historialFalso);

    await expect(
      servicio.pasarLista(ACTOR, 't-fati', { presentes: ['p1', 'fantasma'] }, AYER),
    ).rejects.toThrow(/fantasma/);
    expect(db.reserva.updateMany).not.toHaveBeenCalled();
  });

  it('no se puede pasar lista de una clase que no empezo', async () => {
    const db = prismaParaLista([{ perfilId: 'p1' }]);
    const servicio = new MisClasesService({ db } as never, historialFalso);
    const antesDeEmpezar = new Date('2026-09-07T10:00:00.000Z');

    await expect(
      servicio.pasarLista(ACTOR, 't-fati', { presentes: ['p1'] }, antesDeEmpezar),
    ).rejects.toThrow(/todavia no empezo/i);
  });

  it('el turno de otra profesora devuelve 404 antes de escribir nada', async () => {
    const db = prismaFalso({ turnos: [TURNO_DE_FATI, TURNO_DE_ANA] });
    const servicio = new MisClasesService({ db } as never, historialFalso);

    await expect(servicio.pasarLista(ACTOR, 't-ana', { presentes: [] }, AYER)).rejects.toThrow(
      NotFoundException,
    );
    expect(db.reserva.updateMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Correr y ver fallar**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/mis-clases --silent
```

Esperado: FALLA — `pasarLista is not a function`.

- [ ] **Step 4: Implementar**

En `apps/api/src/mis-clases/mis-clases.service.ts`, añade `BadRequestException` e `instanteDelTurno`
a los imports, el tipo del DTO, y el método:

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { instanteDelTurno, ... } from '@boxadmin/shared';
import type { PasarListaDto } from './dto/pasar-lista.dto';
```

```ts
  /**
   * Pasar lista. Es una FOTO del turno entero: quien no esta en `presentes`
   * queda marcado como ausente.
   *
   * Idempotente a proposito — mandar dos veces la misma lista da el mismo
   * resultado— y no toca las reservas canceladas: quien cancelo no falto.
   *
   * `ahora` es inyectable para los tests; en produccion es el reloj.
   */
  async pasarLista(
    actor: JwtPayload,
    turnoId: string,
    dto: PasarListaDto,
    ahora: Date = new Date(),
  ): Promise<AlumnoEnClase[]> {
    const perfil = await this.perfilDelActor(actor);

    return await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      const turno = await this.exigirTurnoPropio(cliente, turnoId, perfil.id);

      // No se pasa lista de una clase que no ocurrio. Hacia atras no hay
      // limite: una profesora que se olvido tres semanas puede ponerse al dia, y
      // el rastro queda en historial_acciones.
      if (instanteDelTurno(turno.fecha, turno.horaInicio).getTime() > ahora.getTime()) {
        throw new BadRequestException('Esa clase todavia no empezo');
      }

      const activas = await cliente.reserva.findMany({
        where: { turnoId, canceladaEn: null },
        select: { perfilId: true },
      });
      const conReserva = new Set(activas.map((reserva) => reserva.perfilId));

      const intrusos = dto.presentes.filter((perfilId) => !conReserva.has(perfilId));
      if (intrusos.length > 0) {
        // Sin esta comprobacion, un id equivocado marcaria ausente a media clase
        // en silencio y la profesora no tendria forma de notarlo.
        throw new BadRequestException(
          `No tienen reserva activa en esta clase: ${intrusos.join(', ')}`,
        );
      }

      if (dto.presentes.length > 0) {
        await cliente.reserva.updateMany({
          where: { turnoId, canceladaEn: null, perfilId: { in: dto.presentes } },
          data: { asistio: true },
        });
        await cliente.reserva.updateMany({
          where: { turnoId, canceladaEn: null, perfilId: { notIn: dto.presentes } },
          data: { asistio: false },
        });
      } else {
        // Se evita generar `notIn: []`, que distintas versiones de Prisma han
        // resuelto de formas distintas.
        await cliente.reserva.updateMany({
          where: { turnoId, canceladaEn: null },
          data: { asistio: false },
        });
      }

      await this.historial.registrar(
        {
          actor,
          entidad: 'Turno',
          entidadId: turnoId,
          accion: 'ASISTENCIA_REGISTRADA',
          detalle: { presentes: dto.presentes.length, total: activas.length },
        },
        cliente,
      );

      return await this.listaDeAlumnos(cliente, turnoId);
    });
  }
```

En `apps/api/src/mis-clases/mis-clases.controller.ts`, añade la ruta:

```ts
  @Roles('PROFESOR')
  @Post(':turnoId/asistencia')
  pasarLista(
    @CurrentUser() actor: JwtPayload,
    @Param('turnoId') turnoId: string,
    @Body() dto: PasarListaDto,
  ): Promise<AlumnoEnClase[]> {
    return this.misClases.pasarLista(actor, turnoId, dto);
  }
```

con `Body` y `Post` añadidos al import de `@nestjs/common` y el import del DTO.

- [ ] **Step 5: Cerrar el último error de `tsc`**

En `apps/api/src/reservas/reservas.service.ts`, en `aReservaPublica`, añade el campo:

```ts
    cancelacionTipo: reserva.cancelacionTipo,
    asistio: reserva.asistio,
  };
```

- [ ] **Step 6: Correr todo**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec tsc --noEmit && pnpm test
```

Esperado: `tsc` **limpio por primera vez desde la Task 1**, y todos los unitarios en verde.

**Mensaje de commit sugerido para Cesar:**

```
feat(api): pasar lista, una foto del turno entero

Quien no esta en presentes queda ausente, asi que mandar dos veces la
misma lista da el mismo resultado. Las canceladas no se tocan: quien
cancelo no falto.

Un perfilId sin reserva activa es 400 y no un no-op: un id equivocado
marcaria ausente a media clase en silencio.
```

---

## Task 11: `calcularLiquidacion`, la función pura de las horas

**Files:**
- Crear: `apps/api/src/liquidacion/calcular-liquidacion.ts`
- Test: `apps/api/src/liquidacion/calcular-liquidacion.spec.ts`

Esta es la función que la Fase 6 va a heredar para multiplicar. Conviene que llegue allí con sus
casos escritos.

- [ ] **Step 1: Escribir la tabla de casos**

Crear `apps/api/src/liquidacion/calcular-liquidacion.spec.ts`:

```ts
import { calcularLiquidacion, type EntradaLiquidacion } from './calcular-liquidacion';

const dia = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

// Septiembre de 2026: los lunes caen 7, 14, 21 y 28.
function entrada(parcial: Partial<EntradaLiquidacion> = {}): EntradaLiquidacion {
  return {
    profesorId: 'fati',
    profesorNombre: 'Fati Gomez',
    anio: 2026,
    mes: 9,
    horarios: [
      {
        salaId: 'sala-a',
        diaSemana: 1,
        horaInicio: '18:00',
        horaFin: '19:00',
        desde: dia('2026-09-01'),
        hasta: null,
        tarifaPorHora: '1500.00',
      },
    ],
    turnos: [],
    ausencias: [],
    tarifaDelTenant: '1200.00',
    ...parcial,
  };
}

const turno = (id: string, fecha: string, horaInicio = '18:00', horaFin = '19:00') => ({
  id,
  salaId: 'sala-a',
  fecha: dia(fecha),
  horaInicio,
  horaFin,
});

describe('calcularLiquidacion', () => {
  it('cuatro lunes contratados y ninguno dictado', () => {
    const r = calcularLiquidacion(entrada());

    expect(r.minutosContratados).toBe(240);
    expect(r.minutosDictados).toBe(0);
    expect(r.horasContratadas).toBe('4.00');
    expect(r.franjas).toHaveLength(4);
    expect(r.franjas.every((f) => f.contratada && !f.dictada)).toBe(true);
  });

  it('un turno dentro de la franja la marca dictada', () => {
    const r = calcularLiquidacion(entrada({ turnos: [turno('t1', '2026-09-07')] }));

    expect(r.minutosDictados).toBe(60);
    expect(r.franjas[0]).toMatchObject({ fecha: '2026-09-07', dictada: true, turnoId: 't1' });
  });

  it('un turno que empieza a las 18:30 tambien cuenta como dictada', () => {
    // Misma regla de contencion que el etiquetado: si las dos no dijeran lo
    // mismo, un turno podria estar etiquetado y no aparecer como dictado.
    const r = calcularLiquidacion(entrada({ turnos: [turno('t1', '2026-09-07', '18:30', '19:30')] }));

    expect(r.franjas[0]!.dictada).toBe(true);
  });

  it('un feriado no suma a contratadas y se informa aparte', () => {
    const r = calcularLiquidacion(
      entrada({
        ausencias: [
          { salaId: 'sala-a', desde: dia('2026-09-21'), hasta: dia('2026-09-21'), motivo: 'Feriado' },
        ],
      }),
    );

    expect(r.minutosContratados).toBe(180);
    expect(r.minutosCerrados).toBe(60);
    const cerrada = r.franjas.find((f) => f.cerrada);
    expect(cerrada).toMatchObject({ fecha: '2026-09-21', motivoCierre: 'Feriado', dictada: false });
  });

  it('un cierre del salon entero tambien tapa la franja', () => {
    const r = calcularLiquidacion(
      entrada({
        ausencias: [{ salaId: null, desde: dia('2026-09-21'), hasta: dia('2026-09-21'), motivo: null }],
      }),
    );

    expect(r.minutosCerrados).toBe(60);
  });

  it('si hubo clase pese al cierre, no esta cerrada: se dio', () => {
    const r = calcularLiquidacion(
      entrada({
        turnos: [turno('t1', '2026-09-21')],
        ausencias: [
          { salaId: 'sala-a', desde: dia('2026-09-21'), hasta: dia('2026-09-21'), motivo: 'Feriado' },
        ],
      }),
    );

    const franja = r.franjas.find((f) => f.fecha === '2026-09-21')!;
    expect(franja.cerrada).toBe(false);
    expect(franja.dictada).toBe(true);
  });

  it('una suplencia sin contrato aparece como dictada y no contratada', () => {
    const r = calcularLiquidacion(
      entrada({ turnos: [turno('t-sup', '2026-09-09', '10:00', '11:00')] }),
    );

    const suplencia = r.franjas.find((f) => f.turnoId === 't-sup')!;
    expect(suplencia).toMatchObject({ contratada: false, dictada: true, minutos: 60 });
    // La profesora fue: cuenta como dictada aunque no tuviera contrato ahi.
    expect(r.minutosDictados).toBe(60);
    expect(r.minutosContratados).toBe(240);
  });

  it('la tarifa del horario gana a la del gimnasio', () => {
    const r = calcularLiquidacion(entrada());

    expect(r.franjas[0]).toMatchObject({ tarifaPorHora: '1500.00', origenTarifa: 'HORARIO' });
  });

  it('sin tarifa en el horario, cae a la del gimnasio', () => {
    const r = calcularLiquidacion(
      entrada({ horarios: [{ ...entrada().horarios[0]!, tarifaPorHora: null }] }),
    );

    expect(r.franjas[0]).toMatchObject({ tarifaPorHora: '1200.00', origenTarifa: 'TENANT' });
  });

  it('sin ninguna tarifa definida, null no es un error', () => {
    // Un gimnasio puede llevar los horarios sin haber cargado tarifas.
    const r = calcularLiquidacion(
      entrada({
        horarios: [{ ...entrada().horarios[0]!, tarifaPorHora: null }],
        tarifaDelTenant: null,
      }),
    );

    expect(r.franjas[0]).toMatchObject({ tarifaPorHora: null, origenTarifa: null });
  });

  it('el contrato que empieza a mitad de mes solo cuenta desde ahi', () => {
    const r = calcularLiquidacion(
      entrada({ horarios: [{ ...entrada().horarios[0]!, desde: dia('2026-09-15') }] }),
    );

    // Quedan el 21 y el 28.
    expect(r.franjas).toHaveLength(2);
    expect(r.minutosContratados).toBe(120);
  });

  it('un mes sin horarios ni turnos da todo a cero', () => {
    const r = calcularLiquidacion(entrada({ horarios: [] }));

    expect(r).toMatchObject({
      minutosContratados: 0,
      minutosDictados: 0,
      minutosCerrados: 0,
      horasContratadas: '0.00',
      franjas: [],
    });
  });

  it('las franjas salen ordenadas por fecha y hora', () => {
    const r = calcularLiquidacion(
      entrada({ turnos: [turno('t-sup', '2026-09-02', '10:00', '11:00')] }),
    );

    const fechas = r.franjas.map((f) => f.fecha);
    expect(fechas).toEqual([...fechas].sort());
  });

  it('media hora se informa como 0.50, no como 0.5', () => {
    const r = calcularLiquidacion(
      entrada({ horarios: [{ ...entrada().horarios[0]!, horaFin: '18:30' }] }),
    );

    expect(r.minutosContratados).toBe(120);
    expect(r.horasContratadas).toBe('2.00');
    expect(r.franjas[0]!.minutos).toBe(30);
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/liquidacion --silent
```

Esperado: FALLA con `Cannot find module './calcular-liquidacion'`.

- [ ] **Step 3: Implementar**

Crear `apps/api/src/liquidacion/calcular-liquidacion.ts`:

```ts
import {
  aFechaISO,
  comparaHoras,
  fechaEnRango,
  fechasDelMesEnDiaSemana,
  minutosEntreHoras,
  type FranjaDeLiquidacion,
  type LiquidacionProfesor,
  type OrigenTarifa,
} from '@boxadmin/shared';

export interface HorarioParaLiquidacion {
  salaId: string;
  diaSemana: number;
  horaInicio: string;
  horaFin: string;
  desde: Date;
  hasta: Date | null;
  /** String con dos decimales. `null` = usa la del gimnasio. */
  tarifaPorHora: string | null;
}

export interface TurnoDictado {
  id: string;
  salaId: string;
  fecha: Date;
  horaInicio: string;
  horaFin: string;
}

export interface AusenciaParaLiquidacion {
  /** `null` = todo el salon. */
  salaId: string | null;
  desde: Date;
  hasta: Date;
  motivo: string | null;
}

export interface EntradaLiquidacion {
  profesorId: string;
  profesorNombre: string;
  anio: number;
  mes: number;
  horarios: HorarioParaLiquidacion[];
  /** Los turnos del mes que tienen a ESTA profesora. */
  turnos: TurnoDictado[];
  ausencias: AusenciaParaLiquidacion[];
  tarifaDelTenant: string | null;
}

/**
 * Las horas de una profesora en un mes.
 *
 * PURA: ni una query. Es lo que permite probar las cuatro combinaciones de
 * banderas con una tabla de casos, y lo que hara que la Fase 6 —que multiplica
 * por la tarifa y aplica ajustes— pueda construirse encima sin volver a
 * derivar nada.
 *
 * NO devuelve importes. El calculo en pesos es de la Fase 6; aqui la tarifa
 * viaja ya resuelta para que alli solo haya que multiplicar.
 */
export function calcularLiquidacion(entrada: EntradaLiquidacion): LiquidacionProfesor {
  const franjas: FranjaDeLiquidacion[] = [];
  const turnosUsados = new Set<string>();

  // --- Lo contratado: el patron semanal, fecha a fecha ----------------------
  for (const horario of entrada.horarios) {
    for (const fecha of fechasDelMesEnDiaSemana(entrada.anio, entrada.mes, horario.diaSemana)) {
      if (!fechaEnRango(fecha, horario.desde, horario.hasta)) continue;

      const turno = entrada.turnos.find(
        (t) =>
          !turnosUsados.has(t.id) &&
          t.salaId === horario.salaId &&
          t.fecha.getTime() === fecha.getTime() &&
          // La misma contencion que usa el etiquetado. Si las dos reglas no
          // dijeran lo mismo, un turno podria estar etiquetado con esta
          // profesora y no aparecer como dictado en su liquidacion.
          comparaHoras(t.horaInicio, horario.horaInicio) >= 0 &&
          comparaHoras(t.horaInicio, horario.horaFin) < 0,
      );
      if (turno) turnosUsados.add(turno.id);

      const ausencia = entrada.ausencias.find(
        (a) =>
          (a.salaId === null || a.salaId === horario.salaId) &&
          fechaEnRango(fecha, a.desde, a.hasta),
      );
      // Si hubo clase pese al cierre, no estaba cerrado: se dio.
      const cerrada = ausencia !== undefined && turno === undefined;

      const { tarifa, origen } = resolverTarifa(horario.tarifaPorHora, entrada.tarifaDelTenant);

      franjas.push({
        fecha: aFechaISO(fecha),
        salaId: horario.salaId,
        horaInicio: horario.horaInicio,
        horaFin: horario.horaFin,
        minutos: minutosEntreHoras(horario.horaInicio, horario.horaFin),
        contratada: true,
        dictada: turno !== undefined,
        cerrada,
        motivoCierre: cerrada ? (ausencia?.motivo ?? null) : null,
        turnoId: turno?.id ?? null,
        tarifaPorHora: tarifa,
        origenTarifa: origen,
      });
    }
  }

  // --- Las suplencias: turnos suyos que ningun contrato cubre ---------------
  for (const turno of entrada.turnos) {
    if (turnosUsados.has(turno.id)) continue;

    franjas.push({
      fecha: aFechaISO(turno.fecha),
      salaId: turno.salaId,
      horaInicio: turno.horaInicio,
      horaFin: turno.horaFin,
      minutos: minutosEntreHoras(turno.horaInicio, turno.horaFin),
      contratada: false,
      dictada: true,
      cerrada: false,
      motivoCierre: null,
      turnoId: turno.id,
      tarifaPorHora: entrada.tarifaDelTenant,
      origenTarifa: entrada.tarifaDelTenant === null ? null : 'TENANT',
    });
  }

  franjas.sort(
    (a, b) =>
      a.fecha.localeCompare(b.fecha) ||
      a.horaInicio.localeCompare(b.horaInicio) ||
      a.salaId.localeCompare(b.salaId),
  );

  const sumar = (filtro: (f: FranjaDeLiquidacion) => boolean): number =>
    franjas.filter(filtro).reduce((total, f) => total + f.minutos, 0);

  // Contratadas EXCLUYE las cerradas (decision D6): asi "contratadas menos
  // dictadas" significa una sola cosa —horas que nadie uso por falta de
  // alumnos— en vez de mezclar eso con feriados, que se negocian distinto.
  const minutosContratados = sumar((f) => f.contratada && !f.cerrada);
  const minutosDictados = sumar((f) => f.dictada);
  const minutosCerrados = sumar((f) => f.cerrada);

  return {
    profesorId: entrada.profesorId,
    profesorNombre: entrada.profesorNombre,
    anio: entrada.anio,
    mes: entrada.mes,
    minutosContratados,
    minutosDictados,
    minutosCerrados,
    horasContratadas: aHoras(minutosContratados),
    horasDictadas: aHoras(minutosDictados),
    horasCerradas: aHoras(minutosCerrados),
    franjas,
  };
}

function resolverTarifa(
  delHorario: string | null,
  delTenant: string | null,
): { tarifa: string | null; origen: OrigenTarifa | null } {
  if (delHorario !== null) return { tarifa: delHorario, origen: 'HORARIO' };
  if (delTenant !== null) return { tarifa: delTenant, origen: 'TENANT' };

  // Ninguna definida no es un error: un gimnasio puede llevar los horarios sin
  // haber cargado tarifas todavia.
  return { tarifa: null, origen: null };
}

/**
 * Los minutos son la verdad; esto es una comodidad.
 *
 * Dos decimales SIEMPRE, incluso en "4.00": la Fase 6 va a multiplicar estos
 * numeros por una tarifa en Decimal, y un formato que a veces trae decimales y
 * a veces no es una invitacion a parsearlo mal.
 */
function aHoras(minutos: number): string {
  return (minutos / 60).toFixed(2);
}
```

- [ ] **Step 4: Correr y ver pasar**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/liquidacion --silent
```

Esperado: 14 tests en verde.

- [ ] **Step 5: Mutación — que D6 muerda**

Cambia `sumar((f) => f.contratada && !f.cerrada)` por `sumar((f) => f.contratada)`.

Esperado: falla `un feriado no suma a contratadas`. Es el noveno punto del checklist.

**Deshaz la mutación.**

**Mensaje de commit sugerido para Cesar:**

```
feat(api): calcularLiquidacion, las horas del mes sin tocar la base

Una sola lista de franjas con tres banderas ortogonales: contratada,
dictada y cerrada. Contratadas excluye las cerradas, para que
"contratadas menos dictadas" signifique una sola cosa.

Sin importes: el calculo en pesos es de la Fase 6. La tarifa viaja ya
resuelta por la cascada horario -> gimnasio para que alli solo haya que
multiplicar, en Decimal y sin pasar por un float.
```

---

## Task 12: El endpoint de liquidación

**Files:**
- Crear: `apps/api/src/liquidacion/liquidacion.datos.ts`
- Crear: `apps/api/src/liquidacion/liquidacion.service.ts`
- Crear: `apps/api/src/liquidacion/liquidacion.controller.ts`
- Crear: `apps/api/src/liquidacion/liquidacion.module.ts`
- Modificar: `apps/api/src/app.module.ts`

- [ ] **Step 1: El cargador**

Crear `apps/api/src/liquidacion/liquidacion.datos.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { primerDiaDelMesUtc, ultimoDiaDelMesUtc, type JwtPayload } from '@boxadmin/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { EntradaLiquidacion } from './calcular-liquidacion';

/**
 * Traduce el estado de la base a la entrada de `calcularLiquidacion`.
 *
 * Mismo reparto que en la Fase 2: aqui no entra una sola regla de negocio, y en
 * la funcion pura no entra una sola query.
 */
@Injectable()
export class LiquidacionDatos {
  constructor(private readonly prisma: PrismaService) {}

  async cargar(
    actor: JwtPayload,
    profesorId: string,
    anio: number,
    mes: number,
  ): Promise<EntradaLiquidacion> {
    const inicio = primerDiaDelMesUtc(anio, mes);
    const fin = ultimoDiaDelMesUtc(anio, mes);

    const perfil = await this.prisma.db.perfil.findFirst({
      where: { id: profesorId },
      include: { usuario: { select: { rol: true, nombreCompleto: true } } },
    });
    if (!perfil || perfil.usuario.rol !== 'PROFESOR') {
      throw new NotFoundException('No hay ninguna profesora con ese id');
    }

    // NO se filtra por `activo`: la liquidacion mira el rango de fechas, y un
    // horario dado de baja la semana pasada sigue explicando las horas de la
    // semana anterior. Ver §6.1 de la spec.
    const horarios = await this.prisma.db.horarioProfesorAsignado.findMany({
      where: {
        profesorId,
        desde: { lte: fin },
        OR: [{ hasta: null }, { hasta: { gte: inicio } }],
      },
    });

    const turnos = await this.prisma.db.turno.findMany({
      where: { profesorId, fecha: { gte: inicio, lte: fin } },
      select: { id: true, salaId: true, fecha: true, horaInicio: true, horaFin: true },
    });

    const salaIds = [...new Set(horarios.map((h) => h.salaId))];
    const ausencias =
      salaIds.length === 0
        ? []
        : await this.prisma.db.ausencia.findMany({
            where: {
              OR: [{ salaId: { in: salaIds } }, { salaId: null }],
              desde: { lte: fin },
              hasta: { gte: inicio },
            },
          });

    // Tenant es un modelo GLOBAL en la extension de aislamiento, asi que no se
    // le inyecta ningun filtro: hay que acotarlo a mano.
    const tenant = await this.prisma.db.tenant.findFirst({ where: { id: actor.tenantId } });

    return {
      profesorId,
      profesorNombre: perfil.usuario.nombreCompleto,
      anio,
      mes,
      horarios: horarios.map((h) => ({
        salaId: h.salaId,
        diaSemana: h.diaSemana,
        horaInicio: h.horaInicio,
        horaFin: h.horaFin,
        desde: h.desde,
        hasta: h.hasta,
        tarifaPorHora: h.tarifaPorHora === null ? null : h.tarifaPorHora.toFixed(2),
      })),
      turnos,
      ausencias: ausencias.map((a) => ({
        salaId: a.salaId,
        desde: a.desde,
        hasta: a.hasta,
        motivo: a.motivo,
      })),
      tarifaDelTenant:
        tenant?.tarifaPorHoraProfesor == null ? null : tenant.tarifaPorHoraProfesor.toFixed(2),
    };
  }
}
```

- [ ] **Step 2: El servicio, el controlador y el módulo**

Crear `apps/api/src/liquidacion/liquidacion.service.ts`:

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import type { JwtPayload, LiquidacionProfesor } from '@boxadmin/shared';
import { calcularLiquidacion } from './calcular-liquidacion';
import { LiquidacionDatos } from './liquidacion.datos';

@Injectable()
export class LiquidacionService {
  constructor(private readonly datos: LiquidacionDatos) {}

  async delMes(
    actor: JwtPayload,
    profesorId: string,
    anio: number,
    mes: number,
  ): Promise<LiquidacionProfesor> {
    if (!Number.isInteger(anio) || anio < 2000 || anio > 2200) {
      throw new BadRequestException('anio invalido');
    }
    if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
      throw new BadRequestException('mes invalido');
    }

    return calcularLiquidacion(await this.datos.cargar(actor, profesorId, anio, mes));
  }
}
```

Crear `apps/api/src/liquidacion/liquidacion.controller.ts`:

```ts
import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import type { JwtPayload, LiquidacionProfesor } from '@boxadmin/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { LiquidacionService } from './liquidacion.service';

@Controller('liquidacion')
export class LiquidacionController {
  constructor(private readonly liquidacion: LiquidacionService) {}

  // ADMIN_SALON y no ADMIN_OPERATIVO: esto enseña tarifas.
  @Roles('ADMIN_SALON')
  @Get(':profesorId')
  delMes(
    @CurrentUser() actor: JwtPayload,
    @Param('profesorId') profesorId: string,
    @Query('anio', ParseIntPipe) anio: number,
    @Query('mes', ParseIntPipe) mes: number,
  ): Promise<LiquidacionProfesor> {
    return this.liquidacion.delMes(actor, profesorId, anio, mes);
  }
}
```

Crear `apps/api/src/liquidacion/liquidacion.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { LiquidacionController } from './liquidacion.controller';
import { LiquidacionDatos } from './liquidacion.datos';
import { LiquidacionService } from './liquidacion.service';

@Module({
  controllers: [LiquidacionController],
  providers: [LiquidacionService, LiquidacionDatos],
  exports: [LiquidacionService],
})
export class LiquidacionModule {}
```

Y añade `LiquidacionModule` a los `imports` de `apps/api/src/app.module.ts`.

- [ ] **Step 3: Comprobar que compila y arranca**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec tsc --noEmit && pnpm test
```

Esperado: limpio y verde.

**Mensaje de commit sugerido para Cesar:**

```
feat(api): GET /liquidacion/:profesorId con horas y tarifa resuelta

ADMIN_SALON y no ADMIN_OPERATIVO, porque enseña tarifas. El cargador NO
filtra por activo: la liquidacion mira el rango de fechas, y un horario
dado de baja la semana pasada sigue explicando las horas de la anterior.
```

---
## Task 13: Los e2e del checklist

**Files:**
- Modificar: `apps/api/test/helpers.ts`
- Crear: `apps/api/test/profesor.e2e-spec.ts`

⚠️ **Antes de correr nada, comprueba que no hay otra API viva.** El worker de publicación consume de
Redis, y una segunda instancia se lleva los jobs; el síntoma es un test que falla diciendo que el mes
no se publicó, sin mencionar Redis por ningún lado.

```bash
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { \$_.CommandLine -like '*box-admin*' } | Select-Object ProcessId, CommandLine"
```

- [ ] **Step 1: El helper para dar de alta una profesora**

En `apps/api/test/helpers.ts`, al final:

```ts
export interface ProfesorDeTest {
  usuarioId: string;
  perfilId: string;
  token: string;
  email: string;
}

/**
 * Da de alta una profesora con sus salas y devuelve su token.
 *
 * El alta devuelve la contraseña temporal UNA sola vez, asi que el login va
 * aqui mismo: releerla despues es imposible por diseño.
 */
export async function crearProfesor(
  app: INestApplication,
  gimnasio: GimnasioDeTest,
  salaIds: string[],
  opciones: { email?: string; nombre?: string } = {},
): Promise<ProfesorDeTest> {
  const servidor = app.getHttpServer();
  const email =
    opciones.email ?? `profe-${Date.now()}-${Math.random().toString(36).slice(2)}@test.io`;

  const alta = await request(servidor)
    .post('/usuarios/profesores')
    .set('Authorization', `Bearer ${gimnasio.adminToken}`)
    .send({ nombreCompleto: opciones.nombre ?? 'Fati Gomez', email, salaIds })
    .expect(201);

  const login = await request(servidor)
    .post('/auth/login')
    .send({ tenantSlug: gimnasio.slug, email, password: alta.body.passwordTemporal })
    .expect(200);

  return {
    usuarioId: alta.body.id,
    perfilId: alta.body.perfilId,
    token: login.body.accessToken,
    email,
  };
}
```

- [ ] **Step 2: Escribir el e2e**

Crear `apps/api/test/profesor.e2e-spec.ts`:

```ts
import type { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import {
  crearAlumnoPorInvitacion,
  crearAppDeTest,
  crearGimnasio,
  crearProfesor,
  limpiarBaseDeDatos,
  publicarMes,
  type EntornoE2E,
  type GimnasioDeTest,
} from './helpers';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

// 2099 y no una fecha cercana: la API no publica meses pasados, y un mes
// concreto hace que los turnos generados sean contables sin depender del dia en
// que se corran los tests.
const ANIO = 2099;
const MES = 9;
const PRIMER_LUNES = '2099-09-07';
const DIA_SEMANA = new Date(`${PRIMER_LUNES}T00:00:00.000Z`).getUTCDay();

interface Escenario {
  gym: GimnasioDeTest;
  salaId: string;
  otraSalaId: string;
  fati: Awaited<ReturnType<typeof crearProfesor>>;
  ana: Awaited<ReturnType<typeof crearProfesor>>;
  alumnoPerfilId: string;
}

describe('Fase 4 — el profesor como entidad real (e2e)', () => {
  let entorno: EntornoE2E;
  let app: INestApplication;
  let servidor: ReturnType<INestApplication['getHttpServer']>;

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
  });

  async function montar(slug: string): Promise<Escenario> {
    const gym = await crearGimnasio(app, slug);

    const sala = await request(servidor)
      .post('/salas')
      .set(auth(gym.adminToken))
      .send({ nombre: 'Sala A', cupoBase: 5 })
      .expect(201);

    const otraSala = await request(servidor)
      .post('/salas')
      .set(auth(gym.adminToken))
      .send({ nombre: 'Sala B', cupoBase: 5 })
      .expect(201);

    const fati = await crearProfesor(app, gym, [sala.body.id], { nombre: 'Fati Gomez' });
    const ana = await crearProfesor(app, gym, [sala.body.id], { nombre: 'Ana Ruiz' });
    const alumno = await crearAlumnoPorInvitacion(app, gym, [sala.body.id]);

    return {
      gym,
      salaId: sala.body.id,
      otraSalaId: otraSala.body.id,
      fati,
      ana,
      alumnoPerfilId: alumno.perfilId,
    };
  }

  async function darHorario(
    e: Escenario,
    perfilId: string,
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    const { body } = await request(servidor)
      .post('/horarios-profesor')
      .set(auth(e.gym.adminToken))
      .send({
        profesorId: perfilId,
        salaId: e.salaId,
        diaSemana: DIA_SEMANA,
        horaInicio: '18:00',
        horaFin: '19:00',
        desde: '2099-09-01',
        tarifaPorHora: '1500.00',
        ...extra,
      })
      .expect(201);

    return body.id;
  }

  async function darRutinaYPublicar(e: Escenario): Promise<void> {
    await request(servidor)
      .post('/rutinas')
      .set(auth(e.gym.adminToken))
      .send({
        perfilId: e.alumnoPerfilId,
        salaId: e.salaId,
        nombre: 'Pilates',
        diaSemana: DIA_SEMANA,
        horaInicio: '18:00',
        horaFin: '19:00',
        desde: '2099-09-01',
      })
      .expect(201);

    await publicarMes(app, e.gym.adminToken, e.salaId, ANIO, MES);
  }

  // --- Punto 1 del checklist ------------------------------------------------

  it('un turno generado desde un horario trae profesorId, sin tocar el nombre', async () => {
    const e = await montar('p4-uno');
    await darHorario(e, e.fati.perfilId);
    await darRutinaYPublicar(e);

    const { body } = await request(servidor)
      .get('/turnos')
      .query({ desde: '2099-09-01', hasta: '2099-09-30' })
      .set(auth(e.gym.adminToken))
      .expect(200);

    expect(body.length).toBeGreaterThan(0);
    for (const turno of body) {
      expect(turno.profesor).toEqual({ id: e.fati.perfilId, nombreCompleto: 'Fati Gomez' });
      // El hallazgo central de TurnoFit era que el vinculo vivia DENTRO del
      // nombre. Aqui el nombre no sabe nada de la profesora.
      expect(turno.nombre).toBe('Pilates');
    }
  });

  it('el horario dado de alta DESPUES de publicar rellena los turnos huerfanos', async () => {
    const e = await montar('p4-tarde');
    await darRutinaYPublicar(e);

    const antes = await request(servidor)
      .get('/turnos')
      .query({ desde: '2099-09-01', hasta: '2099-09-30' })
      .set(auth(e.gym.adminToken))
      .expect(200);
    expect(antes.body[0].profesor).toBeNull();

    await darHorario(e, e.fati.perfilId);
    await publicarMes(app, e.gym.adminToken, e.salaId, ANIO, MES);

    const despues = await request(servidor)
      .get('/turnos')
      .query({ desde: '2099-09-01', hasta: '2099-09-30' })
      .set(auth(e.gym.adminToken))
      .expect(200);
    expect(despues.body[0].profesor.id).toBe(e.fati.perfilId);
  });

  // --- Punto 2: la suplencia -----------------------------------------------

  it('la suplencia sobrevive a republicar el mes y no toca el patron', async () => {
    const e = await montar('p4-suplencia');
    const horarioId = await darHorario(e, e.fati.perfilId);
    await darRutinaYPublicar(e);

    const turnos = await request(servidor)
      .get('/turnos')
      .query({ desde: '2099-09-01', hasta: '2099-09-30' })
      .set(auth(e.gym.adminToken))
      .expect(200);
    const turnoId = turnos.body[0].id;

    await request(servidor)
      .patch(`/turnos/${turnoId}/profesor`)
      .set(auth(e.gym.adminToken))
      .send({ profesorId: e.ana.perfilId })
      .expect(200);

    await publicarMes(app, e.gym.adminToken, e.salaId, ANIO, MES);

    const despues = await request(servidor)
      .get(`/turnos/${turnoId}`)
      .set(auth(e.gym.adminToken))
      .expect(200);
    expect(despues.body.profesor.id).toBe(e.ana.perfilId);

    // Y el patron semanal sigue diciendo lo que decia.
    const horarios = await request(servidor)
      .get('/horarios-profesor')
      .set(auth(e.gym.adminToken))
      .expect(200);
    expect(horarios.body.find((h: any) => h.id === horarioId).profesorId).toBe(e.fati.perfilId);
  });

  // --- Punto 3: aislamiento de la vista ------------------------------------

  it('cada profesora ve unicamente sus clases', async () => {
    const e = await montar('p4-aislada');
    await darHorario(e, e.fati.perfilId);
    await darRutinaYPublicar(e);

    const deFati = await request(servidor)
      .get('/mis-clases')
      .query({ desde: '2099-09-01', hasta: '2099-09-30' })
      .set(auth(e.fati.token))
      .expect(200);
    expect(deFati.body.length).toBeGreaterThan(0);

    const deAna = await request(servidor)
      .get('/mis-clases')
      .query({ desde: '2099-09-01', hasta: '2099-09-30' })
      .set(auth(e.ana.token))
      .expect(200);
    expect(deAna.body).toEqual([]);
  });

  it('un admin no tiene clases propias: 404', async () => {
    const e = await montar('p4-admin');

    await request(servidor)
      .get('/mis-clases')
      .query({ desde: '2099-09-01', hasta: '2099-09-30' })
      .set(auth(e.gym.adminToken))
      .expect(404);
  });

  // --- Punto 4: aislamiento de la lista ------------------------------------

  it('la lista de alumnos de una clase ajena devuelve 404', async () => {
    const e = await montar('p4-lista');
    await darHorario(e, e.fati.perfilId);
    await darRutinaYPublicar(e);

    const clases = await request(servidor)
      .get('/mis-clases')
      .query({ desde: '2099-09-01', hasta: '2099-09-30' })
      .set(auth(e.fati.token))
      .expect(200);
    const turnoId = clases.body[0].turnoId;

    const propia = await request(servidor)
      .get(`/mis-clases/${turnoId}/alumnos`)
      .set(auth(e.fati.token))
      .expect(200);
    expect(propia.body[0]).toMatchObject({ perfilId: e.alumnoPerfilId, asistio: null });
    // Ni telefono ni ficha medica.
    expect(Object.keys(propia.body[0]).sort()).toEqual(['asistio', 'nombreCompleto', 'perfilId']);

    await request(servidor)
      .get(`/mis-clases/${turnoId}/alumnos`)
      .set(auth(e.ana.token))
      .expect(404);
  });

  // --- Punto 6: el filtro del calendario admin -----------------------------

  it('?profesorId= filtra el calendario admin', async () => {
    const e = await montar('p4-filtro');
    await darHorario(e, e.fati.perfilId);
    await darRutinaYPublicar(e);

    const deFati = await request(servidor)
      .get('/turnos')
      .query({ desde: '2099-09-01', hasta: '2099-09-30', profesorId: e.fati.perfilId })
      .set(auth(e.gym.adminToken))
      .expect(200);
    expect(deFati.body.length).toBeGreaterThan(0);

    const deAna = await request(servidor)
      .get('/turnos')
      .query({ desde: '2099-09-01', hasta: '2099-09-30', profesorId: e.ana.perfilId })
      .set(auth(e.gym.adminToken))
      .expect(200);
    expect(deAna.body).toEqual([]);
  });

  // --- Los dos solapes de D5 ------------------------------------------------

  it('409 si otra profesora ya cubre esa sala, dia y hora', async () => {
    const e = await montar('p4-solape');
    await darHorario(e, e.fati.perfilId);

    await request(servidor)
      .post('/horarios-profesor')
      .set(auth(e.gym.adminToken))
      .send({
        profesorId: e.ana.perfilId,
        salaId: e.salaId,
        diaSemana: DIA_SEMANA,
        horaInicio: '18:30',
        horaFin: '19:30',
        desde: '2099-09-01',
      })
      .expect(409);
  });

  it('409 si la misma profesora ya esta en otra sala a esa hora', async () => {
    const e = await montar('p4-doble');
    await darHorario(e, e.fati.perfilId);

    // Primero hay que darle acceso a la otra sala, o el 400 taparia el 409.
    await request(servidor)
      .patch(`/usuarios/${e.fati.usuarioId}/salas`)
      .set(auth(e.gym.adminToken))
      .send({ salaIds: [e.salaId, e.otraSalaId] })
      .expect(200);

    await request(servidor)
      .post('/horarios-profesor')
      .set(auth(e.gym.adminToken))
      .send({
        profesorId: e.fati.perfilId,
        salaId: e.otraSalaId,
        diaSemana: DIA_SEMANA,
        horaInicio: '18:00',
        horaFin: '19:00',
        desde: '2099-09-01',
      })
      .expect(409);
  });

  it('asignar una profesora a una sala a la que no tiene acceso se rechaza', async () => {
    const e = await montar('p4-sin-acceso');

    await request(servidor)
      .post('/horarios-profesor')
      .set(auth(e.gym.adminToken))
      .send({
        profesorId: e.fati.perfilId,
        salaId: e.otraSalaId,
        diaSemana: DIA_SEMANA,
        horaInicio: '18:00',
        horaFin: '19:00',
        desde: '2099-09-01',
      })
      .expect(400);
  });

  // --- Puntos 5 y 9: la liquidacion ----------------------------------------

  it('la liquidacion separa contratadas, dictadas y cerradas', async () => {
    const e = await montar('p4-liquidacion');
    await darHorario(e, e.fati.perfilId);

    // Un feriado sobre uno de los dias del patron.
    await request(servidor)
      .post('/ausencias')
      .set(auth(e.gym.adminToken))
      .send({ salaId: e.salaId, desde: '2099-09-21', hasta: '2099-09-21', motivo: 'Feriado' })
      .expect(201);

    await darRutinaYPublicar(e);

    const { body } = await request(servidor)
      .get(`/liquidacion/${e.fati.perfilId}`)
      .query({ anio: ANIO, mes: MES })
      .set(auth(e.gym.adminToken))
      .expect(200);

    // Septiembre de 2099 tiene cuatro lunes; uno es feriado.
    expect(body.horasCerradas).toBe('1.00');
    expect(body.minutosContratados).toBe(180);
    // El motor no genera turno el dia cerrado, asi que dictadas son los otros tres.
    expect(body.minutosDictados).toBe(180);
    expect(body.franjas.find((f: any) => f.cerrada).motivoCierre).toBe('Feriado');
    // La tarifa viaja resuelta, pero no hay ni un importe.
    expect(body.franjas[0].tarifaPorHora).toBe('1500.00');
    expect(body.franjas[0].origenTarifa).toBe('HORARIO');
    expect(JSON.stringify(body)).not.toMatch(/importe/i);
  });

  it('la liquidacion la ve ADMIN_SALON, no un profesor', async () => {
    const e = await montar('p4-permiso');

    await request(servidor)
      .get(`/liquidacion/${e.fati.perfilId}`)
      .query({ anio: ANIO, mes: MES })
      .set(auth(e.fati.token))
      .expect(403);
  });

  // --- Punto 8: pasar lista -------------------------------------------------

  describe('pasar lista', () => {
    /** Un turno en el pasado, creado a mano: no se pasa lista del futuro. */
    async function claseYaDada(e: Escenario): Promise<string> {
      const turno = await request(servidor)
        .post('/turnos')
        .set(auth(e.gym.adminToken))
        .send({
          salaId: e.salaId,
          nombre: 'Pilates',
          fecha: '2020-01-06',
          horaInicio: '18:00',
          horaFin: '19:00',
          cupo: 5,
          profesorId: e.fati.perfilId,
        })
        .expect(201);

      await request(servidor)
        .post(`/turnos/${turno.body.id}/reservas`)
        .set(auth(e.gym.adminToken))
        .send({ perfilId: e.alumnoPerfilId })
        .expect(201);

      return turno.body.id;
    }

    it('es idempotente y marca ausente a quien no esta en la lista', async () => {
      const e = await montar('p4-lista-ok');
      const turnoId = await claseYaDada(e);

      const otro = await crearAlumnoPorInvitacion(app, e.gym, [e.salaId]);
      await request(servidor)
        .post(`/turnos/${turnoId}/reservas`)
        .set(auth(e.gym.adminToken))
        .send({ perfilId: otro.perfilId })
        .expect(201);

      const primera = await request(servidor)
        .post(`/mis-clases/${turnoId}/asistencia`)
        .set(auth(e.fati.token))
        .send({ presentes: [e.alumnoPerfilId] })
        .expect(201);

      const porPerfil = (cuerpo: any[]) =>
        Object.fromEntries(cuerpo.map((a) => [a.perfilId, a.asistio]));

      expect(porPerfil(primera.body)).toEqual({
        [e.alumnoPerfilId]: true,
        [otro.perfilId]: false,
      });

      const segunda = await request(servidor)
        .post(`/mis-clases/${turnoId}/asistencia`)
        .set(auth(e.fati.token))
        .send({ presentes: [e.alumnoPerfilId] })
        .expect(201);

      expect(porPerfil(segunda.body)).toEqual(porPerfil(primera.body));
    });

    it('no se puede pasar lista de una clase que no empezo', async () => {
      const e = await montar('p4-lista-futura');
      await darHorario(e, e.fati.perfilId);
      await darRutinaYPublicar(e);

      const clases = await request(servidor)
        .get('/mis-clases')
        .query({ desde: '2099-09-01', hasta: '2099-09-30' })
        .set(auth(e.fati.token))
        .expect(200);

      await request(servidor)
        .post(`/mis-clases/${clases.body[0].turnoId}/asistencia`)
        .set(auth(e.fati.token))
        .send({ presentes: [] })
        .expect(400);
    });

    it('un perfilId sin reserva activa es 400, no un no-op', async () => {
      const e = await montar('p4-lista-intruso');
      const turnoId = await claseYaDada(e);

      await request(servidor)
        .post(`/mis-clases/${turnoId}/asistencia`)
        .set(auth(e.fati.token))
        .send({ presentes: [e.ana.perfilId] })
        .expect(400);
    });
  });
});
```

- [ ] **Step 3: Correr el e2e**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest --config test/jest-e2e.json test/profesor.e2e-spec.ts --runInBand
```

Esperado: los 14 en verde.

Si alguno falla diciendo que el mes no se publicó, vuelve al aviso del principio de la tarea: hay
otra API viva robando jobs.

- [ ] **Step 4: Correr TODOS los e2e**

```bash
cd /d/Dev/box-admin/apps/api && pnpm test:e2e
```

Esperado: los 133 anteriores + los 14 nuevos. Presta atención a los de `recurrencia`: son los que
tocan el planificador y los que notarían un cambio de contrato en el plan.

**Mensaje de commit sugerido para Cesar:**

```
test(api): e2e de los nueve puntos del checklist de la Fase 4

El turno nace etiquetado, el horario dado de alta tarde rellena los
huerfanos, la suplencia sobrevive a republicar, cada profesora ve solo
lo suyo, la clase ajena da 404, el filtro del calendario funciona, los
dos solapes dan 409, la liquidacion separa cerradas de contratadas y
pasar lista es idempotente.
```

---

## Task 14: Verificación final, README y tracker

**Files:**
- Modificar: `README.md`
- Modificar: `docs/superpowers/plans/PROGRESO.md`

- [ ] **Step 1: Verificación completa**

```bash
cd /d/Dev/box-admin/packages/shared && pnpm exec jest
cd ../../apps/api && pnpm exec tsc --noEmit && pnpm test && pnpm test:e2e
cd ../web && pnpm typecheck && pnpm test
cd /d/Dev/box-admin && pnpm exec prettier --check "apps/api/src/horarios-profesor/**/*.ts" "apps/api/src/mis-clases/**/*.ts" "apps/api/src/liquidacion/**/*.ts" "apps/api/test/profesor.e2e-spec.ts" "packages/shared/src/profesor.contracts.ts"
```

Esperado: todo verde y el formato limpio en lo que escribió esta fase.

⚠️ **La PWA de la Fase 3B no debería notar nada**: usa `TurnoDisponible` y `MiClase`, no
`TurnoPublico`. Si `pnpm typecheck` de `apps/web` falla, es que algún contrato compartido se amplió
de más.

- [ ] **Step 2: Comprobar el estado de git**

```bash
cd /d/Dev/box-admin && git diff --cached --stat
git status --short | grep -E "node_modules|\.next/|sw\.js" || echo "sin artefactos de build sin seguir"
```

Esperado: índice vacío y ningún artefacto suelto.

- [ ] **Step 3: Recorrer el checklist a mano**

Levanta la base, Redis y la API, y recorre los siete puntos del §5 del PDF con `curl` o con el
cliente que prefieras. En las cuatro fases anteriores es donde aparecieron las sorpresas que ningún
test había visto: el pack que no se elegía, el CORS del comprobante, la lista de espera apagada por
defecto.

```bash
cd /d/Dev/box-admin && docker compose up -d postgres postgres-test redis
cd apps/api && pnpm start:dev
```

Comprueba en particular, que son las dos cosas que ningún unitario puede ver:

- Que **el nombre del turno no cambia** al asignar profesora. Es el criterio de éxito literal del
  PDF: "sin tocar el nombre de la actividad".
- Que la liquidación de una profesora **sin ningún horario** devuelve ceros y una lista vacía, no un
  500. Es el caso que se da el primer día de uso real.

Anota el resultado de cada punto: es lo que va en el tracker.

- [ ] **Step 4: Documentar en el README**

Añade una sección "El profesor — Fase 4" antes de `## Tests` con:

- Qué resuelve: el vínculo profesora↔horario deja de ser un trozo del nombre de la actividad.
- **Que el horario no crea turnos, solo los etiqueta**, y por qué: es lo que hace que "contratadas
  vs. dictadas" signifique algo.
- **Que el motor solo rellena huecos**, y que por eso la suplencia sobrevive a republicar el mes.
- Los dos solapes que rechaza el alta, con un ejemplo de cada uno.
- Que asignar una profesora exige que tenga acceso a la sala, y por qué.
- Que pasar lista es una foto del turno entero, y que las canceladas no se tocan.
- Que la liquidación **no devuelve importes** y que la tarifa viaja resuelta para la Fase 6.
- Que un feriado no suma a horas contratadas.

- [ ] **Step 5: Actualizar el tracker**

En `docs/superpowers/plans/PROGRESO.md`, añade el bloque de la Fase 4 siguiendo el formato de los
anteriores: las 15 tareas marcadas, las seis decisiones cerradas, la tabla del checklist verificada a
mano, **los errores de este plan que encontraste al ejecutarlo** —los hubo en las cuatro fases
anteriores, sin excepción— y las trampas de entorno nuevas.

Anota también lo que esta fase deja declarado:

- **No se puede expresar "esta franja tiene patrón pero quiero que quede sin profesora"**: límite
  aceptado de D4.
- **La liquidación no multiplica**: importes, ajustes y el "50% base" son de la Fase 6.
- **No hay pantalla de profesora**: la PWA de la 3B es solo del alumno, y ninguna fase pide otra. Las
  tres rutas quedan listas para cuando se pida.

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

⚠️ **No edites archivos del repositorio con scripts de Python en modo texto.** En la Fase 3A eso
convirtió un archivo entero de LF a CRLF, y `core.autocrlf=true` lo ocultó en `git diff` mientras
Prettier lo veía perfectamente. Si tienes que escribir desde Python, abre en `'wb'`.

**Mensaje de commit sugerido para Cesar:**

```
docs: el profesor real en el README y el estado en el tracker
```

---

## Verificación del plan contra la spec

| Sección de la spec | Tarea |
|---|---|
| D1 — El horario solo etiqueta | T2 (función pura), T7 (planificador) |
| D2 — `Reserva.asistio` | T0 (schema), T10 (pasar lista) |
| D3 — Horas y tarifa resuelta, sin multiplicar | T11 (función pura), T12 (endpoint) |
| D4 — Solo rellena huecos | T7 (planificador), T8 (aplicador) |
| D5 — Los dos solapes | T3 (servicio) |
| D6 — El día cerrado no cuenta | T11 (función pura) |
| §4.1 — Lo puro y lo que toca la base | T2, T11 |
| §4.2 — Dónde se engancha el etiquetado | T6 (alta manual), T7, T8 |
| §5 — Modelo de datos | T0 |
| §6 — Los nueve endpoints | T3, T4, T5, T9, T10, T12 |
| §6.1 — La baja no reescribe el pasado | T3 (`eliminar`), T12 (el cargador no filtra por `activo`) |
| §6.2 — `PATCH /turnos/:id/profesor` | T4 |
| §6.3 — `GET /turnos` con profesora y filtro | T5 |
| §7 — El aislamiento de la profesora | T9 (vista), T3 y T4 (la puerta de la sala) |
| §7.1 — Qué ve de cada alumna | T9 |
| §7.2 — La ventana para pasar lista | T10 |
| §8 — Cómo se cuentan las horas | T11 |
| §9 — Pruebas y mutación | T2, T3, T7, T9, T11 (las mutaciones), T13 (e2e) |
| §10 — Checklist de aceptación | T13 |
| §11 — Fuera de alcance | T14 (declarado en el tracker) |

### Las cinco mutaciones obligatorias

Son los cinco sitios donde un test puede pasar sin probar nada. Cada una tiene su paso en el plan:

| # | Qué se muta | Tarea | Test que debe romperse |
|---|---|---|---|
| 1 | `< 0` → `<= 0` en la contención horaria | T2 | `el final de la franja NO le pertenece` |
| 2 | El rango de fechas del solape → siempre cruza | T3 | `deja pasar el relevo` |
| 3 | Quitar `if (turno.profesorId !== null) continue` | T7 | `un turno que YA TIENE profesora no se toca` |
| 4 | Quitar `profesorId: perfil.id` del where | T9 | `devuelve solo las clases propias` |
| 5 | `contratada && !cerrada` → `contratada` | T11 | `un feriado no suma a contratadas` |

La 3 es la más importante: si pasa, la suplencia se pierde en silencio cada vez que alguien
republique el mes.
