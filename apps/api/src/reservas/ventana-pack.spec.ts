import { topeDelPack, ventanaDeConteo } from './ventana-pack';

const PACK_MENSUAL = {
  tipo: 'MENSUAL' as const,
  clasesPorMes: 8,
  clasesTotales: null,
};

const PACK_TOTAL = {
  tipo: 'TOTAL' as const,
  clasesPorMes: null,
  clasesTotales: 20,
};

const SIN_VIGENCIA = { clasesExtra: 0, vigenciaDesde: null, vigenciaHasta: null };

describe('ventanaDeConteo', () => {
  it('un pack MENSUAL cuenta el mes calendario del turno', () => {
    const ventana = ventanaDeConteo(
      PACK_MENSUAL,
      SIN_VIGENCIA,
      new Date('2026-10-17T00:00:00.000Z'),
    );

    expect(ventana).toEqual({
      gte: new Date('2026-10-01T00:00:00.000Z'),
      lte: new Date('2026-10-31T00:00:00.000Z'),
    });
  });

  it('acierta el ultimo dia en meses de 30 y de 28 dias', () => {
    expect(
      ventanaDeConteo(PACK_MENSUAL, SIN_VIGENCIA, new Date('2026-11-05T00:00:00.000Z')).lte,
    ).toEqual(new Date('2026-11-30T00:00:00.000Z'));
    expect(
      ventanaDeConteo(PACK_MENSUAL, SIN_VIGENCIA, new Date('2026-02-05T00:00:00.000Z')).lte,
    ).toEqual(new Date('2026-02-28T00:00:00.000Z'));
  });

  it('un pack TOTAL cuenta la vigencia del perfil', () => {
    const ventana = ventanaDeConteo(
      PACK_TOTAL,
      {
        clasesExtra: 0,
        vigenciaDesde: new Date('2026-09-01T00:00:00.000Z'),
        vigenciaHasta: new Date('2026-12-31T00:00:00.000Z'),
      },
      new Date('2026-10-17T00:00:00.000Z'),
    );

    expect(ventana).toEqual({
      gte: new Date('2026-09-01T00:00:00.000Z'),
      lte: new Date('2026-12-31T00:00:00.000Z'),
    });
  });

  it('un pack TOTAL sin vigencia cuenta todo el historial del perfil', () => {
    expect(ventanaDeConteo(PACK_TOTAL, SIN_VIGENCIA, new Date('2026-10-17T00:00:00.000Z'))).toEqual(
      {},
    );
  });
});

describe('topeDelPack', () => {
  it('un pack MENSUAL usa clasesPorMes', () => {
    expect(topeDelPack(PACK_MENSUAL, SIN_VIGENCIA)).toBe(8);
  });

  it('un pack TOTAL usa clasesTotales', () => {
    expect(topeDelPack(PACK_TOTAL, SIN_VIGENCIA)).toBe(20);
  });

  it('suma las clases extra concedidas al perfil', () => {
    expect(topeDelPack(PACK_MENSUAL, { ...SIN_VIGENCIA, clasesExtra: 2 })).toBe(10);
  });

  it('sin pack no hay tope', () => {
    expect(topeDelPack(null, SIN_VIGENCIA)).toBeNull();
  });

  it('un pack sin numero de clases tampoco impone tope', () => {
    expect(
      topeDelPack({ tipo: 'MENSUAL', clasesPorMes: null, clasesTotales: null }, SIN_VIGENCIA),
    ).toBeNull();
  });
});
