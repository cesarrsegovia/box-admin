import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PagoPendiente, UsuarioResumen } from '@boxadmin/shared';
import { ErrorDeApi } from '@/lib/cliente';
import { rutaDeRetornoSegura } from '@/lib/ruta-de-retorno';
import { clavesDeStats } from '@/hooks/use-stats';
import { clavesDeUsuarios } from '@/hooks/use-usuarios';
import { vigilarEstosDatos } from '@/test/espia-de-consola';
import InicioDelPanel from './page';
import {
  ES_UN_ESTIMADO,
  NADIE_PENDIENTE,
  PACK_QUE_YA_NO_ESTA,
  PagosPendientes,
  SE_MIRA_HOY,
  UN_CERO_NO_ES_ESTAR_AL_DIA,
} from './pagos-pendientes';

// ---------------------------------------------------------------------------
// Andamiaje
// ---------------------------------------------------------------------------

const RUTA = '/mi-gym/admin';

const { empujar, pedirEspia } = vi.hoisted(() => ({
  empujar: vi.fn(),
  pedirEspia: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: empujar, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({ slug: 'mi-gym' }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => RUTA,
}));

/**
 * Se dobla `pedir`, no `fetch`.
 *
 * Que `pedir` arme bien la URL ya lo fija `use-stats.spec`. Lo que se audita
 * aqui es un escalon mas arriba: QUE pide esta pantalla y que hace con lo que
 * vuelve. `ErrorDeApi` se deja REAL porque el bloque ramifica con `instanceof`.
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

/**
 * TRES PERSONAS, Y CADA UNA ESTA POR UN MOTIVO. DOS COMO MINIMO, POR REGLA.
 *
 * Con UNA sola fila sembrada, «cada fila lleva a la ficha de ESA persona» y
 * «todas las filas llevan a la primera» son la MISMA afirmacion, y el test no
 * puede fallar. Es la tercera forma de que un test no pueda fallar: montado en
 * el caso ciego.
 *
 * EL CAMPO DERIVADO VA DESALINEADO. `Importe` trae `centavos` —la verdad,
 * entero— y `texto` —la grafia, derivada de el—. Con un fijo coherente
 * (`{ centavos: 9999, texto: '99.99' }`) ningun test podria decir de cual de
 * los dos sale cada numero de la pantalla: «no pasa por un float» pasaria en
 * verde con una suma hecha con `Number(texto)`. Sembrando un `texto` que NO
 * corresponde a sus `centavos`, los dos caminos dan resultados distintos y el
 * test sirve. Es la quinta forma de que un test no pueda fallar —que el fijo
 * hable el idioma del codigo y no el del contrato— y va por el lado de la
 * ENTRADA, que es lo que vuelve decorativa cualquier asercion de encima.
 *
 * PERO EL FIJO SIGUE SIENDO POSIBLE EN TODO LO DEMAS, que es la otra mitad de
 * la regla; la T1 sembro un recorte que la API nunca puede contestar y pasaban
 * sus treinta tests. Lo que el service SI garantiza se respeta, y se verifico
 * leyendolo:
 *
 * - `packNombre: null` VIENE SIEMPRE CON `pendienteEstimado.centavos === 0`.
 *   `packsPorId()` lee la tabla entera, asi que un nombre nulo significa que
 *   ese `packId` ya no esta; y entonces `perfilesConPack()` tampoco le
 *   encuentra precio, y `pendientesDe` pone cero. Desalinear a Bruno seria
 *   sembrar una respuesta imposible. Es el unico de los tres donde no se puede
 *   desalinear nada, y no es una excepcion a la regla.
 * - NADIE VIENE SIN PACK CONTRATADO. `perfilesConPack()` filtra
 *   `packId: { not: null }` ademas de `rol: 'ALUMNO'` y `activo: true`: quien
 *   no tiene plan NO aparece en este reporte, por mucho que no pague.
 * - Y VIENEN ORDENADOS POR NOMBRE, que es lo que hace `porNombre` en el
 *   service antes de devolver.
 */

/** 1234567 centavos NO son 99.99. El texto es lo que se pinta; la suma, no. */
const ANA: PagoPendiente = {
  perfilId: 'p-de-ana',
  nombreCompleto: 'Ana Gutierrez',
  email: 'ana@gym.test',
  packNombre: 'Pase libre',
  pendienteEstimado: { centavos: 1_234_567, texto: '99.99' },
  cancelacionesDelMes: 3,
};

/** El pack borrado: `packNombre` nulo, y por eso mismo un estimado en cero. */
const BRUNO: PagoPendiente = {
  perfilId: 'p-de-bruno',
  nombreCompleto: 'Bruno Diaz',
  email: 'bruno@gym.test',
  packNombre: null,
  pendienteEstimado: { centavos: 0, texto: '0.00' },
  cancelacionesDelMes: 0,
};

/**
 * UN PACK DE VERDAD QUE SE LLAMA «Sin pack», que nada impide.
 *
 * Es el caso que la T3 encontro en la composicion, donde el service colapsa
 * tres situaciones bajo ese mismo nombre. Aqui sirve para fijar que esta
 * pantalla NO decide por el texto: Carla tiene un plan contratado y vigente, y
 * tiene que distinguirse de Bruno, cuyo pack ya no existe.
 */
const CARLA: PagoPendiente = {
  perfilId: 'p-de-carla',
  nombreCompleto: 'Carla Lopez',
  email: 'carla@gym.test',
  packNombre: 'Sin pack',
  pendienteEstimado: { centavos: 50_000, texto: '12.34' },
  cancelacionesDelMes: 1,
};

const LOS_TRES: PagoPendiente[] = [ANA, BRUNO, CARLA];

/**
 * EL TOTAL, ESCRITO A MANO Y NO DERIVADO.
 *
 * `1234567 + 0 + 50000 = 1284567` centavos, que son `12845.67`. Calcularlo
 * aqui con `textoDeCentavos` —la misma funcion que lo pinta— seria
 * autorreferencial: la primera forma de que un test no pueda fallar.
 *
 * Y por el otro camino, el malo: `Number('99.99') + Number('0.00') +
 * Number('12.34')` da `112.33`. Los dos numeros no se parecen, que es
 * exactamente para lo que se desalinearon los fijos.
 */
const TOTAL_EN_CENTAVOS = '12845.67';
const TOTAL_SI_PASARA_POR_FLOAT = '112.33';

/**
 * EL DIRECTORIO, Y LOS IDS NO SON LOS DEL REPORTE.
 *
 * `PagoPendiente` trae `perfilId` y la ficha se abre con el id de USUARIO, que
 * es otro campo. Sembrarlos distintos es lo unico que distingue un enlace
 * correcto de uno que use el `perfilId` tal cual: con `id === perfilId` las
 * dos implementaciones darian la misma URL.
 */
function unaPersona(id: string, perfilId: string, nombreCompleto: string): UsuarioResumen {
  return {
    id,
    tenantId: 't-del-gimnasio',
    nombreCompleto,
    email: `${id}@gym.test`,
    rol: 'ALUMNO',
    activo: true,
    perfilId,
    telefono: null,
    packId: null,
    pagoAlDia: false,
    salaIds: [],
  };
}

const DIRECTORIO: UsuarioResumen[] = [
  unaPersona('u-de-ana', ANA.perfilId, ANA.nombreCompleto),
  unaPersona('u-de-bruno', BRUNO.perfilId, BRUNO.nombreCompleto),
  unaPersona('u-de-carla', CARLA.perfilId, CARLA.nombreCompleto),
];

/**
 * TODO LO QUE ESTA PANTALLA SIEMBRA, REGISTRADO PARA LOS NUEVE CANALES.
 *
 * Es la pantalla de quien no pago: nombres, correos e importes de gente que
 * debe. Lo que no este aqui puede salirse por la consola, el titulo, el
 * `<head>`, los tres almacenes, el buffer de User Timing, el `src` de una
 * imagen, las tres salidas laterales o el almacen de respuestas, y ningun test
 * de marcado se enteraria.
 */
vigilarEstosDatos({
  elNombreDeUnaMorosa: ANA.nombreCompleto,
  elNombreDelDelPackBorrado: BRUNO.nombreCompleto,
  elNombreDeLaTercera: CARLA.nombreCompleto,
  elCorreoDeUnaMorosa: ANA.email,
  elCorreoDelDelPackBorrado: BRUNO.email,
  elCorreoDeLaTercera: CARLA.email,
  elPerfilDeUnaMorosa: ANA.perfilId,
  elUsuarioDeUnaMorosa: 'u-de-ana',
  elImporteQueSePinta: ANA.pendienteEstimado.texto,
  elImporteDeVerdad: String(ANA.pendienteEstimado.centavos),
  elTotalDeLoPendiente: TOTAL_EN_CENTAVOS,
  elPackDeUnaMorosa: 'Pase libre',
  elVolcadoDeUnaMorosa: '"nombreCompleto":"Ana Gutierrez"',
  elVolcadoDeSuImporte: '"centavos":1234567,"texto":"99.99"',
});

// ---------------------------------------------------------------------------
// Montaje
// ---------------------------------------------------------------------------

interface Escenario {
  pendientes?: PagoPendiente[];
  errorDePendientes?: unknown;
  personas?: UsuarioResumen[];
  errorDePersonas?: unknown;
}

function clienteCon({
  pendientes,
  errorDePendientes,
  personas,
  errorDePersonas,
}: Escenario): QueryClient {
  pedirEspia.mockImplementation((ruta: string) => {
    if (ruta === '/stats/pagos-pendientes') {
      return errorDePendientes === undefined
        ? Promise.resolve(pendientes ?? [])
        : Promise.reject(errorDePendientes);
    }

    if (ruta === '/usuarios') {
      return errorDePersonas === undefined
        ? Promise.resolve(personas ?? [])
        : Promise.reject(errorDePersonas);
    }

    return Promise.reject(new Error(`Ruta no prevista por el spec: ${ruta}`));
  });

  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  /**
   * SE SIEMBRA LA CACHE PARA QUE EL PRIMER PINTADO YA TENGA EL DATO.
   *
   * Y con la MISMA funcion de claves que usa el codigo —`clavesDeStats` y
   * `clavesDeUsuarios`—, no con una copia: si el spec reimplementara la clave,
   * un hook que pidiera bajo otra encontraria igual su dato sembrado y el test
   * no se enteraria.
   *
   * Sembrar NO apaga la peticion: la consulta nace rancia y se pide igual, que
   * es lo que mira la lista blanca de peticiones.
   */
  if (pendientes !== undefined) {
    cliente.setQueryData(clavesDeStats.pagosPendientes(), pendientes);
  }
  if (personas !== undefined) {
    cliente.setQueryData(clavesDeUsuarios.lista({}), personas);
  }

  return cliente;
}

function montar(escenario: Escenario = {}): QueryClient {
  const cliente = clienteCon(escenario);

  render(
    <QueryClientProvider client={cliente}>
      <PagosPendientes />
    </QueryClientProvider>,
  );

  return cliente;
}

/** Deja que las dos consultas se resuelvan (o se rompan) y que React pinte. */
async function esperar(): Promise<void> {
  await act(async () => {
    for (let vuelta = 0; vuelta < 5; vuelta += 1) {
      await new Promise((resolver) => setTimeout(resolver, 0));
    }
  });
}

// ---------------------------------------------------------------------------
// Ayudantes de lectura
// ---------------------------------------------------------------------------

/**
 * Las rutas pedidas, SIN DEDUPLICAR.
 *
 * Lo que esta lista blanca cuida es la CUENTA: una lectura de mas no cambia un
 * nodo ni manda un cuerpo, solo se ve contando, y un `Set` la esconderia.
 */
function rutasPedidas(): string[] {
  return pedirEspia.mock.calls.map(([ruta]) => ruta as string);
}

function elBloque(): HTMLElement {
  const nodo = document.querySelector('[data-bloque="pagos-pendientes"]');
  if (nodo === null) throw new Error('No hay bloque de pagos pendientes');

  return nodo as HTMLElement;
}

/** La fila de alguien, buscada por su `perfilId` y nunca por su nombre ni su posicion. */
function filaDe(perfilId: string): HTMLElement {
  const celda = elBloque().querySelector(`[data-persona="${perfilId}"]`);
  if (celda === null) throw new Error(`No hay fila para ${perfilId}`);

  const fila = celda.closest('tr');
  if (fila === null) throw new Error(`La celda de ${perfilId} no esta en una fila`);

  return fila as HTMLElement;
}

/** El valor exacto de un enganche dentro de una fila. `null` si no esta. */
function enLaFila(perfilId: string, selector: string): string | null {
  const nodo = filaDe(perfilId).querySelector(selector);
  return nodo === null ? null : (nodo.textContent?.trim() ?? '');
}

function columnasDelDocumento(): string[] {
  return [...elBloque().querySelectorAll('th')].map((th) => th.textContent?.trim() ?? '');
}

/**
 * Los botones QUE HAY EN EL MARCADO, sin pasar por el arbol de accesibilidad.
 *
 * `queryByRole('button')` excluye por su cuenta lo que lleva `hidden`,
 * `aria-hidden` o `display:none`: con el se puede afirmar que algo no SE VE,
 * no que no ESTA.
 */
function botonesDelDocumento(): string[] {
  return [...document.querySelectorAll('button')].map((boton) => boton.textContent?.trim() ?? '');
}

// ---------------------------------------------------------------------------
// La palabra que no se usa
// ---------------------------------------------------------------------------

/**
 * SE BUSCA «deud» Y NO «deuda», Y SOBRE EL MARCADO EN MINUSCULAS.
 *
 * Una subcadena mas corta es aqui MAS estricta, no menos: la prohibicion es
 * sobre la raiz, asi que de un golpe caen «deuda», «deudas», «Deuda», «DEUDA»,
 * «adeuda», «adeudado» y «deudor». Escribir `not.toContain('deuda')` dejaria
 * pasar «Deuda» por la mayuscula; y escribirlo sobre el texto visible en vez
 * de sobre el HTML dejaria pasar un `title=""`, un `aria-label` o un
 * `data-*`, que viajan al navegador igual.
 *
 * Es el otro lado de la casualidad ortografica que ya mordio dos veces en esta
 * fase: alli el peligro era que `not.toContain('0%')` pasara en verde sobre un
 * «100%» —una prohibicion demasiado ancha que no prohibe lo que cree—; aqui la
 * prohibicion ancha es la correcta, porque lo que no puede aparecer es la
 * palabra en cualquiera de sus formas.
 */
const LA_PALABRA_PROHIBIDA = 'deud';

function elMarcadoEnMinusculas(): string {
  return document.body.innerHTML.toLowerCase();
}

describe('nunca lo llama asi', () => {
  it('NO lo llama «deuda» en ningun sitio', async () => {
    montar({ pendientes: LOS_TRES, personas: DIRECTORIO });
    await esperar();

    // LA PREMISA PRIMERO. Sin esto, una pantalla que no pinte nada —o que se
    // quede en «Cargando…»— pasaria el test entero: es la segunda forma de que
    // un test no pueda fallar, el codigo bajo prueba borrando el borde que el
    // test venia a ejercitar.
    expect(enLaFila(ANA.perfilId, '[data-importe]')).toBe('99.99');
    expect(screen.getByText('Pendiente estimado')).toBeInTheDocument();

    expect(elMarcadoEnMinusculas()).not.toContain(LA_PALABRA_PROHIBIDA);
  });

  it('tampoco cuando la lista viene vacia', async () => {
    montar({ pendientes: [], personas: DIRECTORIO });
    await esperar();

    expect(document.querySelector('[data-sin-pendientes]')).not.toBeNull();
    expect(elMarcadoEnMinusculas()).not.toContain(LA_PALABRA_PROHIBIDA);
  });

  it('tampoco cuando el reporte falla', async () => {
    montar({ errorDePendientes: new ErrorDeApi('Sin conexion', 0), personas: DIRECTORIO });
    await esperar();

    expect(document.querySelector('[data-fallo-al-leer]')).not.toBeNull();
    expect(elMarcadoEnMinusculas()).not.toContain(LA_PALABRA_PROHIBIDA);
  });

  it('dice que es un estimado y de donde sale', async () => {
    montar({ pendientes: LOS_TRES, personas: DIRECTORIO });
    await esperar();

    // IGUALDAD EXACTA contra la constante, no una subcadena: una frase
    // recortada a la mitad —justo la mitad que explica de donde sale el
    // numero— pasaria cualquier `toContain`.
    expect(document.querySelector('[data-es-un-estimado]')?.textContent).toBe(ES_UN_ESTIMADO);

    // Y LAS DOS MITADES DE LA FRASE, nombradas. Que sea un estimado sin decir
    // de donde sale no sirve de nada por telefono.
    expect(ES_UN_ESTIMADO).toContain('ESTIMADO');
    expect(ES_UN_ESTIMADO).toContain('precio de lista del pack');
    expect(ES_UN_ESTIMADO).toContain('no lleva cuenta corriente');
  });

  it('dice que se evalua hoy, que es lo que lo separa del pendiente de la caja', async () => {
    montar({ pendientes: LOS_TRES, personas: DIRECTORIO });
    await esperar();

    expect(document.querySelector('[data-se-mira-hoy]')?.textContent).toBe(SE_MIRA_HOY);
  });

  it('las dos frases estan tambien mientras carga y tambien si falla', async () => {
    // La frase que explica un numero no puede depender de que el numero haya
    // llegado: quien entra y ve «Cargando…» tiene que poder leer que es esto.
    montar({ errorDePendientes: new ErrorDeApi('Reventó', 500) });
    await esperar();

    expect(document.querySelector('[data-es-un-estimado]')?.textContent).toBe(ES_UN_ESTIMADO);
    expect(document.querySelector('[data-se-mira-hoy]')?.textContent).toBe(SE_MIRA_HOY);
  });
});

// ---------------------------------------------------------------------------
// Lo que se pinta
// ---------------------------------------------------------------------------

describe('la lista', () => {
  it('muestra ESTAS columnas y solo estas', async () => {
    montar({ pendientes: LOS_TRES, personas: DIRECTORIO });
    await esperar();

    // LISTA BLANCA: el conjunto ENTERO. Una columna de mas —el error que
    // ningun test de presencia ve— rompe esto.
    expect(columnasDelDocumento()).toEqual([
      'Persona',
      'Email',
      'Pack',
      'Pendiente estimado',
      'Cancelaciones del mes',
    ]);
  });

  it('cada fila lleva SUS datos, y los del reporte', async () => {
    montar({ pendientes: LOS_TRES, personas: DIRECTORIO });
    await esperar();

    expect(enLaFila(ANA.perfilId, '[data-email]')).toBe('ana@gym.test');
    expect(enLaFila(ANA.perfilId, '[data-pack]')).toBe('Pase libre');
    expect(enLaFila(ANA.perfilId, '[data-importe]')).toBe('99.99');
    expect(enLaFila(ANA.perfilId, '[data-cancelaciones]')).toBe('3');

    expect(enLaFila(CARLA.perfilId, '[data-email]')).toBe('carla@gym.test');
    expect(enLaFila(CARLA.perfilId, '[data-importe]')).toBe('12.34');
    expect(enLaFila(CARLA.perfilId, '[data-cancelaciones]')).toBe('1');
  });

  it('cada fila lleva a la ficha de ESA persona, con dos sembradas', async () => {
    montar({ pendientes: LOS_TRES, personas: DIRECTORIO });
    await esperar();

    // POR FILA Y NO POR POSICION. Comparar la lista de `href` en orden tambien
    // cazaria «todas enlazan a la primera», pero no cazaria dos filas con los
    // destinos intercambiados. Lo que se afirma es que el enlace de la fila de
    // Ana lleva a Ana.
    expect(filaDe(ANA.perfilId).querySelector('[data-ficha]')?.getAttribute('href')).toBe(
      '/mi-gym/admin/usuarios/u-de-ana',
    );
    expect(filaDe(BRUNO.perfilId).querySelector('[data-ficha]')?.getAttribute('href')).toBe(
      '/mi-gym/admin/usuarios/u-de-bruno',
    );
    expect(filaDe(CARLA.perfilId).querySelector('[data-ficha]')?.getAttribute('href')).toBe(
      '/mi-gym/admin/usuarios/u-de-carla',
    );

    // Y EL DESTINO NO ES EL `perfilId`. El reporte trae el id del PERFIL y la
    // ficha se abre con el del USUARIO: son dos campos distintos, y usar el
    // primero da una URL que existe, contesta 404 y no se parece a un error de
    // programacion. Sin esta linea, sembrar `id === perfilId` haria
    // indistinguibles las dos implementaciones.
    const destinos = [...elBloque().querySelectorAll('[data-ficha]')].map((a) =>
      a.getAttribute('href'),
    );
    for (const perfilId of [ANA.perfilId, BRUNO.perfilId, CARLA.perfilId]) {
      expect(destinos).not.toContain(`/mi-gym/admin/usuarios/${perfilId}`);
    }
  });

  it('se pinta en el orden en que llega, que lo decide el servidor', async () => {
    // El service ordena con `porNombre` antes de devolver. Esta pantalla NO
    // ordena: una segunda opinion sobre el mismo orden es dos sitios que algun
    // dia discrepan y nadie sabe cual creer.
    montar({ pendientes: [CARLA, ANA, BRUNO], personas: DIRECTORIO });
    await esperar();

    const enPantalla = [...elBloque().querySelectorAll('[data-persona]')].map((nodo) =>
      nodo.getAttribute('data-persona'),
    );

    expect(enPantalla).toEqual([CARLA.perfilId, ANA.perfilId, BRUNO.perfilId]);
  });
});

// ---------------------------------------------------------------------------
// El pack, que aqui no colapsa tres casos — pero casi
// ---------------------------------------------------------------------------

describe('el pack de cada fila', () => {
  it('un alumno sin pack (packNombre null) no se pinta como sin nombre', async () => {
    montar({ pendientes: LOS_TRES, personas: DIRECTORIO });
    await esperar();

    // Ni vacio, ni un guion, ni «null»: se dice que paso.
    expect(enLaFila(BRUNO.perfilId, '[data-pack]')).toBe(PACK_QUE_YA_NO_ESTA);
    expect(enLaFila(BRUNO.perfilId, '[data-pack]')).not.toBe('');
    expect(elMarcadoEnMinusculas()).not.toContain('>null<');
  });

  it('un pack de VERDAD llamado «Sin pack» no se confunde con el que ya no existe', async () => {
    // La T3 encontro que en la composicion el NOMBRE colapsa tres casos. Aqui
    // no, porque el reporte solo lista a quien tiene pack contratado y el nulo
    // significa una sola cosa; esta pantalla se ramifica por `packNombre ===
    // null` y jamas por el texto. Se fija con un atributo propio y por
    // IGUALDAD EXACTA, no buscando subcadenas en el texto.
    montar({ pendientes: LOS_TRES, personas: DIRECTORIO });
    await esperar();

    expect(enLaFila(CARLA.perfilId, '[data-pack]')).toBe('Sin pack');
    expect(filaDe(CARLA.perfilId).querySelector('[data-pack-borrado]')).toBeNull();
    expect(
      filaDe(BRUNO.perfilId)
        .querySelector('[data-pack-borrado]')
        ?.getAttribute('data-pack-borrado'),
    ).toBe('si');
  });
});

// ---------------------------------------------------------------------------
// El dinero
// ---------------------------------------------------------------------------

describe('el importe', () => {
  it('el importe no pasa por un float', async () => {
    montar({ pendientes: LOS_TRES, personas: DIRECTORIO });
    await esperar();

    const total = elBloque().querySelector('[data-total-estimado]')?.textContent?.trim();

    // IGUALDAD EXACTA sobre el nodo del total: «112.33» no es subcadena de
    // «12845.67», pero «12845.67» SI contiene «845.67», y un `toContain`
    // pasaria en verde sobre un total equivocado.
    expect(total).toBe(TOTAL_EN_CENTAVOS);

    // Y LAS DOS MITADES. La igualdad de arriba ya cae si la suma pasa por
    // `Number(texto)`, pero esta linea dice en el informe POR QUE cayo, y fija
    // que el numero del camino malo no esta en ningun otro sitio de la
    // pantalla —ni en un `title`, ni en un `data-*`—.
    expect(elMarcadoEnMinusculas()).not.toContain(TOTAL_SI_PASARA_POR_FLOAT);
  });

  it('lo que se pinta en la fila es el `texto` del contrato, no los centavos', async () => {
    // La otra mitad de la regla: lo que se MUESTRA sale de `texto` —es el
    // campo hecho para eso— y lo que se CALCULA sale de `centavos`. Con el
    // fijo desalineado, dividir los centavos daria «12345.67» y no «99.99».
    montar({ pendientes: LOS_TRES, personas: DIRECTORIO });
    await esperar();

    expect(enLaFila(ANA.perfilId, '[data-importe]')).toBe('99.99');
    expect(enLaFila(ANA.perfilId, '[data-importe]')).not.toBe('12345.67');
  });

  it('un estimado en cero dice que no es «esta al dia»', async () => {
    montar({ pendientes: LOS_TRES, personas: DIRECTORIO });
    await esperar();

    expect(enLaFila(BRUNO.perfilId, '[data-cero-sin-estimar]')).toBe(UN_CERO_NO_ES_ESTAR_AL_DIA);

    // Y SOLO EN LA FILA QUE VALE CERO. Un aviso en todas las filas no informa
    // de nada y taparia la unica donde importa.
    expect(filaDe(ANA.perfilId).querySelector('[data-cero-sin-estimar]')).toBeNull();
    expect(filaDe(CARLA.perfilId).querySelector('[data-cero-sin-estimar]')).toBeNull();
  });

  it('sin filas no se pinta un total de cero, que seria una afirmacion', async () => {
    montar({ pendientes: [], personas: DIRECTORIO });
    await esperar();

    expect(elBloque().querySelector('[data-total-estimado]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Vacio y averia no son lo mismo
// ---------------------------------------------------------------------------

describe('una lista vacia y un fallo al leer', () => {
  it('una lista vacia se distingue de un fallo al leer', async () => {
    // LAS DOS MITADES EN EL MISMO TEST, porque lo que se afirma es la
    // DISTINCION y no cada estado por su cuenta. Con los dos en tests
    // separados, dibujar los dos igual pasaria los dos.
    montar({ pendientes: [], personas: DIRECTORIO });
    await esperar();

    const vacio = elBloque().innerHTML;
    expect(document.querySelector('[data-sin-pendientes]')).not.toBeNull();
    expect(document.querySelector('[data-fallo-al-leer]')).toBeNull();
    expect(screen.getByText(NADIE_PENDIENTE)).toBeInTheDocument();
    // «Nadie debe nada» no ofrece volver a intentarlo: no hay nada que
    // reintentar y el boton sugeriria que la respuesta no es de fiar.
    expect(botonesDelDocumento()).not.toContain('Reintentar');

    document.body.innerHTML = '';

    montar({ errorDePendientes: new ErrorDeApi('Sin conexion', 0), personas: DIRECTORIO });
    await esperar();

    expect(document.querySelector('[data-fallo-al-leer]')).not.toBeNull();
    expect(document.querySelector('[data-sin-pendientes]')).toBeNull();
    expect(screen.getByText(/sin conexion/i)).toBeInTheDocument();
    expect(botonesDelDocumento()).toContain('Reintentar');

    // Y NO SE DIBUJAN IGUAL. Sin esto, dos marcas distintas sobre el mismo
    // contenido pasarian: lo que tiene que ser distinto es lo que se LEE.
    expect(elBloque().innerHTML).not.toBe(vacio);
  });

  it('un fallo al leer no pinta ni una fila', async () => {
    // Un 500 dibujado como una tabla sin filas diria «no hay a quien llamar»,
    // que es la conclusion opuesta a la verdadera.
    montar({ errorDePendientes: new ErrorDeApi('Reventó', 500), personas: DIRECTORIO });
    await esperar();

    expect(elBloque().querySelectorAll('[data-persona]')).toHaveLength(0);
    expect(elBloque().querySelector('table')).toBeNull();
  });

  it('reintentar vuelve a pedir el reporte', async () => {
    montar({ errorDePendientes: new ErrorDeApi('Sin conexion', 0), personas: DIRECTORIO });
    await esperar();

    const usuario = userEvent.setup();
    await usuario.click(screen.getByRole('button', { name: 'Reintentar' }));
    await esperar();

    expect(
      rutasPedidas().filter((ruta) => ruta === '/stats/pagos-pendientes').length,
    ).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// El directorio es accesorio, y el reporte no
// ---------------------------------------------------------------------------

describe('cuando el directorio de personas no contesta', () => {
  it('las filas siguen ahi, con su nombre, y sin enlace', async () => {
    // Quien no pago sigue siendo quien no pago aunque no sepamos abrir su
    // ficha. Cambiar el reporte leido por una pantalla vacia a cuenta de un
    // dato accesorio es perder lo unico que la pantalla existe para enseñar.
    montar({ pendientes: LOS_TRES, errorDePersonas: new ErrorDeApi('Sin conexion', 0) });
    await esperar();

    expect(filaDe(ANA.perfilId).textContent).toContain(ANA.nombreCompleto);
    expect(elBloque().querySelectorAll('[data-ficha]')).toHaveLength(0);
    expect(document.querySelector('[data-fallo-al-leer]')).toBeNull();
  });

  it('a quien el directorio no conoce se le pinta el nombre, no un enlace roto', async () => {
    // Un `href` armado con un id que no es el de la ficha lleva a un 404, que
    // no se parece a un error de programacion y se reporta como «la ficha se
    // borro».
    montar({ pendientes: LOS_TRES, personas: [DIRECTORIO[0] as UsuarioResumen] });
    await esperar();

    expect(filaDe(ANA.perfilId).querySelector('[data-ficha]')).not.toBeNull();
    expect(filaDe(BRUNO.perfilId).querySelector('[data-ficha]')).toBeNull();
    expect(filaDe(BRUNO.perfilId).textContent).toContain(BRUNO.nombreCompleto);
  });
});

// ---------------------------------------------------------------------------
// La sesion
// ---------------------------------------------------------------------------

describe('cuando se cae la sesion', () => {
  it('un 401 manda al login de SU gimnasio, una sola vez', async () => {
    montar({ errorDePendientes: new ErrorDeApi('Sin sesion', 401) });
    await esperar();

    expect(empujar).toHaveBeenCalledTimes(1);

    const [destino] = empujar.mock.calls[0] as [string];
    expect(
      rutaDeRetornoSegura(
        new URL(destino, 'http://x').searchParams.get('volverA') ?? undefined,
        'mi-gym',
      ),
    ).toBe(RUTA);
  });

  it('un 401 NO ofrece reintentar: reintentar sin sesion es volver a fallar', async () => {
    montar({ errorDePendientes: new ErrorDeApi('Sin sesion', 401) });
    await esperar();

    expect(botonesDelDocumento()).not.toContain('Reintentar');
    expect(document.querySelector('[data-fallo-al-leer]')).toBeNull();
    expect(screen.getByText(/tu sesion caduco/i)).toBeInTheDocument();
    // Y no se enseña el «Unauthorized» crudo de la API, que no le dice nada a
    // nadie.
    expect(elMarcadoEnMinusculas()).not.toContain('sin sesion');
  });

  it('un error de red NO manda al login: la sesion no tiene la culpa', async () => {
    // Echar a alguien al login por un tunel sin cobertura le hace perder la
    // sesion de verdad, y al volver tiene que escribir la contraseña.
    montar({ errorDePendientes: new ErrorDeApi('Sin conexion', 0), personas: DIRECTORIO });
    await esperar();

    expect(empujar).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Lo que la pantalla pide, y lo que deja guardado
// ---------------------------------------------------------------------------

/**
 * LA LISTA BLANCA DE PETICIONES DE LA PORTADA, QUE ANTES NO PEDIA NADA.
 *
 * Son DOS y estan contadas a proposito. La segunda —`/usuarios`— es el precio
 * de poder enlazar a una ficha: `PagoPendiente` trae `perfilId` y la ficha se
 * abre con el id de USUARIO, asi que la correspondencia hay que ir a buscarla.
 * Esta aqui escrita para que una tercera peticion —un `prefetch` de las
 * fichas «para que abran instantaneas», que es una linea y no se ve en ninguna
 * pantalla— rompa este test en vez de traerse N fichas al navegador del
 * mostrador.
 *
 * Y NINGUNA LLEVA PARAMETROS. `/stats/pagos-pendientes` no acepta ni uno:
 * `ConsultaPagosPendientesDto` esta vacio para que el ValidationPipe conteste
 * 400 ante un `?salaId=` en vez de ignorarlo en silencio, asi que un filtro
 * «de cortesia» agregado desde este lado del cable seria un reporte que no
 * carga. Y `/usuarios` va sin filtros a proposito: el reporte puede nombrar a
 * cualquiera.
 */
describe('pintar la portada no trae nada mas', () => {
  it('son DOS peticiones, estas, y sin ningun parametro', async () => {
    montar({ pendientes: LOS_TRES, personas: DIRECTORIO });
    await esperar();

    expect(rutasPedidas().slice().sort()).toEqual(['/stats/pagos-pendientes', '/usuarios']);

    // Por separado, porque un `?salaId=` pegado a la ruta tambien rompe la
    // igualdad de arriba pero el informe no diria por que.
    for (const ruta of rutasPedidas()) expect(ruta).not.toContain('?');
  });

  it('en la cache no queda ni una ficha', async () => {
    const cliente = montar({ pendientes: LOS_TRES, personas: DIRECTORIO });
    await esperar();

    expect(
      cliente
        .getQueryCache()
        .getAll()
        .map((consulta) => consulta.queryKey),
    ).toEqual([
      ['stats', 'pagos-pendientes'],
      ['usuarios', {}],
    ]);
  });

  it('la consulta del directorio es LA MISMA que la del listado de personas sin filtros', async () => {
    // Si no lo fuera, entrar al panel y pinchar «Ver las personas» serian dos
    // peticiones identicas y dos entradas en la cache, y una invalidacion
    // dirigida alcanzaria a una sola.
    const cliente = montar({ pendientes: LOS_TRES, personas: DIRECTORIO });
    await esperar();

    expect(cliente.getQueryData(clavesDeUsuarios.lista({}))).toEqual(DIRECTORIO);
  });
});

// ---------------------------------------------------------------------------
// Y esta en la portada de verdad
// ---------------------------------------------------------------------------

/**
 * EL BLOQUE ESTA MONTADO EN `page.tsx`, Y NO SOLO EN ESTE SPEC.
 *
 * Todo lo de arriba monta el componente a mano. Sin esto, sacarlo de la
 * portada —que es toda la decision de esta tarea— no romperia ni un test: la
 * pantalla quedaria como estaba y los treinta de este archivo seguirian
 * verdes.
 *
 * `InicioDelPanel` es un componente de SERVIDOR y `async`: se espera su
 * resultado y se pinta el elemento que devuelve.
 */
describe('la portada del panel', () => {
  it('monta la lista de a quien hay que llamar', async () => {
    const cliente = clienteCon({ pendientes: LOS_TRES, personas: DIRECTORIO });
    const portada = await InicioDelPanel({ params: Promise.resolve({ slug: 'mi-gym' }) });

    render(<QueryClientProvider client={cliente}>{portada}</QueryClientProvider>);
    await esperar();

    expect(document.querySelector('[data-bloque="pagos-pendientes"]')).not.toBeNull();
    expect(enLaFila(ANA.perfilId, '[data-importe]')).toBe('99.99');
    // Y el enlace de siempre sigue ahi: el bloque se suma, no sustituye.
    expect(screen.getByRole('link', { name: 'Ver las personas' })).toHaveAttribute(
      'href',
      '/mi-gym/admin/usuarios',
    );
  });
});
