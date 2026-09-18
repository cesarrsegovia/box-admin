import { NotificacionesService } from './notificaciones.service';

describe('NotificacionesService', () => {
  it('cupoAsignado no lanza y no devuelve nada', async () => {
    const servicio = new NotificacionesService();

    // Es un hook inerte a proposito: las notificaciones reales llegan en la
    // Fase 5. Lo que este test protege es que NUNCA lance, porque se llama
    // dentro de la transaccion que asigna un cupo: una excepcion aqui
    // revertiria una reserva perfectamente valida.
    await expect(
      servicio.cupoAsignado({
        tenantId: 'gym-1',
        perfilId: 'perfil-1',
        turnoId: 'turno-1',
        reservaId: 'reserva-1',
      }),
    ).resolves.toBeUndefined();
  });
});
