import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { vigilarUnaConsultaAjena } from './consulta-ajena';

/**
 * EL INSTRUMENTO, PROBADO.
 *
 * Un centinela que no puede fallar es peor que no tener centinela: deja a
 * cuatro specs afirmando una propiedad que nadie comprueba. Asi que aqui se
 * comprueba las dos cosas, y en este orden: que NO se queja de una
 * invalidacion dirigida, y que SI se queja de una global.
 */
function cliente(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

describe('vigilarUnaConsultaAjena', () => {
  it('una invalidacion DIRIGIDA a otra clave no lo despierta', async () => {
    const q = cliente();
    const sinTocarLoAjeno = vigilarUnaConsultaAjena(q);

    await q.invalidateQueries({ queryKey: ['turnos'] });

    await sinTocarLoAjeno();
  });

  it('una invalidacion SIN FILTRO lo despierta', async () => {
    // Esta es la mutacion que sobrevivio a 839 tests. Si este caso pasara en
    // verde, el centinela seria decoracion.
    const q = cliente();
    const sinTocarLoAjeno = vigilarUnaConsultaAjena(q);

    void q.invalidateQueries();

    await expect(sinTocarLoAjeno()).rejects.toThrow(/AJENA/);
  });

  it('una invalidacion con un `predicate` generoso tambien lo despierta', async () => {
    // El alcance se puede ensanchar de mas de una forma. Lo que se mide es si
    // la consulta ajena se movio, no como se la movio.
    const q = cliente();
    const sinTocarLoAjeno = vigilarUnaConsultaAjena(q);

    void q.invalidateQueries({ predicate: () => true });

    await expect(sinTocarLoAjeno()).rejects.toThrow(/AJENA/);
  });

  it('se delata si el centinela no esta en el cliente que vigila', async () => {
    // El modo mas facil de acabar con cuatro specs afirmando una propiedad que
    // nadie comprueba: que el centinela no este donde el comprobador mira. Si
    // eso pasa, tiene que fallar en voz alta y no pasar con las manos vacias.
    const q = cliente();
    const sinTocarLoAjeno = vigilarUnaConsultaAjena(q);

    q.getQueryCache().clear();

    await expect(sinTocarLoAjeno()).rejects.toThrow(/centinela/);
  });
});
