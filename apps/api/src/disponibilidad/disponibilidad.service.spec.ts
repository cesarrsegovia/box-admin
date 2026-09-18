import type { JwtPayload } from '@boxadmin/shared';
import { DisponibilidadService } from './disponibilidad.service';
import type { PrismaService } from '../prisma/prisma.service';

const ALUMNO: JwtPayload = { sub: 'usr-1', tenantId: 'gym-1', rol: 'ALUMNO' };
const AHORA = new Date('2099-10-01T10:00:00.000Z');

const TURNO = {
  id: 'turno-1',
  salaId: 'sala-1',
  fecha: new Date('2099-10-02T00:00:00.000Z'),
  horaInicio: '10:00',
  horaFin: '11:00',
  nombre: 'Pilates',
  cupo: 5,
  sala: {
    activa: true,
    visibleAlumnos: true,
    soloCuposLiberados: false,
    minMinutosCancelar: null,
    minMinutosAnotarse: null,
    listaEsperaHabilitada: null,
  },
};

function crearServicio() {
  const db = {
    turno: { findFirst: jest.fn().mockResolvedValue(TURNO), findMany: jest.fn() },
    tenant: {
      findFirst: jest.fn().mockResolvedValue({
        minMinutosCancelar: null,
        minMinutosAnotarse: null,
        listaEsperaHabilitada: null,
      }),
    },
    reserva: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
    listaEspera: { findMany: jest.fn().mockResolvedValue([]) },
    usuarioSala: { findMany: jest.fn().mockResolvedValue([{ salaId: 'sala-1' }]) },
    mesCalendario: {
      findMany: jest.fn().mockResolvedValue([{ salaId: 'sala-1', anio: 2099, mes: 10 }]),
    },
  };

  return {
    servicio: new DisponibilidadService({ db } as unknown as PrismaService),
    db,
  };
}

describe('DisponibilidadService.paraTurno', () => {
  it('devuelve LIBRE cuando hay cupo y el alumno cumple todo', async () => {
    const { servicio } = crearServicio();

    const d = await servicio.paraTurno(ALUMNO, 'perfil-1', 'turno-1', AHORA);

    expect(d).toMatchObject({
      turnoId: 'turno-1',
      estado: 'LIBRE',
      puedeReservar: true,
      motivo: null,
    });
  });

  it('el mes sin publicar bloquea al alumno', async () => {
    const { servicio, db } = crearServicio();
    db.mesCalendario.findMany.mockResolvedValue([]);

    const d = await servicio.paraTurno(ALUMNO, 'perfil-1', 'turno-1', AHORA);

    expect(d.motivo).toBe('MES_NO_PUBLICADO');
  });

  it('sin acceso a la sala bloquea al alumno', async () => {
    const { servicio, db } = crearServicio();
    db.usuarioSala.findMany.mockResolvedValue([]);

    const d = await servicio.paraTurno(ALUMNO, 'perfil-1', 'turno-1', AHORA);

    expect(d.motivo).toBe('SIN_ACCESO_A_SALA');
  });

  it('solo cuenta como publicado el mes HABILITADO de ESA sala', async () => {
    const { servicio, db } = crearServicio();
    // Publicado el mes correcto pero de OTRA sala.
    db.mesCalendario.findMany.mockResolvedValue([{ salaId: 'sala-9', anio: 2099, mes: 10 }]);

    const d = await servicio.paraTurno(ALUMNO, 'perfil-1', 'turno-1', AHORA);

    // El findMany ya filtra por salaId, asi que devolver otra sala solo puede
    // pasar si el filtro se pierde: por eso el where se comprueba aparte.
    expect(db.mesCalendario.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ salaId: 'sala-1' }) }),
    );
    expect(d.motivo).toBeNull();
  });

  it('404 si el turno no existe', async () => {
    const { servicio, db } = crearServicio();
    db.turno.findFirst.mockResolvedValue(null);

    await expect(servicio.paraTurno(ALUMNO, 'perfil-1', 'turno-9', AHORA)).rejects.toThrow(
      'Turno inexistente',
    );
  });

  it('pide solo los meses HABILITADO', async () => {
    const { servicio, db } = crearServicio();

    await servicio.paraTurno(ALUMNO, 'perfil-1', 'turno-1', AHORA);

    expect(db.mesCalendario.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ estado: 'HABILITADO' }) }),
    );
  });

  it('cuenta como ocupadas solo las reservas activas', async () => {
    const { servicio, db } = crearServicio();

    await servicio.paraTurno(ALUMNO, 'perfil-1', 'turno-1', AHORA);

    expect(db.reserva.count).toHaveBeenCalledWith({
      where: { turnoId: 'turno-1', canceladaEn: null },
    });
  });

  it('un cupo liberado sale de que exista alguna reserva cancelada', async () => {
    const { servicio, db } = crearServicio();
    db.turno.findFirst.mockResolvedValue({
      ...TURNO,
      sala: { ...TURNO.sala, soloCuposLiberados: true },
    });
    // Primera llamada: activas. Segunda: canceladas.
    db.reserva.count.mockResolvedValueOnce(2).mockResolvedValueOnce(1);

    const d = await servicio.paraTurno(ALUMNO, 'perfil-1', 'turno-1', AHORA);

    expect(d.estado).toBe('LIBRE');
  });

  it('sin cancelaciones, una sala de solo cupos liberados queda en SOLO_ADMIN', async () => {
    const { servicio, db } = crearServicio();
    db.turno.findFirst.mockResolvedValue({
      ...TURNO,
      sala: { ...TURNO.sala, soloCuposLiberados: true },
    });
    db.reserva.count.mockResolvedValueOnce(2).mockResolvedValueOnce(0);

    const d = await servicio.paraTurno(ALUMNO, 'perfil-1', 'turno-1', AHORA);

    expect(d.estado).toBe('SOLO_ADMIN');
    expect(d.motivo).toBe('SOLO_CUPOS_LIBERADOS');
  });

  it('deriva la posicion en la lista de espera del orden de la cola', async () => {
    const { servicio, db } = crearServicio();
    db.listaEspera.findMany.mockResolvedValue([
      { perfilId: 'otro-1' },
      { perfilId: 'perfil-1' },
      { perfilId: 'otro-2' },
    ]);

    const d = await servicio.paraTurno(ALUMNO, 'perfil-1', 'turno-1', AHORA);

    expect(d.enListaEspera).toBe(true);
    expect(d.posicionEnLista).toBe(2);
    expect(db.listaEspera.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    );
  });
});

describe('DisponibilidadService.configuracionDeSala', () => {
  it('la sala manda sobre el tenant', async () => {
    const { servicio, db } = crearServicio();
    db.tenant.findFirst.mockResolvedValue({
      minMinutosCancelar: 240,
      minMinutosAnotarse: 240,
      listaEsperaHabilitada: true,
    });

    const config = await servicio.configuracionDeSala({
      minMinutosCancelar: 120,
      minMinutosAnotarse: null,
      listaEsperaHabilitada: null,
    });

    expect(config).toEqual({
      minMinutosCancelar: 120,
      minMinutosAnotarse: 240,
      listaEsperaHabilitada: true,
    });
  });

  it('sin fila de tenant cae a los valores del sistema', async () => {
    const { servicio, db } = crearServicio();
    db.tenant.findFirst.mockResolvedValue(null);

    const config = await servicio.configuracionDeSala({
      minMinutosCancelar: null,
      minMinutosAnotarse: null,
      listaEsperaHabilitada: null,
    });

    expect(config).toEqual({
      minMinutosCancelar: 0,
      minMinutosAnotarse: 0,
      listaEsperaHabilitada: false,
    });
  });

  it('no pasa el id del tenant a mano: lo inyecta la extension de aislamiento', async () => {
    const { servicio, db } = crearServicio();

    await servicio.configuracionDeSala({
      minMinutosCancelar: null,
      minMinutosAnotarse: null,
      listaEsperaHabilitada: null,
    });

    // En contexto de tenant, findFirst() sobre Tenant ya queda restringido al
    // propio gimnasio. Pasarlo a mano seria redundante y, peor, daria la
    // impresion de que el aislamiento depende de acordarse.
    expect(db.tenant.findFirst).toHaveBeenCalledWith();
  });
});
