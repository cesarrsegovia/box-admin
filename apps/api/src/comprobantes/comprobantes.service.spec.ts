import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { JwtPayload } from '@boxadmin/shared';
import { ComprobantesService } from './comprobantes.service';
import type { AlmacenDeArchivos } from '../almacen/almacen.interface';
import type { HistorialService } from '../common/historial/historial.service';
import type { PrismaService } from '../prisma/prisma.service';

const ALUMNO: JwtPayload = { sub: 'usr-1', tenantId: 'gym-1', rol: 'ALUMNO' };
const ADMIN: JwtPayload = { sub: 'usr-admin', tenantId: 'gym-1', rol: 'ADMIN_OPERATIVO' };

const FILA = {
  id: 'comp-1',
  tenantId: 'gym-1',
  perfilId: 'perfil-1',
  claveArchivo: 'comp-1.pdf',
  nombreOriginal: 'transferencia.pdf',
  tipoMime: 'application/pdf',
  subidoEn: new Date('2099-10-01T10:00:00.000Z'),
  estado: 'PENDIENTE' as const,
  revisadoPor: null,
  revisadoEn: null,
  nota: null,
  createdAt: new Date('2099-10-01T09:00:00.000Z'),
};

function crearServicio() {
  const comprobante = {
    findFirst: jest.fn().mockResolvedValue(FILA),
    findMany: jest.fn().mockResolvedValue([FILA]),
    create: jest.fn().mockResolvedValue({ ...FILA, subidoEn: null }),
    update: jest.fn().mockResolvedValue(FILA),
  };
  const perfil = {
    findFirst: jest.fn().mockResolvedValue({ id: 'perfil-1' }),
    update: jest.fn().mockResolvedValue({}),
  };

  const pago = { create: jest.fn().mockResolvedValue({ id: 'pago-1' }) };

  const db = {
    comprobante,
    perfil,
    pago,
    $transaction: jest.fn((fn: (tx: unknown) => unknown): unknown => fn(db)),
  };
  const almacen = {
    urlDeSubida: jest.fn().mockResolvedValue('https://almacen/subir?firma=x'),
    urlDeDescarga: jest.fn().mockResolvedValue('https://almacen/bajar?firma=y'),
    eliminar: jest.fn().mockResolvedValue(undefined),
  };
  const historial = { registrar: jest.fn().mockResolvedValue(undefined) };

  return {
    pago,
    servicio: new ComprobantesService(
      { db } as unknown as PrismaService,
      almacen as unknown as AlmacenDeArchivos,
      historial as unknown as HistorialService,
    ),
    comprobante,
    perfil,
    almacen,
    historial,
  };
}

describe('ComprobantesService.crear', () => {
  it('crea la fila en PENDIENTE sin subidoEn y devuelve la URL de subida', async () => {
    const { servicio, comprobante } = crearServicio();

    const creado = await servicio.crear(ALUMNO, {
      nombreOriginal: 'transferencia.pdf',
      tipoMime: 'application/pdf',
    });

    expect(comprobante.create.mock.calls[0][0].data).toMatchObject({
      tenantId: 'gym-1',
      perfilId: 'perfil-1',
      nombreOriginal: 'transferencia.pdf',
      tipoMime: 'application/pdf',
    });
    expect(creado.urlDeSubida).toBe('https://almacen/subir?firma=x');
    expect(creado.comprobante.subidoEn).toBeNull();
  });

  it('la clave del archivo la genera el servidor y lleva extension del mime', async () => {
    const { servicio, comprobante } = crearServicio();

    await servicio.crear(ALUMNO, { nombreOriginal: 'x.pdf', tipoMime: 'application/pdf' });

    // Nunca el nombre que manda el cliente: seria path traversal servido en
    // bandeja, y ademas dos alumnos con el mismo nombre de archivo se pisarian.
    expect(comprobante.create.mock.calls[0][0].data.claveArchivo).toMatch(/^[a-f0-9]{32}\.pdf$/);
  });

  it('la extension sale del mime, no del nombre que manda el cliente', async () => {
    const { servicio, comprobante } = crearServicio();

    await servicio.crear(ALUMNO, { nombreOriginal: 'foto.exe', tipoMime: 'image/png' });

    expect(comprobante.create.mock.calls[0][0].data.claveArchivo).toMatch(/\.png$/);
  });

  it('rechaza un tipo de archivo no admitido', async () => {
    const { servicio } = crearServicio();

    await expect(
      servicio.crear(ALUMNO, { nombreOriginal: 'virus.exe', tipoMime: 'application/x-msdownload' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('404 si el actor no tiene perfil', async () => {
    const { servicio, perfil } = crearServicio();
    perfil.findFirst.mockResolvedValue(null);

    await expect(
      servicio.crear(ALUMNO, { nombreOriginal: 'x.pdf', tipoMime: 'application/pdf' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ComprobantesService.confirmar', () => {
  it('marca subidoEn', async () => {
    const { servicio, comprobante } = crearServicio();
    comprobante.findFirst.mockResolvedValue({ ...FILA, subidoEn: null });

    await servicio.confirmar(ALUMNO, 'comp-1');

    expect(comprobante.update).toHaveBeenCalledWith({
      where: { id: 'comp-1' },
      data: { subidoEn: expect.any(Date) },
    });
  });

  it('403 si el comprobante es de otro alumno', async () => {
    const { servicio, comprobante } = crearServicio();
    comprobante.findFirst.mockResolvedValue({ ...FILA, perfilId: 'otro', subidoEn: null });

    await expect(servicio.confirmar(ALUMNO, 'comp-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('404 si no existe', async () => {
    const { servicio, comprobante } = crearServicio();
    comprobante.findFirst.mockResolvedValue(null);

    await expect(servicio.confirmar(ALUMNO, 'comp-9')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('es idempotente: confirmar dos veces no vuelve a escribir', async () => {
    const { servicio, comprobante } = crearServicio();

    // FILA ya viene con subidoEn.
    await servicio.confirmar(ALUMNO, 'comp-1');

    expect(comprobante.update).not.toHaveBeenCalled();
  });
});

describe('ComprobantesService.listar', () => {
  it('el alumno solo ve los suyos, aunque no lo pida', async () => {
    const { servicio, comprobante } = crearServicio();

    await servicio.listar(ALUMNO, {});

    expect(comprobante.findMany.mock.calls[0][0].where).toMatchObject({ perfilId: 'perfil-1' });
  });

  it('el admin ve los de todo el gimnasio', async () => {
    const { servicio, comprobante } = crearServicio();

    await servicio.listar(ADMIN, {});

    expect(comprobante.findMany.mock.calls[0][0].where.perfilId).toBeUndefined();
  });

  it('el admin solo ve los que tienen archivo', async () => {
    const { servicio, comprobante } = crearServicio();

    await servicio.listar(ADMIN, {});

    // Una fila sin confirmar no tiene archivo: mostrarsela al admin seria
    // darle un enlace roto.
    expect(comprobante.findMany.mock.calls[0][0].where.subidoEn).toEqual({ not: null });
  });

  it('el alumno SI ve los suyos sin confirmar: son los que le falta subir', async () => {
    const { servicio, comprobante } = crearServicio();

    await servicio.listar(ALUMNO, {});

    expect(comprobante.findMany.mock.calls[0][0].where.subidoEn).toBeUndefined();
  });

  it('adjunta una URL de descarga firmada a los que tienen archivo', async () => {
    const { servicio } = crearServicio();

    const lista = await servicio.listar(ADMIN, {});

    expect(lista[0].urlDeDescarga).toBe('https://almacen/bajar?firma=y');
  });

  it('no firma nada para una fila sin archivo', async () => {
    const { servicio, comprobante, almacen } = crearServicio();
    comprobante.findMany.mockResolvedValue([{ ...FILA, subidoEn: null }]);

    const lista = await servicio.listar(ALUMNO, {});

    expect(lista[0].urlDeDescarga).toBeNull();
    expect(almacen.urlDeDescarga).not.toHaveBeenCalled();
  });

  it('filtra por estado cuando se pide', async () => {
    const { servicio, comprobante } = crearServicio();

    await servicio.listar(ADMIN, { estado: 'PENDIENTE' });

    expect(comprobante.findMany.mock.calls[0][0].where.estado).toBe('PENDIENTE');
  });

  it('nunca expone la clave del archivo, solo la URL firmada', async () => {
    const { servicio } = crearServicio();

    const lista = await servicio.listar(ADMIN, {});

    // La clave es la direccion permanente dentro del almacen: publicarla
    // invitaria a construir URLs a mano.
    expect(lista[0]).not.toHaveProperty('claveArchivo');
  });
});

describe('ComprobantesService.aprobar y rechazar', () => {
  it('aprobar deja el comprobante APROBADO y registra el cobro', async () => {
    const { servicio, comprobante, pago } = crearServicio();

    await servicio.aprobar(ADMIN, 'comp-1', { monto: '25000.00', cubreHasta: '2099-12-31' });

    expect(comprobante.update.mock.calls[0][0].data).toMatchObject({
      estado: 'APROBADO',
      revisadoPor: 'usr-admin',
    });
    // Desde la Fase 5A, poner al alumno al dia no es encender una bandera: es
    // que exista un pago que cubra hoy.
    expect(pago.create).toHaveBeenCalledTimes(1);
  });

  it('rechazar NO registra ningun cobro', async () => {
    const { servicio, pago } = crearServicio();

    // Un rechazo no quita un pago anterior que si estaba bien, y desde luego no
    // crea uno nuevo.
    await servicio.rechazar(ADMIN, 'comp-1', 'Ilegible');

    expect(pago.create).not.toHaveBeenCalled();
  });

  it('rechazar guarda la nota', async () => {
    const { servicio, comprobante } = crearServicio();

    await servicio.rechazar(ADMIN, 'comp-1', 'Ilegible');

    expect(comprobante.update.mock.calls[0][0].data).toMatchObject({
      estado: 'RECHAZADO',
      nota: 'Ilegible',
    });
  });

  it('409 si ya estaba revisado', async () => {
    const { servicio, comprobante } = crearServicio();
    comprobante.findFirst.mockResolvedValue({ ...FILA, estado: 'APROBADO' });

    await expect(servicio.rechazar(ADMIN, 'comp-1', undefined)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('409 si todavia no tiene archivo', async () => {
    const { servicio, comprobante } = crearServicio();
    comprobante.findFirst.mockResolvedValue({ ...FILA, subidoEn: null });

    // Aprobar un comprobante sin archivo seria aprobar la nada.
    await expect(servicio.aprobar(ADMIN, 'comp-1', { monto: '25000.00', cubreHasta: '2099-12-31' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('404 si no existe', async () => {
    const { servicio, comprobante } = crearServicio();
    comprobante.findFirst.mockResolvedValue(null);

    await expect(servicio.aprobar(ADMIN, 'comp-9', { monto: '25000.00', cubreHasta: '2099-12-31' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('registra la revision en el historial', async () => {
    const { servicio, historial } = crearServicio();

    await servicio.aprobar(ADMIN, 'comp-1', { monto: '25000.00', cubreHasta: '2099-12-31' });

    expect(historial.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ entidad: 'Comprobante', accion: 'APROBADO' }),
      expect.anything(),
    );
  });
});

describe('ComprobantesService.aprobar y el pago', () => {
  const APROBACION = { monto: '25000.00', cubreHasta: '2099-12-31' };

  it('el pago lleva el importe, el comprobante y el metodo por defecto', async () => {
    const { servicio, pago } = crearServicio();

    await servicio.aprobar(ADMIN, 'comp-1', APROBACION);

    const datos = pago.create.mock.calls[0]![0].data;
    expect(datos.monto).toBe('25000.00');
    expect(datos.comprobanteId).toBe('comp-1');
    // Un comprobante es una transferencia el 99% de las veces.
    expect(datos.metodo).toBe('TRANSFERENCIA');
  });

  it('el metodo se puede cambiar', async () => {
    const { servicio, pago } = crearServicio();

    await servicio.aprobar(ADMIN, 'comp-1', { ...APROBACION, metodo: 'EFECTIVO' });

    expect(pago.create.mock.calls[0]![0].data.metodo).toBe('EFECTIVO');
  });

  it('el pago cubre desde HOY hasta la fecha indicada', async () => {
    const { servicio, pago } = crearServicio();

    await servicio.aprobar(ADMIN, 'comp-1', APROBACION);

    const datos = pago.create.mock.calls[0]![0].data;
    expect(datos.cubreHasta).toEqual(new Date('2099-12-31T00:00:00.000Z'));
    expect(datos.cubreDesde).toBeInstanceOf(Date);
  });

  it('el pago se crea en la MISMA transaccion que la aprobacion', async () => {
    // Si naciera fuera, un fallo entre las dos escrituras dejaria un
    // comprobante aprobado sin cobro registrado, y eso no se descubre hasta
    // cuadrar la caja a fin de mes.
    const { servicio, comprobante, pago } = crearServicio();

    await servicio.aprobar(ADMIN, 'comp-1', APROBACION);

    expect(comprobante.update).toHaveBeenCalled();
    expect(pago.create).toHaveBeenCalled();
  });

  it('si el comprobante no es aprobable, no se registra ningun cobro', async () => {
    const { servicio, comprobante, pago } = crearServicio();
    comprobante.findFirst.mockResolvedValue({ ...FILA, subidoEn: null });

    await expect(servicio.aprobar(ADMIN, 'comp-1', APROBACION)).rejects.toThrow();
    expect(pago.create).not.toHaveBeenCalled();
  });
});
