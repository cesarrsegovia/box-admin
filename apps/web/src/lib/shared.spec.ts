import { describe, expect, it } from 'vitest';
import { calcularDisponibilidad, puedeCancelar, resolverConfiguracion } from '@boxadmin/shared';

const SIN_VENTANA = { minMinutosCancelar: 0, minMinutosAnotarse: 0, listaEsperaHabilitada: false };

describe('@boxadmin/shared en el navegador', () => {
  it('calcularDisponibilidad corre en el bundle del cliente', () => {
    const d = calcularDisponibilidad({
      turno: {
        id: 'turno-1',
        salaId: 'sala-1',
        fecha: new Date('2099-10-02T00:00:00.000Z'),
        horaInicio: '10:00',
        cupo: 5,
      },
      sala: { activa: true, visibleAlumnos: true, soloCuposLiberados: false },
      config: SIN_VENTANA,
      ocupados: 1,
      huboCancelaciones: false,
      mesPublicado: true,
      tieneAccesoASala: true,
      yaReservado: false,
      enListaEspera: false,
      posicionEnLista: null,
      ahora: new Date('2099-10-01T10:00:00.000Z'),
    });

    // Es la MISMA funcion que decide en el servidor. Que corra aqui es lo que
    // permite a una pantalla apagar un boton sin preguntar.
    expect(d.estado).toBe('LIBRE');
    expect(d.puedeReservar).toBe(true);
  });

  it('puedeCancelar corre en el bundle del cliente', () => {
    const fecha = new Date('2099-10-02T00:00:00.000Z');

    expect(puedeCancelar(fecha, '10:00', SIN_VENTANA, new Date('2099-10-01T10:00:00.000Z'))).toBe(
      true,
    );
  });

  it('resolverConfiguracion corre en el bundle del cliente', () => {
    const config = resolverConfiguracion(
      { minMinutosCancelar: 120, minMinutosAnotarse: null, listaEsperaHabilitada: null },
      { minMinutosCancelar: 999, minMinutosAnotarse: 30, listaEsperaHabilitada: true },
    );

    expect(config).toEqual({
      minMinutosCancelar: 120,
      minMinutosAnotarse: 30,
      listaEsperaHabilitada: true,
    });
  });
});
