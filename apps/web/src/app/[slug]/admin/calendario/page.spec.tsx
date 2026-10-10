import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { MesCalendarioPublico, PlanDeMes, SalaPublica } from '@boxadmin/shared';
import { ErrorDeApi } from '@/lib/cliente';
import { rutaDeRetornoSegura } from '@/lib/ruta-de-retorno';
import { clavesDeCatalogos } from '@/hooks/use-catalogos';
import { mesesOfrecidos } from './meses';
import PaginaDeCalendario from './page';

// ---------------------------------------------------------------------------
// Andamiaje
// ---------------------------------------------------------------------------

const { empujar, reemplazar, pedirEspia, busqueda } = vi.hoisted(() => ({
  empujar: vi.fn(),
  reemplazar: vi.fn(),
  pedirEspia: vi.fn(),
  // Mutable a proposito: `useSearchParams` se llama en cada render y tiene que
  // devolver lo que el test de turno puso, no lo que habia al cargar el modulo.
  busqueda: { parametros: new URLSearchParams() },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: empujar, replace: reemplazar, refresh: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => busqueda.parametros,
  usePathname: () => '/mi-gym/admin/calendario',
  useParams: () => ({ slug: 'mi-gym' }),
}));

/**
 * Se dobla `pedir` y no `fetch`, igual que en el listado de personas.
 *
 * Que `pedir` arme bien la URL ya lo fija `use-calendario-admin.spec`. Lo que
 * se audita aqui es un escalon mas arriba: QUE rutas decide pedir la pantalla a
 * partir de lo que leyo de la URL.
 */
vi.mock('@/lib/cliente', async (original) => ({
  ...(await original<typeof import('@/lib/cliente')>()),
  pedir: pedirEspia,
}));

/**
 * EL RELOJ, CONGELADO Y SOLO EL RELOJ.
 *
 * Los meses que la pantalla ofrece salen de `mesesOfrecidos(new Date())`, asi
 * que sin congelar el reloj este archivo entero cambiaria de significado cada
 * primero de mes y los `anio=2026&mes=11` escritos a mano caducarian solos.
 *
 * Se falsea `Date` y NADA MAS (`toFake: ['Date']`): los temporizadores siguen
 * siendo de verdad, que es lo que necesitan `userEvent` y las esperas de
 * `esperar()`. Falsear `setTimeout` aqui dejaria los dos colgados y el sondeo
 * de `useMesDelCalendario` no es lo que se prueba en este archivo.
 */
const AHORA = new Date(Date.UTC(2026, 9, 15));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AHORA);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

function unaSala(cambios: Partial<SalaPublica> = {}): SalaPublica {
  return {
    id: 's1',
    tenantId: 't-del-gimnasio',
    nombre: 'Sala Pilates',
    activa: true,
    visibleAlumnos: true,
    soloCuposLiberados: false,
    exclusiva: false,
    cupoBase: 10,
    minMinutosCancelar: null,
    minMinutosAnotarse: null,
    listaEsperaHabilitada: null,
    ...cambios,
  };
}

const SALAS: SalaPublica[] = [unaSala(), unaSala({ id: 's2', nombre: 'Sala Funcional' })];

function unPlan(): PlanDeMes {
  return {
    turnosACrear: [],
    reservasACrear: [],
    etiquetasDeProfesor: [],
    conflictos: [],
    exclusiones: [],
    resumen: { turnos: 0, reservas: 0, conflictos: 0, exclusiones: 0 },
  };
}

function unMes(cambios: Partial<MesCalendarioPublico> = {}): MesCalendarioPublico {
  return {
    id: 'm1',
    tenantId: 't-del-gimnasio',
    salaId: 's1',
    anio: 2026,
    mes: 11,
    estado: 'BORRADOR',
    publicadoEn: null,
    publicadoPor: null,
    publicacion: null,
    ...cambios,
  };
}

/**
 * Monta la pantalla con su propio `QueryClient`.
 *
 * El doble de `pedir` responde POR RUTA y no por orden de llamada: la pantalla
 * lanza tres consultas y el orden en que React Query las dispara no es asunto
 * de ningun test de aqui.
 *
 * El catalogo de salas SI se siembra, y nada mas. Es un prerrequisito para que
 * el selector tenga opciones en el primer pintado, no lo que se audita aqui;
 * sembrarlo no apaga la peticion, porque la consulta nace rancia y se pide
 * igual. El plan y el mes NO se siembran: que se pidan es justo la senal.
 */
function montar({
  busqueda: textoDeBusqueda = '',
  salas = SALAS,
  mes = unMes(),
  error,
}: {
  busqueda?: string;
  salas?: SalaPublica[];
  mes?: MesCalendarioPublico;
  /** Con que rompen LAS DOS consultas del calendario. El catalogo sigue bien. */
  error?: unknown;
} = {}): QueryClient {
  busqueda.parametros = new URLSearchParams(textoDeBusqueda);

  pedirEspia.mockImplementation((ruta: string) => {
    if (ruta === '/salas') return Promise.resolve(salas);
    if (ruta === '/usuarios') return Promise.resolve([]);
    if (error !== undefined) return Promise.reject(error);
    if (ruta.endsWith('/previsualizar')) return Promise.resolve(unPlan());
    return Promise.resolve(mes);
  });

  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  cliente.setQueryData(clavesDeCatalogos.salas(), salas);

  render(
    <QueryClientProvider client={cliente}>
      <PaginaDeCalendario />
    </QueryClientProvider>,
  );

  return cliente;
}

/** Deja que las consultas se resuelvan y que React pinte lo que sigue. */
async function esperar(): Promise<void> {
  await act(async () => {
    for (let vuelta = 0; vuelta < 5; vuelta += 1) {
      await new Promise((resolver) => setTimeout(resolver, 0));
    }
  });
}

/**
 * Elige una opcion por su TEXTO, que es lo unico que ve el admin.
 *
 * `selectOptions` con una cadena busca por `value`, y el valor de un mes es
 * `2026-11`, que no es lo que nadie lee en la pantalla. Acepta tambien una
 * expresion regular para no tener que escribir el ano en cada llamada.
 */
async function elegir(etiqueta: string, opcion: string | RegExp): Promise<void> {
  const usuario = userEvent.setup();
  const control = screen.getByLabelText(etiqueta);
  const elegida = [...control.querySelectorAll('option')].find((option) => {
    const texto = option.textContent?.trim() ?? '';
    return typeof opcion === 'string' ? texto === opcion : opcion.test(texto);
  });

  if (elegida === undefined)
    throw new Error(`El selector "${etiqueta}" no tiene "${String(opcion)}"`);

  await usuario.selectOptions(control, elegida);
}

/** Los `value` de un selector, en orden y con el hueco vacio incluido. */
function valoresDe(etiqueta: string): string[] {
  const control = screen.getByLabelText(etiqueta);
  return [...control.querySelectorAll('option')].map((option) => option.value);
}

/** Los textos de un selector, en orden. */
function textosDe(etiqueta: string): string[] {
  const control = screen.getByLabelText(etiqueta);
  return [...control.querySelectorAll('option')].map((option) => option.textContent?.trim() ?? '');
}

/**
 * Las rutas pedidas, ORDENADAS Y SIN DEDUPLICAR.
 *
 * Se ordena porque el orden en que React Query dispara tres consultas
 * independientes no es una decision de la pantalla. NO se deduplica porque
 * pedir dos veces lo mismo tambien es un fallo, y un `new Set` lo escondaria.
 */
function rutasPedidas(): string[] {
  return pedirEspia.mock.calls.map(([ruta]) => ruta as string).sort();
}

/** Todo lo que un almacen del navegador tiene dentro, sin preguntar por claves. */
function contenidoDe(almacen: Storage): Record<string, string> {
  const guardado: Record<string, string> = {};

  for (let indice = 0; indice < almacen.length; indice += 1) {
    const clave = almacen.key(indice);
    if (clave !== null) guardado[clave] = almacen.getItem(clave) ?? '';
  }

  return guardado;
}

/** Los `<select>` que hay en el marcado, por su etiqueta. */
function selectoresDelDocumento(): string[] {
  return [...document.querySelectorAll('select')].map((select) => {
    const etiqueta = document.querySelector(`label[for="${select.id}"]`);
    return etiqueta?.textContent?.trim() ?? select.id;
  });
}

// ---------------------------------------------------------------------------
// La pantalla no pide nada hasta que la URL dice que y de quien
// ---------------------------------------------------------------------------

describe('sin eleccion completa, la pantalla no molesta a la API', () => {
  it('sin sala ni mes, solo se ven los selectores', () => {
    montar({ busqueda: '' });

    expect(selectoresDelDocumento()).toEqual(['Sala', 'Mes']);
    expect(pedirEspia).not.toHaveBeenCalledWith(expect.stringContaining('/calendario/'));
  });

  it.each([
    ['solo la sala', '?salaId=s1'],
    ['solo el mes', '?anio=2026&mes=11'],
    ['la sala y medio mes', '?salaId=s1&anio=2026'],
  ])('con %s no se pide nada del calendario', (_caso, texto) => {
    montar({ busqueda: texto });

    expect(rutasPedidas()).toEqual(['/salas']);
  });
});

// ---------------------------------------------------------------------------
// Los selectores escriben la URL
// ---------------------------------------------------------------------------

describe('los selectores', () => {
  it('elegir una sala la escribe en la URL', async () => {
    montar({ busqueda: '' });

    await elegir('Sala', 'Sala Pilates');

    expect(empujar).toHaveBeenCalledWith('/mi-gym/admin/calendario?salaId=s1');
  });

  it('elegir un mes lo escribe SIN perder la sala', async () => {
    montar({ busqueda: '?salaId=s1' });

    await elegir('Mes', /noviembre/i);

    expect(empujar).toHaveBeenCalledWith('/mi-gym/admin/calendario?salaId=s1&anio=2026&mes=11');
  });

  it('elegir una sala NO pierde el mes ya elegido', async () => {
    montar({ busqueda: '?anio=2026&mes=11' });

    await elegir('Sala', 'Sala Funcional');

    expect(empujar).toHaveBeenCalledWith('/mi-gym/admin/calendario?anio=2026&mes=11&salaId=s2');
  });

  it('volver al hueco vacio saca el parametro, no lo manda vacio', async () => {
    // `?salaId=` no es "sin sala": seria una ruta `/calendario//2026/11`.
    montar({ busqueda: '?salaId=s1&anio=2026&mes=11' });

    await elegir('Sala', 'Elegi una sala');

    expect(empujar).toHaveBeenCalledWith('/mi-gym/admin/calendario?anio=2026&mes=11');
  });

  it('los selectores muestran lo que dice la URL', () => {
    montar({ busqueda: '?salaId=s2&anio=2026&mes=11' });

    expect(screen.getByLabelText('Sala')).toHaveValue('s2');
    expect(screen.getByLabelText('Mes')).toHaveValue('2026-11');
  });

  /**
   * UNA sola navegacion por cambio.
   *
   * `toHaveBeenCalledWith` nunca pregunta cuantas veces: un `push` de cortesia
   * antes del bueno pasa por delante de todos los tests de destino, y en la
   * pantalla se ve como un parpadeo y una entrada basura en el historial que
   * deja el boton de atras sin funcionar.
   */
  it.each([
    ['Sala', 'Sala Pilates' as string | RegExp],
    ['Mes', /noviembre/i],
  ])('cambiar %s navega UNA sola vez', async (etiqueta, opcion) => {
    montar({ busqueda: '' });

    await elegir(etiqueta, opcion);

    expect(empujar).toHaveBeenCalledTimes(1);
    expect(reemplazar).not.toHaveBeenCalled();
  });

  /**
   * LO QUE QUEDA ESCRITO EN LA URL, que es lo que se comparte y lo que entra
   * en el historial del navegador.
   *
   * Lista blanca de CLAVES: los tests de arriba fijan la cadena entera para los
   * casos que miran, pero ninguno impide que un cambio futuro cuele un
   * `tenantId`, un `salaNombre` o un `t=` de cache en una rama que nadie fija.
   */
  it('en la URL no se escribe nada mas que estas tres claves', async () => {
    montar({ busqueda: '?salaId=s1' });

    await elegir('Mes', /noviembre/i);

    const [destino] = empujar.mock.calls[0] as [string];
    const [ruta, consulta = ''] = destino.split('?');

    expect(ruta).toBe('/mi-gym/admin/calendario');
    expect([...new URLSearchParams(consulta).keys()].sort()).toEqual(['anio', 'mes', 'salaId']);
  });
});

// ---------------------------------------------------------------------------
// Los meses ofrecidos
// ---------------------------------------------------------------------------

describe('el selector de meses', () => {
  // LISTA BLANCA: el conjunto ENTERO contra `mesesOfrecidos`, no una muestra.
  // Ofrecer un mes pasado es un 400 garantizado, y un mes de mas al final es
  // planificar sobre rutinas que todavia no existen.
  it('el selector ofrece ESTOS meses y solo estos', () => {
    montar({ busqueda: '' });

    const esperados = mesesOfrecidos(AHORA).map((m) => `${m.anio}-${m.mes}`);

    expect(valoresDe('Mes')).toEqual(['', ...esperados]);
  });

  it('cada mes se lee con su nombre y su ano, no con un numero', () => {
    montar({ busqueda: '' });

    expect(textosDe('Mes').slice(0, 4)).toEqual([
      'Elegi un mes',
      'octubre 2026',
      'noviembre 2026',
      'diciembre 2026',
    ]);
  });

  it('el selector de salas ofrece las del catalogo y el hueco vacio', () => {
    montar({ busqueda: '' });

    expect(textosDe('Sala')).toEqual(['Elegi una sala', 'Sala Pilates', 'Sala Funcional']);
    expect(valoresDe('Sala')).toEqual(['', 's1', 's2']);
  });
});

// ---------------------------------------------------------------------------
// Lo que la pantalla pide cuando la URL esta completa
// ---------------------------------------------------------------------------

describe('con sala y mes en la URL', () => {
  it('lee sala y mes DE la URL y pide el plan', () => {
    montar({ busqueda: '?salaId=s1&anio=2026&mes=11' });

    expect(pedirEspia).toHaveBeenCalledWith('/calendario/s1/2026/11/previsualizar', {
      metodo: 'POST',
    });
  });

  /**
   * LISTA BLANCA DE PETICIONES, y existe por un motivo concreto: que no se
   * cuele `GET /calendario/:salaId/:anio/:mes/conflictos`.
   *
   * Ese endpoint devuelve exactamente `plan.conflictos`, que la previsualizacion
   * ya trae dentro. Pedirlo seria una segunda peticion para un dato que ya
   * esta, y abriria la puerta a que las dos respuestas discrepen y la pantalla
   * ensene un numero de conflictos que no es el del plan que va a publicar.
   * De los cuatro endpoints del modulo, esta pantalla usa tres.
   *
   * `/usuarios` SI entra, y no es del modulo del calendario: es la lista contra
   * la que se resuelve el NOMBRE del alumno de cada conflicto. Un conflicto que
   * no nombra a quien afecta no se puede resolver, y la alternativa —pedir
   * `/usuarios/:id` por cada perfil— serian N peticiones por mes.
   *
   * Sin deduplicar: pedir dos veces lo mismo tambien es un fallo.
   */
  it('salen ESTAS peticiones y ninguna mas', async () => {
    montar({ busqueda: '?salaId=s1&anio=2026&mes=11' });

    await esperar();

    expect(rutasPedidas()).toEqual([
      '/calendario/s1/2026/11',
      '/calendario/s1/2026/11/previsualizar',
      '/salas',
      '/usuarios',
    ]);
  });

  it('el estado del mes se ve', async () => {
    montar({ busqueda: '?salaId=s1&anio=2026&mes=11', mes: unMes({ estado: 'HABILITADO' }) });

    await esperar();

    expect(screen.getByText(/publicado/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// La URL la escribe cualquiera
// ---------------------------------------------------------------------------

describe('una URL imposible no se manda a la API', () => {
  it('un mes imposible en la URL no se manda a la API', () => {
    // Sin esto es un 400 y una pantalla en blanco.
    montar({ busqueda: '?salaId=s1&anio=2026&mes=13' });

    expect(pedirEspia).not.toHaveBeenCalledWith(expect.stringContaining('/13'), expect.anything());
    expect(rutasPedidas()).toEqual(['/salas']);
  });

  it.each([
    ['el mes 13', '?salaId=s1&anio=2026&mes=13'],
    ['el mes 0', '?salaId=s1&anio=2026&mes=0'],
    ['el mes negativo', '?salaId=s1&anio=2026&mes=-1'],
    ['un ano que no es numero', '?salaId=s1&anio=abc&mes=11'],
    ['un mes que no es numero', '?salaId=s1&anio=2026&mes=noviembre'],
    ['un mes decimal', '?salaId=s1&anio=2026&mes=11.5'],
    ['un mes del pasado', '?salaId=s1&anio=2026&mes=9'],
    ['un ano del pasado', '?salaId=s1&anio=2025&mes=11'],
    ['un ano demasiado lejos', '?salaId=s1&anio=2030&mes=11'],
  ])('con %s solo se pide el catalogo de salas', (_caso, texto) => {
    montar({ busqueda: texto });

    expect(rutasPedidas()).toEqual(['/salas']);
  });

  it('un mes imposible deja el selector en el hueco vacio, no inventa una opcion', () => {
    // Pintar `?mes=13` como una opcion mas seria ofrecer lo que la API rechaza.
    montar({ busqueda: '?salaId=s1&anio=2026&mes=13' });

    expect(screen.getByLabelText('Mes')).toHaveValue('');
    expect(valoresDe('Mes')).toEqual([
      '',
      ...mesesOfrecidos(AHORA).map((m) => `${m.anio}-${m.mes}`),
    ]);
  });
});

// ---------------------------------------------------------------------------
// Lo que la pantalla deja guardado
// ---------------------------------------------------------------------------

describe('pintar la pantalla no deja rastro', () => {
  /**
   * `localStorage` sobrevive al cierre del navegador, al logout y al cambio de
   * turno. Guardar ahi "la ultima sala elegida, para que abra donde estabas"
   * contradice ademas la decision que gobierna esta pantalla: el estado esta en
   * la URL, y una preferencia guardada le gana a un enlace compartido sin que
   * nadie entienda por que ve otro mes que quien se lo mando.
   */
  it('no queda nada en el almacenamiento del navegador', async () => {
    montar({ busqueda: '?salaId=s1&anio=2026&mes=11' });

    await esperar();

    expect({
      local: contenidoDe(localStorage),
      sesion: contenidoDe(sessionStorage),
    }).toEqual({ local: {}, sesion: {} });
  });

  it('en la cache no queda ninguna consulta de mas', async () => {
    const cliente = montar({ busqueda: '?salaId=s1&anio=2026&mes=11' });

    await esperar();

    expect(
      cliente
        .getQueryCache()
        .getAll()
        .map((consulta) => consulta.queryKey)
        .sort(),
    ).toEqual([
      ['mes-calendario', 's1', 2026, 11],
      ['plan-del-mes', 's1', 2026, 11],
      ['salas'],
      ['usuarios', {}],
    ]);
  });
});

// ---------------------------------------------------------------------------
// NAVEGAR: cuando NO se navega (aqui) y cuando SI (el bloque de abajo)
//
// Los dos bloques dicen cosas que suenan opuestas y no lo son, y van juntos a
// proposito para que se lean juntos. La frontera entre ellos es UNA sola: que
// haya un error de sesion de por medio.
//
//   - Aqui: SIN error, montar la pantalla no navega NUNCA, diga lo que diga la
//     URL. Lo que se fija es el eje entero, no un caso.
//   - Abajo: CON un 401, navegar al login es justamente lo que tiene que pasar,
//     y una sola vez.
// ---------------------------------------------------------------------------

/**
 * MONTAR NO ES NAVEGAR.
 *
 * Esto no es un test de un caso: es un EJE que no auditaba nadie. Todos los
 * tests de navegacion de este archivo disparan desde un `onChange`, o sea que
 * miran cuantas veces se navega AL CAMBIAR ALGO. Ninguno miraba la navegacion
 * EN EL MONTAJE, y por ese hueco pasa entera una pantalla que "normaliza" la
 * URL: un `useEffect` que, al ver un mes imposible, hace `router.push` para
 * limpiarlo. Se midio — esa mutacion paso los 31 tests anteriores en verde.
 *
 * El daño es concreto: reescribe en silencio el enlace que alguien compartio,
 * mete una entrada basura en el historial, y como la URL limpia vuelve a ser
 * la sucia al pulsar atras, el boton de atras entra en un bucle visible.
 *
 * Por eso la lista barre la URL vacia, la media, la completa, la imposible y
 * la que lleva parametros ajenos: lo que queda fijado es «esta pantalla no
 * navega sola», no «con `?mes=13` no navega».
 */
describe('montar la pantalla no navega sola, sin un error de por medio', () => {
  it.each([
    ['la URL vacia', ''],
    ['solo la sala', '?salaId=s1'],
    ['solo el mes', '?anio=2026&mes=11'],
    ['la eleccion completa y valida', '?salaId=s1&anio=2026&mes=11'],
    ['un mes imposible', '?salaId=s1&anio=2026&mes=13'],
    ['un mes que no es numero', '?salaId=s1&anio=2026&mes=noviembre'],
    ['un ano que no es numero', '?salaId=s1&anio=abc&mes=11'],
    ['un mes del pasado', '?salaId=s1&anio=2026&mes=9'],
    ['parametros que esta pantalla no conoce', '?salaId=s1&anio=2026&mes=11&ordenar=nada'],
  ])('con %s, el montaje no toca el historial', async (_caso, texto) => {
    montar({ busqueda: texto });

    await esperar();

    // Las dos formas de navegar, no solo la que usan los selectores: una
    // "normalizacion" escrita con `replace` haria el mismo destrozo en el
    // enlace compartido y no dejaria entrada en el historial para delatarla.
    expect(empujar).not.toHaveBeenCalled();
    expect(reemplazar).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Los fallos: aqui SI se navega, y solo aqui
// ---------------------------------------------------------------------------

describe('cuando la peticion falla', () => {
  /**
   * El 401 es la UNICA navegacion que sale de esta pantalla sin que nadie
   * toque un selector, y es la excepcion que el bloque de arriba deja fuera.
   *
   * El layout del panel ya mira la sesion en el servidor, pero eso pasa una
   * vez al entrar: el token puede caducar con la pantalla abierta, y entonces
   * el unico que se entera es este 401.
   */
  it('un 401 SI navega: al login de SU gimnasio y con la vuelta a esta pantalla', async () => {
    montar({ busqueda: '?salaId=s1&anio=2026&mes=11', error: new ErrorDeApi('Sin sesion', 401) });

    await esperar();

    expect(empujar).toHaveBeenCalledWith(
      `/mi-gym/login?volverA=${encodeURIComponent('/mi-gym/admin/calendario?salaId=s1&anio=2026&mes=11')}`,
    );
  });

  /**
   * EL `volverA` SE LLEVA LA SALA Y EL MES.
   *
   * En esta pantalla el query ES el estado: un `volverA` cableado al camino
   * pelado devuelve a la persona a un calendario vacio despues de volver a
   * escribir la contraseña, y parece que funciona. El repo ya tenia ese
   * veredicto escrito en `admin/layout.tsx` sobre este mismo patron.
   *
   * No se comprueba COMO se escribio la cadena sino que SOBREVIVE el viaje: el
   * destino se pasa por `rutaDeRetornoSegura`, que es quien decide a donde
   * aterriza de verdad. Un `volverA` que esa funcion rechace cae al calendario
   * del alumno, o sea igual que si no se hubiera conservado nada.
   */
  it('el volverA conserva la sala y el mes, y sobrevive a rutaDeRetornoSegura', async () => {
    montar({ busqueda: '?salaId=s1&anio=2026&mes=11', error: new ErrorDeApi('Sin sesion', 401) });

    await esperar();

    const [destino] = empujar.mock.calls[0] as [string];
    const volverA = new URL(destino, 'http://x').searchParams.get('volverA');

    expect(rutaDeRetornoSegura(volverA ?? undefined, 'mi-gym')).toBe(
      '/mi-gym/admin/calendario?salaId=s1&anio=2026&mes=11',
    );
  });

  // Las DOS consultas del calendario traen el 401 a la vez. Con un `push` por
  // consulta, la sesion caducada deja dos entradas en el historial y el boton
  // de atras no vuelve a ningun lado util.
  it('el 401 navega UNA sola vez, aunque fallen las dos consultas', async () => {
    montar({ busqueda: '?salaId=s1&anio=2026&mes=11', error: new ErrorDeApi('Sin sesion', 401) });

    await esperar();

    expect(empujar).toHaveBeenCalledTimes(1);
  });

  it('un error de red NO manda al login: la sesion no tiene la culpa', async () => {
    // Echar a alguien al login por un tunel sin cobertura le hace perder la
    // sesion de verdad, y al volver tiene que escribir la contraseña.
    montar({ busqueda: '?salaId=s1&anio=2026&mes=11', error: new ErrorDeApi('Sin conexion', 0) });

    await esperar();

    expect(empujar).not.toHaveBeenCalled();
    expect(reemplazar).not.toHaveBeenCalled();
  });

  it('un error de red SI se cuenta, con el mensaje que vino', async () => {
    montar({ busqueda: '?salaId=s1&anio=2026&mes=11', error: new ErrorDeApi('Sin conexion', 0) });

    await esperar();

    expect(screen.getByText(/sin conexion/i)).toBeInTheDocument();
  });

  it('un 401 no deja el mensaje crudo de la API en pantalla', async () => {
    // «Unauthorized» delante del mostrador no le dice nada a nadie, y encima
    // la pantalla ya se esta yendo al login.
    montar({ busqueda: '?salaId=s1&anio=2026&mes=11', error: new ErrorDeApi('Unauthorized', 401) });

    await esperar();

    expect(screen.getByText(/tu sesion caduco/i)).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain('Unauthorized');
  });
});
