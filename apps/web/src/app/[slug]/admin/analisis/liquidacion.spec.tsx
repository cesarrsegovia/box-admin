import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FranjaDeLiquidacion, LiquidacionProfesor, UsuarioResumen } from '@boxadmin/shared';
import { ErrorDeApi } from '@/lib/cliente';
import type { Mes } from '@/hooks/use-stats';
import { vigilarEstosDatos } from '@/test/espia-de-consola';
import { BloqueDeLiquidacion } from './liquidacion';

// ---------------------------------------------------------------------------
// Andamiaje
// ---------------------------------------------------------------------------

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
  usePathname: () => '/mi-gym/admin/analisis',
}));

/** Se dobla `pedir`, no `fetch`: la URL exacta ya la fija `use-dinero.spec`. */
vi.mock('@/lib/cliente', async (original) => ({
  ...(await original<typeof import('@/lib/cliente')>()),
  pedir: pedirEspia,
}));

afterEach(() => {
  vi.clearAllMocks();
  busqueda.valor = '';
});

/** El mes que la pagina le pasa al bloque. Lo resuelve `page.tsx`, no este. */
const ENERO: Mes = { anio: 2026, mes: 1 };
const FEBRERO: Mes = { anio: 2026, mes: 2 };

// ---------------------------------------------------------------------------
// Los fijos
// ---------------------------------------------------------------------------

/**
 * LAS PROFESORAS, CON EL `id` DEL USUARIO Y EL `perfilId` DISTINTOS.
 *
 * `profesorId` en `/liquidacion/:profesorId` es un PERFIL: `LiquidacionDatos`
 * hace `perfil.findFirst({ where: { id: profesorId } })`. Con los dos ids
 * iguales, mandar el del usuario pasaria en verde; en la Fase 10 ese bug costo
 * una tarea entera.
 *
 * Y UNA ESTA DE BAJA. `GET /usuarios` sin `activo` devuelve las dos —el service
 * solo filtra si el filtro lo trae— y tiene que ser asi: una profesora que se
 * fue en febrero sigue teniendo que cobrar enero.
 */
const MARINA: UsuarioResumen = {
  id: 'u-marina',
  tenantId: 't-1',
  nombreCompleto: 'Marina Ferreyra',
  email: 'marina@gimnasio.test',
  rol: 'PROFESOR',
  activo: true,
  perfilId: 'pf-marina',
  telefono: null,
  packId: null,
  pagoAlDia: false,
  salaIds: ['s-1'],
};

const LUCIA: UsuarioResumen = {
  ...MARINA,
  id: 'u-lucia',
  nombreCompleto: 'Lucia Bianchi',
  email: 'lucia@gimnasio.test',
  activo: false,
  perfilId: 'pf-lucia',
};

/**
 * LAS CUATRO SITUACIONES DE UNA FRANJA, UNA DE CADA.
 *
 * Cada una sale de un horario distinto —por eso las tarifas difieren— y la
 * suplencia no tiene tarifa porque el gimnasio no tiene una general: el
 * service le da la del tenant, y es `null`. Es lo que hace que
 * `minutosSinTarifa` valga 90 y no sea un numero inventado.
 */
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

const NADIE_SE_ANOTO: FranjaDeLiquidacion = {
  fecha: '2026-01-14',
  salaId: 's-1',
  horaInicio: '20:00',
  horaFin: '21:00',
  minutos: 60,
  contratada: true,
  dictada: false,
  cerrada: false,
  motivoCierre: null,
  turnoId: null,
  tarifaPorHora: '1800.00',
  origenTarifa: 'HORARIO',
};

const FERIADO: FranjaDeLiquidacion = {
  fecha: '2026-01-16',
  salaId: 's-1',
  horaInicio: '08:00',
  horaFin: '09:00',
  minutos: 60,
  contratada: true,
  dictada: false,
  cerrada: true,
  motivoCierre: 'Feriado puente',
  turnoId: null,
  tarifaPorHora: '2000.00',
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
 * Tres cosas de este contrato SALEN DE OTRA, y las tres van mal a proposito
 * para que la pantalla no pueda calcularlas sin que se note:
 *
 * 1. LAS HORAS SALEN DE LOS MINUTOS. 150, 180 y 60 minutos son 2.50, 3.00 y
 *    1.00 horas; aqui dicen 7.25, 8.75 y 9.50.
 * 2. `aPagar` ES HOY EXACTAMENTE `dictadas`. Aqui no: 987.65 contra 1515.15.
 *    Una pantalla que sume —o que copie `dictadas`— paga lo de antes el dia que
 *    la regla cambie, y con cara de exactitud.
 * 3. EL `texto` SALE DE LOS `centavos`. En `dictadas` no: 150000 centavos son
 *    1500.00 y el texto dice 1515.15. Lo que se pinta es el texto, y el 1500.00
 *    solo podria aparecer si alguien formateara los centavos por su cuenta.
 *
 * LO DEMAS ES POSIBLE: los minutos cuadran con las franjas —contratados son
 * 90 + 60 porque EXCLUYEN la cerrada, dictados son 90 + 90 contando la
 * suplencia, cerrados son 60—, los importes de los otros dos grupos son su
 * tarifa por sus minutos, y `minutosSinTarifa` son los 90 de la suplencia.
 */
const LIQUIDACION: LiquidacionProfesor = {
  profesorId: 'pf-marina',
  profesorNombre: 'Marina Ferreyra',
  anio: ENERO.anio,
  mes: ENERO.mes,
  minutosContratados: 150,
  minutosDictados: 180,
  minutosCerrados: 60,
  horasContratadas: '7.25',
  horasDictadas: '8.75',
  horasCerradas: '9.50',
  franjas: [SE_DIO, NADIE_SE_ANOTO, FERIADO, SUPLENCIA],
  importes: {
    dictadas: { centavos: 150_000, texto: '1515.15' },
    contratadasSinDictar: { centavos: 180_000, texto: '1800.00' },
    cerradas: { centavos: 200_000, texto: '2000.00' },
    aPagar: { centavos: 98_765, texto: '987.65' },
    minutosSinTarifa: 90,
  },
};

/** La misma, con todas las tarifas puestas: nada queda sin importe. */
const CON_TODAS_LAS_TARIFAS: LiquidacionProfesor = {
  ...LIQUIDACION,
  franjas: [
    SE_DIO,
    NADIE_SE_ANOTO,
    FERIADO,
    { ...SUPLENCIA, tarifaPorHora: '1100.00', origenTarifa: 'TENANT' },
  ],
  importes: { ...LIQUIDACION.importes, minutosSinTarifa: 0 },
};

/**
 * UN MES SIN NADA: ni horarios ni clases. Son ceros de verdad —la API los
 * devuelve asi— y no se parecen a una lectura que fallo.
 */
const CERO = { centavos: 0, texto: '0.00' };
const MES_VACIO: LiquidacionProfesor = {
  ...LIQUIDACION,
  minutosContratados: 0,
  minutosDictados: 0,
  minutosCerrados: 0,
  horasContratadas: '0.00',
  horasDictadas: '0.00',
  horasCerradas: '0.00',
  franjas: [],
  importes: {
    dictadas: CERO,
    contratadasSinDictar: CERO,
    cerradas: CERO,
    aPagar: CERO,
    minutosSinTarifa: 0,
  },
};

/**
 * LO QUE COBRA CADA PROFESORA ES EL DATO MAS PERSONAL DEL PANEL.
 *
 * Se registra todo lo que tiene forma de secreto: los nombres, cada importe
 * pintado, el volcado de lo que se paga y cada tarifa —una tarifa por hora es
 * el sueldo de alguien escrito de otra forma—.
 */
vigilarEstosDatos({
  elNombreDeLaProfesora: 'Marina Ferreyra',
  elNombreDeLaQueSeFue: 'Lucia Bianchi',
  loQueSePaga: '987.65',
  elVolcadoDeLoQueSePaga: '"centavos":98765',
  loDictado: '1515.15',
  loContratadoSinDictar: '1800.00',
  loCerrado: '2000.00',
  laTarifaDelHorario: '1000.00',
});

// ---------------------------------------------------------------------------
// Montaje
// ---------------------------------------------------------------------------

interface OpcionesDeMontaje {
  /** El query de la URL, sin `?`. La profesora elegida vive ahi. */
  consulta?: string;
  mes?: Mes;
  profesoras?: UsuarioResumen[];
  /** Lo que contesta `/liquidacion/:id`, por perfil. */
  liquidaciones?: Record<string, LiquidacionProfesor>;
  errorDeProfesoras?: unknown;
  errorDeLiquidacion?: unknown;
}

function montar({
  consulta = 'anio=2026&mes=1&profesora=pf-marina',
  mes = ENERO,
  profesoras = [MARINA, LUCIA],
  liquidaciones = { 'pf-marina': LIQUIDACION },
  errorDeProfesoras,
  errorDeLiquidacion,
}: OpcionesDeMontaje = {}) {
  busqueda.valor = consulta;

  // POR RUTA y no por orden de llamada: agregar una peticion no corre las
  // respuestas una posicion.
  pedirEspia.mockImplementation((ruta: string) => {
    if (ruta === '/usuarios?tipo=profesor') {
      return errorDeProfesoras === undefined
        ? Promise.resolve(profesoras)
        : Promise.reject(errorDeProfesoras);
    }

    const deLiquidacion = /^\/liquidacion\/([^?]+)\?/.exec(ruta);
    if (deLiquidacion !== null) {
      if (errorDeLiquidacion !== undefined) return Promise.reject(errorDeLiquidacion);

      const liquidacion = liquidaciones[decodeURIComponent(deLiquidacion[1] ?? '')];
      return liquidacion === undefined
        ? Promise.reject(new ErrorDeApi('No hay ninguna profesora con ese id', 404))
        : Promise.resolve(liquidacion);
    }

    throw new Error(`La pantalla pidio una ruta que nadie espera: ${ruta}`);
  });

  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const arbol = (elMes: Mes) => (
    <QueryClientProvider client={cliente}>
      <BloqueDeLiquidacion mes={elMes} />
    </QueryClientProvider>
  );

  const { rerender } = render(arbol(mes));

  return {
    /** Vuelve a pintar con otra URL y otro mes, como hace Next al navegar. */
    navegar(otraConsulta: string, otroMes: Mes = mes) {
      busqueda.valor = otraConsulta;
      rerender(arbol(otroMes));
    },
  };
}

/** Deja que las consultas se resuelvan (o se rompan) y que React pinte. */
async function esperar(): Promise<void> {
  await act(async () => {
    for (let vuelta = 0; vuelta < 5; vuelta += 1) {
      await new Promise((resolver) => setTimeout(resolver, 0));
    }
  });
}

/** Las rutas pedidas, ordenadas y SIN deduplicar: lo que se cuida es la cuenta. */
function rutasPedidas(): string[] {
  return pedirEspia.mock.calls.map(([ruta]) => ruta as string).sort();
}

function bloque(): HTMLElement {
  const nodo = document.querySelector<HTMLElement>('[data-bloque="liquidacion"]');
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

function selectorDeProfesora(): HTMLSelectElement {
  return screen.getByLabelText('Profesora');
}

// ---------------------------------------------------------------------------
// Elegir la profesora
// ---------------------------------------------------------------------------

describe('elegir la profesora', () => {
  it('sin profesora elegida pide la lista y NADA MAS', async () => {
    // La liquidacion de nadie no se pide: no hay una por defecto, y elegir la
    // primera de la lista seria pedir el sueldo de alguien que nadie busco.
    montar({ consulta: 'anio=2026&mes=1' });
    await esperar();

    expect(rutasPedidas()).toEqual(['/usuarios?tipo=profesor']);
    expect(bloque().textContent).toContain('Elegí una profesora para ver su liquidación.');
    expect(bloque().querySelector('[data-cifra]')).toBeNull();
  });

  it('un `?profesora=` vacio es lo mismo que no elegir', async () => {
    // `''` es lo que deja el selector en «Elegí una profesora». Para la API no
    // es «ninguna»: es `/liquidacion/?anio=…`, otra ruta.
    montar({ consulta: 'anio=2026&mes=1&profesora=' });
    await esperar();

    expect(rutasPedidas()).toEqual(['/usuarios?tipo=profesor']);
  });

  it('las opciones son PERFILES, y no ids de usuario', async () => {
    montar({ consulta: 'anio=2026&mes=1' });
    await esperar();

    const valores = [...selectorDeProfesora().options].map((opcion) => opcion.value);
    expect(valores).toEqual(['', 'pf-marina', 'pf-lucia']);
  });

  it('la que esta de baja se ofrece igual, y se dice', async () => {
    // Una profesora que se fue en febrero sigue cobrando enero.
    montar({ consulta: 'anio=2026&mes=1' });
    await esperar();

    const textos = [...selectorDeProfesora().options].map((opcion) => opcion.textContent);
    expect(textos).toEqual(['Elegí una profesora', 'Marina Ferreyra', 'Lucia Bianchi (de baja)']);
  });

  it('elegir escribe la URL y CONSERVA el mes', async () => {
    // La profesora vive en la URL igual que el mes: se comparte por chat, y el
    // boton de atras vuelve a la de antes.
    montar({ consulta: 'anio=2026&mes=1' });
    await esperar();

    await userEvent.selectOptions(selectorDeProfesora(), 'pf-lucia');

    expect(empujar).toHaveBeenCalledTimes(1);
    expect(empujar).toHaveBeenCalledWith(
      '/mi-gym/admin/analisis?anio=2026&mes=1&profesora=pf-lucia',
    );
  });

  it('volver a «Elegí una profesora» QUITA la clave, no la deja vacia', async () => {
    montar();
    await esperar();

    await userEvent.selectOptions(selectorDeProfesora(), '');

    expect(empujar).toHaveBeenCalledWith('/mi-gym/admin/analisis?anio=2026&mes=1');
  });

  it('pide la liquidacion de ESE perfil y de ESE mes', async () => {
    montar();
    await esperar();

    expect(rutasPedidas()).toEqual([
      '/liquidacion/pf-marina?anio=2026&mes=1',
      '/usuarios?tipo=profesor',
    ]);
    // Y el id del USUARIO no viaja nunca.
    expect(rutasPedidas().filter((ruta) => ruta.includes('u-marina'))).toEqual([]);
    // El selector marca a la que se esta mirando.
    expect(selectorDeProfesora().value).toBe('pf-marina');
  });

  it('elegir otra profesora, u otro mes, es otra consulta', async () => {
    // Una clave que no llevara la profesora —o el mes— le enseñaria a una el
    // sueldo de otra, sacado de la cache, sin pedir nada.
    const pantalla = montar({
      liquidaciones: {
        'pf-marina': LIQUIDACION,
        'pf-lucia': { ...LIQUIDACION, profesorId: 'pf-lucia', profesorNombre: 'Lucia Bianchi' },
      },
    });
    await esperar();

    pantalla.navegar('anio=2026&mes=1&profesora=pf-lucia');
    await esperar();
    pantalla.navegar('anio=2026&mes=2&profesora=pf-lucia', FEBRERO);
    await esperar();

    expect(rutasPedidas().filter((ruta) => ruta.startsWith('/liquidacion'))).toEqual([
      '/liquidacion/pf-lucia?anio=2026&mes=1',
      '/liquidacion/pf-lucia?anio=2026&mes=2',
      '/liquidacion/pf-marina?anio=2026&mes=1',
    ]);
  });

  it('un fallo al leer la lista de profesoras se dice, y no la esconde', async () => {
    montar({
      consulta: 'anio=2026&mes=1',
      errorDeProfesoras: new ErrorDeApi('La base no contesta', 500),
    });
    await esperar();

    expect(within(bloque()).getByRole('alert').textContent).toBe(
      'No se pudo leer la lista de profesoras: La base no contesta',
    );
  });
});

// ---------------------------------------------------------------------------
// Las franjas
// ---------------------------------------------------------------------------

/** La situacion de cada fila de la tabla, por su atributo. */
function situaciones(): (string | null)[] {
  return [...bloque().querySelectorAll('[data-situacion]')].map((nodo) =>
    nodo.getAttribute('data-situacion'),
  );
}

function textoDeLaSituacion(situacion: string): string {
  return bloque().querySelector(`[data-situacion="${situacion}"]`)?.textContent?.trim() ?? '';
}

describe('las franjas', () => {
  it('las cuatro situaciones de una franja se distinguen', async () => {
    // Un «se dio / no se dio» las convierte en dos, y son cuatro con
    // consecuencias distintas: nadie se anoto es una conversacion con la
    // profesora, un feriado no, y una suplencia se paga sin contrato.
    montar();
    await esperar();

    expect(situaciones()).toEqual(['dictada', 'sin-alumnos', 'cerrada', 'suplencia']);

    const textos = ['dictada', 'sin-alumnos', 'cerrada', 'suplencia'].map(textoDeLaSituacion);
    expect(new Set(textos).size, `dos situaciones se dicen igual: ${textos.join(' | ')}`).toBe(4);
  });

  it('nadie se anoto NO se pinta como un feriado', async () => {
    // Las dos son «contratada y no dictada»; las separa solo `cerrada`.
    montar();
    await esperar();

    expect(textoDeLaSituacion('sin-alumnos')).toBe('Nadie se anotó');
    expect(textoDeLaSituacion('cerrada')).toBe('Salón cerrado: Feriado puente');
  });

  it('la suplencia dice que no tenia contrato', async () => {
    montar();
    await esperar();

    expect(textoDeLaSituacion('suplencia')).toBe('Suplencia, sin contrato');
    expect(textoDeLaSituacion('dictada')).toBe('Se dio');
  });

  it('la tarifa de cada franja dice de donde sale, y la que falta se dice', async () => {
    montar();
    await esperar();

    const tarifas = [...bloque().querySelectorAll('[data-tarifa]')].map((nodo) =>
      nodo.textContent?.trim(),
    );
    expect(tarifas).toEqual([
      '1000.00 (del horario)',
      '1800.00 (del horario)',
      '2000.00 (del horario)',
      'Sin tarifa',
    ]);
  });

  it('un mes sin franjas se distingue de un fallo al leer', async () => {
    montar({ liquidaciones: { 'pf-marina': MES_VACIO } });
    await esperar();

    expect(bloque().textContent).toContain(
      'Marina Ferreyra no tiene ninguna franja en enero 2026: ni horarios contratados ni clases dadas.',
    );
    expect(within(bloque()).queryByRole('alert')).toBeNull();
    // Y los ceros SI se pintan: son el dato, no la falta de dato.
    expect(importeDe('aPagar')).toBe('0.00');
  });

  it('y el fallo no pinta ni un numero, ni el cartel del mes vacio', async () => {
    montar({ errorDeLiquidacion: new ErrorDeApi('La base no contesta', 500) });
    await esperar();

    expect(within(bloque()).getByRole('alert').textContent).toBe(
      'No se pudo leer la liquidacion: La base no contesta',
    );
    expect(bloque().querySelector('[data-cifra]')).toBeNull();
    expect(bloque().textContent).not.toContain('no tiene ninguna franja');
    expect(
      within(bloque()).getByRole('button', { name: 'Reintentar la liquidacion' }),
    ).toBeInTheDocument();
  });

  it('una profesora que la API no conoce se dice con las palabras de la API', async () => {
    // Un `?profesora=` viejo o escrito a mano: el 404 trae su motivo.
    montar({ consulta: 'anio=2026&mes=1&profesora=pf-nadie' });
    await esperar();

    expect(within(bloque()).getByRole('alert').textContent).toBe(
      'No se pudo leer la liquidacion: No hay ninguna profesora con ese id',
    );
  });

  it('una sesion caducada no se dibuja aqui: la pagina ya lo dice una vez', async () => {
    montar({
      errorDeProfesoras: new ErrorDeApi('Unauthorized', 401),
      errorDeLiquidacion: new ErrorDeApi('Unauthorized', 401),
    });
    await esperar();

    expect(document.querySelector('[data-bloque="liquidacion"]')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Los numeros
// ---------------------------------------------------------------------------

describe('los numeros', () => {
  it('el encabezado sale de la RESPUESTA: el nombre y el mes que volvieron', async () => {
    montar();
    await esperar();

    expect(within(bloque()).getByRole('heading', { level: 2 }).textContent).toBe(
      'La liquidación de Marina Ferreyra, enero 2026',
    );
  });

  it('`aPagar` sale del servidor, no de la suma de lo que se ve', async () => {
    // Hoy es exactamente `dictadas`, y el fijo lo desalinea: 987.65 contra
    // 1515.15. La pantalla pinta el que mando el servidor.
    montar();
    await esperar();

    expect(importeDe('aPagar')).toBe('987.65');
  });

  it('cada importe se pinta con su `texto`, y ninguno sale de una cuenta', async () => {
    montar();
    await esperar();

    expect(importeDe('dictadas')).toBe('1515.15');
    expect(importeDe('contratadasSinDictar')).toBe('1800.00');
    expect(importeDe('cerradas')).toBe('2000.00');

    // 150000 centavos son 1500.00: solo apareceria formateando los centavos.
    // Y 5315.15 / 5300.00 son las sumas de los tres grupos por texto y por
    // centavos. Ninguno de los tres esta en ningun sitio del documento.
    expect(document.body.textContent).not.toContain('1500.00');
    expect(document.body.textContent).not.toContain('5315.15');
    expect(document.body.textContent).not.toContain('5300.00');
  });

  it('solo lo dictado se paga, y se dice en cada grupo', async () => {
    montar();
    await esperar();

    const nota = (grupo: string) =>
      bloque().querySelector(`[data-cifra="${grupo}"] [data-nota]`)?.textContent?.trim();

    expect(nota('dictadas')).toBe('Se paga.');
    expect(nota('contratadasSinDictar')).toBe(
      'No se paga: horas contratadas a las que nadie se anotó.',
    );
    expect(nota('cerradas')).toBe('No se paga: horas con el salón cerrado.');
  });

  it('las horas no se recalculan de los minutos', async () => {
    // 150, 180 y 60 minutos son 2.50, 3.00 y 1.00 horas. El servidor manda
    // 7.25, 8.75 y 9.50, y son esos los que se pintan.
    montar();
    await esperar();

    expect(horasDe('contratadas')).toBe('7.25');
    expect(horasDe('dictadas')).toBe('8.75');
    expect(horasDe('cerradas')).toBe('9.50');
  });
});

// ---------------------------------------------------------------------------
// Los minutos sin tarifa
// ---------------------------------------------------------------------------

function avisoSinTarifa(): HTMLElement | null {
  return bloque().querySelector('[data-cifra="aPagar"] [data-sin-tarifa]');
}

describe('los minutos sin tarifa', () => {
  it('se dicen AL LADO del importe, con palabras y no en un `title`', async () => {
    // Un importe al que le faltan horas y no lo dice parece completo y no lo
    // esta. Dentro de la MISMA cifra que lo que se paga: una nota al pie llega
    // tarde, y un `title` no lo lee nadie que no pase el raton.
    montar();
    await esperar();

    const aviso = avisoSinTarifa();
    expect(aviso, 'el aviso no esta dentro de la cifra de lo que se paga').not.toBeNull();
    expect(aviso?.textContent).toContain(
      '90 minutos de este mes no tienen tarifa, así que estos importes están incompletos.',
    );
    expect(bloque().querySelector('[title]')).toBeNull();
  });

  it('y la pantalla dice adonde ir a arreglarlo', async () => {
    montar();
    await esperar();

    const enlace = within(avisoSinTarifa() ?? document.createElement('div')).getByRole('link');
    expect(enlace.getAttribute('href')).toBe('/mi-gym/admin/horarios');
    expect(enlace.textContent).toBe('Configurar la tarifa en Horarios');
  });

  it('el aviso es UNO solo: lo que pinta la pantalla y nada que el componente compartido anada', async () => {
    // Fase 15: la vista se comparte con el area de la profesora. Si el
    // componente compartido pintara un aviso propio ademas del recibido, el
    // `querySelector` de arriba solo veria el primero y todo seguiria en verde.
    montar();
    await esperar();

    expect(bloque().querySelectorAll('[data-sin-tarifa]')).toHaveLength(1);
    expect(bloque().textContent?.match(/minutos de este mes no tienen tarifa/g)).toHaveLength(1);
  });

  it('el unico enlace del bloque es el del aviso', async () => {
    // Fase 15: el componente compartido no puede agregar un enlace propio (a
    // Horarios o a donde sea) que el admin vea de mas y la profesora tambien.
    // Se cuentan los enlaces de todo el bloque, con aviso y sin el.
    montar();
    await esperar();

    const enlaces = Array.from(bloque().querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(enlaces).toEqual(['/mi-gym/admin/horarios']);
  });

  it('y sin aviso el bloque no tiene ningun enlace', async () => {
    montar({ liquidaciones: { 'pf-marina': CON_TODAS_LAS_TARIFAS } });
    await esperar();

    // La premisa: la liquidacion se pinto. Sin esto el test pasaria en verde
    // sobre «Cargando…», sobre el error o sobre la sesion caducada.
    expect(importeDe('aPagar')).toBe('987.65');
    expect(bloque().querySelectorAll('a')).toHaveLength(0);
  });

  it('con todas las tarifas puestas no hay aviso', async () => {
    // La otra mitad: un aviso que esta siempre no avisa de nada.
    montar({ liquidaciones: { 'pf-marina': CON_TODAS_LAS_TARIFAS } });
    await esperar();

    // La premisa: la liquidacion se pinto (ver el test de arriba).
    expect(importeDe('aPagar')).toBe('987.65');
    expect(avisoSinTarifa()).toBeNull();
    expect(bloque().textContent).not.toContain('no tienen tarifa');
  });
});
