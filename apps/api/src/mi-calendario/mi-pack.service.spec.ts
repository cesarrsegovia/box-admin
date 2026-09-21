import { NotFoundException } from '@nestjs/common';
import type { JwtPayload } from '@boxadmin/shared';
import { MiPackService } from './mi-pack.service';
import type { PrismaService } from '../prisma/prisma.service';

const ALUMNO: JwtPayload = { sub: 'usr-1', tenantId: 'gym-1', rol: 'ALUMNO' };
const AHORA = new Date('2099-10-15T10:00:00.000Z');

const PACK_MENSUAL = {
  id: 'pack-1',
  tenantId: 'gym-1',
  nombre: '8 clases',
  salaId: null,
  tipo: 'MENSUAL' as const,
  // Los Decimal de Prisma exponen toFixed; el doble imita esa forma.
  precio: null,
  clasesPorMes: 8,
  clasesTotales: null,
  cancelacionesPermitidas: 2,
  activo: true,
};

const PERFIL = {
  id: 'perfil-1',
  clasesExtra: 0,
  cancelacionesUsadas: 1,
  pagoAlDia: true,
  vigenciaDesde: null as Date | null,
  vigenciaHasta: null as Date | null,
  pack: PACK_MENSUAL,
};

function crearServicio() {
  const db = {
    perfil: { findFirst: jest.fn().mockResolvedValue(PERFIL) },
    reserva: { count: jest.fn().mockResolvedValue(3) },
  };

  return { servicio: new MiPackService({ db } as unknown as PrismaService), db };
}

describe('MiPackService.deActor', () => {
  it('devuelve el consumo del periodo con sus restantes', async () => {
    const { servicio } = crearServicio();

    const mp = await servicio.deActor(ALUMNO, AHORA);

    expect(mp).toMatchObject({
      tope: 8,
      consumidas: 3,
      restantes: 5,
      cancelacionesUsadas: 1,
      cancelacionesPermitidas: 2,
      pagoAlDia: true,
    });
    expect(mp.pack).toMatchObject({ id: 'pack-1', nombre: '8 clases' });
  });

  it('un pack MENSUAL cuenta sobre el mes calendario de HOY', async () => {
    const { servicio, db } = crearServicio();

    await servicio.deActor(ALUMNO, AHORA);

    // No hay turno del que sacar la fecha, asi que la ventana es la del mes en
    // curso: es lo que significa "mi pack" cuando lo mira el alumno.
    expect(db.reserva.count.mock.calls[0][0].where.turno.fecha).toEqual({
      gte: new Date('2099-10-01T00:00:00.000Z'),
      lte: new Date('2099-10-31T00:00:00.000Z'),
    });
  });

  it('expone la ventana en YYYY-MM-DD', async () => {
    const { servicio } = crearServicio();

    const mp = await servicio.deActor(ALUMNO, AHORA);

    expect(mp.ventanaDesde).toBe('2099-10-01');
    expect(mp.ventanaHasta).toBe('2099-10-31');
  });

  it('cuenta las activas MAS las canceladas como DEFINITIVA', async () => {
    const { servicio, db } = crearServicio();

    await servicio.deActor(ALUMNO, AHORA);

    // Es la misma regla que advertenciasDePack desde la Fase 1: una cancelacion
    // DEFINITIVA sigue gastando la clase, una RECUPERABLE no.
    expect(db.reserva.count.mock.calls[0][0].where.OR).toEqual([
      { canceladaEn: null },
      { cancelacionTipo: 'DEFINITIVA' },
    ]);
  });

  it('las clases extra suben el tope', async () => {
    const { servicio, db } = crearServicio();
    db.perfil.findFirst.mockResolvedValue({ ...PERFIL, clasesExtra: 2 });

    const mp = await servicio.deActor(ALUMNO, AHORA);

    expect(mp.tope).toBe(10);
    expect(mp.restantes).toBe(7);
  });

  it('sin pack no hay tope ni restantes, pero si consumo', async () => {
    const { servicio, db } = crearServicio();
    db.perfil.findFirst.mockResolvedValue({ ...PERFIL, pack: null });

    const mp = await servicio.deActor(ALUMNO, AHORA);

    expect(mp.pack).toBeNull();
    expect(mp.tope).toBeNull();
    expect(mp.restantes).toBeNull();
    expect(mp.consumidas).toBe(3);
  });

  it('restantes nunca es negativo', async () => {
    const { servicio, db } = crearServicio();
    db.reserva.count.mockResolvedValue(12);

    const mp = await servicio.deActor(ALUMNO, AHORA);

    // Pasarse del pack esta permitido desde la Fase 1 (avisa, no bloquea), asi
    // que 12 de 8 es un estado real. "-4 restantes" no se lo dice a nadie.
    expect(mp.restantes).toBe(0);
    expect(mp.consumidas).toBe(12);
  });

  it('un pack TOTAL cuenta sobre la vigencia del perfil', async () => {
    const { servicio, db } = crearServicio();
    db.perfil.findFirst.mockResolvedValue({
      ...PERFIL,
      vigenciaDesde: new Date('2099-01-01T00:00:00.000Z'),
      vigenciaHasta: new Date('2099-12-31T00:00:00.000Z'),
      pack: { ...PACK_MENSUAL, tipo: 'TOTAL', clasesPorMes: null, clasesTotales: 40 },
    });

    const mp = await servicio.deActor(ALUMNO, AHORA);

    expect(mp.tope).toBe(40);
    expect(mp.ventanaDesde).toBe('2099-01-01');
    expect(mp.ventanaHasta).toBe('2099-12-31');
  });

  it('un pack sin tope declarado no inventa uno', async () => {
    const { servicio, db } = crearServicio();
    db.perfil.findFirst.mockResolvedValue({
      ...PERFIL,
      pack: { ...PACK_MENSUAL, clasesPorMes: null },
    });

    const mp = await servicio.deActor(ALUMNO, AHORA);

    expect(mp.tope).toBeNull();
    expect(mp.restantes).toBeNull();
  });

  it('404 si el actor no tiene perfil', async () => {
    const { servicio, db } = crearServicio();
    db.perfil.findFirst.mockResolvedValue(null);

    await expect(servicio.deActor(ALUMNO, AHORA)).rejects.toBeInstanceOf(NotFoundException);
  });
});
