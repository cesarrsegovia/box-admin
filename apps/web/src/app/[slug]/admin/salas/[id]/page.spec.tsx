import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { aFechaISO, type RolUsuario, type SalaPublica, type TurnoPublico } from '@boxadmin/shared';
import { ErrorDeApi } from '@/lib/cliente';
import { clavesDeSalas } from '@/hooks/use-salas-admin';
import { clavesDeTurnos } from '@/hooks/use-turnos';
import { vigilarEstosDatos } from '@/test/espia-de-consola';
import { ProveedorDeRol } from '../../rol-del-panel';
import PaginaDeFichaDeSala from './page';

/**
 * Lo que esta ficha siembra y no puede escaparse por los canales que no son el
 * DOM. El tapon global de `vitest.setup.ts` lo vigila en los tres —consola,
 * `document.title` y `window.name`— en todos los tests de este archivo.
 */
const CENTINELAS = {
  tenantIdDelGimnasio: 'tnt-centinela',
  nombreDeLaSala: 'Sala-Pilates-Marcador',
};

vigilarEstosDatos(CENTINELAS);

const { empujar, pedirEspia } = vi.hoisted(() => ({
  empujar: vi.fn(),
  pedirEspia: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: empujar, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({ slug: 'mi-gym', id: 's1' }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/mi-gym/admin/salas/s1',
}));

/**
 * Se dobla `pedir`, no `fetch`. Lo que se audita aqui es QUE pide la ficha y
 * QUE CUERPO manda. `ErrorDeApi` se deja REAL: la pantalla ramifica con
 * `instanceof` y con `.estado`.
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
    nombre: CENTINELAS.nombreDeLaSala,
    activa: true,
    visibleAlumnos: true,
    soloCuposLiberados: false,
    exclusiva: false,
    cupoBase: null,
    minMinutosCancelar: null,
    minMinutosAnotarse: null,
    listaEsperaHabilitada: null,
    ...cambios,
  };
}

function unTurno(cambios: Partial<TurnoPublico> = {}): TurnoPublico {
  return {
    id: 't1',
    tenantId: CENTINELAS.tenantIdDelGimnasio,
    salaId: 's1',
    nombre: 'Funcional',
    fecha: '2026-12-01',
    horaInicio: '08:00',
    horaFin: '09:00',
    cupo: 10,
    reservasActivas: 0,
    lugaresLibres: 10,
    profesor: null,
    ...cambios,
  };
}

/**
 * Hoy, calculado APARTE de `aFechaISO`.
 *
 * La pantalla usa `aFechaISO(new Date())` para pedir los turnos «de hoy en
 * adelante», que es la misma funcion sobre la que esta escrito el
 * `comienzoDeHoyUtc()` de la API. Si el test reusara esa funcion para afirmar,
 * se estaria comparando contra si mismo: una pantalla que pidiera el dia
 * equivocado seguiria en verde. Se recalcula con otra expresion.
 */
const HOY = new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Andamiaje
// ---------------------------------------------------------------------------

function montar({
  sala = unaSala(),
  turnos = [],
  error,
  errorDeTurnos,
  rol = 'ADMIN_SALON',
  conProveedor = true,
}: {
  sala?: SalaPublica;
  turnos?: TurnoPublico[];
  error?: unknown;
  errorDeTurnos?: unknown;
  rol?: RolUsuario;
  conProveedor?: boolean;
} = {}): QueryClient {
  pedirEspia.mockImplementation((ruta: string) => {
    if (ruta.startsWith('/turnos')) {
      return errorDeTurnos === undefined ? Promise.resolve(turnos) : Promise.reject(errorDeTurnos);
    }
    return error === undefined ? Promise.resolve(sala) : Promise.reject(error);
  });

  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  // Sembrado para que el primer pintado ya lo tenga. La clave de los turnos se
  // arma con `aFechaISO`, que es lo que la pantalla usa: sembrar con otra fecha
  // dejaria la consulta pendiente para siempre y los tests de la baja mirando
  // el cartel de «comprobando».
  if (error === undefined) cliente.setQueryData(clavesDeSalas.una('s1'), sala);
  if (errorDeTurnos === undefined) {
    cliente.setQueryData(
      clavesDeTurnos.lista({ salaId: 's1', desde: aFechaISO(new Date()) }),
      turnos,
    );
  }

  const pantalla = <PaginaDeFichaDeSala />;

  render(
    <QueryClientProvider client={cliente}>
      {conProveedor ? <ProveedorDeRol rol={rol}>{pantalla}</ProveedorDeRol> : pantalla}
    </QueryClientProvider>,
  );

  return cliente;
}

async function esperar(): Promise<void> {
  await act(async () => {
    for (let vuelta = 0; vuelta < 5; vuelta += 1) {
      await new Promise((resolver) => setTimeout(resolver, 0));
    }
  });
}

function botonesDelDocumento(): string[] {
  return [...document.querySelectorAll('button')].map((boton) => boton.textContent?.trim() ?? '');
}

/** Las etiquetas de todos los controles que la ficha dibuja. */
function etiquetasDelDocumento(): string[] {
  return [...document.querySelectorAll('label')].map((label) => label.textContent?.trim() ?? '');
}

/** Las rutas pedidas, EN ORDEN y sin deduplicar. */
function rutasPedidas(): string[] {
  return pedirEspia.mock.calls.map(([ruta]) => ruta as string);
}

/** El cuerpo de la escritura numero `indice`. */
function cuerpoEnviado(indice = 0): unknown {
  const escrituras = pedirEspia.mock.calls.filter(
    ([, opciones]) => (opciones as { metodo?: string } | undefined)?.metodo !== undefined,
  );
  const llamada = escrituras[indice];
  if (llamada === undefined) throw new Error(`No hubo escritura numero ${indice}`);

  return (llamada[1] as { cuerpo?: unknown }).cuerpo;
}

function metodoEnviado(indice = 0): string {
  const escrituras = pedirEspia.mock.calls.filter(
    ([, opciones]) => (opciones as { metodo?: string } | undefined)?.metodo !== undefined,
  );
  const llamada = escrituras[indice];
  if (llamada === undefined) throw new Error(`No hubo escritura numero ${indice}`);

  return String((llamada[1] as { metodo?: string }).metodo);
}

// ---------------------------------------------------------------------------
// Los ocho ajustes
// ---------------------------------------------------------------------------

describe('los ajustes de la sala', () => {
  /**
   * LISTA BLANCA de controles: los OCHO y ninguno mas.
   *
   * `SalaPublica` trae NUEVE campos editables. El noveno es `exclusiva` y no
   * se dibuja: ver el test de abajo.
   */
  it('dibuja ESTOS ajustes y solo estos', () => {
    montar({ sala: unaSala({ cupoBase: 12, minMinutosCancelar: 30 }) });

    expect(etiquetasDelDocumento()).toEqual([
      'Nombre',
      'Activa',
      'Visible para alumnos',
      'Solo cupos liberados',
      'Cupo base',
      'Cupo base (valor propio)',
      'Minutos para cancelar',
      'Minutos para cancelar (valor propio)',
      'Minutos para anotarse',
      'Lista de espera',
    ]);
  });

  /**
   * `exclusiva` ES UN CAMPO MUERTO.
   *
   * Se escribe en el alta (`salas.service.ts`, `exclusiva: dto.exclusiva ??
   * false`) y se mapea al contrato en `aSalaPublica`. Y ahi se acaba: ninguna
   * regla del sistema lo lee —ni la disponibilidad, ni el planificador del mes,
   * ni los packs, ni la visibilidad—. Un interruptor que no cambia nada es peor
   * que no tenerlo.
   *
   * SE AFIRMA SOBRE EL MARCADO, no con `queryByRole`. `queryByRole` consulta el
   * arbol de accesibilidad, que ya excluye por su cuenta lo que lleva `hidden`,
   * `aria-hidden` o `display:none`: un control escondido con `hidden` pasaria
   * ese test en verde y seguiria en el HTML que llego al navegador.
   */
  it('NO dibuja el campo exclusiva', () => {
    montar({ sala: unaSala({ exclusiva: true }) });

    expect(document.body.innerHTML).not.toMatch(/exclusiv/i);
  });

  it('el tenantId no llega al marcado', () => {
    montar();

    expect(document.body.innerHTML).not.toContain(CENTINELAS.tenantIdDelGimnasio);
  });

  it('una sala de baja se distingue de una activa', () => {
    montar({ sala: unaSala({ activa: false }) });
    expect(screen.getByText(/esta sala esta de baja/i)).toBeInTheDocument();

    cleanupManual();

    montar({ sala: unaSala({ activa: true }) });
    expect(screen.queryByText(/esta sala esta de baja/i)).toBeNull();
  });
});

/** Desmonta lo pintado para poder montar dos veces en el mismo test. */
function cleanupManual(): void {
  document.body.innerHTML = '';
}

// ---------------------------------------------------------------------------
// El tercer estado
// ---------------------------------------------------------------------------

describe('los cuatro ajustes heredables', () => {
  /**
   * HEREDAR, UN VALOR PROPIO Y CERO SON TRES COSAS DISTINTAS.
   *
   * `minMinutosCancelar: null` significa «hereda del gimnasio», y la herencia
   * es REAL: `disponibilidad.service.ts` resuelve la cascada `Sala ?? Tenant ??
   * sistema` y el Tenant tiene esa columna. `minMinutosCancelar: 0` significa
   * «se puede cancelar hasta el ultimo minuto», y el DTO lo acepta (`@Min(0)`,
   * comprobado contra el ValidationPipe real).
   *
   * Un control de dos estados tendria que meter los dos en el mismo hueco, y
   * entonces «apagado» significaria a veces una cosa y a veces la otra. Se
   * miran los TRES a la vez —lo que se pinta y lo que se manda— porque el fallo
   * que importa es que dos de ellos se confundan, y eso no se ve mirando uno.
   */
  it('heredar, un valor propio y CERO son tres cosas distintas', async () => {
    async function estadoYCuerpo(
      valor: number | null,
    ): Promise<{ origen: string; propio: string | null; cuerpo: unknown }> {
      montar({ sala: unaSala({ minMinutosCancelar: valor }) });

      const origen = screen.getByLabelText('Minutos para cancelar') as HTMLSelectElement;
      const propio = screen.queryByLabelText(
        'Minutos para cancelar (valor propio)',
      ) as HTMLInputElement | null;

      const estado = { origen: origen.value, propio: propio === null ? null : propio.value };

      await userEvent.click(screen.getByRole('button', { name: 'Guardar minutos para cancelar' }));
      await esperar();

      const cuerpo = cuerpoEnviado();
      pedirEspia.mockClear();
      cleanupManual();

      return { ...estado, cuerpo };
    }

    const hereda = await estadoYCuerpo(null);
    const cero = await estadoYCuerpo(0);
    const propio = await estadoYCuerpo(45);

    // Lo que se MANDA: tres cuerpos distintos.
    expect(hereda.cuerpo).toEqual({ minMinutosCancelar: null });
    expect(cero.cuerpo).toEqual({ minMinutosCancelar: 0 });
    expect(propio.cuerpo).toEqual({ minMinutosCancelar: 45 });

    // Y lo que se PINTA: tres estados distintos del control. Sin esto, una
    // pantalla que dibujara «hereda» sobre un cero seguiria mandando el cero
    // que tenia cargado y pasaria la mitad de arriba.
    expect(hereda.origen).toBe('heredado');
    expect(hereda.propio).toBeNull();
    expect(cero.origen).toBe('propio');
    expect(cero.propio).toBe('0');
    expect(propio.origen).toBe('propio');
    expect(propio.propio).toBe('45');
  });

  /**
   * GUARDAR UN AJUSTE NO PISA LA HERENCIA DE LOS OTROS TRES.
   *
   * Un formulario unico con un «Guardar» al final manda SIEMPRE las ocho
   * claves, y los cuatro heredables viajarian con lo que esta pantalla cargo
   * hace cinco minutos. El admin que define el cupo base de una sala le borra
   * sin enterarse la herencia que otro configuro mientras tanto — y en silencio,
   * porque el PATCH contesta 200.
   */
  it('guardar un ajuste NO pisa la herencia de los otros tres', async () => {
    montar({ sala: unaSala({ cupoBase: null }) });

    await userEvent.selectOptions(screen.getByLabelText('Cupo base'), 'propio');
    await userEvent.type(screen.getByLabelText('Cupo base (valor propio)'), '12');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cupo base' }));
    await esperar();

    expect(cuerpoEnviado()).toEqual({ cupoBase: 12 });
    expect(metodoEnviado()).toBe('PATCH');
  });

  /**
   * VOLVER A HEREDAR MANDA `null` EXPLICITO, NO OMITE LA CLAVE.
   *
   * Omitir la clave es el PATCH de «no toques esto», que es exactamente lo
   * contrario de lo que la persona acaba de pedir: la sala se quedaria con su
   * valor propio y la pantalla diria que hereda.
   *
   * Que el `null` llegue hasta la base esta comprobado contra el ValidationPipe
   * REAL del repo (`whitelist`, `forbidNonWhitelisted`, `transform`):
   * `@IsOptional()` salta la validacion cuando el valor es null, el whitelist
   * conserva la clave porque la propiedad SI esta decorada, y el service hace
   * `data: { ...dto }`.
   */
  it('volver a heredar manda null EXPLICITO, no omite la clave', async () => {
    montar({ sala: unaSala({ cupoBase: 12 }) });

    await userEvent.selectOptions(screen.getByLabelText('Cupo base'), 'heredado');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cupo base' }));
    await esperar();

    expect(cuerpoEnviado()).toEqual({ cupoBase: null });
    // Y la clave esta de verdad, no es un `undefined` que `toEqual` perdona.
    expect(Object.keys(cuerpoEnviado() as object)).toEqual(['cupoBase']);
  });

  /**
   * EL `null` DE `cupoBase` NO ES HERENCIA, y la pantalla no lo puede llamar
   * asi.
   *
   * El modelo `Tenant` dice por escrito que `cupoBase` NO se agrega alli
   * «aunque Sala lo tenga», porque el planificador de la Fase 2 reporta
   * `SALA_SIN_CUPO_BASE` como conflicto y un fallback del gimnasio cambiaria
   * ese detector en silencio. Los otros tres SI heredan. Prometer una herencia
   * que no existe acaba en un mes que no se genera y nadie sabe por que.
   */
  it('el cupo base sin definir NO se anuncia como herencia del gimnasio', () => {
    montar({ sala: unaSala({ cupoBase: null }) });

    const cupo = screen.getByLabelText('Cupo base') as HTMLSelectElement;
    const espera = screen.getByLabelText('Lista de espera') as HTMLSelectElement;

    const textoDe = (control: HTMLSelectElement): string =>
      [...control.options].map((opcion) => opcion.textContent?.trim() ?? '').join(' | ');

    expect(textoDe(cupo)).not.toMatch(/hereda/i);
    expect(textoDe(cupo)).toMatch(/sin definir/i);
    // Y el que SI hereda lo dice: sin esto, el test pasaria tambien en una
    // pantalla que no mencionara la herencia en ningun sitio.
    expect(textoDe(espera)).toMatch(/hereda del gimnasio/i);
  });

  it('un cupo base de cero no llega al servidor: el DTO lo rechaza con un 400', async () => {
    // `@Min(1)`. Adivinarlo aqui le ahorra a quien esta en el mostrador un
    // error que dice «cupoBase must not be less than 1».
    montar({ sala: unaSala({ cupoBase: null }) });

    await userEvent.selectOptions(screen.getByLabelText('Cupo base'), 'propio');
    await userEvent.type(screen.getByLabelText('Cupo base (valor propio)'), '0');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cupo base' }));
    await esperar();

    expect(() => cuerpoEnviado()).toThrow();
    expect(screen.getByText(/de 1 para arriba/i)).toBeInTheDocument();
  });

  it('la lista de espera distingue heredar de «no»', async () => {
    montar({ sala: unaSala({ listaEsperaHabilitada: false }) });

    expect((screen.getByLabelText('Lista de espera') as HTMLSelectElement).value).toBe('propio');
    expect(
      (screen.getByLabelText('Lista de espera (valor propio)') as HTMLSelectElement).value,
    ).toBe('false');

    await userEvent.click(screen.getByRole('button', { name: 'Guardar lista de espera' }));
    await esperar();

    expect(cuerpoEnviado()).toEqual({ listaEsperaHabilitada: false });
  });
});

// ---------------------------------------------------------------------------
// El bloque de datos
// ---------------------------------------------------------------------------

describe('los datos de la sala', () => {
  it('manda solo lo que cambio', async () => {
    montar({ sala: unaSala({ nombre: 'Sala 1', visibleAlumnos: true }) });

    await userEvent.selectOptions(screen.getByLabelText('Visible para alumnos'), 'false');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar datos' }));
    await esperar();

    expect(cuerpoEnviado()).toEqual({ visibleAlumnos: false });
  });

  it('sin cambios no sale ninguna peticion', async () => {
    montar();

    await userEvent.click(screen.getByRole('button', { name: 'Guardar datos' }));
    await esperar();

    expect(() => cuerpoEnviado()).toThrow();
    expect(screen.getByText(/no cambiaste nada/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// El rol
// ---------------------------------------------------------------------------

describe('quien puede escribir', () => {
  /**
   * Las cuatro escrituras de salas piden `ADMIN_SALON`: un `ADMIN_OPERATIVO` no
   * tiene NI UN boton de escritura en esta ficha. Y no se le dibujan los
   * formularios con los botones quitados: unos campos editables que no se
   * pueden guardar son una promesa falsa.
   *
   * SE AFIRMA SOBRE EL MARCADO. `queryByRole` no distingue «no esta» de «esta
   * escondido con `hidden`», porque el arbol de accesibilidad ya excluye lo
   * segundo.
   */
  it('un ADMIN_OPERATIVO no ve NINGUN boton de escritura, en el marcado', () => {
    montar({ rol: 'ADMIN_OPERATIVO', sala: unaSala({ cupoBase: 12 }) });

    expect(botonesDelDocumento()).toEqual([]);
    expect(document.body.innerHTML).not.toMatch(/guardar/i);
    expect(document.body.innerHTML).not.toMatch(/dar de baja/i);
    // Y tampoco los controles, que son la otra mitad de la promesa falsa.
    expect(document.querySelector('form')).toBeNull();
    expect(document.querySelector('input')).toBeNull();
    expect(document.querySelector('select')).toBeNull();
  });

  it('pero si ve los valores, incluidos los tres estados en palabras', () => {
    // Un operativo necesita saber POR QUE una sala no genera turnos.
    montar({ rol: 'ADMIN_OPERATIVO', sala: unaSala({ cupoBase: null, minMinutosCancelar: 0 }) });

    expect(screen.getByText('Sin definir')).toBeInTheDocument();
    expect(screen.getByText('0 minutos')).toBeInTheDocument();
    expect(screen.getAllByText('Hereda del gimnasio').length).toBeGreaterThan(0);
  });

  it('un ADMIN_SALON si los ve', () => {
    montar({ rol: 'ADMIN_SALON', sala: unaSala({ cupoBase: 12 }) });

    expect(botonesDelDocumento()).toEqual([
      'Guardar datos',
      'Guardar cupo base',
      'Guardar minutos para cancelar',
      'Guardar minutos para anotarse',
      'Guardar lista de espera',
      'Dar de baja la sala',
    ]);
  });

  it('un SUPERADMIN tambien, porque los roles son jerarquicos', () => {
    montar({ rol: 'SUPERADMIN' });

    expect(screen.getByRole('button', { name: 'Guardar datos' })).toBeInTheDocument();
  });

  /**
   * SIN PROVEEDOR DE ROL, NADA.
   *
   * El contexto lo pone el armazon del panel. Si esta ficha acabara fuera de
   * ese armazon, el rol llega `null` y eso tiene que significar «no alcanza
   * para nada», no «no se sabe, dibujalo igual».
   */
  it('sin proveedor de rol tampoco se dibujan', () => {
    montar({ conProveedor: false });

    expect(botonesDelDocumento()).toEqual([]);
    expect(document.body.innerHTML).not.toMatch(/guardar/i);
  });
});

// ---------------------------------------------------------------------------
// La baja
// ---------------------------------------------------------------------------

describe('dar de baja la sala', () => {
  /**
   * LA REGLA SE SABE ANTES DEL CLIC.
   *
   * La API cuenta los turnos de hoy en adelante y contesta 409. Ofrecer el
   * boton, abrir el dialogo, pedir confirmacion y recien entonces decir que no
   * se puede convierte una regla conocida en un error. Y no se «deshabilita»:
   * un boton deshabilitado sigue en el DOM.
   */
  it('dar de baja dice ANTES si hay turnos futuros', () => {
    montar({ turnos: [unTurno({ id: 't1' }), unTurno({ id: 't2' })] });

    expect(screen.getByText(/2 turno\(s\) de hoy en adelante/i)).toBeInTheDocument();
    expect(botonesDelDocumento()).not.toContain('Dar de baja la sala');
    expect(document.body.innerHTML).not.toMatch(/dar de baja la sala/i);
  });

  it('los cuenta con el mismo corte que la API: de hoy en adelante y de ESTA sala', () => {
    montar();

    expect(rutasPedidas()).toContain(`/turnos?desde=${HOY}&salaId=s1`);
  });

  it('sin turnos futuros si lo ofrece', () => {
    montar({ turnos: [] });

    expect(screen.getByRole('button', { name: 'Dar de baja la sala' })).toBeInTheDocument();
  });

  it('la pregunta nombra la sala', async () => {
    montar({ turnos: [] });

    await userEvent.click(screen.getByRole('button', { name: 'Dar de baja la sala' }));

    expect(screen.getByRole('dialog')).toHaveTextContent(CENTINELAS.nombreDeLaSala);
  });

  it('confirmar manda un DELETE', async () => {
    montar({ turnos: [] });

    await userEvent.click(screen.getByRole('button', { name: 'Dar de baja la sala' }));
    await userEvent.click(screen.getByRole('button', { name: 'Dar de baja' }));
    await esperar();

    expect(metodoEnviado()).toBe('DELETE');
  });

  /**
   * Y AUN ASI SE MANEJA EL 409.
   *
   * El recuento es el de la ultima lectura. Entre esa lectura y la
   * confirmacion, alguien publica el mes que viene desde el calendario y la
   * sala pasa de cero turnos a treinta. Sin esto, el dialogo se cerraria y el
   * admin daria por dada de baja una sala viva.
   */
  it('y maneja el 409 igual, por si publican un mes en el medio', async () => {
    montar({ turnos: [] });

    const mensaje =
      'La sala tiene 30 turno(s) de hoy en adelante. Borralos o reasignalos antes de darla de baja.';
    pedirEspia.mockRejectedValueOnce(new ErrorDeApi(mensaje, 409, { message: mensaje }));

    await userEvent.click(screen.getByRole('button', { name: 'Dar de baja la sala' }));
    await userEvent.click(screen.getByRole('button', { name: 'Dar de baja' }));
    await esperar();

    expect(screen.getByText(mensaje)).toBeInTheDocument();
  });

  /**
   * LA SEGUNDA PUERTA A LA MISMA BAJA.
   *
   * `salas.service.ts` lo dice por escrito: «Un PATCH con activa:false da de
   * baja la sala igual que el DELETE, asi que pasa por la misma proteccion y se
   * audita igual». Las dos puertas pueden contestar el MISMO 409, y la que esta
   * dentro del formulario es justamente la que es facil olvidarse de manejar:
   * el error llega al `catch` del bloque de datos, no al del bloque de baja.
   */
  it('el interruptor de ACTIVA tambien puede devolver ese 409', async () => {
    montar({ turnos: [] });

    const mensaje =
      'La sala tiene 30 turno(s) de hoy en adelante. Borralos o reasignalos antes de darla de baja.';
    pedirEspia.mockRejectedValueOnce(new ErrorDeApi(mensaje, 409, { message: mensaje }));

    await userEvent.selectOptions(screen.getByLabelText('Activa'), 'false');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar datos' }));
    await esperar();

    expect(cuerpoEnviado()).toEqual({ activa: false });
    expect(screen.getByText(mensaje)).toBeInTheDocument();
  });

  /**
   * TRAS LA BAJA NO SE NAVEGA A NINGUN SITIO, al reves que con un turno.
   *
   * Alli el borrado es FISICO y quedarse dejaria la pantalla pidiendo un 404.
   * Aqui la baja es LOGICA: la fila sobrevive con `activa: false` y esta sigue
   * siendo su ficha. Mandar al listado seria perder de vista justo lo que se
   * acaba de cambiar.
   */
  it('tras darla de baja la ficha se queda donde estaba', async () => {
    montar({ turnos: [] });

    await userEvent.click(screen.getByRole('button', { name: 'Dar de baja la sala' }));
    await userEvent.click(screen.getByRole('button', { name: 'Dar de baja' }));
    await esperar();

    expect(empujar).not.toHaveBeenCalled();
  });

  it('una sala ya de baja no ofrece volver a darla de baja, y dice como reactivarla', () => {
    montar({ sala: unaSala({ activa: false }), turnos: [] });

    expect(botonesDelDocumento()).not.toContain('Dar de baja la sala');
    expect(screen.getByText(/para reactivarla/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Lo que la ficha PIDE
// ---------------------------------------------------------------------------

/**
 * LA LISTA BLANCA DE PETICIONES, que es la dimension que a esta ficha le
 * faltaba.
 *
 * Todo lo demas de este archivo mira el DOM y los CUERPOS que salen. Ninguna
 * de esas dos cosas ve una LECTURA de mas: una consulta que no se dibuja no
 * cambia ni un nodo del marcado y no manda ningun cuerpo. Se midio — un
 * `useSalas()` suelto en la pantalla, «para precalentar el catalogo y que
 * volver al listado sea instantaneo», paso los 74 tests de esta tarea y el
 * `tsc`.
 *
 * Y no es gratuito. Esa consulta trae el catalogo ENTERO en cada apertura de
 * cada ficha, lo deja en la cache compartida con media docena de pantallas
 * —con el `tenantId` de cada sala dentro— y la dispara tambien quien no puede
 * escribir nada. La forma del error es la de siempre: AGREGAR algo sin quitar
 * nada, donde no habia nadie mirando.
 *
 * Es LISTA BLANCA y no una lista negra: se fija el conjunto entero, en orden y
 * sin deduplicar. Preguntar «¿no pidio /usuarios?» va siempre una ruta por
 * detras de la proxima que a alguien se le ocurra pedir.
 */
describe('lo que la ficha pide', () => {
  it('salen ESTAS peticiones y ninguna mas', async () => {
    montar();
    await esperar();

    // ORDENADAS, no en el orden de salida: ese depende de que React corre los
    // efectos de los hijos antes que los del padre, y eso es un detalle de la
    // implementacion. Lo que NO es un detalle es cuantas son y cuales.
    expect([...rutasPedidas()].sort()).toEqual(
      ['/salas/s1', `/turnos?desde=${HOY}&salaId=s1`].sort(),
    );
  });

  /**
   * Y UN OPERATIVO NO PIDE LOS TURNOS.
   *
   * El recuento de turnos futuros existe para decidir si se ofrece la baja, y
   * a un `ADMIN_OPERATIVO` no se le ofrece. Pedirlo igual seria traerle la
   * agenda entera de la sala a quien no puede hacer nada con ella.
   *
   * El test de arriba, solo, no lo ve: alli el rol es `ADMIN_SALON` y las dos
   * peticiones son legitimas. Esta es la otra mitad.
   */
  it('un ADMIN_OPERATIVO pide la sala y nada mas', async () => {
    montar({ rol: 'ADMIN_OPERATIVO' });
    await esperar();

    expect(rutasPedidas()).toEqual(['/salas/s1']);
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
      `/mi-gym/login?volverA=${encodeURIComponent('/mi-gym/admin/salas/s1')}`,
    );
  });

  it('un fallo que no es de sesion si se puede reintentar', async () => {
    montar({ error: new ErrorDeApi('Se cayo la base', 500) });
    await esperar();

    expect(screen.getByText('Se cayo la base')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reintentar/i })).toBeInTheDocument();
  });
});
