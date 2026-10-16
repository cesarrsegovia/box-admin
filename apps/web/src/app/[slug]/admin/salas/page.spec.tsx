import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { RolUsuario, SalaPublica } from '@boxadmin/shared';
import { ErrorDeApi } from '@/lib/cliente';
import { clavesDeCatalogos } from '@/hooks/use-catalogos';
import { vigilarEstosDatos } from '@/test/espia-de-consola';
import { ProveedorDeRol } from '../rol-del-panel';
import PaginaDeSalas from './page';

/**
 * LO QUE ESTA PANTALLA SIEMBRA Y NO PUEDE ESCAPARSE POR LOS CANALES QUE NO SON
 * EL DOM.
 *
 * `tenantId` es el dato que la Fase 0 se ocupo de que no cruzara entre
 * gimnasios y viaja DENTRO de cada `SalaPublica`: un `console.table(salas)` lo
 * publica entero. El tapon global de `vitest.setup.ts` vigila esto en los tres
 * canales —consola, titulo y nombre de la pestaña— en TODOS los tests de este
 * archivo.
 */
const CENTINELAS = {
  tenantIdDelGimnasio: 'tnt-centinela',
  nombreDeLaSalaDeBaja: 'Sala-Clausurada-Marcador',
};

vigilarEstosDatos(CENTINELAS);

const { empujar, pedirEspia } = vi.hoisted(() => ({
  empujar: vi.fn(),
  pedirEspia: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: empujar, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({ slug: 'mi-gym' }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/mi-gym/admin/salas',
}));

/**
 * Se dobla `pedir`, no `fetch`.
 *
 * Que `pedir` arme bien la URL ya lo fija `use-salas-admin.spec`. Lo que se
 * audita aqui es un escalon mas arriba: QUE pide la pantalla y QUE cuerpo
 * manda. `ErrorDeApi` se deja REAL porque la pagina ramifica con `instanceof`.
 */
vi.mock('@/lib/cliente', async (original) => ({
  ...(await original<typeof import('@/lib/cliente')>()),
  pedir: pedirEspia,
}));

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Semillas
// ---------------------------------------------------------------------------

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

function montar({
  salas = [unaSala()],
  error,
  rol = 'ADMIN_SALON',
  conProveedor = true,
}: {
  salas?: SalaPublica[];
  error?: unknown;
  rol?: RolUsuario;
  conProveedor?: boolean;
} = {}): QueryClient {
  pedirEspia.mockImplementation(() =>
    error === undefined ? Promise.resolve(salas) : Promise.reject(error),
  );

  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  // Sembrado para que el primer pintado ya tenga la lista: asi los tests que
  // miran el DOM no necesitan esperar. Sembrar NO apaga la peticion.
  if (error === undefined) cliente.setQueryData(clavesDeCatalogos.salas(), salas);

  const pantalla = <PaginaDeSalas />;

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

function enlacesDelDocumento(): (string | null)[] {
  return [...document.querySelectorAll('a')].map((a) => a.getAttribute('href'));
}

function botonesDelDocumento(): string[] {
  return [...document.querySelectorAll('button')].map((boton) => boton.textContent?.trim() ?? '');
}

/** Las rutas pedidas, EN ORDEN y sin deduplicar. */
function rutasPedidas(): string[] {
  return pedirEspia.mock.calls.map(([ruta]) => ruta as string);
}

/** Lo que la pantalla le paso a `pedir` en la llamada de escritura. */
function cuerpoEnviado(indice = 0): unknown {
  const escrituras = pedirEspia.mock.calls.filter(
    ([, opciones]) => (opciones as { metodo?: string } | undefined)?.metodo !== undefined,
  );
  const llamada = escrituras[indice];
  if (llamada === undefined) throw new Error(`No hubo escritura numero ${indice}`);

  return (llamada[1] as { cuerpo?: unknown }).cuerpo;
}

// ---------------------------------------------------------------------------
// La tabla
// ---------------------------------------------------------------------------

describe('el listado de salas', () => {
  // LISTA BLANCA: el conjunto ENTERO. Una columna de mas —el error que ningun
  // test de presencia ve— rompe esto.
  it('muestra ESTAS columnas y solo estas', () => {
    montar();

    expect(columnasDelDocumento()).toEqual([
      'Nombre',
      'Estado',
      'Visible para alumnos',
      'Cupo base',
      'Lista de espera',
    ]);
  });

  it('cada fila tiene EXACTAMENTE una celda por columna, con este contenido', () => {
    // Una celda de mas no la ve el test de los `<th>`: se puede pintar un `<td>`
    // sin encabezado y la lista blanca de arriba sigue en verde.
    montar({ salas: [unaSala({ cupoBase: 12, listaEsperaHabilitada: true })] });

    expect(filasDelDocumento()).toEqual([['Sala Principal', 'Activa', 'Sí', '12', 'Sí']]);
  });

  /**
   * LA BAJA ES LOGICA: la sala sigue en la lista.
   *
   * Y el service devuelve las de baja a cualquiera que alcance
   * `ADMIN_OPERATIVO`, asi que estan ahi, mezcladas con las activas. Si no se
   * distinguen, el admin elige una sala muerta para un pack o para un horario y
   * se entera al publicar el mes.
   *
   * Se afirma sobre el TEXTO y no sobre una clase de CSS: un color no lo lee
   * quien tiene un lector de pantalla, y tampoco quien no distingue ese color.
   */
  it('una sala de baja se distingue de una activa', () => {
    montar({
      salas: [
        unaSala({ id: 's1', nombre: 'Sala Principal', activa: true }),
        unaSala({ id: 's2', nombre: CENTINELAS.nombreDeLaSalaDeBaja, activa: false }),
      ],
    });

    const [activa, deBaja] = filasDelDocumento();

    expect(activa?.[1]).toBe('Activa');
    expect(deBaja?.[1]).toBe('De baja');
    expect(deBaja?.[1]).not.toBe(activa?.[1]);
  });

  /**
   * EL `null` DE `cupoBase` NO ES HERENCIA, y la columna no lo puede decir asi.
   *
   * Los otros tres heredables si heredan del gimnasio —`resolverConfiguracion`
   * resuelve la cascada `Sala ?? Tenant ?? sistema`—, pero el modelo `Tenant`
   * dice por escrito que `cupoBase` NO se agrega alli «aunque Sala lo tenga»,
   * porque el planificador reporta `SALA_SIN_CUPO_BASE` como conflicto. Pintar
   * «hereda del gimnasio» en esa celda le promete al admin un valor que no
   * existe, y la consecuencia es un mes que no se genera.
   */
  it('un cupo base sin definir NO se anuncia como herencia', () => {
    montar({ salas: [unaSala({ cupoBase: null, listaEsperaHabilitada: null })] });

    const [fila] = filasDelDocumento();

    expect(fila?.[3]).toBe('Sin definir');
    expect(fila?.[3]).not.toMatch(/hereda/i);
    // Y el que SI hereda lo dice, para que la distincion exista en la pantalla.
    expect(fila?.[4]).toMatch(/hereda/i);
  });

  it('un ajuste en cero no se lee como un hueco vacio', () => {
    // La celda de un `0` y la de un `null` tienen que decir cosas distintas.
    montar({ salas: [unaSala({ listaEsperaHabilitada: false })] });

    const [fila] = filasDelDocumento();
    expect(fila?.[4]).toBe('No');
  });

  it('cada fila enlaza a SU ficha', () => {
    // Con DOS salas: con una sola, «enlaza a la suya» y «enlaza a la primera»
    // son indistinguibles.
    montar({ salas: [unaSala({ id: 's1' }), unaSala({ id: 's2' })] });

    expect(enlacesDelDocumento()).toEqual(['/mi-gym/admin/salas/s1', '/mi-gym/admin/salas/s2']);
  });

  it('sin salas lo dice, y no deja una tabla vacia', () => {
    montar({ salas: [] });

    expect(screen.getByText(/todavia no hay salas/i)).toBeInTheDocument();
    expect(document.querySelector('table')).toBeNull();
  });

  it('el tenantId no llega al marcado', () => {
    // Lo que se pinta viaja al navegador aunque este tapado por CSS.
    montar();

    expect(document.body.innerHTML).not.toContain(CENTINELAS.tenantIdDelGimnasio);
  });

  /**
   * `exclusiva` NO SE DIBUJA tampoco aqui.
   *
   * Es un campo muerto: se escribe en el alta y se mapea al contrato, y
   * ninguna regla del sistema lo lee. Se afirma sobre el MARCADO porque
   * `queryByRole` consulta el arbol de accesibilidad, que ya excluye por su
   * cuenta lo que lleva `hidden`: un control escondido pasaria en verde y
   * seguiria en el HTML.
   */
  it('NO dibuja el campo exclusiva', () => {
    montar({ salas: [unaSala({ exclusiva: true })] });

    expect(document.body.innerHTML).not.toMatch(/exclusiv/i);
  });
});

/**
 * LISTA BLANCA DE PETICIONES. Una LECTURA de mas no la ve ningun otro test de
 * este archivo: no cambia ni un nodo del marcado y no manda ningun cuerpo.
 *
 * `GET /salas` UNA vez: el listado usa el catalogo de `useSalas()`, el mismo
 * que ya pide media pantalla del panel. Un hook de lista propio para la
 * administracion seria esta misma peticion bajo otra clave, dos veces.
 */
describe('lo que el listado pide', () => {
  it('salen ESTAS peticiones y ninguna mas', async () => {
    montar();
    await esperar();

    expect(rutasPedidas()).toEqual(['/salas']);
  });
});

// ---------------------------------------------------------------------------
// El rol
// ---------------------------------------------------------------------------

describe('quien puede escribir', () => {
  /**
   * Las cuatro escrituras de salas piden `ADMIN_SALON`.
   *
   * Se afirma sobre el MARCADO y no con `queryByRole` por lo mismo de siempre:
   * el arbol de accesibilidad ya excluye lo que lleva `hidden`, asi que un
   * `queryByRole` en null no distingue «no esta» de «esta escondido».
   */
  it('un ADMIN_OPERATIVO no ve NINGUN boton de escritura, en el marcado', () => {
    montar({ rol: 'ADMIN_OPERATIVO' });

    expect(document.body.innerHTML).not.toMatch(/crear sala/i);
    expect(document.body.innerHTML).not.toMatch(/nueva sala/i);
    expect(botonesDelDocumento()).toEqual([]);
  });

  it('un ADMIN_SALON si los ve', () => {
    montar({ rol: 'ADMIN_SALON' });

    expect(screen.getByRole('button', { name: 'Crear sala' })).toBeInTheDocument();
  });

  it('un SUPERADMIN tambien, porque los roles son jerarquicos', () => {
    montar({ rol: 'SUPERADMIN' });

    expect(screen.getByRole('button', { name: 'Crear sala' })).toBeInTheDocument();
  });

  /**
   * SIN PROVEEDOR DE ROL, NADA.
   *
   * El rol llega por el contexto que pone el armazon del panel. Si esta
   * pantalla acabara fuera de ese armazon el contexto devuelve `null`, y eso
   * tiene que significar «no alcanza para nada», no «no se sabe, dibujalo
   * igual».
   */
  it('sin proveedor de rol tampoco se dibujan', () => {
    montar({ conProveedor: false });

    expect(document.body.innerHTML).not.toMatch(/crear sala/i);
    expect(botonesDelDocumento()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// El alta
// ---------------------------------------------------------------------------

describe('el alta de una sala', () => {
  it('manda el nombre y NADA mas', async () => {
    // `CrearSalaDto` acepta ocho campos; mandar los otros siete con sus
    // defaults inventados por la pantalla seria decidir la configuracion de
    // una sala que nadie configuro. Los heredables nacen en null.
    montar();

    await userEvent.type(screen.getByLabelText('Nombre de la sala'), 'Sala 2');
    await userEvent.click(screen.getByRole('button', { name: 'Crear sala' }));
    await esperar();

    expect(cuerpoEnviado()).toEqual({ nombre: 'Sala 2' });
  });

  it('un nombre vacio no llega al servidor', async () => {
    montar();

    await userEvent.click(screen.getByRole('button', { name: 'Crear sala' }));
    await esperar();

    expect(() => cuerpoEnviado()).toThrow();
    expect(screen.getByText(/ponele un nombre/i)).toBeInTheDocument();
  });

  it('el error de la API se enseña, en el campo que nombra', async () => {
    montar();
    pedirEspia.mockRejectedValueOnce(
      new ErrorDeApi('Bad Request', 400, { message: ['nombre should not be empty'] }),
    );

    await userEvent.type(screen.getByLabelText('Nombre de la sala'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Crear sala' }));
    await esperar();

    expect(screen.getByText('nombre should not be empty')).toBeInTheDocument();
  });

  it('un 403 se explica en palabras, no como «algo salio mal»', async () => {
    montar();
    pedirEspia.mockRejectedValueOnce(new ErrorDeApi('Forbidden', 403, { message: 'Forbidden' }));

    await userEvent.type(screen.getByLabelText('Nombre de la sala'), 'Sala 2');
    await userEvent.click(screen.getByRole('button', { name: 'Crear sala' }));
    await esperar();

    expect(screen.getByText(/administrador del salon/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// La sesion
// ---------------------------------------------------------------------------

describe('la sesion caducada', () => {
  it('manda al login conservando a donde volver', async () => {
    montar({ error: new ErrorDeApi('Unauthorized', 401) });
    await esperar();

    expect(empujar).toHaveBeenCalledWith(
      `/mi-gym/login?volverA=${encodeURIComponent('/mi-gym/admin/salas')}`,
    );
  });

  it('y no ofrece reintentar, que seria volver a fallar', async () => {
    montar({ error: new ErrorDeApi('Unauthorized', 401) });
    await esperar();

    expect(screen.queryByRole('button', { name: /reintentar/i })).toBeNull();
  });

  it('un fallo que no es de sesion si se puede reintentar', async () => {
    montar({ error: new ErrorDeApi('Se cayo la base', 500) });
    await esperar();

    expect(screen.getByText('Se cayo la base')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reintentar/i })).toBeInTheDocument();
  });
});
