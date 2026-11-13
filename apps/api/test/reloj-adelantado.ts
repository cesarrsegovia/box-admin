/**
 * EL RELOJ ADELANTADO: corre la suite unitaria como si fuera dentro de N años.
 *
 * Un test con una fecha fija contra un servicio que mira «hoy» pasa hasta que
 * el calendario lo alcanza, y ese dia se pone rojo sin que nadie haya tocado
 * nada (la bomba de `stats.service.spec.ts`, Fase 18). Esto adelanta `Date`
 * —`new Date()` sin argumentos y `Date.now()`— y nada mas: los timers siguen
 * reales y una fecha escrita (`new Date('2026-10-15')`) sigue siendo esa.
 *
 * `RELOJ_ANIOS` (por defecto 1) dice cuantos años. Uso:
 *   pnpm --filter @boxadmin/api test:reloj
 *   $env:RELOJ_ANIOS='5'; pnpm --filter @boxadmin/api test:reloj   (PowerShell)
 *
 * Para filtrar, `--testPathPattern <patron>`: `--setupFiles` es una lista y
 * se come cualquier ruta suelta que venga detras.
 *
 * NO CUBRE: mientras un spec tiene `jest.useFakeTimers()` puesto sin
 * `setSystemTime`, el reloj falso arranca en la fecha de verdad, no en la
 * adelantada. Al volver con `useRealTimers()` vuelve el adelantado.
 */
const anios = Number(process.env.RELOJ_ANIOS ?? '1');

if (!Number.isFinite(anios) || anios <= 0) {
  throw new Error(
    `RELOJ_ANIOS tiene que ser un numero positivo, y es «${process.env.RELOJ_ANIOS}»`,
  );
}

const DESFASE_MS = Math.round(anios * 365.25 * 24 * 60 * 60 * 1000);
const DateReal = Date;

function DateAdelantado(this: unknown, ...args: unknown[]): unknown {
  // `Date()` sin `new` devuelve un texto; se respeta.
  if (new.target === undefined) return new DateReal(DateReal.now() + DESFASE_MS).toString();

  return args.length === 0
    ? new DateReal(DateReal.now() + DESFASE_MS)
    : Reflect.construct(DateReal, args);
}

DateAdelantado.prototype = DateReal.prototype;
Object.setPrototypeOf(DateAdelantado, DateReal);
(DateAdelantado as unknown as { now: () => number }).now = () => DateReal.now() + DESFASE_MS;

globalThis.Date = DateAdelantado as unknown as DateConstructor;
