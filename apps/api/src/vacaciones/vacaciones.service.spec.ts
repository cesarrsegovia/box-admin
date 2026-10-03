import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { JwtPayload } from '@boxadmin/shared';
import { VacacionesService } from './vacaciones.service';
import type { HistorialService } from '../common/historial/historial.service';
import type { PrismaService } from '../prisma/prisma.service';

const ADMIN: JwtPayload = { sub: 'usr-1', tenantId: 'gym-1', rol: 'ADMIN_OPERATIVO' };

const FILA = {
  id: 'vac-1',
  tenantId: 'gym-1',
  perfilId: 'perf-1',
  desde: new Date('2026-10-05T00:00:00.000Z'),
  hasta: new Date('2026-10-12T00:00:00.000Z'),
  motivo: 'Viaje',
  createdAt: new Date(),
};

const BASE = { perfilId: 'perf-1', desde: '2026-10-05', hasta: '2026-10-12' };

function crearServicio() {
  const vacacionAlumno = {
    create: jest.fn().mockResolvedValue(FILA),
    findFirst: jest.fn().mockResolvedValue(FILA),
    findMany: jest.fn().mockResolvedValue([FILA]),
    delete: jest.fn().mockResolvedValue(FILA),
  };
  const perfil = {
    findFirst: jest.fn().mockResolvedValue({ id: 'perf-1', tenantId: 'gym-1' }),
  };

  const db = {
    vacacionAlumno,
    perfil,
    // La anotacion `: unknown` del retorno es obligatoria: sin ella tsc --strict
    // lanza TS7022 por inferencia circular sobre el doble.
    $transaction: jest.fn((fn: (tx: unknown) => unknown): unknown => fn(db)),
  };
  const prisma = { db } as unknown as PrismaService;
  const historial = { registrar: jest.fn().mockResolvedValue(undefined) };

  return {
    servicio: new VacacionesService(prisma, historial as unknown as HistorialService),
    vacacionAlumno,
    perfil,
    historial,
  };
}

describe('VacacionesService.crear', () => {
  it('crea el rango y lo audita', async () => {
    const { servicio, vacacionAlumno, historial } = crearServicio();

    const creada = await servicio.crear(ADMIN, BASE);

    expect(vacacionAlumno.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenantId: 'gym-1', perfilId: 'perf-1' }),
    });
    expect(historial.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ entidad: 'VacacionAlumno', accion: 'CREADA' }),
      expect.anything(),
    );
    expect(creada.id).toBe('vac-1');
  });

  it('guarda las fechas a medianoche UTC y las devuelve como YYYY-MM-DD', async () => {
    const { servicio, vacacionAlumno } = crearServicio();

    const creada = await servicio.crear(ADMIN, BASE);

    const data = vacacionAlumno.create.mock.calls[0][0].data;
    expect(data.desde.toISOString()).toBe('2026-10-05T00:00:00.000Z');
    expect(data.hasta.toISOString()).toBe('2026-10-12T00:00:00.000Z');
    expect(creada.desde).toBe('2026-10-05');
    expect(creada.hasta).toBe('2026-10-12');
  });

  it('400 si hasta es anterior a desde', async () => {
    const { servicio } = crearServicio();

    await expect(
      servicio.crear(ADMIN, { ...BASE, desde: '2026-10-12', hasta: '2026-10-05' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('acepta un unico dia (desde === hasta)', async () => {
    const { servicio, vacacionAlumno } = crearServicio();

    // Faltar un solo dia es el caso mas frecuente de todos.
    await expect(
      servicio.crear(ADMIN, { ...BASE, desde: '2026-10-05', hasta: '2026-10-05' }),
    ).resolves.toBeDefined();
    expect(vacacionAlumno.create).toHaveBeenCalled();
  });

  it('404 si el perfil no existe en este gimnasio', async () => {
    const { servicio, perfil } = crearServicio();
    perfil.findFirst.mockResolvedValue(null);

    await expect(servicio.crear(ADMIN, BASE)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('la respuesta ya no lleva devuelveClase, y el create tampoco lo escribe', async () => {
    // Cambio de contrato VISIBLE de la Fase 6B: las clases perdidas no se
    // devuelven. Los dos tests que vivian aqui afirmaban que el campo se
    // almacenaba tal cual y que por defecto era `true`; se sustituyen por su
    // contrario, no se ablandan.
    //
    // El `toEqual` es sobre el objeto ENTERO a proposito: con un
    // `objectContaining`, devolver el campo volveria a pasar. Y la
    // comprobacion de `Object.keys` va aparte porque `toEqual` ignora las
    // claves cuyo valor es `undefined`, que es justo la forma en que el campo
    // podria reaparecer sin que nadie lo notara.
    const { servicio, vacacionAlumno } = crearServicio();

    const creada = await servicio.crear(ADMIN, BASE);

    expect(creada).toEqual({
      id: 'vac-1',
      tenantId: 'gym-1',
      perfilId: 'perf-1',
      desde: '2026-10-05',
      hasta: '2026-10-12',
      motivo: 'Viaje',
    });
    expect(Object.keys(creada)).not.toContain('devuelveClase');
    expect(Object.keys(vacacionAlumno.create.mock.calls[0][0].data)).not.toContain('devuelveClase');
  });
});

describe('VacacionesService.listar', () => {
  it('listar filtra por perfilId', async () => {
    const { servicio, vacacionAlumno } = crearServicio();

    const rangos = await servicio.listar(ADMIN, { perfilId: 'perf-1' });

    expect(vacacionAlumno.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { perfilId: 'perf-1' } }),
    );
    expect(rangos).toHaveLength(1);
  });

  it('sin filtro devuelve todos los rangos del gimnasio', async () => {
    const { servicio, vacacionAlumno } = crearServicio();

    await servicio.listar(ADMIN, {});

    expect(vacacionAlumno.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });
});

describe('VacacionesService.darDeBaja', () => {
  it('darDeBaja borra el rango: unas vacaciones mal cargadas se corrigen borrandolas', async () => {
    const { servicio, vacacionAlumno, historial } = crearServicio();

    const borrada = await servicio.darDeBaja(ADMIN, 'vac-1');

    // A diferencia de rutinas y salas, aqui se borra de verdad: un rango de
    // vacaciones no explica ningun turno ya generado, asi que conservarlo solo
    // ensuciaria el calendario.
    expect(vacacionAlumno.delete).toHaveBeenCalledWith({ where: { id: 'vac-1' } });
    expect(historial.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ entidad: 'VacacionAlumno', accion: 'ELIMINADA' }),
      expect.anything(),
    );
    expect(borrada.id).toBe('vac-1');
  });

  it('404 al borrar un rango inexistente', async () => {
    const { servicio, vacacionAlumno, historial } = crearServicio();
    vacacionAlumno.findFirst.mockResolvedValue(null);

    await expect(servicio.darDeBaja(ADMIN, 'vac-x')).rejects.toBeInstanceOf(NotFoundException);
    expect(vacacionAlumno.delete).not.toHaveBeenCalled();
    expect(historial.registrar).not.toHaveBeenCalled();
  });
});
