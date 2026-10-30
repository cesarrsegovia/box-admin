import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { RutinaPublica } from '@boxadmin/shared';
import { ErrorDeApi } from '@/lib/cliente';
import { vigilarEstosDatos } from '@/test/espia-de-consola';
import { EditarRutina } from './editar-rutina';

const { pedirEspia } = vi.hoisted(() => ({ pedirEspia: vi.fn() }));

/** Se dobla `pedir`, no `fetch`: se audita el CUERPO que la pantalla manda. */
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

/**
 * Dos rutinas que NO se parecen en nada: dia, horario, nombre y fechas
 * distintos, para que ninguna asercion pueda acertar con el valor de la otra.
 * Una con fin y otra sin: la regla de `hasta` es distinta en cada caso.
 */
const RUTINA_CON_FIN: RutinaPublica = {
  id: 'r-con-fin',
  tenantId: 'tnt-centinela-edicion',
  perfilId: 'p1',
  salaId: 'sala-centinela-edicion',
  nombre: 'Pilates-Marcador',
  diaSemana: 2,
  horaInicio: '18:00',
  horaFin: '19:00',
  activa: true,
  desde: '2026-10-01',
  hasta: '2026-12-15',
};

const RUTINA_SIN_FIN: RutinaPublica = {
  id: 'r-sin-fin',
  tenantId: 'tnt-centinela-edicion',
  perfilId: 'p1',
  salaId: 'sala-b',
  nombre: 'Funcional-Marcador',
  diaSemana: 4,
  horaInicio: '07:30',
  horaFin: '08:45',
  activa: true,
  desde: '2026-09-14',
  hasta: null,
};

/**
 * Sale del fixture: una segunda copia a mano dejaria al guardian buscando otra
 * cosa. El nombre del turno NO se vigila: vive en el `.value` de un `<input>`,
 * que es donde tiene que estar.
 */
vigilarEstosDatos({
  tenantIdDeLaRutina: RUTINA_CON_FIN.tenantId,
  // La sala NO se edita: no tiene por que aparecer en ningun canal.
  salaIdDeLaRutina: RUTINA_CON_FIN.salaId,
});

const AVISO_DE_VIGENCIA =
  'El cambio rige para los meses que se publiquen de ahora en adelante. Las reservas ya generadas no se mueven.';

// ---------------------------------------------------------------------------
// Andamiaje
// ---------------------------------------------------------------------------

const alTerminar = vi.fn();
const alCancelar = vi.fn();

function montar(rutina: RutinaPublica, falla?: unknown) {
  pedirEspia.mockImplementation(() =>
    falla === undefined ? Promise.resolve(rutina) : Promise.reject(falla),
  );

  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  const arbol = (actual: RutinaPublica) => (
    <QueryClientProvider client={cliente}>
      <EditarRutina rutina={actual} perfilId="p1" alTerminar={alTerminar} alCancelar={alCancelar} />
    </QueryClientProvider>
  );

  const { rerender } = render(arbol(rutina));

  /** Lo que hace un refetch en la ficha: la MISMA rutina con otros datos, con el formulario ya montado. */
  return { refrescarCon: (nueva: RutinaPublica) => rerender(arbol(nueva)) };
}

function formulario() {
  return within(screen.getByRole('form', { name: /^Editar el / }));
}

async function esperar(): Promise<void> {
  await act(async () => {
    for (let vuelta = 0; vuelta < 5; vuelta += 1) {
      await new Promise((resolver) => setTimeout(resolver, 0));
    }
  });
}

async function escribir(etiqueta: string, texto: string): Promise<void> {
  const sesion = userEvent.setup();
  const campo = formulario().getByLabelText(etiqueta);
  await sesion.clear(campo);
  if (texto !== '') await sesion.type(campo, texto);
}

async function guardar(): Promise<void> {
  await userEvent.setup().click(formulario().getByRole('button', { name: 'Guardar cambios' }));
  await esperar();
}

function escrituras(): [string, { metodo?: string; cuerpo?: unknown }][] {
  return pedirEspia.mock.calls as [string, { metodo?: string; cuerpo?: unknown }][];
}

// ---------------------------------------------------------------------------
// El formulario
// ---------------------------------------------------------------------------

describe('editar un dia fijo', () => {
  it('arranca con los valores de la rutina', () => {
    montar(RUTINA_CON_FIN);

    expect(formulario().getByLabelText('Nombre del turno')).toHaveValue('Pilates-Marcador');
    expect(formulario().getByLabelText('Dia')).toHaveValue('2');
    expect(formulario().getByLabelText('Hora de inicio')).toHaveValue('18:00');
    expect(formulario().getByLabelText('Hora de fin')).toHaveValue('19:00');
    expect(formulario().getByLabelText('Desde')).toHaveValue('2026-10-01');
    expect(formulario().getByLabelText('Hasta')).toHaveValue('2026-12-15');
  });

  it('arranca con los valores de la OTRA rutina, y sin fin el campo va vacio', () => {
    montar(RUTINA_SIN_FIN);

    expect(formulario().getByLabelText('Nombre del turno')).toHaveValue('Funcional-Marcador');
    expect(formulario().getByLabelText('Dia')).toHaveValue('4');
    expect(formulario().getByLabelText('Hora de inicio')).toHaveValue('07:30');
    expect(formulario().getByLabelText('Hora de fin')).toHaveValue('08:45');
    expect(formulario().getByLabelText('Desde')).toHaveValue('2026-09-14');
    expect(formulario().getByLabelText('Hasta')).toHaveValue('');
  });

  it('manda SOLO lo que cambio', async () => {
    montar(RUTINA_CON_FIN);

    await escribir('Hora de fin', '20:00');
    await guardar();

    expect(escrituras()).toEqual([
      ['/rutinas/r-con-fin', { metodo: 'PATCH', cuerpo: { horaFin: '20:00' } }],
    ]);
  });

  it('sin fin, un campo Hasta vacio NO viaja: solo viaja lo que se toco', async () => {
    montar(RUTINA_SIN_FIN);

    await escribir('Nombre del turno', 'Funcional-Renombrado');
    await guardar();

    expect(escrituras()).toEqual([
      ['/rutinas/r-sin-fin', { metodo: 'PATCH', cuerpo: { nombre: 'Funcional-Renombrado' } }],
    ]);
  });

  it('cada campo editable viaja con su nombre del contrato', async () => {
    montar(RUTINA_CON_FIN);

    await userEvent.setup().selectOptions(formulario().getByLabelText('Dia'), '5');
    await escribir('Nombre del turno', 'Yoga-Renombrado');
    await escribir('Hora de inicio', '10:15');
    await escribir('Hora de fin', '11:20');
    await escribir('Desde', '2026-10-05');
    await escribir('Hasta', '2027-01-31');
    await guardar();

    expect(escrituras()).toEqual([
      [
        '/rutinas/r-con-fin',
        {
          metodo: 'PATCH',
          cuerpo: {
            nombre: 'Yoga-Renombrado',
            diaSemana: 5,
            horaInicio: '10:15',
            horaFin: '11:20',
            desde: '2026-10-05',
            hasta: '2027-01-31',
          },
        },
      ],
    ]);
  });

  it('sin cambios no manda nada, y lo dice', async () => {
    montar(RUTINA_CON_FIN);

    await guardar();

    expect(pedirEspia).not.toHaveBeenCalled();
    expect(alTerminar).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('No hay cambios para guardar.');
  });

  it('el dia viaja como numero', async () => {
    montar(RUTINA_CON_FIN);

    await userEvent.setup().selectOptions(formulario().getByLabelText('Dia'), '3');
    await guardar();

    const [[, { cuerpo }]] = escrituras() as [[string, { cuerpo: { diaSemana: unknown } }]];
    expect(cuerpo).toEqual({ diaSemana: 3 });
    expect(typeof cuerpo.diaSemana).toBe('number');
  });

  it('no ofrece cambiar la sala', () => {
    montar(RUTINA_CON_FIN);

    expect(screen.queryByLabelText(/sala/i)).toBeNull();
    expect(
      [...document.querySelectorAll('form label')].map((label) => label.textContent?.trim()),
    ).toEqual(['Nombre del turno', 'Dia', 'Hora de inicio', 'Hora de fin', 'Desde', 'Hasta']);
  });

  /** Es para DECIDIR, no para enterarse: tiene que estar antes de tocar nada. */
  it('dice que el cambio rige para los meses que se publiquen de ahora en adelante', () => {
    montar(RUTINA_CON_FIN);

    expect(formulario().getByText(AVISO_DE_VIGENCIA)).toBeInTheDocument();
    expect(pedirEspia).not.toHaveBeenCalled();
  });

  it('vaciar el fin de una rutina que lo tenia no se envia, y explica por que', async () => {
    montar(RUTINA_CON_FIN);

    // Todo lo demas valido y CAMBIADO: sin la regla del fin, el PATCH saldria.
    await escribir('Hora de fin', '20:00');
    await escribir('Hasta', '');
    await guardar();

    expect(pedirEspia).not.toHaveBeenCalled();
    expect(formulario().getByLabelText('Hasta')).toHaveAccessibleDescription(
      'Para que no tenga fin, hay que darla de baja y crear otra.',
    );
  });

  it('fin antes que inicio no se envia', async () => {
    montar(RUTINA_CON_FIN);

    // El nombre cambia tambien: sin la regla de las horas, el PATCH saldria.
    await escribir('Nombre del turno', 'Yoga-Renombrado');
    await escribir('Hora de inicio', '19:00');
    await escribir('Hora de fin', '18:00');
    await guardar();

    expect(pedirEspia).not.toHaveBeenCalled();
    expect(formulario().getByLabelText('Hora de fin')).toHaveAccessibleDescription(
      'La hora de fin tiene que ser despues de la de inicio',
    );
  });

  it('una hora mal escrita no se envia y el error queda en su campo', async () => {
    montar(RUTINA_CON_FIN);

    await escribir('Nombre del turno', 'Yoga-Renombrado');
    await escribir('Hora de inicio', '9am');
    await guardar();

    expect(pedirEspia).not.toHaveBeenCalled();
    expect(formulario().getByLabelText('Hora de inicio')).toHaveAccessibleDescription(
      'La hora va como HH:MM',
    );
  });

  it('una fecha mal escrita no se envia y el error queda en su campo', async () => {
    montar(RUTINA_CON_FIN);

    await escribir('Nombre del turno', 'Yoga-Renombrado');
    await escribir('Hasta', '31/01/2027');
    await guardar();

    expect(pedirEspia).not.toHaveBeenCalled();
    expect(formulario().getByLabelText('Hasta')).toHaveAccessibleDescription(
      'La fecha va como YYYY-MM-DD',
    );
  });

  it('sin nombre no se envia y el error queda en su campo', async () => {
    montar(RUTINA_CON_FIN);

    await escribir('Hora de fin', '20:00');
    await escribir('Nombre del turno', '');
    await guardar();

    expect(pedirEspia).not.toHaveBeenCalled();
    expect(formulario().getByLabelText('Nombre del turno')).toHaveAccessibleDescription(
      'El turno necesita un nombre',
    );
  });

  it('el error de la API se muestra tal cual', async () => {
    montar(RUTINA_CON_FIN, new ErrorDeApi('La rutina se pisa con otra del mismo dia', 400));

    await escribir('Hora de fin', '20:00');
    await guardar();

    expect(screen.getByRole('alert')).toHaveTextContent('La rutina se pisa con otra del mismo dia');
    expect(alTerminar).not.toHaveBeenCalled();
  });

  it('un fallo que no es de la API se avisa y no queda como rechazo sin manejar', async () => {
    const sinManejar: unknown[] = [];
    const registrar = (razon: unknown) => void sinManejar.push(razon);
    process.on('unhandledRejection', registrar);

    try {
      montar(RUTINA_CON_FIN, new Error('se cayo la red'));

      await escribir('Hora de fin', '20:00');
      await guardar();

      expect(screen.getByRole('alert')).toHaveTextContent('No se pudo completar la accion.');
      expect(sinManejar).toEqual([]);
      expect(alTerminar).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', registrar);
    }
  });

  it('un 403 de la API dice que rol hace falta', async () => {
    montar(RUTINA_CON_FIN, new ErrorDeApi('Forbidden resource', 403));

    await escribir('Hora de fin', '20:00');
    await guardar();

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Para esto hace falta ser administrador operativo. Tu rol no alcanza.',
    );
  });

  it('hasta anterior a desde no se envia', async () => {
    montar(RUTINA_CON_FIN);

    // Todo lo demas valido y CAMBIADO: sin la regla, el PATCH saldria.
    await escribir('Hora de fin', '20:00');
    await escribir('Hasta', '2026-09-30');
    await guardar();

    expect(pedirEspia).not.toHaveBeenCalled();
    expect(formulario().getByLabelText('Hasta')).toHaveAccessibleDescription(
      'La fecha de fin no puede ser anterior al inicio',
    );
  });

  it('el formulario se llama como la rutina que edita', () => {
    montar(RUTINA_CON_FIN);

    expect(
      screen.getByRole('form', { name: 'Editar el martes de 18:00 a 19:00' }),
    ).toBeInTheDocument();
  });

  /**
   * LA LINEA BASE ES LA RUTINA DE CUANDO SE ABRIO. Si un refetch cambia la
   * `horaFin` de fondo y el diff compara contra eso, un campo que nadie toco
   * pasa a ser «cambio» y el PATCH pisa lo que otra persona acaba de guardar.
   */
  it('un refetch durante la edicion no convierte un campo sin tocar en cambio', async () => {
    const { refrescarCon } = montar(RUTINA_CON_FIN);

    await act(async () => {
      refrescarCon({ ...RUTINA_CON_FIN, horaFin: '21:30' });
    });
    await escribir('Nombre del turno', 'Yoga-Renombrado');
    await guardar();

    expect(escrituras()).toEqual([
      ['/rutinas/r-con-fin', { metodo: 'PATCH', cuerpo: { nombre: 'Yoga-Renombrado' } }],
    ]);
  });

  it('al guardar se cierra', async () => {
    montar(RUTINA_CON_FIN);

    await escribir('Hora de fin', '20:00');
    await guardar();

    expect(alTerminar).toHaveBeenCalledTimes(1);
  });

  it('cancelar cierra sin mandar nada ni dar por guardado', async () => {
    montar(RUTINA_CON_FIN);

    await escribir('Hora de fin', '20:00');
    await userEvent.setup().click(formulario().getByRole('button', { name: 'Cancelar' }));

    expect(alCancelar).toHaveBeenCalledTimes(1);
    expect(alTerminar).not.toHaveBeenCalled();
    expect(pedirEspia).not.toHaveBeenCalled();
  });
});
