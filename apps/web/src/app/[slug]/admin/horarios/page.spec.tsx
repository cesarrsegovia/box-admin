import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  HorarioProfesorPublico,
  RolUsuario,
  SalaPublica,
  UsuarioResumen,
} from '@boxadmin/shared';
import { ErrorDeApi } from '@/lib/cliente';
import { clavesDeCatalogos } from '@/hooks/use-catalogos';
import { clavesDeUsuarios } from '@/hooks/use-usuarios';
import { clavesDeHorarios } from '@/hooks/use-horarios';
import { vigilarEstosDatos } from '@/test/espia-de-consola';
import { ProveedorDeRol } from '../rol-del-panel';
import PaginaDeHorarios from './page';
// Los filtros viven fuera de `page.tsx`: Next 15 no deja exportar nada mas
// que el `default` desde una pagina. Ver el comentario de `filtros.ts`.
import { filtrosDeLaBusqueda } from './filtros';

/**
 * LO QUE ESTA PANTALLA SIEMBRA Y NO PUEDE ESCAPARSE POR LOS CANALES QUE NO SON
 * EL DOM.
 *
 * Aqui hay DINERO y hay NOMBRES, que es lo que la distingue del resto de la
 * fase: `tarifaPorHora` es lo que el gimnasio le paga a cada profesora por
 * hora, y `profesorNombre` viaja resuelto en cada fila. Un
 * `console.table(horarios)` publica la nomina entera en la consola de la
 * maquina del mostrador, que usan cuatro personas por turno. El `tenantId` va
 * dentro de cada `SalaPublica` y de cada `UsuarioResumen` del catalogo.
 *
 * El tapon global de `vitest.setup.ts` vigila los tres canales —consola,
 * titulo y nombre de la pestaña— en TODOS los tests de este archivo.
 */
const CENTINELAS = {
  tenantIdDelGimnasio: 'tnt-centinela',
  nombreDeLaProfesora: 'Ana Centinela Perez',
  tarifaDeLaProfesora: '1777.77',
};

vigilarEstosDatos(CENTINELAS);

/**
 * LOS TRES CHOQUES, COPIADOS DEL SERVICIO.
 *
 * Verificados contra `exigirSinSolape` en
 * `apps/api/src/horarios-profesor/horarios-profesor.service.ts`. Son los textos
 * que VIAJAN, no el comentario del codigo: el comentario explica, el texto es
 * lo que el admin lee para saber QUE cambiar.
 *
 * No se afirma con una expresion laxa tipo `/se pisa/i`: una asercion asi la
 * pasa igual un mensaje generico, que es exactamente el fallo que estos tres
 * tests existen para cazar.
 */
const CHOQUE_OTRA_PROFESORA_EN_LA_SALA =
  'Ya hay otra profesora asignada a esa sala en ese dia y hora. ' +
  'Un turno tiene una sola profesora, asi que dos horarios que se pisan ' +
  'no se pueden resolver.';

const CHOQUE_LA_MISMA_EN_OTRA_SALA =
  'Esa profesora ya esta asignada a otra sala a esa hora, y no puede estar ' +
  'en dos salas a la vez.';

const CHOQUE_EL_MISMO_HORARIO = 'Esa profesora ya tiene ese horario en esa sala';

const { empujar, pedirEspia, busqueda } = vi.hoisted(() => ({
  empujar: vi.fn(),
  pedirEspia: vi.fn(),
  busqueda: { valor: '' },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: empujar, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({ slug: 'mi-gym' }),
  useSearchParams: () => new URLSearchParams(busqueda.valor),
  usePathname: () => '/mi-gym/admin/horarios',
}));

/**
 * Se dobla `pedir`, no `fetch`.
 *
 * Que `pedir` arme bien la URL ya lo fija `use-horarios.spec`. Lo que se audita
 * aqui es un escalon mas arriba: QUE pide la pantalla y QUE cuerpo manda.
 * `ErrorDeApi` se deja REAL porque la pagina ramifica con `instanceof`.
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

function unHorario(cambios: Partial<HorarioProfesorPublico> = {}): HorarioProfesorPublico {
  return {
    id: 'h1',
    profesorId: 'perf-1',
    profesorNombre: CENTINELAS.nombreDeLaProfesora,
    salaId: 's1',
    salaNombre: 'Sala Principal',
    diaSemana: 1,
    horaInicio: '18:00',
    horaFin: '19:00',
    activo: true,
    desde: '2026-11-01',
    hasta: null,
    tarifaPorHora: CENTINELAS.tarifaDeLaProfesora,
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

function unaProfesora(cambios: Partial<UsuarioResumen> = {}): UsuarioResumen {
  return {
    id: 'u1',
    tenantId: CENTINELAS.tenantIdDelGimnasio,
    nombreCompleto: CENTINELAS.nombreDeLaProfesora,
    email: 'ana@gimnasio.test',
    rol: 'PROFESOR',
    activo: true,
    // `profesorId` en un horario es el `perfilId`, NO el id del usuario: el
    // modelo relaciona `profesor Perfil @relation(fields: [tenantId,
    // profesorId])` y el service lo busca con `perfil.findFirst`.
    perfilId: 'perf-1',
    telefono: null,
    packId: null,
    pagoAlDia: true,
    salaIds: ['s1'],
    ...cambios,
  };
}

// ---------------------------------------------------------------------------
// Andamiaje
// ---------------------------------------------------------------------------

interface OpcionesDeMontaje {
  horarios?: HorarioProfesorPublico[];
  salas?: SalaPublica[];
  profesoras?: UsuarioResumen[];
  /** Lo que falla al LEER la lista de horarios. */
  error?: unknown;
  /** Lo que falla al ESCRIBIR (POST, PATCH, DELETE). */
  errorAlEscribir?: unknown;
  rol?: RolUsuario;
  conProveedor?: boolean;
  /** El query de la URL, sin `?`. Los filtros viven ahi. */
  consulta?: string;
}

function montar({
  horarios = [unHorario()],
  salas = [unaSala()],
  profesoras = [unaProfesora()],
  error,
  errorAlEscribir,
  rol = 'ADMIN_OPERATIVO',
  conProveedor = true,
  consulta = '',
}: OpcionesDeMontaje = {}): QueryClient {
  busqueda.valor = consulta;

  /**
   * El doble responde POR RUTA, no por orden de llamada.
   *
   * Con `mockResolvedValueOnce` encadenados, agregar una peticion a la pantalla
   * corre todas las respuestas una posicion y los tests fallan en el sitio
   * equivocado. Y el fallo de escritura es una opcion del montaje y no un
   * `mockRejectedValueOnce` suelto por lo mismo: ese «once» se lo come la
   * relectura que dispara la invalidacion si llega antes.
   */
  pedirEspia.mockImplementation((ruta: string, opciones?: { metodo?: string }) => {
    if (opciones?.metodo !== undefined) {
      return errorAlEscribir === undefined
        ? Promise.resolve(null)
        : Promise.reject(errorAlEscribir);
    }
    if (ruta.startsWith('/horarios-profesor')) {
      return error === undefined ? Promise.resolve(horarios) : Promise.reject(error);
    }
    if (ruta.startsWith('/salas')) return Promise.resolve(salas);
    if (ruta.startsWith('/usuarios')) return Promise.resolve(profesoras);

    throw new Error(`La pantalla pidio una ruta que nadie espera: ${ruta}`);
  });

  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  // Sembrado para que el primer pintado ya tenga los datos: asi los tests que
  // miran el DOM no necesitan esperar. Sembrar NO apaga la peticion.
  if (error === undefined) {
    cliente.setQueryData(
      clavesDeHorarios.lista(filtrosDeLaBusqueda(new URLSearchParams(consulta))),
      horarios,
    );
  }
  cliente.setQueryData(clavesDeCatalogos.salas(), salas);
  cliente.setQueryData(clavesDeUsuarios.lista({ tipo: 'profesor' }), profesoras);

  const pantalla = <PaginaDeHorarios />;

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
 * Es la lista blanca del formulario. Afirmar «no hay un selector de sala»
 * buscando la palabra «sala» en el marcado depende de que nadie cambie esa
 * palabra; esto fija el conjunto entero, y un control de mas lo rompe se llame
 * como se llame.
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

/** Rellena el alta con un horario valido, y deja encima los cambios que se le pasen. */
async function completarElAlta(cambios: Partial<Record<string, string>> = {}): Promise<void> {
  const valores: Record<string, string> = {
    Profesora: 'perf-1',
    Sala: 's1',
    Dia: '1',
    'Hora de inicio': '18:00',
    'Hora de fin': '19:00',
    Desde: '2026-11-01',
    Hasta: '',
    'Tarifa por hora': '1500',
    ...cambios,
  };

  await userEvent.selectOptions(screen.getByLabelText('Profesora'), valores.Profesora ?? '');
  await userEvent.selectOptions(screen.getByLabelText('Sala'), valores.Sala ?? '');
  await userEvent.selectOptions(screen.getByLabelText('Dia'), valores.Dia ?? '1');

  for (const etiqueta of ['Hora de inicio', 'Hora de fin', 'Desde', 'Hasta', 'Tarifa por hora']) {
    const escrito = valores[etiqueta] ?? '';
    if (escrito !== '') await userEvent.type(screen.getByLabelText(etiqueta), escrito);
  }
}

async function enviarElAlta(): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: 'Crear horario' }));
  await esperar();
}

// ---------------------------------------------------------------------------
// La tabla
// ---------------------------------------------------------------------------

describe('el listado de horarios', () => {
  // LISTA BLANCA: el conjunto ENTERO. Una columna de mas —el error que ningun
  // test de presencia ve— rompe esto.
  it('muestra ESTAS columnas y solo estas', () => {
    montar();

    expect(columnasDelDocumento()).toEqual([
      'Profesora',
      'Sala',
      'Dia',
      'Hora',
      'Vigencia',
      'Tarifa',
      'Estado',
      'Acciones',
    ]);
  });

  it('cada fila tiene EXACTAMENTE una celda por columna, con este contenido', () => {
    // Una celda de mas no la ve el test de los `<th>`: se puede pintar un `<td>`
    // sin encabezado y la lista blanca de arriba sigue en verde.
    montar({ horarios: [unHorario({ hasta: '2026-12-31', tarifaPorHora: '1500.00' })] });

    expect(filasDelDocumento()).toEqual([
      [
        CENTINELAS.nombreDeLaProfesora,
        'Sala Principal',
        'Lunes',
        '18:00 a 19:00',
        '2026-11-01 a 2026-12-31',
        '$1500.00',
        'Vigente',
        'EditarDar de baja',
      ],
    ]);
  });

  /**
   * UN `hasta` EN NULL ES «INDEFINIDO», NO UN HUECO.
   *
   * Es el estado normal de casi todos los horarios y lo que decide hasta cuando
   * se le siguen etiquetando turnos a esa profesora. Una celda en blanco se lee
   * como «no cargo la pantalla».
   */
  it('una vigencia sin fin se dice con palabras, y distinta de una con fecha', () => {
    montar({
      horarios: [
        unHorario({ id: 'h1', hasta: null }),
        unHorario({ id: 'h2', hasta: '2026-12-31' }),
      ],
    });

    const [indefinido, conFecha] = filasDelDocumento();

    expect(indefinido?.[4]).toBe('Desde 2026-11-01, indefinido');
    expect(conFecha?.[4]).toBe('2026-11-01 a 2026-12-31');
  });

  /**
   * LA TARIFA EN `null` NO ES CERO.
   *
   * `null` significa «usa `Tenant.tarifaPorHoraProfesor`» y es lo que cobra la
   * mayoria de las profesoras. Un `$0.00` en esa celda es una profesora que
   * trabaja gratis, y la liquidacion lo pagaria asi.
   */
  it('una tarifa heredada se distingue de una tarifa en cero', () => {
    montar({
      horarios: [
        unHorario({ id: 'h1', tarifaPorHora: null }),
        unHorario({ id: 'h2', tarifaPorHora: '0.00' }),
      ],
    });

    const [heredada, enCero] = filasDelDocumento();

    expect(heredada?.[5]).toBe('Tarifa del gimnasio');
    expect(enCero?.[5]).toBe('$0.00');
    expect(heredada?.[5]).not.toBe(enCero?.[5]);
  });

  /**
   * LA BAJA ES LOGICA: la fila sigue llegando en el listado.
   *
   * El service la conserva porque «la liquidacion de los meses ya cerrados la
   * sigue necesitando». Si no se distingue de una vigente, el admin cuenta
   * horas que ya no se dictan.
   */
  it('un horario de baja se distingue de uno vigente', () => {
    montar({
      horarios: [unHorario({ id: 'h1', activo: true }), unHorario({ id: 'h2', activo: false })],
    });

    const [vigente, deBaja] = filasDelDocumento();

    expect(vigente?.[6]).toBe('Vigente');
    expect(deBaja?.[6]).toBe('De baja');
    // A lo que ya esta de baja no se le ofrece darle de baja otra vez —seria un
    // boton que no cambia nada y que vuelve a escribir el `hasta`—, pero SI se
    // le ofrece reactivar, que es lo que la API recien aprendio a hacer entero.
    expect(vigente?.[7]).toBe('EditarDar de baja');
    expect(deBaja?.[7]).toBe('EditarReactivar');
  });

  it('sin horarios lo dice, y no deja una tabla vacia', () => {
    montar({ horarios: [] });

    expect(screen.getByText(/todavia no hay horarios fijos/i)).toBeInTheDocument();
    expect(document.querySelector('table')).toBeNull();
  });

  it('con filtros puestos y sin resultados dice que es por los filtros', () => {
    // «No hay horarios» a secas, con un filtro puesto, se lee como «el gimnasio
    // no tiene ninguno» y manda a cargar uno que ya existe.
    montar({ horarios: [], consulta: 'profesorId=perf-1' });

    expect(screen.getByText(/coincidan con estos filtros/i)).toBeInTheDocument();
  });

  it('el tenantId no llega al marcado', () => {
    // Viaja dentro de cada sala y de cada profesora del catalogo, y lo que se
    // pinta llega al navegador aunque este tapado por CSS.
    montar();

    expect(document.body.innerHTML).not.toContain(CENTINELAS.tenantIdDelGimnasio);
  });
});

// ---------------------------------------------------------------------------
// Lo que se pide
// ---------------------------------------------------------------------------

/**
 * LISTA BLANCA DE PETICIONES, Y UNA POR ROL.
 *
 * Una LECTURA de mas no la ve ningun otro test de este archivo: no cambia ni un
 * nodo del marcado y no manda ningun cuerpo. Un `useSalas()` de precalentamiento
 * sobrevivio 74 tests en la tarea anterior de esta misma fase.
 *
 * Y una por rol, porque la del rol alto no ve lo que al rol bajo se le pide de
 * mas: aqui la LECTURA tambien lleva `@Roles('ADMIN_OPERATIVO')`, asi que un
 * rol que no alcanza no tiene que pedir NADA. Pedirlo seria un 403 pintado como
 * si la pantalla estuviera rota.
 */
describe('lo que la pantalla pide', () => {
  it.each(['ADMIN_OPERATIVO', 'ADMIN_SALON', 'SUPERADMIN'] as const)(
    'un %s pide ESTAS y ninguna mas',
    async (rol) => {
      montar({ rol });
      await esperar();

      expect(rutasPedidas()).toEqual(['/horarios-profesor', '/salas', '/usuarios?tipo=profesor']);
    },
  );

  it.each(['PROFESOR', 'ALUMNO'] as const)('un %s no pide NADA', async (rol) => {
    montar({ rol });
    await esperar();

    expect(rutasPedidas()).toEqual([]);
    expect(screen.getByText(/administrador operativo/i)).toBeInTheDocument();
  });

  /**
   * SIN PROVEEDOR DE ROL, NADA.
   *
   * El rol llega por el contexto que pone el armazon del panel. Si esta
   * pantalla acabara fuera de ese armazon el contexto devuelve `null`, y eso
   * tiene que significar «no alcanza para nada», no «no se sabe, pedilo igual».
   */
  it('sin proveedor de rol tampoco pide nada ni dibuja un formulario', async () => {
    montar({ conProveedor: false });
    await esperar();

    expect(rutasPedidas()).toEqual([]);
    expect(document.querySelector('form')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Los filtros
// ---------------------------------------------------------------------------

describe('los filtros de profesora y sala viajan en la URL', () => {
  it('la URL decide QUE se pide', async () => {
    montar({ consulta: 'profesorId=perf-1&salaId=s1' });
    await esperar();

    expect(rutasPedidas()[0]).toBe('/horarios-profesor?profesorId=perf-1&salaId=s1');
  });

  it('elegir una profesora escribe la URL, no un estado local', async () => {
    montar({ profesoras: [unaProfesora({ perfilId: 'perf-7' })] });

    await userEvent.selectOptions(screen.getByLabelText('Filtrar por profesora'), 'perf-7');

    expect(empujar).toHaveBeenCalledTimes(1);
    expect(empujar).toHaveBeenCalledWith('/mi-gym/admin/horarios?profesorId=perf-7');
  });

  it('elegir una sala NO borra el filtro de profesora que ya habia', async () => {
    // Un filtro que se lleva por delante al otro es peor que no tenerlo: el
    // admin cree que esta mirando los horarios de Ana en la sala chica.
    montar({ consulta: 'profesorId=perf-1', salas: [unaSala({ id: 's9' })] });

    await userEvent.selectOptions(screen.getByLabelText('Filtrar por sala'), 's9');

    expect(empujar).toHaveBeenCalledWith('/mi-gym/admin/horarios?profesorId=perf-1&salaId=s9');
  });

  it('vaciar un filtro saca la clave en vez de mandarla vacia', async () => {
    // `?salaId=` no es «sin filtro»: seria otra peticion.
    montar({ consulta: 'profesorId=perf-1&salaId=s1' });

    await userEvent.selectOptions(screen.getByLabelText('Filtrar por sala'), '');

    expect(empujar).toHaveBeenCalledWith('/mi-gym/admin/horarios?profesorId=perf-1');
  });
});

// ---------------------------------------------------------------------------
// El alta
// ---------------------------------------------------------------------------

describe('el alta de un horario', () => {
  it('el formulario ofrece ESTOS campos y solo estos', () => {
    montar();

    expect(controlesDelFormulario('Nuevo horario')).toEqual([
      'Profesora',
      'Sala',
      'Dia',
      'Hora de inicio',
      'Hora de fin',
      'Desde',
      'Hasta',
      'Tarifa por hora',
    ]);
  });

  it('manda el cuerpo entero, con el tipo de cada campo', async () => {
    montar();

    await completarElAlta();
    await enviarElAlta();

    expect(escrituras()[0]?.ruta).toBe('/horarios-profesor');
    expect(escrituras()[0]?.metodo).toBe('POST');
    // UNA sola escritura: el conteo lo fijaba el test de los almacenes que
    // vivia en este archivo; la dimension subio al tapon global pero esto no
    // es suyo, asi que se queda al lado de la escritura que acota.
    expect(escrituras()).toHaveLength(1);
    expect(cuerpoEnviado()).toEqual({
      // El `perfilId` de la profesora, NO el id de su usuario.
      profesorId: 'perf-1',
      salaId: 's1',
      // Numero, que es lo que pide `@IsInt()`.
      diaSemana: 1,
      horaInicio: '18:00',
      horaFin: '19:00',
      desde: '2026-11-01',
      tarifaPorHora: '1500.00',
    });
  });

  it('un formulario a medias no llega al servidor', async () => {
    montar();

    await enviarElAlta();

    expect(escrituras()).toEqual([]);
    expect(screen.getByText('Elegi una profesora.')).toBeInTheDocument();
    expect(screen.getByText('Elegi una sala.')).toBeInTheDocument();
  });
});

/**
 * LOS TRES CHOQUES SE DISTINGUEN.
 *
 * Un mensaje generico para los tres es lo que hace que el admin no sepa QUE
 * CAMBIAR: si la sala, si la hora, o si el horario ya estaba puesto y no hace
 * falta tocar nada. Los tres textos son los del servicio, palabra por palabra.
 */
describe('los tres choques', () => {
  async function provocar(mensaje: string): Promise<void> {
    montar({ errorAlEscribir: new ErrorDeApi(mensaje, 409, { message: mensaje }) });
    await completarElAlta();
    await enviarElAlta();
  }

  it('otra profesora en esa sala: «un turno tiene una sola profesora»', async () => {
    await provocar(CHOQUE_OTRA_PROFESORA_EN_LA_SALA);

    expect(screen.getByText(CHOQUE_OTRA_PROFESORA_EN_LA_SALA)).toBeInTheDocument();
  });

  it('la misma profesora en otra sala: «no puede estar en dos salas a la vez»', async () => {
    await provocar(CHOQUE_LA_MISMA_EN_OTRA_SALA);

    expect(screen.getByText(CHOQUE_LA_MISMA_EN_OTRA_SALA)).toBeInTheDocument();
  });

  it('el mismo horario repetido', async () => {
    await provocar(CHOQUE_EL_MISMO_HORARIO);

    expect(screen.getByText(CHOQUE_EL_MISMO_HORARIO)).toBeInTheDocument();
  });

  it('y los tres textos son distintos entre si', () => {
    // Si alguna vez los tres acabaran diciendo lo mismo, los tres tests de
    // arriba seguirian pasando y esta pantalla habria dejado de servir.
    const textos = new Set([
      CHOQUE_OTRA_PROFESORA_EN_LA_SALA,
      CHOQUE_LA_MISMA_EN_OTRA_SALA,
      CHOQUE_EL_MISMO_HORARIO,
    ]);

    expect(textos.size).toBe(3);
  });
});

describe('al elegir dia y franja se ve QUE HAY YA en esa franja', () => {
  const ELLUNES = unHorario({
    id: 'h1',
    diaSemana: 1,
    horaInicio: '18:00',
    horaFin: '19:00',
    profesorNombre: CENTINELAS.nombreDeLaProfesora,
    salaNombre: 'Sala Principal',
  });
  const ELMARTES = unHorario({
    id: 'h2',
    diaSemana: 2,
    horaInicio: '18:00',
    horaFin: '19:00',
    profesorNombre: 'Beatriz Lopez',
    salaNombre: 'Sala Chica',
  });

  function loQueSeVe(): string[] {
    return [...document.querySelectorAll('ul[aria-label="Lo que ya hay en esa franja"] li')].map(
      (li) => li.textContent?.trim() ?? '',
    );
  }

  it('enseña lo que se pisa con la franja elegida, y nada de otro dia', async () => {
    // Para que el choque se evite mirando, no chocando: los tres conflictos de
    // la API son solapes.
    montar({ horarios: [ELLUNES, ELMARTES] });

    await completarElAlta({ Dia: '1', 'Hora de inicio': '18:30', 'Hora de fin': '19:30' });

    expect(loQueSeVe()).toEqual([
      `${CENTINELAS.nombreDeLaProfesora} en Sala Principal, 18:00 a 19:00`,
    ]);
  });

  it('en un dia libre lo dice, en vez de callarse', async () => {
    montar({ horarios: [ELLUNES, ELMARTES] });

    await completarElAlta({ Dia: '3', 'Hora de inicio': '18:30', 'Hora de fin': '19:30' });

    expect(loQueSeVe()).toEqual([]);
    expect(screen.getByText('Nada cargado en esa franja.')).toBeInTheDocument();
  });

  it('con filtros puestos avisa de que esta mirando medio gimnasio', async () => {
    // La lista que mira es la que la pantalla tiene cargada, y el filtro la
    // recorta. Decir «nada cargado» sin esto seria prometer un hueco libre.
    montar({ horarios: [ELLUNES], consulta: 'salaId=s1' });

    await completarElAlta({ Dia: '4', 'Hora de inicio': '18:30', 'Hora de fin': '19:30' });

    expect(screen.getByText(/solo lo que dejan ver los filtros/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// La tarifa: es DINERO
// ---------------------------------------------------------------------------

describe('la tarifa por hora', () => {
  it('viaja como CADENA con dos decimales', async () => {
    // Nunca como number: un float binario no representa 1500.10 exactamente, y
    // el DTO la valida con `@Matches(/^\d{1,8}(\.\d{1,2})?$/)`. Es la regla del
    // repo desde la Fase 1.
    montar();

    await completarElAlta({ 'Tarifa por hora': '1500' });
    await enviarElAlta();

    expect(cuerpoEnviado().tarifaPorHora).toBe('1500.00');
    expect(typeof cuerpoEnviado().tarifaPorHora).toBe('string');
  });

  it('un decimal suelto se completa a dos, sin pasar por un float', async () => {
    montar();

    await completarElAlta({ 'Tarifa por hora': '1500.1' });
    await enviarElAlta();

    expect(cuerpoEnviado().tarifaPorHora).toBe('1500.10');
  });

  it('vacia significa HEREDAR la del gimnasio, no cero', async () => {
    // `null` en esa columna es «usa `Tenant.tarifaPorHoraProfesor`», y el DTO
    // lo dice: «Ausente = usa la tarifa general del gimnasio». Un `'0'` seria
    // una profesora que trabaja gratis, y la liquidacion lo pagaria asi.
    montar();

    await completarElAlta({ 'Tarifa por hora': '' });
    await enviarElAlta();

    expect(cuerpoEnviado()).not.toHaveProperty('tarifaPorHora');
  });

  it('un valor con mas de dos decimales no llega al servidor', async () => {
    // El DTO lo rechaza con un patron; avisar aca ahorra el viaje.
    montar();

    await completarElAlta({ 'Tarifa por hora': '1500.555' });
    await enviarElAlta();

    expect(escrituras()).toEqual([]);
    expect(
      screen.getByText('Un numero con hasta dos decimales, como 1500.00.'),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Las vigencias
// ---------------------------------------------------------------------------

describe('las vigencias', () => {
  it('hasta vacio significa INDEFINIDO', async () => {
    // El DTO lo dice: «Ausente = indefinido». Mandar `hasta: ''` seria un 400
    // del `@Matches`, y mandar una fecha inventada cerraria una vigencia que
    // nadie pidio cerrar.
    montar();

    await completarElAlta({ Hasta: '' });
    await enviarElAlta();

    expect(cuerpoEnviado()).not.toHaveProperty('hasta');
  });

  it('hasta con fecha si viaja', async () => {
    montar();

    await completarElAlta({ Hasta: '2026-12-31' });
    await enviarElAlta();

    expect(cuerpoEnviado().hasta).toBe('2026-12-31');
  });

  /**
   * EL ORDEN DE LAS FECHAS LO DICE LA API, Y SE ENSEÑA TAL CUAL.
   *
   * La pantalla NO lo comprueba a proposito: una comprobacion local con otro
   * texto seria un segundo mensaje que puede decir otra cosa, y —peor— dejaria
   * este camino de la API sin ejercitar nunca.
   */
  it('hasta anterior a desde muestra el motivo de la API', async () => {
    const motivo = 'hasta no puede ser anterior a desde';
    montar({ errorAlEscribir: new ErrorDeApi(motivo, 400, { message: [motivo] }) });

    await completarElAlta({ Desde: '2026-11-01', Hasta: '2026-10-01' });
    await enviarElAlta();

    expect(escrituras()).toHaveLength(1);
    expect(screen.getByText(motivo)).toBeInTheDocument();
  });

  it('horaFin no posterior a horaInicio tambien es el motivo de la API', async () => {
    const motivo = 'horaFin debe ser posterior a horaInicio';
    montar({ errorAlEscribir: new ErrorDeApi(motivo, 400, { message: [motivo] }) });

    await completarElAlta({ 'Hora de inicio': '19:00', 'Hora de fin': '18:00' });
    await enviarElAlta();

    expect(escrituras()).toHaveLength(1);
    expect(screen.getByText(motivo)).toBeInTheDocument();
  });

  it('un 403 se explica en palabras, no como «algo salio mal»', async () => {
    montar({ errorAlEscribir: new ErrorDeApi('Forbidden', 403, { message: 'Forbidden' }) });

    await completarElAlta();
    await enviarElAlta();

    expect(screen.getByText(/administrador operativo/i)).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain('Forbidden');
  });
});

// ---------------------------------------------------------------------------
// Editar
// ---------------------------------------------------------------------------

describe('editar un horario', () => {
  async function abrirLaEdicionDe(nombre: string, franja: string): Promise<void> {
    await userEvent.click(
      screen.getByRole('button', { name: `Editar el horario de ${nombre}, ${franja}` }),
    );
  }

  /**
   * AL EDITAR NO SE OFRECE CAMBIAR LA PROFESORA NI LA SALA.
   *
   * `ActualizarHorarioProfesorDto` las EXCLUYE: «mover un horario de profesora
   * o de sala por PATCH dejaria los turnos ya etiquetados colgando de un patron
   * que ya no existe». Dibujar los selectores seria ofrecer una operacion que
   * la API rechaza con un 400 del whitelist.
   *
   * Se afirma sobre el MARCADO y no con `queryByRole`: el arbol de
   * accesibilidad ya excluye lo que lleva `hidden`, asi que un `queryByRole` en
   * null no distingue «no esta» de «esta escondido».
   */
  it('al editar NO se ofrece cambiar la profesora ni la sala', async () => {
    montar();

    await abrirLaEdicionDe(CENTINELAS.nombreDeLaProfesora, 'lunes de 18:00 a 19:00');

    expect(controlesDelFormulario('Editar horario')).toEqual([
      'Dia',
      'Hora de inicio',
      'Hora de fin',
      'Desde',
      'Hasta',
      'Tarifa por hora',
    ]);

    const formulario = document.querySelector('form[aria-label="Editar horario"]');
    expect(formulario?.innerHTML).not.toMatch(/profesora/i);
    expect(formulario?.innerHTML).not.toMatch(/sala/i);
  });

  it('manda el PATCH a ESA fila y SOLO con lo que cambio', async () => {
    // Con DOS sembrados: con uno solo, «edita el suyo» y «edita el primero»
    // son indistinguibles.
    montar({
      horarios: [
        unHorario({ id: 'h1', profesorNombre: 'Beatriz Lopez', diaSemana: 2 }),
        unHorario({ id: 'h2', profesorNombre: CENTINELAS.nombreDeLaProfesora, diaSemana: 1 }),
      ],
    });

    await abrirLaEdicionDe(CENTINELAS.nombreDeLaProfesora, 'lunes de 18:00 a 19:00');

    await userEvent.clear(screen.getByLabelText('Hora de fin'));
    await userEvent.type(screen.getByLabelText('Hora de fin'), '20:00');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar horario' }));
    await esperar();

    expect(escrituras()[0]?.ruta).toBe('/horarios-profesor/h2');
    expect(escrituras()[0]?.metodo).toBe('PATCH');
    expect(cuerpoEnviado()).toEqual({ horaFin: '20:00' });
    // UNA sola escritura: el conteo lo fijaba el test de los almacenes que
    // vivia en este archivo; la dimension subio al tapon global pero esto no
    // es suyo, asi que se queda al lado de la escritura que acota.
    expect(escrituras()).toHaveLength(1);
  });

  /**
   * VOLVER A LA TARIFA DEL GIMNASIO MANDA `null` EXPLICITO.
   *
   * Omitir la clave es el PATCH de «no toques esto», que es lo contrario de lo
   * que la persona acaba de pedir al vaciar el campo.
   */
  it('vaciar la tarifa al editar manda null, no la omite ni manda cero', async () => {
    montar({ horarios: [unHorario({ id: 'h1', tarifaPorHora: '1500.00' })] });

    await abrirLaEdicionDe(CENTINELAS.nombreDeLaProfesora, 'lunes de 18:00 a 19:00');
    await userEvent.clear(screen.getByLabelText('Tarifa por hora'));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar horario' }));
    await esperar();

    expect(cuerpoEnviado()).toEqual({ tarifaPorHora: null });
  });

  it('sin tocar nada no se manda un PATCH vacio', async () => {
    montar();

    await abrirLaEdicionDe(CENTINELAS.nombreDeLaProfesora, 'lunes de 18:00 a 19:00');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar horario' }));
    await esperar();

    expect(escrituras()).toEqual([]);
    expect(screen.getByText('No cambiaste nada.')).toBeInTheDocument();
  });

  /**
   * VACIAR EL «HASTA» AL EDITAR MANDA `null`, Y NO TOCARLO NO MANDA LA CLAVE.
   *
   * SON DOS TESTS Y NO UNO, y los dos SIEMBRAN UNA FECHA. Con el horario
   * sembrado en `hasta: null` —que es el valor por defecto de `unHorario()`—
   * «lo dejo como estaba» y «lo puso en nulo» escriben lo mismo, el par no
   * distingue nada y el `valores.hasta !== '' && ...` que se vino a arreglar
   * volveria a pasar en verde.
   *
   * El campo promete «Vacio = indefinido» desde la Fase 10 y en edicion eso era
   * mentira: borrarlo no mandaba nada y el PATCH contestaba 200 sin tocar la
   * vigencia.
   */
  it('vaciar el hasta al editar manda null explicito', async () => {
    montar({ horarios: [unHorario({ id: 'h1', hasta: '2026-12-31' })] });

    await abrirLaEdicionDe(CENTINELAS.nombreDeLaProfesora, 'lunes de 18:00 a 19:00');
    await userEvent.clear(screen.getByLabelText('Hasta'));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar horario' }));
    await esperar();

    expect(cuerpoEnviado()).toEqual({ hasta: null });
  });

  it('no tocar el hasta al editar NO manda la clave', async () => {
    montar({ horarios: [unHorario({ id: 'h1', hasta: '2026-12-31' })] });

    await abrirLaEdicionDe(CENTINELAS.nombreDeLaProfesora, 'lunes de 18:00 a 19:00');
    await userEvent.clear(screen.getByLabelText('Hora de fin'));
    await userEvent.type(screen.getByLabelText('Hora de fin'), '20:00');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar horario' }));
    await esperar();

    expect(cuerpoEnviado()).toEqual({ horaFin: '20:00' });
    // Y no `hasta: undefined`, que viajaria como clave en el JSON y el service
    // leeria como «no vino» por casualidad y no por diseño.
    expect('hasta' in cuerpoEnviado()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Reactivar
// ---------------------------------------------------------------------------

/**
 * REACTIVAR PREGUNTA LA VIGENCIA, Y NO LA ADIVINA.
 *
 * `DELETE /horarios-profesor/:id` da de baja Y ADEMAS cierra el `hasta` en hoy.
 * Eso PISA el valor cuando era `null` —indefinido— o futuro, asi que despues de
 * la baja no hay forma de saber si ese horario era indefinido o si terminaba en
 * una fecha concreta. Un boton que mandara `{ activo: true, hasta: null }`
 * estaria adivinando lo primero, y a uno que legitimamente terminaba en marzo
 * le borraria el final sin preguntar.
 *
 * Por eso no es el interruptor de la ficha de sala: alli la baja no pierde
 * nada y volver a poner «Sí» devuelve la sala que habia.
 */
describe('reactivar un horario', () => {
  const DE_BAJA = {
    id: 'h1',
    activo: false,
    desde: '2026-11-01',
    // Lo que escribio la baja. NO es el dato original: el original se perdio.
    hasta: '2026-11-20',
  } as const;

  async function abrirLaReactivacion(): Promise<void> {
    await userEvent.click(
      screen.getByRole('button', {
        name: `Reactivar el horario de ${CENTINELAS.nombreDeLaProfesora}, lunes de 18:00 a 19:00`,
      }),
    );
  }

  async function reactivar(): Promise<void> {
    await userEvent.click(screen.getByRole('button', { name: 'Reactivar' }));
    await esperar();
  }

  /**
   * LA LISTA BLANCA DEL FORMULARIO, en sus dos estados.
   *
   * Sin elegir el fin, el campo de fecha NO esta: un campo de fecha dibujado
   * junto a un desplegable sin elegir invita a rellenarlo y a creer que con eso
   * alcanza.
   */
  it('pide la vigencia, y el campo de fecha solo aparece si hace falta', async () => {
    montar({ horarios: [unHorario(DE_BAJA)] });

    await abrirLaReactivacion();

    expect(controlesDelFormulario('Reactivar horario')).toEqual([
      'Rige desde',
      'Fin de la vigencia',
    ]);

    await userEvent.selectOptions(screen.getByLabelText('Fin de la vigencia'), 'fecha');

    expect(controlesDelFormulario('Reactivar horario')).toEqual([
      'Rige desde',
      'Fin de la vigencia',
      'Rige hasta',
    ]);
  });

  /**
   * EL FIN DE LA VIGENCIA NO TIENE VALOR POR DEFECTO.
   *
   * Es la misma decision que la cancelacion de la Fase 9. Se afirma sobre el
   * `value` del control y no solo sobre que el envio falla: un desplegable que
   * arrancara en «Indefinido» decidiria por quien no lo mira, y el envio
   * saldria igual de contento.
   */
  it('el fin de la vigencia arranca SIN elegir, y sin elegirlo no se manda nada', async () => {
    montar({ horarios: [unHorario(DE_BAJA)] });

    await abrirLaReactivacion();

    expect((screen.getByLabelText('Fin de la vigencia') as HTMLSelectElement).value).toBe('');

    await reactivar();

    expect(escrituras()).toEqual([]);
    expect(screen.getByText(/La baja borro la que tenia/i)).toBeInTheDocument();
  });

  /**
   * «INDEFINIDO» ES UNA OPCION EXPLICITA, y manda `null`.
   *
   * El null es lo unico que vacia la columna: el DTO lo acepta con
   * `@ValidateIf` —no con `@IsOptional` a secas— y el service lo distingue de
   * «no vino la clave».
   */
  it('elegir «indefinido» manda hasta: null, con el activo y el desde', async () => {
    montar({ horarios: [unHorario(DE_BAJA)] });

    await abrirLaReactivacion();
    await userEvent.selectOptions(screen.getByLabelText('Fin de la vigencia'), 'indefinido');
    await reactivar();

    expect(escrituras()[0]?.ruta).toBe('/horarios-profesor/h1');
    expect(escrituras()[0]?.metodo).toBe('PATCH');
    expect(cuerpoEnviado()).toEqual({ activo: true, desde: '2026-11-01', hasta: null });
  });

  /**
   * NO ADIVINA LA VIGENCIA: lo que viaja es LO QUE EL ADMIN ELIGIO.
   *
   * Este es el test que mata un «Reactivar» que mandara `hasta: null` fijo. Se
   * afirma sobre el CUERPO ENTERO y no con un `toMatchObject`: una clave de mas
   * —o el `hasta: '2026-11-20'` que escribio la baja, colado por un cuerpo
   * armado desde el horario cargado— no la ve una asercion parcial.
   */
  it('elegir una fecha manda ESA fecha, no un null ni la que escribio la baja', async () => {
    montar({ horarios: [unHorario(DE_BAJA)] });

    await abrirLaReactivacion();
    await userEvent.selectOptions(screen.getByLabelText('Fin de la vigencia'), 'fecha');
    await userEvent.type(screen.getByLabelText('Rige hasta'), '2027-03-31');
    await reactivar();

    expect(cuerpoEnviado()).toEqual({
      activo: true,
      desde: '2026-11-01',
      hasta: '2027-03-31',
    });
    expect(cuerpoEnviado().hasta).not.toBe(DE_BAJA.hasta);
    expect(cuerpoEnviado().hasta).not.toBeNull();
  });

  /**
   * EL «DESDE» SOBREVIVIO A LA BAJA, asi que viene puesto —y editable—, y es la
   * diferencia con el `hasta`, que se destruyo. Dejar el que habia es volver a
   * cubrir el tiempo que estuvo de baja, y eso la pantalla lo DICE.
   */
  it('el desde viene con el que tenia, se puede cambiar, y se dice que significa dejarlo', async () => {
    montar({ horarios: [unHorario(DE_BAJA)] });

    await abrirLaReactivacion();

    expect((screen.getByLabelText('Rige desde') as HTMLInputElement).value).toBe('2026-11-01');
    expect(screen.getByText(/cuenta esas horas como contratadas/i)).toBeInTheDocument();
    // Y se dice de donde salio el «hasta» que figura, para que no se lea como
    // el dato original.
    expect(screen.getByText(/se lo escribio la baja/i)).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText('Rige desde'));
    await userEvent.type(screen.getByLabelText('Rige desde'), '2027-01-15');
    await userEvent.selectOptions(screen.getByLabelText('Fin de la vigencia'), 'indefinido');
    await reactivar();

    expect(cuerpoEnviado()).toEqual({ activo: true, desde: '2027-01-15', hasta: null });
  });

  it('reactiva el DE ESA FILA, con dos sembrados', async () => {
    // Con uno solo, «reactiva el suyo» y «reactiva el primero» no se
    // distinguen.
    montar({
      horarios: [
        unHorario({ ...DE_BAJA, id: 'h1', profesorNombre: 'Beatriz Lopez', diaSemana: 2 }),
        unHorario({ ...DE_BAJA, id: 'h2', profesorNombre: CENTINELAS.nombreDeLaProfesora }),
      ],
    });

    await abrirLaReactivacion();
    await userEvent.selectOptions(screen.getByLabelText('Fin de la vigencia'), 'indefinido');
    await reactivar();

    expect(escrituras()[0]?.ruta).toBe('/horarios-profesor/h2');
    expect(escrituras()).toHaveLength(1);
  });

  /**
   * EL CHOQUE AL REACTIVAR, QUE ES EL QUE IMPORTA.
   *
   * Mientras estuvo de baja, otra profesora pudo ocupar la franja. El service
   * vuelve a correr `exigirSinSolape` porque `activo` queda en `true`, asi que
   * la reactivacion rebota con un 409 —y con el texto que dice QUE cambiar, no
   * con un «se pisa con otro horario» generico—.
   */
  it('un reactivado que ahora choca enseña el mensaje de la API ENTERO', async () => {
    montar({
      horarios: [unHorario(DE_BAJA)],
      errorAlEscribir: new ErrorDeApi(CHOQUE_OTRA_PROFESORA_EN_LA_SALA, 409, {
        message: CHOQUE_OTRA_PROFESORA_EN_LA_SALA,
      }),
    });

    await abrirLaReactivacion();
    await userEvent.selectOptions(screen.getByLabelText('Fin de la vigencia'), 'indefinido');
    await reactivar();

    expect(screen.getByText(CHOQUE_OTRA_PROFESORA_EN_LA_SALA)).toBeInTheDocument();
    // Y el formulario sigue abierto con lo elegido: cerrarlo obligaria a
    // volver a decidir la vigencia desde cero por culpa del choque de otro.
    expect((screen.getByLabelText('Fin de la vigencia') as HTMLSelectElement).value).toBe(
      'indefinido',
    );
  });

  it('cancelar no manda nada y cierra el formulario', async () => {
    montar({ horarios: [unHorario(DE_BAJA)] });

    await abrirLaReactivacion();
    await userEvent.selectOptions(screen.getByLabelText('Fin de la vigencia'), 'indefinido');
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await esperar();

    expect(escrituras()).toEqual([]);
    expect(document.querySelector('form[aria-label="Reactivar horario"]')).toBeNull();
  });

  it('una fecha mal escrita no sale de la pantalla', async () => {
    montar({ horarios: [unHorario(DE_BAJA)] });

    await abrirLaReactivacion();
    await userEvent.selectOptions(screen.getByLabelText('Fin de la vigencia'), 'fecha');
    await userEvent.type(screen.getByLabelText('Rige hasta'), '31/03/2027');
    await reactivar();

    expect(escrituras()).toEqual([]);
    expect(screen.getByText('La fecha va como YYYY-MM-DD.')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Dar de baja
// ---------------------------------------------------------------------------

describe('dar de baja un horario', () => {
  async function abrirLaBajaDe(nombre: string, franja: string): Promise<void> {
    await userEvent.click(
      screen.getByRole('button', { name: `Dar de baja el horario de ${nombre}, ${franja}` }),
    );
  }

  it('borrar un horario confirma NOMBRANDO a la profesora, el dia y la hora', async () => {
    // Con diez filas iguales, un «¿estas seguro?» es una ruleta.
    montar();

    await abrirLaBajaDe(CENTINELAS.nombreDeLaProfesora, 'lunes de 18:00 a 19:00');

    const dialogo = screen.getByRole('dialog');
    expect(dialogo).toHaveTextContent(CENTINELAS.nombreDeLaProfesora);
    expect(dialogo).toHaveTextContent('lunes');
    expect(dialogo).toHaveTextContent('18:00 a 19:00');
    // Y nada sale hasta que se confirma.
    expect(escrituras()).toEqual([]);
  });

  it('borra el DE ESA FILA, con dos sembrados', async () => {
    // Con uno solo, «borra el suyo» y «borra el primero» son indistinguibles.
    montar({
      horarios: [
        unHorario({ id: 'h1', profesorNombre: 'Beatriz Lopez', diaSemana: 2 }),
        unHorario({ id: 'h2', profesorNombre: CENTINELAS.nombreDeLaProfesora, diaSemana: 1 }),
      ],
    });

    await abrirLaBajaDe(CENTINELAS.nombreDeLaProfesora, 'lunes de 18:00 a 19:00');
    await userEvent.click(screen.getByRole('button', { name: 'Dar de baja' }));
    await esperar();

    expect(escrituras()[0]?.ruta).toBe('/horarios-profesor/h2');
    expect(escrituras()[0]?.metodo).toBe('DELETE');
    // 204 sin cuerpo: es el unico borrado de la fase que no devuelve la fila.
    expect(escrituras()[0]?.cuerpo).toBeUndefined();
    // UNA sola escritura: el conteo lo fijaba el test de los almacenes que
    // vivia en este archivo; la dimension subio al tapon global pero esto no
    // es suyo, asi que se queda al lado de la escritura que acota.
    expect(escrituras()).toHaveLength(1);
  });

  it('cancelar no manda nada', async () => {
    montar();

    await abrirLaBajaDe(CENTINELAS.nombreDeLaProfesora, 'lunes de 18:00 a 19:00');
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await esperar();

    expect(escrituras()).toEqual([]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('si la baja falla, el motivo se pinta DENTRO del dialogo', async () => {
    // Detras del dialogo no se lee, y el dialogo sigue abierto pidiendo que se
    // confirme algo que acaba de fallar.
    montar({ errorAlEscribir: new ErrorDeApi('Horario inexistente', 404) });

    await abrirLaBajaDe(CENTINELAS.nombreDeLaProfesora, 'lunes de 18:00 a 19:00');
    await userEvent.click(screen.getByRole('button', { name: 'Dar de baja' }));
    await esperar();

    expect(screen.getByRole('dialog')).toHaveTextContent('Horario inexistente');
  });
});

// ---------------------------------------------------------------------------
// La sesion
// ---------------------------------------------------------------------------

describe('la sesion caducada', () => {
  it('manda al login conservando los filtros', async () => {
    // Los filtros viven en la URL: volver del login a la lista entera es perder
    // la profesora que la persona acababa de elegir.
    montar({ error: new ErrorDeApi('Unauthorized', 401), consulta: 'profesorId=perf-1' });
    await esperar();

    expect(empujar).toHaveBeenCalledWith(
      `/mi-gym/login?volverA=${encodeURIComponent('/mi-gym/admin/horarios?profesorId=perf-1')}`,
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
