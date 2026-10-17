import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  ReporteTurnosLibres,
  SalaPublica,
  TurnoLibre,
  UsuarioDetalle,
} from '@boxadmin/shared';
import { ErrorDeApi } from '@/lib/cliente';
import { vigilarEstosDatos } from '@/test/espia-de-consola';
import {
  BloqueDeTurnosLibres,
  DE_HOY_EN_ADELANTE,
  NO_HAY_DONDE_METERLA,
  NO_TIENE_ESTA_SALA,
} from './bloque-turnos-libres';

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
 * El `tenantId` es el dato que la Fase 0 se ocupo de que no cruzara entre
 * gimnasios y viaja dentro de cada sala que este bloque recibe. El nombre de la
 * persona lo pinta el bloque en su propia frase. Y el `turnoId`, que es lo que
 * esta tarea agrega: va en el `href` de cada fila y es la clave con la que se
 * cruzan las reservas de un gimnasio.
 */
const CENTINELAS = {
  tenantIdDelGimnasio: 'tnt-centinela',
  nombreDeLaPersona: 'Ana-Centinela Perez',
  idDelPrimerTurno: 'turno-centinela-1',
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
 * Que `pedir` arme bien la URL ya lo fija `use-stats.spec`. Lo que se audita
 * aqui es un escalon mas arriba: QUE pide este bloque —con que query, y
 * cuando— y que hace con lo que vuelve. `ErrorDeApi` se deja REAL porque el
 * bloque ramifica con `instanceof` en otros sitios del panel y el mensaje sale
 * de la instancia.
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

function unaSala(id: string, nombre: string): SalaPublica {
  return {
    id,
    tenantId: CENTINELAS.tenantIdDelGimnasio,
    nombre,
    activa: true,
    visibleAlumnos: true,
    soloCuposLiberados: false,
    exclusiva: false,
    cupoBase: null,
    minMinutosCancelar: null,
    minMinutosAnotarse: null,
    listaEsperaHabilitada: null,
  };
}

const SALA_SUYA = unaSala('sala-a', 'Pilates');
const SALA_AJENA = unaSala('sala-b', 'Funcional');

/**
 * LA PERSONA TIENE UNA SOLA SALA, Y LA OTRA EXISTE EN EL GIMNASIO.
 *
 * Con las dos salas asignadas, «se marca la sala a la que no tiene acceso» y
 * «no se marca nunca nada» serian la misma afirmacion.
 */
function laPersona(cambios: Partial<UsuarioDetalle> = {}): UsuarioDetalle {
  return {
    id: 'u1',
    tenantId: CENTINELAS.tenantIdDelGimnasio,
    nombreCompleto: CENTINELAS.nombreDeLaPersona,
    email: 'ana@gym.test',
    rol: 'ALUMNO',
    activo: true,
    perfilId: 'p1',
    telefono: null,
    packId: null,
    pagoAlDia: true,
    salaIds: [SALA_SUYA.id],
    clasesExtra: 0,
    cancelacionesUsadas: 0,
    vigenciaDesde: null,
    vigenciaHasta: null,
    pack: null,
    salas: [SALA_SUYA],
    ...cambios,
  };
}

/**
 * TRES TURNOS, Y CADA UNO ESTA POR UN MOTIVO. DOS CON LUGAR COMO MINIMO.
 *
 * Con UNO solo con lugar, «la fila de ESE turno dice lo suyo» y «todas las
 * filas dicen lo de la primera» son la MISMA afirmacion y el test no puede
 * fallar: es la tercera forma, montar el test en el caso ciego.
 *
 * EL CAMPO DERIVADO VA DESALINEADO, que es la quinta forma y va por el lado de
 * la ENTRADA. `TurnoLibre` trae `cupo`, `reservados` y `libres`, y el service
 * calcula el tercero como `cupo - reservados`. Con un fijo coherente, «se pinta
 * `libres`» y «se pinta `cupo - reservados`» darian el MISMO numero y ninguna
 * asercion de encima podria distinguirlos. En `MARTES_18` los dos caminos dan
 * resultados distintos a proposito: `libres` es 2 y la resta da 3.
 *
 * PERO EL FIJO SIGUE SIENDO POSIBLE EN TODO LO DEMAS, que es la otra mitad de
 * la regla. Se verifico leyendo `StatsService.calcularTurnosLibres`:
 *
 * - LOS TRES CAMPOS SON NUMEROS COHERENTES CON UN TURNO REAL: `reservados`
 *   nunca pasa del `cupo` en estos fijos, y `libres` es positivo en los dos que
 *   tienen lugar.
 * - `salaNombre` SIEMPRE ESTA. El service lo resuelve contra el catalogo y
 *   deja escrito que una sala fuera del catalogo es imposible: `Turno.salaId`
 *   es una FK compuesta obligatoria.
 * - Y VIENEN ORDENADOS POR AGENDA (`porAgenda`), o sea por fecha y hora.
 */

/** El desalineado: `libres` es 2 aunque `cupo - reservados` de 3. */
const MARTES_18: TurnoLibre = {
  turnoId: CENTINELAS.idDelPrimerTurno,
  salaId: SALA_SUYA.id,
  salaNombre: SALA_SUYA.nombre,
  fecha: '2026-10-20',
  horaInicio: '18:00',
  horaFin: '19:00',
  cupo: 10,
  reservados: 7,
  libres: 2,
};

/** El de la sala que esta persona NO tiene. Alineado: el otro ya desalinea. */
const JUEVES_09: TurnoLibre = {
  turnoId: 'turno-2',
  salaId: SALA_AJENA.id,
  salaNombre: SALA_AJENA.nombre,
  fecha: '2026-10-22',
  horaInicio: '09:00',
  horaFin: '10:00',
  cupo: 6,
  reservados: 5,
  libres: 1,
};

/**
 * EL QUE NO TIENE LUGAR.
 *
 * El service ya los descarta —`if (turno.cupo - reservados <= 0) continue`—,
 * asi que este fijo siembra algo que la API de hoy no manda. Es a proposito y
 * no es una respuesta imposible: lo que se fija es que la pantalla no PINTA un
 * «quedan 0 lugares» debajo de un titulo que dice donde hay lugar, venga de
 * donde venga. Entre la respuesta y la pantalla hay un cache de cinco minutos
 * y un contrato que esta fase no controla.
 */
const VIERNES_LLENO: TurnoLibre = {
  turnoId: 'turno-lleno',
  salaId: SALA_SUYA.id,
  salaNombre: SALA_SUYA.nombre,
  fecha: '2026-10-23',
  horaInicio: '20:00',
  horaFin: '21:00',
  cupo: 8,
  reservados: 8,
  libres: 0,
};

const LOS_TRES = [MARTES_18, JUEVES_09, VIERNES_LLENO];

/** El tope real, leido en `stats.service.ts`: `MAX_MESES_ADELANTE = 12`. */
const TOPE_DE_MESES = 12;

/** El que la pantalla pide si nadie lo toca, igual que el del service. */
const MESES_POR_DEFECTO = 3;

// ---------------------------------------------------------------------------
// El servidor de mentira
// ---------------------------------------------------------------------------

interface OpcionesDeMontaje {
  turnos?: TurnoLibre[];
  usuario?: UsuarioDetalle;
  /** Lo que falla al LEER el reporte. */
  error?: unknown;
}

/** Las rutas pedidas, en orden y SIN DEDUPLICAR: una lectura repetida se ve. */
function rutasPedidas(): string[] {
  return pedirEspia.mock.calls.map(([ruta]) => ruta as string);
}

/**
 * EL RECORTE LO HACE EL DOBLE, COMO LO HARIA EL SERVICE.
 *
 * `Math.min(pedido, 12)`, que es literalmente lo que hace
 * `StatsService.turnosLibres`. Escribir «pedi 24 y me devolvio 1» seria sembrar
 * una respuesta que la API no puede dar: la segunda forma de que un test no
 * pueda fallar, con la premisa destruida desde la entrada. Y devolver siempre
 * lo pedido tampoco sirve: con pedido y devuelto iguales, «se pinta el
 * devuelto» y «se pinta el pedido» no se distinguen.
 *
 * Tambien filtra por `salaId`, como el service, para que elegir una sala tenga
 * una consecuencia visible ademas de la ruta.
 */
function contestarComoElService(ruta: string, turnos: TurnoLibre[]): ReporteTurnosLibres {
  const query = new URLSearchParams(ruta.slice(ruta.indexOf('?') + 1));
  const pedidos = query.get('mesesAdelante');
  const sala = query.get('salaId');

  return {
    mesesAdelante: Math.min(pedidos === null ? MESES_POR_DEFECTO : Number(pedidos), TOPE_DE_MESES),
    turnos: sala === null ? turnos : turnos.filter((turno) => turno.salaId === sala),
  };
}

function prepararServidor(opciones: OpcionesDeMontaje): QueryClient {
  const turnos = opciones.turnos ?? LOS_TRES;

  pedirEspia.mockImplementation((ruta: string) => {
    if (opciones.error !== undefined) return Promise.reject(opciones.error);
    return Promise.resolve(contestarComoElService(ruta, turnos));
  });

  // `staleTime: Infinity` para que una clave ya pedida no se vuelva a pedir:
  // asi la lista de rutas cuenta peticiones de verdad y no refrescos.
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
}

/** Deja que las consultas se resuelvan y que React pinte. */
async function esperar(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Monta el bloque CERRADO, que es como nace. */
function montar(opciones: OpcionesDeMontaje = {}): void {
  const cliente = prepararServidor(opciones);

  render(
    <QueryClientProvider client={cliente}>
      <BloqueDeTurnosLibres usuario={opciones.usuario ?? laPersona()} />
    </QueryClientProvider>,
  );
}

/** Monta y lo ABRE, que es cuando el reporte se pide. */
async function abrir(opciones: OpcionesDeMontaje = {}): Promise<void> {
  montar(opciones);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Buscar donde hay lugar' }));
  await esperar();
}

// ---------------------------------------------------------------------------
// Como se mira una fila
// ---------------------------------------------------------------------------

/**
 * La fila de UN turno, encontrada por su `turnoId` y no por su texto ni por su
 * posicion. Buscar por texto ata el test a la ortografia; por indice, al orden.
 */
function filaDe(turnoId: string): HTMLElement {
  const marca = document.querySelector(`[data-turno="${turnoId}"]`);
  const fila = marca === null ? null : marca.closest('tr');
  if (fila === null) throw new Error(`No hay ninguna fila del turno ${turnoId}`);
  return fila as HTMLElement;
}

/**
 * El contenido de una celda marcada, POR IGUALDAD EXACTA.
 *
 * Devuelve el texto para que las aserciones sean `toBe` y no `toContain`: «1»
 * esta dentro de «11» y «2» dentro de «12», y un `toContain` pasaria en verde
 * sobre el numero equivocado. Es la cuarta forma de que un test no pueda
 * fallar, la casualidad ortografica.
 */
function celda(fila: HTMLElement, atributo: string): string {
  return fila.querySelector(`[${atributo}]`)?.textContent ?? '';
}

/** Los turnos que hay en pantalla, por id y en el orden en que se pintaron. */
function turnosEnPantalla(): string[] {
  return [...document.querySelectorAll('[data-turno]')].map(
    (nodo) => nodo.getAttribute('data-turno') ?? '',
  );
}

/** El numero que la pantalla dice haber mirado, tal cual esta en el DOM. */
function mesesMirados(): string {
  return document.querySelector('[data-meses-mirados]')?.textContent ?? '';
}

// ---------------------------------------------------------------------------
// Cuando se pide el reporte
// ---------------------------------------------------------------------------

describe('cuando se pide el reporte', () => {
  /**
   * LAS DOS MITADES. Sin la segunda, esto pasaria tambien si el reporte no se
   * pidiera jamas — que es justo lo que no se quiere comprobar.
   *
   * Importa porque de esto depende que `PETICIONES_AL_ABRIR_LA_FICHA`, la
   * lista blanca de la ficha entera, siga teniendo cinco entradas: la ficha se
   * abre todo el dia para cambiar un telefono, y este reporte recorre los
   * turnos de tres meses con sus reservas.
   */
  it('NO se pide al montar la ficha, y SI al abrirlo', async () => {
    montar();
    await esperar();

    expect(rutasPedidas()).toEqual([]);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Buscar donde hay lugar' }));
    await esperar();

    expect(rutasPedidas()).toEqual(['/stats/turnos-libres?mesesAdelante=3']);
  });

  /**
   * EL FILTRO DE SALA VIAJA, Y VACIO NO SE MANDA.
   *
   * `?salaId=` no es «todas las salas» para la API: es un id vacio contra el
   * `@Matches(PATRON_ID)` del DTO, o sea un 400 pintado como una averia. La
   * primera peticion sale con el selector en «Todas las salas del gimnasio» y
   * no lleva la clave; la segunda, con una sala elegida, si.
   */
  it('el filtro de sala viaja, y vacio NO se manda', async () => {
    await abrir();

    expect(rutasPedidas()).toEqual(['/stats/turnos-libres?mesesAdelante=3']);

    await userEvent.setup().selectOptions(screen.getByLabelText('Sala'), SALA_SUYA.id);
    await esperar();

    expect(rutasPedidas()).toEqual([
      '/stats/turnos-libres?mesesAdelante=3',
      '/stats/turnos-libres?salaId=sala-a&mesesAdelante=3',
    ]);

    // Y la otra mitad, que es la que mata la mutacion: NINGUNA peticion de
    // ninguno de los dos momentos llevo la clave vacia.
    expect(rutasPedidas().filter((ruta) => /[?&]salaId=(&|$)/.test(ruta))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Los meses
// ---------------------------------------------------------------------------

describe('los meses que se miraron', () => {
  /**
   * `mesesAdelante` VUELVE YA RECORTADO: pedir 24 devuelve 12. Sin esto, quien
   * pidio dos anos lee una lista corta como «no hay mas turnos» en vez de como
   * «no miramos mas alla».
   *
   * Pedido y devuelto se siembran DISTINTOS a proposito: con los dos iguales,
   * pintar uno u otro da el mismo resultado y no se distingue nada.
   */
  it('muestra los meses QUE SE MIRARON, no los que se pidieron', async () => {
    await abrir();

    await userEvent.setup().selectOptions(screen.getByLabelText('Meses a mirar'), '24');
    await esperar();

    // Lo que se PIDIO fue 24: esta en la ruta, no en la pantalla.
    expect(rutasPedidas()).toContain('/stats/turnos-libres?mesesAdelante=24');

    // Y lo que se MIRO fue 12, por igualdad exacta: «12» esta dentro de «24»
    // por ningun lado, pero «2» si, y un `toContain` sobre el texto entero
    // pasaria en verde con cualquiera de los dos.
    expect(mesesMirados()).toBe(String(TOPE_DE_MESES));
    expect(mesesMirados()).not.toBe('24');
  });

  /** La otra mitad: el recorte se dice con palabras, no solo con un numero. */
  it('cuando se recorta, lo dice: pediste 24 y se miraron 12', async () => {
    await abrir();

    await userEvent.setup().selectOptions(screen.getByLabelText('Meses a mirar'), '24');
    await esperar();

    const recorte = document.querySelector('[data-recorte]')?.textContent ?? '';
    expect(recorte).toContain('24');
    expect(recorte).toContain('12');
  });

  /**
   * Y NO SE AVISA DE UN RECORTE QUE NO HUBO.
   *
   * Sin esto, un `data-recorte` pintado siempre pasaria el test de arriba y le
   * diria a quien pidio tres meses que le recortamos algo.
   */
  it('sin recorte no hay aviso de recorte', async () => {
    await abrir();

    expect(mesesMirados()).toBe(String(MESES_POR_DEFECTO));
    expect(document.querySelector('[data-recorte]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Las filas
// ---------------------------------------------------------------------------

describe('los turnos con lugar', () => {
  it('cada turno dice su sala, su fecha y cuantos lugares quedan', async () => {
    await abrir();

    const martes = filaDe(MARTES_18.turnoId);
    expect(celda(martes, 'data-sala')).toBe('Pilates');
    expect(celda(martes, 'data-fecha')).toBe('2026-10-20');
    expect(celda(martes, 'data-hora')).toBe('18:00 a 19:00');
    expect(celda(martes, 'data-libres')).toBe('2');

    // El segundo, que es lo que distingue «el de esa fila» de «el primero».
    const jueves = filaDe(JUEVES_09.turnoId);
    expect(celda(jueves, 'data-sala')).toBe('Funcional');
    expect(celda(jueves, 'data-fecha')).toBe('2026-10-22');
    expect(celda(jueves, 'data-hora')).toBe('09:00 a 10:00');
    expect(celda(jueves, 'data-libres')).toBe('1');
  });

  /**
   * `libres` LO MANDA EL SERVIDOR Y NO SE RECALCULA.
   *
   * El fijo esta desalineado a proposito: `cupo - reservados` da 3 y `libres`
   * es 2. El dia que las dos cuentas difieran de verdad —un cupo bajado, un
   * cambio en que reservas cuentan como vivas— una pantalla que reste estaria
   * inventando un numero con cara de exactitud. La ocupacion, en cambio, SI
   * sale de los dos campos crudos: son los que el servidor manda.
   */
  it('los lugares que quedan salen de `libres`, no de `cupo - reservados`', async () => {
    await abrir();

    const martes = filaDe(MARTES_18.turnoId);

    expect(celda(martes, 'data-libres')).toBe('2');
    expect(celda(martes, 'data-libres')).not.toBe('3');
    expect(celda(martes, 'data-ocupacion')).toBe('7/10');
  });

  it('un turno sin lugar no aparece', async () => {
    await abrir();

    expect(turnosEnPantalla()).toEqual([MARTES_18.turnoId, JUEVES_09.turnoId]);
    expect(turnosEnPantalla()).not.toContain(VIERNES_LLENO.turnoId);
  });

  /**
   * LA SALA AJENA SE MARCA Y NO SE ESCONDE. Escondiendola, «no hay lugar en
   * ningun lado» y «hay lugar pero antes hay que darle la sala» se leerian
   * igual, y la segunda se arregla dos bloques mas arriba en esta misma ficha.
   */
  it('se marca el turno de una sala que esta persona no tiene', async () => {
    await abrir();

    const jueves = filaDe(JUEVES_09.turnoId);
    expect(celda(jueves, 'data-sala-ajena')).toBe(NO_TIENE_ESTA_SALA);

    // Y no se marca el de la sala que SI tiene: sin esto, marcarlas todas
    // pasaria el test.
    expect(filaDe(MARTES_18.turnoId).querySelector('[data-sala-ajena]')).toBeNull();
  });

  /**
   * CADA FILA LLEVA A LA FICHA DE SU TURNO, con el `turnoId` tal cual.
   *
   * Al reves que en la lista de a quien llamar de la portada, aqui el
   * identificador del reporte ES el que abre la ficha: `admin/turnos/[id]` se
   * lo pasa a `useTurno` → `GET /turnos/:id`. Los dos turnos sembrados tienen
   * ids distintos, que es lo unico que distingue «el de esa fila» de «el de la
   * primera».
   */
  it('cada fila lleva a la ficha de SU turno', async () => {
    await abrir();

    expect(filaDe(MARTES_18.turnoId).querySelector('a')?.getAttribute('href')).toBe(
      `/mi-gym/admin/turnos/${MARTES_18.turnoId}`,
    );
    expect(filaDe(JUEVES_09.turnoId).querySelector('a')?.getAttribute('href')).toBe(
      '/mi-gym/admin/turnos/turno-2',
    );
  });
});

// ---------------------------------------------------------------------------
// Vacio y fallo
// ---------------------------------------------------------------------------

describe('vacio y fallo no se parecen', () => {
  /**
   * «No hay donde meterla» y «no pude preguntar» llevan a decisiones opuestas:
   * la primera cierra la conversacion con el alumno y la segunda obliga a
   * volver a mirar. Un 500 dibujado como una tabla sin filas diria la primera.
   */
  it('ninguna lista vacia se confunde con un fallo al leer', async () => {
    // LOS DOS CASOS EN EL MISMO TEST, y es a proposito: lo que se afirma no es
    // como se ve cada uno sino que NO SE VEN IGUAL. Repartidos en dos tests,
    // una pantalla que dibujara el fallo como una lista vacia seguiria pasando
    // el primero, que es justo la mitad que no importa.
    await abrir({ turnos: [] });

    expect(document.querySelector('[data-sin-turnos]')).not.toBeNull();
    expect(screen.getByText(NO_HAY_DONDE_METERLA)).toBeInTheDocument();
    expect(document.querySelector('[data-fallo-al-leer]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull();

    // `cleanup` a mano para montar el segundo caso: el del `afterEach` global
    // todavia no corrio. Es idempotente, asi que no le quita nada al tapon.
    cleanup();

    await abrir({ error: new ErrorDeApi('La base no contesta', 500) });

    expect(document.querySelector('[data-fallo-al-leer]')).not.toBeNull();
    expect(screen.getByText(/La base no contesta/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();

    // Y NO se pinta ni la lista vacia ni una tabla: el fallo no es un cero.
    expect(document.querySelector('[data-sin-turnos]')).toBeNull();
    expect(screen.queryByText(NO_HAY_DONDE_METERLA)).toBeNull();
    expect(turnosEnPantalla()).toEqual([]);
  });

  /**
   * LA FRASE QUE EXPLICA LA LISTA NO DEPENDE DE QUE LA LISTA LLEGUE.
   *
   * «Son los turnos de hoy en adelante» es lo que convierte una lista sin el
   * martes pasado en el limite de la pregunta y no en un hueco del gimnasio.
   * Se lee tambien cuando el reporte falla.
   */
  it('de cuando es la lista se dice tambien cuando falla', async () => {
    await abrir({ error: new ErrorDeApi('La base no contesta', 500) });

    expect(screen.getByText(DE_HOY_EN_ADELANTE)).toBeInTheDocument();
  });
});
