import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PagoPublico, RolUsuario, UsuarioDetalle } from '@boxadmin/shared';
import { ErrorDeApi } from '@/lib/cliente';
import { vigilarEstosDatos } from '@/test/espia-de-consola';
import { ProveedorDeRol } from '../../rol-del-panel';
import {
  BloqueDePagos,
  LA_SENA_NO_PONE_AL_DIA,
  NI_SIQUIERA_PARA_VERLOS,
  NO_SE_PUDO_LEER,
  QUIEN_NO_SE_PUEDE_NOMBRAR,
  SIN_PAGOS,
  comoSeLlamaEsePago,
} from './bloque-pagos';

// ---------------------------------------------------------------------------
// Andamiaje
// ---------------------------------------------------------------------------

/**
 * LO QUE ESTE BLOQUE SIEMBRA Y NO PUEDE ESCAPARSE POR LOS CANALES QUE NO SON EL
 * `<body>`.
 *
 * El tapon vive en `vitest.setup.ts`, vigila SIEMPRE los secretos del panel y
 * esto le agrega lo propio de este archivo, para todos sus tests.
 *
 * EL MONTO TERMINA EN `.10` A PROPOSITO: es el importe que un float binario no
 * representa, asi que ademas de centinela es la sonda que delata a quien
 * convierta el dinero por el camino —`25000.1` ya no es el mismo texto y
 * tampoco el mismo centinela—. Es el mismo valor que uso la T1 en
 * `use-dinero.spec`.
 *
 * LA NOTA es texto libre que escribe el mostrador sobre UNA PERSONA al lado de
 * lo que pago, y el `tenantId` es el dato que la Fase 0 se ocupo de que no
 * cruzara entre gimnasios: viaja dentro de cada pago que este bloque recibe.
 * El NOMBRE lo recibe el bloque en su prop `usuario` aunque no lo pinte en
 * ningun sitio, que es exactamente el caso que hay que vigilar.
 */
const CENTINELAS = {
  tenantIdDelGimnasio: 'tnt-centinela',
  nombreDeLaPersona: 'Ana-Centinela Perez',
  montoDelPago: '25000.10',
  notaDelCobro: 'Nota-Centinela-pago-en-mano',
};

vigilarEstosDatos(CENTINELAS);

const { pedirEspia } = vi.hoisted(() => ({ pedirEspia: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({ slug: 'mi-gym', id: 'u1' }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/mi-gym/admin/usuarios/u1',
}));

/**
 * Se dobla `pedir`, no `fetch`.
 *
 * Que `pedir` arme bien la URL ya lo fija `use-dinero.spec`. Lo que se audita
 * aqui es un escalon mas arriba: QUE pide este bloque, QUE cuerpo manda y que
 * hace con lo que vuelve. `ErrorDeApi` se deja REAL porque la pantalla ramifica
 * con `instanceof` y el mensaje sale de la instancia.
 */
vi.mock('@/lib/cliente', async (original) => ({
  ...(await original<typeof import('@/lib/cliente')>()),
  pedir: pedirEspia,
}));

afterEach(() => {
  vi.clearAllMocks();
  // Los almacenes del navegador los deja como estaban —y ademas los AUDITA— el
  // tapon global de `vitest.setup.ts`. Limpiarlos aqui, en un `afterEach` del
  // spec que corre ANTES que el suyo, lo dejaria mirando unos almacenes vacios.
});

// ---------------------------------------------------------------------------
// Los fijos
// ---------------------------------------------------------------------------

/** Los dos ids de la persona. `Usuario` y `Perfil` son DOS tablas. */
const ANA = { usuarioId: 'u1', perfilId: 'perfil-de-ana' };

/**
 * LOS DOS ADMINISTRADORES, Y SON DOS IDS DISTINTOS.
 *
 * Con uno solo, «lo anulo el mismo que lo cobro» y «lo anulo otro» serian la
 * misma afirmacion y ningun test podria distinguirlas: es la tercera forma de
 * montar un test que no puede fallar. Hay un pago de cada caso.
 */
const QUIEN_COBRO = 'u-admin-operativo';
const QUIEN_ANULO = 'u-jefa-del-salon';

function laPersona(cambios: Partial<UsuarioDetalle> = {}): UsuarioDetalle {
  return {
    id: ANA.usuarioId,
    tenantId: CENTINELAS.tenantIdDelGimnasio,
    nombreCompleto: CENTINELAS.nombreDeLaPersona,
    email: 'ana@gym.test',
    rol: 'ALUMNO',
    activo: true,
    perfilId: ANA.perfilId,
    telefono: null,
    packId: null,
    pagoAlDia: true,
    salaIds: [],
    clasesExtra: 0,
    cancelacionesUsadas: 0,
    vigenciaDesde: null,
    vigenciaHasta: null,
    pack: null,
    salas: [],
    ...cambios,
  };
}

/**
 * TRES PAGOS, Y CADA UNO ESTA POR UN MOTIVO. CON TODOS LOS VALORES DISTINTOS
 * ENTRE SI.
 *
 * La cuarta forma de que un test no pueda fallar es el CASO CIEGO: en la Fase
 * 13 una mutacion no cayo porque el fijo tenia dos numeros iguales. Aqui los
 * tres montos, los tres metodos, los seis extremos de cobertura y los tres
 * instantes de entrada son todos distintos, asi que ninguna asercion puede
 * pasar en verde sobre la fila equivocada.
 *
 * Y LOS TRES SON RESPUESTAS QUE LA API PUEDE DAR. Se verifico leyendo
 * `PagosService` y `aPagoPublico`, punto por punto:
 *
 *  - `monto` sale de `fila.monto.toFixed(2)`: SIEMPRE dos decimales. Los tres
 *    los tienen.
 *  - `cubreDesde`/`cubreHasta` salen de `aFechaISO`: `YYYY-MM-DD`. Y
 *    `cubreHasta` nunca es anterior a `cubreDesde`, que es un 400 de `crear`.
 *  - `anuladoEn` y `anuladoPor` se escriben JUNTOS, en la misma linea de
 *    `anular` y de `fijarEstado`. Ninguno de los tres fijos tiene uno sin el
 *    otro, y el instante de la anulacion es POSTERIOR al de la creacion.
 *  - `createdAt` y `anuladoEn` son ISO 8601 completo (`toISOString()`).
 *  - Y VIENEN ORDENADOS POR `createdAt` DESCENDENTE, que es el `orderBy` de
 *    `listar`. La constante de abajo los lista en ese orden y no en el que
 *    resultaria comodo de leer: un fijo con el orden invertido seria una
 *    respuesta que este endpoint no puede devolver.
 */
function unPago(cambios: Partial<PagoPublico> & Pick<PagoPublico, 'id'>): PagoPublico {
  return {
    tenantId: CENTINELAS.tenantIdDelGimnasio,
    perfilId: ANA.perfilId,
    monto: '1000.00',
    metodo: 'EFECTIVO',
    esSena: false,
    cubreDesde: '2026-10-01',
    cubreHasta: '2026-10-31',
    comprobanteId: null,
    registradoPor: QUIEN_COBRO,
    nota: null,
    anuladoEn: null,
    anuladoPor: null,
    createdAt: '2026-10-01T09:15:00.000Z',
    ...cambios,
  };
}

/** La sena: lo mas reciente, y la bandera cuyo efecto no esta en su nombre. */
const LA_SENA = unPago({
  id: 'pg-sena',
  monto: '7500.25',
  metodo: 'TRANSFERENCIA',
  esSena: true,
  cubreDesde: '2026-11-01',
  cubreHasta: '2026-11-30',
  createdAt: '2026-10-05T11:20:00.000Z',
});

/** El vigente: el que lleva el monto centinela y la nota centinela. */
const EL_VIGENTE = unPago({
  id: 'pg-vigente',
  monto: CENTINELAS.montoDelPago,
  metodo: 'EFECTIVO',
  nota: CENTINELAS.notaDelCobro,
  cubreDesde: '2026-10-01',
  cubreHasta: '2026-10-31',
  createdAt: '2026-10-01T09:15:00.000Z',
});

/** El anulado POR OTRA PERSONA. Sigue en la lista: anular no es borrar. */
const EL_ANULADO = unPago({
  id: 'pg-anulado',
  monto: '19900.99',
  metodo: 'OTRO',
  cubreDesde: '2026-09-01',
  cubreHasta: '2026-09-30',
  createdAt: '2026-09-01T08:05:00.000Z',
  anuladoEn: '2026-09-07T16:45:00.000Z',
  anuladoPor: QUIEN_ANULO,
});

/** El anulado POR QUIEN LO COBRO. El otro caso de la misma frase. */
const EL_ANULADO_POR_SI_MISMO = unPago({
  id: 'pg-anulado-2',
  monto: '3300.33',
  metodo: 'CORTESIA',
  cubreDesde: '2026-08-01',
  cubreHasta: '2026-08-31',
  createdAt: '2026-08-01T07:00:00.000Z',
  anuladoEn: '2026-08-03T18:10:00.000Z',
  anuladoPor: QUIEN_COBRO,
});

/** Los tres, en el orden en que `GET /pagos` los devuelve: `createdAt` desc. */
const LOS_TRES = [LA_SENA, EL_VIGENTE, EL_ANULADO];

// ---------------------------------------------------------------------------
// El servidor de mentira
// ---------------------------------------------------------------------------

interface OpcionesDeMontaje {
  pagos?: PagoPublico[];
  usuario?: UsuarioDetalle;
  /** Lo que falla al LEER la lista. */
  errorDeLectura?: unknown;
  /** Lo que falla al ESCRIBIR. Las lecturas siguen funcionando. */
  errorDeEscritura?: unknown;
  /** El rol de QUIEN MIRA, no el de la persona de la ficha. */
  rol?: RolUsuario | null;
}

function esEscritura(opciones: { metodo?: string } | undefined): boolean {
  return opciones?.metodo !== undefined && opciones.metodo !== 'GET';
}

/** Las rutas pedidas, en orden y SIN DEDUPLICAR: una lectura repetida se ve. */
function rutasPedidas(): string[] {
  return pedirEspia.mock.calls.map(([ruta]) => ruta as string);
}

/** Solo las que ESCRIBEN, que son las que auditan los tests de cuerpo. */
function escrituras(): [string, { metodo?: string; cuerpo?: Record<string, unknown> }][] {
  return pedirEspia.mock.calls.filter((llamada) =>
    esEscritura(llamada[1] as { metodo?: string } | undefined),
  ) as [string, { metodo?: string; cuerpo?: Record<string, unknown> }][];
}

/** El cuerpo de la UNICA escritura que hubo. Falla si hubo otra cantidad. */
function elUnicoCuerpo(): Record<string, unknown> {
  const todas = escrituras();
  expect(todas).toHaveLength(1);
  return todas[0]?.[1].cuerpo ?? {};
}

function prepararServidor(opciones: OpcionesDeMontaje): QueryClient {
  const pagos = opciones.pagos ?? LOS_TRES;

  pedirEspia.mockImplementation(
    (ruta: string, opcionesDePeticion?: { metodo?: string; cuerpo?: unknown }) => {
      if (esEscritura(opcionesDePeticion)) {
        if (opciones.errorDeEscritura !== undefined) {
          return Promise.reject(opciones.errorDeEscritura);
        }

        // Anular devuelve el pago YA ANULADO, no un 204: lo dice el contrato
        // del controller (`Promise<PagoPublico>`). El `perfilId` de esa
        // respuesta es lo que el hook usa para invalidar.
        if (ruta.endsWith('/anular')) {
          const id = ruta.slice('/pagos/'.length, -'/anular'.length);
          const anulado = pagos.find((pago) => pago.id === id) ?? EL_VIGENTE;
          return Promise.resolve({
            ...anulado,
            anuladoEn: '2026-10-23T10:00:00.000Z',
            anuladoPor: QUIEN_ANULO,
          });
        }

        // El POST devuelve el pago creado, con su `perfilId` dentro.
        const cuerpo = (opcionesDePeticion?.cuerpo ?? {}) as Partial<PagoPublico>;
        return Promise.resolve(unPago({ id: 'pg-nuevo', ...cuerpo }));
      }

      if (opciones.errorDeLectura !== undefined) return Promise.reject(opciones.errorDeLectura);
      return Promise.resolve(pagos);
    },
  );

  // `staleTime: Infinity` para que una clave ya pedida no se vuelva a pedir:
  // asi la lista de rutas cuenta peticiones de verdad y no refrescos.
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
}

/** Deja que las consultas y mutaciones se resuelvan y que React pinte. */
async function esperar(): Promise<void> {
  await act(async () => {
    for (let vuelta = 0; vuelta < 6; vuelta += 1) {
      await new Promise((resolver) => setTimeout(resolver, 0));
    }
  });
}

/**
 * Monta el bloque DENTRO del proveedor de rol, que es como vive.
 *
 * `rol: null` monta SIN proveedor a proposito —no con un proveedor que reparta
 * `null`, que es lo que `ProveedorDeRol` no acepta—: es el caso de la pantalla
 * montada fuera del armazon del panel.
 */
async function montar(opciones: OpcionesDeMontaje = {}): Promise<void> {
  const cliente = prepararServidor(opciones);
  const usuario = opciones.usuario ?? laPersona();
  const rol = opciones.rol === undefined ? 'ADMIN_OPERATIVO' : opciones.rol;

  render(
    <QueryClientProvider client={cliente}>
      {rol === null ? (
        <BloqueDePagos usuario={usuario} />
      ) : (
        <ProveedorDeRol rol={rol}>
          <BloqueDePagos usuario={usuario} />
        </ProveedorDeRol>
      )}
    </QueryClientProvider>,
  );

  await esperar();
}

// ---------------------------------------------------------------------------
// Como se mira una fila
// ---------------------------------------------------------------------------

/**
 * La fila de UN pago, encontrada por su id y no por su texto ni su posicion.
 *
 * Buscar por texto ata el test a la ortografia; por indice, al orden —que aqui
 * ademas lo fija el servidor—.
 */
function filaDe(pagoId: string): HTMLElement {
  const fila = document.querySelector(`[data-pago="${pagoId}"]`);
  if (fila === null) throw new Error(`No hay fila para el pago ${pagoId}`);
  return fila as HTMLElement;
}

/**
 * El texto EXACTO de un dato de una fila, o `null` si ese nodo no esta.
 *
 * Devolver el texto y no un booleano para poder afirmar por IGUALDAD. La
 * primera forma de que un test no pueda fallar es la casualidad ortografica:
 * `not.toContain('0.00')` pasa en verde sobre un `10.00`, y `not.toContain('0%')`
 * sobre un `100%`. Con el nodo propio y una igualdad, no hay casualidad posible.
 */
function datoDe(pagoId: string, atributo: string): string | null {
  const nodo = filaDe(pagoId).querySelector(`[${atributo}]`);
  return nodo === null ? null : (nodo.textContent?.trim() ?? '');
}

/**
 * EL MARCADO DE UNA FILA SIN EL NODO QUE TIENE QUE CAMBIAR.
 *
 * Es la tecnica para afirmar que algo NO SE DICE sin caer en un `not.toContain`:
 * se monta dos veces con las dos variantes, se quita de las dos el nodo que
 * debe cambiar y se compara TODO LO DEMAS por igualdad. Asi se fija a la vez
 * que la variante dice lo suyo y que no cambia nada mas por el camino —un
 * `esSena` que ademas pintara otro monto, u ocultara la nota, pasaria
 * desapercibido mirando solo el nodo nuevo—.
 */
function filaSinElNodo(pagoId: string, selector: string): string {
  const copia = filaDe(pagoId).cloneNode(true) as HTMLElement;
  for (const nodo of copia.querySelectorAll(selector)) nodo.remove();
  return copia.innerHTML;
}

/**
 * Los botones QUE HAY EN EL MARCADO, sin pasar por el arbol de accesibilidad.
 *
 * `getAllByRole('button')` excluye por su cuenta lo que lleva `hidden`,
 * `aria-hidden` o `display:none`, asi que con el no se puede afirmar que algo
 * NO ESTA: se puede afirmar que no se ve, que es otra cosa —y es justo la
 * diferencia entre «el boton no existe» y «el boton esta escondido con CSS y
 * sigue cableado»—. `querySelectorAll` no sabe nada de accesibilidad y
 * devuelve lo que el navegador recibio.
 */
function botonesDelMarcado(): string[] {
  return [...document.querySelectorAll('button')].map((boton) => boton.textContent?.trim() ?? '');
}

/**
 * PULSA TODO LO QUE HAYA EN EL MARCADO, visible o no, dos vueltas.
 *
 * Con `.click()` nativo y no con `userEvent`: `userEvent` comprueba
 * visibilidad y `pointer-events` antes de pulsar, asi que se negaria a tocar
 * justamente el boton que se quiere probar. Lo que se mide no es si se puede
 * pulsar con el raton: es si el manejador esta cableado y la peticion sale.
 *
 * Dos vueltas porque anular son DOS pasos —el boton abre el dialogo y el
 * dialogo confirma—: con una sola, un boton escondido abriria el dialogo y la
 * peticion no saldria por falta de una pulsacion mas, no por una defensa.
 */
async function pulsarTodoLoQueHayaEnElMarcado(): Promise<void> {
  for (let vuelta = 0; vuelta < 2; vuelta += 1) {
    const botones = [...document.querySelectorAll('button')];
    await act(async () => {
      for (const boton of botones) boton.click();
      await Promise.resolve();
    });
    await esperar();
  }
}

/** Escribe en un campo reemplazando lo que hubiera. */
async function escribir(etiqueta: string | RegExp, texto: string): Promise<void> {
  const quienTeclea = userEvent.setup();
  const campo = screen.getByLabelText(etiqueta);
  await quienTeclea.clear(campo);
  if (texto !== '') await quienTeclea.type(campo, texto);
}

async function clicEn(nombre: string | RegExp): Promise<void> {
  await userEvent.setup().click(screen.getByRole('button', { name: nombre }));
  await esperar();
}

function enElDialogo() {
  return within(screen.getByRole('dialog'));
}

/** Llena el formulario de cobro con lo que el DTO exige. */
async function completarElCobro(
  cambios: { monto?: string; desde?: string; hasta?: string; nota?: string } = {},
): Promise<void> {
  await escribir('Monto', cambios.monto ?? CENTINELAS.montoDelPago);
  await escribir('Periodo cubierto desde', cambios.desde ?? '2026-12-01');
  await escribir('Periodo cubierto hasta', cambios.hasta ?? '2026-12-31');
  if (cambios.nota !== undefined) await escribir('Nota del cobro', cambios.nota);
}

// ---------------------------------------------------------------------------
// Lo que la pantalla tiene que decir
// ---------------------------------------------------------------------------

describe('la sena, que es una bandera cuyo efecto no esta en su nombre', () => {
  it('una sena dice que NO pone al alumno al dia', async () => {
    // LA TECNICA DE LOS DOS MONTAJES. Afirmar «no se dice» con un
    // `not.toContain` seria la primera trampa; y afirmar solo que el nodo
    // aparece dejaria pasar una sena que ademas cambiara otra cosa de la fila.
    await montar({ pagos: [LA_SENA] });

    const conSena = datoDe(LA_SENA.id, 'data-sena');
    const restoConSena = filaSinElNodo(LA_SENA.id, '[data-sena]');

    cleanup();

    await montar({ pagos: [{ ...LA_SENA, esSena: false }] });

    const sinSena = datoDe(LA_SENA.id, 'data-sena');
    const restoSinSena = filaSinElNodo(LA_SENA.id, '[data-sena]');

    // La consecuencia ESTA, y palabra por palabra: media frase borrada
    // ——«Sena» a secas, que es exactamente la mutacion— no pasaria esto.
    expect(conSena).toBe(LA_SENA_NO_PONE_AL_DIA);
    // Y no esta cuando no es una sena.
    expect(sinSena).toBeNull();
    // Y TODO LO DEMAS de la fila es identico: la bandera no cambia nada mas.
    expect(restoConSena).toBe(restoSinSena);
  });

  it('y la casilla del formulario tambien lo dice, antes de marcarla', async () => {
    // Enterarse DESPUES de cobrar no sirve: el cobro ya esta hecho.
    await montar({ pagos: [] });

    expect(document.querySelector('[data-sena-explicada]')?.textContent?.trim()).toBe(
      LA_SENA_NO_PONE_AL_DIA,
    );
  });
});

describe('anular no es borrar', () => {
  it('un pago anulado se distingue de uno vigente, con los dos en la lista', async () => {
    await montar({ pagos: LOS_TRES });

    // LOS DOS SIGUEN EN LA LISTA. La fila anulada no desaparece: `anuladoEn` y
    // `anuladoPor` son columnas y `PagosService.anular` deja escrito por que.
    expect(
      [...document.querySelectorAll('ul[aria-label="Pagos"] > li')].map((li) =>
        li.getAttribute('data-pago'),
      ),
    ).toEqual([LA_SENA.id, EL_VIGENTE.id, EL_ANULADO.id]);

    // Y SE DISTINGUEN, por nodos propios y no por un color: el vigente tiene el
    // suyo y no el del anulado, y al reves. Cuatro igualdades y ningun
    // `toContain`.
    expect(datoDe(EL_ANULADO.id, 'data-anulado')).not.toBeNull();
    expect(datoDe(EL_ANULADO.id, 'data-vigente')).toBeNull();
    expect(datoDe(EL_VIGENTE.id, 'data-vigente')).toBe('Vigente.');
    expect(datoDe(EL_VIGENTE.id, 'data-anulado')).toBeNull();
  });

  it('anular dice quien y cuando', async () => {
    await montar({ pagos: [EL_ANULADO, EL_ANULADO_POR_SI_MISMO] });

    // CUANDO: la fecha y la hora EXACTAS, cada una en su nodo. Tal como las
    // escribio el servidor, sin pasar por la zona del navegador —si no, el
    // mismo pago se leeria distinto en dos maquinas del mismo mostrador—.
    expect(datoDe(EL_ANULADO.id, 'data-anulado-fecha')).toBe('2026-09-07');
    expect(datoDe(EL_ANULADO.id, 'data-anulado-hora')).toBe('16:45');
    expect(datoDe(EL_ANULADO_POR_SI_MISMO.id, 'data-anulado-fecha')).toBe('2026-08-03');
    expect(datoDe(EL_ANULADO_POR_SI_MISMO.id, 'data-anulado-hora')).toBe('18:10');

    /**
     * QUIEN: lo que se puede decir CON VERDAD, que no es un nombre.
     *
     * `registradoPor` y `anuladoPor` son ids de USUARIO y no hay forma de
     * resolverlos desde el cliente —`GET /usuarios` lista alumnos y profesores
     * y NUNCA administradores, que es justo lo que los dos son siempre—. Asi
     * que no se pinta el cuid: se compara un id con el otro, que contesta la
     * pregunta util sin resolver ninguno. Los dos casos estan sembrados con
     * ids distintos a proposito.
     */
    expect(datoDe(EL_ANULADO.id, 'data-anulado-quien')).toBe(
      'Lo anulo un administrador distinto del que lo cobro.',
    );
    expect(datoDe(EL_ANULADO_POR_SI_MISMO.id, 'data-anulado-quien')).toBe(
      'Lo anulo el mismo administrador que lo cobro.',
    );

    // Y NINGUN CUID EN PANTALLA. Un identificador delante del mostrador no le
    // sirve a nadie y ademas se lee como un dato roto.
    expect(document.body.innerHTML).not.toContain(QUIEN_ANULO);
    expect(document.body.innerHTML).not.toContain(QUIEN_COBRO);
  });

  it('anular pide confirmacion nombrando el monto y la fecha', async () => {
    await montar({ pagos: LOS_TRES, rol: 'ADMIN_SALON' });

    await clicEn(`Anular el pago de ${comoSeLlamaEsePago(EL_VIGENTE)}`);

    /**
     * POR EL NOMBRE ACCESIBLE DEL DIALOGO Y POR IGUALDAD EXACTA.
     *
     * `Confirmar` cuelga su `aria-labelledby` de la pregunta, asi que el nombre
     * del dialogo ES la pregunta: se lee por donde la leeria un lector de
     * pantalla y no por la posicion de un parrafo. Y por igualdad y no por
     * `toContain`, que es la primera trampa: `toContain('25000')` pasaria sobre
     * un «250000» y `toContain('2026-10')` sobre cualquiera de los tres pagos.
     */
    expect(
      screen.getByRole('dialog', {
        name: `Anular el pago de ${CENTINELAS.montoDelPago} que cubre del 2026-10-01 al 2026-10-31`,
      }),
    ).toBeInTheDocument();

    // Y hasta aqui no se mando nada: preguntar no es hacer.
    expect(escrituras()).toEqual([]);
  });

  it('confirmar manda el PATCH de ESE pago, con su id y nada en el cuerpo', async () => {
    await montar({ pagos: LOS_TRES, rol: 'ADMIN_SALON' });

    // Se pulsa la SEGUNDA fila de las tres sembradas: con la primera, «se manda
    // el id de esa fila» y «se manda el id de la primera» serian la misma
    // afirmacion y el test no podria fallar.
    await clicEn(`Anular el pago de ${comoSeLlamaEsePago(EL_VIGENTE)}`);
    await userEvent.setup().click(enElDialogo().getByRole('button', { name: 'Anular' }));
    await esperar();

    // Sin cuerpo: el `PATCH :id/anular` no lleva DTO y una clave de mas es un
    // 400 de la peticion entera, porque la API corre con `forbidNonWhitelisted`.
    expect(escrituras()).toEqual([[`/pagos/${EL_VIGENTE.id}/anular`, { metodo: 'PATCH' }]]);
  });

  it('a un pago ya anulado no se le ofrece anularlo', async () => {
    // `PagosService.anular` contesta 409 «Ese pago ya estaba anulado»: un boton
    // que solo puede fallar es ofrecer un error.
    await montar({ pagos: LOS_TRES, rol: 'ADMIN_SALON' });

    expect(filaDe(EL_ANULADO.id).querySelector('button')).toBeNull();
    expect(filaDe(EL_VIGENTE.id).querySelector('button')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Las dos mitades del rol
// ---------------------------------------------------------------------------

describe('registrar es operativo y deshacerlo es contable', () => {
  it('un ADMIN_OPERATIVO no tiene el boton de anular en el marcado', async () => {
    // LA TECNICA DE LOS DOS MONTAJES otra vez, y por el mismo motivo: con un
    // `queryByRole` un boton escondido con CSS pasaria en verde y seguiria en
    // el HTML que llego al navegador.
    await montar({ pagos: LOS_TRES, rol: 'ADMIN_SALON' });
    const conSalon = botonesDelMarcado();

    cleanup();

    await montar({ pagos: LOS_TRES, rol: 'ADMIN_OPERATIVO' });
    const conOperativo = botonesDelMarcado();

    // Por IGUALDAD sobre el conjunto entero: al operativo le queda EXACTAMENTE
    // el boton de registrar, y al del salon ese mas uno por cada pago vigente
    // —dos de los tres sembrados lo estan—.
    expect(conOperativo).toEqual(['Registrar cobro']);
    expect(conSalon).toEqual(['Anular', 'Anular', 'Registrar cobro']);
  });

  it('y tampoco lo pide', async () => {
    /**
     * LA OTRA MITAD, Y NO LA CUBRE LA DE ARRIBA.
     *
     * Un boton dibujado con `className="hidden"` sale del arbol de
     * accesibilidad pero sigue CABLEADO: la peticion sale igual con una
     * pulsacion programatica, con un Enter desde el teclado o desde una
     * extension. Lo que se fija aqui es que no hay ningun camino desde el
     * marcado que termine en el PATCH.
     */
    await montar({ pagos: LOS_TRES, rol: 'ADMIN_OPERATIVO' });

    await pulsarTodoLoQueHayaEnElMarcado();

    expect(rutasPedidas().filter((ruta) => ruta.includes('/anular'))).toEqual([]);
  });

  it('un ADMIN_SALON si, y puede registrar tambien', async () => {
    // `rolAlcanza` es JERARQUIA NUMERICA y no una lista de roles exactos:
    // ADMIN_SALON es 40 y ADMIN_OPERATIVO 30, asi que 40 >= 30 y el del salon
    // conserva las dos acciones. Un `rol === 'ADMIN_OPERATIVO'` para registrar
    // se las quitaria.
    await montar({ pagos: [EL_VIGENTE], rol: 'ADMIN_SALON' });

    expect(botonesDelMarcado()).toEqual(['Anular', 'Registrar cobro']);

    await completarElCobro();
    await clicEn('Registrar cobro');

    expect(escrituras().map(([ruta, opciones]) => [ruta, opciones.metodo])).toEqual([
      ['/pagos', 'POST'],
    ]);
  });

  it('un SUPERADMIN tambien puede anular, porque los roles son jerarquicos', async () => {
    // El caso que una comparacion directa rompe siempre y que ningun test de
    // ADMIN_SALON puede ver.
    await montar({ pagos: [EL_VIGENTE], rol: 'SUPERADMIN' });

    expect(botonesDelMarcado()).toEqual(['Anular', 'Registrar cobro']);
  });

  it('sin proveedor de rol no se dibuja nada y no se pide nada', async () => {
    // `rol === null` es «sin proveedor», y eso es «no alcanza para nada». El
    // `@Get()` de `/pagos` lleva `@Roles('ADMIN_OPERATIVO')`: pedirlo sin rol
    // seria un 403 pintado como una averia.
    await montar({ rol: null });

    expect(screen.getByText(NI_SIQUIERA_PARA_VERLOS)).toBeInTheDocument();
    expect(rutasPedidas()).toEqual([]);
    expect(botonesDelMarcado()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Lo que viaja en el cuerpo
// ---------------------------------------------------------------------------

describe('lo que el formulario de cobro manda', () => {
  it('el monto se manda tal cual se escribio, sin pasar por un float', async () => {
    await montar({ pagos: [] });

    await completarElCobro({ monto: CENTINELAS.montoDelPago });
    await clicEn('Registrar cobro');

    const cuerpo = elUnicoCuerpo();

    // LA IGUALDAD EXACTA Y EL TIPO, las dos cosas. `25000.10` pasado por un
    // `Number()` vuelve `25000.1` —un decimal, no dos— y en el peor caso
    // `25000.100000000001`. Es dinero: el DTO exige `^\d{1,8}(\.\d{1,2})?$` y
    // un number ahi es un 400.
    expect(cuerpo.monto).toBe('25000.10');
    expect(typeof cuerpo.monto).toBe('string');
  });

  it('cubreDesde y cubreHasta viajan siempre', async () => {
    await montar({ pagos: [] });

    await completarElCobro({ desde: '2026-12-01', hasta: '2026-12-31' });
    await clicEn('Registrar cobro');

    const cuerpo = elUnicoCuerpo();

    expect(cuerpo.cubreDesde).toBe('2026-12-01');
    expect(cuerpo.cubreHasta).toBe('2026-12-31');

    // EL CONJUNTO ENTERO DE CLAVES, y no solo las dos de arriba. Los dos son
    // obligatorios en `CrearPagoDto` —omitir uno no es «desde hoy», es un
    // 400— y una clave DE MAS tambien es un 400: la API corre con
    // `forbidNonWhitelisted`. Con la nota vacia, `nota` NO viaja: la columna
    // nace en `null` y una cadena vacia no es «no puso nota».
    expect(Object.keys(cuerpo).sort()).toEqual(
      ['cubreDesde', 'cubreHasta', 'esSena', 'metodo', 'monto', 'perfilId'].sort(),
    );
  });

  it('esSena viaja SIEMPRE, incluso en false', async () => {
    // El defecto del servidor es `false` (`dto.esSena ?? false`), asi que
    // omitirlo HOY da lo mismo. Viaja escrito igual para que el dia que alguien
    // cambie ese `?? false` no cambie en silencio lo que cobra el mostrador:
    // es la leccion de la Fase 12.
    await montar({ pagos: [] });

    await completarElCobro();
    await clicEn('Registrar cobro');

    expect(elUnicoCuerpo().esSena).toBe(false);
  });

  it('marcar la casilla manda esSena en true', async () => {
    await montar({ pagos: [] });

    await completarElCobro();
    await userEvent.setup().click(screen.getByLabelText('Es una sena'));
    await clicEn('Registrar cobro');

    expect(elUnicoCuerpo().esSena).toBe(true);
  });

  it('el perfilId que viaja es el del PERFIL, no el del usuario', async () => {
    // Son dos tablas y los dos ids son cuid: mandar el equivocado no es un
    // error visible, es un pago colgado del perfil de nadie.
    await montar({ pagos: [] });

    await completarElCobro();
    await clicEn('Registrar cobro');

    expect(elUnicoCuerpo().perfilId).toBe(ANA.perfilId);
    expect(elUnicoCuerpo().perfilId).not.toBe(ANA.usuarioId);
  });

  it('la nota viaja cuando se escribio', async () => {
    await montar({ pagos: [] });

    await completarElCobro({ nota: CENTINELAS.notaDelCobro });
    await clicEn('Registrar cobro');

    expect(elUnicoCuerpo().nota).toBe(CENTINELAS.notaDelCobro);
  });

  it('un monto con tres decimales no llega al servidor', async () => {
    // El mismo patron que el DTO, para no rechazar nada que la API aceptaria ni
    // al reves. Y comprobado con un valor que un `Number.isNaN(Number(...))`
    // daria por bueno.
    await montar({ pagos: [] });

    await completarElCobro({ monto: '25000.123' });
    await clicEn('Registrar cobro');

    expect(escrituras()).toEqual([]);
    expect(screen.getByText(/hasta 8 enteros/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Leer
// ---------------------------------------------------------------------------

describe('leer los pagos de esta persona', () => {
  it('pide los de ESE perfil y nada mas', async () => {
    await montar({ pagos: LOS_TRES });

    expect(rutasPedidas()).toEqual([`/pagos?perfilId=${ANA.perfilId}`]);
  });

  it('un fallo al leer no se parece a una persona sin pagos', async () => {
    /**
     * LA TRAMPA CONCRETA DE ESTA PANTALLA.
     *
     * Un 500 pintado como una lista vacia le dice al mostrador que esta persona
     * nunca pago, y lo que se hace con eso es cobrarle de nuevo. Se fijan las
     * DOS mitades —el fallo dibuja lo suyo y NO dibuja lo del vacio, y el vacio
     * al reves— porque la primera sola pasaria tambien si los dos estados
     * dibujaran las dos cosas.
     */
    await montar({ errorDeLectura: new ErrorDeApi('Se cayo la base', 500) });

    expect(document.querySelector('[data-fallo-al-leer]')).not.toBeNull();
    expect(document.querySelector('[data-sin-pagos]')).toBeNull();
    expect(screen.getByText(`${NO_SE_PUDO_LEER}Se cayo la base`)).toBeInTheDocument();

    cleanup();

    await montar({ pagos: [] });

    expect(document.querySelector('[data-sin-pagos]')).not.toBeNull();
    expect(document.querySelector('[data-fallo-al-leer]')).toBeNull();
    expect(screen.getByText(SIN_PAGOS)).toBeInTheDocument();
  });

  it('cada fila pinta SU monto, SU metodo y SU cobertura', async () => {
    // Los tres fijos tienen los tres datos distintos entre si: con dos iguales,
    // «se pinta el de esta fila» y «se pinta el de la primera» serian la misma
    // afirmacion.
    await montar({ pagos: LOS_TRES });

    expect(datoDe(EL_VIGENTE.id, 'data-monto')).toBe('25000.10');
    expect(datoDe(LA_SENA.id, 'data-monto')).toBe('7500.25');
    expect(datoDe(EL_ANULADO.id, 'data-monto')).toBe('19900.99');

    expect(datoDe(EL_VIGENTE.id, 'data-metodo')).toBe('EFECTIVO');
    expect(datoDe(LA_SENA.id, 'data-metodo')).toBe('TRANSFERENCIA');
    expect(datoDe(EL_ANULADO.id, 'data-metodo')).toBe('OTRO');

    expect(datoDe(LA_SENA.id, 'data-cubre-desde')).toBe('2026-11-01');
    expect(datoDe(LA_SENA.id, 'data-cubre-hasta')).toBe('2026-11-30');
    expect(datoDe(LA_SENA.id, 'data-entro')).toBe('2026-10-05');
  });

  it('dice que el sistema SI guarda quien cobro, aunque aqui no se pueda ver', async () => {
    /**
     * LA DIFERENCIA ENTRE «no se puede ver aqui» Y «no quedo registrado».
     *
     * Sin esta frase, una pantalla que no nombra a nadie se lee como un sistema
     * que no guarda quien cobro, que es exactamente lo contrario de lo que pasa:
     * `registradoPor` sale del token (`actor.sub`, «NUNCA del cuerpo») y
     * `anuladoPor` tambien. Lo que falta es la forma de traducirlos, no el dato.
     */
    await montar({ pagos: LOS_TRES });

    expect(document.querySelector('[data-sin-nombres]')?.textContent?.trim()).toBe(
      QUIEN_NO_SE_PUEDE_NOMBRAR,
    );
  });

  it('el fallo al leer se puede reintentar sin perder la ficha', async () => {
    await montar({ errorDeLectura: new ErrorDeApi('Se cayo la base', 500) });

    await clicEn('Reintentar');

    expect(rutasPedidas().filter((ruta) => ruta.startsWith('/pagos'))).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Las escrituras que fallan
// ---------------------------------------------------------------------------

describe('una escritura que falla sale UNA sola vez', () => {
  it('el cobro', { timeout: 20_000 }, async () => {
    // Un POST no es idempotente: un 500 DESPUES de que la fila se escribio deja
    // dos cobros al mismo alumno, y eso se descubre cuadrando la caja a fin de
    // mes. Se espera a que el error este PINTADO: con un reintento, el texto no
    // aparece hasta el ultimo intento y contar antes contaria uno de tres.
    await montar({
      pagos: [],
      errorDeEscritura: new ErrorDeApi('cubreHasta no puede ser anterior a cubreDesde', 400),
    });

    await completarElCobro();
    await clicEn('Registrar cobro');
    await screen.findByText(
      'cubreHasta no puede ser anterior a cubreDesde',
      {},
      { timeout: 15_000 },
    );

    expect(escrituras()).toHaveLength(1);
  });

  it('la anulacion, y el motivo se lee DENTRO del dialogo', { timeout: 20_000 }, async () => {
    await montar({
      pagos: [EL_VIGENTE],
      rol: 'ADMIN_SALON',
      errorDeEscritura: new ErrorDeApi('Ese pago ya estaba anulado', 409),
    });

    await clicEn(`Anular el pago de ${comoSeLlamaEsePago(EL_VIGENTE)}`);
    await userEvent.setup().click(enElDialogo().getByRole('button', { name: 'Anular' }));
    await screen.findByText('Ese pago ya estaba anulado', {}, { timeout: 15_000 });

    // Detras del dialogo no se lee, y el dialogo sigue abierto pidiendo que se
    // confirme algo que acaba de fallar.
    expect(enElDialogo().getByText('Ese pago ya estaba anulado')).toBeInTheDocument();
    expect(escrituras()).toHaveLength(1);
  });

  it('un 403 al anular se explica en palabras, no como «Forbidden»', async () => {
    // Aqui hay sesion y el rol alcanza para ENTRAR al panel: lo que no alcanza
    // es para esta accion, que pide ADMIN_SALON. «Algo salio mal» manda a quien
    // lo lee a mirar la red cuando tiene que llamar al dueno del salon.
    await montar({
      pagos: [EL_VIGENTE],
      rol: 'ADMIN_SALON',
      errorDeEscritura: new ErrorDeApi('Forbidden', 403),
    });

    await clicEn(`Anular el pago de ${comoSeLlamaEsePago(EL_VIGENTE)}`);
    await userEvent.setup().click(enElDialogo().getByRole('button', { name: 'Anular' }));
    await esperar();

    expect(
      enElDialogo().getByText(
        'Para esto hace falta ser administrador del salon. Tu rol no alcanza.',
      ),
    ).toBeInTheDocument();
  });
});
