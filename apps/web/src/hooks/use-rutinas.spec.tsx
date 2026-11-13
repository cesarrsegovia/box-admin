import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import { vigilarUnaConsultaAjena } from '@/test/consulta-ajena';
import { dobleDeFetch, llamada, montar } from '@/test/andamiaje-de-hooks';
import { useActualizarRutina, useCrearRutina, useDarDeBajaRutina, useRutinas } from './use-rutinas';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * Las rutas y los campos de este spec estan ESCRITOS A MANO desde
 * `apps/api/src/rutinas/rutinas.controller.ts` (`@Controller('rutinas')`,
 * `@Post()`, `@Get()` con `perfilId` por query, `@Patch(':id')`,
 * `@Delete(':id')`) y desde `CrearRutinaDto` / `ActualizarRutinaDto`. No se
 * copian del hook: un fixture que hable el idioma del hook se pone de acuerdo
 * con el hook aunque los dos esten mal.
 */

/** Una rutina tal como vuelve de la API. */
const RUTINA = {
  id: 'rut1',
  tenantId: 'g1',
  perfilId: 'perf1',
  salaId: 'sala1',
  nombre: 'Pilates',
  diaSemana: 2,
  horaInicio: '18:00',
  horaFin: '19:00',
  desde: '2099-01-05',
  hasta: null,
  activa: true,
};

/** Los campos de `CrearRutinaDto`, con `desde` obligatorio y sin `hasta`. */
const ALTA = {
  perfilId: 'perf1',
  salaId: 'sala1',
  nombre: 'Pilates',
  diaSemana: 2,
  horaInicio: '18:00',
  horaFin: '19:00',
  desde: '2099-01-05',
} as const;

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

describe('useRutinas', () => {
  it('va con GET a `/rutinas?perfilId=…`: siempre las de UNA persona', async () => {
    const doble = dobleDeFetch([]);

    const { result } = montar(() => useRutinas('perf1'));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble).url).toBe('/api/bx/rutinas?perfilId=perf1');
    expect(llamada(doble).metodo).toBe('GET');
  });
});

// ---------------------------------------------------------------------------
// Escrituras: metodo, ruta y cuerpo exactos
// ---------------------------------------------------------------------------

describe('useCrearRutina', () => {
  it('va con POST a `/rutinas` y manda EXACTAMENTE los campos del alta', async () => {
    const doble = dobleDeFetch(RUTINA);

    const { result } = montar(() => useCrearRutina('perf1'));
    result.current.mutate({ ...ALTA });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble)).toEqual({
      url: '/api/bx/rutinas',
      metodo: 'POST',
      cuerpo: {
        perfilId: 'perf1',
        salaId: 'sala1',
        nombre: 'Pilates',
        diaSemana: 2,
        horaInicio: '18:00',
        horaFin: '19:00',
        desde: '2099-01-05',
      },
    });
  });
});

describe('useActualizarRutina', () => {
  it('va con PATCH a `/rutinas/:id` y el cuerpo son SOLO los cambios', async () => {
    // Ni el `id` ni el `perfilId` van en el cuerpo: `ActualizarRutinaDto` no
    // los tiene y el `ValidationPipe` rechaza lo que sobra.
    const doble = dobleDeFetch(RUTINA);

    const { result } = montar(() => useActualizarRutina('perf1'));
    result.current.mutate({ id: 'rut1', cambios: { horaInicio: '19:00', horaFin: '20:00' } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble)).toEqual({
      url: '/api/bx/rutinas/rut1',
      metodo: 'PATCH',
      cuerpo: { horaInicio: '19:00', horaFin: '20:00' },
    });
  });
});

describe('useDarDeBajaRutina', () => {
  it('va con DELETE a `/rutinas/:id`, sin cuerpo', async () => {
    const doble = dobleDeFetch({ ...RUTINA, activa: false });

    const { result } = montar(() => useDarDeBajaRutina('perf1'));
    result.current.mutate('rut1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble)).toEqual({
      url: '/api/bx/rutinas/rut1',
      metodo: 'DELETE',
      cuerpo: undefined,
    });
  });
});

// ---------------------------------------------------------------------------
// Invalidacion: la lista de ESA persona y nada mas
// ---------------------------------------------------------------------------

/**
 * La clave se escribe a mano (`['rutinas', 'perf1']`) y no con
 * `clavesDeRutinas.dePersona`: compararla contra la funcion que la produce
 * seria autorreferencial.
 *
 * `toHaveBeenCalledTimes(1)` cierra el «ninguna otra clave»: una segunda
 * invalidacion, aunque fuera de algo propio, se veria.
 */
describe('invalidacion tras una escritura', () => {
  interface Montada {
    cliente: QueryClient;
    disparar: () => void;
    listo: () => boolean;
  }

  const casos: { nombre: string; montarla: () => Montada }[] = [
    {
      nombre: 'crear',
      montarla: () => {
        const { result, cliente } = montar(() => useCrearRutina('perf1'));
        return {
          cliente,
          disparar: () => result.current.mutate({ ...ALTA }),
          listo: () => result.current.isSuccess,
        };
      },
    },
    {
      nombre: 'editar',
      montarla: () => {
        const { result, cliente } = montar(() => useActualizarRutina('perf1'));
        return {
          cliente,
          disparar: () => result.current.mutate({ id: 'rut1', cambios: { nombre: 'Yoga' } }),
          listo: () => result.current.isSuccess,
        };
      },
    },
    {
      nombre: 'dar de baja',
      montarla: () => {
        const { result, cliente } = montar(() => useDarDeBajaRutina('perf1'));
        return {
          cliente,
          disparar: () => result.current.mutate('rut1'),
          listo: () => result.current.isSuccess,
        };
      },
    },
  ];

  for (const caso of casos) {
    it(`${caso.nombre} invalida \`['rutinas', perfilId]\` y ninguna otra clave`, async () => {
      dobleDeFetch(RUTINA);

      const { cliente, disparar, listo } = caso.montarla();
      const espia = vi.spyOn(cliente, 'invalidateQueries');

      disparar();
      await waitFor(() => expect(listo()).toBe(true));

      expect(espia).toHaveBeenCalledTimes(1);
      expect(espia).toHaveBeenCalledWith({ queryKey: ['rutinas', 'perf1'] });
    });

    it(`${caso.nombre} NO alcanza la lista de otra persona`, async () => {
      // `['rutinas']` a secas tambien pasaria por `toHaveBeenCalledWith` si
      // alguien lo comparara por prefijo; esto lo mide en la cache: la ficha de
      // otra alumna abierta en el mismo cliente no se toca.
      dobleDeFetch(RUTINA);

      const { cliente, disparar, listo } = caso.montarla();
      cliente.setQueryData(['rutinas', 'perf1'], []);
      cliente.setQueryData(['rutinas', 'perf2'], []);

      disparar();
      await waitFor(() => expect(listo()).toBe(true));
      await Promise.resolve().then().then().then();

      const propia = cliente.getQueryCache().find({ queryKey: ['rutinas', 'perf1'], exact: true });
      const ajena = cliente.getQueryCache().find({ queryKey: ['rutinas', 'perf2'], exact: true });
      expect(propia, 'la consulta sembrada no esta: el test no mide nada').toBeDefined();
      expect(propia?.state.isInvalidated).toBe(true);
      expect(ajena?.state.isInvalidated).toBe(false);
    });

    it(`${caso.nombre} no refresca consultas ajenas`, async () => {
      dobleDeFetch(RUTINA);

      const { cliente, disparar, listo } = caso.montarla();
      const sinTocarLoAjeno = vigilarUnaConsultaAjena(cliente);

      disparar();
      await waitFor(() => expect(listo()).toBe(true));

      await sinTocarLoAjeno();
    });
  }
});
