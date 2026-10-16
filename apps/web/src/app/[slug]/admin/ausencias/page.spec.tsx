import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AusenciaPublica, RolUsuario, SalaPublica } from '@boxadmin/shared';
import { ErrorDeApi } from '@/lib/cliente';
import { clavesDeCatalogos } from '@/hooks/use-catalogos';
import { clavesDeAusencias } from '@/hooks/use-ausencias';
import { vigilarEstosDatos } from '@/test/espia-de-consola';
import { ProveedorDeRol } from '../rol-del-panel';
import PaginaDeAusencias from './page';
// Los filtros viven fuera de `page.tsx`: Next 15 no deja exportar nada mas
// que el `default` desde una pagina. Ver el comentario de `filtros.ts`.
import { filtrosDeLaBusqueda } from './filtros';

/**
 * LO QUE ESTA PANTALLA SIEMBRA Y NO PUEDE ESCAPARSE POR LOS CANALES QUE NO SON
 * EL DOM.
 *
 * El `tenantId` viaja dentro de cada `AusenciaPublica` y de cada
 * `SalaPublica`: es el dato que la Fase 0 se ocupo de que no cruzara entre
 * gimnasios, y un `console.table(ausencias)` lo publica entero.
 *
 * Y el `motivo`, que es lo propio de esta pantalla: texto libre de hasta 200
 * caracteres que escribe el admin para acordarse de por que cierra —«reforma»,
 * «clausura municipal», «velorio»—. No es un identificador tecnico: es una
 * frase sobre el gimnasio que acaba tambien en los datos de la liquidacion.
 *
 * El tapon global de `vitest.setup.ts` vigila los tres canales —consola,
 * titulo y nombre de la pestaña— en TODOS los tests de este archivo.
 */
const CENTINELAS = {
  tenantIdDelGimnasio: 'tnt-centinela',
  motivoDelCierre: 'Clausura-Municipal-Marcador',
};

vigilarEstosDatos(CENTINELAS);

/**
 * LOS MENSAJES DEL SERVICIO, COPIADOS PALABRA POR PALABRA.
 *
 * Verificados contra `apps/api/src/ausencias/ausencias.service.ts`. Son los
 * textos que VIAJAN, no el comentario del codigo.
 *
 * No se afirma con una expresion laxa tipo `/necesit/i`: una asercion asi la
 * pasa igual un mensaje generico, que es exactamente el fallo que estos tests
 * existen para cazar.
 */
const ORDEN_DE_LAS_FECHAS = 'hasta no puede ser anterior a desde';
const SALA_INEXISTENTE = 'Sala inexistente';
const AUSENCIA_INEXISTENTE = 'Ausencia inexistente';

const { empujar, pedirEspia, busqueda } = vi.hoisted(() => ({
  empujar: vi.fn(),
  pedirEspia: vi.fn(),
  busqueda: { valor: '' },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: empujar, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({ slug: 'mi-gym' }),
  useSearchParams: () => new URLSearchParams(busqueda.valor),
  usePathname: () => '/mi-gym/admin/ausencias',
}));

/**
 * Se dobla `pedir`, no `fetch`.
 *
 * Que `pedir` arme bien la URL ya lo fija `use-ausencias.spec`. Lo que se
 * audita aqui es un escalon mas arriba: QUE pide la pantalla y QUE cuerpo
 * manda. `ErrorDeApi` se deja REAL porque la pagina ramifica con `instanceof`.
 */
vi.mock('@/lib/cliente', async (original) => ({
  ...(await original<typeof import('@/lib/cliente')>()),
  pedir: pedirEspia,
}));

afterEach(() => {
  vi.clearAllMocks();
  busqueda.valor = '';
  // Los dos `Storage` y las galletas —que jsdom comparte entre los tests de un
  // archivo— los deja como estaban el tapon global de `vitest.setup.ts`, que
  // ademas los AUDITA en todos los tests. Limpiarlos aqui, en un `afterEach`
  // del spec que corre ANTES que el suyo, lo dejaria mirando unos almacenes
  // ya vacios.
});

// ---------------------------------------------------------------------------
// Semillas
// ---------------------------------------------------------------------------

function unaAusencia(cambios: Partial<AusenciaPublica> = {}): AusenciaPublica {
  return {
    id: 'a1',
    tenantId: CENTINELAS.tenantIdDelGimnasio,
    salaId: 's1',
    desde: '2026-12-24',
    hasta: '2026-12-26',
    todoElDia: true,
    horaInicio: null,
    horaFin: null,
    // `false` a proposito: el default de la columna es `true`, asi que una
    // pantalla que lo dibujara mal igual acertaria con el valor por defecto.
    recuperable: false,
    motivo: CENTINELAS.motivoDelCierre,
    ...cambios,
  };
}

function unaSala(cambios: Partial<SalaPublica> = {}): SalaPublica {
  return {
    id: 's1',
    tenantId: CENTINELAS.tenantIdDelGimnasio,
    nombre: 'Sala Principal',
    activa: true,
    visibleAlumnos: true,
    soloCuposLiberados: false,
    exclusiva: false,
    cupoBase: 12,
    minMinutosCancelar: null,
    minMinutosAnotarse: null,
    listaEsperaHabilitada: null,
    ...cambios,
  };
}

// ---------------------------------------------------------------------------
// Andamiaje
// ---------------------------------------------------------------------------

interface OpcionesDeMontaje {
  ausencias?: AusenciaPublica[];
  salas?: SalaPublica[];
  /** Lo que falla al LEER la lista de cierres. */
  error?: unknown;
  /** Lo que falla al ESCRIBIR (POST, DELETE). */
  errorAlEscribir?: unknown;
  rol?: RolUsuario;
  conProveedor?: boolean;
  /** El query de la URL, sin `?`. Los filtros viven ahi. */
  consulta?: string;
}

function montar({
  ausencias = [unaAusencia()],
  salas = [unaSala()],
  error,
  errorAlEscribir,
  // `ADMIN_SALON` por defecto: es el rol que puede escribir, o sea el unico
  // desde el que se ven los controles que la mayoria de los tests ejercitan.
  rol = 'ADMIN_SALON',
  conProveedor = true,
  consulta = '',
}: OpcionesDeMontaje = {}): QueryClient {
  busqueda.valor = consulta;

  /**
   * El doble responde POR RUTA, no por orden de llamada.
   *
   * Con `mockResolvedValueOnce` encadenados, agregar una peticion a la
   * pantalla corre todas las respuestas una posicion y los tests fallan en el
   * sitio equivocado. Y el fallo de escritura es una opcion del montaje y no
   * un `mockRejectedValueOnce` suelto por lo mismo: ese «once» se lo come la
   * relectura que dispara la invalidacion si llega antes.
   */
  pedirEspia.mockImplementation((ruta: string, opciones?: { metodo?: string }) => {
    if (opciones?.metodo !== undefined) {
      return errorAlEscribir === undefined
        ? // El POST y el DELETE devuelven la fila, no un 204.
          Promise.resolve(unaAusencia())
        : Promise.reject(errorAlEscribir);
    }
    if (ruta.startsWith('/ausencias')) {
      return error === undefined ? Promise.resolve(ausencias) : Promise.reject(error);
    }
    if (ruta.startsWith('/salas')) return Promise.resolve(salas);

    throw new Error(`La pantalla pidio una ruta que nadie espera: ${ruta}`);
  });

  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  // Sembrado para que el primer pintado ya tenga los datos: asi los tests que
  // miran el DOM no necesitan esperar. Sembrar NO apaga la peticion.
  if (error === undefined) {
    cliente.setQueryData(
      clavesDeAusencias.lista(filtrosDeLaBusqueda(new URLSearchParams(consulta))),
      ausencias,
    );
  }
  cliente.setQueryData(clavesDeCatalogos.salas(), salas);

  const pantalla = <PaginaDeAusencias />;

  render(
    <QueryClientProvider client={cliente}>
      {conProveedor ? <ProveedorDeRol rol={rol}>{pantalla}</ProveedorDeRol> : pantalla}
    </QueryClientProvider>,
  );

  return cliente;
}

/** Deja que las consultas se resuelvan (o se rompan) y que React pinte. */
async function esperar(): Promise<void> {
  await act(async () => {
    for (let vuelta = 0; vuelta < 5; vuelta += 1) {
      await new Promise((resolver) => setTimeout(resolver, 0));
    }
  });
}

function columnasDelDocumento(): string[] {
  return [...document.querySelectorAll('th')].map((th) => th.textContent?.trim() ?? '');
}

function filasDelDocumento(): string[][] {
  return [...document.querySelectorAll('tbody tr')].map((tr) =>
    [...tr.querySelectorAll('td')].map((td) => td.textContent?.trim() ?? ''),
  );
}

function botonesDelDocumento(): string[] {
  return [...document.querySelectorAll('button')].map((boton) => boton.textContent?.trim() ?? '');
}

/** Las rutas pedidas, EN ORDEN y sin deduplicar. */
function rutasPedidas(): string[] {
  return pedirEspia.mock.calls.map(([ruta]) => ruta as string);
}

interface EscrituraVista {
  ruta: string;
  metodo: string;
  cuerpo: unknown;
}

/** Solo lo que la pantalla ESCRIBIO, en orden. */
function escrituras(): EscrituraVista[] {
  return pedirEspia.mock.calls
    .filter(([, opciones]) => (opciones as { metodo?: string } | undefined)?.metodo !== undefined)
    .map(([ruta, opciones]) => {
      const detalle = opciones as { metodo: string; cuerpo?: unknown };
      return { ruta: ruta as string, metodo: detalle.metodo, cuerpo: detalle.cuerpo };
    });
}

function cuerpoEnviado(indice = 0): Record<string, unknown> {
  const escritura = escrituras()[indice];
  if (escritura === undefined) throw new Error(`No hubo escritura numero ${indice}`);

  return escritura.cuerpo as Record<string, unknown>;
}

/**
 * Los controles de un formulario, por su ETIQUETA y en orden.
 *
 * Es la lista blanca del formulario. Afirmar «no hay un campo recuperable»
 * buscando esa palabra en el marcado depende de que nadie la cambie —un
 * «¿Se recupera la clase?» pasaria en verde—; esto fija el conjunto entero, y
 * un control de mas lo rompe se llame como se llame.
 */
function controlesDelFormulario(etiqueta: string): string[] {
  const formulario = document.querySelector(`form[aria-label="${etiqueta}"]`);
  if (formulario === null) throw new Error(`No hay ningun formulario «${etiqueta}»`);

  return [...formulario.querySelectorAll('input, select, textarea')].map((control) => {
    const id = control.getAttribute('id') ?? '';
    const suEtiqueta = formulario.querySelector(`label[for="${CSS.escape(id)}"]`);
    return suEtiqueta?.textContent?.trim() ?? '(sin etiqueta)';
  });
}

/** Las opciones de un desplegable: su VALOR y su texto, en orden. */
function opcionesDe(etiqueta: string): [string, string][] {
  return [...screen.getByLabelText(etiqueta).querySelectorAll('option')].map((opcion) => [
    opcion.getAttribute('value') ?? '',
    opcion.textContent?.trim() ?? '',
  ]);
}

/**
 * Rellena el alta con un cierre valido, y deja encima los cambios que se le
 * pasen.
 *
 * NO SABE ESCRIBIR HORAS, y eso es a proposito: el formulario ya no las ofrece.
 * Si alguien vuelve a pasarle «Hora de inicio», el `getByLabelText` de abajo
 * revienta en vez de saltarselo, que es lo que tiene que pasar.
 */
async function completarElAlta(cambios: Partial<Record<string, string>> = {}): Promise<void> {
  const valores: Record<string, string> = {
    'Que cierra': 's1',
    Desde: '2026-12-24',
    Hasta: '2026-12-26',
    Motivo: CENTINELAS.motivoDelCierre,
    ...cambios,
  };

  await userEvent.selectOptions(screen.getByLabelText('Que cierra'), valores['Que cierra'] ?? '');

  for (const etiqueta of Object.keys(valores)) {
    if (etiqueta === 'Que cierra') continue;

    const escrito = valores[etiqueta] ?? '';
    // `getByLabelText` y no `queryBy…`: si alguien pide escribir en un campo
    // que no esta dibujado, el test tiene que gritar y no saltarselo.
    if (escrito !== '') await userEvent.type(screen.getByLabelText(etiqueta), escrito);
  }
}

async function enviarElAlta(): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: 'Crear cierre' }));
  await esperar();
}

async function abrirElBorradoDe(que: string, fechas: string): Promise<void> {
  await userEvent.click(
    screen.getByRole('button', { name: `Borrar el cierre de ${que}, ${fechas}` }),
  );
}

// ---------------------------------------------------------------------------
// La tabla
// ---------------------------------------------------------------------------

describe('el listado de cierres', () => {
  // LISTA BLANCA: el conjunto ENTERO. Una columna de mas —el error que ningun
  // test de presencia ve— rompe esto.
  it('muestra ESTAS columnas y solo estas', () => {
    montar();

    expect(columnasDelDocumento()).toEqual(['Sala', 'Fechas', 'Franja', 'Motivo', 'Acciones']);
  });

  it('cada fila tiene EXACTAMENTE una celda por columna, con este contenido', () => {
    // Una celda de mas no la ve el test de los `<th>`: se puede pintar un
    // `<td>` sin encabezado y la lista blanca de arriba sigue en verde.
    montar();

    expect(filasDelDocumento()).toEqual([
      [
        'Sala Principal',
        '2026-12-24 a 2026-12-26',
        'Todo el dia',
        CENTINELAS.motivoDelCierre,
        'Borrar',
      ],
    ]);
  });

  /**
   * `salaId: null` SIGNIFICA TODO EL SALON.
   *
   * Es un caso distinto de «no elegi sala todavia», y dejarlo como un
   * desplegable vacio los confunde: uno es la decision mas grave que esta
   * pantalla permite —el gimnasio entero no abre— y el otro es un formulario a
   * medias. Se fija en los dos sitios donde la confusion es posible: la celda
   * de la tabla y las opciones del selector.
   */
  it('una ausencia de TODO EL SALON se distingue de una sin sala elegida', () => {
    montar({
      ausencias: [unaAusencia({ id: 'a1', salaId: null }), unaAusencia({ id: 'a2', salaId: 's1' })],
    });

    expect(filasDelDocumento().map((celdas) => celdas[0])).toEqual([
      'Todo el salon',
      'Sala Principal',
    ]);

    // En el alta son DOS opciones con valores distintos: el hueco del selector
    // es «todavia no elegi» y tiene su propio texto.
    expect(opcionesDe('Que cierra')).toEqual([
      ['', 'Elegi que cierra'],
      ['todo-el-salon', 'Todo el salon'],
      ['s1', 'Sala Principal'],
    ]);
  });

  /**
   * UNA FILA CON HORAS GUARDADAS NO PROMETE UN CIERRE PARCIAL.
   *
   * El contrato sigue devolviendo `todoElDia`, `horaInicio` y `horaFin`, y
   * filas asi puede haberlas: cargadas por `curl` antes de que existiera esta
   * pantalla, o por una version anterior de ella. Pero ningun consumidor mira
   * la hora —los tres deciden con `fechaEnRango(fecha, desde, hasta)`—, asi que
   * ese cierre CANCELA EL DIA ENTERO.
   *
   * Pintar «18:00 a 20:00» seria prometer que a las 10 hay clase. Se dice lo
   * que pasa de verdad, y se avisa de que el dato guardado dice otra cosa, sin
   * repetir las horas: son justo lo que no se puede leer sin entenderlo al
   * reves.
   */
  it('una fila con horas guardadas se lee como lo que es: el dia entero cerrado', () => {
    montar({
      ausencias: [
        unaAusencia({ id: 'a1', todoElDia: true }),
        unaAusencia({ id: 'a2', todoElDia: false, horaInicio: '18:00', horaFin: '20:00' }),
      ],
    });

    expect(filasDelDocumento().map((celdas) => celdas[2])).toEqual([
      'Todo el dia',
      'Todo el dia (el tramo horario guardado no se aplica)',
    ]);

    // Y las horas no estan en el marcado: lo que se pinta viaja al navegador
    // aunque este tapado por CSS, y aqui lo que importa es que nadie las lea.
    expect(document.body.innerHTML).not.toContain('18:00');
    expect(document.body.innerHTML).not.toContain('20:00');
  });

  /**
   * Y NO SE MIRA SOLO `todoElDia`.
   *
   * El service hoy pone las horas en null cuando el cierre es de dia completo,
   * asi que `todoElDia: true` con horas no deberia existir. «No deberia» no es
   * «no puede»: el contrato devuelve los tres campos y la celda no tiene por
   * que depender de esa limpieza para no mentir. Este caso es el unico que
   * distingue la condicion que hay escrita de un `if (!todoElDia)`.
   */
  it('una fila incoherente —dia completo CON horas— tampoco las enseña', () => {
    montar({
      ausencias: [unaAusencia({ todoElDia: true, horaInicio: '18:00', horaFin: '20:00' })],
    });

    expect(filasDelDocumento().map((celdas) => celdas[2])).toEqual([
      'Todo el dia (el tramo horario guardado no se aplica)',
    ]);
    expect(document.body.innerHTML).not.toContain('18:00');
  });

  it('un cierre de un solo dia no se pinta como un rango', () => {
    montar({ ausencias: [unaAusencia({ desde: '2026-12-25', hasta: '2026-12-25' })] });

    expect(filasDelDocumento().map((celdas) => celdas[1])).toEqual(['2026-12-25']);
  });

  it('sin motivo lo dice, en vez de dejar la celda vacia', () => {
    // Una celda en blanco se lee como «no cargo la pantalla».
    montar({ ausencias: [unaAusencia({ motivo: null })] });

    expect(filasDelDocumento().map((celdas) => celdas[3])).toEqual(['Sin motivo']);
  });

  it('una sala que no esta en el catalogo tampoco deja la celda vacia', () => {
    // El catalogo llega por red y puede llegar despues; y una sala borrada
    // sigue teniendo sus cierres en la lista.
    montar({ ausencias: [unaAusencia({ salaId: 's-que-no-existe' })] });

    expect(filasDelDocumento().map((celdas) => celdas[0])).toEqual([
      'Sala que ya no esta en el catalogo',
    ]);
  });

  it('sin cierres lo dice, y no deja una tabla vacia', () => {
    montar({ ausencias: [] });

    expect(screen.getByText(/todavia no hay cierres/i)).toBeInTheDocument();
    expect(document.querySelector('table')).toBeNull();
  });

  it('con filtros puestos y sin resultados dice que es por los filtros', () => {
    montar({ ausencias: [], consulta: 'desde=2026-12-01' });

    expect(screen.getByText(/no hay cierres que coincidan con estos filtros/i)).toBeInTheDocument();
  });

  it('el tenantId no llega al marcado', () => {
    // Lo que se pinta viaja al navegador aunque este tapado por CSS.
    montar();

    expect(document.body.innerHTML).not.toContain(CENTINELAS.tenantIdDelGimnasio);
  });
});

// ---------------------------------------------------------------------------
// El campo muerto
// ---------------------------------------------------------------------------

/**
 * `recuperable` NO SE DIBUJA, NI EN LA TABLA NI EN EL ALTA.
 *
 * Es un campo muerto: la columna existe con `@default(true)`, el DTO lo acepta,
 * el service lo escribe con `dto.recuperable ?? true` y lo mapea al contrato
 * —y NADIE LO LEE—. Ni `generacion-mes.service.ts`, que es quien aplica las
 * ausencias al plan del mes, ni `calendario.datos.ts`, ni
 * `liquidacion.datos.ts`: los tres mapean la fila a `{ salaId, desde, hasta }`.
 *
 * Es el peor de los dos campos muertos de la fase porque EL NOMBRE PROMETE
 * ALGO CONCRETO: un admin que marque un cierre como recuperable va a creer que
 * a los alumnos se les devuelve la clase, y no se les devuelve nada. Ofrecerlo
 * con una advertencia al lado tampoco sirve: una advertencia permanente se
 * vuelve invisible a las dos semanas y lo que queda es la casilla. Queda como
 * deuda anotada en la cabecera de `page.tsx`, no como control.
 *
 * Este test existe para que el proximo que lea `AusenciaPublica` no lo agregue
 * «porque faltaba».
 */
describe('el campo muerto', () => {
  it('NO dibuja el campo recuperable', () => {
    // Afirmá sobre el MARCADO: `queryByRole` consulta el arbol de
    // accesibilidad, que ya excluye por su cuenta lo que lleva `hidden`, asi
    // que un control escondido pasaria en verde y seguiria en el HTML.
    montar({
      ausencias: [
        unaAusencia({ id: 'a1', recuperable: true }),
        unaAusencia({ id: 'a2', recuperable: false }),
      ],
    });

    expect(document.body.innerHTML).not.toMatch(/recuperable/i);

    // Y los dos conjuntos ENTEROS, que es lo que no depende de como se llame:
    // un control o una columna con otro nombre rompen esto igual.
    expect(columnasDelDocumento()).toEqual(['Sala', 'Fechas', 'Franja', 'Motivo', 'Acciones']);
    expect(controlesDelFormulario('Nuevo cierre')).toEqual([
      'Que cierra',
      'Desde',
      'Hasta',
      'Motivo',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Lo que se pide
// ---------------------------------------------------------------------------

/**
 * LISTA BLANCA DE PETICIONES.
 *
 * Una LECTURA de mas no la ve ningun otro test de este archivo: no cambia ni
 * un nodo del marcado y no manda ningun cuerpo. Un `useSalas()` de
 * precalentamiento sobrevivio 74 tests en una tarea anterior de esta misma
 * fase.
 *
 * ES UNA SOLA LISTA Y NO UNA POR ROL, y eso es una afirmacion, no un atajo:
 * `GET /ausencias` NO lleva `@Roles` —verificado en el controller— y `GET
 * /salas` tampoco, asi que el rol NO cambia lo que esta pantalla pide; cambia
 * lo que DIBUJA, y de eso se ocupa el bloque del rol. Montar tres listas
 * iguales con tres nombres distintos daria la impresion de estar midiendo tres
 * cosas. Lo que se mide es la IGUALDAD, y por eso la lista esta escrita una vez
 * y los roles se recorren contra ella.
 */
const PETICIONES_DE_LA_PANTALLA = ['/ausencias', '/salas'];

describe('lo que la pantalla pide', () => {
  it.each(['ADMIN_OPERATIVO', 'ADMIN_SALON', 'SUPERADMIN'] as const)(
    'un %s pide ESTAS y ninguna mas',
    async (rol) => {
      montar({ rol });
      await esperar();

      expect(rutasPedidas()).toEqual(PETICIONES_DE_LA_PANTALLA);
    },
  );

  /**
   * SIN PROVEEDOR DE ROL SE SIGUE LEYENDO, y es deliberado.
   *
   * Al reves que en horarios, donde hasta el `@Get()` pide `ADMIN_OPERATIVO` y
   * pedir sin rol seria un 403 pintado como una averia. Aqui el GET no lleva
   * `@Roles`: cortarlo seria inventar un permiso que la API no pide. Lo que si
   * cae del lado seguro es la ESCRITURA, y eso lo fija el bloque del rol.
   */
  it('sin proveedor de rol lee igual, porque el GET no pide rol', async () => {
    montar({ conProveedor: false });
    await esperar();

    expect(rutasPedidas()).toEqual(PETICIONES_DE_LA_PANTALLA);
  });

  /**
   * LA LISTA BLANCA DE ARRIBA MIRA `pedir`, NO LA RED.
   *
   * Y ese es su agujero: el doble esta puesto sobre `pedir`, asi que una
   * peticion hecha con `fetch` a pelo —o con `sendBeacon`, o con un `<link
   * rel="prefetch">`— no aparece en `rutasPedidas()`, no cambia un nodo del
   * marcado, no manda un cuerpo que ningun test mire, no toca los almacenes y
   * no dice nada por la consola. Se midio: un
   * `void fetch('/api/bx/stats/caja')` en un `useEffect` de esta pantalla pasó
   * los 1232 tests del paquete y `tsc`.
   *
   * El daño es doble y concreto. Primero, va al proxy CON LA COOKIE de sesion,
   * asi que trae de verdad la caja del gimnasio —`margen`, `costoProfesoras`—
   * a una pantalla que no tiene nada que ver con el dinero, y queda en la
   * pestaña de red y en los breadcrumbs de cualquier SDK de errores que se
   * enchufe mañana. Segundo, y peor a la larga: `lib/cliente.ts` se abre
   * diciendo que es «el unico fetch del navegador en toda la aplicacion»
   * porque el token vive en una cookie httpOnly que el cliente no puede leer y
   * es el proxy quien lo añade. Esa frase es cierta mientras nadie escriba la
   * primera excepcion, y la primera excepcion no la ve ningun test.
   *
   * Por eso se afirma sobre el GLOBAL `fetch` y no sobre una lista de
   * destinos: lo que se fija es que esta pantalla no tiene NINGUN camino de
   * red propio.
   */
  it('no habla con la red por fuera de `pedir`, ni al leer ni al escribir', async () => {
    // El doble CONTESTA como contestaria la red —un 200 con JSON—, en vez de
    // devolver `undefined`: asi una peticion clandestina falla por la
    // afirmacion de abajo, que dice a donde se hablaba, y no por un
    // `TypeError` al encadenarle un `.catch` al resultado.
    const red = vi.fn((_destino: RequestInfo | URL) =>
      Promise.resolve(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    );
    vi.stubGlobal('fetch', red);

    try {
      montar();
      await esperar();

      await completarElAlta();
      await enviarElAlta();

      await abrirElBorradoDe('Sala Principal', '2026-12-24 a 2026-12-26');
      await userEvent.click(screen.getByRole('button', { name: 'Borrar' }));
      await esperar();

      expect(escrituras()).toHaveLength(2);
      // Los destinos y no solo el conteo: si alguna vez cae, el informe dice
      // a donde se estaba hablando.
      expect(red.mock.calls.map(([destino]) => String(destino))).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// ---------------------------------------------------------------------------
// Los filtros
// ---------------------------------------------------------------------------

describe('los filtros', () => {
  it('los filtros de sala y rango viajan en la URL', async () => {
    montar({ consulta: 'salaId=s1&desde=2026-12-01&hasta=2026-12-31' });
    await esperar();

    expect(rutasPedidas()[0]).toBe('/ausencias?salaId=s1&desde=2026-12-01&hasta=2026-12-31');
  });

  it('elegir una sala escribe la URL, no un estado local', async () => {
    // Un filtro en la URL se comparte por chat, sobrevive al boton de atras y
    // vuelve puesto desde el login.
    montar({ salas: [unaSala({ id: 's9', nombre: 'Sala Chica' })] });

    await userEvent.selectOptions(screen.getByLabelText('Filtrar por sala'), 's9');

    expect(empujar).toHaveBeenCalledTimes(1);
    expect(empujar).toHaveBeenCalledWith('/mi-gym/admin/ausencias?salaId=s9');
  });

  it('escribir una fecha NO borra el filtro de sala que ya habia', async () => {
    // Un filtro que se lleva por delante al otro es peor que no tenerlo: el
    // admin cree que esta mirando los cierres de la sala chica en diciembre.
    //
    // `fireEvent.change` y no `userEvent.type`: el control lo gobierna la URL,
    // que el doble de `useSearchParams` no actualiza, asi que escribir letra a
    // letra mandaria diez navegaciones de un caracter cada una.
    montar({ consulta: 'salaId=s1' });

    fireEvent.change(screen.getByLabelText('Filtrar desde'), {
      target: { value: '2026-12-01' },
    });

    expect(empujar).toHaveBeenCalledTimes(1);
    expect(empujar).toHaveBeenCalledWith('/mi-gym/admin/ausencias?salaId=s1&desde=2026-12-01');
  });

  it('vaciar un filtro saca la clave en vez de mandarla vacia', async () => {
    // `?salaId=` no es «sin filtro»: seria una sala cuyo id es la cadena vacia
    // y la lista volveria vacia sobre un salon que cierra en Navidad.
    montar({ consulta: 'salaId=s1&desde=2026-12-01' });

    await userEvent.selectOptions(screen.getByLabelText('Filtrar por sala'), '');

    expect(empujar).toHaveBeenCalledWith('/mi-gym/admin/ausencias?desde=2026-12-01');
  });

  it('quitar el ultimo filtro deja la ruta pelada, sin interrogante', async () => {
    montar({ consulta: 'salaId=s1' });

    await userEvent.selectOptions(screen.getByLabelText('Filtrar por sala'), '');

    expect(empujar).toHaveBeenCalledWith('/mi-gym/admin/ausencias');
  });

  /**
   * EL FILTRO DE SALA NO OFRECE «TODO EL SALON», y no es un olvido.
   *
   * El service responde al filtro con `where.OR = [{ salaId }, { salaId: null }]`:
   * filtrando por una sala devuelve TAMBIEN los cierres del salon entero,
   * porque un cierre del salon afecta a esa sala. O sea que no hay forma de
   * pedir «solo los del salon entero», y una opcion que lo prometiera mentiria.
   */
  it('el filtro de sala no promete un «solo el salon entero» que la API no tiene', () => {
    montar();

    expect(opcionesDe('Filtrar por sala')).toEqual([
      ['', 'Todas'],
      ['s1', 'Sala Principal'],
    ]);
  });
});

// ---------------------------------------------------------------------------
// El rol
// ---------------------------------------------------------------------------

/**
 * `POST` Y `DELETE` PIDEN `ADMIN_SALON`, como las escrituras de salas.
 *
 * Se afirma sobre el MARCADO y no con `queryByRole`: el arbol de accesibilidad
 * ya excluye lo que lleva `hidden`, asi que un `queryByRole` en null no
 * distingue «no esta» de «esta escondido». Y no se deshabilitan: un boton
 * deshabilitado sigue en el DOM, a un clic de las herramientas del navegador.
 */
describe('quien puede escribir', () => {
  it('un ADMIN_OPERATIVO no ve los botones de escritura, en el marcado', () => {
    montar({ rol: 'ADMIN_OPERATIVO' });

    expect(botonesDelDocumento()).toEqual([]);
    expect(document.querySelector('form[aria-label="Nuevo cierre"]')).toBeNull();
    expect(document.body.innerHTML).not.toMatch(/crear cierre/i);
    expect(document.body.innerHTML).not.toMatch(/borrar/i);
    // Y la columna de acciones no queda como un hueco: no existe.
    expect(columnasDelDocumento()).toEqual(['Sala', 'Fechas', 'Franja', 'Motivo']);
  });

  it('un ADMIN_SALON si los ve', () => {
    montar({ rol: 'ADMIN_SALON' });

    expect(screen.getByRole('button', { name: 'Crear cierre' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Borrar el cierre de Sala Principal, 2026-12-24 a 2026-12-26',
      }),
    ).toBeInTheDocument();
  });

  it('un SUPERADMIN tambien, porque los roles son jerarquicos', () => {
    montar({ rol: 'SUPERADMIN' });

    expect(screen.getByRole('button', { name: 'Crear cierre' })).toBeInTheDocument();
  });

  /**
   * SIN PROVEEDOR DE ROL, NADA QUE ESCRIBIR.
   *
   * El rol llega por el contexto que pone el armazon del panel. Si esta
   * pantalla acabara fuera de ese armazon el contexto devuelve `null`, y eso
   * tiene que significar «no alcanza para nada», no «no se sabe, dibujalo
   * igual». Falla cerrada.
   */
  it('sin proveedor de rol tampoco se dibujan', () => {
    montar({ conProveedor: false });

    expect(botonesDelDocumento()).toEqual([]);
    expect(document.querySelector('form[aria-label="Nuevo cierre"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// El alta
// ---------------------------------------------------------------------------

describe('el alta de un cierre', () => {
  it('el formulario ofrece ESTOS campos y solo estos', () => {
    montar();

    expect(controlesDelFormulario('Nuevo cierre')).toEqual([
      'Que cierra',
      'Desde',
      'Hasta',
      'Motivo',
    ]);
  });

  it('manda el cuerpo entero, con el tipo de cada campo', async () => {
    montar();

    await completarElAlta();
    await enviarElAlta();

    expect(escrituras()[0]?.ruta).toBe('/ausencias');
    expect(escrituras()[0]?.metodo).toBe('POST');
    expect(cuerpoEnviado()).toEqual({
      salaId: 's1',
      desde: '2026-12-24',
      hasta: '2026-12-26',
      // Un booleano de verdad, no la cadena «true».
      todoElDia: true,
      motivo: CENTINELAS.motivoDelCierre,
    });
  });

  /**
   * TODO EL SALON = SIN LA CLAVE `salaId`.
   *
   * El DTO lee la ausencia de la clave como «cierra el salon entero». Un
   * `salaId: null` o un `salaId: ''` serian un 400 del `@IsString()` +
   * `@IsNotEmpty()`, y cerrar el salon entero dejaria de poder cargarse.
   */
  it('cerrar todo el salon manda el cuerpo SIN salaId', async () => {
    montar();

    await completarElAlta({ 'Que cierra': 'todo-el-salon' });
    await enviarElAlta();

    expect(Object.keys(cuerpoEnviado())).toEqual(['desde', 'hasta', 'todoElDia', 'motivo']);
    // Y el centinela del selector no se escapa a la API.
    expect(JSON.stringify(cuerpoEnviado())).not.toContain('todo-el-salon');
  });

  it('sin elegir que cierra no llega al servidor, y lo dice', async () => {
    // El hueco del selector es «todavia no elegi», y eso es un error con su
    // texto, no un «cierro todo» silencioso.
    montar();

    await completarElAlta({ 'Que cierra': '' });
    await enviarElAlta();

    expect(escrituras()).toEqual([]);
    expect(
      screen.getByText('Elegi una sala, o «Todo el salon» si cierra el gimnasio entero.'),
    ).toBeInTheDocument();
  });

  it('una fecha con otra forma no llega al servidor', async () => {
    montar();

    await completarElAlta({ Desde: '24/12/2026' });
    await enviarElAlta();

    expect(escrituras()).toEqual([]);
  });

  it('el motivo vacio se OMITE, no viaja como cadena vacia', async () => {
    // `motivo: ''` se guardaria como una cadena vacia, que no es lo mismo que
    // «no puso motivo»: la columna nace en null.
    montar();

    await completarElAlta({ Motivo: '' });
    await enviarElAlta();

    expect(Object.keys(cuerpoEnviado())).toEqual(['salaId', 'desde', 'hasta', 'todoElDia']);
  });

  it('tras un alta buena el formulario queda limpio', async () => {
    // Con los valores puestos, el siguiente feriado se carga encima del
    // anterior sin que nadie lo note.
    montar();

    await completarElAlta();
    await enviarElAlta();

    expect(screen.getByLabelText('Desde')).toHaveValue('');
    expect(screen.getByLabelText('Motivo')).toHaveValue('');
  });
});

// ---------------------------------------------------------------------------
// La franja horaria, que ya no se ofrece
// ---------------------------------------------------------------------------

/**
 * EL CIERRE ES SIEMPRE DE DIA COMPLETO.
 *
 * La franja no la honra NINGUN consumidor. Verificado uno por uno:
 * `generacion-mes.service.ts` decide con `fechaEnRango(fecha, a.desde,
 * a.hasta)`, `calendario.datos.ts` mapea la fila a `{ salaId, desde, hasta }` y
 * `liquidacion.datos.ts` a eso mismo mas `motivo`. Ninguno mira la hora.
 *
 * O sea que un cierre de 18:00 a 20:00 CANCELA EL DIA ENTERO. No es un campo
 * inerte como `recuperable` —ese se guarda y no hace nada—: este hace algo, y
 * DE MAS, se lleva por delante los turnos de la mañana; y el sintoma aparece a
 * un mes de distancia, cuando el mes publicado sale mal.
 *
 * Son DOS tests y no uno porque son dos fallos distintos: el control podria no
 * dibujarse y el cuerpo llevar las horas igual —un `horaInicio: ''` colado en
 * el objeto literal—, y al reves.
 */
describe('la franja horaria, que ya no se ofrece', () => {
  it('NO dibuja la franja horaria', () => {
    // Sobre el MARCADO: `*ByRole` consulta el arbol de accesibilidad, que ya
    // excluye por su cuenta lo que lleva `hidden`, asi que un `queryByRole` en
    // null no distinguiria «no esta» de «esta escondido».
    montar();

    const formulario = document.querySelector('form[aria-label="Nuevo cierre"]');
    expect(formulario).not.toBeNull();
    expect(formulario?.innerHTML).not.toMatch(/hora/i);
    expect(formulario?.innerHTML).not.toMatch(/todo el dia/i);
    // Ni deshabilitado ni escondido: el interruptor no existe.
    expect(formulario?.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);

    // Y el conjunto ENTERO, que es lo que no depende de como se llame el
    // control: uno de mas rompe esto aunque se llame «Tramo» o «Solo un rato».
    expect(controlesDelFormulario('Nuevo cierre')).toEqual([
      'Que cierra',
      'Desde',
      'Hasta',
      'Motivo',
    ]);
  });

  it('el cuerpo NUNCA lleva horas', async () => {
    montar();

    await completarElAlta();
    await enviarElAlta();

    // Las claves EXACTAS, no un `not.toHaveProperty`: una clave de mas con
    // otro nombre —`tramo`, `horario`— rompe esto igual.
    expect(Object.keys(cuerpoEnviado())).toEqual([
      'salaId',
      'desde',
      'hasta',
      'todoElDia',
      'motivo',
    ]);
    expect(JSON.stringify(cuerpoEnviado())).not.toMatch(/hora/i);
  });

  /**
   * `todoElDia: true` VIAJA, aunque ya no haya interruptor que lo mueva.
   *
   * Es la mitad que el test de arriba no cubre: sin horas y sin control, la
   * tentacion es borrar tambien la clave. El service la resuelve con
   * `dto.todoElDia ?? true`, asi que omitirla funciona HOY y depende de un
   * default del servidor; el dia que ese default cambie, cada cierre de esta
   * pantalla pasaria a ser una franja sin horas. Es un valor, no un hueco.
   */
  it('`todoElDia: true` viaja siempre, aunque el interruptor ya no exista', async () => {
    montar();

    await completarElAlta();
    await enviarElAlta();

    const cuerpo = cuerpoEnviado();
    expect('todoElDia' in cuerpo).toBe(true);
    // Un booleano de verdad, no la cadena «true» ni un `1`.
    expect(cuerpo.todoElDia).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Lo que dice la API cuando no
// ---------------------------------------------------------------------------

/**
 * LOS MENSAJES SON LOS DEL SERVICIO Y SE ENSEÑAN TAL CUAL.
 *
 * La pantalla NO comprueba el orden de las fechas ni el de las horas a
 * proposito: una comprobacion local con otro texto seria un segundo mensaje
 * que puede acabar diciendo algo distinto del de la API, y —peor— dejaria ese
 * camino de la API sin ejercitar nunca.
 */
describe('lo que dice la API cuando no', () => {
  it('hasta anterior a desde muestra el motivo de la API, palabra por palabra', async () => {
    montar({
      errorAlEscribir: new ErrorDeApi(ORDEN_DE_LAS_FECHAS, 400, {
        message: [ORDEN_DE_LAS_FECHAS],
      }),
    });

    await completarElAlta({ Desde: '2026-12-26', Hasta: '2026-12-24' });
    await enviarElAlta();

    expect(escrituras()).toHaveLength(1);
    expect(screen.getByText(ORDEN_DE_LAS_FECHAS)).toBeInTheDocument();
  });

  /**
   * SE FUE «horaFin debe ser posterior a horaInicio».
   *
   * Ese 400 lo tira el `!todoElDia` del service, y esta pantalla manda
   * `todoElDia: true` fijo: el mensaje ya no puede llegar, y un test que
   * fabricara el error con `errorAlEscribir` estaria probando el doble, no la
   * pantalla. Lo que si queda fijado —en el bloque de la franja— es que el
   * cuerpo no lleva horas, que es lo que hace inalcanzable ese camino.
   */
  it('una sala que ya no existe se dice con el texto del service', async () => {
    montar({
      errorAlEscribir: new ErrorDeApi(SALA_INEXISTENTE, 404, { message: SALA_INEXISTENTE }),
    });

    await completarElAlta();
    await enviarElAlta();

    expect(screen.getByText(SALA_INEXISTENTE)).toBeInTheDocument();
  });

  it('un 403 se explica en palabras, no como «Forbidden»', async () => {
    // Su cuerpo dice «Forbidden», que no nombra ningun campo y acabaria en el
    // cartel tal cual, en ingles. Y nombra el rol que PIDE LA RUTA, que aqui
    // es ADMIN_SALON y no el ADMIN_OPERATIVO de la puerta del panel.
    montar({ errorAlEscribir: new ErrorDeApi('Forbidden', 403, { message: 'Forbidden' }) });

    await completarElAlta();
    await enviarElAlta();

    expect(
      screen.getByText('Para esto hace falta ser administrador del salon. Tu rol no alcanza.'),
    ).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain('Forbidden');
  });

  it('tras un fallo el formulario sigue ahi, con lo que ya se habia escrito', async () => {
    montar({
      errorAlEscribir: new ErrorDeApi(ORDEN_DE_LAS_FECHAS, 400, {
        message: [ORDEN_DE_LAS_FECHAS],
      }),
    });

    await completarElAlta();
    await enviarElAlta();

    expect(screen.getByLabelText('Desde')).toHaveValue('2026-12-24');
    expect(screen.getByLabelText('Motivo')).toHaveValue(CENTINELAS.motivoDelCierre);
  });
});

// ---------------------------------------------------------------------------
// Borrar
// ---------------------------------------------------------------------------

describe('borrar un cierre', () => {
  it('borrar confirma nombrando el motivo y las fechas', async () => {
    // Con cinco feriados cargados, un «¿estas seguro?» es una ruleta. Y el
    // borrado NO ES LOGICO: el service borra la fila y no hay PATCH para
    // deshacerlo.
    montar();

    await abrirElBorradoDe('Sala Principal', '2026-12-24 a 2026-12-26');

    const dialogo = screen.getByRole('dialog');
    expect(dialogo).toHaveTextContent(CENTINELAS.motivoDelCierre);
    expect(dialogo).toHaveTextContent('2026-12-24 a 2026-12-26');
    expect(dialogo).toHaveTextContent('Sala Principal');
    // Y nada sale hasta que se confirma.
    expect(escrituras()).toEqual([]);
  });

  it('un cierre sin motivo tambien se puede confirmar sin leer «null»', async () => {
    montar({ ausencias: [unaAusencia({ motivo: null })] });

    await abrirElBorradoDe('Sala Principal', '2026-12-24 a 2026-12-26');

    expect(screen.getByRole('dialog')).toHaveTextContent('Sin motivo');
    expect(screen.getByRole('dialog').textContent).not.toContain('null');
  });

  it('borra la DE ESA FILA, con dos sembradas', async () => {
    // Con una sola, «borra la suya» y «borra la primera» son indistinguibles.
    montar({
      ausencias: [
        unaAusencia({ id: 'a1', salaId: null, desde: '2026-11-01', hasta: '2026-11-01' }),
        unaAusencia({ id: 'a2', salaId: 's1', desde: '2026-12-24', hasta: '2026-12-26' }),
      ],
    });

    await abrirElBorradoDe('Sala Principal', '2026-12-24 a 2026-12-26');
    await userEvent.click(screen.getByRole('button', { name: 'Borrar' }));
    await esperar();

    expect(escrituras()[0]?.ruta).toBe('/ausencias/a2');
    expect(escrituras()[0]?.metodo).toBe('DELETE');
    expect(escrituras()[0]?.cuerpo).toBeUndefined();
  });

  it('cancelar no manda nada', async () => {
    montar();

    await abrirElBorradoDe('Sala Principal', '2026-12-24 a 2026-12-26');
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await esperar();

    expect(escrituras()).toEqual([]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('si el borrado falla, el motivo se pinta DENTRO del dialogo', async () => {
    // Detras del dialogo no se lee, y el dialogo sigue abierto pidiendo que se
    // confirme algo que acaba de fallar.
    montar({ errorAlEscribir: new ErrorDeApi(AUSENCIA_INEXISTENTE, 404) });

    await abrirElBorradoDe('Sala Principal', '2026-12-24 a 2026-12-26');
    await userEvent.click(screen.getByRole('button', { name: 'Borrar' }));
    await esperar();

    expect(screen.getByRole('dialog')).toHaveTextContent(AUSENCIA_INEXISTENTE);
  });
});

// ---------------------------------------------------------------------------
// Una escritura que falla sale UNA sola vez
// ---------------------------------------------------------------------------

/**
 * TODOS LOS CONTEOS DE ESCRITURAS DE ARRIBA CORREN SOBRE UN 200 O SOBRE UN
 * FALLO QUE SE MIRA ENSEGUIDA.
 *
 * Sobre un 200 no hay reintento que contar, y un `retry: 2` solo actua cuando
 * la peticion falla: pasa por delante de los tests de ruta, de metodo, de
 * cuerpo y de todos los `toHaveLength(1)` sin que ninguno lo note. Se midio en
 * el spec del hook: con `retry: 2` en `useCrearAusencia`, los 100 tests de la
 * fase seguian en verde y `tsc` tambien.
 *
 * El daño es real y silencioso: un POST no es idempotente. Un 500 o un timeout
 * DESPUES de que la fila se escribio —el caso clasico— deja tres cierres
 * duplicados, el admin ve un error en pantalla y tres feriados en la lista.
 *
 * Aqui se mide un escalon mas arriba que en el hook: lo que cuenta es cuantas
 * veces salio la peticion desde LA PANTALLA, asi que tambien caeria un
 * reintento puesto en el `onError` del componente. Se espera a que el error
 * este PINTADO: con un reintento, el texto no aparece hasta que terminan los
 * tres intentos, y contar antes seria contar uno.
 */
describe('una escritura que falla sale UNA sola vez', () => {
  it('el alta', { timeout: 20_000 }, async () => {
    montar({
      errorAlEscribir: new ErrorDeApi(ORDEN_DE_LAS_FECHAS, 400, {
        message: [ORDEN_DE_LAS_FECHAS],
      }),
    });

    await completarElAlta();
    await enviarElAlta();
    await screen.findByText(ORDEN_DE_LAS_FECHAS, {}, { timeout: 15_000 });

    expect(escrituras(), 'el POST se reintento: podrian quedar cierres duplicados').toHaveLength(1);
  });

  it('el borrado', { timeout: 20_000 }, async () => {
    montar({ errorAlEscribir: new ErrorDeApi(AUSENCIA_INEXISTENTE, 404) });

    await abrirElBorradoDe('Sala Principal', '2026-12-24 a 2026-12-26');
    await userEvent.click(screen.getByRole('button', { name: 'Borrar' }));
    await screen.findByText(AUSENCIA_INEXISTENTE, {}, { timeout: 15_000 });

    expect(escrituras()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// El tiempo
// ---------------------------------------------------------------------------

/**
 * ESTAR ABIERTA NO ES HACER ALGO.
 *
 * Ningun test de este paquete adelanta el reloj, asi que TODO lo que una
 * pantalla haga sola pasado un rato es invisible: la lista blanca de
 * peticiones cuenta lo que se pidio en los primeros milisegundos y se va. Un
 * `refetchInterval` de medio minuto, o un `setInterval` que vuelva a pedir la
 * lista «porque hay dos admins cargando feriados», pasa por delante del
 * marcado, de los cuerpos, de los almacenes, de las dos caches y de la lista
 * blanca entera.
 *
 * Y el daño no es solo una peticion de mas por minuto por pestaña abierta: la
 * pantalla manda al login cuando una consulta trae un 401, asi que una
 * relectura de fondo con el token recien caducado arranca al admin del
 * formulario a medio escribir, sin que nadie haya tocado nada.
 *
 * Se miran CINCO MINUTOS, que es mas de lo que dura cualquier intervalo que
 * alguien ponga «por comodidad».
 */
describe('el tiempo', () => {
  it('la pantalla abierta cinco minutos no pide nada por su cuenta', async () => {
    vi.useFakeTimers();

    try {
      montar();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5 * 60_000);
      });

      expect(rutasPedidas()).toEqual(PETICIONES_DE_LA_PANTALLA);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// La sesion
// ---------------------------------------------------------------------------

describe('la sesion caducada', () => {
  it('manda al login conservando los filtros', async () => {
    // Los filtros viven en la URL: volver del login a la lista entera es
    // perder el mes que la persona acababa de acotar.
    montar({ error: new ErrorDeApi('Unauthorized', 401), consulta: 'desde=2026-12-01' });
    await esperar();

    expect(empujar).toHaveBeenCalledWith(
      `/mi-gym/login?volverA=${encodeURIComponent('/mi-gym/admin/ausencias?desde=2026-12-01')}`,
    );
  });

  it('y no ofrece reintentar, que seria volver a fallar', async () => {
    montar({ error: new ErrorDeApi('Unauthorized', 401) });
    await esperar();

    expect(screen.queryByRole('button', { name: /reintentar/i })).toBeNull();
    expect(document.body.innerHTML).not.toContain('Unauthorized');
  });

  it('un fallo que no es de sesion si se puede reintentar', async () => {
    montar({ error: new ErrorDeApi('Se cayo la base', 500) });
    await esperar();

    expect(screen.getByText('Se cayo la base')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reintentar/i })).toBeInTheDocument();
  });
});
