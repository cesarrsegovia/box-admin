import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PagosService } from './pagos.service';

const ACTOR = { sub: 'admin-1', tenantId: 't1', rol: 'ADMIN_OPERATIVO' } as never;

const dia = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

function baseDelAlta(parcial: Record<string, unknown> = {}) {
  return {
    perfilId: 'p1',
    monto: '25000.00',
    metodo: 'EFECTIVO',
    cubreDesde: '2026-09-01',
    cubreHasta: '2026-09-30',
    ...parcial,
  } as never;
}

function prismaFalso(
  estado: {
    perfil?: { id: string } | null;
    comprobante?: Record<string, unknown> | null;
    pago?: Record<string, unknown> | null;
  } = {},
) {
  const db = {
    perfil: {
      findFirst: jest
        .fn()
        .mockResolvedValue(estado.perfil === undefined ? { id: 'p1' } : estado.perfil),
    },
    comprobante: {
      findFirst: jest.fn().mockResolvedValue(estado.comprobante ?? null),
    },
    pago: {
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: 'pago-1',
          anuladoEn: null,
          anuladoPor: null,
          nota: null,
          comprobanteId: null,
          esSena: false,
          createdAt: dia('2026-09-15'),
          ...data,
          // El Decimal de Prisma expone toFixed; el doble imita solo eso.
          monto: { toFixed: () => String(data.monto) },
        }),
      ),
      findFirst: jest.fn().mockResolvedValue(
        estado.pago === undefined
          ? null
          : {
              id: 'pago-1',
              tenantId: 't1',
              perfilId: 'p1',
              monto: { toFixed: () => '25000.00' },
              metodo: 'EFECTIVO',
              esSena: false,
              cubreDesde: dia('2026-09-01'),
              cubreHasta: dia('2026-09-30'),
              comprobanteId: null,
              registradoPor: 'admin-1',
              nota: null,
              anuladoEn: null,
              anuladoPor: null,
              createdAt: dia('2026-09-15'),
              ...estado.pago,
            },
      ),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(db)),
  };

  return db;
}

const historialFalso = { registrar: jest.fn().mockResolvedValue(undefined) } as never;

describe('PagosService.crear', () => {
  it('404 si el perfil no existe en este gimnasio', async () => {
    const db = prismaFalso({ perfil: null });
    const servicio = new PagosService({ db } as never, historialFalso);

    await expect(servicio.crear(ACTOR, baseDelAlta())).rejects.toThrow(NotFoundException);
  });

  it('400 si el periodo esta invertido', async () => {
    const db = prismaFalso();
    const servicio = new PagosService({ db } as never, historialFalso);

    await expect(
      servicio.crear(ACTOR, baseDelAlta({ cubreDesde: '2026-09-30', cubreHasta: '2026-09-01' })),
    ).rejects.toThrow(BadRequestException);
  });

  it('un periodo de un solo dia es valido', async () => {
    const db = prismaFalso();
    const servicio = new PagosService({ db } as never, historialFalso);

    await expect(
      servicio.crear(ACTOR, baseDelAlta({ cubreDesde: '2026-09-01', cubreHasta: '2026-09-01' })),
    ).resolves.toMatchObject({ id: 'pago-1' });
  });

  it('guarda quien lo registro, sin confiar en el cuerpo', async () => {
    const db = prismaFalso();
    const servicio = new PagosService({ db } as never, historialFalso);

    await servicio.crear(ACTOR, baseDelAlta());

    expect(db.pago.create.mock.calls[0]![0].data.registradoPor).toBe('admin-1');
  });

  it('404 si el comprobante no existe', async () => {
    const db = prismaFalso({ comprobante: null });
    const servicio = new PagosService({ db } as never, historialFalso);

    await expect(
      servicio.crear(ACTOR, baseDelAlta({ comprobanteId: 'c-fantasma' })),
    ).rejects.toThrow(NotFoundException);
  });

  it('400 si el comprobante es de OTRO perfil', async () => {
    // Enlazar el pago de un alumno al comprobante de otro mezclaria la
    // contabilidad de dos personas sin que nadie lo notara.
    const db = prismaFalso({ comprobante: { id: 'c1', perfilId: 'otro', estado: 'APROBADO' } });
    const servicio = new PagosService({ db } as never, historialFalso);

    await expect(servicio.crear(ACTOR, baseDelAlta({ comprobanteId: 'c1' }))).rejects.toThrow(
      /otro alumno/i,
    );
  });

  it('409 si el comprobante no esta aprobado', async () => {
    const db = prismaFalso({ comprobante: { id: 'c1', perfilId: 'p1', estado: 'PENDIENTE' } });
    const servicio = new PagosService({ db } as never, historialFalso);

    await expect(servicio.crear(ACTOR, baseDelAlta({ comprobanteId: 'c1' }))).rejects.toThrow(
      ConflictException,
    );
  });
});

describe('PagosService.anular', () => {
  it('marca la fila en vez de borrarla', async () => {
    const db = prismaFalso({ pago: {} });
    const servicio = new PagosService({ db } as never, historialFalso);

    await servicio.anular(ACTOR, 'pago-1');

    const datos = db.pago.update.mock.calls[0]![0].data;
    expect(datos.anuladoEn).toBeInstanceOf(Date);
    expect(datos.anuladoPor).toBe('admin-1');
  });

  it('409 si ya estaba anulado', async () => {
    const db = prismaFalso({ pago: { anuladoEn: dia('2026-09-10') } });
    const servicio = new PagosService({ db } as never, historialFalso);

    await expect(servicio.anular(ACTOR, 'pago-1')).rejects.toThrow(ConflictException);
  });

  it('404 si no existe', async () => {
    const db = prismaFalso();
    const servicio = new PagosService({ db } as never, historialFalso);

    await expect(servicio.anular(ACTOR, 'fantasma')).rejects.toThrow(NotFoundException);
  });
});

describe('PagosService.fijarEstado', () => {
  it('alDia true crea una cortesia de importe cero', async () => {
    const db = prismaFalso();
    const servicio = new PagosService({ db } as never, historialFalso);

    await servicio.fijarEstado(ACTOR, 'p1', { alDia: true, cubreHasta: '2026-09-30' });

    const datos = db.pago.create.mock.calls[0]![0].data;
    expect(datos.metodo).toBe('CORTESIA');
    expect(datos.monto).toBe('0.00');
  });

  it('alDia false anula SOLO las cortesias vigentes', async () => {
    // Un pago real no se toca desde aqui: para eso esta anular, que pide otro
    // rol. Nadie puede borrar un cobro desde el endpoint de estado.
    const db = prismaFalso();
    const servicio = new PagosService({ db } as never, historialFalso);

    await servicio.fijarEstado(ACTOR, 'p1', { alDia: false });

    const donde = db.pago.updateMany.mock.calls[0]![0].where;
    expect(donde.metodo).toBe('CORTESIA');
    expect(donde.anuladoEn).toBeNull();
    expect(db.pago.create).not.toHaveBeenCalled();
  });

  it('alDia true sin cubreHasta es 400', async () => {
    const db = prismaFalso();
    const servicio = new PagosService({ db } as never, historialFalso);

    await expect(servicio.fijarEstado(ACTOR, 'p1', { alDia: true })).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('PagosService.perfilesAlDia', () => {
  it('sin perfiles no consulta nada', async () => {
    const db = prismaFalso();
    const servicio = new PagosService({ db } as never, historialFalso);

    const alDia = await servicio.perfilesAlDia(db as never, []);

    expect(alDia.size).toBe(0);
    expect(db.pago.findMany).not.toHaveBeenCalled();
  });

  it('resuelve N perfiles con UNA consulta', async () => {
    const db = prismaFalso();
    db.pago.findMany.mockResolvedValue([
      {
        perfilId: 'p1',
        esSena: false,
        cubreDesde: dia('2026-09-01'),
        cubreHasta: dia('2099-12-31'),
        anuladoEn: null,
      },
      {
        perfilId: 'p2',
        esSena: true,
        cubreDesde: dia('2026-09-01'),
        cubreHasta: dia('2099-12-31'),
        anuladoEn: null,
      },
    ]);
    const servicio = new PagosService({ db } as never, historialFalso);

    const alDia = await servicio.perfilesAlDia(db as never, ['p1', 'p2', 'p3']);

    expect(db.pago.findMany).toHaveBeenCalledTimes(1);
    // p2 tiene pago vigente pero es una sena, y p3 no tiene ninguno.
    expect([...alDia]).toEqual(['p1']);
  });
});
