import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { UsuarioResumen } from '@boxadmin/shared';
import { ErrorDeApi } from '@/lib/cliente';
import { rutaDeRetornoSegura } from '@/lib/ruta-de-retorno';
import { clavesDeUsuarios } from '@/hooks/use-usuarios';
import { filtrosDeLaBusqueda } from './filtros';
import PaginaDePersonas from './page';

const { empujar, pedirEspia, busqueda } = vi.hoisted(() => ({
  empujar: vi.fn(),
  pedirEspia: vi.fn(),
  // Mutable a proposito: `useSearchParams` se llama en cada render y tiene que
  // devolver lo que el test de turno puso, no lo que habia al cargar el modulo.
  busqueda: { parametros: new URLSearchParams() },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: empujar, replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => busqueda.parametros,
  usePathname: () => '/mi-gym/admin/usuarios',
  useParams: () => ({ slug: 'mi-gym' }),
}));

/**
 * Se dobla `pedir` y no `fetch`.
 *
 * Que `pedir` arme bien la URL ya lo fija `use-usuarios.spec`. Lo que se audita
 * aqui es un escalon mas arriba: que la PANTALLA le pase los filtros que leyo
 * de la URL. Doblando `fetch` habria que mirar `/api/bx/usuarios?...` y el
 * prefijo del proxy no es asunto de esta pantalla.
 *
 * `ErrorDeApi` se deja REAL: el codigo de la pagina ramifica con `instanceof`,
 * y un doble de la clase haria pasar el test con la rama equivocada.
 */
vi.mock('@/lib/cliente', async (original) => ({
  ...(await original<typeof import('@/lib/cliente')>()),
  pedir: pedirEspia,
}));

afterEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

function unAlumno(cambios: Partial<UsuarioResumen> = {}): UsuarioResumen {
  return {
    id: 'u1',
    tenantId: 't-del-gimnasio',
    nombreCompleto: 'Ana Gomez',
    email: 'ana@gym.test',
    rol: 'ALUMNO',
    activo: true,
    perfilId: 'perfil-de-ana',
    telefono: null,
    packId: null,
    pagoAlDia: true,
    salaIds: [],
    ...cambios,
  };
}

/**
 * Monta la pantalla con su propio `QueryClient`.
 *
 * La lista se SIEMBRA en la cache cuando el test la da, para que el primer
 * pintado ya la tenga y los tests que miran el DOM no necesiten esperar. La
 * clave se calcula con `filtrosDeLaBusqueda`, que es la misma funcion que usa
 * la pagina: si el test la reimplementara, una pantalla que lea mal la URL
 * seguiria encontrando su dato sembrado y el test no se enteraria.
 *
 * Sembrar no apaga la peticion: la consulta nace rancia y se pide igual, que es
 * lo que mira el test de "lee los filtros DE la URL".
 */
function montar({
  usuarios,
  error,
  busqueda: textoDeBusqueda = '',
}: {
  usuarios?: UsuarioResumen[];
  error?: unknown;
  busqueda?: string;
} = {}): QueryClient {
  busqueda.parametros = new URLSearchParams(textoDeBusqueda);

  pedirEspia.mockImplementation(() =>
    error === undefined ? Promise.resolve(usuarios ?? []) : Promise.reject(error),
  );

  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  if (usuarios !== undefined) {
    cliente.setQueryData(
      clavesDeUsuarios.lista(filtrosDeLaBusqueda(busqueda.parametros)),
      usuarios,
    );
  }

  render(
    <QueryClientProvider client={cliente}>
      <PaginaDePersonas />
    </QueryClientProvider>,
  );

  return cliente;
}

/** Deja que la consulta se resuelva (o se rompa) y que React pinte lo que sigue. */
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
 * `selectOptions` con una cadena busca por `value`, y el valor es el de la API
 * (`alumno`), no el de la pantalla (`Alumnos`). Pasarle el `value` ataria el
 * test al contrato y no a lo que hay en la pantalla.
 */
async function elegirFiltro(etiqueta: string, opcion: string): Promise<void> {
  const usuario = userEvent.setup();
  const control = screen.getByLabelText(etiqueta);
  const elegida = [...control.querySelectorAll('option')].find(
    (option) => option.textContent?.trim() === opcion,
  );

  if (elegida === undefined) throw new Error(`El filtro "${etiqueta}" no tiene "${opcion}"`);

  await usuario.selectOptions(control, elegida);
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

/**
 * Los botones QUE HAY EN EL MARCADO, sin pasar por el arbol de accesibilidad.
 *
 * `queryByRole('button')` excluye por su cuenta lo que lleva `hidden`,
 * `aria-hidden` o `display:none`: con el se puede afirmar que algo no SE VE,
 * no que no ESTA. Se midio — un "Reintentar" dibujado con `hidden` pasaba el
 * test de abajo en verde.
 */
function botonesDelDocumento(): string[] {
  return [...document.querySelectorAll('button')].map((boton) => boton.textContent?.trim() ?? '');
}

function columnasDelDocumento(): string[] {
  return [...document.querySelectorAll('th')].map((th) => th.textContent?.trim() ?? '');
}

/** El contenido de cada fila, celda a celda. */
function filasDelDocumento(): string[][] {
  return [...document.querySelectorAll('tbody tr')].map((tr) =>
    [...tr.querySelectorAll('td')].map((td) => td.textContent?.trim() ?? ''),
  );
}

describe('el listado de personas', () => {
  // LISTA BLANCA: el conjunto ENTERO. Una columna de mas —el error que ningun
  // test de presencia ve— rompe esto.
  it('muestra ESTAS columnas y solo estas', () => {
    montar({ usuarios: [unAlumno()] });

    expect(columnasDelDocumento()).toEqual(['Nombre', 'Email', 'Rol', 'Estado', 'Pago al dia']);
  });

  it('los filtros viajan en la URL, no en estado', async () => {
    montar({ usuarios: [] });

    await elegirFiltro('Tipo', 'Alumnos');

    expect(empujar).toHaveBeenCalledWith('/mi-gym/admin/usuarios?tipo=alumno');
  });

  it('lee los filtros DE la URL al cargar', () => {
    montar({ usuarios: [], busqueda: '?tipo=profesor&activo=false' });

    expect(pedirEspia).toHaveBeenCalledWith('/usuarios?tipo=profesor&activo=false');
  });

  it('sin resultados lo dice, y no deja una tabla vacia', () => {
    montar({ usuarios: [] });

    expect(screen.getByText(/no hay nadie/i)).toBeInTheDocument();
    expect(document.querySelector('table')).toBeNull();
  });

  it('un 401 manda al login', async () => {
    montar({ error: new ErrorDeApi('Sin sesion', 401) });

    await esperar();

    expect(empujar).toHaveBeenCalledWith(expect.stringContaining('/mi-gym/login'));
  });

  it('un error de red se distingue del rechazo y se puede reintentar', async () => {
    montar({ error: new ErrorDeApi('Sin conexion', 0) });

    await esperar();

    expect(screen.getByText(/sin conexion/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reintentar/i })).toBeInTheDocument();
  });

  it('cada fila enlaza a SU ficha', () => {
    montar({ usuarios: [unAlumno({ id: 'u1' }), unAlumno({ id: 'u2' })] });

    const fichas = [...document.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(fichas).toEqual(['/mi-gym/admin/usuarios/u1', '/mi-gym/admin/usuarios/u2']);
  });
});

// ---------------------------------------------------------------------------
// Las columnas fijan los ENCABEZADOS; esto fija lo que hay DEBAJO
// ---------------------------------------------------------------------------

describe('el contenido de una fila', () => {
  it('cada fila tiene EXACTAMENTE una celda por columna, con este contenido', () => {
    // Una celda de mas no la ve el test de los `<th>`: se puede pintar un `<td>`
    // sin encabezado y la lista blanca de arriba sigue en verde.
    montar({
      usuarios: [
        unAlumno({ nombreCompleto: 'Ana Gomez', rol: 'ALUMNO', activo: true, pagoAlDia: true }),
        unAlumno({
          id: 'u2',
          nombreCompleto: 'Beto Diaz',
          email: 'beto@gym.test',
          rol: 'PROFESOR',
          activo: false,
          pagoAlDia: false,
        }),
      ],
    });

    expect(filasDelDocumento()).toEqual([
      ['Ana Gomez', 'ana@gym.test', 'Alumno', 'Activo', 'Al dia'],
      ['Beto Diaz', 'beto@gym.test', 'Profesor', 'Dado de baja', 'Debe'],
    ]);
  });

  it('el rol sale legible y no con el nombre del enum', () => {
    montar({ usuarios: [unAlumno({ rol: 'ADMIN_OPERATIVO' })] });

    expect(screen.getByText('Admin operativo')).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain('ADMIN_OPERATIVO');
  });
});

/**
 * LO QUE NO TIENE QUE LLEGAR AL NAVEGADOR.
 *
 * `UsuarioResumen` trae cuatro campos que ninguna columna necesita. Pintarlos
 * en un `data-*`, en un `title` o en una celda oculta por CSS no lo ve ningun
 * test de presencia, y el `tenantId` de un gimnasio en el DOM de la pantalla de
 * otro es exactamente el agujero que la Fase 0 cerro en la API.
 */
describe('al DOM no llega lo que ninguna columna necesita', () => {
  it('ni tenantId, ni perfilId, ni telefono, ni packId, ni salaIds', () => {
    montar({
      usuarios: [
        unAlumno({
          tenantId: 'tenant-secreto',
          perfilId: 'perfil-secreto',
          telefono: '+54 9 11 5555-5555',
          packId: 'pack-secreto',
          salaIds: ['sala-secreta'],
        }),
      ],
    });

    const html = document.body.innerHTML;
    for (const valor of [
      'tenant-secreto',
      'perfil-secreto',
      '+54 9 11 5555-5555',
      'pack-secreto',
      'sala-secreta',
    ]) {
      expect(html).not.toContain(valor);
    }
  });
});

// ---------------------------------------------------------------------------
// Los filtros, enteros
// ---------------------------------------------------------------------------

describe('los filtros', () => {
  it('se navega UNA sola vez por cambio', async () => {
    // `toHaveBeenCalledWith` nunca pregunta cuantas veces: un `push` de mas
    // antes del bueno pasa por delante de todos los tests de destino, y en la
    // pantalla se ve como un parpadeo y una entrada basura en el historial.
    montar({ usuarios: [] });

    await elegirFiltro('Tipo', 'Alumnos');

    expect(empujar).toHaveBeenCalledTimes(1);
  });

  it('volver a "Todos" saca el filtro de la URL, no lo manda vacio', async () => {
    // `?tipo=` vacio no es "sin filtro": el pipe de la API lo rechazaria.
    montar({ usuarios: [], busqueda: '?tipo=alumno' });

    await elegirFiltro('Tipo', 'Todos');

    expect(empujar).toHaveBeenCalledWith('/mi-gym/admin/usuarios');
  });

  it('cambiar un filtro conserva los otros', async () => {
    montar({ usuarios: [], busqueda: '?activo=true' });

    await elegirFiltro('Tipo', 'Alumnos');

    expect(empujar).toHaveBeenCalledWith('/mi-gym/admin/usuarios?activo=true&tipo=alumno');
  });

  it('los selectores muestran lo que dice la URL', () => {
    montar({ usuarios: [], busqueda: '?tipo=profesor&activo=false&autoRegistrado=true' });

    expect(screen.getByLabelText('Tipo')).toHaveValue('profesor');
    expect(screen.getByLabelText('Estado')).toHaveValue('false');
    expect(screen.getByLabelText('Alta')).toHaveValue('true');
  });

  it('un valor imposible en la URL no se manda a la API ni se pinta', () => {
    // La URL la escribe cualquiera. `?tipo=SUPERADMIN` con un `tipo` que la API
    // no conoce es un 400 y una pantalla en blanco.
    montar({ usuarios: [], busqueda: '?tipo=SUPERADMIN&activo=quiza' });

    expect(pedirEspia).toHaveBeenCalledWith('/usuarios');
    expect(screen.getByLabelText('Tipo')).toHaveValue('');
    expect(screen.getByLabelText('Estado')).toHaveValue('');
  });
});

// ---------------------------------------------------------------------------
// Los fallos
// ---------------------------------------------------------------------------

describe('cuando la peticion falla', () => {
  it('un 401 NO ofrece reintentar: reintentar sin sesion es volver a fallar', async () => {
    montar({ error: new ErrorDeApi('Sin sesion', 401) });

    await esperar();

    expect(botonesDelDocumento()).not.toContain('Reintentar');
  });

  it('un error de red NO manda al login: la sesion no tiene la culpa', async () => {
    montar({ error: new ErrorDeApi('Sin conexion', 0) });

    await esperar();

    // Echar a alguien al login por un tunel sin cobertura le hace perder la
    // sesion de verdad, y al volver tiene que escribir la contraseña.
    expect(empujar).not.toHaveBeenCalled();
  });

  it('reintentar vuelve a pedir la lista', async () => {
    montar({ error: new ErrorDeApi('Sin conexion', 0) });
    await esperar();

    const usuario = userEvent.setup();
    await usuario.click(screen.getByRole('button', { name: /reintentar/i }));
    await esperar();

    expect(pedirEspia.mock.calls.length).toBeGreaterThan(1);
  });

  it('el 401 manda al login de SU gimnasio y con la vuelta a esta pantalla', async () => {
    montar({ error: new ErrorDeApi('Sin sesion', 401) });

    await esperar();

    expect(empujar).toHaveBeenCalledWith(
      `/mi-gym/login?volverA=${encodeURIComponent('/mi-gym/admin/usuarios')}`,
    );
    expect(empujar).toHaveBeenCalledTimes(1);
  });

  /**
   * EL `volverA` SE LLEVA LOS FILTROS.
   *
   * El test de arriba monta SIN filtros, asi que fijaba el destino en el unico
   * caso donde no hay nada que conservar: pasaba igual con un `volverA` que se
   * lleva el query y con uno que lo tira. Se midio — el helper que descarta el
   * query lo dejaba en verde.
   *
   * Y lo que se tira no es un detalle: quien acaba de armar una busqueda vuelve
   * del login al listado entero, sin entender por que. El repo ya tenia ese
   * veredicto escrito en `admin/layout.tsx` sobre este mismo patron: «NO
   * CONSERVABA NADA ... Parecia que funcionaba, que es peor que no estar».
   *
   * No se comprueba COMO se escribio la cadena sino que SOBREVIVE el viaje: el
   * destino se pasa por `rutaDeRetornoSegura`, que es quien decide a donde
   * aterriza de verdad.
   */
  it('el volverA conserva los filtros, y sobrevive a rutaDeRetornoSegura', async () => {
    montar({ error: new ErrorDeApi('Sin sesion', 401), busqueda: '?tipo=profesor&activo=false' });

    await esperar();

    const [destino] = empujar.mock.calls[0] as [string];
    const volverA = new URL(destino, 'http://x').searchParams.get('volverA');

    expect(rutaDeRetornoSegura(volverA ?? undefined, 'mi-gym')).toBe(
      '/mi-gym/admin/usuarios?tipo=profesor&activo=false',
    );
  });
});

/**
 * LO QUE LA PANTALLA PIDE, Y LO QUE DEJA GUARDADO.
 *
 * Todos los tests de arriba miran el DOM. Ninguno mira la CACHE, y la cache la
 * comparte toda la aplicacion y sobrevive a la navegacion. Precargar la ficha
 * de cada fila "para que la ficha abra instantanea" es una linea, no se ve en
 * ninguna pantalla, y se trae la `fichaMedica` de TODO el listado al navegador
 * del mostrador: N peticiones y N fichas medicas por pintar una lista.
 */
describe('pintar el listado no trae nada mas', () => {
  it('es UNA sola peticion, y es la de la lista', async () => {
    montar({ usuarios: [unAlumno({ id: 'u1' }), unAlumno({ id: 'u2' })] });

    await esperar();

    expect(pedirEspia.mock.calls.map(([ruta]) => ruta)).toEqual(['/usuarios']);
  });

  /**
   * LO QUE QUEDA EN EL NAVEGADOR CUANDO LA PANTALLA SE CIERRA.
   *
   * La cache de consultas se muere con la pestaña. `localStorage` no: sobrevive
   * al cierre del navegador, al logout y al cambio de turno. Guardar ahi "la
   * ultima lista, para que abra instantanea" deja los nombres, los emails y el
   * `tenantId` de TODO el gimnasio en el disco de una maquina de mostrador que
   * usan cuatro personas, y los deja legibles desde la consola de cualquiera
   * que se siente delante — incluido un alumno esperando su turno.
   *
   * Ningun test de los de arriba lo veia: todos miran el DOM, la URL o lo que
   * se pide. Esta mutacion sobrevivio a los 30 antes de existir este test.
   *
   * Se miran los DOS almacenes y ENTEROS, no una clave concreta: una lista
   * negra ("que no este `boxadmin:personas`") siempre va una clave por detras.
   */
  it('no queda nada en el almacenamiento del navegador', async () => {
    montar({ usuarios: [unAlumno({ id: 'u1' }), unAlumno({ id: 'u2' })] });

    await esperar();

    expect({
      local: contenidoDe(localStorage),
      sesion: contenidoDe(sessionStorage),
    }).toEqual({ local: {}, sesion: {} });
  });

  it('en la cache no queda ni una ficha', async () => {
    const cliente = montar({ usuarios: [unAlumno({ id: 'u1' }), unAlumno({ id: 'u2' })] });

    await esperar();

    expect(
      cliente
        .getQueryCache()
        .getAll()
        .map((consulta) => consulta.queryKey),
    ).toEqual([['usuarios', {}]]);
  });
});
