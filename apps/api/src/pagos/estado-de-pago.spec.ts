import { estaAlDia, type PagoParaEstado } from './estado-de-pago';

const dia = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

/** Un momento cualquiera del 15 de septiembre, NO su medianoche. */
const HOY = new Date('2026-09-15T14:30:00.000Z');

function pago(parcial: Partial<PagoParaEstado> = {}): PagoParaEstado {
  return {
    esSena: false,
    cubreDesde: dia('2026-09-01'),
    cubreHasta: dia('2026-09-30'),
    anuladoEn: null,
    ...parcial,
  };
}

describe('estaAlDia', () => {
  it('sin pagos, no esta al dia', () => {
    expect(estaAlDia([], HOY)).toBe(false);
  });

  it('un pago vigente lo pone al dia', () => {
    expect(estaAlDia([pago()], HOY)).toBe(true);
  });

  it('un pago vencido no cuenta', () => {
    expect(estaAlDia([pago({ cubreHasta: dia('2026-09-14') })], HOY)).toBe(false);
  });

  it('un pago que todavia no empezo no cuenta', () => {
    expect(estaAlDia([pago({ cubreDesde: dia('2026-09-16') })], HOY)).toBe(false);
  });

  it('el PRIMER dia del periodo cuenta', () => {
    expect(estaAlDia([pago({ cubreDesde: dia('2026-09-15') })], HOY)).toBe(true);
  });

  it('el ULTIMO dia del periodo cuenta ENTERO, no hasta su medianoche', () => {
    // El caso que mas facil es romper: cubreHasta es @db.Date, o sea medianoche
    // UTC, y `hoy` trae la hora. Comparar los dos en crudo deja fuera todo el
    // ultimo dia del periodo, que es justo el dia en que el alumno se acerca a
    // pagar.
    expect(estaAlDia([pago({ cubreHasta: dia('2026-09-15') })], HOY)).toBe(true);
  });

  it('un pago anulado no cuenta, aunque su periodo cubra hoy', () => {
    expect(estaAlDia([pago({ anuladoEn: new Date('2026-09-10T00:00:00.000Z') })], HOY)).toBe(false);
  });

  it('una sena no pone al dia', () => {
    // Decidido en la spec, no en el PDF: una sena reserva un lugar, no salda el
    // periodo.
    expect(estaAlDia([pago({ esSena: true })], HOY)).toBe(false);
  });

  it('basta con que UNO de varios cuente', () => {
    const pagos = [
      pago({ anuladoEn: new Date('2026-09-10T00:00:00.000Z') }),
      pago({ esSena: true }),
      pago(),
    ];
    expect(estaAlDia(pagos, HOY)).toBe(true);
  });

  it('dos periodos que se solapan no son un problema', () => {
    // Pagar dos meses por adelantado es normal. La pregunta es si hay alguno que
    // cubra hoy, no cual.
    const pagos = [pago(), pago({ cubreDesde: dia('2026-09-10'), cubreHasta: dia('2026-10-10') })];
    expect(estaAlDia(pagos, HOY)).toBe(true);
  });
});
