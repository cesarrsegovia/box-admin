# Fase 6A — Analítica: plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development` (recomendado) o
> `superpowers:executing-plans` para ejecutar este plan tarea por tarea. Los pasos usan checkbox
> (`- [ ]`) para seguimiento.

**Spec:** `docs/superpowers/specs/2026-10-01-fase6a-analitica.md`

**Objetivo:** siete reportes de solo lectura sobre datos que ya existen, con la liquidación de
profesoras calculada en pesos y un caché que no muestre números viejos después de cobrar.

**Arquitectura:** un módulo `src/stats/` de solo lectura con la misma separación que el resto del
proyecto: funciones puras para el cálculo, un archivo de datos para las consultas, un service que
orquesta, y el caché como capa fina por encima. La liquidación **no estrena endpoint**: se le suman
los importes al `GET /liquidacion/:profesorId` que la Fase 4 ya dejó funcionando.

**Stack:** NestJS 10, Prisma 7 + PostgreSQL, `ioredis` (ya es dependencia, la usa BullMQ), Jest.

---

## Reglas que gobiernan todo este plan

Son las que esta fase hereda y las que no se negocian en ninguna tarea.

**El dinero se calcula en centavos enteros.** Nada de coma flotante y nada de librería decimal. La
tarifa llega como string con dos decimales desde la Fase 4, se convierte a centavos, y el importe es
`minutos × tarifaCentavos / 60`. La única operación inexacta es la división, y ahí se redondea una
sola vez, con aritmética entera, media unidad hacia arriba.

**Se agrupa por tarifa antes de multiplicar.** Redondear por franja y después sumar acumula error. La
diferencia se la lleva una persona.

**Solo se pagan las dictadas.** Las contratadas sin turno y las cerradas por feriado se calculan y se
muestran, pero no entran en el total a pagar.

**El denominador de la asistencia son las reservas de turnos donde alguien pasó lista**, no todas las
reservas. "No se pasó lista" no es "no vino nadie".

**Esta fase no agrega ni una tabla a Prisma.** Si algún reporte parece necesitarla, es señal de que
está inventando un dato en vez de leerlo. Parar y preguntar.

---

## Estructura de archivos

```
packages/shared/src/
  dinero.contracts.ts            CREAR  Importe: centavos + texto
  profesor.contracts.ts          TOCAR  LiquidacionProfesor gana `importes`
  stats.contracts.ts             CREAR  los contratos de los siete reportes
  index.ts                       TOCAR  reexportar los dos nuevos

apps/api/src/liquidacion/
  calcular-importes.ts           CREAR  PURA. El dinero.
  calcular-importes.spec.ts      CREAR  tabla de casos
  calcular-liquidacion.ts        TOCAR  llama a calcularImportes al final

apps/api/src/stats/
  cache-de-stats.ts              CREAR  contador de version + get/set + TTL
  cache-de-stats.spec.ts         CREAR
  stats.datos.ts                 CREAR  las consultas, sin logica
  stats.service.ts               CREAR  orquesta: cache -> datos -> calculo
  stats.service.spec.ts          CREAR
  stats.controller.ts            CREAR
  stats.module.ts                CREAR
  dto/consulta-mensual.dto.ts    CREAR  mes, anio, salaId
  dto/consulta-rango.dto.ts      CREAR  desde, hasta, perfilId

apps/api/src/pagos/pagos.service.ts            TOCAR  invalidar
apps/api/src/reservas/reservas.service.ts      TOCAR  invalidar
apps/api/src/mis-clases/mis-clases.service.ts  TOCAR  invalidar
apps/api/src/app.module.ts                     TOCAR  StatsModule

apps/api/test/stats.e2e-spec.ts  CREAR
```

**Por qué `calcular-importes.ts` vive en `src/liquidacion/` y no en `src/stats/`:** es el mismo dominio
que `calcular-liquidacion.ts` y cambian juntos. Y al llamarlo desde la propia funcion pura, **todo el
que pida una liquidacion recibe sus importes**, sin que ningun service tenga que acordarse de
sumarlos.

**Por qué es una función pura y no un método del service:** es lo único de la fase que determina lo
que cobra una persona. Separada y pura se prueba con una tabla de casos; dentro del service habría que
levantar una aplicación para probar un redondeo.

---

## Task 0: Los contratos compartidos

**Files:**
- Crear: `packages/shared/src/dinero.contracts.ts`
- Crear: `packages/shared/src/stats.contracts.ts`
- Modificar: `packages/shared/src/profesor.contracts.ts`, `packages/shared/src/index.ts`

- [ ] **Step 1: El contrato del dinero**

Crear `packages/shared/src/dinero.contracts.ts`:

```ts
/**
 * Un importe, en centavos enteros y en texto.
 *
 * `centavos` es la verdad: entero, exacto, sumable sin sorpresas. `texto` es
 * una comodidad para mostrar, con dos decimales y punto como separador. Mismo
 * criterio que `minutos` y `horas` en la liquidacion de la Fase 4: el entero
 * manda y el string derivado acompana.
 *
 * NO existe un campo `numero` con el importe en pesos como float. Es
 * deliberado: un float de dinero es una suma mal hecha esperando a ocurrir, y
 * tenerlo disponible garantiza que alguien lo use.
 */
export interface Importe {
  centavos: number;
  /** Dos decimales siempre, p. ej. `"1250.00"`. */
  texto: string;
}
```

- [ ] **Step 2: Ampliar el contrato de la liquidación**

En `packages/shared/src/profesor.contracts.ts`, al principio:

```ts
import type { Importe } from './dinero.contracts';
```

Y antes de `LiquidacionProfesor`:

```ts
/**
 * Lo que cuesta una liquidacion, por grupo de horas.
 *
 * Los tres grupos se calculan SIEMPRE, pero solo `dictadas` se paga: es la
 * decision de la Fase 6A, tomada con Cesar. Los otros dos viajan porque son la
 * conversacion que el admin va a tener con la profesora, y porque esconderlos
 * obligaria a recalcularlos a mano.
 */
export interface ImportesDeLiquidacion {
  dictadas: Importe;
  contratadasSinDictar: Importe;
  cerradas: Importe;
  /** Lo que se paga. Hoy es exactamente `dictadas`. */
  aPagar: Importe;
  /**
   * Minutos que NO entraron en ningun importe porque su franja no tenia tarifa
   * ni propia ni del gimnasio.
   *
   * Va en el contrato en vez de ignorarse en silencio: un importe al que le
   * faltan horas y no lo dice es un numero que parece completo y no lo esta.
   * Mayor que cero significa "falta configurar una tarifa", no "trabajo menos".
   */
  minutosSinTarifa: number;
}
```

Y dentro de `LiquidacionProfesor`, después de `franjas`:

```ts
  importes: ImportesDeLiquidacion;
```

- [ ] **Step 3: Los contratos de los reportes**

Crear `packages/shared/src/stats.contracts.ts`:

```ts
import type { Importe } from './dinero.contracts';

/** Un metodo de pago con lo que entro por el. */
export interface CobradoPorMetodo {
  metodo: string;
  importe: Importe;
}

/**
 * La caja de un mes.
 *
 * `cobrado` EXCLUYE las cortesias y `bonificado` las junta aparte. Una cortesia
 * es un metodo de pago normal y nada obliga a que su monto sea cero: sumarla al
 * cobrado haria que un mes en el que el gimnasio regalo cuotas apareciera como
 * facturacion.
 *
 * OJO CON LAS BASES, y esta escrito aqui a proposito: `cobrado` es CAJA —se
 * cuenta por `Pago.createdAt`, cuando entro el dinero— y `costoProfesoras` es
 * DEVENGADO —las clases de ese mes—. Un alumno que paga octubre el 28 de
 * septiembre entra en la caja de septiembre. Es la base correcta para "cuanto
 * entro este mes", pero el margen de un mes concreto puede verse raro si
 * alguien cobra muy adelantado.
 */
export interface CajaDelMes {
  anio: number;
  mes: number;
  cobrado: Importe;
  porMetodo: CobradoPorMetodo[];
  bonificado: Importe;
  costoProfesoras: Importe;
  margen: Importe;
  pendienteEstimado: Importe;
}

/**
 * Un porcentaje con su fraccion a la vista.
 *
 * El numerador y el denominador viajan SIEMPRE. Sin ellos, un 0% y un "no hay
 * datos" se ven igual, y son cosas distintas: `denominador: 0` significa que la
 * pregunta no se puede contestar, no que la respuesta sea cero.
 */
export interface Porcentaje {
  numerador: number;
  denominador: number;
  /** `null` cuando el denominador es cero. */
  porcentaje: number | null;
}

export interface MetricasOperativas {
  anio: number;
  mes: number;
  ocupacion: Porcentaje;
  /** Denominador: reservas de turnos donde SE PASO LISTA. Ver la spec, 6. */
  asistencia: Porcentaje;
  cobranza: Porcentaje;
  cancelacionRecuperable: Porcentaje;
  cancelacionDefinitiva: Porcentaje;
}

export interface Operativo {
  actual: MetricasOperativas;
  /** Los tres meses anteriores, del mas viejo al mas nuevo. */
  trimestre: MetricasOperativas[];
}

export interface TurnoLibre {
  turnoId: string;
  salaId: string;
  salaNombre: string;
  /** `YYYY-MM-DD`. */
  fecha: string;
  horaInicio: string;
  horaFin: string;
  cupo: number;
  reservados: number;
  libres: number;
}

export interface PagoPendiente {
  perfilId: string;
  nombreCompleto: string;
  email: string;
  packNombre: string | null;
  /**
   * El precio del pack. Es un ESTIMADO y por eso se llama asi: el sistema no
   * lleva cuenta corriente, asi que esto es lo que costaria ponerse al dia con
   * un pack, no una deuda calculada.
   */
  pendienteEstimado: Importe;
  cancelacionesDelMes: number;
}

export interface ComposicionPorPack {
  packId: string | null;
  packNombre: string;
  alumnos: number;
  porcentaje: number;
}

export interface ConsumoDeAlumno {
  perfilId: string;
  nombreCompleto: string;
  /** Reservas vivas del mes. Derivado, como desde la Fase 1. */
  clasesTomadas: number;
}

export interface ComposicionAlumnos {
  anio: number;
  mes: number;
  totalAlumnos: number;
  porPack: ComposicionPorPack[];
  consumo: ConsumoDeAlumno[];
}

export interface AsistenciaDeAlumno {
  perfilId: string;
  nombreCompleto: string;
  presentes: number;
  ausentes: number;
  /** `null` si no se le paso lista ni una vez en el rango. */
  porcentaje: number | null;
}

export interface ReporteAsistencia {
  desde: string;
  hasta: string;
  alumnos: AsistenciaDeAlumno[];
}
```

- [ ] **Step 4: Reexportar**

En `packages/shared/src/index.ts`, junto a los demás:

```ts
export * from './dinero.contracts';
export * from './stats.contracts';
```

- [ ] **Step 5: Correr**

```bash
cd /d/Dev/box-admin/packages/shared && pnpm exec tsc -p tsconfig.json --noEmit
```

Esperado: limpio. Todavía no compila `apps/api`, porque `LiquidacionProfesor` ahora exige `importes` y
nadie lo pone: eso lo arregla la Task 2. **Es correcto que falle ahí y no antes.**

**Mensaje de commit sugerido para Cesar:**

```
feat(shared): contratos de la analitica y del dinero

Importe lleva centavos enteros y su texto, sin un campo float: un float
de dinero es una suma mal hecha esperando a ocurrir, y tenerlo
disponible garantiza que alguien lo use.

Porcentaje lleva numerador y denominador a la vista. Sin ellos, un 0% y
un "no hay datos" se ven igual.
```

---

## Task 1: `calcularImportes`, la función pura

**Files:**
- Crear: `apps/api/src/liquidacion/calcular-importes.ts` · `.spec.ts`

Es la tarea más sensible del plan. Todo lo demás son consultas.

- [ ] **Step 1: El test, primero y entero**

Crear `apps/api/src/liquidacion/calcular-importes.spec.ts`:

```ts
import type { FranjaDeLiquidacion } from '@boxadmin/shared';
import { calcularImportes } from './calcular-importes';

function franja(parcial: Partial<FranjaDeLiquidacion>): FranjaDeLiquidacion {
  return {
    fecha: '2026-10-05',
    salaId: 'sala-1',
    horaInicio: '10:00',
    horaFin: '11:00',
    minutos: 60,
    contratada: true,
    dictada: true,
    cerrada: false,
    motivoCierre: null,
    turnoId: 'turno-1',
    tarifaPorHora: '1000.00',
    origenTarifa: 'HORARIO',
    ...parcial,
  };
}

describe('calcularImportes', () => {
  it('una hora a mil pesos son mil pesos', () => {
    const r = calcularImportes([franja({})]);

    expect(r.dictadas.centavos).toBe(100_000);
    expect(r.dictadas.texto).toBe('1000.00');
    expect(r.aPagar.centavos).toBe(100_000);
  });

  it('redondea media unidad hacia arriba', () => {
    // 50 minutos a 1000.00 = 50 * 100000 / 60 = 83333.33 centavos
    const r = calcularImportes([franja({ minutos: 50 })]);

    expect(r.dictadas.centavos).toBe(83_333);
  });

  it('redondea hacia arriba cuando la mitad es exacta', () => {
    // 30 minutos a 0.01 la hora = 30 * 1 / 60 = 0.5 centavos -> 1
    const r = calcularImportes([franja({ minutos: 30, tarifaPorHora: '0.01' })]);

    expect(r.dictadas.centavos).toBe(1);
  });

  /**
   * EL CASO QUE JUSTIFICA AGRUPAR.
   *
   * Tres franjas de 50 minutos a la misma tarifa. Redondeando cada una:
   * 83333 x 3 = 249999. Sumando los minutos primero: 150 * 100000 / 60 =
   * 250000 exacto. Un centavo de diferencia, y se lo lleva una persona.
   */
  it('agrupa por tarifa ANTES de multiplicar, no despues', () => {
    const r = calcularImportes([
      franja({ minutos: 50 }),
      franja({ minutos: 50 }),
      franja({ minutos: 50 }),
    ]);

    expect(r.dictadas.centavos).toBe(250_000);
  });

  it('con dos tarifas distintas, cada grupo se redondea por separado', () => {
    const r = calcularImportes([
      franja({ minutos: 50, tarifaPorHora: '1000.00' }),
      franja({ minutos: 50, tarifaPorHora: '2000.00' }),
    ]);

    // 83333 + 166667 = 250000
    expect(r.dictadas.centavos).toBe(250_000);
  });

  it('las contratadas sin dictar se calculan pero NO se pagan', () => {
    const r = calcularImportes([franja({ dictada: false })]);

    expect(r.contratadasSinDictar.centavos).toBe(100_000);
    expect(r.dictadas.centavos).toBe(0);
    expect(r.aPagar.centavos).toBe(0);
  });

  it('las cerradas se calculan pero NO se pagan', () => {
    const r = calcularImportes([
      franja({ contratada: true, dictada: false, cerrada: true, motivoCierre: 'Feriado' }),
    ]);

    expect(r.cerradas.centavos).toBe(100_000);
    expect(r.aPagar.centavos).toBe(0);
  });

  it('una suplencia sin contrato se paga igual: fue dictada', () => {
    const r = calcularImportes([franja({ contratada: false, dictada: true })]);

    expect(r.dictadas.centavos).toBe(100_000);
    expect(r.aPagar.centavos).toBe(100_000);
    expect(r.contratadasSinDictar.centavos).toBe(0);
  });

  it('una franja sin tarifa no suma importe, y sus minutos se reportan', () => {
    const r = calcularImportes([
      franja({ minutos: 60 }),
      franja({ minutos: 90, tarifaPorHora: null, origenTarifa: null }),
    ]);

    expect(r.dictadas.centavos).toBe(100_000);
    expect(r.minutosSinTarifa).toBe(90);
  });

  it('sin franjas, todo en cero y sin minutos sueltos', () => {
    const r = calcularImportes([]);

    expect(r.aPagar.centavos).toBe(0);
    expect(r.aPagar.texto).toBe('0.00');
    expect(r.minutosSinTarifa).toBe(0);
  });

  it('una tarifa con centavos no se pierde en el camino', () => {
    const r = calcularImportes([franja({ minutos: 60, tarifaPorHora: '1234.56' })]);

    expect(r.dictadas.centavos).toBe(123_456);
    expect(r.dictadas.texto).toBe('1234.56');
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/liquidacion/calcular-importes --silent
```

Esperado: falla con `Cannot find module './calcular-importes'`.

- [ ] **Step 3: La implementación**

Crear `apps/api/src/liquidacion/calcular-importes.ts`:

```ts
import type { FranjaDeLiquidacion, Importe, ImportesDeLiquidacion } from '@boxadmin/shared';

const MINUTOS_POR_HORA = 60;

/**
 * El importe de una liquidacion, en centavos enteros.
 *
 * PURA: ni una query, ni una fecha, ni un `new Date()`. Recibe las franjas que
 * `calcularLiquidacion` ya produjo —con la tarifa RESUELTA por franja, que es
 * justo lo que la Fase 4 dejo preparado— y multiplica.
 *
 * ---
 *
 * POR QUE CENTAVOS ENTEROS Y NO UNA LIBRERIA DECIMAL. Los ordenes de magnitud
 * de este dominio —unos diez mil minutos al mes, tarifas de hasta ocho digitos—
 * dejan el producto `minutos x tarifaCentavos` muy por debajo de
 * Number.MAX_SAFE_INTEGER, asi que la multiplicacion es EXACTA con enteros
 * nativos. Lo unico inexacto es dividir por 60, y eso se hace con aritmetica
 * entera unas lineas mas abajo, sin pasar por un float en ningun momento.
 *
 * POR QUE SE AGRUPA POR TARIFA. Redondear cada franja y despues sumar acumula
 * el error; sumar los minutos de cada tarifa y multiplicar una vez, no. Tres
 * franjas de cincuenta minutos a mil pesos dan 249999 centavos redondeando
 * cada una y 250000 redondeando al final. El centavo se lo lleva una persona, y
 * por eso hay un test que fija exactamente ese caso.
 *
 * POR QUE SOLO SE PAGAN LAS DICTADAS. Decision tomada con Cesar en la spec: la
 * profesora cobra por hora dictada a tarifa fija. Las contratadas sin turno y
 * las cerradas por feriado se calculan igual porque son la conversacion que el
 * admin va a tener con ella, pero no entran en `aPagar`.
 */
export function calcularImportes(franjas: FranjaDeLiquidacion[]): ImportesDeLiquidacion {
  const dictadas = importeDe(franjas, (f) => f.dictada);
  const contratadasSinDictar = importeDe(franjas, (f) => f.contratada && !f.dictada && !f.cerrada);
  const cerradas = importeDe(franjas, (f) => f.cerrada);

  return {
    dictadas,
    contratadasSinDictar,
    cerradas,
    // `aPagar` es una copia de `dictadas` y no una referencia al mismo objeto:
    // si manana la regla cambia —un porcentaje, un piso—, el cambio es aqui y
    // no hay que desenredar dos campos que apuntaban a lo mismo.
    aPagar: { ...dictadas },
    minutosSinTarifa: franjas
      .filter((f) => f.dictada && f.tarifaPorHora === null)
      .reduce((total, f) => total + f.minutos, 0),
  };
}

function importeDe(
  franjas: FranjaDeLiquidacion[],
  incluye: (f: FranjaDeLiquidacion) => boolean,
): Importe {
  const minutosPorTarifa = new Map<string, number>();

  for (const franja of franjas) {
    if (!incluye(franja)) continue;
    // Sin tarifa no hay importe que calcular. Los minutos no se pierden: los
    // cuenta `minutosSinTarifa`, para que el total diga que esta incompleto.
    if (franja.tarifaPorHora === null) continue;

    const acumulado = minutosPorTarifa.get(franja.tarifaPorHora) ?? 0;
    minutosPorTarifa.set(franja.tarifaPorHora, acumulado + franja.minutos);
  }

  let centavos = 0;
  for (const [tarifa, minutos] of minutosPorTarifa) {
    centavos += dividirRedondeando(minutos * aCentavos(tarifa), MINUTOS_POR_HORA);
  }

  return { centavos, texto: aTexto(centavos) };
}

/**
 * Division entera con redondeo de media unidad HACIA ARRIBA.
 *
 * Entera de punta a punta: no se divide con `/` y se redondea despues, porque
 * entonces el resultado depende de un float intermedio. Aqui el cociente y el
 * resto son enteros exactos y la comparacion `resto * 2 >= divisor` decide sin
 * ambiguedad. Los importes son siempre positivos, asi que no hace falta pensar
 * en como redondea el negativo.
 */
function dividirRedondeando(dividendo: number, divisor: number): number {
  const cociente = Math.floor(dividendo / divisor);
  const resto = dividendo - cociente * divisor;

  return resto * 2 >= divisor ? cociente + 1 : cociente;
}

/** `"1234.56"` -> `123456`. La tarifa viene validada con dos decimales como mucho. */
function aCentavos(tarifa: string): number {
  const [enteros, decimales = ''] = tarifa.split('.');

  return Number(enteros) * 100 + Number(decimales.padEnd(2, '0'));
}

/** `123456` -> `"1234.56"`. */
function aTexto(centavos: number): string {
  const enteros = Math.floor(centavos / 100);
  const resto = centavos - enteros * 100;

  return `${enteros}.${String(resto).padStart(2, '0')}`;
}
```

- [ ] **Step 4: Correr**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/liquidacion/calcular-importes --silent
```

Esperado: 11 en verde.

- [ ] **Step 5: Las mutaciones**

Corré cada una, anotá el resultado textual, y **restaurá el archivo después de cada una**. Dejá un
respaldo byte a byte en el scratchpad antes de empezar y verificá el md5 al restaurar.

| Mutación | Tiene que caer |
|---|---|
| Redondear por franja: mover `dividirRedondeando` dentro del bucle del `for` de franjas | `agrupa por tarifa ANTES de multiplicar` |
| `resto * 2 > divisor` (redondeo hacia abajo en la mitad exacta) | `redondea hacia arriba cuando la mitad es exacta` |
| `aPagar: { ...dictadas, centavos: dictadas.centavos + contratadasSinDictar.centavos }` | `las contratadas sin dictar se calculan pero NO se pagan` |
| Quitar el `if (franja.tarifaPorHora === null) continue;` | la suite no compila, o cae el caso de la tarifa nula |
| `incluye` de `contratadasSinDictar` sin el `&& !f.cerrada` | `las cerradas se calculan pero NO se pagan` |

⚠️ **No uses `if (false && ...)` para neutralizar**: TypeScript no estrecha tipos dentro de una
expresión que ya sabe inalcanzable y la suite deja de compilar (`TS18047`). Borrá el término o el
bloque entero, que además es la mutación honesta.

**Mensaje de commit sugerido para Cesar:**

```
feat(api): el calculo de importes de la liquidacion

Centavos enteros de punta a punta: la multiplicacion es exacta y la
unica division redondea con aritmetica entera, media unidad hacia
arriba, una sola vez.

Se agrupa por tarifa antes de multiplicar. Tres franjas de cincuenta
minutos dan 249999 centavos redondeando cada una y 250000 redondeando al
final; el centavo se lo lleva una persona.

Solo se pagan las dictadas. Las contratadas sin turno y las cerradas se
calculan igual porque son la conversacion con la profesora.
```

---

## Task 2: Los importes entran en la liquidación que ya existe

**Files:**
- Modificar: `apps/api/src/liquidacion/calcular-liquidacion.ts` · `calcular-liquidacion.spec.ts`

La Fase 4 dejó escrito que "la tarifa viaja ya resuelta para que la Fase 6 sólo tenga que multiplicar".
Esta tarea es esa línea.

- [ ] **Step 1: El test**

En `apps/api/src/liquidacion/calcular-liquidacion.spec.ts`, al final del `describe` principal:

```ts
  it('la liquidacion llega con sus importes ya calculados', () => {
    const r = calcularLiquidacion({
      profesorId: 'prof-1',
      profesorNombre: 'Ana',
      anio: 2026,
      mes: 10,
      horarios: [
        {
          salaId: 'sala-1',
          diaSemana: 1,
          horaInicio: '10:00',
          horaFin: '11:00',
          desde: new Date('2026-10-01T00:00:00.000Z'),
          hasta: null,
          tarifaPorHora: '1000.00',
        },
      ],
      turnos: [],
      ausencias: [],
      tarifaDelTenant: null,
    });

    // Sin turnos no hay dictadas, asi que no se paga nada; pero las contratadas
    // existen y su importe tiene que estar calculado igual.
    expect(r.importes.aPagar.centavos).toBe(0);
    expect(r.importes.contratadasSinDictar.centavos).toBeGreaterThan(0);
    expect(r.importes.minutosSinTarifa).toBe(0);
  });
```

⚠️ Si el spec ya tiene un ayudante para construir la entrada, usalo en vez de este objeto literal. Lo
que no se puede hacer es inventar un escenario distinto: el valor de `contratadasSinDictar` depende de
cuántos lunes tiene octubre de 2026.

- [ ] **Step 2: Correr y ver que falla**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/liquidacion/calcular-liquidacion --silent
```

Esperado: falla porque `importes` no existe en el objeto devuelto.

- [ ] **Step 3: Engancharlo**

En `calcular-liquidacion.ts`, añadir al principio:

```ts
import { calcularImportes } from './calcular-importes';
```

Y en el `return` de `calcularLiquidacion`, junto a `franjas`:

```ts
    importes: calcularImportes(franjas),
```

Y en el docblock de la función, donde dice que NO devuelve importes, reemplazar ese párrafo por:

```
 * DEVUELVE IMPORTES desde la Fase 6A. El calculo vive en `calcular-importes.ts`,
 * separado porque es lo unico que determina lo que cobra una persona y merece su
 * propia tabla de casos. Se llama desde aqui, y no desde un service, para que
 * TODO el que pida una liquidacion reciba sus importes sin acordarse de sumarlos.
```

- [ ] **Step 4: Correr**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/liquidacion --silent && pnpm exec tsc --noEmit
```

Esperado: todo verde y `tsc` limpio. Las aserciones de horas de la Fase 4 siguen pasando sin tocarlas:
ninguna fija el objeto entero, se comprobó antes de escribir este plan.

- [ ] **Step 5: El e2e existente**

```bash
cd /d/Dev/box-admin/apps/api && pnpm test:e2e 2>&1 | grep -E "^Tests: "
```

Esperado: el baseline intacto. `GET /liquidacion/:profesorId` ahora responde con un campo más.

**Mensaje de commit sugerido para Cesar:**

```
feat(api): la liquidacion llega con sus importes

Los calcula la propia funcion pura, no un service: asi todo el que pida
una liquidacion los recibe sin acordarse de sumarlos.

No estrena endpoint. GET /liquidacion/:profesorId existe desde la Fase 4
con su modulo entero y rol ADMIN_SALON; crear uno bajo /stats/ duplicaria
la carga de datos y dejaria dos endpoints respondiendo lo mismo.
```

---

## Task 3: El caché, con su contador de versión

**Files:**
- Crear: `apps/api/src/stats/cache-de-stats.ts` · `.spec.ts`

- [ ] **Step 1: El test, con el puerto que hace falta para escribirlo**

Crear `apps/api/src/stats/cache-de-stats.spec.ts`:

```ts
import { CacheDeStats, type ClienteDeCache } from './cache-de-stats';

function clienteFalso() {
  const datos = new Map<string, string>();

  const cliente: ClienteDeCache = {
    get: async (clave) => datos.get(clave) ?? null,
    set: async (clave, valor) => {
      datos.set(clave, valor);
    },
    incr: async (clave) => {
      const siguiente = Number(datos.get(clave) ?? '0') + 1;
      datos.set(clave, String(siguiente));
      return siguiente;
    },
  };

  return { cliente, datos };
}

describe('CacheDeStats', () => {
  it('la primera vez calcula, la segunda no', async () => {
    const { cliente } = clienteFalso();
    const cache = new CacheDeStats(cliente);
    const calcular = jest.fn().mockResolvedValue({ total: 7 });

    await cache.recordar('gym-1', 'caja:2026-10', calcular);
    const segundo = await cache.recordar('gym-1', 'caja:2026-10', calcular);

    expect(calcular).toHaveBeenCalledTimes(1);
    expect(segundo).toEqual({ total: 7 });
  });

  it('despues de invalidar, vuelve a calcular', async () => {
    const { cliente } = clienteFalso();
    const cache = new CacheDeStats(cliente);
    const calcular = jest.fn().mockResolvedValue({ total: 7 });

    await cache.recordar('gym-1', 'caja:2026-10', calcular);
    await cache.invalidar('gym-1');
    await cache.recordar('gym-1', 'caja:2026-10', calcular);

    expect(calcular).toHaveBeenCalledTimes(2);
  });

  it('invalidar un gimnasio NO tira el cache de otro', async () => {
    const { cliente } = clienteFalso();
    const cache = new CacheDeStats(cliente);
    const calcular = jest.fn().mockResolvedValue({ total: 7 });

    await cache.recordar('gym-1', 'caja:2026-10', calcular);
    await cache.recordar('gym-2', 'caja:2026-10', calcular);
    await cache.invalidar('gym-1');
    await cache.recordar('gym-2', 'caja:2026-10', calcular);

    // Una vez cada gimnasio, y gym-2 NO recalculo.
    expect(calcular).toHaveBeenCalledTimes(2);
  });

  it('dos reportes distintos del mismo gimnasio no se pisan', async () => {
    const { cliente } = clienteFalso();
    const cache = new CacheDeStats(cliente);

    const caja = await cache.recordar('gym-1', 'caja:2026-10', async () => 'la caja');
    const operativo = await cache.recordar('gym-1', 'operativo:2026-10', async () => 'lo operativo');

    expect(caja).toBe('la caja');
    expect(operativo).toBe('lo operativo');
  });

  it('si el cache falla al leer, el reporte sale igual', async () => {
    const roto: ClienteDeCache = {
      get: async () => {
        throw new Error('Redis caido');
      },
      set: async () => {},
      incr: async () => 1,
    };

    await expect(
      new CacheDeStats(roto).recordar('gym-1', 'caja', async () => ({ total: 7 })),
    ).resolves.toEqual({ total: 7 });
  });

  it('si el cache falla al escribir, el reporte sale igual', async () => {
    const roto: ClienteDeCache = {
      get: async () => null,
      set: async () => {
        throw new Error('Redis caido');
      },
      incr: async () => 1,
    };

    await expect(new CacheDeStats(roto).recordar('gym-1', 'caja', async () => 'ok')).resolves.toBe(
      'ok',
    );
  });

  // ESTE ES EL QUE PROTEGE UN COBRO: `invalidar` se llama DENTRO del servicio
  // que registra un pago. Si lanzara, un Redis caido convertiria un cobro
  // perfectamente valido en un 500.
  it('invalidar NUNCA lanza, aunque Redis este caido', async () => {
    const roto: ClienteDeCache = {
      get: async () => null,
      set: async () => {},
      incr: async () => {
        throw new Error('Redis caido');
      },
    };

    await expect(new CacheDeStats(roto).invalidar('gym-1')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/stats/cache-de-stats --silent
```

Esperado: `Cannot find module './cache-de-stats'`.

- [ ] **Step 3: La implementación**

Crear `apps/api/src/stats/cache-de-stats.ts`:

```ts
import { Inject, Injectable, Logger } from '@nestjs/common';

export const CLIENTE_DE_CACHE = Symbol('CLIENTE_DE_CACHE');

/**
 * Lo poco que este cache necesita de Redis.
 *
 * Es un puerto, como los de la Fase 5B: permite probar la logica entera sin
 * levantar un Redis, y deja a la vista que de toda la superficie de ioredis
 * aqui se usan exactamente tres metodos.
 */
export interface ClienteDeCache {
  get(clave: string): Promise<string | null>;
  set(clave: string, valor: string, modo: 'EX', segundos: number): Promise<unknown>;
  incr(clave: string): Promise<number>;
}

/** Cinco minutos. Los reportes no necesitan ser exactos al segundo. */
const TTL_SEGUNDOS = 300;

/**
 * El cache de los reportes: TTL corto mas un contador de version por gimnasio.
 *
 * POR QUE UN CONTADOR DE VERSION Y NO INVALIDACION DIRIGIDA. Con una lista de
 * claves a borrar en cada escritura, el dia que alguien agregue un reporte
 * nuevo se olvida de sumarlo a la lista y ese reporte queda permanentemente
 * desactualizado. Con el contador, un solo INCR deja huerfanas TODAS las claves
 * viejas de golpe: un reporte nuevo queda invalidado correctamente sin que
 * nadie lo recuerde. Invalida de mas —un pago tira tambien el cache de
 * ocupacion, que no cambio— y a esta escala eso no cuesta nada.
 *
 * LAS DOS DEFENSAS FALLAN HACIA EL MISMO LADO: el peor caso de olvidarse un
 * `invalidar` es llegar tarde cinco minutos, no quedar mal para siempre. El TTL
 * es la red del contador, y el contador es la precision que el TTL no da.
 *
 * NADA DE ESTO PUEDE ROMPER NADA. `recordar` calcula igual si Redis no
 * contesta: un panel que devuelve 500 porque el cache esta caido es peor que
 * uno lento. E `invalidar` NUNCA lanza, porque se llama dentro del servicio que
 * registra un pago y un Redis caido no puede convertir un cobro valido en un
 * 500 — el mismo invariante que el hook de notificaciones de la Fase 5B, y por
 * el mismo motivo.
 */
@Injectable()
export class CacheDeStats {
  private readonly logger = new Logger(CacheDeStats.name);

  constructor(@Inject(CLIENTE_DE_CACHE) private readonly cliente: ClienteDeCache) {}

  async recordar<T>(tenantId: string, clave: string, calcular: () => Promise<T>): Promise<T> {
    const completa = `stats:${tenantId}:v${await this.version(tenantId)}:${clave}`;

    try {
      const guardado = await this.cliente.get(completa);
      if (guardado !== null) return JSON.parse(guardado) as T;
    } catch (error) {
      this.logger.warn(`No se pudo leer el cache de ${tenantId}: ${String(error)}`);
    }

    const calculado = await calcular();

    try {
      await this.cliente.set(completa, JSON.stringify(calculado), 'EX', TTL_SEGUNDOS);
    } catch (error) {
      this.logger.warn(`No se pudo guardar el cache de ${tenantId}: ${String(error)}`);
    }

    return calculado;
  }

  /** Tira todo el cache de un gimnasio. NUNCA lanza: ver el comentario de la clase. */
  async invalidar(tenantId: string): Promise<void> {
    try {
      await this.cliente.incr(`stats:${tenantId}:version`);
    } catch (error) {
      this.logger.warn(`No se pudo invalidar el cache de ${tenantId}: ${String(error)}`);
    }
  }

  private async version(tenantId: string): Promise<string> {
    try {
      // Sin version todavia es la cero: nadie invalido nunca este gimnasio.
      return (await this.cliente.get(`stats:${tenantId}:version`)) ?? '0';
    } catch {
      // Sin poder leer la version no hay clave de confianza que construir. Se
      // devuelve una distinta cada vez para que el `get` siguiente falle en
      // vacio y se recalcule, en vez de servir algo de una version que no se
      // pudo comprobar.
      return `sin-version-${Date.now()}`;
    }
  }
}
```

- [ ] **Step 4: Correr**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/stats/cache-de-stats --silent
```

Esperado: 7 en verde.

- [ ] **Step 5: Las mutaciones**

| Mutación | Tiene que caer |
|---|---|
| Quitar el `v${await this.version(tenantId)}` de la clave | `despues de invalidar, vuelve a calcular` |
| Quitar el `tenantId` de la clave de versión (dejarla en `stats:version`) | `invalidar un gimnasio NO tira el cache de otro` |
| Quitar el `try/catch` de `invalidar` | `invalidar NUNCA lanza` |
| Quitar el `try/catch` del `get` | `si el cache falla al leer, el reporte sale igual` |
| Quitar la `clave` del nombre completo | `dos reportes distintos del mismo gimnasio no se pisan` |

⚠️ **No uses `if (false && ...)` para neutralizar**: TypeScript no estrecha tipos dentro de una
expresión inalcanzable y la suite deja de compilar (`TS18047`). Borrá el término o el bloque entero.

**Mensaje de commit sugerido para Cesar:**

```
feat(api): cache de estadisticas con contador de version

Un INCR por gimnasio deja huerfanas todas sus claves de golpe, asi que un
reporte nuevo queda invalidado sin que nadie se acuerde de sumarlo a una
lista. El TTL de cinco minutos es la red: olvidarse un invalidar cuesta
cinco minutos de atraso, no un reporte mal para siempre.

Ni leer ni escribir el cache puede romper un reporte, e invalidar nunca
lanza: se llama dentro del servicio que registra un pago, y un Redis
caido no puede convertir un cobro valido en un 500.
```

---

## Task 4: `/stats/caja`

⚠️ **CORREGIDO DURANTE LA EJECUCIÓN: la caja NO lleva `salaId`.** Un `Pago` no tiene sala. Repartirlo
entre salas sería exactamente la regla de atribución de ingresos que la §3 de la spec descartó por
contar el mismo peso más de una vez, y acotar sólo el costo de profesoras —que sí sabe de salas— daría
un `margen` que resta el costo de una sala a lo cobrado de todas. Aceptar el parámetro e ignorarlo es
peor que no tenerlo: **es una mentira con código 200**, porque alguien lo pasa, recibe un número y cree
que es de esa sala. `/stats/operativo` sí lo lleva, y ahí es limpio porque los turnos tienen sala.

**Files:**
- Crear: `apps/api/src/stats/stats.datos.ts`, `stats.service.ts` · `.spec.ts`, `stats.controller.ts`,
  `stats.module.ts`, `dto/consulta-mensual.dto.ts`
- Modificar: `apps/api/src/app.module.ts`

⚠️ **`Pago.monto` es un `Decimal` de Prisma. NUNCA uses `.toNumber()`**: pasa el importe por un float y
es exactamente lo que este plan evita en todos lados. Se convierte con `monto.toFixed(2)`, que da el
string con dos decimales, y de ahí a centavos con el mismo criterio que `calcular-importes.ts`.

Para no duplicar la conversión, **exportá `aCentavos` y `aTexto`** desde `calcular-importes.ts` y
usalos acá. Son las dos funciones que definen qué es un importe en este sistema; tener una segunda
copia garantiza que algún día difieran.

- [ ] **Step 1: El DTO**

Crear `apps/api/src/stats/dto/consulta-mensual.dto.ts`:

```ts
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ConsultaMensualDto {
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2200)
  anio!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  mes!: number;

  @IsOptional()
  @IsString()
  salaId?: string;
}
```

- [ ] **Step 2: El doble de Prisma que usan TODAS las tareas de stats**

Se define una sola vez, en `apps/api/src/stats/stats.service.spec.ts`, y las Tasks 6, 7 y 8 lo
reutilizan. Tener un doble por tarea garantizaria que acaben filtrando distinto.

```ts
interface Tablas {
  pagos: { id: string; perfilId: string; monto: string; metodo: string;
           anuladoEn: Date | null; createdAt: Date; cubreDesde: Date; cubreHasta: Date }[];
  turnos: { id: string; salaId: string; fecha: Date; horaInicio: string; horaFin: string; cupo: number }[];
  reservas: { id: string; turnoId: string; perfilId: string;
              canceladaEn: Date | null; cancelacionTipo: string | null; asistio: boolean | null }[];
  perfiles: { id: string; packId: string | null; nombreCompleto: string; email: string }[];
  packs: { id: string; nombre: string; precio: string | null }[];
}

/**
 * Filtra de verdad: compara campo a campo e implementa `gte`/`lte`/`not`, que
 * es lo minimo para que los tests de rango prueben algo. Un doble que devuelve
 * siempre la tabla entera deja pasar cualquier error de `where`.
 */
function prismaFalso(tablas: Tablas) {
  const cumple = (fila: Record<string, unknown>, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([campo, esperado]) => {
      const valor = fila[campo];
      if (esperado !== null && typeof esperado === 'object') {
        const op = esperado as { gte?: unknown; lte?: unknown; not?: unknown };
        if (op.gte !== undefined && !(Number(valor) >= Number(op.gte))) return false;
        if (op.lte !== undefined && !(Number(valor) <= Number(op.lte))) return false;
        if (op.not !== undefined && valor === op.not) return false;
        return true;
      }
      return valor === esperado;
    });

  const tabla = <T extends Record<string, unknown>>(filas: T[]) => ({
    findMany: async ({ where = {} }: { where?: Record<string, unknown> } = {}) =>
      filas.filter((f) => cumple(f, where)),
  });

  return {
    pago: tabla(tablas.pagos),
    turno: tabla(tablas.turnos),
    reserva: tabla(tablas.reservas),
    perfil: tabla(tablas.perfiles),
    pack: tabla(tablas.packs),
  };
}
```

⚠️ **El `where` se compara campo a campo, asi que un filtro que el service no mande no se nota.** Por
eso cada tarea trae una mutacion que quita un termino del `where`: es lo unico que prueba que el
termino estaba.

- [ ] **Step 3: El test del service**

Crear `apps/api/src/stats/stats.service.spec.ts` con un doble de `StatsDatos` y otro de
`CacheDeStats`. Los casos:

```ts
  it('las cortesias NO entran en el cobrado, van al bonificado', async () => {
    // Dos pagos: uno de 1000 por transferencia, una cortesia de 500.
    // cobrado = 1000.00, bonificado = 500.00
  });

  it('el margen es cobrado menos costo de profesoras', async () => {
    // cobrado 1000.00, costo 400.00 -> margen 600.00
  });

  it('desglosa el cobrado por metodo, sin la cortesia', async () => {
    // porMetodo trae EFECTIVO y TRANSFERENCIA, nunca CORTESIA
  });

  it('un pago anulado no cuenta', async () => {
    // el doble devuelve solo los no anulados: se comprueba que el `where`
    // pedido lleva `anuladoEn: null`
  });

  it('un mes sin movimiento devuelve ceros, no revienta', async () => {
    // cobrado "0.00", margen negativo si hubo costo
  });
```

Escribí los cinco completos siguiendo el estilo de `pagos.service.spec.ts`, que ya tiene un doble de
Prisma que filtra de verdad.

- [ ] **Step 4: Los datos**

Crear `apps/api/src/stats/stats.datos.ts`. Solo consultas, sin lógica de negocio:

```ts
  /** Pagos NO anulados cuyo `createdAt` cae en el mes. Base CAJA, ver la spec. */
  async pagosDelMes(anio: number, mes: number): Promise<PagoParaCaja[]>
```

El rango se arma con `comienzoDeHoyUtc` y aritmética de meses en UTC, como el resto del proyecto.
**No uses `date-fns`**: el PDF lo sugiere, pero este repo ya resuelve fechas en UTC con sus propios
ayudantes de `@boxadmin/shared`, y meter una librería de fechas al lado crea dos formas de hacer lo
mismo.

- [ ] **Step 5: El service**

`StatsService.caja(actor, consulta)` envuelve todo en `this.cache.recordar(actor.tenantId,
'caja:${anio}-${mes}:${salaId ?? 'todas'}', ...)`.

`pendienteEstimado` es **la suma de los estimados de los perfiles que no estan al dia**, el mismo
numero que `/stats/pagos-pendientes` devuelve desglosado. Se calcula con la misma funcion que usa ese
reporte —se extrae en la Task 7 y la caja la reutiliza—, para que los dos no puedan diferir.

El costo de profesoras sale de `LiquidacionService`, que `LiquidacionModule` ya exporta: se listan los
profesores del gimnasio y se suma su `importes.aPagar.centavos`. **Así cuadra por construcción** con el
reporte individual, porque es literalmente el mismo cálculo.

- [ ] **Step 6: Controlador y módulo**

```ts
@Controller('stats')
export class StatsController {
  @Roles('ADMIN_SALON')
  @Get('caja')
  caja(@CurrentUser() actor: JwtPayload, @Query() consulta: ConsultaMensualDto): Promise<CajaDelMes>
}
```

`StatsModule` provee `StatsService`, `StatsDatos`, `CacheDeStats` y el `CLIENTE_DE_CACHE`:

```ts
    {
      provide: CLIENTE_DE_CACHE,
      inject: [ConfigService],
      useFactory: (config: ConfigService): ClienteDeCache =>
        new Redis(config.get<string>('REDIS_URL') as string, { maxRetriesPerRequest: null }),
    },
```

Importa `LiquidacionModule`. Y se añade a `app.module.ts`.

- [ ] **Step 7: Correr**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/stats --silent && pnpm exec tsc --noEmit
```

- [ ] **Step 8: Mutaciones**

| Mutación | Tiene que caer |
|---|---|
| Incluir `CORTESIA` en el cobrado | `las cortesias NO entran en el cobrado` |
| Quitar `anuladoEn: null` del `where` | `un pago anulado no cuenta` |
| `margen = cobrado + costoProfesoras` | `el margen es cobrado menos costo de profesoras` |
| Usar `.toNumber()` en vez de `.toFixed(2)` | ninguna de golpe — **si no rompe nada, escribí un caso con centavos que lo cace** |

---

## Task 5: La invalidación, en sus cinco sitios

**Files:**
- Modificar: `apps/api/src/pagos/pagos.service.ts`, `apps/api/src/reservas/reservas.service.ts`,
  `apps/api/src/mis-clases/mis-clases.service.ts`

Esta tarea va **inmediatamente después de la caja y antes de los demás reportes**, a propósito: el
caché no se queda ni una tarea sin su invalidación.

- [ ] **Step 1: El test que importa**

En `stats.service.spec.ts`:

```ts
  it('un pago recien registrado se ve en la caja, sin esperar al TTL', async () => {
    // Se pide la caja, se registra un pago (que invalida), se vuelve a pedir, y
    // el segundo resultado incluye el pago. Con el cache real y su contador.
  });
```

- [ ] **Step 2: Los cinco sitios**

Una línea en cada uno, después de que la escritura haya commiteado:

```ts
    await this.cache.invalidar(actor.tenantId);
```

| Servicio | Método |
|---|---|
| `PagosService` | registrar un pago |
| `PagosService` | anular un pago |
| `ReservasService` | `crear` |
| `ReservasService` | `cancelar` |
| `MisClasesService` | pasar lista |

⚠️ **Va DESPUÉS del commit, nunca dentro de la transacción.** Si la transacción aborta y reintenta,
una invalidación de más sólo cuesta un recálculo; pero una llamada a Redis dentro de una transacción
de Postgres es la misma clase de error que la Fase 5B arregló con el encolado — ver el bloque del
encolado post-commit en el plan de la 5B.

`invalidar` nunca lanza (Task 3), así que no hace falta envolverlo.

- [ ] **Step 3: Correr**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest --silent && pnpm exec tsc --noEmit
```

- [ ] **Step 4: Mutación**

Quitar el `invalidar` de registrar un pago → tiene que caer `un pago recien registrado se ve en la
caja`. Si no cae, el test está mirando al sitio equivocado.

---

⚠️ **CADA UNA DE LAS TASKS 6, 7 Y 8 AGREGA SUS PROPIOS SITIOS DE INVALIDACIÓN.** El barrido de la
Task 5 encontró que la lista de cinco cubría el dinero y nada más. Los que faltan mueven reportes que
no existían todavía, así que entran con la tarea que crea el reporte que los necesita — así cada
invalidación llega con el test que la justifica, en vez de ser una línea que nadie sabe por qué está:

⚠️ **CORREGIDO: cuatro de estos NO esperan a la Task 6.** Los mandé a la 6 "por ocupación" cuando la
caja todavía no existía. Desde la Task 4 **ya mueven `costoProfesoras`**, porque una franja cuenta como
dictada si existe el turno: crear, borrar o reasignar la profesora de un turno cambia lo que se le
paga, y eso entra en el margen. Lo encontró la revisión de las Tasks 3-5.

| Sitio | Qué reporte mueve | Tarea |
|---|---|---|
| `HorariosProfesorService.crear` / los dos `update` | **el margen**: escribe `tarifaPorHora` y las franjas | **5** |
| `TurnosService.crear` / `actualizar` / `eliminar` | **el margen** (y la ocupación) | **5** |
| `TurnosService.asignarProfesor` | **el margen**, vía `profesorId` | **5** |
| `PublicacionService.aplicar` | **el margen** y la ocupación: crea turnos en masa | **5** |
| `ReservasService.reasignar` | ocupación (mueve una reserva entre turnos) | 6 |
| `UsuariosService.actualizar` | composición y pendiente, si cambia el `packId` | 7 y 8 |
| `PacksService.actualizar` | el pendiente estimado, si cambia el precio | 7 |

`AusenciasService` **no** hace falta y el plan acierta al no listarlo: `cerrada` depende de que *no*
haya turno, y como `aPagar = dictadas`, una ausencia no mueve lo que se paga.

`ListaEsperaService.asignarPrimero` **no hace falta**: su único llamador es `ReservasService.cancelar`,
que ya invalida.

Esto no contradice el contador de versión —olvidarse de uno cuesta cinco minutos de TTL, no un reporte
roto para siempre—, pero un reporte que tarda cinco minutos en reflejar un turno que el admin acaba de
crear es el mismo problema de confianza que la §8 describe para el dinero.

## Task 6: `/stats/operativo`

**Files:**
- Modificar: `apps/api/src/stats/stats.datos.ts`, `stats.service.ts` · `.spec.ts`, `stats.controller.ts`
- ⚠️ **CORREGIDO: tambien crea `apps/api/src/stats/dto/consulta-operativa.dto.ts`.** La lista no lo
  traia, y no es opcional: `ConsultaMensualDto` no solo no tiene `salaId`, sino que **su ausencia es
  la funcionalidad** —el `ValidationPipe` global corre con `forbidNonWhitelisted`, asi que mandarlo
  da 400, y asi lo exige un caso de la Task 4—. Agregarselo habria roto ese caso y la decision que
  protege. El DTO nuevo **extiende** al de la caja para no tener dos copias de `@Min(1) @Max(12)`, y
  solo suma el `salaId`.

⚠️ **LA COBRANZA NO SE ACOTA POR `salaId`, y el plan no lo decia.** Las otras cuatro metricas salen
de turnos y un `Turno` tiene sala, asi que recortarlas es limpio. Estar al dia es una propiedad del
alumno y de sus pagos, no de una clase, y un alumno tiene acceso a varias salas a la vez: repartirlo
exigiria exactamente la atribucion de ingresos que la seccion 3 de la spec borro y que hizo que la
caja rechazara el `salaId`. Queda escrito en el docblock de `StatsService.operativo` y con un caso
que fija que mandar `salaId` NO mueve la cobranza, para que sea una decision cubierta y no un olvido
que un dia alguien "arregle".

⚠️ **LA COBRANZA SE EVALUA AL CIERRE DEL MES, no con el reloj**, y el plan tampoco lo decia. Es la
misma trampa que `pendienteEstimado` en la Task 4, pero aqui muerde mas fuerte: sin la fecha de
cierre, `perfilesAlDia` cae en su default `new Date()` y los CUATRO meses del reporte devuelven el
mismo numero. Una serie trimestral con la cobranza clavada en los cuatro puntos no se lee como un
bug: se lee como "la cobranza no se mueve". Tiene su caso y su mutacion.

- [ ] **Step 1: Los tests de las definiciones**

Son el corazón de la tarea. Las cuatro métricas y, sobre todo, **el denominador de la asistencia**:

```ts
  it('la asistencia NO cuenta las reservas de turnos sin lista pasada', async () => {
    // Dos turnos: en uno se paso lista (una presente, una ausente), en el otro
    // no se paso (dos reservas con asistio: null).
    // asistencia = 1/2 = 50%, NO 1/4 = 25%.
  });

  it('un mes sin ninguna lista pasada no dice 0%, dice que no se sabe', async () => {
    // Todas las reservas con asistio: null.
    // asistencia.denominador === 0 y asistencia.porcentaje === null.
  });

  it('separa la cancelacion recuperable de la definitiva', async () => {
    // Una de cada una sobre cuatro reservas: 25% y 25%, nunca un 50% junto.
  });

  it('la ocupacion usa el cupo DEL TURNO', async () => {
    // Dos turnos de la misma sala con cupos distintos.
  });

  it('la cobranza usa estaAlDia, no una columna', async () => {
    // Se comprueba contra PagosService.perfilesAlDia.
  });

  it('el trimestre trae los TRES meses anteriores, del mas viejo al mas nuevo', async () => {
    // Pedir 2026-10 devuelve 07, 08, 09 en ese orden.
  });
```

- [ ] **Step 2: La implementación**

El endpoint va con `@Roles('ADMIN_OPERATIVO')`: es operativo, no muestra dinero.

`MetricasOperativas` se calcula en una función que recibe un mes y se llama **cuatro veces**: una para
el mes pedido y tres para el trimestre. No es un reporte distinto, es el mismo cálculo.

El `Porcentaje` se construye siempre con `numerador` y `denominador`, y `porcentaje: null` cuando el
denominador es cero. **Nunca un `0` que signifique "no se sabe".**

- [ ] **Step 3: Correr y mutar**

| Mutación | Tiene que caer |
|---|---|
| Denominador de asistencia = todas las reservas vivas | `la asistencia NO cuenta las reservas de turnos sin lista pasada` |
| `porcentaje: 0` cuando el denominador es cero | `un mes sin ninguna lista pasada no dice 0%` |
| Sumar las dos cancelaciones en una sola métrica | `separa la cancelacion recuperable de la definitiva` |
| Usar el cupo de la sala | `la ocupacion usa el cupo DEL TURNO` |
| Devolver el trimestre al revés | `del mas viejo al mas nuevo` |
| La cobranza con el reloj en vez del cierre del mes | `la cobranza de cada mes se evalua al CIERRE de ese mes` |
| Denominador de cancelación = solo las vivas | `el denominador de la cancelacion son TODAS las reservas` |
| Descartar los turnos sin reservas de la ocupación | `un turno al que no se anoto nadie SI cuenta en la ocupacion` |
| Contar las canceladas como ocupación | `las canceladas no ocupan lugar ni cuentan como falta` |
| Ignorar el `salaId` al traer los turnos | `acota a la sala pedida las metricas que cuentan clases` |
| Quitar el `invalidar` de `ReservasService.reasignar` | `reasignar invalida el cache del gimnasio del actor` |
| Moverlo DENTRO de la transacción | `reasignar: nada se invalida mientras la transaccion sigue abierta` |

⚠️ **La mutación "usar el cupo de la sala" NO se podia escribir tal cual.** El codigo correcto no
consulta `Sala` en ningun momento, asi que la mutacion tuvo que agregar la consulta a
`Sala.cupoBase` para poder intentarse, y el doble de Prisma de `stats.service.spec.ts` tuvo que
aprender ese campo (opcional, para no obligar a las Tasks 7 y 8 a ponerlo). Sin eso, el resultado no
habria sido "no rompio nada" sino "no se pudo intentar", que es otra cosa.

---

## Task 7: `/stats/turnos-libres` y `/stats/pagos-pendientes`

**Files:**
- Modificar: `apps/api/src/stats/stats.datos.ts`, `stats.service.ts` · `.spec.ts`, `stats.controller.ts`
- ⚠️ **CORREGIDO: tambien crea tres archivos de DTO.** `apps/api/src/stats/dto/consulta-turnos-libres.dto.ts`,
  `apps/api/src/stats/dto/consulta-pagos-pendientes.dto.ts` y `apps/api/src/stats/dto/patron-id.ts`.
  La lista no los traia y no son opcionales: sin un `@Query()` apuntando a un DTO, Nest **ignora en
  silencio** los query params, y entonces `?salaId=` en pagos-pendientes vuelve a ser una mentira con
  codigo 200. `patron-id.ts` existe porque la misma regex la necesitan el `salaId` del operativo, el
  de los turnos libres y el `perfilId` de la asistencia, y tres copias son tres copias que algun dia
  discrepan.

⚠️ **`/stats/pagos-pendientes` NO ACEPTA `salaId`, y se quito al implementarlo.** La spec y el plan lo
pedian. El motivo es el MISMO por el que la caja lo rechaza y por el que la cobranza del operativo no
se acota: estar al dia es una propiedad del alumno y de sus pagos, un alumno accede a varias salas a
la vez, y su `pendienteEstimado` es el precio de su pack **entero**, no el de una sala. La misma
persona apareceria con su deuda completa en la lista de la sala A y en la de la B, y sumar las dos
listas contaria el mismo peso dos veces: exactamente la atribucion de ingresos que la seccion 3 de la
spec borro. El DTO queda **vacio** a proposito, para que `forbidNonWhitelisted` devuelva 400 en vez de
aceptarlo y no hacer nada.

⚠️ **LA FECHA DE EVALUACION DE LOS DOS REPORTES ES HOY, Y AQUI ESO ESTA BIEN.** El plan no lo decia, y
despues de que la caja y el operativo mintieran dos veces por un `new Date()` por defecto conviene que
quede escrito por que aqui no es lo mismo: ninguno de estos dos esta indexado por un periodo —no se
puede pedir "los turnos libres de marzo de 2024" ni "los morosos de marzo"—, asi que "hoy" no se
esconde debajo de otra fecha prometida; es la pregunta. Consecuencias que SI se implementaron: el dia
entra en la clave del cache de los dos, el corte de "futuro" es por DIA y no por hora (la hora del
turno es "local del salon" y el sistema no guarda husos; ver `instanteDelTurno`), y hay un caso que
fija que dos relojes distintos dan respuestas DISTINTAS en pagos-pendientes, que es el inverso del
caso de dos relojes de la caja.

⚠️ **Y por eso `/stats/pagos-pendientes` no tiene por que cuadrar al centavo con el
`pendienteEstimado` de la caja.** Es la misma lista, de la misma funcion pura `pendientesDe`, sobre
los mismos perfiles: lo unico distinto es la fecha a la que se pregunta quien esta al dia —alli el
cierre del mes pedido, aqui hoy—. Queda escrito en los dos docblocks para que nadie lo reporte como
un bug.

- [ ] **Step 1: Los tests**

```ts
  it('turnos libres: solo futuros y solo con lugar', async () => {
    // Tres turnos: uno pasado con lugar, uno futuro lleno (cupo 2 / 2 reservas
    // vivas), uno futuro con lugar (cupo 5 / 1 reserva). Solo vuelve el tercero,
    // con libres: 4.
  });

  it('turnos libres: mesesAdelante por defecto es 3', async () => {
    // Sin el parametro, el `where` de fecha llega con `lte` a hoy + 3 meses. Se
    // afirma sobre el `where` que recibio el doble, no sobre el resultado: con
    // pocos turnos los dos rangos devolverian lo mismo y el test no probaria nada.
  });

  it('turnos libres: mesesAdelante se topea en 12', async () => {
    // Pedir 999 no recorre la tabla entera: el `where` se arma con 12.
  });

  it('pagos pendientes: solo los que NO estan al dia', async () => {
    // Dos perfiles con pack: uno con un pago que cubre hoy, otro sin ninguno.
    // Solo vuelve el segundo.
  });

  it('pagos pendientes: el estimado es el precio del pack', async () => {
    // Pack de precio "8500.00" -> pendienteEstimado.centavos === 850000.
    // Y un pack con precio null -> centavos 0, nunca un NaN ni un crash.
  });

  it('pagos pendientes: un alumno sin pack no aparece', async () => {
    // Un perfil con packId null y sin ningun pago. No debe nada: no tiene plan
    // contratado. Si apareciera, el reporte de morosos se llenaria de gente que
    // nunca se anoto a nada.
  });
```

- [ ] **Step 2: La implementación**

Los dos endpoints van con `@Roles('ADMIN_OPERATIVO')`. `/stats/pagos-pendientes` muestra **quien**
debe, no cuanto entro en la caja: es trabajo de recepcion.

El tope de 12 va en el service, **no en el DTO**: un DTO con `@Max(12)` devolvería 400 a quien pida 24,
y la respuesta correcta a "dame dos años" no es un error, es "te doy uno". Sin tope, un parámetro
grande recorre la tabla entera de turnos y el reporte se convierte en una forma cómoda de tirar la
base.

- [ ] **Step 3: Mutaciones**

| Mutación | Tiene que caer |
|---|---|
| Quitar el tope de 12 | `mesesAdelante se topea en 12` |
| Incluir turnos pasados | `solo futuros y solo con lugar` |
| Invertir el filtro de al día | `solo los que NO estan al dia` |

---

## Task 8: `/stats/composicion-alumnos` y `/stats/asistencia`

**Files:**
- Modificar: `apps/api/src/stats/stats.datos.ts`, `stats.service.ts` · `.spec.ts`, `stats.controller.ts`
- Crear: `apps/api/src/stats/dto/consulta-rango.dto.ts`
- ⚠️ **CORREGIDO: tambien toca `apps/api/src/usuarios/usuarios.service.ts` y
  `apps/api/src/packs/packs.service.ts`** (mas sus `.spec.ts`). Son las dos invalidaciones que estas
  tasks estrenan, y la lista de archivos no las traia.

- [ ] **Step 1: El DTO del rango**

⚠️ **CORREGIDO: `@IsDateString()` no sirve aqui, y `@IsString()` tampoco para el `perfilId`.**

- `@IsDateString` acepta un ISO 8601 **completo**, asi que `?desde=2026-10-01T12:00:00Z` pasaria la
  validacion y llegaria al service, donde `desdeFechaISO` lo rechaza con una `FechaInvalidaError` que
  nadie traduce: un **500 opaco en vez de un 400**. Y ademas los `:` del timestamp entrarian en la
  clave del cache. Los otros nueve DTOs con fechas del repositorio usan `PATRON_FECHA` desde la Fase 1.
- El `perfilId` es el mismo tipo de valor que el `salaId` del operativo —texto de la query que entra
  en una clave de Redis— y la regla "a la clave solo van valores ya validados" no distingue entre un
  id de sala y uno de perfil.

```ts
export class ConsultaRangoDto {
  @IsString()
  @Matches(PATRON_FECHA, { message: 'desde debe tener formato YYYY-MM-DD' })
  desde!: string;

  @IsString()
  @Matches(PATRON_FECHA, { message: 'hasta debe tener formato YYYY-MM-DD' })
  hasta!: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_LARGO_ID)
  @Matches(PATRON_ID, { message: 'perfilId debe ser un identificador valido' })
  perfilId?: string;
}
```

⚠️ **EL RANGO TAMBIEN LLEVA TOPE, y el plan no lo pedia.** Es el mismo riesgo que `mesesAdelante`
escrito con otras palabras: sin tope, un `?desde=2000-01-01&hasta=2099-12-31` recorre todas las
reservas del gimnasio y el reporte se vuelve una forma comoda de tirar la base. Se recorta a 366 dias
y **el `hasta` que vuelve en el reporte es el recortado**, nunca el pedido: devolver el pedido seria
decir que se miro un ano que no se miro. El rango invertido si es un 400, y vive en el service porque
es una relacion entre dos campos y los validadores de class-validator miran uno solo.

⚠️ **LA COMPOSICION FILTRA POR ROL `ALUMNO`, Y SIN ESO EL REPORTE ES FALSO.** El plan hablaba de
"perfiles activos" y no lo decia. Una profesora tiene `Perfil` y no tiene pack: sin el filtro cae en
el grupo "Sin pack" e infla con el personal del gimnasio el reporte que dice cuantos **alumnos** hay
en cada plan. Hay un caso que lo fija, y la mutacion que quita el filtro lo tira.

⚠️ **`UsuariosService.darDeBaja` TAMBIEN invalida, y el brief solo pedia `actualizar`.** La
composicion cuenta los perfiles **activos**, asi que una baja le cambia el total y el reparto por pack
sin que nadie toque un pack ni un pago. Lo destapo una mutacion mal aplicada. `actualizarSalas`, en
cambio, **no** invalida: a que salas accede un alumno no entra en ningun reporte —los que se acotan
por sala lo hacen por la sala del TURNO—, y hay un caso que lo fija para que sea una decision y no un
olvido.

- [ ] **Step 2: Los tests**

```ts
  it('composicion: los porcentajes suman 100', async () => {
    // Cuatro alumnos: dos del pack A, uno del B, uno sin pack. 50 / 25 / 25.
  });

  it('composicion: los alumnos sin pack se agrupan aparte, no se descartan', async () => {
    // packId: null -> packNombre "Sin pack". Descartarlos haria que los
    // porcentajes mintieran sobre el total.
  });

  it('composicion: el consumo sale de las reservas, no de un contador', async () => {
    // Un alumno con tres reservas del mes, una de ellas cancelada.
    // clasesTomadas === 2: las vivas, derivadas, como desde la Fase 1.
  });

  it('asistencia: un alumno sin lista pasada tiene porcentaje null', async () => {
    // Dos reservas suyas en el rango, las dos con asistio: null.
    // presentes 0, ausentes 0, porcentaje null. NUNCA 0.
  });

  it('asistencia: un rango invertido es 400', async () => {
    // desde > hasta
  });
```

- [ ] **Step 3: Mutaciones**

Los dos endpoints van con `@Roles('ADMIN_OPERATIVO')`.

| Mutación | Tiene que caer |
|---|---|
| Descartar los alumnos sin pack | `los alumnos sin pack se agrupan aparte` |
| `porcentaje: 0` para quien no tiene lista pasada | `un alumno sin lista pasada tiene porcentaje null` |
| Aceptar el rango invertido | `un rango invertido es 400` |

---

## Lo que encontro la revision de las Tasks 6, 7 y 8

Seis cosas, todas corregidas y con su caso y su mutacion.

**1. El denominador de la asistencia del operativo se contradecia con el de por alumno.**
`metricasDelMes` preguntaba si el TURNO tenia lista pasada y, si la tenia, metia en el denominador
TODAS sus reservas vivas; `calcularAsistencia` contaba solo `presentes + ausentes`. Una reserva que
entra **despues** de que la profesora pasara lista —por `reasignar`, por la lista de espera, por un
alta a mano— se queda con `asistio: null` para siempre, y el turno sigue teniendo lista pasada: esa
persona entraba como ausencia. Medido sobre el mismo turno y las mismas tres reservas: operativo
**33,33%**, por alumno **A 100% · B 0% · C null**, agregado real **50%** — mientras los dos docblocks
afirmaban usar "la MISMA definicion".

Lo que lo delataba: ese alumno sale con `porcentaje: null` en su propio reporte. **El codigo ya sabia
que ese caso era "no se sabe"** y en el agregado lo contaba como ausencia igual. Es la mutacion que la
seccion 9.1 declara como la mas peligrosa, en version chica y viviendo dentro del codigo correcto.

El arreglo es **mas simple que lo que habia**: el denominador son las reservas con `asistio !== null`,
y punto. No hace falta saber si el turno tuvo lista pasada — lo que importa de cada reserva es si
**esa reserva** fue marcada. Eso unifica las dos definiciones, hace innecesario `listaPasada` para esta
metrica y conserva lo que importa: un mes sin ninguna lista da denominador cero y `porcentaje: null`.
`listaPasada` sigue siendo correcto en `mis-clases.service.ts`, donde decide si mostrarle a la
profesora la lista de un turno —una pregunta sobre el TURNO—; traerlo prestado aqui fue reutilizar una
regla que contestaba otra cosa.

**2. Un alumno dado de baja desaparecia de la composicion y seguia debiendo en los otros tres.**
`alumnosActivos()` filtraba `activo: true`; `perfilesConPack()` no filtraba ni por rol ni por `activo`,
y `darDeBaja` no limpia el `packId`. La misma persona era "no es alumno" para un reporte y "alumno que
debe" para tres. Lo peor era la cobranza: **decaia para siempre**, porque cada ex-alumno se quedaba en
el denominador sin poder volver a estar al dia jamas. Un indicador que baja solo es exactamente el
numero plausible y equivocado que la seccion 6 existe para evitar.

Era una decision que nadie habia tomado, solo heredada. **Tomada: los cuatro reportes usan la misma
poblacion, alumnos activos.** Recepcion no llama a quien se fue; la cobranza mide a los alumnos que el
gimnasio TIENE, no a los que tuvo; y el pendiente de la caja de un mes es lo que ese mes quedo sin
cobrar de su gente, no una deuda historica acumulada. El filtro de rol no es redundante con el de
pack: `Perfil.packId` es opcional para todos, asi que el dia que alguien le asigne un pack a una
profesora apareceria en los morosos.

**3. Faltaban cuatro `invalidar`.**

- **`UsuariosService.crear`** — el hueco exacto que los otros vinieron a tapar: el alta suma un perfil
  al total y al reparto por pack, **y** mete un alumno con pack que no esta al dia en los morosos y en
  el pendiente de la caja. Es la llamada de soporte del cache con el verbo cambiado: *"di de alta al
  alumno y no aparece en el panel"*.
- **`SalasService.actualizar`** — `salaNombre` sale del catalogo en `/stats/turnos-libres`.
- **`AusenciasService.crear` y `.darDeBaja`** — `liquidacion.datos.ts` lee la tabla `ausencia` desde la
  Fase 4, asi que un cierre mueve `importes.aPagar`, `costoProfesoras` y el `margen`.

`SalasService.crear`/`darDeBaja` y `UsuariosService.actualizarSalas`
**no** invalidan, cada uno con su caso que lo fija: una sala nueva no tiene turnos, la que se da de
baja tampoco tiene ninguno por delante (`exigirSinTurnosFuturos`), y a que salas accede un alumno no
entra en ningun reporte.

**4. El `mesesAdelante` recortado no volvia en la respuesta**, mientras el `hasta` de asistencia si. El
codigo daba uno y no lo decia, asi que quien pedia dos anos leia una lista corta como "no hay mas
turnos" en vez de como "no miramos mas alla". `/stats/turnos-libres` devuelve ahora
`ReporteTurnosLibres { mesesAdelante, turnos }` en vez de `TurnoLibre[]`.

**5. El docblock de `ConsultaRangoDto` afirmaba de mas.** Decia que un timestamp viajaria a la clave
del cache, y no viaja: `desdeFechaISO` lanza antes de `cache.recordar`. La otra mitad —el 500 opaco—
si es cierta y alcanza para justificar `PATRON_FECHA`. Queda solo lo verdadero.

**6. Dos comentarios describian un caso inalcanzable.** El `?? 'todas'` se justificaba con "una sala de
id vacio compartiria clave", y por HTTP `?salaId=` llega como `''` y lo rechaza `@Matches` con 400. El
`?? 'todas'` sigue haciendo falta —para `undefined`, que si no se interpola como el texto
`"undefined"`— pero el motivo escrito no era el real.

**Lo que se miro y se dejo como esta:** la ocupacion puede pasar de 100% si bajan el cupo de un turno
que ya tiene reservas, y ese es el numero honesto; y el codigo defensivo del pack borrado es
inofensivo.

---

## Task 9: Los e2e

**Files:**
- Crear: `apps/api/test/stats.e2e-spec.ts`

⚠️ **Comprobá que no hay otra API viva antes de correrlos**, y que no quedan procesos node huérfanos
de una corrida anterior: `Get-CimInstance Win32_Process -Filter "Name='node.exe'"` y leer el
`CommandLine`. Un jest superviviente con la app levantada se lleva los jobs del Redis compartido y
vuelve los e2e intermitentes. Pasó en la Fase 5B y costó un rato largo encontrarlo.

- [ ] **Step 1: Los casos**

Son los que el checklist exige que **cuadren**:

```ts
  it('la caja cuadra exactamente contra la suma de Pago del periodo', async () => {
    // Tres pagos reales por la API, uno de ellos CORTESIA y otro anulado.
    // Se compara contra la suma calculada a mano en el propio test.
  });

  it('el costo de profesoras de la caja coincide con la suma de las liquidaciones', async () => {
    // Dos profesoras con horarios y turnos reales.
  });

  it('la liquidacion devuelve horas Y importes', async () => {
    // Una profesora con un horario y un turno dictado, tarifa conocida.
    // Se afirman las horas (como ya hacia el e2e de la Fase 4) Y que
    // importes.aPagar.texto es el producto esperado.
  });

  it('un pago recien cargado aparece en la caja de inmediato', async () => {
    // GET caja, POST pago, GET caja: el segundo trae el pago.
  });

  it('ADMIN_OPERATIVO no puede ver la caja ni la liquidacion', async () => {
    // 403 en las dos.
  });

  it('ADMIN_OPERATIVO si puede ver el operativo', async () => {
    // 200 en /stats/operativo con el token de ADMIN_OPERATIVO: el 403 del caso
    // anterior tiene que ser por el endpoint, no porque el rol no sirva para nada.
  });
```

- [ ] **Step 2: Correr**

```bash
cd /d/Dev/box-admin/apps/api && pnpm test:e2e
```

---

## Task 10: Verificación final, README y tracker

- [ ] **Step 1: Todo verde**

```bash
cd /d/Dev/box-admin/packages/shared && pnpm exec jest && pnpm exec tsc -p tsconfig.json --noEmit
cd ../../apps/api && pnpm exec tsc --noEmit && pnpm exec jest --silent && pnpm test:e2e
cd ../web && pnpm exec tsc --noEmit && pnpm test
```

⚠️ **No corras `pnpm lint`**: lleva `--fix` y reformatea código commiteado de otras fases.

```bash
cd /d/Dev/box-admin && pnpm exec prettier --check "apps/api/src/stats/**/*.ts" "apps/api/src/liquidacion/**/*.ts" "packages/shared/src/stats.contracts.ts" "packages/shared/src/dinero.contracts.ts" "apps/api/test/stats.e2e-spec.ts"
```

- [ ] **Step 2: El checklist a mano**

Lo que ningún test automático puede ver:

- Con el panel de Redis o `redis-cli`, que la segunda llamada al mismo reporte **no** vuelve a
  consultar Postgres, y que después de un pago sí.
- Que `GET /stats/caja` con un `salaId` de otro gimnasio no devuelve nada en vez de 403 confuso.

- [ ] **Step 3: README**

Sección "Estadísticas — Fase 6A" antes de `## Tests`, con: los siete endpoints y sus roles, la regla de
que sólo se pagan las dictadas, la advertencia de caja-vs-devengado, el denominador honesto de la
asistencia, y cómo funciona la invalidación del caché.

```bash
cd /d/Dev/box-admin && python -c "
import re
d=open('README.md','rb').read()
print('fences:', len(re.findall(rb'(?m)^\`\`\`', d)), 'CRLF:', d.count(b'\r\n'))
"
```

Esperado: par y 0.

- [ ] **Step 4: Tracker**

Bloque de la Fase 6A en `PROGRESO.md` con el formato de los anteriores: las tareas, las decisiones
cerradas con Cesar, **los errores de este plan que encontraste**, las trampas nuevas y la deuda.

Anotá además:

- **Los cumpleaños**, que necesitan `Perfil.fechaNacimiento` y capturarla en tres formularios.
- **El libro de gastos**, que es contabilidad y es otra fase.
- **El panel visual**, que necesita un frontend de admin que no existe.
- **`VacacionAlumno.devuelveClase`**, que lleva tres fases de mudanza: se reetiqueta a la 6B **o se
  borra**. Una columna almacenada que no hace nada es el error de `Sala.exclusiva`.

**Mensaje de commit sugerido para Cesar:**

```
docs: la analitica en el README y el estado en el tracker
```
