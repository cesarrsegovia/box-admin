import { elegirReserva, type CandidataDeCheckIn } from './eleccion-de-reserva';

const ZONA = 'America/Argentina/Buenos_Aires';
const QUINCE = { minutosAntes: 15, minutosDespues: 15 };

/** 5 de octubre de 2026, lunes. La columna `@db.Date` vuelve asi. */
const DIA = new Date('2026-10-05T00:00:00.000Z');

function candidata(parcial: Partial<CandidataDeCheckIn> = {}): CandidataDeCheckIn {
  return {
    reservaId: 'r-1',
    turnoId: 't-1',
    fecha: DIA,
    horaInicio: '18:00',
    clase: 'Pilates',
    yaMarcada: false,
    listaPasada: false,
    ...parcial,
  };
}

describe('elegirReserva', () => {
  /**
   * EL CASO QUE ESTA FASE EXISTE PARA ARREGLAR, y la mutacion mas importante
   * del plan.
   *
   * Las 18:00 en Argentina son las 21:00 UTC. Con la ventana calculada con
   * `instanteDelTurno` —que interpreta el reloj de pared como UTC— seria
   * [17:45, 18:15] UTC, el alumno puntual estaria tres horas fuera y el
   * check-in no serviria para nada.
   */
  it('la clase de las 18:00 en Buenos Aires se marca a las 18:00 de ahi', () => {
    const ahora = new Date('2026-10-05T21:00:00.000Z');

    const r = elegirReserva([candidata()], ahora, QUINCE, ZONA);

    expect(r.tipo).toBe('elegida');
  });

  it('en UTC la misma clase se marca a las 18:00 UTC', () => {
    // El contrapunto del anterior: con zona UTC el calculo coincide con el
    // viejo. Sin este caso, cambiar la zona por una constante 'UTC' dentro de
    // la funcion solo rompe un test; con los dos, no hay constante que pase.
    const r = elegirReserva([candidata()], new Date('2026-10-05T18:00:00.000Z'), QUINCE, 'UTC');

    expect(r.tipo).toBe('elegida');
  });

  it('entra justo al abrirse la ventana', () => {
    // inicio (21:00 UTC) menos minutosAntes, exacto.
    const r = elegirReserva([candidata()], new Date('2026-10-05T20:45:00.000Z'), QUINCE, ZONA);

    expect(r.tipo).toBe('elegida');
  });

  it('entra justo al cerrarse', () => {
    // inicio mas minutosDespues, exacto.
    const r = elegirReserva([candidata()], new Date('2026-10-05T21:15:00.000Z'), QUINCE, ZONA);

    expect(r.tipo).toBe('elegida');
  });

  it('un minuto antes de abrirse, no', () => {
    const r = elegirReserva([candidata()], new Date('2026-10-05T20:44:00.000Z'), QUINCE, ZONA);

    expect(r).toEqual({ tipo: 'fuera-de-ventana', masCercana: candidata() });
  });

  it('un minuto despues de cerrarse, no, y dice cual era la mas cercana', () => {
    // El motivo trae la candidata para que la pantalla pueda decir "tu clase
    // era a las 18:00" en vez de un "no se pudo" que manda a recepcion.
    const r = elegirReserva([candidata()], new Date('2026-10-05T21:16:00.000Z'), QUINCE, ZONA);

    expect(r).toEqual({
      tipo: 'fuera-de-ventana',
      masCercana: expect.objectContaining({ clase: 'Pilates', horaInicio: '18:00' }),
    });
  });

  it('con dos turnos en ventana elige el mas cercano al instante actual', () => {
    // Dos clases pegadas, 18:00 y 19:00, ventana de 45 minutos para que las dos
    // esten abiertas a las 18:40 locales (21:40 UTC). Elige la de las 19:00,
    // que esta a 20 minutos, y no la de las 18:00, que esta a 40.
    const temprana = candidata({ reservaId: 'r-18', horaInicio: '18:00' });
    const tardia = candidata({ reservaId: 'r-19', horaInicio: '19:00' });

    const r = elegirReserva(
      [temprana, tardia],
      new Date('2026-10-05T21:40:00.000Z'),
      { minutosAntes: 45, minutosDespues: 45 },
      ZONA,
    );

    expect(r).toEqual({ tipo: 'elegida', candidata: tardia });
  });

  it('una reserva ya marcada se distingue de una fuera de ventana', () => {
    const ya = candidata({ yaMarcada: true });

    const r = elegirReserva([ya], new Date('2026-10-05T21:00:00.000Z'), QUINCE, ZONA);

    expect(r).toEqual({ tipo: 'ya-marcada', candidata: ya });
  });

  /**
   * EL ORDEN DEL ALGORITMO, no un caso de borde decorativo.
   *
   * `yaMarcada` se mira DESPUES de elegir. Si se filtrara antes, el alumno con
   * dos clases seguidas que ya marco la primera se quedaria sin candidatas
   * abiertas y recibiria "fuera de ventana" en vez de que se le marque la
   * segunda, que es la que de verdad esta empezando.
   */
  it('con la primera ya marcada, se marca la segunda', () => {
    const primera = candidata({ reservaId: 'r-18', horaInicio: '18:00', yaMarcada: true });
    const segunda = candidata({ reservaId: 'r-19', horaInicio: '19:00' });

    const r = elegirReserva(
      [primera, segunda],
      new Date('2026-10-05T21:40:00.000Z'),
      { minutosAntes: 45, minutosDespues: 45 },
      ZONA,
    );

    expect(r).toEqual({ tipo: 'elegida', candidata: segunda });
  });

  /**
   * LA PROFESORA MANDA. Si ya paso lista, ella estaba en la sala y el alumno
   * no sobrescribe ese parte desde su telefono: seria dejar que lo corrija
   * justo quien tiene interes en que diga otra cosa.
   */
  it('si la profesora ya paso lista, el check-in esta cerrado', () => {
    const conLista = candidata({ listaPasada: true });

    const r = elegirReserva([conLista], new Date('2026-10-05T21:00:00.000Z'), QUINCE, ZONA);

    expect(r).toEqual({ tipo: 'lista-ya-pasada', candidata: conLista });
  });

  it('y tambien si la profesora la puso AUSENTE, que es el caso que importa', () => {
    // `listaPasada` mira que `asistio` no sea null, no que sea true: un ausente
    // puesto por la profesora es justo el registro que no se puede corregir
    // solo. Desde esta funcion los dos casos son el mismo booleano, asi que lo
    // que fija este test es que no hay ninguna rama que distinga presente de
    // ausente para dejar pasar al segundo.
    const ausente = candidata({ listaPasada: true, yaMarcada: false });

    expect(elegirReserva([ausente], new Date('2026-10-05T21:00:00.000Z'), QUINCE, ZONA).tipo).toBe(
      'lista-ya-pasada',
    );
  });

  it('quien ya escaneo recibe "ya-marcada", no "lista-ya-pasada"', () => {
    // Un check-in deja las DOS marcas, asi que cumple las dos condiciones. El
    // mensaje correcto es "ya marcaste"; mandarlo a hablar con la profesora
    // seria mandarlo a buscar un problema que no existe.
    const ambas = candidata({ yaMarcada: true, listaPasada: true });

    const r = elegirReserva([ambas], new Date('2026-10-05T21:00:00.000Z'), QUINCE, ZONA);

    expect(r).toEqual({ tipo: 'ya-marcada', candidata: ambas });
  });

  it('la lista pasada tampoco se mira antes de elegir', () => {
    // Mismo orden que `yaMarcada`: con la primera clase ya pasada a lista, se
    // elige la segunda y se marca, en vez de dejar al alumno sin candidatas.
    const primera = candidata({ reservaId: 'r-18', horaInicio: '18:00', listaPasada: true });
    const segunda = candidata({ reservaId: 'r-19', horaInicio: '19:00' });

    const r = elegirReserva(
      [primera, segunda],
      new Date('2026-10-05T21:40:00.000Z'),
      { minutosAntes: 45, minutosDespues: 45 },
      ZONA,
    );

    expect(r).toEqual({ tipo: 'elegida', candidata: segunda });
  });

  it('fuera de ventana gana a la lista pasada: primero se elige', () => {
    // Una sola candidata, con lista pasada, pero el reloj fuera. El motivo que
    // corresponde es el de la ventana, porque los bloqueos se miran DESPUES de
    // que haya algo elegido.
    const conLista = candidata({ listaPasada: true });

    const r = elegirReserva([conLista], new Date('2026-10-05T19:00:00.000Z'), QUINCE, ZONA);

    expect(r).toEqual({ tipo: 'fuera-de-ventana', masCercana: conLista });
  });

  it('sin ninguna reserva en el dia, "sin-reserva"', () => {
    // El unico caso que NO lleva candidata en el resultado.
    const r = elegirReserva([], new Date('2026-10-05T21:00:00.000Z'), QUINCE, ZONA);

    expect(r).toEqual({ tipo: 'sin-reserva' });
  });

  it('con la ventana en cero solo entra el instante exacto del inicio', () => {
    // Configuracion valida; el borde degenerado tiene que comportarse, no
    // reventar.
    const cero = { minutosAntes: 0, minutosDespues: 0 };

    expect(
      elegirReserva([candidata()], new Date('2026-10-05T21:00:00.000Z'), cero, ZONA).tipo,
    ).toBe('elegida');
    expect(
      elegirReserva([candidata()], new Date('2026-10-05T21:00:00.001Z'), cero, ZONA).tipo,
    ).toBe('fuera-de-ventana');
    expect(
      elegirReserva([candidata()], new Date('2026-10-05T20:59:59.999Z'), cero, ZONA).tipo,
    ).toBe('fuera-de-ventana');
  });

  it('la mas cercana puede ser la de mañana, no la primera de la lista', () => {
    // Las candidatas no llegan ordenadas y "la mas cercana" es en valor
    // absoluto, no "la primera": aqui la de hoy a las 08:00 ya paso hace trece
    // horas y la de mañana a las 09:00 esta a doce.
    const pasada = candidata({ reservaId: 'r-ayer', horaInicio: '08:00' });
    const futura = candidata({
      reservaId: 'r-manana',
      fecha: new Date('2026-10-06T00:00:00.000Z'),
      horaInicio: '09:00',
    });

    const r = elegirReserva(
      [pasada, futura],
      // 21:00 locales del 5.
      new Date('2026-10-06T00:00:00.000Z'),
      QUINCE,
      ZONA,
    );

    expect(r).toEqual({ tipo: 'fuera-de-ventana', masCercana: futura });
  });
});
