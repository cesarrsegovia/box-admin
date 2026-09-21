import { describe, expect, it } from 'vitest';
import type { Disponibilidad } from '@boxadmin/shared';
import { accionDeTurno, textoDeDisponibilidad } from './textos-disponibilidad';

function disponibilidad(cambios: Partial<Disponibilidad> = {}): Disponibilidad {
  return {
    turnoId: 'turno-1',
    estado: 'LIBRE',
    cupo: 5,
    ocupados: 1,
    puedeReservar: true,
    motivo: null,
    enListaEspera: false,
    posicionEnLista: null,
    ...cambios,
  };
}

describe('accionDeTurno', () => {
  it('con cupo y permiso, ofrece reservar', () => {
    expect(accionDeTurno(disponibilidad())).toBe('reservar');
  });

  it('un turno en LISTA_ESPERA ofrece la cola, no un boton muerto', () => {
    // Punto del checklist del PDF: un turno lleno tiene que OFRECER la cola.
    expect(
      accionDeTurno(disponibilidad({ estado: 'LISTA_ESPERA', ocupados: 5, puedeReservar: false })),
    ).toBe('anotarme');
  });

  it('si ya esta en la cola, ofrece salirse', () => {
    expect(
      accionDeTurno(
        disponibilidad({
          estado: 'LISTA_ESPERA',
          puedeReservar: false,
          enListaEspera: true,
          posicionEnLista: 2,
        }),
      ),
    ).toBe('salirme');
  });

  it('si ya reservo, ofrece cancelar', () => {
    expect(accionDeTurno(disponibilidad({ puedeReservar: false, motivo: 'YA_RESERVADO' }))).toBe(
      'cancelar',
    );
  });

  it('un turno LLENO no ofrece nada', () => {
    expect(
      accionDeTurno(disponibilidad({ estado: 'LLENO', ocupados: 5, puedeReservar: false })),
    ).toBe('ninguna');
  });

  it('fuera de ventana no ofrece nada', () => {
    expect(accionDeTurno(disponibilidad({ puedeReservar: false, motivo: 'VENTANA_CERRADA' }))).toBe(
      'ninguna',
    );
  });

  it('en LISTA_ESPERA pero sin acceso a la sala, tampoco ofrece la cola', () => {
    // Anotarse fallaria con un 403: ofrecerlo seria mandar al alumno contra un
    // muro.
    expect(
      accionDeTurno(
        disponibilidad({
          estado: 'LISTA_ESPERA',
          puedeReservar: false,
          motivo: 'SIN_ACCESO_A_SALA',
        }),
      ),
    ).toBe('ninguna');
  });
});

describe('textoDeDisponibilidad', () => {
  it.each([
    ['VENTANA_CERRADA', /plazo/i],
    ['SOLO_CUPOS_LIBERADOS', /liber/i],
    ['YA_RESERVADO', /ya .*reserva/i],
    ['MES_NO_PUBLICADO', /no esta abierto/i],
  ] as const)('el motivo %s se explica en castellano', (motivo, patron) => {
    expect(textoDeDisponibilidad(disponibilidad({ puedeReservar: false, motivo }))).toMatch(patron);
  });

  it('un turno lleno dice cuantos son', () => {
    expect(
      textoDeDisponibilidad(
        disponibilidad({ estado: 'LLENO', cupo: 5, ocupados: 5, puedeReservar: false }),
      ),
    ).toMatch(/5\/5/);
  });

  it('en lista de espera dice la posicion', () => {
    expect(
      textoDeDisponibilidad(
        disponibilidad({
          estado: 'LISTA_ESPERA',
          puedeReservar: false,
          enListaEspera: true,
          posicionEnLista: 3,
        }),
      ),
    ).toMatch(/3/);
  });

  it('un turno libre dice cuantos lugares quedan', () => {
    expect(textoDeDisponibilidad(disponibilidad({ cupo: 5, ocupados: 2 }))).toMatch(/3/);
  });

  it('con mas ocupados que cupo no dice un numero negativo', () => {
    // Pasa si un admin baja el cupo de un turno que ya tenia reservas.
    expect(textoDeDisponibilidad(disponibilidad({ cupo: 5, ocupados: 8 }))).toMatch(/0 lugares/);
  });

  // Red de seguridad: si la API añadiera un motivo nuevo, no puede salir un
  // hueco en blanco en la pantalla.
  it('nunca devuelve una cadena vacia', () => {
    for (const estado of ['LIBRE', 'SOLO_ADMIN', 'LISTA_ESPERA', 'LLENO'] as const) {
      expect(textoDeDisponibilidad(disponibilidad({ estado })).length).toBeGreaterThan(0);
    }
  });
});
