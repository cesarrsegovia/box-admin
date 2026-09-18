import { Prisma } from '@prisma/client';
import { TenantIdInvalidoError, runUnscoped, runWithTenant } from './tenant-context';
import {
  CreacionNoPermitidaError,
  MODELOS_CON_TENANT,
  MODELOS_GLOBALES,
  MODELOS_POR_RELACION,
  MissingTenantContextError,
  ModeloNoClasificadoError,
  OperacionNoSoportadaError,
  ReasignacionDeTenantError,
  UnsafeUniqueOperationError,
  aplicarScopeDeTenant,
} from './tenant-scoped.extension';

describe('aplicarScopeDeTenant', () => {
  describe('modelos que se aislan por relacion (RefreshToken)', () => {
    it('exige contexto igual que los modelos con columna tenantId', () => {
      expect(() =>
        aplicarScopeDeTenant('RefreshToken', 'findFirst', { where: { tokenHash: 'abc' } }),
      ).toThrow(MissingTenantContextError);
    });

    it('exige contexto tambien en findMany sin where', () => {
      expect(() => aplicarScopeDeTenant('RefreshToken', 'findMany', {})).toThrow(
        MissingTenantContextError,
      );
    });

    it('inyecta el filtro a traves de la relacion usuario', () => {
      const resultado = runWithTenant('t1', () =>
        aplicarScopeDeTenant('RefreshToken', 'findMany', {}),
      );

      expect(resultado).toEqual({ where: { usuario: { tenantId: 't1' } } });
    });

    it('conserva el where existente al inyectar la relacion', () => {
      const resultado = runWithTenant('t1', () =>
        aplicarScopeDeTenant('RefreshToken', 'findFirst', { where: { tokenHash: 'abc' } }),
      );

      expect(resultado).toEqual({
        where: { tokenHash: 'abc', usuario: { tenantId: 't1' } },
      });
    });

    it('rechaza create porque no se puede garantizar el gimnasio', () => {
      expect(() =>
        runWithTenant('t1', () =>
          aplicarScopeDeTenant('RefreshToken', 'create', {
            data: { usuarioId: 'u1', tokenHash: 'abc' },
          }),
        ),
      ).toThrow(CreacionNoPermitidaError);
    });

    it('rechaza findUnique como el resto de categorias', () => {
      expect(() =>
        runWithTenant('t1', () =>
          aplicarScopeDeTenant('RefreshToken', 'findUnique', { where: { id: 'r1' } }),
        ),
      ).toThrow(UnsafeUniqueOperationError);
    });

    it('deja la query intacta en contexto unscoped', () => {
      const args = { where: { tokenHash: 'abc' } };

      expect(runUnscoped(() => aplicarScopeDeTenant('RefreshToken', 'findFirst', args))).toEqual(
        args,
      );
    });
  });

  describe('modelos globales (Tenant)', () => {
    it('exige contexto', () => {
      expect(() =>
        aplicarScopeDeTenant('Tenant', 'findFirst', { where: { slug: 'gimnasio-a' } }),
      ).toThrow(MissingTenantContextError);
    });

    it('restringe la consulta al propio gimnasio', () => {
      const resultado = runWithTenant('t1', () =>
        aplicarScopeDeTenant('Tenant', 'findMany', { include: { usuarios: true } }),
      );

      expect(resultado).toEqual({ include: { usuarios: true }, where: { id: 't1' } });
    });

    it('conserva el where existente y fuerza el id del contexto', () => {
      const resultado = runWithTenant('t1', () =>
        aplicarScopeDeTenant('Tenant', 'findFirst', { where: { slug: 'gimnasio-b', id: 't2' } }),
      );

      expect(resultado).toEqual({ where: { slug: 'gimnasio-b', id: 't1' } });
    });

    it('rechaza create: crear un gimnasio exige runUnscoped()', () => {
      expect(() =>
        runWithTenant('t1', () =>
          aplicarScopeDeTenant('Tenant', 'create', { data: { nombre: 'B', slug: 'b' } }),
        ),
      ).toThrow(CreacionNoPermitidaError);
    });

    it('rechaza findUnique', () => {
      expect(() =>
        runWithTenant('t1', () =>
          aplicarScopeDeTenant('Tenant', 'findUnique', { where: { slug: 'gimnasio-b' } }),
        ),
      ).toThrow(UnsafeUniqueOperationError);
    });

    it('deja la query intacta en contexto unscoped', () => {
      const args = { where: { slug: 'gimnasio-a' } };

      expect(runUnscoped(() => aplicarScopeDeTenant('Tenant', 'findFirst', args))).toEqual(args);
    });
  });

  describe('sin contexto', () => {
    it('lanza MissingTenantContextError en una lectura', () => {
      expect(() => aplicarScopeDeTenant('Usuario', 'findMany', {})).toThrow(
        MissingTenantContextError,
      );
    });

    it('lanza MissingTenantContextError en una escritura', () => {
      expect(() =>
        aplicarScopeDeTenant('Usuario', 'create', { data: { email: 'a@b.c' } }),
      ).toThrow(MissingTenantContextError);
    });
  });

  describe('en contexto unscoped', () => {
    it('deja la query intacta', () => {
      const args = { where: { email: 'a@b.c' } };

      expect(runUnscoped(() => aplicarScopeDeTenant('Usuario', 'findFirst', args))).toEqual(
        args,
      );
    });

    it('permite findUnique con el índice compuesto', () => {
      const args = { where: { tenantId_email: { tenantId: 't1', email: 'a@b.c' } } };

      expect(
        runUnscoped(() => aplicarScopeDeTenant('Usuario', 'findUnique', args)),
      ).toEqual(args);
    });

    it('permite reasignar el tenantId (es la via explicita para hacerlo)', () => {
      const args = { where: { id: 'u1' }, data: { tenantId: 't2' } };

      expect(runUnscoped(() => aplicarScopeDeTenant('Usuario', 'update', args))).toEqual(args);
    });
  });

  describe('en contexto de tenant', () => {
    it('inyecta el filtro en una query sin where', () => {
      const resultado = runWithTenant('t1', () =>
        aplicarScopeDeTenant('Usuario', 'findMany', {}),
      );

      expect(resultado).toEqual({ where: { tenantId: 't1' } });
    });

    it('conserva el where existente y añade el tenant', () => {
      const resultado = runWithTenant('t1', () =>
        aplicarScopeDeTenant('Usuario', 'findFirst', { where: { email: 'a@b.c' } }),
      );

      expect(resultado).toEqual({ where: { email: 'a@b.c', tenantId: 't1' } });
    });

    it('ignora un tenantId pasado a mano y usa siempre el del contexto', () => {
      const resultado = runWithTenant('t1', () =>
        aplicarScopeDeTenant('Usuario', 'findMany', { where: { tenantId: 't2' } }),
      );

      expect(resultado).toEqual({ where: { tenantId: 't1' } });
    });

    it('rellena el tenantId en un create', () => {
      const resultado = runWithTenant('t1', () =>
        aplicarScopeDeTenant('Usuario', 'create', { data: { email: 'a@b.c' } }),
      );

      expect(resultado).toEqual({ data: { email: 'a@b.c', tenantId: 't1' } });
    });

    it('sobrescribe un tenantId ajeno colado en el data de un create', () => {
      const resultado = runWithTenant('t1', () =>
        aplicarScopeDeTenant('Usuario', 'create', { data: { email: 'a@b.c', tenantId: 't2' } }),
      );

      expect(resultado).toEqual({ data: { email: 'a@b.c', tenantId: 't1' } });
    });

    it('rellena el tenantId en cada fila de un createMany', () => {
      const resultado = runWithTenant('t1', () =>
        aplicarScopeDeTenant('Usuario', 'createMany', {
          data: [{ email: 'a@b.c' }, { email: 'd@e.f' }],
        }),
      );

      expect(resultado).toEqual({
        data: [
          { email: 'a@b.c', tenantId: 't1' },
          { email: 'd@e.f', tenantId: 't1' },
        ],
      });
    });

    it('sobrescribe el tenantId ajeno de cada fila de un createMany', () => {
      const resultado = runWithTenant('t1', () =>
        aplicarScopeDeTenant('Usuario', 'createMany', {
          data: [
            { email: 'a@b.c', tenantId: 't2' },
            { email: 'd@e.f', tenantId: 't3' },
          ],
        }),
      );

      expect(resultado).toEqual({
        data: [
          { email: 'a@b.c', tenantId: 't1' },
          { email: 'd@e.f', tenantId: 't1' },
        ],
      });
    });

    it('rellena el tenantId en createManyAndReturn', () => {
      const resultado = runWithTenant('t1', () =>
        aplicarScopeDeTenant('Usuario', 'createManyAndReturn', {
          data: [{ email: 'a@b.c', tenantId: 't2' }],
        }),
      );

      expect(resultado).toEqual({ data: [{ email: 'a@b.c', tenantId: 't1' }] });
    });

    it('filtra tambien deleteMany y count', () => {
      expect(runWithTenant('t1', () => aplicarScopeDeTenant('Usuario', 'deleteMany', {}))).toEqual(
        { where: { tenantId: 't1' } },
      );
      expect(runWithTenant('t1', () => aplicarScopeDeTenant('Usuario', 'count', {}))).toEqual({
        where: { tenantId: 't1' },
      });
    });

    it('aplica el scope a HistorialAccion', () => {
      const resultado = runWithTenant('t1', () =>
        aplicarScopeDeTenant('HistorialAccion', 'findMany', {}),
      );

      expect(resultado).toEqual({ where: { tenantId: 't1' } });
    });

    it('rechaza findUnique porque no se le puede inyectar el filtro', () => {
      expect(() =>
        runWithTenant('t1', () =>
          aplicarScopeDeTenant('Usuario', 'findUnique', { where: { id: 'u1' } }),
        ),
      ).toThrow(UnsafeUniqueOperationError);
    });

    it('rechaza findUniqueOrThrow por la misma razon', () => {
      expect(() =>
        runWithTenant('t1', () =>
          aplicarScopeDeTenant('Usuario', 'findUniqueOrThrow', { where: { id: 'u1' } }),
        ),
      ).toThrow(UnsafeUniqueOperationError);
    });

    it('rechaza upsert por la misma razon', () => {
      expect(() =>
        runWithTenant('t1', () =>
          aplicarScopeDeTenant('Usuario', 'upsert', {
            where: { id: 'u1' },
            create: {},
            update: {},
          }),
        ),
      ).toThrow(UnsafeUniqueOperationError);
    });
  });

  describe('cada operacion con where no unico recibe el filtro', () => {
    const operaciones = [
      'findFirst',
      'findFirstOrThrow',
      'findMany',
      'update',
      'updateMany',
      'updateManyAndReturn',
      'delete',
      'deleteMany',
      'count',
      'aggregate',
      'groupBy',
    ];

    it.each(operaciones)('%s sobre Usuario lleva tenantId en el where', (operacion) => {
      const resultado = runWithTenant('t1', () =>
        aplicarScopeDeTenant('Usuario', operacion, { where: { id: 'u1' } }),
      );

      expect(resultado).toEqual({ where: { id: 'u1', tenantId: 't1' } });
    });

    it.each(operaciones)('%s sobre RefreshToken pasa por la relacion', (operacion) => {
      const resultado = runWithTenant('t1', () =>
        aplicarScopeDeTenant('RefreshToken', operacion, { where: { id: 'r1' } }),
      );

      expect(resultado).toEqual({ where: { id: 'r1', usuario: { tenantId: 't1' } } });
    });

    it.each(operaciones)('%s sobre Tenant queda restringido al propio id', (operacion) => {
      const resultado = runWithTenant('t1', () =>
        aplicarScopeDeTenant('Tenant', operacion, {}),
      );

      expect(resultado).toEqual({ where: { id: 't1' } });
    });
  });

  describe('reasignacion de tenant en actualizaciones', () => {
    const operaciones = ['update', 'updateMany', 'updateManyAndReturn'];

    it.each(operaciones)('%s con data.tenantId lanza ReasignacionDeTenantError', (operacion) => {
      expect(() =>
        runWithTenant('t1', () =>
          aplicarScopeDeTenant('Usuario', operacion, {
            where: { id: 'u1' },
            data: { tenantId: 't2' },
          }),
        ),
      ).toThrow(ReasignacionDeTenantError);
    });

    it.each(operaciones)('%s con data.tenant.connect tambien lanza', (operacion) => {
      expect(() =>
        runWithTenant('t1', () =>
          aplicarScopeDeTenant('Usuario', operacion, {
            where: { id: 'u1' },
            data: { tenant: { connect: { id: 't2' } } },
          }),
        ),
      ).toThrow(ReasignacionDeTenantError);
    });

    it('detecta la reasignacion aunque data sea un array', () => {
      expect(() =>
        runWithTenant('t1', () =>
          aplicarScopeDeTenant('Usuario', 'updateMany', {
            where: {},
            data: [{ activo: false }, { tenantId: 't2' }],
          }),
        ),
      ).toThrow(ReasignacionDeTenantError);
    });

    it('detecta la reasignacion en modelos por relacion', () => {
      expect(() =>
        runWithTenant('t1', () =>
          aplicarScopeDeTenant('RefreshToken', 'update', {
            where: { id: 'r1' },
            data: { tenant: { connect: { id: 't2' } } },
          }),
        ),
      ).toThrow(ReasignacionDeTenantError);
    });

    it('detecta la reasignacion en modelos globales', () => {
      expect(() =>
        runWithTenant('t1', () =>
          aplicarScopeDeTenant('Tenant', 'update', {
            where: { id: 't1' },
            data: { tenantId: 't2' },
          }),
        ),
      ).toThrow(ReasignacionDeTenantError);
    });

    it('no molesta a un update legitimo', () => {
      const resultado = runWithTenant('t1', () =>
        aplicarScopeDeTenant('Usuario', 'update', {
          where: { id: 'u1' },
          data: { nombreCompleto: 'Nuevo' },
        }),
      );

      expect(resultado).toEqual({
        where: { id: 'u1', tenantId: 't1' },
        data: { nombreCompleto: 'Nuevo' },
      });
    });
  });

  describe('fail-closed', () => {
    it('lanza OperacionNoSoportadaError ante una operacion desconocida', () => {
      expect(() =>
        runWithTenant('t1', () => aplicarScopeDeTenant('Usuario', 'operacionRara', {})),
      ).toThrow(OperacionNoSoportadaError);
    });

    it('lanza OperacionNoSoportadaError tambien en modelos por relacion y globales', () => {
      expect(() =>
        runWithTenant('t1', () => aplicarScopeDeTenant('RefreshToken', 'operacionRara', {})),
      ).toThrow(OperacionNoSoportadaError);
      expect(() =>
        runWithTenant('t1', () => aplicarScopeDeTenant('Tenant', 'operacionRara', {})),
      ).toThrow(OperacionNoSoportadaError);
    });

    it('lanza ModeloNoClasificadoError ante un modelo desconocido', () => {
      expect(() =>
        runWithTenant('t1', () => aplicarScopeDeTenant('Factura', 'findMany', {})),
      ).toThrow(ModeloNoClasificadoError);
    });

    it('el modelo sin clasificar se detecta incluso sin contexto', () => {
      expect(() => aplicarScopeDeTenant('Factura', 'findMany', {})).toThrow(
        ModeloNoClasificadoError,
      );
    });

    it('el modelo sin clasificar se detecta incluso en unscoped', () => {
      expect(() =>
        runUnscoped(() => aplicarScopeDeTenant('Factura', 'findMany', {})),
      ).toThrow(ModeloNoClasificadoError);
    });
  });

  describe('coherencia con el esquema (Prisma.dmmf)', () => {
    const modelosDelEsquema = Prisma.dmmf.datamodel.models;

    it('todo modelo del esquema esta en exactamente una categoria', () => {
      const sinClasificar: string[] = [];
      const duplicados: string[] = [];

      for (const modelo of modelosDelEsquema) {
        const categorias = [
          (MODELOS_CON_TENANT as readonly string[]).includes(modelo.name),
          Object.prototype.hasOwnProperty.call(MODELOS_POR_RELACION, modelo.name),
          (MODELOS_GLOBALES as readonly string[]).includes(modelo.name),
        ].filter(Boolean).length;

        if (categorias === 0) sinClasificar.push(modelo.name);
        if (categorias > 1) duplicados.push(modelo.name);
      }

      expect({ sinClasificar, duplicados }).toEqual({ sinClasificar: [], duplicados: [] });
    });

    it('ninguna categoria nombra un modelo que no existe en el esquema', () => {
      const nombresDelEsquema = modelosDelEsquema.map((m) => m.name);
      const declarados = [
        ...MODELOS_CON_TENANT,
        ...Object.keys(MODELOS_POR_RELACION),
        ...MODELOS_GLOBALES,
      ];

      expect(declarados.filter((n) => !nombresDelEsquema.includes(n))).toEqual([]);
    });

    it('todo modelo con campo tenantId esta en MODELOS_CON_TENANT', () => {
      const conColumnaTenantId = modelosDelEsquema
        .filter((m) => m.fields.some((f) => f.name === 'tenantId' && f.kind === 'scalar'))
        .map((m) => m.name);

      expect([...conColumnaTenantId].sort()).toEqual([...MODELOS_CON_TENANT].sort());
    });

    it('el campo de relacion declarado existe y apunta a un modelo con tenantId', () => {
      for (const [modelo, campo] of Object.entries(MODELOS_POR_RELACION)) {
        const definicion = modelosDelEsquema.find((m) => m.name === modelo);
        expect(definicion).toBeDefined();

        const relacion = definicion!.fields.find((f) => f.name === campo);
        expect(relacion).toBeDefined();
        expect(relacion!.kind).toBe('object');
        expect(MODELOS_CON_TENANT as readonly string[]).toContain(relacion!.type);
      }
    });
  });

  // Regresion del fallo de auditoria: un tenantId vacio/undefined llegaba a
  // aplicarScopeDeTenant y producia { where: { tenantId: undefined } }, que
  // Prisma trata como "sin filtro" (fuga entre gimnasios). La capa que cierra
  // esto es runWithTenant (tenant-context.ts), no esta funcion: aqui solo se
  // comprueba que ya no es posible llegar a aplicarScopeDeTenant con un
  // contexto envenenado, porque runWithTenant lanza antes de invocar el
  // callback.
  describe('regresion: tenantId vacio no debe llegar a aplicarScopeDeTenant', () => {
    it('runWithTenant("", ...) lanza TenantIdInvalidoError antes de ejecutar el callback', () => {
      const callback = jest.fn(() => aplicarScopeDeTenant('Usuario', 'findMany', {}));

      expect(() => runWithTenant('', callback)).toThrow(TenantIdInvalidoError);
      expect(callback).not.toHaveBeenCalled();
    });
  });
});

describe('centinela de clasificacion', () => {
  it('todo modelo del schema esta clasificado en la extension', () => {
    const clasificados = new Set<string>([
      ...MODELOS_CON_TENANT,
      ...Object.keys(MODELOS_POR_RELACION),
      ...MODELOS_GLOBALES,
    ]);

    const sinClasificar = Prisma.dmmf.datamodel.models
      .map((modelo) => modelo.name)
      .filter((nombre) => !clasificados.has(nombre));

    // Si esto falla, alguien anadio un modelo al schema y no dijo como se
    // aisla. La extension lo bloquearia en tiempo de ejecucion con
    // ModeloNoClasificadoError, pero solo cuando alguien lo usara: este test
    // lo detecta al compilar la suite, que es cuando duele barato.
    expect(sinClasificar).toEqual([]);
  });
});

describe('modelos de la Fase 3A', () => {
  const MODELOS_NUEVOS = [
    'ClaveInvitacion',
    'ClaveInvitacionSala',
    'ListaEspera',
    'Comprobante',
  ] as const;

  it.each(MODELOS_NUEVOS)('a %s se le inyecta el tenantId en el where', (modelo) => {
    const args = runWithTenant('gym-1', () =>
      aplicarScopeDeTenant(modelo, 'findMany', { where: { activa: true } }),
    );

    expect(args).toEqual({ where: { activa: true, tenantId: 'gym-1' } });
  });

  it.each(MODELOS_NUEVOS)('a %s se le rellena el tenantId al crear', (modelo) => {
    const args = runWithTenant('gym-1', () =>
      aplicarScopeDeTenant(modelo, 'create', { data: { nombre: 'x' } }),
    );

    expect(args).toEqual({ data: { nombre: 'x', tenantId: 'gym-1' } });
  });
});
