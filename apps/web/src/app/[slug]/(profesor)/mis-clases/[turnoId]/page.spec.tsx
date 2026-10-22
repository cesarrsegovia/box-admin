import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AlumnoEnClase } from '@boxadmin/shared';
import { ErrorDeApi } from '@/lib/cliente';
import { vigilarEstosDatos } from '@/test/espia-de-consola';
import PaginaDePasarLista from './page';

// ---------------------------------------------------------------------------
// Andamiaje
// ---------------------------------------------------------------------------

const SLUG = 'mi-gym';
const TURNO = 'turno-de-las-nueve-lista';
const RUTA = `/${SLUG}/mis-clases/${TURNO}`;

const { empujar, pedirEspia } = vi.hoisted(() => ({ empujar: vi.fn(), pedirEspia: vi.fn() }));

/**
 * `useParams` devuelve LOS DOS: el gimnasio y el turno.
 *
 * Esta pantalla NO lee `useSearchParams`, y no por olvido: el turno va en el
 * camino y no hay ni un filtro que viva en el query. Por eso tampoco hace
 * falta una frontera de Suspense —que es lo que `useSearchParams` obliga a
 * poner— y por eso el destino del login se arma con `SIN_QUERY`.
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: empujar, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({ slug: SLUG, turnoId: TURNO }),
  usePathname: () => RUTA,
}));

/**
 * Se dobla `pedir`, no `fetch`.
 *
 * Que `pedir` arme bien la URL y el cuerpo ya lo fija `use-mis-clases.spec`.
 * Lo que se audita aqui es un escalon mas arriba: QUE manda esta pantalla y
 * que hace con lo que vuelve. `ErrorDeApi` se deja REAL porque la pagina
 * ramifica con `instanceof` y con `esSesionCaducada`.
 *
 * ⚠️ Y NO SE DOBLA NADA MAS. Ni `fetch`, ni `console`, ni los almacenes: los
 * quince canales y los dos ejes del tapon global de `vitest.setup.ts` —entre
 * ellos la red por fuera de `pedir`— corren solos sobre este archivo, y un
 * doble local de cualquiera de ellos los dejaria mirando un objeto de mentira
 * justo en la pantalla que reparte nombres propios y ausencias.
 */
vi.mock('@/lib/cliente', async (original) => ({
  ...(await original<typeof import('@/lib/cliente')>()),
  pedir: pedirEspia,
}));

afterEach(() => {
  vi.clearAllMocks();
  // Los almacenes del navegador los deja como estaban —y ademas los AUDITA— el
  // tapon global, que corre DESPUES que este `afterEach`.
});

// ---------------------------------------------------------------------------
// Lo que esta pantalla siembra, y por que se registra
// ---------------------------------------------------------------------------

/**
 * ESTA PANTALLA REPARTE NOMBRES PROPIOS Y, SOBRE TODO, AUSENCIAS.
 *
 * No es un importe ni un id de sala: es «Fulano no vino el martes». La gente de
 * la que hablan estos fijos no esta en la sala para quejarse si acaba en el
 * titulo de la pestaña del mostrador, en `localStorage` de un telefono
 * compartido, en un `BroadcastChannel` o en el registro de CI, que lo guarda
 * mas tiempo y lo lee mas gente que la consola de la profesora.
 *
 * ⚠️ SE REGISTRAN TAMBIEN LOS `perfilId`, Y NO ES DE ADORNO. Un `cuid` no se
 * lee, pero **al lado de una lista de presentes, no estar es el dato**: el
 * cuerpo que esta pantalla manda es exactamente «estos vinieron», asi que un
 * id que se filtre junto a ese cuerpo dice quien falto con la misma precision
 * que un nombre. Y el mensaje de los intrusos de la API los NOMBRA uno por
 * uno.
 *
 * Y se registran las dos grafias del estado: la de la lectura
 * (`"asistio":false`) y la del que todavia no tiene ninguna
 * (`"asistio":null`), que es la forma que toma un `console.log(alumnos)`.
 *
 * Va en el cuerpo del modulo y no en un `beforeEach`: cada archivo de test
 * corre aislado, asi que lo registrado vale para este y para ninguno mas.
 */
const CENTINELAS = {
  laQueVinoYLoRegistro: 'Ana-Duarte-Vino-Lista',
  elQueVinoYLoRegistro: 'Bruno-Ferreyra-Vino-Lista',
  laQueNadieMarco: 'Carla-Ibarra-SinMarcar-Lista',
  elQueNadieMarco: 'Diego-Lemos-SinMarcar-Lista',
  laQueConstaAusente: 'Elena-Rivas-Falto-Lista',
  laQueSeAnotoDespues: 'Zoe-Tandil-SinMarcar-Lista',
  perfilDeLaQueVino: 'perfil-ana-que-vino-lista',
  perfilDelQueVino: 'perfil-bruno-que-vino-lista',
  perfilDeLaQueNadieMarco: 'perfil-carla-sin-marcar-lista',
  perfilDelQueNadieMarco: 'perfil-diego-sin-marcar-lista',
  perfilDeLaQueConstaAusente: 'perfil-elena-que-falto-lista',
  perfilDeLaQueSeAnotoDespues: 'perfil-zoe-anotada-despues-lista',
  volcadoDeLaAusencia: '"asistio":false',
  volcadoDeLaFaltaDeDato: '"asistio":null',
};

vigilarEstosDatos(CENTINELAS);

// ---------------------------------------------------------------------------
// Los fijos, y los dos son RESPUESTAS QUE LA API PUEDE DAR
// ---------------------------------------------------------------------------

/**
 * ⚠️ LOS DOS FIJOS VAN ORDENADOS POR NOMBRE, Y NO ES ESTETICA.
 *
 * `listaDeAlumnos` ordena por `perfil.usuario.nombreCompleto` ascendente
 * (`mis-clases.service.ts`), asi que una lista desordenada es una respuesta
 * que el servidor NO puede dar — y un fijo imposible vuelve decorativa
 * cualquier afirmacion hecha encima, sobre todo la del ORDEN del cuerpo que se
 * manda.
 */

/**
 * LA CLASE A MEDIO CAMINO: DOS QUE ESCANEARON EL QR Y DOS SIN TOCAR.
 *
 * Es el estado NORMAL de una clase que termina: el check-in por QR escribe
 * `asistio: true` persona a persona (`CheckinService.escribir`) y nadie paso
 * lista todavia, asi que el resto sigue en `null`. **No hay ningun `false`
 * aqui, y no podria haberlo**: `false` solo lo escribe `pasarLista`, que marca
 * la clase ENTERA de una vez — con un `false` dentro, los dos `null` serian
 * imposibles.
 *
 * MITAD Y MITAD a proposito: con los cuatro en `true` «llegan tildados» pasaria
 * en verde sobre una pantalla que tilda todo, y con los cuatro en `null`
 * pasaria sobre una que no tilda nada.
 */
const LISTA_CON_QR: AlumnoEnClase[] = [
  {
    perfilId: CENTINELAS.perfilDeLaQueVino,
    nombreCompleto: CENTINELAS.laQueVinoYLoRegistro,
    asistio: true,
  },
  {
    perfilId: CENTINELAS.perfilDelQueVino,
    nombreCompleto: CENTINELAS.elQueVinoYLoRegistro,
    asistio: true,
  },
  {
    perfilId: CENTINELAS.perfilDeLaQueNadieMarco,
    nombreCompleto: CENTINELAS.laQueNadieMarco,
    asistio: null,
  },
  {
    perfilId: CENTINELAS.perfilDelQueNadieMarco,
    nombreCompleto: CENTINELAS.elQueNadieMarco,
    asistio: null,
  },
];

/**
 * LA CLASE CON LOS **TRES** ESTADOS A LA VEZ, Y ES POSIBLE. Comprobado paso a
 * paso.
 *
 * `true` y `false` juntos salen de un pasar lista: marca presentes a unos y
 * ausentes a todos los demas. Lo que parece imposible es el `null` al lado,
 * porque ese mismo pasar lista no deja ninguno... **y se consigue con una
 * reserva creada DESPUES**: `ReservasService.crear` no mira el reloj del turno
 * —no hay ni una comprobacion de fecha en el metodo—, asi que un admin puede
 * anotar a alguien que llego tarde cuando la lista ya estaba pasada. Esa
 * reserva nace con `asistio: null` y entra en la lista, que filtra por
 * `canceladaEn: null` y nada mas.
 *
 * Hace falta que esten los tres: `null` y `false` se DIBUJAN IGUAL —los dos sin
 * tildar— y con uno solo de los dos sembrado no se puede probar que los dos
 * llegan asi; y sin el `true` al lado, «ninguno llega tildado» pasaria en
 * verde sobre una pantalla que no tilda nada nunca.
 */
const LISTA_YA_PASADA: AlumnoEnClase[] = [
  {
    perfilId: CENTINELAS.perfilDeLaQueVino,
    nombreCompleto: CENTINELAS.laQueVinoYLoRegistro,
    asistio: true,
  },
  {
    perfilId: CENTINELAS.perfilDeLaQueConstaAusente,
    nombreCompleto: CENTINELAS.laQueConstaAusente,
    asistio: false,
  },
  {
    perfilId: CENTINELAS.perfilDeLaQueSeAnotoDespues,
    nombreCompleto: CENTINELAS.laQueSeAnotoDespues,
    asistio: null,
  },
];

/**
 * LO QUE EL `POST` CONTESTA, CALCULADO COMO LO CALCULA EL SERVICE.
 *
 * El `POST` **devuelve la lista entera ya marcada** —`AlumnoEnClase[]`, no un
 * 204— y lo que devuelve no es cualquier cosa: es el reemplazo total aplicado,
 * o sea `true` para los que fueron en `presentes` y `false` para TODOS los
 * demas. Un doble que contestara otra cosa seria una respuesta que la API no
 * puede dar, y el cartel de «guardada» estaria probado contra una fantasia.
 */
function comoLoDejaElServidor(
  lista: readonly AlumnoEnClase[],
  presentes: readonly string[],
): AlumnoEnClase[] {
  return lista.map((alumno) => ({ ...alumno, asistio: presentes.includes(alumno.perfilId) }));
}

// ---------------------------------------------------------------------------
// Montaje
// ---------------------------------------------------------------------------

/** Una promesa que se resuelve cuando el test quiere. Para medir «una sola vez». */
function enEspera<T>(): { promesa: Promise<T>; resolver: (valor: T) => void } {
  let resolver: (valor: T) => void = () => undefined;
  const promesa = new Promise<T>((cumplir) => {
    resolver = cumplir;
  });

  return { promesa, resolver };
}

interface OpcionesDeMontaje {
  /** Lo que contesta `GET /mis-clases/:turnoId/alumnos`. */
  lista?: AlumnoEnClase[];
  /** Lo que falla al LEER la lista. */
  errorAlLeer?: unknown;
  /** Lo que falla al GUARDARLA. */
  errorAlGuardar?: unknown;
  /** Una respuesta del `POST` distinta de la que el service daria. */
  respuestaDelPost?: AlumnoEnClase[];
  /** El `POST` se queda colgado hasta que el test lo suelte. */
  postEnEspera?: { promesa: Promise<AlumnoEnClase[]> };
}

function montar(opciones: OpcionesDeMontaje = {}) {
  const {
    lista = LISTA_CON_QR,
    errorAlLeer,
    errorAlGuardar,
    respuestaDelPost,
    postEnEspera,
  } = opciones;

  // El doble responde POR RUTA y no por orden de llamada: con
  // `mockResolvedValueOnce` encadenados, una peticion de mas corre todas las
  // respuestas una posicion y los tests fallan en el sitio equivocado.
  pedirEspia.mockImplementation((ruta: string, opcionesDePedir?: { cuerpo?: unknown }) => {
    if (ruta === `/mis-clases/${TURNO}/alumnos`) {
      return errorAlLeer === undefined ? Promise.resolve(lista) : Promise.reject(errorAlLeer);
    }

    if (ruta === `/mis-clases/${TURNO}/asistencia`) {
      if (errorAlGuardar !== undefined) return Promise.reject(errorAlGuardar);
      if (postEnEspera !== undefined) return postEnEspera.promesa;
      if (respuestaDelPost !== undefined) return Promise.resolve(respuestaDelPost);

      const cuerpo = opcionesDePedir?.cuerpo as { presentes?: string[] } | undefined;
      return Promise.resolve(comoLoDejaElServidor(lista, cuerpo?.presentes ?? []));
    }

    throw new Error(`La pantalla pidio una ruta que nadie espera: ${ruta}`);
  });

  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <PaginaDePasarLista />
    </QueryClientProvider>,
  );
}

/** Deja que las consultas se resuelvan (o se rompan) y que React pinte. */
async function esperar(): Promise<void> {
  await act(async () => {
    for (let vuelta = 0; vuelta < 6; vuelta += 1) {
      await new Promise((resolver) => setTimeout(resolver, 0));
    }
  });
}

async function montarYEsperar(opciones: OpcionesDeMontaje = {}): Promise<void> {
  montar(opciones);
  await esperar();
}

// ---------------------------------------------------------------------------
// Lo que se mira, SIEMPRE por atributos propios
// ---------------------------------------------------------------------------

/** Las filas de la lista, en el orden en que estan pintadas. */
function filas(): HTMLElement[] {
  return [...document.querySelectorAll('[data-alumno]')] as HTMLElement[];
}

function filaDe(perfilId: string): HTMLElement {
  const nodo = document.querySelector(`[data-alumno="${perfilId}"]`);
  if (nodo === null) throw new Error(`No hay ninguna fila de «${perfilId}»`);

  return nodo as HTMLElement;
}

function casillaDe(fila: HTMLElement): HTMLInputElement {
  const nodo = fila.querySelector('input[type="checkbox"]');
  if (nodo === null) throw new Error('Esa fila no tiene casilla');

  return nodo as HTMLInputElement;
}

function estaTildado(perfilId: string): boolean {
  return casillaDe(filaDe(perfilId)).checked;
}

function estadoPrevioDe(perfilId: string): string | null {
  return filaDe(perfilId).getAttribute('data-estado-previo');
}

/**
 * LO QUE LLEVAN DENTRO LOS SITIOS DEL MARCADO QUE **`innerHTML` NO
 * SERIALIZA**.
 *
 * Es el hueco entre las dos defensas de este repo, y no uno teorico: esta
 * medido abajo, en el test que lo usa.
 *
 *  - El `.value` de un control en «modo valor» —el tipo por defecto, `text`,
 *    `password`— y el de un `<textarea>` son una PROPIEDAD que no se refleja
 *    al atributo. Un `nodo.value = …` no aparece ni en
 *    `document.body.innerHTML` ni en `textContent`, que es por donde miran
 *    TODOS los tests de pantalla. (Los tipos en «modo defecto» —`hidden`,
 *    `checkbox`, los botones— SI reflejan, y por eso los caza el marcado: la
 *    medida esta en el test de aqui abajo.)
 *  - Un shadow root tampoco entra en el `innerHTML` de su anfitrion, ni
 *    siquiera abierto, y `querySelectorAll('*')` no desciende a el.
 *
 * ESTA COPIA SIGUE SIENDO LOCAL A PROPOSITO aunque el agujero ya sea el
 * DECIMOQUINTO canal global: la version global tiene que RESTAR lo que el
 * marcado ya publica —media docena de pantallas pintan `<input value={nombre}>`
 * a proposito— y esta no, porque en esta pantalla no hay ninguna. El porque
 * entero esta en el test que la usa.
 */
function loQueElMarcadoNoSerializa(): string[] {
  const escondites: string[] = [];

  for (const nodo of document.body.querySelectorAll('*')) {
    const valor = (nodo as Partial<HTMLInputElement>).value;
    if (typeof valor === 'string') escondites.push(valor);

    const sombra = nodo.shadowRoot;
    if (sombra !== null) escondites.push(sombra.innerHTML, sombra.textContent ?? '');
  }

  return escondites;
}

/** Los perfilId TILDADOS, en orden: para fijar el conjunto entero y no uno. */
function tildados(): string[] {
  return filas()
    .filter((fila) => casillaDe(fila).checked)
    .map((fila) => fila.getAttribute('data-alumno') ?? '');
}

/** Los perfilId SIN tildar. El complemento, porque la ausencia es el dato. */
function sinTildar(): string[] {
  return filas()
    .filter((fila) => !casillaDe(fila).checked)
    .map((fila) => fila.getAttribute('data-alumno') ?? '');
}

/** Las rutas pedidas, SIN DEDUPLICAR: una peticion de mas solo se ve contando. */
function rutasPedidas(): string[] {
  return pedirEspia.mock.calls.map(([ruta]) => ruta as string);
}

/** Lo que se mando a pasar lista, desmenuzado. Nunca se deduplica. */
function llamadasAlPost(): { metodo: unknown; cuerpo: unknown }[] {
  return pedirEspia.mock.calls
    .filter(([ruta]) => ruta === `/mis-clases/${TURNO}/asistencia`)
    .map(([, opciones]) => {
      const o = opciones as { metodo?: unknown; cuerpo?: unknown } | undefined;
      return { metodo: o?.metodo, cuerpo: o?.cuerpo };
    });
}

/** Un texto del documento con los saltos de linea del JSX ya aplanados. */
function textoDe(nodo: Element | null): string {
  return (nodo?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function usuario() {
  return userEvent.setup();
}

async function tildar(perfilId: string): Promise<void> {
  await usuario().click(casillaDe(filaDe(perfilId)));
}

async function clicEnGuardar(): Promise<void> {
  await usuario().click(screen.getByRole('button', { name: 'Guardar la lista' }));
}

// ---------------------------------------------------------------------------
// EL TEST MAS IMPORTANTE DE LA FASE: el reemplazo total no pisa un check-in
// ---------------------------------------------------------------------------

describe('con que tildes llega la pantalla', () => {
  /**
   * SI ESTO FALLA, EL CAMINO NORMAL DE LA PANTALLA DESTRUYE UN DATO
   * VERDADERO.
   *
   * El endpoint es REEMPLAZO TOTAL: marca ausente a todo el que no venga en
   * `presentes`. Con la pantalla naciendo en blanco, la profesora tilda a los
   * que tiene delante, guarda, y quien escaneo el QR al entrar —y por tanto
   * consta presente— se va marcado AUSENTE. Sin fallo, sin error, sin aviso.
   *
   * Por eso se afirma sobre el CONJUNTO ENTERO y las dos mitades: con un
   * `expect(estaTildado(ana)).toBe(true)` suelto, una pantalla que tildara
   * TODO pasaria en verde.
   */
  it('los que ya tienen asistio true llegan TILDADOS', async () => {
    await montarYEsperar({ lista: LISTA_CON_QR });

    // El control del caso ciego: la lista llego entera y hay cuatro filas.
    expect(filas()).toHaveLength(4);

    expect(tildados()).toEqual([CENTINELAS.perfilDeLaQueVino, CENTINELAS.perfilDelQueVino]);
    expect(sinTildar()).toEqual([
      CENTINELAS.perfilDeLaQueNadieMarco,
      CENTINELAS.perfilDelQueNadieMarco,
    ]);

    // MITAD Y MITAD: ni todos ni ninguno, que son las dos formas de pasar este
    // test sin haber mirado el dato.
    expect(tildados()).toHaveLength(2);
    expect(sinTildar()).toHaveLength(2);

    // Y se dice con numeros, que es lo que se mira de pie en la sala.
    const resumen = document.querySelector('[data-resumen]');
    expect(resumen?.getAttribute('data-tildados')).toBe('2');
    expect(resumen?.getAttribute('data-anotados')).toBe('4');
  });

  it('los que tienen asistio false llegan sin tildar', async () => {
    await montarYEsperar({ lista: LISTA_YA_PASADA });

    // El fijo trae DE VERDAD un `false`: sin esta linea, el test de abajo
    // pasaria igual sobre una lista sin ningun ausente dentro.
    expect(estadoPrevioDe(CENTINELAS.perfilDeLaQueConstaAusente)).toBe('falto');
    expect(estaTildado(CENTINELAS.perfilDeLaQueConstaAusente)).toBe(false);

    // El caso ciego, en la MISMA lista: hay alguien tildado, asi que «sin
    // tildar» significa algo. Una pantalla que no tildara nunca nada no
    // pasaria de aqui.
    expect(estaTildado(CENTINELAS.perfilDeLaQueVino)).toBe(true);
  });

  it('los que no tienen estado llegan sin tildar', async () => {
    await montarYEsperar({ lista: LISTA_YA_PASADA });

    // `null` y `false` se DIBUJAN IGUAL —los dos sin tildar— pero vienen de
    // sitios distintos: el `false` lo escribio un pasar lista anterior y el
    // `null` es que nadie dijo nada todavia. Con una sola de las dos sembrada
    // no se distingue nada, asi que estan las dos y se afirma por separado.
    expect(estadoPrevioDe(CENTINELAS.perfilDeLaQueSeAnotoDespues)).toBe('sin-marcar');
    expect(estaTildado(CENTINELAS.perfilDeLaQueSeAnotoDespues)).toBe(false);

    expect(estadoPrevioDe(CENTINELAS.perfilDeLaQueConstaAusente)).toBe('falto');
    expect(estaTildado(CENTINELAS.perfilDeLaQueConstaAusente)).toBe(false);

    // Los dos estados previos son DISTINTOS entre si —lo que prueba que la
    // lista trae los dos— y el tilde es el mismo para los dos.
    expect(estadoPrevioDe(CENTINELAS.perfilDeLaQueSeAnotoDespues)).not.toBe(
      estadoPrevioDe(CENTINELAS.perfilDeLaQueConstaAusente),
    );

    // Y el unico tildado es el unico `true`. Conjunto entero, no una fila.
    expect(tildados()).toEqual([CENTINELAS.perfilDeLaQueVino]);
  });
});

// ---------------------------------------------------------------------------
// Guardar
// ---------------------------------------------------------------------------

describe('guardar manda la foto de la clase', () => {
  /**
   * SE CAMBIAN LOS TILDES EN LOS DOS SENTIDOS, Y ESO ES EL TEST.
   *
   * Se tilda a alguien que llego en `null` y se DESTILDA a alguien que llego
   * en `true`. Asi el cuerpo que sale no coincide ni con «todos los anotados»
   * ni con «los que llegaron marcados presentes», que son las dos formas
   * baratas de pasar este test sin leer una sola casilla.
   *
   * Destildar a quien tiene el QR es legitimo —escaneo y se fue a los cinco
   * minutos— y la pantalla lo manda tal cual: el tilde es de la profesora.
   */
  it('guardar manda los tildados, y una sola vez', async () => {
    const colgada = enEspera<AlumnoEnClase[]>();
    await montarYEsperar({ lista: LISTA_CON_QR, postEnEspera: colgada });

    await tildar(CENTINELAS.perfilDeLaQueNadieMarco);
    await tildar(CENTINELAS.perfilDeLaQueVino);

    expect(tildados()).toEqual([CENTINELAS.perfilDelQueVino, CENTINELAS.perfilDeLaQueNadieMarco]);

    await clicEnGuardar();
    await esperar();

    // CON ALGUIEN TILDADO NO SE PREGUNTA NADA: una confirmacion en cada
    // guardado es una confirmacion que a la tercera clase del dia nadie lee.
    expect(screen.queryByRole('dialog')).toBeNull();

    // El segundo toque —el dedo que insiste porque la red del gimnasio
    // tarda— no manda una segunda foto de la clase.
    await clicEnGuardar();
    await esperar();

    expect(llamadasAlPost()).toHaveLength(1);
    expect(llamadasAlPost()[0]).toEqual({
      metodo: 'POST',
      // En el ORDEN DE LA LISTA y no en el de los toques: se tildo primero a
      // Carla y aqui va segunda, detras de Bruno.
      cuerpo: { presentes: [CENTINELAS.perfilDelQueVino, CENTINELAS.perfilDeLaQueNadieMarco] },
    });

    // Y el cuerpo NO lleva el turno de adorno: la API corre con
    // `forbidNonWhitelisted` y una clave de mas convierte una lista valida en
    // un 400.
    expect(Object.keys(llamadasAlPost()[0]?.cuerpo as object)).toEqual(['presentes']);

    // Al soltar la respuesta, los tildes siguen siendo los que ella dejo.
    await act(async () => {
      colgada.resolver(
        comoLoDejaElServidor(LISTA_CON_QR, [
          CENTINELAS.perfilDelQueVino,
          CENTINELAS.perfilDeLaQueNadieMarco,
        ]),
      );
    });
    await esperar();

    expect(tildados()).toEqual([CENTINELAS.perfilDelQueVino, CENTINELAS.perfilDeLaQueNadieMarco]);
  });

  /**
   * EL CAMINO LEGITIMO QUE NO PUEDE SER UN ACCIDENTE.
   *
   * `presentes: []` marca ausente a la clase ENTERA, y el service tiene una
   * rama propia para el: «no vino nadie» es una tarde real. Pero es tambien lo
   * que produce un dedo que roza el boton antes de tildar a nadie, y las dos
   * cosas son el MISMO cuerpo. Lo que las separa no puede ser una regla: tiene
   * que ser alguien contestando una pregunta que diga a cuantos abarca.
   *
   * Se mide en las cuatro direcciones: no sale nada, se pregunta nombrando el
   * tamaño, cancelar no manda nada, y confirmando SI se puede — porque
   * prohibirlo seria romper un camino de la API.
   */
  it('marcar ausente a TODA la clase se puede, pero no por accidente', async () => {
    await montarYEsperar({ lista: LISTA_CON_QR });

    // Se destildan los dos del QR: la lista queda en cero, que es el cuerpo
    // peligroso.
    await tildar(CENTINELAS.perfilDeLaQueVino);
    await tildar(CENTINELAS.perfilDelQueVino);
    expect(tildados()).toEqual([]);
    expect(filas()).toHaveLength(4);

    // 1. EL CLIC NO MANDA NADA.
    await clicEnGuardar();
    expect(llamadasAlPost()).toEqual([]);

    // 2. SE PREGUNTA, Y LA PREGUNTA DICE A CUANTOS ABARCA. Igualdad exacta: un
    //    `toContain('ausentes')` pasaria sobre un «¿estas seguro?».
    const dialogo = screen.getByRole('dialog');
    expect(textoDe(dialogo.querySelector('p'))).toBe(
      'Marcar ausentes a los 4 anotados de esta clase',
    );

    // 3. CANCELAR NO MANDA NADA, y devuelve el boton de guardar.
    await usuario().click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(llamadasAlPost()).toEqual([]);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Guardar la lista' })).toBeInTheDocument();

    // 4. Y CONFIRMANDO SI SE PUEDE: la clase en la que no vino nadie se puede
    //    registrar, que es justamente lo que esta pantalla vino a permitir.
    await clicEnGuardar();
    await usuario().click(screen.getByRole('button', { name: 'Marcar a todos ausentes' }));
    await esperar();

    expect(llamadasAlPost()).toEqual([{ metodo: 'POST', cuerpo: { presentes: [] } }]);
  });

  /**
   * EL CARTEL DE «GUARDADA» CUENTA LA RESPUESTA, NO LO QUE SE TILDO.
   *
   * El `POST` devuelve `AlumnoEnClase[]` —la clase entera ya marcada— y no un
   * 204. Contar sobre lo tildado seria repetirle a la profesora lo que ella
   * acaba de hacer.
   *
   * ⚠️ Y LOS DOS NUMEROS SE SEPARAN DE VERDAD EN ESTE FIJO, que es lo que lo
   * hace un test y no un adorno: a la que se anoto tarde le cancelan la reserva
   * entre que se leyo la lista y se guardo, asi que la respuesta trae DOS filas
   * donde la pantalla tiene TRES. Contando en local saldria «1 presente y 2
   * ausentes»; contando la respuesta, «1 y 1». Y es una respuesta posible: ella
   * no estaba en `presentes`, asi que no cae en la rama de los intrusos.
   */
  it('lo que se dice al guardar sale de la respuesta y no de lo tildado', async () => {
    const respuesta: AlumnoEnClase[] = [
      {
        perfilId: CENTINELAS.perfilDeLaQueVino,
        nombreCompleto: CENTINELAS.laQueVinoYLoRegistro,
        asistio: true,
      },
      {
        perfilId: CENTINELAS.perfilDeLaQueConstaAusente,
        nombreCompleto: CENTINELAS.laQueConstaAusente,
        asistio: false,
      },
    ];

    await montarYEsperar({ lista: LISTA_YA_PASADA, respuestaDelPost: respuesta });

    expect(filas()).toHaveLength(3);
    await clicEnGuardar();
    await esperar();

    expect(llamadasAlPost()).toEqual([
      { metodo: 'POST', cuerpo: { presentes: [CENTINELAS.perfilDeLaQueVino] } },
    ]);

    const cartel = document.querySelector('[data-guardado]');
    expect(cartel?.getAttribute('data-presentes')).toBe('1');
    // DOS y no uno es lo que daria la cuenta local: ahi hay tres anotados.
    expect(cartel?.getAttribute('data-ausentes')).toBe('1');
    expect(textoDe(cartel)).toBe('Lista guardada: 1 presentes y 1 ausentes.');
  });
});

// ---------------------------------------------------------------------------
// Lo que ya impide el servidor, y esta pantalla NO repite
// ---------------------------------------------------------------------------

describe('los rechazos de la API se mandan a buscar y se pintan enteros', () => {
  /**
   * LA REGLA DEL RELOJ VIVE EN EL SERVICE Y **NO SE COPIA AQUI**.
   *
   * `pasarLista` rechaza las clases que todavia no empezaron con «Esa clase
   * todavia no empezo», y hacia atras NO pone ningun limite —«una profesora
   * que se olvido tres semanas puede ponerse al dia»—. Repetir esa regla en el
   * cliente seria una segunda fuente de verdad, y la copia es la que se queda
   * vieja.
   *
   * ⚠️ POR ESO LA PRIMERA AFIRMACION ES QUE LA PETICION SALIO. Si la pantalla
   * se adelantara a la API, el mensaje de abajo lo podria pintar igual —de
   * memoria, sin preguntar— y este test seguiria en verde midiendo nada.
   * Ademas esta pantalla no tendria con que comprobarlo: el endpoint de la
   * lista devuelve `AlumnoEnClase[]` y ni fecha ni hora del turno.
   */
  it('una clase que no empezo muestra el motivo de la API', async () => {
    const motivo = 'Esa clase todavia no empezo';

    await montarYEsperar({ lista: LISTA_CON_QR, errorAlGuardar: new ErrorDeApi(motivo, 400) });

    await clicEnGuardar();
    await esperar();

    // 1. LA PETICION SALIO: la pantalla pregunto en vez de adivinar.
    expect(llamadasAlPost()).toHaveLength(1);

    // 2. Y SE PINTA EL MOTIVO, PALABRA POR PALABRA. Igualdad exacta: un
    //    `toContain('clase')` pasa sobre cualquier frase que lleve «clase».
    expect(textoDe(document.querySelector('[data-fallo-al-guardar] [role="alert"]'))).toBe(
      `No se pudo pasar lista: ${motivo}`,
    );

    // 3. Y LO TILDADO SIGUE AHI: un fallo al guardar no puede costarle el
    //    repaso entero.
    expect(tildados()).toEqual([CENTINELAS.perfilDeLaQueVino, CENTINELAS.perfilDelQueVino]);
  });

  /**
   * EL OTRO RECHAZO, Y AQUI NO ES TEORICO: entre que se leyo la lista y se
   * guardo, un admin puede cancelarle la reserva a alguien que sigue tildado
   * en esta pantalla. La API lo NOMBRA, y ese nombre es la unica forma de
   * saber a quien destildar.
   */
  it('si alguien perdio la reserva mientras tanto, se dice quien', async () => {
    const motivo = `No tienen reserva activa en esta clase: ${CENTINELAS.perfilDeLaQueSeAnotoDespues}`;

    await montarYEsperar({ lista: LISTA_YA_PASADA, errorAlGuardar: new ErrorDeApi(motivo, 400) });

    await tildar(CENTINELAS.perfilDeLaQueSeAnotoDespues);
    await clicEnGuardar();
    await esperar();

    expect(textoDe(document.querySelector('[data-fallo-al-guardar] [role="alert"]'))).toBe(
      `No se pudo pasar lista: ${motivo}`,
    );
  });

  /**
   * EL TOKEN SE MUERE CON LA PANTALLA ABIERTA, Y AQUI ES LO NORMAL: la lista
   * se abre al empezar la clase y se guarda al terminarla.
   */
  it('un 401 al guardar no se enseña crudo: se va al login', async () => {
    await montarYEsperar({
      lista: LISTA_CON_QR,
      errorAlGuardar: new ErrorDeApi('Unauthorized', 401),
    });

    await clicEnGuardar();
    await esperar();

    expect(document.querySelector('[data-fallo-al-guardar]')).toBeNull();
    // SIN query: esta pantalla no lee nada de la barra de direcciones, asi que
    // no se cuela un `?` pelado que cambiaria la cadena del destino.
    expect(empujar).toHaveBeenCalledWith(`/${SLUG}/login?volverA=${encodeURIComponent(RUTA)}`);
  });
});

// ---------------------------------------------------------------------------
// Las dos pantallas que se parecen y no son la misma
// ---------------------------------------------------------------------------

describe('cuando no hay lista', () => {
  /**
   * UNA CLASE VACIA NO ES UN FALLO AL LEER, Y LA CONFUSION ES CARA EN LAS DOS
   * DIRECCIONES.
   *
   * Un 404 dibujado como «no hay nadie anotado» le dice a la profesora que no
   * tiene lista que pasar y se va. Y una clase de verdad vacia dibujada como un
   * error la manda a reintentar una pregunta que ya se contesto.
   */
  it('una clase sin anotados se distingue de un fallo al leer', async () => {
    await montarYEsperar({ lista: [] });

    expect(document.querySelector('[data-sin-anotados]')).not.toBeNull();
    expect(document.querySelector('[data-fallo-al-leer]')).toBeNull();
    // Y NO SE OFRECE GUARDAR: mandar `presentes: []` de una clase sin nadie
    // anotado no marca a nadie, asi que seria un boton que no hace nada.
    expect(screen.queryByRole('button', { name: 'Guardar la lista' })).toBeNull();
    expect(document.querySelector('[data-bloque="lista"]')).toBeNull();

    cleanup();
    vi.clearAllMocks();

    const motivo = 'No tenes ninguna clase con ese id';
    await montarYEsperar({ errorAlLeer: new ErrorDeApi(motivo, 404) });

    expect(document.querySelector('[data-fallo-al-leer]')).not.toBeNull();
    expect(document.querySelector('[data-sin-anotados]')).toBeNull();
    expect(textoDe(document.querySelector('[data-fallo-al-leer] [role="alert"]'))).toBe(
      `No se pudo leer la lista: ${motivo}`,
    );
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    // Ni una casilla se pinta sobre un error: no hay nada que tildar.
    expect(filas()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Lo que no se enseña de cada persona
// ---------------------------------------------------------------------------

describe('de cada alumno solo se enseña su nombre', () => {
  /**
   * `AlumnoEnClase` ES DELIBERADAMENTE ESCUETO —`perfilId`, `nombreCompleto` y
   * `asistio`— Y EL CONTRATO DICE POR QUE: desde la Fase 1 la ficha medica
   * solo la ven ADMIN_SALON o la propia persona, y el telefono tampoco es de
   * este rol.
   *
   * Se afirma sobre el MARCADO y con igualdad exacta: el texto de cada fila es
   * EL NOMBRE Y NADA MAS. Un `not.toContain('telefono')` no mediria nada —el
   * dato llegaria sin esa palabra al lado— y en cambio cualquier cosa que se
   * agregue a la fila rompe esta igualdad.
   */
  it('ni el telefono ni la ficha medica aparecen', async () => {
    await montarYEsperar({ lista: LISTA_YA_PASADA });

    // El control del caso ciego: hay tres filas y dicen algo.
    expect(filas()).toHaveLength(3);

    for (const alumno of LISTA_YA_PASADA) {
      expect(textoDe(filaDe(alumno.perfilId)), alumno.perfilId).toBe(alumno.nombreCompleto);
    }
  });

  /**
   * NO EXISTE NINGUNA FICHA PARA ESTE ROL: las rutas de usuarios piden
   * `ADMIN_OPERATIVO` como minimo, asi que ofrecerle un enlace a la profesora
   * seria ofrecerle un 403 con el nombre de la persona dentro de la URL.
   *
   * Se afirma sobre el CONJUNTO de enlaces y no sobre un `href` concreto: una
   * ficha puede colgar de cualquier ruta, y lo que se fija es que esta pantalla
   * no navega a ningun sitio. (Tampoco hay un «volver»: el que vuelve es el
   * boton de atras, que es el unico que devuelve la agenda con el rango que
   * tenia.)
   */
  it('no enlaza a ninguna ficha de alumno', async () => {
    await montarYEsperar({ lista: LISTA_YA_PASADA });

    expect(filas()).toHaveLength(3);
    expect([...document.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([]);

    // Y ningun atributo que navegue lleva un perfilId: un `data-alumno` es un
    // gancho del marcado, un `href` es una puerta.
    const destinos = [...document.querySelectorAll('[href], [src], [action]')].flatMap((nodo) =>
      ['href', 'src', 'action'].map((atributo) => nodo.getAttribute(atributo) ?? ''),
    );
    for (const alumno of LISTA_YA_PASADA) {
      for (const destino of destinos) {
        expect(destino, alumno.perfilId).not.toContain(alumno.perfilId);
      }
    }
  });

  /**
   * ===========================================================================
   * EL HUECO ENTRE LAS DOS DEFENSAS, Y NO ES TEORICO: ESTA MEDIDO.
   * ===========================================================================
   *
   * Este repo audita lo que una pantalla publica con DOS instrumentos que se
   * reparten el mundo: los CANALES globales miran todo lo que NO es el
   * `<body>`, y los tests de pantalla miran el `<body>` — leyendo
   * `document.body.innerHTML` y `textContent`, que es lo que hacen el de la
   * agenda y los dos de aqui arriba.
   *
   * **ENTRE LOS DOS SE CUELA TODO LO QUE EL MARCADO NO SERIALIZA.** El `value`
   * de un control en «modo valor» —el tipo por defecto, `text`, `password` y
   * los demas que se teclean— y el de un `<textarea>` son una PROPIEDAD del
   * nodo que NO se refleja al atributo: `nodo.value = x` no aparece en el
   * `innerHTML` de nadie ni en ningun `textContent`, y aun asi esta en la
   * pagina, se pinta, se autocompleta, viaja en un envio de formulario y lo
   * lee cualquier extension. Un shadow root —aunque sea abierto— es la otra
   * mitad del mismo agujero.
   *
   * LA MUTACION QUE LO DESCUBRIO, medida sobre esta pantalla:
   *
   *     const caja = useRef<HTMLInputElement>(null);
   *     useEffect(() => {
   *       // «un respaldo por si se recarga la pestaña a mitad del repaso»
   *       if (caja.current !== null) caja.current.value = JSON.stringify(alumnos);
   *     }, [alumnos]);
   *     …
   *     <input type="text" readOnly ref={caja} />
   *
   * donde `alumnos` lleva el nombre propio, el `perfilId` y la ausencia de cada
   * persona de la clase. **Sobrevivio los tests del paquete entero**, con los
   * canales, los ejes y el alfabeto de centinelas enchufados. No lo vio nadie:
   * no es consola, no es almacen, no es red, no es `location`, no toca el
   * `<html>` ni el `<body>`, y los tres tests de esta pantalla que miran el
   * marcado leen texto que no lo contiene.
   *
   * ⚠️ CORRECCION MEDIDA, Y VA AQUI PARA QUE NO SE PIERDA: la primera version
   * de esta mutacion usaba `<input type="hidden">` y ESA NO SE ESCAPA. El tipo
   * `hidden` no esta en «modo valor» sino en MODO DEFECTO, donde el `.value`
   * es un REFLEJO del atributo: asignarlo lo escribe y el dato sale entero en
   * el `innerHTML`. Medido aplicando esa misma mutacion a la agenda
   * —`(profesor)/mis-clases/page.tsx`—: el test «ni un nombre ni un perfilId
   * de los alumnos llega al marcado» CAE, y el informe imprime el
   * `value="[{&quot;perfilId&quot;…"` entero. Con `type="text"` o con
   * `<textarea>`, los 20 tests de la agenda pasan. Los tipos medidos uno a uno
   * estan en `src/test/lo-que-el-marcado-no-serializa.spec.ts`.
   *
   * EL CONTROL QUE PRUEBA QUE EL INSTRUMENTO FUNCIONABA: la MISMA cadena, en la
   * MISMA linea, escrita con `console.info(JSON.stringify(alumnos))` hace caer
   * 11 de los 14 tests de este archivo con «la consola dijo
   * laQueVinoYLoRegistro». Lo unico que cambiaba entre caer y no caer era EL
   * SITIO donde se escribia el dato.
   *
   * ⚠️ Y NO SE AFIRMA «no hay centinelas en la pantalla», que seria falso: esta
   * pantalla PINTA los nombres, que es su trabajo. Lo que se afirma es que no
   * hay ninguno ESCONDIDO: el dato puede estar a la vista, no agazapado donde
   * no mira ningun instrumento.
   *
   * ---------------------------------------------------------------------------
   * ESTO YA ES EL DECIMOQUINTO CANAL GLOBAL, Y ESTE TEST SE QUEDA IGUAL. POR QUE.
   *
   * El agujero se subio a `vigilarLosCanalesDeSalida()`, asi que lo de aqui
   * corre ahora en los 1665 tests de los 77 archivos y ademas por el ALFABETO
   * entero —en claro, %-codificado y en base64 con sus tres desplazamientos—,
   * que es mas de lo que este test mira. Lo normal seria borrarlo.
   *
   * SE QUEDA PORQUE AFIRMA DOS COSAS QUE EL CANAL GLOBAL NO PUEDE AFIRMAR:
   *
   * 1. LA FORMA ESTRICTA, SIN LA RESTA. El canal global solo acusa un
   *    centinela que NO este tambien en el marcado, y tiene que ser asi: media
   *    docena de pantallas del panel pintan `<input value={nombre}>` a
   *    proposito. Aqui no hay ninguna, asi que se puede exigir lo de verdad:
   *    NINGUN centinela en un sitio no serializado, lo pinte la pantalla o no.
   *    Si mañana alguien mete un nombre en un `.value` escondido, el canal
   *    global lo restaria —el nombre esta pintado en la fila— y este no.
   *
   * 2. EL CONTROL DEL CASO CIEGO. El canal global no puede exigir que haya
   *    sitios que mirar: casi todas las pantallas no tienen ninguno y seria
   *    rojo en medio paquete. Aqui si los hay —las tres casillas— y sin esta
   *    linea el test pasaria en verde sobre una pantalla vacia.
   *
   * Y EL INFORME YA NO PUBLICA EL VOLCADO. Antes era un `not.toContain`, que
   * imprime el dato: `expected '[{\"perfilId\":\"perfil-ana-que-vino-lis…' not to
   * contain …`. Un fallo de una defensa contra fugas que filtra el dato al
   * registro de CI es, el mismo, una fuga. Se afirma como el tapon global: un
   * booleano, y en el mensaje el NOMBRE del dato y nada mas.
   */
  it('ningun dato viaja en un sitio del marcado que no se serializa', async () => {
    await montarYEsperar({ lista: LISTA_YA_PASADA });

    const escondites = loQueElMarcadoNoSerializa();

    // EL CONTROL DEL CASO CIEGO: hay sitios de verdad que mirar —las tres
    // casillas tienen `.value`— asi que una pantalla vacia no pasa por aqui.
    expect(escondites.length).toBeGreaterThanOrEqual(filas().length);
    expect(filas()).toHaveLength(3);

    for (const [nombre, centinela] of Object.entries(CENTINELAS)) {
      for (const escondite of escondites) {
        expect(escondite.includes(centinela), `un sitio no serializado esconde ${nombre}`).toBe(
          false,
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Lo que se dice antes de tocar nada
// ---------------------------------------------------------------------------

describe('la pantalla explica el reemplazo total antes de que muerda', () => {
  it('dice, con palabras, que guardar reescribe la clase entera', async () => {
    // Igualdad exacta sobre el texto entero y no un `toContain('reemplaza')`:
    // con una subcadena, borrar la mitad de la frase —justo la que explica que
    // los presentes llegan tildados— seguiria pasando.
    await montarYEsperar({ lista: LISTA_CON_QR });

    expect(textoDe(document.querySelector('[data-como-funciona]'))).toBe(
      'Lo que guardes reemplaza la lista entera: quien no quede tildado queda marcado como ' +
        'ausente. Por eso llegan ya tildados los que figuran como presentes, incluidos los que ' +
        'se marcaron solos escaneando el QR al entrar. Podes guardar las veces que haga falta, ' +
        'pero cada vez se reescribe la clase completa, nunca una sola persona.',
    );
  });

  it('pide la lista de ESTA clase, una vez, y nada mas', async () => {
    await montarYEsperar({ lista: LISTA_CON_QR });

    // La agenda NO se pide: esta pantalla no necesita el nombre de la clase y
    // no se inventa un rango para ir a buscarlo.
    expect(rutasPedidas()).toEqual([`/mis-clases/${TURNO}/alumnos`]);
  });
});
