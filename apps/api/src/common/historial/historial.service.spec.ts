import { HistorialService } from './historial.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { JwtPayload } from '@boxadmin/shared';

const ACTOR: JwtPayload = { sub: 'usr-1', tenantId: 'gym-1', rol: 'ADMIN_SALON' };

function crearServicio() {
  const create = jest.fn().mockResolvedValue({ id: 'hist-1' });
  const prisma = { db: { historialAccion: { create } } } as unknown as PrismaService;
  return { servicio: new HistorialService(prisma), create, prisma };
}

describe('HistorialService', () => {
  it('escribe entidad, accion y el usuario que la ejecuto', async () => {
    const { servicio, create } = crearServicio();

    await servicio.registrar({
      actor: ACTOR,
      entidad: 'Sala',
      entidadId: 'sala-1',
      accion: 'CREADA',
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        tenantId: 'gym-1',
        usuarioId: 'usr-1',
        entidad: 'Sala',
        entidadId: 'sala-1',
        accion: 'CREADA',
      },
    });
  });

  it('incluye el detalle cuando se pasa', async () => {
    const { servicio, create } = crearServicio();

    await servicio.registrar({
      actor: ACTOR,
      entidad: 'Reserva',
      entidadId: 'res-1',
      accion: 'CANCELADA',
      detalle: { tipo: 'RECUPERABLE' },
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ detalle: { tipo: 'RECUPERABLE' } }),
    });
  });

  it('omite la clave detalle si no se pasa, en vez de mandar undefined', async () => {
    const { servicio, create } = crearServicio();

    await servicio.registrar({
      actor: ACTOR,
      entidad: 'Sala',
      entidadId: 'sala-1',
      accion: 'CREADA',
    });

    expect(Object.keys(create.mock.calls[0][0].data)).not.toContain('detalle');
  });

  it('usa el cliente de transaccion cuando se le pasa uno', async () => {
    const { servicio, create } = crearServicio();
    const createTx = jest.fn().mockResolvedValue({ id: 'hist-2' });
    const tx = { historialAccion: { create: createTx } };

    await servicio.registrar(
      { actor: ACTOR, entidad: 'Turno', entidadId: 'tur-1', accion: 'CREADA' },
      tx as never,
    );

    // La auditoria tiene que vivir o morir con el cambio que la origino: si
    // escribiera fuera de la transaccion, un rollback dejaria historial de algo
    // que nunca paso.
    expect(createTx).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });
});
