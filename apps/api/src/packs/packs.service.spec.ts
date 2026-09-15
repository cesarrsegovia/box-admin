import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { JwtPayload } from '@boxadmin/shared';
import { PacksService } from './packs.service';
import type { HistorialService } from '../common/historial/historial.service';
import type { PrismaService } from '../prisma/prisma.service';

const ADMIN: JwtPayload = { sub: 'usr-1', tenantId: 'gym-1', rol: 'ADMIN_SALON' };
const ALUMNO: JwtPayload = { sub: 'usr-2', tenantId: 'gym-1', rol: 'ALUMNO' };

const FILA = {
  id: 'pack-1',
  tenantId: 'gym-1',
  nombre: '8 clases',
  salaId: null,
  tipo: 'MENSUAL' as const,
  precio: new Prisma.Decimal('12500.5'),
  clasesPorMes: 8,
  clasesTotales: null,
  cancelacionesPermitidas: 2,
  activo: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function crearServicio() {
  const pack = {
    create: jest.fn().mockResolvedValue(FILA),
    findFirst: jest.fn().mockResolvedValue(FILA),
    findMany: jest.fn().mockResolvedValue([FILA]),
    update: jest.fn().mockResolvedValue(FILA),
  };
  const sala = { findFirst: jest.fn().mockResolvedValue({ id: 'sala-1', activa: true }) };
  const db = {
    pack,
    sala,
    $transaction: jest.fn((fn: (tx: unknown) => unknown): unknown => fn(db)),
  };
  const prisma = { db } as unknown as PrismaService;
  const historial = { registrar: jest.fn().mockResolvedValue(undefined) };

  return {
    servicio: new PacksService(prisma, historial as unknown as HistorialService),
    pack,
    sala,
    historial,
    transaccion: db.$transaction,
  };
}

describe('PacksService.crear', () => {
  it('guarda el precio como Decimal, no como float', async () => {
    const { servicio, pack } = crearServicio();

    await servicio.crear(ADMIN, { nombre: '8 clases', tipo: 'MENSUAL', precio: '12500.50' });

    const enviado = pack.create.mock.calls[0][0].data.precio;
    expect(enviado).toBeInstanceOf(Prisma.Decimal);
    expect(enviado.toFixed(2)).toBe('12500.50');
  });

  it('devuelve el precio como string con dos decimales', async () => {
    const { servicio } = crearServicio();

    const creado = await servicio.crear(ADMIN, { nombre: '8 clases', tipo: 'MENSUAL' });

    expect(creado.precio).toBe('12500.50');
  });

  it('precio ausente significa "a consultar" y viaja como null', async () => {
    const { servicio, pack } = crearServicio();
    pack.create.mockResolvedValue({ ...FILA, precio: null });

    const creado = await servicio.crear(ADMIN, { nombre: 'A consultar', tipo: 'MENSUAL' });

    expect(creado.precio).toBeNull();
  });

  it('400 si un pack MENSUAL trae clasesTotales', async () => {
    const { servicio } = crearServicio();

    await expect(
      servicio.crear(ADMIN, { nombre: 'X', tipo: 'MENSUAL', clasesTotales: 10 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('400 si un pack TOTAL trae clasesPorMes', async () => {
    const { servicio } = crearServicio();

    await expect(
      servicio.crear(ADMIN, { nombre: 'X', tipo: 'TOTAL', clasesPorMes: 8 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404 si la sala indicada no existe en este gimnasio', async () => {
    const { servicio, sala } = crearServicio();
    sala.findFirst.mockResolvedValue(null);

    await expect(
      servicio.crear(ADMIN, { nombre: 'X', tipo: 'MENSUAL', salaId: 'sala-de-otro-gym' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('400 si la sala indicada esta dada de baja', async () => {
    const { servicio, sala, pack } = crearServicio();
    sala.findFirst.mockResolvedValue({ id: 'sala-1', activa: false });

    await expect(
      servicio.crear(ADMIN, { nombre: 'X', tipo: 'MENSUAL', salaId: 'sala-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(pack.create).not.toHaveBeenCalled();
  });

  it('comprueba la sala dentro de la transaccion, no antes', async () => {
    const { servicio, sala, transaccion } = crearServicio();

    await servicio.crear(ADMIN, { nombre: 'X', tipo: 'MENSUAL', salaId: 'sala-1' });

    // Fuera de la transaccion hay una ventana: si la sala desaparece entre la
    // comprobacion y el create, salta un P2003 que nadie traduce y el cliente
    // recibe un 500 opaco en vez del 404 que corresponde.
    expect(sala.findFirst.mock.invocationCallOrder[0]).toBeGreaterThan(
      transaccion.mock.invocationCallOrder[0],
    );
  });
});

describe('PacksService.listar', () => {
  it('un alumno solo ve los packs activos', async () => {
    const { servicio, pack } = crearServicio();

    await servicio.listar(ALUMNO, {});

    expect(pack.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { activo: true } }),
    );
  });

  it('un admin los ve todos salvo que filtre', async () => {
    const { servicio, pack } = crearServicio();

    await servicio.listar(ADMIN, {});

    expect(pack.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  it('filtra por sala incluyendo los packs sin sala, que valen para todas', async () => {
    const { servicio, pack } = crearServicio();

    await servicio.listar(ADMIN, { salaId: 'sala-1' });

    expect(pack.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ salaId: 'sala-1' }, { salaId: null }] },
      }),
    );
  });

  it('un admin puede pedir explicitamente los packs de baja con activo=false', async () => {
    const { servicio, pack } = crearServicio();

    await servicio.listar(ADMIN, { activo: false });

    expect(pack.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { activo: false } }),
    );
  });

  it('a un alumno no le sirve de nada pedir activo=false', async () => {
    const { servicio, pack } = crearServicio();

    await servicio.listar(ALUMNO, { activo: false });

    expect(pack.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { activo: true } }),
    );
  });
});

describe('PacksService.obtener', () => {
  it('resuelve un pack por id sin tener que bajarse el catalogo entero', async () => {
    const { servicio, pack } = crearServicio();

    const encontrado = await servicio.obtener(ALUMNO, 'pack-1');

    expect(pack.findFirst).toHaveBeenCalledWith({ where: { id: 'pack-1' } });
    expect(encontrado.id).toBe('pack-1');
  });

  it('404 si el pack no existe en este gimnasio', async () => {
    const { servicio, pack } = crearServicio();
    pack.findFirst.mockResolvedValue(null);

    await expect(servicio.obtener(ADMIN, 'pack-x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404 para un alumno si el pack esta de baja: mismo criterio que el listado', async () => {
    const { servicio, pack } = crearServicio();
    pack.findFirst.mockResolvedValue({ ...FILA, activo: false });

    await expect(servicio.obtener(ALUMNO, 'pack-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('un admin si puede obtener un pack de baja', async () => {
    const { servicio, pack } = crearServicio();
    pack.findFirst.mockResolvedValue({ ...FILA, activo: false });

    await expect(servicio.obtener(ADMIN, 'pack-1')).resolves.toMatchObject({ activo: false });
  });
});

describe('PacksService.actualizar', () => {
  it('404 si el pack no existe en este gimnasio', async () => {
    const { servicio, pack } = crearServicio();
    pack.findFirst.mockResolvedValue(null);

    await expect(servicio.actualizar(ADMIN, 'pack-x', { nombre: 'Y' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(pack.update).not.toHaveBeenCalled();
  });

  it('pasar de MENSUAL a TOTAL funciona y anula clasesPorMes', async () => {
    const { servicio, pack } = crearServicio();

    // FILA es MENSUAL con clasesPorMes: 8. Heredar ese contador al pasar a TOTAL
    // hacia imposible el cambio de tipo: siempre saltaba el 400 de coherencia.
    await servicio.actualizar(ADMIN, 'pack-1', { tipo: 'TOTAL', clasesTotales: 10 });

    expect(pack.update).toHaveBeenCalledWith({
      where: { id: 'pack-1' },
      data: expect.objectContaining({ tipo: 'TOTAL', clasesTotales: 10, clasesPorMes: null }),
    });
  });

  it('pasar de TOTAL a MENSUAL funciona y anula clasesTotales', async () => {
    const { servicio, pack } = crearServicio();
    pack.findFirst.mockResolvedValue({
      ...FILA,
      tipo: 'TOTAL' as const,
      clasesPorMes: null,
      clasesTotales: 10,
    });

    await servicio.actualizar(ADMIN, 'pack-1', { tipo: 'MENSUAL', clasesPorMes: 8 });

    expect(pack.update).toHaveBeenCalledWith({
      where: { id: 'pack-1' },
      data: expect.objectContaining({ tipo: 'MENSUAL', clasesPorMes: 8, clasesTotales: null }),
    });
  });

  it('400 si el nuevo tipo sigue siendo incoherente con lo que trae el PATCH', async () => {
    const { servicio } = crearServicio();

    await expect(
      servicio.actualizar(ADMIN, 'pack-1', { tipo: 'TOTAL', clasesPorMes: 8 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('sin tipo nuevo se sigue validando contra el contador guardado', async () => {
    const { servicio } = crearServicio();

    // FILA es MENSUAL: mandarle clasesTotales sin cambiar el tipo sigue siendo 400.
    await expect(
      servicio.actualizar(ADMIN, 'pack-1', { clasesTotales: 10 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('precio ausente no pisa el precio guardado', async () => {
    const { servicio, pack } = crearServicio();

    await servicio.actualizar(ADMIN, 'pack-1', { nombre: 'Otro nombre' });

    // undefined para Prisma es "no tocar"; un null lo borraria.
    expect(pack.update.mock.calls[0][0].data.precio).toBeUndefined();
  });

  it('el precio nuevo viaja como Decimal', async () => {
    const { servicio, pack } = crearServicio();

    await servicio.actualizar(ADMIN, 'pack-1', { precio: '9000.10' });

    const enviado = pack.update.mock.calls[0][0].data.precio;
    expect(enviado).toBeInstanceOf(Prisma.Decimal);
    expect(enviado.toFixed(2)).toBe('9000.10');
  });

  it('deja rastro ACTUALIZADA en el historial', async () => {
    const { servicio, historial } = crearServicio();

    await servicio.actualizar(ADMIN, 'pack-1', { nombre: 'Otro nombre' });

    expect(historial.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        entidad: 'Pack',
        entidadId: 'pack-1',
        accion: 'ACTUALIZADA',
        detalle: { nombre: 'Otro nombre' },
      }),
      expect.anything(),
    );
  });

  it('400 al mover el pack a una sala dada de baja', async () => {
    const { servicio, sala, pack } = crearServicio();
    sala.findFirst.mockResolvedValue({ id: 'sala-2', activa: false });

    await expect(servicio.actualizar(ADMIN, 'pack-1', { salaId: 'sala-2' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(pack.update).not.toHaveBeenCalled();
  });

  it('no revalida la sala si el pack ya colgaba de ella', async () => {
    const { servicio, sala, pack } = crearServicio();
    pack.findFirst.mockResolvedValue({ ...FILA, salaId: 'sala-1' });

    // La sala se dio de baja despues de crear el pack: renombrarlo (o mandar el
    // mismo salaId) no puede quedar bloqueado para siempre.
    await servicio.actualizar(ADMIN, 'pack-1', { salaId: 'sala-1', nombre: 'Otro' });

    expect(sala.findFirst).not.toHaveBeenCalled();
    expect(pack.update).toHaveBeenCalled();
  });
});

describe('PacksService.darDeBaja', () => {
  it('marca activo=false sin borrar: los perfiles que lo tengan asignado siguen apuntando a el', async () => {
    const { servicio, pack } = crearServicio();

    await servicio.darDeBaja(ADMIN, 'pack-1');

    expect(pack.update).toHaveBeenCalledWith({
      where: { id: 'pack-1' },
      data: { activo: false },
    });
  });

  it('404 si el pack no existe en este gimnasio', async () => {
    const { servicio, pack } = crearServicio();
    pack.findFirst.mockResolvedValue(null);

    await expect(servicio.darDeBaja(ADMIN, 'pack-x')).rejects.toBeInstanceOf(NotFoundException);
    expect(pack.update).not.toHaveBeenCalled();
  });

  it('deja rastro DADA_DE_BAJA en el historial', async () => {
    const { servicio, historial } = crearServicio();

    await servicio.darDeBaja(ADMIN, 'pack-1');

    expect(historial.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ entidad: 'Pack', entidadId: 'pack-1', accion: 'DADA_DE_BAJA' }),
      expect.anything(),
    );
  });

  it('es idempotente: repetir la baja no vuelve a escribir en el historial', async () => {
    const { servicio, pack, historial } = crearServicio();
    pack.findFirst.mockResolvedValue({ ...FILA, activo: false });

    const devuelto = await servicio.darDeBaja(ADMIN, 'pack-1');

    expect(devuelto.activo).toBe(false);
    expect(pack.update).not.toHaveBeenCalled();
    expect(historial.registrar).not.toHaveBeenCalled();
  });
});
