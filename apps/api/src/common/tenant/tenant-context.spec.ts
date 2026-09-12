import {
  TenantIdInvalidoError,
  getTenantContext,
  runUnscoped,
  runWithTenant,
} from './tenant-context';

describe('tenant-context', () => {
  it('no hay contexto fuera de runWithTenant/runUnscoped', () => {
    expect(getTenantContext()).toBeUndefined();
  });

  it('runWithTenant expone el tenantId dentro del callback', () => {
    const resultado = runWithTenant('tenant-a', () => getTenantContext());

    expect(resultado).toEqual({ kind: 'tenant', tenantId: 'tenant-a' });
  });

  it('runUnscoped marca el contexto como explícitamente sin tenant', () => {
    const resultado = runUnscoped(() => getTenantContext());

    expect(resultado).toEqual({ kind: 'unscoped' });
  });

  it('el contexto no sobrevive al callback', () => {
    runWithTenant('tenant-a', () => getTenantContext());

    expect(getTenantContext()).toBeUndefined();
  });

  it('runUnscoped anidado dentro de runWithTenant gana en su ámbito', () => {
    const visto = runWithTenant('tenant-a', () => ({
      dentro: runUnscoped(() => getTenantContext()),
      despues: getTenantContext(),
    }));

    expect(visto.dentro).toEqual({ kind: 'unscoped' });
    expect(visto.despues).toEqual({ kind: 'tenant', tenantId: 'tenant-a' });
  });

  // NO TOQUES ESTE TEST A LA LIGERA. Una prueba de mutación lo confirmó: si se
  // sustituye el AsyncLocalStorage por una variable de módulo con guardar/restaurar
  // —el error razonable de quien no conoce ALS— los otros cinco tests siguen pasando
  // y solo falla este. Es el único centinela contra una fuga de contexto entre
  // requests concurrentes de gimnasios distintos.
  it('dos flujos asíncronos concurrentes no se pisan el contexto', async () => {
    const flujo = (tenantId: string, esperaMs: number) =>
      runWithTenant(tenantId, async () => {
        await new Promise((r) => setTimeout(r, esperaMs));
        return getTenantContext();
      });

    const [a, b] = await Promise.all([flujo('tenant-a', 20), flujo('tenant-b', 5)]);

    expect(a).toEqual({ kind: 'tenant', tenantId: 'tenant-a' });
    expect(b).toEqual({ kind: 'tenant', tenantId: 'tenant-b' });
  });

  // Fallo de auditoria: un tenantId que no sea una cadena no vacia deja
  // { where: { tenantId: undefined } } tras la extension de Prisma, y Prisma
  // interpreta eso como "sin filtro" -> fuga entre gimnasios. runWithTenant
  // debe rechazarlo en origen, para todo llamador, no solo el middleware.
  describe('runWithTenant rechaza un tenantId invalido', () => {
    it('lanza TenantIdInvalidoError con undefined', () => {
      expect(() =>
        runWithTenant(undefined as unknown as string, () => getTenantContext()),
      ).toThrow(TenantIdInvalidoError);
    });

    it('lanza TenantIdInvalidoError con null', () => {
      expect(() =>
        runWithTenant(null as unknown as string, () => getTenantContext()),
      ).toThrow(TenantIdInvalidoError);
    });

    it('lanza TenantIdInvalidoError con cadena vacia', () => {
      expect(() => runWithTenant('', () => getTenantContext())).toThrow(
        TenantIdInvalidoError,
      );
    });

    it('lanza TenantIdInvalidoError con un numero', () => {
      expect(() =>
        runWithTenant(123 as unknown as string, () => getTenantContext()),
      ).toThrow(TenantIdInvalidoError);
    });

    it('lanza TenantIdInvalidoError con un objeto', () => {
      expect(() =>
        runWithTenant({} as unknown as string, () => getTenantContext()),
      ).toThrow(TenantIdInvalidoError);
    });

    it('no ejecuta el callback cuando el tenantId es invalido', () => {
      const callback = jest.fn();

      expect(() => runWithTenant('', callback)).toThrow(TenantIdInvalidoError);
      expect(callback).not.toHaveBeenCalled();
    });
  });
});
