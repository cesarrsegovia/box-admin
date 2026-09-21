import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { HorariosProfesorService } from './horarios-profesor.service';

const ACTOR = { sub: 'admin-1', tenantId: 't1', rol: 'ADMIN_OPERATIVO' } as never;

const dia = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

function baseDelAlta(parcial: Record<string, unknown> = {}) {
  return {
    profesorId: 'fati',
    salaId: 'sala-a',
    diaSemana: 1,
    horaInicio: '18:00',
    horaFin: '19:00',
    desde: '2026-09-01',
    ...parcial,
  } as never;
}

/**
 * Doble de Prisma con lo justo. `horarioProfesorAsignado.findMany` filtra de
 * verdad por `diaSemana` y por el OR de sala/profesora, porque un doble que
 * ignora el filtro convierte los tests de solape en teatro: pasarian igual con
 * el filtro borrado del servicio.
 */
function prismaFalso(estado: {
  perfil?: Record<string, unknown> | null;
  /** A que salas tiene ACCESO la profesora. Todas existen; eso es otra cosa. */
  salas?: string[];
  horarios?: Record<string, unknown>[];
}) {
  const horarios = estado.horarios ?? [];

  const db = {
    perfil: {
      findFirst: jest.fn().mockResolvedValue(estado.perfil ?? null),
    },
    sala: {
      // Las salas del gimnasio existen todas. Que la profesora tenga acceso o no
      // es una pregunta distinta, y la contesta usuarioSala: un doble que las
      // mezclara haria que el test del acceso pasara por el motivo equivocado.
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: { where: { id: string } }) =>
          Promise.resolve({ id: where.id, nombre: `Sala ${where.id}`, activa: true }),
        ),
    },
    usuarioSala: {
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: { where: { salaId: string } }) =>
          Promise.resolve(
            (estado.salas ?? ['sala-a']).includes(where.salaId) ? { salaId: where.salaId } : null,
          ),
        ),
    },
    horarioProfesorAsignado: {
      findMany: jest.fn().mockImplementation(({ where }: { where: Record<string, any> }) =>
        Promise.resolve(
          horarios.filter((h: any) => {
            if (where.diaSemana !== undefined && h.diaSemana !== where.diaSemana) return false;
            if (where.activo !== undefined && h.activo !== where.activo) return false;
            if (where.id?.not !== undefined && h.id === where.id.not) return false;
            if (where.OR) {
              const encaja = where.OR.some(
                (c: any) =>
                  (c.salaId !== undefined && c.salaId === h.salaId) ||
                  (c.profesorId !== undefined && c.profesorId === h.profesorId),
              );
              if (!encaja) return false;
            }
            return true;
          }),
        ),
      ),
      findFirst: jest.fn().mockResolvedValue({
        id: 'nuevo',
        profesorId: 'fati',
        salaId: 'sala-a',
        diaSemana: 1,
        horaInicio: '18:00',
        horaFin: '19:00',
        activo: true,
        desde: dia('2026-09-01'),
        hasta: null,
        tarifaPorHora: null,
        profesor: { usuario: { nombreCompleto: 'Fati' } },
        sala: { nombre: 'Sala A' },
      }),
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'nuevo', activo: true, tarifaPorHora: null, ...data }),
        ),
      update: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(db)),
  };

  return db;
}

const historialFalso = { registrar: jest.fn().mockResolvedValue(undefined) } as never;

const PROFESORA = { id: 'fati', usuario: { rol: 'PROFESOR', nombreCompleto: 'Fati' } };

describe('HorariosProfesorService.crear', () => {
  it('rechaza un perfil que no existe', async () => {
    const db = prismaFalso({ perfil: null });
    const servicio = new HorariosProfesorService({ db } as never, historialFalso);

    await expect(servicio.crear(ACTOR, baseDelAlta())).rejects.toThrow(NotFoundException);
  });

  it('rechaza un perfil que no es profesor', async () => {
    const db = prismaFalso({
      perfil: { id: 'fati', usuario: { rol: 'ALUMNO', nombreCompleto: 'Ana' } },
    });
    const servicio = new HorariosProfesorService({ db } as never, historialFalso);

    await expect(servicio.crear(ACTOR, baseDelAlta())).rejects.toThrow(BadRequestException);
  });

  it('rechaza una sala a la que la profesora no tiene acceso', async () => {
    // Sin esta puerta, la profesora acabaria con un turno en una sala que no
    // puede ni ver, y las dos mitades del sistema dirian cosas distintas sobre
    // la misma clase.
    const db = prismaFalso({ perfil: PROFESORA, salas: ['sala-a'] });
    const servicio = new HorariosProfesorService({ db } as never, historialFalso);

    await expect(servicio.crear(ACTOR, baseDelAlta({ salaId: 'sala-b' }))).rejects.toThrow(
      /acceso a la sala/i,
    );
  });

  it('rechaza horaFin anterior a horaInicio', async () => {
    const db = prismaFalso({ perfil: PROFESORA });
    const servicio = new HorariosProfesorService({ db } as never, historialFalso);

    await expect(
      servicio.crear(ACTOR, baseDelAlta({ horaInicio: '19:00', horaFin: '18:00' })),
    ).rejects.toThrow(BadRequestException);
  });

  it('rechaza hasta anterior a desde', async () => {
    const db = prismaFalso({ perfil: PROFESORA });
    const servicio = new HorariosProfesorService({ db } as never, historialFalso);

    await expect(
      servicio.crear(ACTOR, baseDelAlta({ desde: '2026-09-30', hasta: '2026-09-01' })),
    ).rejects.toThrow(BadRequestException);
  });

  it('409 si otra profesora ya cubre esa sala, dia y hora', async () => {
    const db = prismaFalso({
      perfil: PROFESORA,
      horarios: [
        {
          id: 'h-ana',
          profesorId: 'ana',
          salaId: 'sala-a',
          diaSemana: 1,
          horaInicio: '18:00',
          horaFin: '19:00',
          desde: dia('2026-09-01'),
          hasta: null,
          activo: true,
        },
      ],
    });
    const servicio = new HorariosProfesorService({ db } as never, historialFalso);

    await expect(servicio.crear(ACTOR, baseDelAlta())).rejects.toThrow(ConflictException);
  });

  it('409 aunque solo se pisen media hora', async () => {
    const db = prismaFalso({
      perfil: PROFESORA,
      horarios: [
        {
          id: 'h-ana',
          profesorId: 'ana',
          salaId: 'sala-a',
          diaSemana: 1,
          horaInicio: '18:30',
          horaFin: '19:30',
          desde: dia('2026-09-01'),
          hasta: null,
          activo: true,
        },
      ],
    });
    const servicio = new HorariosProfesorService({ db } as never, historialFalso);

    await expect(servicio.crear(ACTOR, baseDelAlta())).rejects.toThrow(ConflictException);
  });

  it('deja pasar dos clases seguidas en la misma sala', async () => {
    // 18:00-19:00 y 19:00-20:00 son consecutivas, no simultaneas.
    const db = prismaFalso({
      perfil: PROFESORA,
      horarios: [
        {
          id: 'h-ana',
          profesorId: 'ana',
          salaId: 'sala-a',
          diaSemana: 1,
          horaInicio: '19:00',
          horaFin: '20:00',
          desde: dia('2026-09-01'),
          hasta: null,
          activo: true,
        },
      ],
    });
    const servicio = new HorariosProfesorService({ db } as never, historialFalso);

    await expect(servicio.crear(ACTOR, baseDelAlta())).resolves.toMatchObject({
      profesorId: 'fati',
    });
  });

  it('deja pasar el relevo: uno termina y el otro empieza despues', async () => {
    const db = prismaFalso({
      perfil: PROFESORA,
      horarios: [
        {
          id: 'h-ana',
          profesorId: 'ana',
          salaId: 'sala-a',
          diaSemana: 1,
          horaInicio: '18:00',
          horaFin: '19:00',
          desde: dia('2026-09-01'),
          hasta: dia('2026-09-30'),
          activo: true,
        },
      ],
    });
    const servicio = new HorariosProfesorService({ db } as never, historialFalso);

    await expect(
      servicio.crear(ACTOR, baseDelAlta({ desde: '2026-10-01' })),
    ).resolves.toMatchObject({ profesorId: 'fati' });
  });

  it('409 si la MISMA profesora ya esta en otra sala a esa hora', async () => {
    const db = prismaFalso({
      perfil: PROFESORA,
      salas: ['sala-a', 'sala-b'],
      horarios: [
        {
          id: 'h-otra',
          profesorId: 'fati',
          salaId: 'sala-b',
          diaSemana: 1,
          horaInicio: '18:00',
          horaFin: '19:00',
          desde: dia('2026-09-01'),
          hasta: null,
          activo: true,
        },
      ],
    });
    const servicio = new HorariosProfesorService({ db } as never, historialFalso);

    await expect(servicio.crear(ACTOR, baseDelAlta())).rejects.toThrow(/dos salas a la vez/i);
  });

  it('ignora los horarios dados de baja', async () => {
    const db = prismaFalso({
      perfil: PROFESORA,
      horarios: [
        {
          id: 'h-ana',
          profesorId: 'ana',
          salaId: 'sala-a',
          diaSemana: 1,
          horaInicio: '18:00',
          horaFin: '19:00',
          desde: dia('2026-09-01'),
          hasta: null,
          activo: false,
        },
      ],
    });
    const servicio = new HorariosProfesorService({ db } as never, historialFalso);

    await expect(servicio.crear(ACTOR, baseDelAlta())).resolves.toMatchObject({
      profesorId: 'fati',
    });
  });
});

describe('HorariosProfesorService.eliminar', () => {
  it('da de baja y ademas cierra el hasta abierto, sin borrar la fila', async () => {
    // La liquidacion mira desde/hasta y NO activo: cerrar el hasta es lo que
    // hace que borrar un horario no reescriba los meses ya liquidados.
    const db = prismaFalso({ perfil: PROFESORA });
    db.horarioProfesorAsignado.findFirst = jest.fn().mockResolvedValue({
      id: 'h1',
      profesorId: 'fati',
      salaId: 'sala-a',
      desde: dia('2026-09-01'),
      hasta: null,
      activo: true,
    });
    const servicio = new HorariosProfesorService({ db } as never, historialFalso);

    await servicio.eliminar(ACTOR, 'h1');

    const datos = db.horarioProfesorAsignado.update.mock.calls[0]![0].data;
    expect(datos.activo).toBe(false);
    expect(datos.hasta).toBeInstanceOf(Date);
  });

  it('no toca un hasta que ya estaba en el pasado', async () => {
    const db = prismaFalso({ perfil: PROFESORA });
    db.horarioProfesorAsignado.findFirst = jest.fn().mockResolvedValue({
      id: 'h1',
      profesorId: 'fati',
      salaId: 'sala-a',
      desde: dia('2026-01-01'),
      hasta: dia('2026-01-31'),
      activo: true,
    });
    const servicio = new HorariosProfesorService({ db } as never, historialFalso);

    await servicio.eliminar(ACTOR, 'h1');

    const datos = db.horarioProfesorAsignado.update.mock.calls[0]![0].data;
    expect(datos.activo).toBe(false);
    expect(datos.hasta).toBeUndefined();
  });
});
