import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AlumnoEnClase, ClaseDelProfesor } from '@boxadmin/shared';
import { ErrorDeApi } from '@/lib/cliente';
import { clavesDeMisClases } from '@/hooks/use-mis-clases';
import { vigilarEstosDatos } from '@/test/espia-de-consola';
import PaginaDeMisClases from './page';
// Los ayudantes viven FUERA de `page.tsx`: Next 15 no deja exportar nada mas
// que el `default` desde una pagina. Ver el comentario de `filtros.ts`.
import { conteoDeLaLista, MAX_CLASES_CON_DETALLE, rangoDeLaBusqueda } from './filtros';

// ---------------------------------------------------------------------------
// Andamiaje
// ---------------------------------------------------------------------------

const RUTA = '/mi-gym/mis-clases';

const { empujar, pedirEspia, busqueda } = vi.hoisted(() => ({
  empujar: vi.fn(),
  pedirEspia: vi.fn(),
  // Mutable a proposito: `useSearchParams` se llama en cada render y tiene que
  // devolver lo que el test de turno puso, no lo que habia al cargar el modulo.
  // Es ademas lo que permite simular el boton de atras.
  busqueda: { valor: '' },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: empujar, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({ slug: 'mi-gym' }),
  useSearchParams: () => new URLSearchParams(busqueda.valor),
  usePathname: () => RUTA,
}));

/**
 * Se dobla `pedir`, no `fetch`.
 *
 * Que `pedir` arme bien la URL ya lo fija `use-mis-clases.spec`. Lo que se
 * audita aqui es un escalon mas arriba: QUE pide esta pantalla a partir de lo
 * que leyo de la URL, y que hace con lo que vuelve. `ErrorDeApi` se deja REAL
 * porque la pagina ramifica con `instanceof`.
 */
vi.mock('@/lib/cliente', async (original) => ({
  ...(await original<typeof import('@/lib/cliente')>()),
  pedir: pedirEspia,
}));

/**
 * EL RELOJ, CONGELADO Y SOLO EL RELOJ.
 *
 * El rango por defecto de esta pantalla es HOY, asi que sin congelarlo este
 * archivo cambiaria de significado cada madrugada.
 *
 * Se falsea `Date` y NADA MAS (`toFake: ['Date']`): los temporizadores siguen
 * siendo de verdad, que es lo que necesitan `userEvent` y `esperar()`. Y
 * `performance` se queda fuera por partida doble, porque falsearlo sustituye el
 * objeto entero por el de sinon y deja ciego a uno de los trece canales.
 *
 * EL RANGO DE LA URL NO TOCA A «HOY» NI POR UN DIA, y es a proposito: el de la
 * URL es el 3 de marzo y hoy es el 20 de octubre. Con un rango de la URL que
 * coincidiera con el de por defecto, «pide lo que dice la URL» y «pide hoy»
 * serian la misma afirmacion y la mitad de este archivo no podria fallar.
 */
const AHORA = new Date(Date.UTC(2026, 9, 20));

/** El rango que la mayoria de los tests pone en la URL. NO es el de hoy. */
const DESDE = '2026-03-03';
const HASTA = '2026-03-03';
const CONSULTA = `desde=${DESDE}&hasta=${HASTA}`;

/** Hoy, los dos extremos: a donde se cae sin rango en la URL. */
const HOY = '2026-10-20';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AHORA);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  busqueda.valor = '';
  // Los almacenes del navegador los deja como estaban —y ademas los AUDITA— el
  // tapon global de `vitest.setup.ts`. Limpiarlos aqui, en un `afterEach` que
  // corre ANTES que el suyo, lo dejaria mirando unos almacenes ya vacios.
});

// ---------------------------------------------------------------------------
// Lo que esta pantalla siembra, y por que se registra
// ---------------------------------------------------------------------------

/**
 * ESTA PANTALLA SIEMBRA NOMBRES DE PERSONAS Y QUIEN FALTO.
 *
 * No es un importe ni un id de turno: son nombres propios y el hecho de que esa
 * tarde no vinieron. La gente de la que hablan estos fijos no esta en la sala
 * para quejarse si acaba en el titulo de la pestaña del mostrador, en
 * `localStorage` de un telefono compartido o en el registro de CI, que lo
 * guarda mas tiempo y lo lee mas gente que la consola de la profesora.
 *
 * SE REGISTRA TAMBIEN EL `perfilId`, y no es de adorno: un `cuid` no se lee,
 * pero al lado de una lista de presentes **no estar es el dato**. El id del que
 * falto identifica a esa persona igual que su nombre en cuanto viaja junto a la
 * palabra «ausente».
 *
 * Y se registran las dos GRAFIAS: la pintada —el texto que acabaria en un
 * titulo— y el volcado del objeto, que es la forma que toma un
 * `console.log(alumnos)`.
 *
 * Va en el cuerpo del modulo y no en un `beforeEach`: cada archivo de test
 * corre aislado, asi que lo registrado vale para este y para ninguno mas.
 */
const CENTINELAS = {
  laQueVino: 'Sofia-Pereyra-Vino-Agenda',
  elQueFalto: 'Martin-Quiroga-Falto-Agenda',
  laQueNoSeSabe: 'Carla-Insua-SinMarcar-Agenda',
  elPerfilDelQueFalto: 'perfil-martin-que-falto-agenda',
  elPerfilDeLaQueNoSeSabe: 'perfil-carla-sin-marcar-agenda',
  elNombreDeLaClase: 'Funcional-Agenda-Marcador',
  elVolcadoDelQueFalto: '"asistio":false',
  elVolcadoDeLaQueNoSeSabe: '"asistio":null',
};

vigilarEstosDatos(CENTINELAS);

// ---------------------------------------------------------------------------
// Los fijos
// ---------------------------------------------------------------------------

/**
 * LOS DOS TURNOS, Y SON DOS PORQUE UNO NO DISTINGUE NADA.
 *
 * Con una sola clase, «cada clase lleva a SU pantalla» pasa en verde sobre una
 * pantalla que enlace siempre a la primera, y «una clase con todos marcados se
 * distingue de una con ninguno» no se puede ni escribir.
 */
const TURNO_A = 'turno-de-las-nueve';
const TURNO_B = 'turno-de-las-once';

/**
 * LA CLASE DE LAS NUEVE, CON `listaPasada: true` **POR UN QR Y NADA MAS**.
 *
 * Este fijo es el caso que la pantalla existe para no creerse, y es POSIBLE en
 * la API palabra por palabra: `listaPasada` sale de
 * `reservas.some(r => r.asistio !== null)`, y el check-in por QR escribe
 * `asistio: true` en `CheckinService.escribir`. O sea que **una sola** persona
 * que escanea al entrar deja este campo en `true` con la lista sin pasar.
 *
 * ⚠️ POR ESO VIENE CON `ALUMNOS_CON_UN_QR` Y NO CON UNA LISTA SIN MARCAR.
 * `listaPasada: true` sobre tres `asistio: null` es una respuesta que la API NO
 * PUEDE DAR —el `.some()` seria falso—, y un fijo imposible vuelve decorativa
 * cualquier afirmacion hecha encima. El fijo tiene que ser el caso real: UNO
 * marcado por el QR, los otros dos en `null`, y el booleano gritando «hecha».
 */
const CLASE_CON_QR: ClaseDelProfesor = {
  turnoId: TURNO_A,
  salaId: 'sala-1',
  salaNombre: 'Sala grande',
  nombre: CENTINELAS.elNombreDeLaClase,
  fecha: DESDE,
  horaInicio: '09:00',
  horaFin: '10:00',
  cupo: 12,
  reservasActivas: 3,
  listaPasada: true,
};

/**
 * LA MISMA CLASE, byte por byte, salvo el booleano. Es el control.
 *
 * Esta va con `ALUMNOS_SIN_MARCAR` —nadie tiene estado—, que es lo que hace
 * cierto su `listaPasada: false`. Los dos fijos son posibles y los dos tienen
 * numeros DISTINTOS, que es lo que obliga al test de la ausencia a comparar
 * «el texto salvo los numeros» en vez de dos cadenas identicas por
 * construccion.
 */
const CLASE_SIN_QR: ClaseDelProfesor = { ...CLASE_CON_QR, listaPasada: false };

const CLASE_B: ClaseDelProfesor = {
  turnoId: TURNO_B,
  salaId: 'sala-2',
  salaNombre: 'Sala chica',
  nombre: 'Movilidad',
  fecha: DESDE,
  horaInicio: '11:00',
  horaFin: '12:00',
  cupo: 8,
  reservasActivas: 2,
  listaPasada: false,
};

/** TRES ANOTADOS Y NINGUNO MARCADO. Lo que dice la agenda: «faltan 3 de 3». */
const ALUMNOS_SIN_MARCAR: AlumnoEnClase[] = [
  { perfilId: 'perfil-sofia', nombreCompleto: CENTINELAS.laQueVino, asistio: null },
  {
    perfilId: CENTINELAS.elPerfilDelQueFalto,
    nombreCompleto: CENTINELAS.elQueFalto,
    asistio: null,
  },
  {
    perfilId: CENTINELAS.elPerfilDeLaQueNoSeSabe,
    nombreCompleto: CENTINELAS.laQueNoSeSabe,
    asistio: null,
  },
];

/**
 * LA MISMA LISTA CON **UN** QR ENCIMA: «faltan 2 de 3».
 *
 * Es el fijo que acompaña a `CLASE_CON_QR`, y los tres numeros que produce son
 * los tres DISTINTOS —anotados 3, marcados 1, faltan 2—, que es justamente lo
 * que una lista sin marcar no puede dar: alli `faltan` y `anotados` valen los
 * dos 3, asi que un conteo que devolviera los anotados en vez de los que faltan
 * pasaria en verde. El caso ciego se cierra con el dato, no con una asercion
 * mas.
 */
const ALUMNOS_CON_UN_QR: AlumnoEnClase[] = [
  { perfilId: 'perfil-sofia', nombreCompleto: CENTINELAS.laQueVino, asistio: true },
  ...ALUMNOS_SIN_MARCAR.slice(1),
];

/**
 * DOS ANOTADOS Y LOS DOS MARCADOS, **UNO PRESENTE Y UNO AUSENTE**.
 *
 * El ausente no es decoracion: `conteoDeLaLista` cuenta `asistio !== null` y no
 * `=== true`, y con una lista de puros presentes las dos implementaciones dan
 * el mismo numero. Un alumno marcado AUSENTE **esta marcado**, y confundir «no
 * vino» con «no se sabe» es el error que el reporte de la Fase 11 vino a
 * explicar con palabras.
 *
 * Y SON DOS, NO TRES: `CLASE_B.reservasActivas` vale 2 y la lista tiene 2, pero
 * la clase de arriba tiene 3 anotados y 3 en la lista. Lo que importa es que
 * los numeros de las DOS clases son distintos entre si, asi que una pantalla
 * que pintara el `reservasActivas` de la primera clase en todas las tarjetas se
 * veria.
 */
const ALUMNOS_TODOS_MARCADOS: AlumnoEnClase[] = [
  { perfilId: 'perfil-dario', nombreCompleto: 'Dario Sosa', asistio: true },
  {
    perfilId: CENTINELAS.elPerfilDelQueFalto,
    nombreCompleto: CENTINELAS.elQueFalto,
    asistio: false,
  },
];

/** La agenda de siempre: las dos clases, en el orden en que las manda el service. */
const AGENDA: ClaseDelProfesor[] = [CLASE_CON_QR, CLASE_B];

/** Las listas de cada turno, por id: el doble responde por RUTA, no por orden. */
const LISTAS: Record<string, AlumnoEnClase[]> = {
  [TURNO_A]: ALUMNOS_CON_UN_QR,
  [TURNO_B]: ALUMNOS_TODOS_MARCADOS,
};

// ---------------------------------------------------------------------------
// Montaje
// ---------------------------------------------------------------------------

interface OpcionesDeMontaje {
  agenda?: ClaseDelProfesor[];
  listas?: Record<string, AlumnoEnClase[]>;
  /** Lo que falla al LEER la agenda. */
  error?: unknown;
  /** El query de la URL, sin `?`. */
  consulta?: string;
}

/**
 * El doble responde POR RUTA y no por orden de llamada: con
 * `mockResolvedValueOnce` encadenados, agregar una clase al fijo corre todas
 * las respuestas una posicion y los tests fallan en el sitio equivocado.
 */
function responder({ agenda = AGENDA, listas = LISTAS, error }: OpcionesDeMontaje): void {
  pedirEspia.mockImplementation((ruta: string) => {
    if (ruta.startsWith('/mis-clases?')) {
      return error === undefined ? Promise.resolve(agenda) : Promise.reject(error);
    }

    const alumnos = /^\/mis-clases\/([^/]+)\/alumnos$/.exec(ruta);
    if (alumnos !== null) {
      const lista = listas[alumnos[1] as string];
      if (lista === undefined) {
        return Promise.reject(new ErrorDeApi('Ese turno no es tuyo', 404));
      }
      return Promise.resolve(lista);
    }

    throw new Error(`La pantalla pidio una ruta que nadie espera: ${ruta}`);
  });
}

function montar(opciones: OpcionesDeMontaje = {}) {
  const { agenda = AGENDA, error, consulta = CONSULTA } = opciones;

  busqueda.valor = consulta;
  responder(opciones);

  /**
   * El rango de ESTE montaje, leido con la MISMA funcion que usa la pantalla.
   *
   * Sembrar la cache con un rango escrito a mano haria que una lectura
   * equivocada de la URL siguiera encontrando datos y pasara en verde.
   */
  const rango = rangoDeLaBusqueda(new URLSearchParams(consulta), AHORA);

  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  // Sembrado para que el primer pintado ya tenga la agenda. Sembrar NO apaga la
  // peticion: las listas de cada clase siguen saliendo de la red.
  if (error === undefined) cliente.setQueryData(clavesDeMisClases.agenda(rango), agenda);

  const resultado = render(
    <QueryClientProvider client={cliente}>
      <PaginaDeMisClases />
    </QueryClientProvider>,
  );

  return resultado;
}

/** Deja que las consultas se resuelvan (o se rompan) y que React pinte. */
async function esperar(): Promise<void> {
  await act(async () => {
    for (let vuelta = 0; vuelta < 6; vuelta += 1) {
      await new Promise((resolver) => setTimeout(resolver, 0));
    }
  });
}

/** Monta y espera: casi todos los tests necesitan las dos cosas. */
async function montarYEsperar(opciones: OpcionesDeMontaje = {}): Promise<void> {
  montar(opciones);
  await esperar();
}

/**
 * Las rutas pedidas, SIN DEDUPLICAR y ORDENADAS.
 *
 * Lo que esta lista blanca cuida es la CUENTA —una peticion de mas no cambia un
 * nodo, solo se ve contando— y un `Set` la esconderia. Se ordena porque el
 * orden entre las listas de dos clases lo decide TanStack y no esta pantalla:
 * afirmar sobre el seria afirmar sobre un detalle de la libreria.
 */
function rutasPedidas(): string[] {
  return pedirEspia.mock.calls.map(([ruta]) => ruta as string).sort();
}

/** El bloque de la agenda. Revienta si no esta. */
function elBloque(): HTMLElement {
  const nodo = document.querySelector('[data-bloque="agenda"]');
  if (nodo === null) throw new Error('No hay bloque de agenda');

  return nodo as HTMLElement;
}

/** La tarjeta de una clase, buscada por su ID y nunca por su nombre. */
function tarjetaDe(turnoId: string): HTMLElement {
  const nodo = elBloque().querySelector(`[data-clase="${turnoId}"]`);
  if (nodo === null) throw new Error(`No hay ninguna tarjeta de la clase «${turnoId}»`);

  return nodo as HTMLElement;
}

/** Las clases pintadas, por su id y EN ORDEN: para fijar el conjunto ENTERO. */
function clasesDeLaAgenda(): string[] {
  return [...elBloque().querySelectorAll('[data-clase]')].map(
    (nodo) => nodo.getAttribute('data-clase') ?? '',
  );
}

/** Lo que la tarjeta de una clase dice de su lista, por ATRIBUTOS y no por texto. */
function cuentaDe(turnoId: string): Record<string, string | null> {
  const nodo = tarjetaDe(turnoId).querySelector('[data-cuenta]');
  if (nodo === null) throw new Error(`La clase «${turnoId}» no dice nada de su lista`);

  return {
    estado: nodo.getAttribute('data-estado'),
    anotados: nodo.getAttribute('data-anotados'),
    marcados: nodo.getAttribute('data-marcados'),
    faltan: nodo.getAttribute('data-faltan'),
    texto: nodo.textContent?.trim() ?? '',
  };
}

/** Un texto del documento con los saltos de linea del JSX ya aplanados. */
function textoDe(nodo: Element | null): string {
  return (nodo?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Lo que se lee en la pantalla ENTERA, aplanado. Para comparar dos montajes. */
function textoDeLaPantalla(): string {
  return textoDe(document.body);
}

/**
 * La pantalla entera CON LOS NUMEROS TAPADOS.
 *
 * Los dos montajes del test de la ausencia tienen listas distintas —una con el
 * QR y otra sin nada—, porque tienen que ser los dos POSIBLES. O sea que sus
 * cuentas difieren a proposito: «faltan 2 de 3» y «faltan 3 de 3». Lo que se
 * compara es todo lo demas, y si ahi aparece un cartel que solo sale con
 * `listaPasada`, las dos cadenas dejan de ser iguales.
 */
function textoSinNumeros(): string {
  return textoDeLaPantalla().replace(/\d/g, '#');
}

async function escribirElRango(desde: string, hasta: string): Promise<void> {
  const usuario = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

  await usuario.clear(screen.getByLabelText('Desde'));
  await usuario.type(screen.getByLabelText('Desde'), desde);
  await usuario.clear(screen.getByLabelText('Hasta'));
  await usuario.type(screen.getByLabelText('Hasta'), hasta);
  await usuario.click(screen.getByRole('button', { name: 'Ver el rango' }));
}

// ---------------------------------------------------------------------------
// El cartel que no esta
// ---------------------------------------------------------------------------

describe('la agenda no se cree el «lista pasada» de la API', () => {
  /**
   * EL TEST QUE MIDE UNA AUSENCIA, Y POR QUE NO BUSCA LA FRASE.
   *
   * Buscar `'lista pasada'` mataria UN cartel escrito de UNA manera. Un tilde
   * verde, un `aria-label="ya esta"`, una clase CSS distinta o un «hecha» lo
   * esquivan todos sin despeinarse, y entonces este test pasaria en verde
   * sobre la mentira que existe para impedir.
   *
   * Asi que se mide por DIFERENCIA. Se monta dos veces la misma clase —una con
   * el QR encima y otra sin nada— y se compara **el texto salvo los numeros**.
   * Los numeros TIENEN que diferir: los dos fijos son posibles y por eso sus
   * cuentas son 2 de 3 y 3 de 3. Todo lo demas tiene que ser identico, y si la
   * pantalla usara el booleano PARA LO QUE SEA —un cartel, un tilde, una
   * palabra— dejaria de serlo.
   *
   * Y SE COMPRUEBA QUE EL TEXTO NO ESTA VACIO antes de compararlos, que es el
   * caso ciego de este test: dos pantallas en blanco tambien son identicas.
   */
  it('NO dice «lista pasada» en ningun sitio', async () => {
    await montarYEsperar({ agenda: [CLASE_CON_QR], listas: { [TURNO_A]: ALUMNOS_CON_UN_QR } });

    const conQr = textoSinNumeros();
    // El control del caso ciego: hubo pantalla, y la cuenta llego a pintarse.
    expect(textoDeLaPantalla()).toContain(CENTINELAS.elNombreDeLaClase);
    expect(cuentaDe(TURNO_A)).toMatchObject({ estado: 'listo', marcados: '1', faltan: '2' });
    const numerosConQr = cuentaDe(TURNO_A).texto;

    cleanup();
    vi.clearAllMocks();

    await montarYEsperar({ agenda: [CLASE_SIN_QR], listas: { [TURNO_A]: ALUMNOS_SIN_MARCAR } });

    // Los dos montajes difieren DE VERDAD: en el booleano y en los numeros. Sin
    // estas dos lineas, dos fijos iguales por un descuido harian pasar el test
    // sin medir nada, y el enmascarado de los digitos lo taparia.
    expect(CLASE_CON_QR.listaPasada).not.toBe(CLASE_SIN_QR.listaPasada);
    expect(cuentaDe(TURNO_A).texto).not.toBe(numerosConQr);

    expect(textoSinNumeros()).toBe(conQr);
  });

  it('y dice, con palabras, por que no hay ningun tilde de «ya esta»', async () => {
    // Igualdad exacta sobre el texto entero y no un `toContain('QR')`: con una
    // subcadena, borrar la mitad de la frase —justo la que explica que la marca
    // la enciende UNA persona— seguiria pasando.
    await montarYEsperar();

    expect(textoDe(document.querySelector('[data-por-que-no-hay-tilde]'))).toBe(
      'Aca no vas a ver «lista pasada» en ninguna clase, y es a proposito: esa marca se ' +
        'enciende en cuanto UNA sola persona escanea el QR al entrar, aunque vos no hayas ' +
        'tocado la clase. En su lugar se dice cuantos de los anotados siguen sin marcar.',
    );
  });
});

// ---------------------------------------------------------------------------
// Lo que la agenda dice en su lugar
// ---------------------------------------------------------------------------

describe('cuantos quedan sin marcar', () => {
  it('dice cuantos quedan sin marcar', async () => {
    await montarYEsperar();

    // IGUALDAD EXACTA SOBRE ATRIBUTOS PROPIOS, no subcadenas: `'3'` esta dentro
    // de `'13'` y un `toContain('2 de 3')` pasaria sobre un «12 de 3».
    //
    // ⚠️ LOS TRES NUMEROS SON DISTINTOS ENTRE SI, Y ESO ES EL TEST. Con la
    // clase sin marcar —3 anotados, 0 marcados, 3 que faltan— un conteo que
    // devolviera los ANOTADOS en vez de los que faltan daria el mismo 3 y esta
    // afirmacion no podria fallar. Por eso esta clase lleva el QR encima.
    expect(cuentaDe(TURNO_A)).toMatchObject({
      estado: 'listo',
      anotados: '3',
      marcados: '1',
      faltan: '2',
    });

    // Y lo dice con palabras, porque el atributo no lo lee nadie de pie en la
    // sala. El numero que va PRIMERO es el que falta, no el total.
    expect(cuentaDe(TURNO_A).texto).toBe('Faltan 2 de 3 por marcar.');
  });

  /**
   * LOS QUE FALTAN NO SON LOS ANOTADOS, Y EN LA CLASE B SON NUMEROS DISTINTOS.
   *
   * Esta es la mutacion barata: contar `alumnos.length` —o el
   * `reservasActivas` que la agenda ya trae— en vez de la resta. En la clase A
   * los dos dan 3 y no se distinguirian; en la B dan 0 y 2.
   */
  it('una clase con TODOS marcados se distingue de una con ninguno', async () => {
    await montarYEsperar();

    expect(cuentaDe(TURNO_B)).toMatchObject({
      estado: 'listo',
      anotados: '2',
      marcados: '2',
      faltan: '0',
    });

    // LAS DOS TARJETAS DICEN COSAS DISTINTAS, y no solo un numero distinto
    // dentro de la misma frase: «Faltan 0 de 2» se confunde de reojo con
    // «Faltan 3 de 3» en una lista, que es justo donde se mira de reojo.
    expect(cuentaDe(TURNO_B).texto).toBe('Ya estan los 2 marcados.');
    expect(cuentaDe(TURNO_B).texto).not.toBe(cuentaDe(TURNO_A).texto);
    expect(cuentaDe(TURNO_B).faltan).not.toBe(cuentaDe(TURNO_A).faltan);
  });

  it('un marcado AUSENTE cuenta como marcado, no como «no se sabe»', async () => {
    // `asistio: false` es una respuesta —«no vino»— y `null` es la falta de
    // respuesta. La clase B tiene uno de cada, asi que un `=== true` en vez de
    // un `!== null` daria 1 marcado y no 2.
    await montarYEsperar();

    expect(conteoDeLaLista(ALUMNOS_TODOS_MARCADOS)).toEqual({
      anotados: 2,
      marcados: 2,
      faltan: 0,
    });
    expect(cuentaDe(TURNO_B).marcados).toBe('2');
  });

  it('una clase a la que no se anoto nadie no es una clase resuelta', async () => {
    // El tercer caso, y el que un `faltan === 0` solo no distingue: cero de
    // cero. «Ya estan los 0 marcados» le diria a la profesora que esa clase
    // esta hecha.
    await montarYEsperar({ agenda: [CLASE_B], listas: { [TURNO_B]: [] } });

    expect(cuentaDe(TURNO_B)).toMatchObject({ estado: 'listo', anotados: '0', faltan: '0' });
    expect(cuentaDe(TURNO_B).texto).toBe('No se anoto nadie en esta clase.');
  });

  it('si no se puede mirar quien falta, se dice: no se deja en blanco', async () => {
    // Una tarjeta sin cuenta se lee como una clase sin nadie anotado, que es la
    // lectura mas cara de las dos: «no tengo que pasar lista aca».
    await montarYEsperar({ agenda: [CLASE_B], listas: {} });

    expect(cuentaDe(TURNO_B).estado).toBe('no-se-pudo');
    expect(cuentaDe(TURNO_B).faltan).toBeNull();
    expect(cuentaDe(TURNO_B).texto).toBe('No se pudo mirar quien falta en esta clase.');
  });
});

// ---------------------------------------------------------------------------
// El costo de una peticion por clase
// ---------------------------------------------------------------------------

describe('una peticion por clase, y el tope a partir del cual no se pide', () => {
  it('pide la agenda UNA vez y el detalle UNA vez por clase', async () => {
    await montarYEsperar();

    expect(rutasPedidas()).toEqual(
      [
        `/mis-clases?desde=${DESDE}&hasta=${HASTA}`,
        `/mis-clases/${TURNO_A}/alumnos`,
        `/mis-clases/${TURNO_B}/alumnos`,
      ].sort(),
    );
  });

  /**
   * PASADO EL TOPE **NO SE PIDE NADA** Y SE DICE QUE NO SE PIDIO.
   *
   * La tentacion es caer al `listaPasada` que ya viene en la agenda, que es
   * gratis. Seria la peor de las salidas: un si/no que puede ser falso, y
   * mintiendo SOLO en los rangos largos, que es donde nadie va a ir a
   * comprobarlo. Aqui no se pide y se dice.
   */
  it('con mas clases que el tope, no sale ni una peticion de detalle', async () => {
    const muchas = Array.from({ length: MAX_CLASES_CON_DETALLE + 1 }, (_, i) => ({
      ...CLASE_B,
      turnoId: `turno-${i}`,
    }));

    await montarYEsperar({ agenda: muchas, listas: {} });

    // La agenda SI se pidio: lo que se recorta es el detalle, no la pantalla.
    expect(rutasPedidas()).toEqual([`/mis-clases?desde=${DESDE}&hasta=${HASTA}`]);

    // Las clases se siguen listando, y cada una sigue llevando a su lista.
    expect(clasesDeLaAgenda()).toHaveLength(MAX_CLASES_CON_DETALLE + 1);

    // Y se dice, en la tarjeta y arriba: ni un hueco en blanco ni un si/no.
    expect(cuentaDe('turno-0').estado).toBe('no-pedido');
    expect(cuentaDe('turno-0').faltan).toBeNull();
    expect(document.querySelector('[data-sin-detalle]')).not.toBeNull();
  });

  /**
   * ⚠️ LA LISTA BLANCA DE ARRIBA MIRA `pedir`, NO LA RED, Y ESE ES SU AGUJERO.
   *
   * El doble esta puesto sobre `pedir`, asi que una peticion hecha con `fetch`
   * a pelo no aparece en `rutasPedidas()`, no cambia un nodo del marcado, no
   * manda un cuerpo que ningun test mire, no toca los almacenes y no dice nada
   * por la consola. **MEDIDO EN ESTA PANTALLA**: un
   *
   *     void fetch('https://…/clases', { method: 'POST', body: JSON.stringify(alumnos.data) })
   *
   * dentro de `CuentaDeLaClase` —o sea, LA LISTA ENTERA de cada clase, con el
   * nombre propio y la ausencia de cada persona— paso los 19 tests de este
   * archivo y el `tsc`. No lo ve ninguno de los trece canales globales: ahi
   * estan `new Image()` y `sendBeacon` justamente PORQUE no son `fetch`, y el
   * docblock del espia da por supuesto que «el test de no habla con la red por
   * fuera de `pedir` —que dobla el fetch global— pasa en verde». Ese test
   * existe en tres specs de setenta y cuatro, y este no era uno de ellos.
   *
   * Por eso se afirma sobre el GLOBAL `fetch` y no sobre una lista de
   * destinos: lo que se fija es que esta pantalla no tiene NINGUN camino de red
   * propio.
   */
  it('no habla con la red por fuera de `pedir`', async () => {
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
      await montarYEsperar();

      // El control del caso ciego: la pantalla llego a tener los datos en la
      // mano. Una pantalla que no pinto nada tampoco llama a `fetch`.
      expect(cuentaDe(TURNO_A).estado).toBe('listo');
      expect(rutasPedidas()).toHaveLength(3);

      // Los destinos y no solo el conteo: si alguna vez cae, el informe dice a
      // donde se estaba hablando.
      expect(red.mock.calls.map(([destino]) => String(destino))).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('justo en el tope si se pide, que es el borde que decide', async () => {
    // El caso ciego del de arriba: con un tope mal escrito —un `<` donde va un
    // `<=`— la pantalla dejaria de contestar una clase antes y el test anterior
    // seguiria en verde.
    const justas = Array.from({ length: MAX_CLASES_CON_DETALLE }, (_, i) => ({
      ...CLASE_B,
      turnoId: `turno-${i}`,
    }));
    const listas = Object.fromEntries(justas.map((c) => [c.turnoId, ALUMNOS_TODOS_MARCADOS]));

    await montarYEsperar({ agenda: justas, listas });

    expect(rutasPedidas()).toHaveLength(MAX_CLASES_CON_DETALLE + 1);
    expect(cuentaDe('turno-0').estado).toBe('listo');
    expect(document.querySelector('[data-sin-detalle]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// El rango
// ---------------------------------------------------------------------------

describe('el rango vive en la URL', () => {
  /**
   * EL BOTON DE ATRAS, QUE EN UN TELEFONO ES EL GESTO MAS USADO DE TODOS.
   *
   * Se mide en tres pasos y no en uno: la URL llega a la peticion, los
   * controles escriben la URL, y —lo que de verdad prueba el boton de atras—
   * VOLVER a la URL de antes devuelve la pantalla de antes. Con el rango en un
   * `useState`, los dos primeros pasos pasan igual y el tercero no: la pantalla
   * se quedaria mostrando el rango nuevo con la barra de direcciones diciendo
   * el viejo.
   */
  it('el rango viaja en la URL y sobrevive al boton de atras', async () => {
    const { rerender } = montar();
    await esperar();

    // 1. De la URL a la peticion.
    expect(rutasPedidas()).toContain(`/mis-clases?desde=${DESDE}&hasta=${HASTA}`);
    expect(screen.getByLabelText('Desde')).toHaveValue(DESDE);

    // 2. De los controles a la URL. UNA sola navegacion por envio.
    await escribirElRango('2026-04-01', '2026-04-02');
    expect(empujar).toHaveBeenCalledTimes(1);
    expect(empujar).toHaveBeenCalledWith(`${RUTA}?desde=2026-04-01&hasta=2026-04-02`);

    // El navegador hace lo que el `push` pidio: la URL cambia y la pantalla
    // se vuelve a pintar leyendola.
    busqueda.valor = 'desde=2026-04-01&hasta=2026-04-02';
    rerender(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <PaginaDeMisClases />
      </QueryClientProvider>,
    );
    await esperar();

    expect(screen.getByLabelText('Desde')).toHaveValue('2026-04-01');
    expect(rutasPedidas()).toContain('/mis-clases?desde=2026-04-01&hasta=2026-04-02');

    // 3. ATRAS. La URL vuelve a la de antes y la pantalla tambien, entera: los
    //    controles Y lo que se pide.
    pedirEspia.mockClear();
    busqueda.valor = CONSULTA;
    rerender(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <PaginaDeMisClases />
      </QueryClientProvider>,
    );
    await esperar();

    expect(screen.getByLabelText('Desde')).toHaveValue(DESDE);
    expect(screen.getByLabelText('Hasta')).toHaveValue(HASTA);
    expect(rutasPedidas()).toContain(`/mis-clases?desde=${DESDE}&hasta=${HASTA}`);
    expect(rutasPedidas()).not.toContain('/mis-clases?desde=2026-04-01&hasta=2026-04-02');
  });

  it('sin rango en la URL se pide HOY, los dos extremos, y se dibuja', async () => {
    // `desde` y `hasta` son OBLIGATORIOS —los valida `exigirRango` a mano—, asi
    // que entrar sin nada tiene que elegir un rango igualmente. Y el elegido se
    // dibuja en los controles, para que nadie lea una agenda sin saber de
    // cuando es.
    await montarYEsperar({ consulta: '', agenda: [], listas: {} });

    expect(rutasPedidas()).toEqual([`/mis-clases?desde=${HOY}&hasta=${HOY}`]);
    expect(screen.getByLabelText('Desde')).toHaveValue(HOY);
    expect(screen.getByLabelText('Hasta')).toHaveValue(HOY);
  });

  it('medio rango en la URL se completa con el otro extremo de hoy', async () => {
    await montarYEsperar({ consulta: 'desde=2026-10-01', agenda: [], listas: {} });

    expect(rutasPedidas()).toEqual([`/mis-clases?desde=2026-10-01&hasta=${HOY}`]);
  });
});

// ---------------------------------------------------------------------------
// Lo que dice la API cuando no se puede contestar
// ---------------------------------------------------------------------------

describe('cuando la agenda no se puede leer', () => {
  /**
   * EL RANGO INVERTIDO VIAJA TAL CUAL Y LA API EXPLICA POR QUE.
   *
   * Arreglarlo aqui —dar la vuelta a los extremos, o caer al defecto— pintaria
   * las clases de otros dias debajo de una barra de direcciones que dice el
   * rango invertido. El sitio donde se decide que rango es valido es
   * `exigirRango`, y su mensaje es el unico que explica lo que pasa.
   */
  it('un rango invertido muestra el motivo de la API', async () => {
    const motivo = 'desde no puede ser posterior a hasta';

    await montarYEsperar({
      consulta: 'desde=2026-03-10&hasta=2026-03-01',
      error: new ErrorDeApi(motivo, 400),
    });

    // 1. VIAJO INVERTIDO: si la pantalla lo hubiera "arreglado", la API nunca
    //    habria contestado esto y el test probaria un error inventado.
    expect(rutasPedidas()).toEqual(['/mis-clases?desde=2026-03-10&hasta=2026-03-01']);

    // 2. Y SE PINTA EL MOTIVO, PALABRA POR PALABRA. Igualdad exacta: un
    //    `toContain('desde')` pasa sobre cualquier frase que lleve «desde».
    expect(textoDe(document.querySelector('[data-fallo-al-leer] [role="alert"]'))).toBe(
      `No se pudo leer tu agenda: ${motivo}`,
    );

    // 3. Y SE PUEDE VOLVER A INTENTAR: un rango invertido se arregla
    //    escribiendo otro, pero un 500 se arregla reintentando, y el cartel es
    //    el mismo para los dos.
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('una agenda vacia se distingue de un fallo al leer', async () => {
    // LAS DOS DIRECCIONES, porque son dos pantallas distintas y cada una se
    // rompe sola. Un 400 dibujado como «no tenes clases» le diria a la
    // profesora que hoy no trabaja.
    await montarYEsperar({ agenda: [], listas: {} });

    expect(document.querySelector('[data-sin-clases]')).not.toBeNull();
    expect(document.querySelector('[data-fallo-al-leer]')).toBeNull();
    expect(clasesDeLaAgenda()).toEqual([]);

    cleanup();
    vi.clearAllMocks();

    await montarYEsperar({ error: new ErrorDeApi('Base de datos caida', 500) });

    expect(document.querySelector('[data-fallo-al-leer]')).not.toBeNull();
    expect(document.querySelector('[data-sin-clases]')).toBeNull();
    // Y NI UNA TARJETA se pinta sobre un error.
    expect(document.querySelector('[data-bloque="agenda"] [data-clase]')).toBeNull();
  });

  it('un 401 no se enseña crudo: se va al login con el rango puesto', async () => {
    // El token puede caducar con la pantalla abierta, y en esta pantalla eso es
    // lo normal: se abre al empezar la clase y se usa al terminarla. El destino
    // conserva el query porque el rango vive ahi.
    await montarYEsperar({ error: new ErrorDeApi('Unauthorized', 401) });

    expect(document.querySelector('[data-fallo-al-leer]')).toBeNull();
    expect(empujar).toHaveBeenCalledWith(
      `/mi-gym/login?volverA=${encodeURIComponent(`${RUTA}?${CONSULTA}`)}`,
    );
  });
});

// ---------------------------------------------------------------------------
// A donde lleva cada clase
// ---------------------------------------------------------------------------

describe('cada clase lleva a SU lista', () => {
  /**
   * DOS CLASES SEMBRADAS, Y ESO ES LO QUE HACE EL TEST.
   *
   * Con una sola clase, una pantalla que enlazara siempre al primer turno
   * pasaria en verde. Y se afirma el `href` ENTERO de cada una: un
   * `toContain(TURNO_B)` pasaria sobre un `/mi-gym/mis-clases/turno-de-las-nueve
   * ?otro=turno-de-las-once`.
   */
  it('cada clase lleva a SU pantalla de lista, con dos sembradas', async () => {
    await montarYEsperar();

    // El conjunto ENTERO y en orden: asi se ve tambien una clase de mas.
    expect(clasesDeLaAgenda()).toEqual([TURNO_A, TURNO_B]);

    expect(tarjetaDe(TURNO_A).getAttribute('href')).toBe(`/mi-gym/mis-clases/${TURNO_A}`);
    expect(tarjetaDe(TURNO_B).getAttribute('href')).toBe(`/mi-gym/mis-clases/${TURNO_B}`);

    // Y NO llevan al mismo sitio, que es la mutacion que esto mata.
    expect(tarjetaDe(TURNO_A).getAttribute('href')).not.toBe(
      tarjetaDe(TURNO_B).getAttribute('href'),
    );
  });

  it('cada tarjeta dice de que clase es: nombre, cuando y donde', async () => {
    // Sin esto, dos clases de la misma sala a dos horas distintas son dos
    // rectangulos iguales y la profesora entra en la que no es.
    await montarYEsperar();

    expect(textoDe(tarjetaDe(TURNO_A).querySelector('[data-cuando]'))).toBe(
      `${DESDE} · 09:00–10:00`,
    );
    expect(textoDe(tarjetaDe(TURNO_B).querySelector('[data-cuando]'))).toBe(
      `${DESDE} · 11:00–12:00`,
    );
    expect(textoDe(tarjetaDe(TURNO_A).querySelector('[data-sala]'))).toBe('Sala grande');
    expect(textoDe(tarjetaDe(TURNO_B).querySelector('[data-sala]'))).toBe('Sala chica');
  });
});

// ---------------------------------------------------------------------------
// Lo que no se pinta
// ---------------------------------------------------------------------------

describe('la agenda no enseña a nadie por su nombre', () => {
  /**
   * LA AGENDA CUENTA PERSONAS, NO LAS NOMBRA.
   *
   * La lista de nombres es de la pantalla de UNA clase, que se abre a
   * proposito. En la agenda, con el telefono en la mano y gente alrededor, lo
   * unico que hace falta es cuantos faltan — y los nombres de quienes faltaron
   * son un dato sobre personas que no estan ahi para defenderse.
   *
   * Esto NO lo cubre el tapon global: los trece canales miran todo lo que NO es
   * el `<body>`. Lo que se dibuja dentro del cuerpo solo lo mira un test como
   * este.
   */
  it('ni un nombre ni un perfilId de los alumnos llega al marcado', async () => {
    await montarYEsperar();

    for (const [nombre, centinela] of Object.entries(CENTINELAS)) {
      if (nombre === 'elNombreDeLaClase') continue; // ese SI se pinta: es la clase.
      expect(document.body.innerHTML, nombre).not.toContain(centinela);
    }
  });
});
