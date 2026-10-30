import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FranjaDeLiquidacion, LiquidacionProfesor } from '@boxadmin/shared';
import { LiquidacionLeida } from '@/componentes/liquidacion-leida';
import { ErrorDeApi } from '@/lib/cliente';
import { vigilarEstosDatos } from '@/test/espia-de-consola';
import { PantallaDeMiLiquidacion } from './pantalla';

// ---------------------------------------------------------------------------
// Andamiaje
// ---------------------------------------------------------------------------

const RUTA = '/mi-gym/mi-liquidacion';

const { empujar, pedirEspia, busqueda } = vi.hoisted(() => ({
  empujar: vi.fn(),
  pedirEspia: vi.fn(),
  // Mutable a proposito: `useSearchParams` se llama en cada render y tiene que
  // devolver lo que el test de turno puso, no lo que habia al cargar el modulo.
  busqueda: { valor: '' },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: empujar, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({ slug: 'mi-gym' }),
  useSearchParams: () => new URLSearchParams(busqueda.valor),
  usePathname: () => RUTA,
}));

/** Se dobla `pedir`, no `fetch`: la URL exacta ya la fija `use-dinero.spec`. */
vi.mock('@/lib/cliente', async (original) => ({
  ...(await original<typeof import('@/lib/cliente')>()),
  pedir: pedirEspia,
}));

/**
 * EL RELOJ, CONGELADO Y SOLO EL RELOJ.
 *
 * Sin mes en la URL la pantalla pide el de hoy, asi que sin congelarlo este
 * archivo cambiaria de significado cada primero de mes. Y el mes de la URL de
 * los demas tests (enero) NO es el de hoy (octubre): con los dos iguales,
 * «pide el de la URL» y «pide el de hoy» serian la misma afirmacion.
 */
const AHORA = new Date(Date.UTC(2026, 9, 20));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AHORA);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  busqueda.valor = '';
});

// ---------------------------------------------------------------------------
// Los fijos
// ---------------------------------------------------------------------------

/**
 * LO QUE COBRA LA PROFESORA ES EL DATO MAS PERSONAL DE ESTA PANTALLA, y la ve
 * ella: se registra todo lo que tiene forma de secreto —el nombre, cada importe
 * pintado, el volcado de lo que se paga y las tarifas—.
 */
vigilarEstosDatos({
  elNombreDeLaProfesora: 'Marina-Ferreyra-Propia',
  loQueSePaga: '987.65',
  elVolcadoDeLoQueSePaga: '"centavos":98765',
  loDictado: '1515.15',
  loContratadoSinDictar: '1800.00',
  loCerrado: '2000.00',
  laTarifaDelHorario: '1000.00',
});

const SE_DIO: FranjaDeLiquidacion = {
  fecha: '2026-01-05',
  salaId: 's-1',
  horaInicio: '18:00',
  horaFin: '19:30',
  minutos: 90,
  contratada: true,
  dictada: true,
  cerrada: false,
  motivoCierre: null,
  turnoId: 't-1',
  tarifaPorHora: '1000.00',
  origenTarifa: 'HORARIO',
};

const SUPLENCIA: FranjaDeLiquidacion = {
  fecha: '2026-01-21',
  salaId: 's-2',
  horaInicio: '10:00',
  horaFin: '11:30',
  minutos: 90,
  contratada: false,
  dictada: true,
  cerrada: false,
  motivoCierre: null,
  turnoId: 't-2',
  tarifaPorHora: null,
  origenTarifa: null,
};

/**
 * LA LIQUIDACION, CON TODO LO DERIVADO DESALINEADO Y TODO LO DEMAS POSIBLE.
 *
 * Las horas no salen de los minutos (180 minutos son 3.00 horas y aqui dicen
 * 8.75), `aPagar` no es `dictadas` (987.65 contra 1515.15) y el `texto` de
 * `dictadas` no sale de sus `centavos` (150000 son 1500.00). Una pantalla que
 * calcule algo por su cuenta pinta un numero que este fixture no contiene.
 */
const LIQUIDACION: LiquidacionProfesor = {
  profesorId: 'pf-marina',
  profesorNombre: 'Marina-Ferreyra-Propia',
  anio: 2026,
  mes: 1,
  minutosContratados: 90,
  minutosDictados: 180,
  minutosCerrados: 0,
  horasContratadas: '7.25',
  horasDictadas: '8.75',
  horasCerradas: '9.50',
  franjas: [SE_DIO, SUPLENCIA],
  importes: {
    dictadas: { centavos: 150_000, texto: '1515.15' },
    contratadasSinDictar: { centavos: 180_000, texto: '1800.00' },
    cerradas: { centavos: 200_000, texto: '2000.00' },
    aPagar: { centavos: 98_765, texto: '987.65' },
    minutosSinTarifa: 90,
  },
};

const SIN_MINUTOS_SIN_TARIFA: LiquidacionProfesor = {
  ...LIQUIDACION,
  importes: { ...LIQUIDACION.importes, minutosSinTarifa: 0 },
};

const CONSULTA_DE_ENERO = 'anio=2026&mes=1';

// ---------------------------------------------------------------------------
// Montaje
// ---------------------------------------------------------------------------

interface OpcionesDeMontaje {
  consulta?: string;
  liquidacion?: LiquidacionProfesor;
  error?: unknown;
}

function montar({
  consulta = CONSULTA_DE_ENERO,
  liquidacion = LIQUIDACION,
  error,
}: OpcionesDeMontaje = {}) {
  busqueda.valor = consulta;

  // POR RUTA y no por orden de llamada.
  pedirEspia.mockImplementation((ruta: string) => {
    if (/^\/mi-liquidacion\?/.test(ruta)) {
      return error === undefined ? Promise.resolve(liquidacion) : Promise.reject(error);
    }

    throw new Error(`La pantalla pidio una ruta que nadie espera: ${ruta}`);
  });

  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={cliente}>
      <PantallaDeMiLiquidacion />
    </QueryClientProvider>,
  );
}

/** Deja que las consultas se resuelvan (o se rompan) y que React pinte. */
async function esperar(): Promise<void> {
  await act(async () => {
    for (let vuelta = 0; vuelta < 5; vuelta += 1) {
      await new Promise((resolver) => setTimeout(resolver, 0));
    }
  });
}

async function montarYEsperar(opciones: OpcionesDeMontaje = {}): Promise<void> {
  montar(opciones);
  await esperar();
}

/** Las rutas pedidas, SIN deduplicar: lo que se cuida es la cuenta. */
function rutasPedidas(): string[] {
  return pedirEspia.mock.calls.map(([ruta]) => ruta as string);
}

function bloque(): HTMLElement {
  const nodo = document.querySelector<HTMLElement>('[data-bloque="mi-liquidacion"]');
  if (nodo === null) throw new Error('No hay bloque de liquidacion');

  return nodo;
}

/** Un importe EXACTO, por su grupo. Nada de buscar subcadenas. */
function importeDe(grupo: string): string {
  const cifra = bloque().querySelector(`[data-cifra="${grupo}"]`);
  if (cifra === null) throw new Error(`No hay ninguna cifra de «${grupo}»`);

  return cifra.querySelector('[data-importe]')?.textContent?.trim() ?? '';
}

function horasDe(grupo: string): string {
  const horas = bloque().querySelector(`[data-horas="${grupo}"]`);
  if (horas === null) throw new Error(`No hay horas de «${grupo}»`);

  return horas.textContent?.trim() ?? '';
}

// ---------------------------------------------------------------------------
// Que pide
// ---------------------------------------------------------------------------

describe('que pide', () => {
  it('pide /mi-liquidacion del mes de la URL', async () => {
    await montarYEsperar({ consulta: CONSULTA_DE_ENERO });

    expect(rutasPedidas()).toEqual(['/mi-liquidacion?anio=2026&mes=1']);
  });

  it('sin mes en la URL pide el de hoy', async () => {
    await montarYEsperar({ consulta: '' });

    expect(rutasPedidas()).toEqual(['/mi-liquidacion?anio=2026&mes=10']);
  });

  it('un mes imposible en la URL tambien cae en el de hoy', async () => {
    await montarYEsperar({ consulta: 'anio=2026&mes=13' });

    expect(rutasPedidas()).toEqual(['/mi-liquidacion?anio=2026&mes=10']);
  });

  it('no pide NADA mas: ni lista de profesoras ni un id', async () => {
    await montarYEsperar();

    expect(rutasPedidas().filter((ruta) => !ruta.startsWith('/mi-liquidacion?'))).toEqual([]);
    expect(rutasPedidas().filter((ruta) => ruta.includes('pf-marina'))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Lo que pinta
// ---------------------------------------------------------------------------

describe('lo que pinta', () => {
  it('pinta lo que manda el servidor, por igualdad exacta', async () => {
    await montarYEsperar();

    expect(importeDe('aPagar')).toBe('987.65');
    expect(importeDe('dictadas')).toBe('1515.15');
    expect(importeDe('contratadasSinDictar')).toBe('1800.00');
    expect(importeDe('cerradas')).toBe('2000.00');

    expect(horasDe('contratadas')).toBe('7.25');
    expect(horasDe('dictadas')).toBe('8.75');
    expect(horasDe('cerradas')).toBe('9.50');
  });

  it('cada importe y el nombre aparecen UNA vez en toda la pagina, no solo en el bloque', async () => {
    // El guardian global SI vigila los atributos del propio `<body>`; lo que no
    // ve es el texto ni los atributos de sus descendientes. Un importe repetido
    // en un `hidden`, o el nombre en un `title`, fuera del bloque, pasaria todo
    // lo de arriba. Se cuenta sobre el HTML entero, con numeros distintos entre
    // si para que ninguna cuenta se confunda con otra.
    await montarYEsperar();

    const html = document.body.innerHTML;
    const veces = (buscado: string): number => html.split(buscado).length - 1;

    for (const buscado of [
      '987.65',
      '1515.15',
      '1800.00',
      '2000.00',
      '1000.00',
      '7.25',
      '8.75',
      '9.50',
      'Marina-Ferreyra-Propia',
    ]) {
      expect(veces(buscado), buscado).toBe(1);
    }
  });

  it('dice de quien es y de que mes, en un solo encabezado', async () => {
    await montarYEsperar();

    expect(within(bloque()).getByRole('heading', { level: 2 }).textContent).toBe(
      'La liquidación de Marina-Ferreyra-Propia, enero 2026',
    );
  });

  it('con minutos sin tarifa dice que avise a la administracion, SIN enlace', async () => {
    await montarYEsperar();

    const avisos = bloque().querySelectorAll<HTMLElement>('[data-sin-tarifa]');
    expect(avisos).toHaveLength(1);
    const aviso = avisos[0] as HTMLElement;
    expect(aviso.textContent).toBe(
      '90 minutos de este mes no tienen tarifa, así que estos importes están incompletos. Avisale a la administración.',
    );
    // La profesora no puede configurar una tarifa: un enlace a Horarios la
    // llevaria a una puerta cerrada.
    expect(within(aviso).queryByRole('link')).toBeNull();
    expect(aviso.querySelector('a')).toBeNull();
  });

  it('sin minutos sin tarifa no hay aviso', async () => {
    await montarYEsperar({ liquidacion: SIN_MINUTOS_SIN_TARIFA });

    expect(bloque().querySelector('[data-sin-tarifa]')).toBeNull();
  });

  it('lo unico que cambia contra el admin es el aviso', async () => {
    // MONTAR DOS VECES y comparar el resto POR IGUALDAD: afirmar «no hay nada
    // de mas» con `not.toContain` pasaria sobre cualquier cosa que no se haya
    // pensado antes. La vista del admin es la compartida con SU aviso —el que
    // lleva un enlace—; aqui basta una forma suya con el mismo marcador.
    await montarYEsperar();
    const deLaProfesora = bloque();
    deLaProfesora.querySelectorAll('[data-sin-tarifa]').forEach((aviso) => aviso.remove());
    const htmlDeLaProfesora = deLaProfesora.outerHTML;
    cleanup();

    render(
      <section data-bloque="mi-liquidacion" className="flex flex-col gap-3">
        <LiquidacionLeida
          liquidacion={LIQUIDACION}
          avisoSinTarifa={(minutos) => (
            <p data-sin-tarifa>
              {`${minutos} minutos sin tarifa. `}
              <a href="/mi-gym/admin/horarios">Configurar la tarifa en Horarios</a>
            </p>
          )}
        />
      </section>,
    );
    const delAdmin = bloque();
    delAdmin.querySelectorAll('[data-sin-tarifa]').forEach((aviso) => aviso.remove());

    expect(htmlDeLaProfesora).toBe(delAdmin.outerHTML);
    // Y no es una igualdad de dos cadenas vacias.
    expect(delAdmin.outerHTML.length).toBeGreaterThan(500);
  });
});

// ---------------------------------------------------------------------------
// El selector de mes
// ---------------------------------------------------------------------------

describe('cambiar el mes', () => {
  it('cambiar el mes navega con anio y mes, y conserva lo demas de la URL', async () => {
    await montarYEsperar({ consulta: `${CONSULTA_DE_ENERO}&otra=cosa` });

    await userEvent.selectOptions(screen.getByLabelText('Mes'), '2026-9');

    expect(empujar).toHaveBeenCalledTimes(1);
    expect(empujar).toHaveBeenCalledWith(`${RUTA}?anio=2026&mes=9&otra=cosa`);
  });

  it('el selector marca el mes que se esta mirando y se llama «Mes»', async () => {
    await montarYEsperar({ consulta: 'anio=2026&mes=9' });

    const selector = screen.getByLabelText('Mes') as HTMLSelectElement;
    expect(selector.id).toBe('mi-liquidacion-mes');
    expect(selector.value).toBe('2026-9');
    expect(screen.getByRole('form', { name: 'Filtros' })).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Cuando falla
// ---------------------------------------------------------------------------

describe('cuando falla', () => {
  it('un 401 manda al login conservando la pagina', async () => {
    await montarYEsperar({ error: new ErrorDeApi('Unauthorized', 401) });

    expect(empujar).toHaveBeenCalledWith(
      `/mi-gym/login?volverA=${encodeURIComponent(`${RUTA}?${CONSULTA_DE_ENERO}`)}`,
    );
    // Y no se enseña el «Unauthorized» crudo ni se ofrece reintentar.
    expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull();
    expect(document.body.textContent).not.toContain('Unauthorized');
    expect(document.querySelector('[data-cifra]')).toBeNull();
  });

  it('un error que no es 401 se dice, con reintentar, y no pinta ningun importe', async () => {
    await montarYEsperar({ error: new ErrorDeApi('La base no contesta', 500) });

    expect(screen.getByRole('alert').textContent).toBe(
      'No se pudo leer tu liquidación: La base no contesta',
    );
    expect(empujar).not.toHaveBeenCalled();
    // Un fallo no es un mes de ceros.
    expect(document.querySelector('[data-cifra]')).toBeNull();

    pedirEspia.mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await esperar();

    expect(rutasPedidas()).toEqual(['/mi-liquidacion?anio=2026&mes=1']);
  });

  it('mientras carga lo dice, y no pinta ningun importe', () => {
    montar();

    expect(document.body.textContent).toContain('Cargando tu liquidación…');
    expect(document.querySelector('[data-cifra]')).toBeNull();
  });
});
