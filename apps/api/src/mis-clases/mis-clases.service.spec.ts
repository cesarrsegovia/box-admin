import { NotFoundException } from '@nestjs/common';
import { MisClasesService } from './mis-clases.service';

const ACTOR = { sub: 'usuario-fati', tenantId: 't1', rol: 'PROFESOR' } as never;

const historialFalso = { registrar: jest.fn().mockResolvedValue(undefined) } as never;

function prismaFalso(estado: {
  perfil?: { id: string } | null;
  turnos?: Record<string, unknown>[];
  reservas?: Record<string, unknown>[];
}) {
  const turnos = estado.turnos ?? [];

  const db = {
    perfil: {
      findFirst: jest
        .fn()
        .mockResolvedValue(estado.perfil === undefined ? { id: 'fati' } : estado.perfil),
    },
    turno: {
      // Filtra de verdad por profesorId: un doble que lo ignora convierte los
      // tests de aislamiento en teatro — pasarian igual con el filtro borrado.
      findMany: jest
        .fn()
        .mockImplementation(({ where }: { where: Record<string, any> }) =>
          Promise.resolve(turnos.filter((t: any) => t.profesorId === where.profesorId)),
        ),
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: { where: Record<string, any> }) =>
          Promise.resolve(
            turnos.find(
              (t: any) =>
                t.id === where.id &&
                (where.profesorId === undefined || t.profesorId === where.profesorId),
            ) ?? null,
          ),
        ),
    },
    reserva: {
      findMany: jest.fn().mockResolvedValue(estado.reservas ?? []),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(db)),
  };

  return db;
}

const TURNO_DE_FATI = {
  id: 't-fati',
  profesorId: 'fati',
  salaId: 'sala-a',
  nombre: 'Pilates',
  fecha: new Date('2026-09-07T00:00:00.000Z'),
  horaInicio: '18:00',
  horaFin: '19:00',
  cupo: 5,
  sala: { nombre: 'Sala A' },
  reservas: [{ asistio: null }, { asistio: null }],
};

const TURNO_DE_ANA = { ...TURNO_DE_FATI, id: 't-ana', profesorId: 'ana' };

const RANGO = { desde: '2026-09-01', hasta: '2026-09-30' };

describe('MisClasesService.misClases', () => {
  it('devuelve solo las clases propias', async () => {
    const db = prismaFalso({ turnos: [TURNO_DE_FATI, TURNO_DE_ANA] });
    const servicio = new MisClasesService({ db } as never, historialFalso);

    const clases = await servicio.misClases(ACTOR, RANGO);

    expect(clases.map((c) => c.turnoId)).toEqual(['t-fati']);
  });

  it('listaPasada es false mientras nadie paso lista', async () => {
    const db = prismaFalso({ turnos: [TURNO_DE_FATI] });
    const servicio = new MisClasesService({ db } as never, historialFalso);

    const [clase] = await servicio.misClases(ACTOR, RANGO);

    expect(clase!.listaPasada).toBe(false);
    expect(clase!.reservasActivas).toBe(2);
  });

  it('listaPasada es true en cuanto alguna reserva tiene la marca', async () => {
    const db = prismaFalso({
      turnos: [{ ...TURNO_DE_FATI, reservas: [{ asistio: true }, { asistio: null }] }],
    });
    const servicio = new MisClasesService({ db } as never, historialFalso);

    const [clase] = await servicio.misClases(ACTOR, RANGO);

    expect(clase!.listaPasada).toBe(true);
  });

  it('un usuario sin perfil no tiene clases propias: 404', async () => {
    // Un admin, por ejemplo. No es un error del sistema: sencillamente no tiene
    // una vista de "mis clases" que mostrar.
    const db = prismaFalso({ perfil: null });
    const servicio = new MisClasesService({ db } as never, historialFalso);

    await expect(servicio.misClases(ACTOR, RANGO)).rejects.toThrow(NotFoundException);
  });
});

describe('MisClasesService.alumnos', () => {
  it('devuelve nombre y asistencia, y nada mas', async () => {
    const db = prismaFalso({
      turnos: [TURNO_DE_FATI],
      reservas: [
        { perfilId: 'p1', asistio: true, perfil: { usuario: { nombreCompleto: 'Ana Perez' } } },
      ],
    });
    const servicio = new MisClasesService({ db } as never, historialFalso);

    const alumnos = await servicio.alumnos(ACTOR, 't-fati');

    // Ni telefono ni ficha medica: desde la Fase 1 la ficha solo la ve
    // ADMIN_SALON o la propia persona.
    expect(alumnos).toEqual([{ perfilId: 'p1', nombreCompleto: 'Ana Perez', asistio: true }]);
  });

  it('el turno de otra profesora no existe para esta: 404', async () => {
    // 404 y no 403: confirmar que el turno existe pero es de otra ya seria
    // contar algo de la agenda ajena.
    const db = prismaFalso({ turnos: [TURNO_DE_FATI, TURNO_DE_ANA] });
    const servicio = new MisClasesService({ db } as never, historialFalso);

    await expect(servicio.alumnos(ACTOR, 't-ana')).rejects.toThrow(NotFoundException);
  });
});

describe('MisClasesService.pasarLista', () => {
  const YA_PASO = new Date('2026-09-07T20:00:00.000Z');

  function prismaParaLista(reservas: { perfilId: string }[]) {
    return prismaFalso({
      turnos: [TURNO_DE_FATI],
      reservas: reservas.map((r) => ({
        ...r,
        asistio: null,
        perfil: { usuario: { nombreCompleto: r.perfilId } },
      })),
    });
  }

  it('marca presentes y ausentes en la misma pasada', async () => {
    const db = prismaParaLista([{ perfilId: 'p1' }, { perfilId: 'p2' }, { perfilId: 'p3' }]);
    const servicio = new MisClasesService({ db } as never, historialFalso);

    await servicio.pasarLista(ACTOR, 't-fati', { presentes: ['p1', 'p3'] }, YA_PASO);

    const llamadas = db.reserva.updateMany.mock.calls.map((c: any) => c[0]);
    expect(llamadas).toContainEqual({
      where: { turnoId: 't-fati', canceladaEn: null, perfilId: { in: ['p1', 'p3'] } },
      data: { asistio: true },
    });
    expect(llamadas).toContainEqual({
      where: { turnoId: 't-fati', canceladaEn: null, perfilId: { notIn: ['p1', 'p3'] } },
      data: { asistio: false },
    });
  });

  it('con la lista vacia marca ausentes a todos, sin un notIn vacio', async () => {
    // `notIn: []` es una condicion que Prisma ha resuelto de formas distintas
    // segun la version. Se evita generandola solo cuando hay presentes.
    const db = prismaParaLista([{ perfilId: 'p1' }]);
    const servicio = new MisClasesService({ db } as never, historialFalso);

    await servicio.pasarLista(ACTOR, 't-fati', { presentes: [] }, YA_PASO);

    const llamadas = db.reserva.updateMany.mock.calls.map((c: any) => c[0]);
    expect(llamadas).toEqual([
      { where: { turnoId: 't-fati', canceladaEn: null }, data: { asistio: false } },
    ]);
  });

  it('rechaza a alguien que no tiene reserva en esa clase', async () => {
    // Un id equivocado marcaria ausente a media clase en silencio.
    const db = prismaParaLista([{ perfilId: 'p1' }]);
    const servicio = new MisClasesService({ db } as never, historialFalso);

    await expect(
      servicio.pasarLista(ACTOR, 't-fati', { presentes: ['p1', 'fantasma'] }, YA_PASO),
    ).rejects.toThrow(/fantasma/);
    expect(db.reserva.updateMany).not.toHaveBeenCalled();
  });

  it('no se puede pasar lista de una clase que no empezo', async () => {
    const db = prismaParaLista([{ perfilId: 'p1' }]);
    const servicio = new MisClasesService({ db } as never, historialFalso);
    const antesDeEmpezar = new Date('2026-09-07T10:00:00.000Z');

    await expect(
      servicio.pasarLista(ACTOR, 't-fati', { presentes: ['p1'] }, antesDeEmpezar),
    ).rejects.toThrow(/todavia no empezo/i);
  });

  it('el turno de otra profesora devuelve 404 antes de escribir nada', async () => {
    const db = prismaFalso({ turnos: [TURNO_DE_FATI, TURNO_DE_ANA] });
    const servicio = new MisClasesService({ db } as never, historialFalso);

    await expect(servicio.pasarLista(ACTOR, 't-ana', { presentes: [] }, YA_PASO)).rejects.toThrow(
      NotFoundException,
    );
    expect(db.reserva.updateMany).not.toHaveBeenCalled();
  });
});
