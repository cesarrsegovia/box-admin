import { QueryObserver, type QueryClient } from '@tanstack/react-query';
import { expect, onTestFinished, vi } from 'vitest';

/**
 * EL ALCANCE DE UNA INVALIDACION ES UNA DIMENSION QUE NADIE AUDITABA.
 *
 * Un spec de hook monta el hook SOLO. Y con un unico consumidor del
 * `QueryClient`, una invalidacion dirigida y una invalidacion global dan
 * exactamente el mismo resultado: no hay ninguna otra consulta a la que la
 * diferencia pueda notarse. No es que faltara un caso — es que el escenario
 * donde la distincion EXISTE no se montaba nunca.
 *
 * Por eso `void cliente.invalidateQueries()` (sin filtro, "por las dudas")
 * sobrevive a cualquier cantidad de tests de ruta, de metodo, de cuerpo, de
 * invalidacion y de conteo de peticiones: los de invalidacion usan
 * `toHaveBeenCalledWith`, que nunca pregunta con que MAS se llamo, y los de
 * conteo cuentan peticiones en un cliente donde no hay nada mas abierto.
 *
 * En la maquina del mostrador el `QueryClient` es uno solo para toda la
 * aplicacion y dura lo que dura la pestaña. Una invalidacion sin filtro marca
 * rancia TODA consulta y vuelve a pedir todas las activas: cada cancelacion de
 * una reserva arrastraria un refetch del calendario del alumno, del listado de
 * usuarios, de los comprobantes y del sondeo del calendario-admin.
 *
 * Esto afirma sobre el ALCANCE, no sobre el metodo: lo que queda fijado es
 * «una escritura no toca lo que no es suyo», no «no se llamo a
 * `invalidateQueries` sin argumentos». Da igual como se ensanche el alcance
 * —sin filtro, con una clave de mas, con `refetchQueries`, con `resetQueries`,
 * con un `predicate` demasiado generoso—: lo que se mide es si la consulta
 * ajena se movio.
 */

/**
 * La clave de la consulta ajena.
 *
 * No se parece a ninguna real a proposito, y eso importa: React Query empareja
 * por PREFIJO de array, asi que una clave que empezara como una de verdad
 * (`['turnos', ...]`) haria que el centinela se considerara "propio" de alguna
 * escritura y el test se volveria verde por casualidad.
 */
export const CLAVE_AJENA = ['consulta-ajena-del-test'] as const;

/** Lo que el centinela tiene sembrado. Si vuelve a pedirse, se vera. */
const DATO_AJENO = 'dato-de-otra-pantalla';

/**
 * Deja una consulta ajena ACTIVA en ese mismo `QueryClient` y devuelve el
 * comprobador.
 *
 * Se usa asi, dentro de un test:
 *
 * ```ts
 * const { result, cliente } = montar(() => useCancelar('t1'));
 * const sinTocarLoAjeno = vigilarUnaConsultaAjena(cliente);
 * result.current.mutate({ id: 'r1', tipo: 'DEFINITIVA' });
 * await waitFor(() => expect(result.current.isSuccess).toBe(true));
 * await sinTocarLoAjeno();
 * ```
 *
 * El centinela NO es un hook de React: es un `QueryObserver` pelado. Asi sirve
 * igual en los specs que usan `renderHook` y en los que corren con relojes
 * falsos, y no agrega actualizaciones de estado fuera de `act`.
 */
export function vigilarUnaConsultaAjena(cliente: QueryClient): () => Promise<void> {
  const pedida = vi.fn(() => Promise.resolve(DATO_AJENO));

  // Se siembra el dato Y se declara fresca para siempre. Las dos cosas: asi la
  // consulta no tiene NINGUNA razon propia para volver a pedirse ni para
  // quedar rancia, y cualquier movimiento que se observe despues viene de
  // fuera. Sin el `staleTime`, con el `staleTime: 0` por defecto, la consulta
  // nace rancia y el centinela no podria distinguir nada.
  cliente.setQueryData(CLAVE_AJENA, DATO_AJENO);

  const observador = new QueryObserver(cliente, {
    queryKey: CLAVE_AJENA,
    queryFn: pedida,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  // Suscribirse es lo que la vuelve ACTIVA, y solo las activas se vuelven a
  // pedir cuando algo las invalida. Una consulta inactiva se quedaria marcada
  // rancia en silencio y el centinela miraria el canal equivocado.
  const soltar = observador.subscribe(() => {});
  onTestFinished(() => soltar());

  return async () => {
    // Cuatro turnos de microtareas: la invalidacion marca en el mismo tick,
    // pero el refetch que dispara arranca y resuelve en los siguientes.
    await Promise.resolve().then().then().then();

    const consulta = cliente.getQueryCache().find({ queryKey: CLAVE_AJENA });

    // EL INSTRUMENTO, ANTES DEL VEREDICTO. Si el centinela no esta donde se
    // cree, este comprobador no puede fallar nunca y seria un test que existe
    // sin poder caer. Pasa de verdad si el spec monta el hook con un
    // `QueryClient` y el centinela con otro.
    expect(
      consulta,
      'el centinela no esta en ese QueryClient: se vigilo un cliente distinto del que usa el hook',
    ).toBeDefined();
    expect(consulta?.isActive(), 'el centinela quedo inactivo: nadie lo estaba observando').toBe(
      true,
    );

    expect(
      pedida,
      'una escritura volvio a pedir una consulta AJENA: la invalidacion alcanza mas de lo suyo',
    ).not.toHaveBeenCalled();
    expect(
      consulta?.state.isInvalidated,
      'una escritura marco rancia una consulta AJENA: la invalidacion alcanza mas de lo suyo',
    ).toBe(false);
  };
}
