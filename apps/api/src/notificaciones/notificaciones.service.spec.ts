import { Logger } from '@nestjs/common';
import { NotificacionesService } from './notificaciones.service';

describe('NotificacionesService', () => {
  function crearServicio(colaFalla = false) {
    const add = colaFalla
      ? jest.fn().mockRejectedValue(new Error('Redis caido'))
      : jest.fn().mockResolvedValue({ id: 'job-1' });
    const colaReserva = { add } as never;
    const colaListaEspera = { add } as never;

    return { servicio: new NotificacionesService(colaReserva, colaListaEspera), add };
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('encola el aviso de cupo asignado', async () => {
    const { servicio, add } = crearServicio();

    await servicio.cupoAsignado({
      tenantId: 'gym-1',
      perfilId: 'perfil-1',
      turnoId: 'turno-1',
      reservaId: 'reserva-1',
      entradaId: 'entrada-1',
    });

    expect(add).toHaveBeenCalledTimes(1);
  });

  it('NO lanza aunque Redis este caido', async () => {
    // El invariante de la Fase 3A, con el motivo ACTUALIZADO: esto ya no corre
    // dentro de la transaccion —ReservasService encola despues del commit—, asi
    // que una excepcion aqui no revierte nada. Lo que haria es convertir en un
    // 500 un POST que guardo la reserva perfectamente bien, solo porque Redis
    // estaba caido.
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { servicio } = crearServicio(true);

    await expect(
      servicio.cupoAsignado({
        tenantId: 'gym-1',
        perfilId: 'p',
        turnoId: 't',
        reservaId: 'r',
        entradaId: 'e',
      }),
    ).resolves.toBeUndefined();
  });

  it('una reserva de RUTINA no encola nada', async () => {
    const { servicio, add } = crearServicio();

    await servicio.reservaCambiada({
      tenantId: 'gym-1',
      perfilId: 'p',
      turnoId: 't',
      origen: 'RUTINA',
      accion: 'CONFIRMACION',
    });

    expect(add).not.toHaveBeenCalled();
  });

  it('una reserva del alumno si encola', async () => {
    const { servicio, add } = crearServicio();

    await servicio.reservaCambiada({
      tenantId: 'gym-1',
      perfilId: 'p',
      turnoId: 't',
      origen: 'ALUMNO',
      accion: 'CONFIRMACION',
    });

    expect(add).toHaveBeenCalledTimes(1);
  });

  // ------------------------------------------------------------------------
  // La regla del payload, defendida y no solo comentada.
  //
  // `toEqual` sobre el objeto ENTERO, nunca `expect.objectContaining`: lo que
  // este test protege es que no se cuele NADA de mas. Un payload de BullMQ se
  // serializa a JSON y se queda en Redis hasta que caduque, asi que meter ahi un
  // `DatosSmtp` —o cualquier cosa salida de `datosDeEnvio()`— persiste la
  // credencial en claro y la expone en cualquier panel de Bull.
  //
  // Ablandar estos dos asserts deja la regla escrita solo en un comentario.
  // ------------------------------------------------------------------------

  it('el payload de lista de espera lleva identificadores y nada mas', async () => {
    const { servicio, add } = crearServicio();

    await servicio.cupoAsignado({
      tenantId: 'gym-1',
      perfilId: 'perfil-1',
      turnoId: 'turno-1',
      // Ni el reservaId, que entra al hook pero NO viaja en el job.
      reservaId: 'reserva-1',
      entradaId: 'entrada-1',
    });

    expect(add.mock.calls[0]?.[1]).toEqual({
      tenantId: 'gym-1',
      perfilId: 'perfil-1',
      turnoId: 'turno-1',
      entradaId: 'entrada-1',
    });
  });

  it('el payload de reserva lleva identificadores y nada mas', async () => {
    const { servicio, add } = crearServicio();

    await servicio.reservaCambiada({
      tenantId: 'gym-1',
      perfilId: 'perfil-1',
      turnoId: 'turno-1',
      origen: 'ALUMNO',
      accion: 'CANCELACION',
    });

    expect(add.mock.calls[0]?.[1]).toEqual({
      tenantId: 'gym-1',
      perfilId: 'perfil-1',
      turnoId: 'turno-1',
      accion: 'CANCELACION',
    });
  });
});
