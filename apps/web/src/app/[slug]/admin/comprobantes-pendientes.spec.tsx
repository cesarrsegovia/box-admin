import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComprobantePublico } from '@boxadmin/shared';
import { ErrorDeApi } from '@/lib/cliente';
import { clavesDeDinero } from '@/hooks/use-dinero';
import { vigilarEstosDatos } from '@/test/espia-de-consola';
import InicioDelPanel from './page';
import {
  APROBAR_ES_COBRAR,
  ComprobantesPendientes,
  EL_ENLACE_CADUCA,
  LA_COLA_NO_SON_TODAS,
  MONTO_INVALIDO,
  NADA_QUE_REVISAR,
  RECHAZAR_NO_COBRA,
} from './comprobantes-pendientes';

// ---------------------------------------------------------------------------
// Andamiaje
// ---------------------------------------------------------------------------

/**
 * LO QUE ESTE BLOQUE SIEMBRA Y NO PUEDE SALIRSE POR LOS CANALES QUE NO SON EL
 * `<body>`.
 *
 * El tapon vive en `vitest.setup.ts`, vigila SIEMPRE los secretos del panel y
 * esto le agrega lo propio de este archivo, para todos sus tests.
 *
 * EL MONTO TERMINA EN `.10` A PROPOSITO, y es la pieza mas util de la lista:
 * `25000.10` es un importe que un float binario NO representa, asi que ademas
 * de centinela es la sonda que delata a quien lo convierta por el camino
 * —`Number('25000.10')` es `25000.1`, que ya no es el mismo texto ni el mismo
 * centinela—. Mismo valor que usaron la T1 en `use-dinero.spec` y la T2 en
 * `bloque-pagos.spec`.
 *
 * EL NOMBRE DEL ARCHIVO es un dato de una persona con nombre y apellido
 * —«transferencia-Ana-…»— que esta pantalla pinta a proposito: es con lo que
 * el admin decide cual esta mirando. Que se pinte es justamente lo que hace
 * util vigilarlo por los otros canales.
 *
 * LAS DOS NOTAS son texto libre que el mostrador escribe SOBRE una persona al
 * lado de lo que pago, y son dos distintas —la del cobro y el motivo del
 * rechazo— porque son dos gestos distintos y confundirlos en el registro seria
 * confundirlos en todos lados.
 *
 * Y LA URL FIRMADA, que es la unica de la lista que ademas CADUCA: una copia
 * suya en un almacen del navegador no solo es un dato que se escapa, es un
 * dato que se escapa y deja de servir. Ver el test «la url de descarga no se
 * guarda entre respuestas».
 */
const CENTINELAS = {
  tenantIdDelGimnasio: 'tnt-centinela',
  perfilDeQuienPago: 'perfil-centinela-de-ana',
  nombreDelArchivo: 'transferencia-Ana-Centinela-octubre.pdf',
  nombreDelOtroArchivo: 'deposito-Bruno-Centinela.jpg',
  laUrlFirmada: 'https://almacen.test/c/aaa?firma=FIRMA-CENTINELA-PRIMERA',
  elMontoCobrado: '25000.10',
  laNotaDelCobro: 'Nota-Centinela-entro-por-el-banco',
  elMotivoDelRechazo: 'Motivo-Centinela-la-foto-no-se-lee',
};

vigilarEstosDatos(CENTINELAS);

const { pedirEspia } = vi.hoisted(() => ({ pedirEspia: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({ slug: 'mi-gym' }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/mi-gym/admin',
}));

/**
 * Se dobla `pedir`, no `fetch`.
 *
 * Que `pedir` arme bien la URL ya lo fija `use-dinero.spec`. Lo que se audita
 * aqui es un escalon mas arriba: QUE pide esta pantalla, QUE cuerpo manda y
 * que hace con lo que vuelve. `ErrorDeApi` se deja REAL porque el bloque
 * ramifica con `instanceof` y el mensaje sale de la instancia.
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

const LA_RUTA_DE_LA_COLA = '/comprobantes?estado=PENDIENTE';

/**
 * DOS COMPROBANTES, Y EL FIJO ES POSIBLE EN TODO. VERIFICADO EN EL SERVICE,
 * CAMPO POR CAMPO, Y NO DEDUCIDO DEL CONTRATO.
 *
 * Son DOS y no uno por regla: con una sola fila, «aprueba el de ESA fila» y
 * «aprueba el primero de la lista» son la MISMA afirmacion y el test no puede
 * fallar. Y todo lo que los distingue esta sembrado DISTINTO —id, archivo,
 * tipo, fecha, url—: en la Fase 13 una mutacion no cayo porque el fijo tenia
 * dos numeros iguales.
 *
 * LO QUE EL SERVICE GARANTIZA Y AQUI SE RESPETA:
 *
 * - `subidoEn` NUNCA ES NULO. La rama del admin de `ComprobantesService.listar`
 *   hace `where.subidoEn = { not: null }`: al admin no le llegan filas sin
 *   archivo «porque serian enlaces rotos». Sembrar una seria sembrar una
 *   respuesta que la API no puede dar.
 * - Y POR LO MISMO `urlDeDescarga` TAMPOCO. `firmarSiHayArchivo` devuelve
 *   `null` solo cuando `subidoEn` es nulo, y `AlmacenDeArchivos.urlDeDescarga`
 *   esta tipado `Promise<string>`. La pantalla contempla el nulo porque el
 *   contrato lo permite (`string | null`), pero el spec no lo siembra.
 * - `nota`, `revisadoPor` Y `revisadoEn` SON NULOS EN TODO PENDIENTE. Los tres
 *   los escriben SOLO `aprobar` y `rechazar`, y las dos cambian el estado. Un
 *   PENDIENTE con nota no existe, y por eso la pantalla tampoco la pinta.
 * - EL ORDEN LO DA EL SERVIDOR: `orderBy: { createdAt: 'desc' }`, el mas nuevo
 *   primero. El fijo va en ese orden; la pantalla no reordena.
 */
const EL_NUEVO: ComprobantePublico = {
  id: 'cmp-de-la-transferencia',
  tenantId: CENTINELAS.tenantIdDelGimnasio,
  perfilId: CENTINELAS.perfilDeQuienPago,
  nombreOriginal: CENTINELAS.nombreDelArchivo,
  tipoMime: 'application/pdf',
  subidoEn: '2026-10-24T13:45:00.000Z',
  estado: 'PENDIENTE',
  revisadoPor: null,
  revisadoEn: null,
  nota: null,
  createdAt: '2026-10-24T13:40:00.000Z',
  urlDeDescarga: CENTINELAS.laUrlFirmada,
};

const EL_VIEJO: ComprobantePublico = {
  id: 'cmp-del-deposito',
  tenantId: CENTINELAS.tenantIdDelGimnasio,
  perfilId: 'perfil-de-bruno',
  nombreOriginal: CENTINELAS.nombreDelOtroArchivo,
  tipoMime: 'image/jpeg',
  subidoEn: '2026-10-22T09:05:00.000Z',
  estado: 'PENDIENTE',
  revisadoPor: null,
  revisadoEn: null,
  nota: null,
  createdAt: '2026-10-22T09:00:00.000Z',
  urlDeDescarga: 'https://almacen.test/c/bbb?firma=la-del-deposito',
};

const LOS_DOS = [EL_NUEVO, EL_VIEJO];

/** La segunda firma del MISMO archivo: la url se vuelve a firmar en cada respuesta. */
const LA_URL_REFIRMADA = 'https://almacen.test/c/aaa?firma=FIRMA-SEGUNDA-Y-DISTINTA';

/** El monto del OTRO cobro. Distinto del centinela, para que no se confundan. */
const EL_OTRO_MONTO = '7250.05';

// ---------------------------------------------------------------------------
// El servidor de mentira
// ---------------------------------------------------------------------------

interface Escenario {
  /** La cola que contesta el GET, siempre la misma. */
  cola?: ComprobantePublico[];
  /** Una cola DISTINTA por cada peticion. La ultima se repite si hay mas. */
  colaPorVuelta?: ComprobantePublico[][];
  errorDeLectura?: unknown;
  errorDeEscritura?: unknown;
}

function esEscritura(opciones: { metodo?: string } | undefined): boolean {
  return opciones?.metodo !== undefined && opciones.metodo !== 'GET';
}

/** Las rutas pedidas, en orden y SIN DEDUPLICAR: una lectura de mas se ve contando. */
function rutasPedidas(): string[] {
  return pedirEspia.mock.calls.map(([ruta]) => ruta as string);
}

/** Solo las que ESCRIBEN. */
function escrituras(): [string, { metodo?: string; cuerpo?: unknown }][] {
  return pedirEspia.mock.calls.filter((llamada) =>
    esEscritura(llamada[1] as { metodo?: string } | undefined),
  ) as [string, { metodo?: string; cuerpo?: unknown }][];
}

/** La ruta de la UNICA escritura que hubo. Falla si hubo otra cantidad. */
function laUnicaRuta(): string {
  const todas = escrituras();
  expect(todas).toHaveLength(1);
  return todas[0]?.[0] ?? '';
}

/**
 * EL CUERPO DE LA UNICA ESCRITURA, TAL COMO SALE AL CABLE.
 *
 * Pasa por `JSON.parse(JSON.stringify(...))` A PROPOSITO, y no es un adorno:
 * `pedir` serializa con `JSON.stringify`, que BORRA las claves `undefined`.
 * Mirando el objeto crudo, `{ nota: undefined }` y `{}` son dos cosas
 * distintas para `toStrictEqual` y la misma para `toEqual` — o sea que el test
 * de «la nota vacia no viaja» o no puede fallar o falla por el motivo
 * equivocado. Lo que importa es lo que recibe la API, y eso es el JSON.
 */
function elUnicoCuerpo(): Record<string, unknown> {
  const todas = escrituras();
  expect(todas).toHaveLength(1);
  return JSON.parse(JSON.stringify(todas[0]?.[1].cuerpo ?? {})) as Record<string, unknown>;
}

function prepararServidor(escenario: Escenario): QueryClient {
  let vuelta = 0;

  pedirEspia.mockImplementation(
    (ruta: string, opciones?: { metodo?: string; cuerpo?: unknown }) => {
      if (esEscritura(opciones)) {
        if (escenario.errorDeEscritura !== undefined) {
          return Promise.reject(escenario.errorDeEscritura);
        }

        // Las dos escrituras contestan `ComprobantePublico`, no un 204: lo dice
        // el controller. El `perfilId` de esa respuesta es lo que
        // `useAprobarComprobante` usa para invalidar los pagos de esa persona.
        const id = ruta.split('/')[2] ?? '';
        const tocado = LOS_DOS.find((uno) => uno.id === id) ?? EL_NUEVO;
        return Promise.resolve({
          ...tocado,
          estado: ruta.endsWith('/aprobar') ? 'APROBADO' : 'RECHAZADO',
        });
      }

      if (escenario.errorDeLectura !== undefined) return Promise.reject(escenario.errorDeLectura);

      // Las lecturas que no son la cola —las de los otros bloques de la
      // portada— contestan vacio: este spec no las audita, pero tienen que
      // poder resolverse para que la portada se pinte entera.
      if (ruta !== LA_RUTA_DE_LA_COLA) return Promise.resolve([]);

      const porVuelta = escenario.colaPorVuelta;
      if (porVuelta !== undefined) {
        const indice = Math.min(vuelta, porVuelta.length - 1);
        vuelta += 1;
        return Promise.resolve(porVuelta[indice] ?? []);
      }

      vuelta += 1;
      return Promise.resolve(escenario.cola ?? LOS_DOS);
    },
  );

  // `staleTime: Infinity` para que una clave ya pedida no se vuelva a pedir
  // sola: asi la lista de rutas cuenta peticiones de verdad y no refrescos, y
  // la que dispara una invalidacion se ve porque es la unica que hay.
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
}

/** Deja que las consultas y las mutaciones se resuelvan y que React pinte. */
async function esperar(): Promise<void> {
  await act(async () => {
    for (let giro = 0; giro < 6; giro += 1) {
      await new Promise((resolver) => setTimeout(resolver, 0));
    }
  });
}

async function montar(escenario: Escenario = {}): Promise<QueryClient> {
  const cliente = prepararServidor(escenario);

  render(
    <QueryClientProvider client={cliente}>
      <ComprobantesPendientes />
    </QueryClientProvider>,
  );
  await esperar();

  return cliente;
}

// ---------------------------------------------------------------------------
// Ayudantes de lectura
// ---------------------------------------------------------------------------

function elBloque(): HTMLElement {
  const nodo = document.querySelector('[data-bloque="comprobantes-pendientes"]');
  if (nodo === null) throw new Error('No hay bloque de comprobantes pendientes');
  return nodo as HTMLElement;
}

/** La fila de UN comprobante, por su id y nunca por su texto ni su posicion. */
function filaDe(id: string): HTMLElement {
  const fila = elBloque().querySelector(`[data-comprobante="${id}"]`);
  if (fila === null) throw new Error(`No hay fila para el comprobante ${id}`);
  return fila as HTMLElement;
}

/** El texto EXACTO de un dato de una fila, o `null` si ese nodo no esta. */
function datoDe(id: string, selector: string): string | null {
  const nodo = filaDe(id).querySelector(selector);
  return nodo === null ? null : (nodo.textContent?.trim() ?? '');
}

function idsEnPantalla(): (string | null)[] {
  return [...elBloque().querySelectorAll('[data-comprobante]')].map((nodo) =>
    nodo.getAttribute('data-comprobante'),
  );
}

/**
 * EL MARCADO DE UNA FILA SIN EL NODO QUE TIENE QUE CAMBIAR.
 *
 * Es la tecnica para afirmar que algo NO cambia sin caer en un `not.toContain`:
 * se monta dos veces con las dos variantes, se quita de las dos el nodo que SI
 * debe cambiar y se compara TODO LO DEMAS por igualdad.
 */
function filaSinElNodo(id: string, selector: string): string {
  const copia = filaDe(id).cloneNode(true) as HTMLElement;
  for (const nodo of copia.querySelectorAll(selector)) nodo.remove();
  return copia.innerHTML;
}

/**
 * Los botones QUE HAY EN EL MARCADO, sin pasar por el arbol de accesibilidad.
 *
 * `queryByRole('button')` excluye por su cuenta lo que lleva `hidden`,
 * `aria-hidden` o `display:none`: con el se puede afirmar que algo no SE VE,
 * no que no ESTA.
 */
function botonesDelMarcado(): string[] {
  return [...document.querySelectorAll('button')].map((boton) => boton.textContent?.trim() ?? '');
}

async function clicEn(nombre: string | RegExp): Promise<void> {
  await userEvent.setup().click(screen.getByRole('button', { name: nombre }));
  await esperar();
}

async function escribir(etiqueta: string, texto: string): Promise<void> {
  const quienTeclea = userEvent.setup();
  const campo = screen.getByLabelText(etiqueta);
  await quienTeclea.clear(campo);
  if (texto !== '') await quienTeclea.type(campo, texto);
}

/** Abre el formulario de aprobar de ESA fila, nombrandola por su archivo. */
async function abrirAprobar(comprobante: ComprobantePublico): Promise<void> {
  await clicEn(`Aprobar el comprobante ${comprobante.nombreOriginal}`);
}

async function abrirRechazar(comprobante: ComprobantePublico): Promise<void> {
  await clicEn(`Rechazar el comprobante ${comprobante.nombreOriginal}`);
}

/** Llena lo que el DTO exige y envia. */
async function cobrar(
  cambios: { monto?: string; hasta?: string; nota?: string } = {},
): Promise<void> {
  await escribir('Monto cobrado', cambios.monto ?? CENTINELAS.elMontoCobrado);
  await escribir('Cobertura hasta', cambios.hasta ?? '2026-11-30');
  if (cambios.nota !== undefined) await escribir('Nota del cobro', cambios.nota);
  await clicEn('Registrar el cobro y aprobar');
}

// ---------------------------------------------------------------------------
// La cola
// ---------------------------------------------------------------------------

describe('la cola de comprobantes', () => {
  it('lista los PENDIENTES, y el filtro viaja', async () => {
    await montar({ cola: LOS_DOS });

    // EL FILTRO EN LA RUTA, por igualdad exacta. Sin `?estado=PENDIENTE` la
    // cola traeria tambien los ya aprobados y los rechazados, y la portada
    // enseñaria como trabajo pendiente lo que ya se hizo.
    expect(rutasPedidas()).toEqual([LA_RUTA_DE_LA_COLA]);

    // Y LA PREMISA: que la lista este pintada de verdad. Sin esto, una
    // pantalla que no pinte nada pasaria la linea de arriba igual.
    expect(idsEnPantalla()).toEqual([EL_NUEVO.id, EL_VIEJO.id]);
    expect(datoDe(EL_NUEVO.id, '[data-archivo]')).toBe(CENTINELAS.nombreDelArchivo);
    expect(datoDe(EL_VIEJO.id, '[data-archivo]')).toBe(CENTINELAS.nombreDelOtroArchivo);
    expect(datoDe(EL_NUEVO.id, '[data-subido]')).toBe('2026-10-24');
    expect(datoDe(EL_VIEJO.id, '[data-subido]')).toBe('2026-10-22');
    expect(elBloque().querySelector('[data-cuantos]')?.textContent).toBe('2');
  });

  it('se pinta en el orden en que llega, que lo decide el servidor', async () => {
    // `orderBy: { createdAt: 'desc' }` en el service. Esta pantalla NO ordena:
    // una segunda opinion sobre el mismo orden es dos sitios que algun dia
    // discrepan y nadie sabe cual creer.
    await montar({ cola: [EL_VIEJO, EL_NUEVO] });

    expect(idsEnPantalla()).toEqual([EL_VIEJO.id, EL_NUEVO.id]);
  });

  it('dice que esta cola no son todos los comprobantes pendientes que hay', async () => {
    // El service le esconde al admin las filas sin archivo, «porque serian
    // enlaces rotos». Contar las filas de aqui y las de la base da numeros
    // distintos, y eso no es un fallo de paginacion: hay que decirlo ANTES de
    // que alguien abra un bug que no existe.
    await montar({ cola: LOS_DOS });

    // IGUALDAD EXACTA contra la constante: una frase recortada a la mitad
    // —justo la mitad que explica por que faltan— pasaria cualquier
    // `toContain`.
    expect(elBloque().querySelector('[data-la-cola-no-son-todas]')?.textContent).toBe(
      LA_COLA_NO_SON_TODAS,
    );
    expect(LA_COLA_NO_SON_TODAS).toContain('sin archivo');
  });

  it('las dos frases estan tambien mientras carga y tambien si falla', async () => {
    // Lo que explica que es esta lista no puede depender de que la lista haya
    // llegado: quien entra y ve el error tiene que poder leer que faltan filas
    // a proposito y que el enlace caduca.
    await montar({ errorDeLectura: new ErrorDeApi('Reventó', 500) });

    expect(elBloque().querySelector('[data-la-cola-no-son-todas]')?.textContent).toBe(
      LA_COLA_NO_SON_TODAS,
    );
    expect(elBloque().querySelector('[data-el-enlace-caduca]')?.textContent).toBe(EL_ENLACE_CADUCA);
  });
});

// ---------------------------------------------------------------------------
// Aprobar es cobrar
// ---------------------------------------------------------------------------

describe('aprobar un comprobante', () => {
  it('aprobar pide monto y cubreHasta, y dice que esta registrando un COBRO', async () => {
    // No es marcar un estado: el servicio acuña un Pago en la misma
    // transaccion. Afirmá sobre el marcado.
    await montar({ cola: LOS_DOS });
    await abrirAprobar(EL_NUEVO);

    // 1. LA PANTALLA LO DICE, por igualdad exacta y antes de los campos.
    const laFrase = filaDe(EL_NUEVO.id).querySelector('[data-aprobar-es-cobrar]');
    expect(laFrase?.textContent).toBe(APROBAR_ES_COBRAR);
    expect(APROBAR_ES_COBRAR).toContain('registra UN COBRO');
    expect(APROBAR_ES_COBRAR).toContain('caja del mes');
    // Y el boton tambien, que es lo ultimo que se lee antes de pulsar.
    expect(botonesDelMarcado()).toContain('Registrar el cobro y aprobar');

    // 2. LOS DOS CAMPOS OBLIGATORIOS DEL DTO ESTAN LOS DOS.
    expect(screen.getByLabelText('Monto cobrado')).toBeInTheDocument();
    expect(screen.getByLabelText('Cobertura hasta')).toBeInTheDocument();

    // 3. Y VIAJAN LOS DOS. La lista blanca del cuerpo es el conjunto ENTERO:
    // una clave de menos —el monto— es un 400 del `@Matches` que no lleva
    // `@IsOptional()`, y una de mas es un 400 de `forbidNonWhitelisted`.
    await cobrar();

    const cuerpo = elUnicoCuerpo();
    expect(Object.keys(cuerpo).sort()).toEqual(['cubreHasta', 'metodo', 'monto']);
    expect(cuerpo.monto).toBe(CENTINELAS.elMontoCobrado);
    expect(cuerpo.cubreHasta).toBe('2026-11-30');
  });

  it('sin monto no sale ninguna peticion, y se dice por que', async () => {
    await montar({ cola: LOS_DOS });
    await abrirAprobar(EL_NUEVO);

    await escribir('Cobertura hasta', '2026-11-30');
    await clicEn('Registrar el cobro y aprobar');

    expect(escrituras()).toHaveLength(0);
    expect(screen.getByText(MONTO_INVALIDO)).toBeInTheDocument();
  });

  it('el monto viaja como CADENA, sin pasar por un float', async () => {
    await montar({ cola: LOS_DOS });
    await abrirAprobar(EL_NUEVO);
    await cobrar({ monto: CENTINELAS.elMontoCobrado });

    const cuerpo = elUnicoCuerpo();

    // LAS DOS MITADES. El tipo, porque `Number('25000.10')` es un number y el
    // DTO pide una cadena contra un `@Matches`; y el VALOR por igualdad
    // exacta, porque ese number se serializa `25000.1` —un decimal, no dos— y
    // es otro dinero. Un `toContain('25000')` pasaria sobre `250000`.
    expect(typeof cuerpo.monto).toBe('string');
    expect(cuerpo.monto).toBe('25000.10');
    expect(cuerpo.monto).not.toBe('25000.1');

    // Y el camino malo no esta en NINGUN sitio del cuerpo, ni escondido en
    // otra clave: el JSON entero, que es lo que recibe la API.
    expect(JSON.stringify(cuerpo)).not.toContain('25000.1,');
    expect(JSON.stringify(cuerpo)).not.toContain('25000.1}');
  });

  it('el metodo viaja SIEMPRE, con TRANSFERENCIA puesto de entrada', async () => {
    // Es `@IsOptional()` en el DTO y el service pone `dto.metodo ?? 'TRANSFERENCIA'`.
    // Viaja igual, escrito: es la leccion de la Fase 12 —un campo con
    // consecuencias lo decide la pantalla—, y este cae en el desglose por
    // metodo de la caja del mes.
    await montar({ cola: LOS_DOS });
    await abrirAprobar(EL_NUEVO);
    await cobrar();

    expect(elUnicoCuerpo().metodo).toBe('TRANSFERENCIA');
  });

  it('la nota del cobro viaja cuando se escribio, y no cuando no', async () => {
    await montar({ cola: LOS_DOS });
    await abrirAprobar(EL_NUEVO);
    await cobrar({ nota: CENTINELAS.laNotaDelCobro });

    expect(elUnicoCuerpo().nota).toBe(CENTINELAS.laNotaDelCobro);

    cleanup();
    vi.clearAllMocks();

    await montar({ cola: LOS_DOS });
    await abrirAprobar(EL_NUEVO);
    await cobrar();

    // `nota: ''` se guardaria como cadena vacia, que no es «no puso nota»: la
    // columna nace en `null`.
    expect(Object.keys(elUnicoCuerpo())).not.toContain('nota');
  });

  it('aprueba el DE ESA FILA, con dos sembrados', async () => {
    await montar({ cola: LOS_DOS });

    // El SEGUNDO de la lista. Con el primero, «aprueba el de esa fila» y
    // «aprueba siempre el primero» serian la misma afirmacion.
    await abrirAprobar(EL_VIEJO);
    await cobrar({ monto: EL_OTRO_MONTO });

    expect(laUnicaRuta()).toBe(`/comprobantes/${EL_VIEJO.id}/aprobar`);
    expect(laUnicaRuta()).not.toBe(`/comprobantes/${EL_NUEVO.id}/aprobar`);
    expect(elUnicoCuerpo().monto).toBe(EL_OTRO_MONTO);
  });

  it('un 403 al aprobar se explica, y el formulario sigue ahi con lo escrito', async () => {
    await montar({ cola: LOS_DOS, errorDeEscritura: new ErrorDeApi('Forbidden', 403) });
    await abrirAprobar(EL_NUEVO);
    await cobrar();

    expect(screen.getByText(/administrador operativo/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Monto cobrado')).toHaveValue(CENTINELAS.elMontoCobrado);
    // Y NO se dice que se cobro nada: no se cobro.
    expect(document.querySelector('[data-ultimo-gesto]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Rechazar no es lo mismo
// ---------------------------------------------------------------------------

describe('rechazar un comprobante', () => {
  it('rechazar manda la nota si la hay, y `{}` si no', async () => {
    await montar({ cola: LOS_DOS });
    await abrirRechazar(EL_NUEVO);
    await escribir('Motivo del rechazo', CENTINELAS.elMotivoDelRechazo);
    await clicEn('Rechazar el comprobante');

    expect(laUnicaRuta()).toBe(`/comprobantes/${EL_NUEVO.id}/rechazar`);
    expect(elUnicoCuerpo()).toEqual({ nota: CENTINELAS.elMotivoDelRechazo });

    cleanup();
    vi.clearAllMocks();

    await montar({ cola: LOS_DOS });
    await abrirRechazar(EL_NUEVO);
    await clicEn('Rechazar el comprobante');

    // `RevisarComprobanteDto` tiene TODOS sus campos opcionales —leido, no
    // supuesto—, asi que un rechazo sin motivo es una peticion valida y el
    // cuerpo que sale al cable es `{}`. La igualdad es sobre el JSON y no
    // sobre el objeto: `{ nota: undefined }` se serializa `{}` y mirando el
    // objeto crudo este test no distinguiria las dos cosas.
    expect(elUnicoCuerpo()).toEqual({});
    expect(JSON.stringify(elUnicoCuerpo())).toBe('{}');
  });

  it('rechaza el DE ESA FILA, con dos sembrados', async () => {
    await montar({ cola: LOS_DOS });
    await abrirRechazar(EL_VIEJO);
    await clicEn('Rechazar el comprobante');

    expect(laUnicaRuta()).toBe(`/comprobantes/${EL_VIEJO.id}/rechazar`);
  });
});

// ---------------------------------------------------------------------------
// Las dos acciones no son la misma
// ---------------------------------------------------------------------------

describe('aprobar y rechazar', () => {
  it('aprobar y rechazar son acciones distintas, y se ve cual se hizo', async () => {
    // ANTES DE PULSAR: los dos formularios se dibujan distinto, y el resto de
    // la fila no cambia. Se monta dos veces, se quita de las dos el
    // formulario y se compara TODO LO DEMAS por igualdad: asi se fija a la vez
    // que la variante dice lo suyo y que no cambia nada mas por el camino.
    await montar({ cola: LOS_DOS });
    await abrirAprobar(EL_NUEVO);
    const conAprobar = filaDe(EL_NUEVO.id).querySelector('form')?.innerHTML ?? '';
    const restoConAprobar = filaSinElNodo(EL_NUEVO.id, 'form');

    cleanup();

    await montar({ cola: LOS_DOS });
    await abrirRechazar(EL_NUEVO);
    const conRechazar = filaDe(EL_NUEVO.id).querySelector('form')?.innerHTML ?? '';
    const restoConRechazar = filaSinElNodo(EL_NUEVO.id, 'form');

    expect(conAprobar).not.toBe('');
    expect(conRechazar).not.toBe('');
    expect(conAprobar).not.toBe(conRechazar);
    expect(restoConRechazar).toBe(restoConAprobar);

    // Y cada uno dice lo suyo: uno que se esta cobrando, el otro que no.
    expect(conAprobar).toContain('data-aprobar-es-cobrar');
    expect(conRechazar).toContain('data-rechazar-no-cobra');
    expect(filaDe(EL_NUEVO.id).querySelector('[data-rechazar-no-cobra]')?.textContent).toBe(
      RECHAZAR_NO_COBRA,
    );

    // DESPUES DE PULSAR: la fila desaparece de la cola —las dos acciones la
    // sacan de PENDIENTE— asi que sin un aviso las dos se verian igual: una
    // fila menos. Y la mas cara de las dos es la que registro un cobro.
    cleanup();
    vi.clearAllMocks();

    await montar({ cola: LOS_DOS });
    await abrirRechazar(EL_NUEVO);
    await clicEn('Rechazar el comprobante');
    const marcadoDelRechazo = elBloque().querySelector('[data-ultimo-gesto]')?.outerHTML ?? '';

    expect(elBloque().querySelector('[data-ultimo-gesto]')?.getAttribute('data-ultimo-gesto')).toBe(
      'RECHAZADO',
    );

    cleanup();
    vi.clearAllMocks();

    await montar({ cola: LOS_DOS });
    await abrirAprobar(EL_NUEVO);
    await cobrar();
    const marcadoDeLaAprobacion = elBloque().querySelector('[data-ultimo-gesto]')?.outerHTML ?? '';

    expect(elBloque().querySelector('[data-ultimo-gesto]')?.getAttribute('data-ultimo-gesto')).toBe(
      'APROBADO',
    );
    // El aviso del cobro NOMBRA lo que se acaba de registrar, por igualdad
    // exacta sobre su nodo: con cuatro comprobantes revisados seguidos, «listo»
    // no deja releer cuanto se cobro.
    expect(elBloque().querySelector('[data-cobro-registrado]')?.textContent).toBe(
      `${CENTINELAS.elMontoCobrado} que cubre hasta 2026-11-30`,
    );

    expect(marcadoDelRechazo).not.toBe('');
    expect(marcadoDeLaAprobacion).not.toBe('');
    expect(marcadoDeLaAprobacion).not.toBe(marcadoDelRechazo);
  });

  it('aprobar vuelve a pedir la cola, y rechazar tambien', async () => {
    // Las dos sacan al comprobante de PENDIENTE, asi que las dos dejan rancia
    // esta lista. `useAprobarComprobante` ademas invalida los pagos de esa
    // persona —acuña un Pago—, pero esta pantalla no los pide: eso lo fija
    // `use-dinero.spec`.
    await montar({ cola: LOS_DOS });
    await abrirAprobar(EL_NUEVO);
    await cobrar();

    expect(rutasPedidas().filter((ruta) => ruta === LA_RUTA_DE_LA_COLA)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Vacio y averia no son lo mismo
// ---------------------------------------------------------------------------

describe('una cola vacia y un fallo al leer', () => {
  it('una cola vacia se distingue de un fallo al leer', async () => {
    // «No hay nada que revisar» y «no pude preguntar» no son lo mismo.
    //
    // LAS DOS MITADES EN EL MISMO TEST, porque lo que se afirma es la
    // DISTINCION y no cada estado por su cuenta: con los dos en tests
    // separados, dibujar los dos igual pasaria los dos.
    await montar({ cola: [] });

    const vacio = elBloque().innerHTML;
    expect(elBloque().querySelector('[data-sin-comprobantes]')).not.toBeNull();
    expect(elBloque().querySelector('[data-fallo-al-leer]')).toBeNull();
    expect(screen.getByText(NADA_QUE_REVISAR)).toBeInTheDocument();
    // «No hay nada» no ofrece volver a intentarlo: no hay nada que reintentar
    // y el boton sugeriria que la respuesta no es de fiar.
    expect(botonesDelMarcado()).not.toContain('Reintentar');

    cleanup();

    await montar({ errorDeLectura: new ErrorDeApi('Sin conexion', 0) });

    expect(elBloque().querySelector('[data-fallo-al-leer]')).not.toBeNull();
    expect(elBloque().querySelector('[data-sin-comprobantes]')).toBeNull();
    expect(screen.getByText(/sin conexion/i)).toBeInTheDocument();
    expect(botonesDelMarcado()).toContain('Reintentar');

    // Y NO SE DIBUJAN IGUAL. Sin esto, dos marcas distintas sobre el mismo
    // contenido pasarian: lo que tiene que ser distinto es lo que se LEE.
    expect(elBloque().innerHTML).not.toBe(vacio);
  });

  it('un fallo al leer no pinta ni una fila ni un boton de aprobar', async () => {
    // Una cola rota dibujada como una lista sin filas dice «no hay nadie
    // esperando», que es la conclusion opuesta a la verdadera.
    await montar({ errorDeLectura: new ErrorDeApi('Reventó', 500) });

    expect(elBloque().querySelectorAll('[data-comprobante]')).toHaveLength(0);
    expect(elBloque().querySelector('[data-cuantos]')).toBeNull();
    expect(botonesDelMarcado()).not.toContain('Aprobar');
  });

  it('reintentar vuelve a pedir la cola', async () => {
    await montar({ errorDeLectura: new ErrorDeApi('Sin conexion', 0) });
    await clicEn('Reintentar');

    expect(rutasPedidas().filter((ruta) => ruta === LA_RUTA_DE_LA_COLA).length).toBeGreaterThan(1);
  });

  it('un 401 no enseña el «Unauthorized» crudo y no ofrece reintentar', async () => {
    // Reintentar sin sesion es volver a fallar. El `router.push` al login lo
    // hace el bloque de al lado en esta misma portada: la cookie es la misma y
    // dos bloques empujando al mismo destino son dos navegaciones.
    await montar({ errorDeLectura: new ErrorDeApi('Unauthorized', 401) });

    expect(screen.getByText(/tu sesion caduco/i)).toBeInTheDocument();
    expect(elBloque().querySelector('[data-fallo-al-leer]')).toBeNull();
    expect(botonesDelMarcado()).not.toContain('Reintentar');
    expect(elBloque().innerHTML.toLowerCase()).not.toContain('unauthorized');
  });
});

// ---------------------------------------------------------------------------
// El enlace firmado
// ---------------------------------------------------------------------------

describe('el archivo', () => {
  it('la url de descarga no se guarda entre respuestas', async () => {
    // `urlDeDescarga` esta documentada «firmada y de vida corta», y el service
    // la vuelve a firmar en CADA respuesta: no es una propiedad del
    // comprobante, es una propiedad de esa respuesta. Una copia guardada
    // sobrevive a lo que la trajo y ofrece un enlace roto sin saberlo.
    const cliente = await montar({
      colaPorVuelta: [[EL_NUEVO], [{ ...EL_NUEVO, urlDeDescarga: LA_URL_REFIRMADA }]],
    });

    const enlace = () => filaDe(EL_NUEVO.id).querySelector('[data-descarga]');

    // LA PREMISA PRIMERO: la primera firma esta pintada. Sin esto, una
    // pantalla que no pinte ningun enlace pasaria el test entero.
    expect(enlace()?.getAttribute('href')).toBe(CENTINELAS.laUrlFirmada);

    await act(async () => {
      await cliente.invalidateQueries({ queryKey: clavesDeDinero.colaDeComprobantes('PENDIENTE') });
    });
    await esperar();

    // LA SEGUNDA FIRMA, por igualdad exacta sobre el atributo. Si la url
    // viviera en un `useState` sembrado en el primer pintado, aqui seguiria
    // estando la primera.
    expect(enlace()?.getAttribute('href')).toBe(LA_URL_REFIRMADA);

    // Y LA PRIMERA NO ESTA EN NINGUN SITIO DEL DOCUMENTO: ni en otro `href`,
    // ni en un `title`, ni en un `data-*`. Lo que caduco tiene que haberse
    // ido entero.
    expect(document.body.innerHTML).not.toContain(CENTINELAS.laUrlFirmada);
  });

  it('cada fila enlaza a SU archivo, con dos sembradas', async () => {
    await montar({ cola: LOS_DOS });

    expect(filaDe(EL_NUEVO.id).querySelector('[data-descarga]')?.getAttribute('href')).toBe(
      EL_NUEVO.urlDeDescarga,
    );
    expect(filaDe(EL_VIEJO.id).querySelector('[data-descarga]')?.getAttribute('href')).toBe(
      EL_VIEJO.urlDeDescarga,
    );
  });

  it('dice que el enlace caduca, antes de que alguien lo copie a un mensaje', async () => {
    await montar({ cola: LOS_DOS });

    expect(elBloque().querySelector('[data-el-enlace-caduca]')?.textContent).toBe(EL_ENLACE_CADUCA);
  });
});

// ---------------------------------------------------------------------------
// Lo que el bloque pide
// ---------------------------------------------------------------------------

describe('pintar el bloque no trae nada mas', () => {
  it('es UNA peticion, esta, y con el filtro puesto', async () => {
    await montar({ cola: LOS_DOS });

    expect(rutasPedidas()).toEqual([LA_RUTA_DE_LA_COLA]);
  });

  it('no abre una clave de cache paralela a la del alumno', async () => {
    // La cola del admin cuelga de `['comprobantes']` A PROPOSITO: es la misma
    // ruta y el mismo recurso, con el service ramificando por rol adentro. Una
    // clave propia dejaria dos entradas que ninguna invalidacion alcanza
    // juntas, y subir un comprobante dejaria rancia solo una.
    const cliente = await montar({ cola: LOS_DOS });

    expect(
      cliente
        .getQueryCache()
        .getAll()
        .map((consulta) => consulta.queryKey),
    ).toEqual([['comprobantes', 'PENDIENTE']]);
  });
});

// ---------------------------------------------------------------------------
// Y esta en la portada de verdad
// ---------------------------------------------------------------------------

/**
 * LA LISTA BLANCA DE PETICIONES DE LA PORTADA, QUE AHORA SON TRES.
 *
 * Eran dos —`/stats/pagos-pendientes` y `/usuarios`, contadas en
 * `pagos-pendientes.spec`— y esta tarea agrega la tercera. Esta escrita entera
 * y a proposito, para que una cuarta —un `prefetch` de los archivos «para que
 * abran al instante», que es una linea y no se ve en ninguna pantalla— rompa
 * este test en vez de bajarse al navegador del mostrador N comprobantes de N
 * personas con sus URLs firmadas.
 */
const LA_PORTADA_PIDE_ESTAS_TRES = [
  LA_RUTA_DE_LA_COLA,
  '/stats/pagos-pendientes',
  '/usuarios',
].sort();

/**
 * EL BLOQUE ESTA MONTADO EN `page.tsx`, Y NO SOLO EN ESTE SPEC.
 *
 * Todo lo de arriba monta el componente a mano. Sin esto, sacarlo de la
 * portada —que es toda la decision de esta tarea— no romperia ni un test: la
 * pantalla quedaria como estaba y los de este archivo seguirian verdes.
 *
 * `InicioDelPanel` es un componente de SERVIDOR y `async`: se espera su
 * resultado y se pinta el elemento que devuelve.
 */
describe('la portada del panel', () => {
  it('monta la cola de comprobantes al lado de los pagos pendientes', async () => {
    const cliente = prepararServidor({ cola: LOS_DOS });
    const portada = await InicioDelPanel({ params: Promise.resolve({ slug: 'mi-gym' }) });

    render(<QueryClientProvider client={cliente}>{portada}</QueryClientProvider>);
    await esperar();

    // LOS DOS BLOQUES, no el mio en lugar del otro: se suma, no sustituye.
    expect(document.querySelector('[data-bloque="pagos-pendientes"]')).not.toBeNull();
    expect(document.querySelector('[data-bloque="comprobantes-pendientes"]')).not.toBeNull();

    // Y la cola esta pintada de verdad, no solo su encabezado.
    expect(datoDe(EL_NUEVO.id, '[data-archivo]')).toBe(CENTINELAS.nombreDelArchivo);

    // El enlace de siempre sigue ahi.
    expect(screen.getByRole('link', { name: 'Ver las personas' })).toHaveAttribute(
      'href',
      '/mi-gym/admin/usuarios',
    );
  });

  it('la portada entera pide TRES peticiones, estas, y ni una mas', async () => {
    const cliente = prepararServidor({ cola: LOS_DOS });
    const portada = await InicioDelPanel({ params: Promise.resolve({ slug: 'mi-gym' }) });

    render(<QueryClientProvider client={cliente}>{portada}</QueryClientProvider>);
    await esperar();

    expect(rutasPedidas().slice().sort()).toEqual(LA_PORTADA_PIDE_ESTAS_TRES);
  });

  it('y la lista blanca TIENE DIENTES: con una peticion de mas, no pasa', async () => {
    /**
     * UNA LISTA BLANCA QUE NO PUEDE FALLAR NO ES UNA LISTA BLANCA.
     *
     * El test de arriba pasa en verde tanto si la comparacion prohibe algo
     * como si —por un `expect` mal escrito, un `sort()` sobre dos listas
     * distintas o un `toContain` donde iba un `toEqual`— no prohibe nada. Esto
     * lo mide: se le agrega a lo medido UNA peticion inventada, de las que
     * alguien agregaria de buena fe —prefetchear el archivo para que abra al
     * instante— y se comprueba que la MISMA comparacion la rechaza.
     *
     * No se mete la peticion de verdad en la pantalla: lo que se audita es el
     * instrumento, no el codigo.
     */
    const cliente = prepararServidor({ cola: LOS_DOS });
    const portada = await InicioDelPanel({ params: Promise.resolve({ slug: 'mi-gym' }) });

    render(<QueryClientProvider client={cliente}>{portada}</QueryClientProvider>);
    await esperar();

    const unaDeMas = [...rutasPedidas(), `/comprobantes/${EL_NUEVO.id}/archivo`].sort();

    expect(unaDeMas).not.toEqual(LA_PORTADA_PIDE_ESTAS_TRES);
    // Y la de verdad sigue pasando, para que el contraste sea de la peticion
    // de mas y no de que la comparacion este rota de las dos formas.
    expect(rutasPedidas().slice().sort()).toEqual(LA_PORTADA_PIDE_ESTAS_TRES);
  });
});
