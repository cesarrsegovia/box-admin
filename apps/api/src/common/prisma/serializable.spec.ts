import { ConflictException } from '@nestjs/common';
import { conReintentoSerializable, esConflictoDeSerializacion } from './serializable';

describe('esConflictoDeSerializacion', () => {
  it('reconoce el P2034 de Prisma', () => {
    expect(esConflictoDeSerializacion({ code: 'P2034' })).toBe(true);
  });

  it('reconoce el 40001 crudo de Postgres', () => {
    expect(esConflictoDeSerializacion({ code: '40001' })).toBe(true);
  });

  it('reconoce el TransactionWriteConflict del driver adapter de Prisma 7', () => {
    // REGRESION, y la mas importante de este archivo. Con el adapter `pg` de
    // Prisma 7 un conflicto de serializacion NO llega como P2034: el adapter
    // traduce los SQLSTATE 40001 / 40P01 a { kind: 'TransactionWriteConflict' }
    // y lo envuelve en un DriverAdapterError, cuyo `code` es undefined.
    //
    // Mientras esto no se reconocia, el reintento entero era codigo muerto: no
    // se disparo ni una sola vez. El e2e de 10 reservas simultaneas lo destapo
    // porque una peticion de cada ~20 salia con 500 en vez de 409.
    const error = Object.assign(new Error('TransactionWriteConflict'), {
      name: 'DriverAdapterError',
      cause: { kind: 'TransactionWriteConflict' },
    });

    expect(esConflictoDeSerializacion(error)).toBe(true);
  });

  it('un DriverAdapterError de otra clase no se reintenta', () => {
    const error = Object.assign(new Error('TableDoesNotExist'), {
      name: 'DriverAdapterError',
      cause: { kind: 'TableDoesNotExist' },
    });

    expect(esConflictoDeSerializacion(error)).toBe(false);
  });

  it('no confunde un error de negocio con un conflicto', () => {
    expect(esConflictoDeSerializacion(new Error('turno lleno'))).toBe(false);
    expect(esConflictoDeSerializacion({ code: 'P2002' })).toBe(false);
    expect(esConflictoDeSerializacion(null)).toBe(false);
    expect(esConflictoDeSerializacion(undefined)).toBe(false);
  });
});

describe('conReintentoSerializable', () => {
  it('no reintenta si va bien a la primera', async () => {
    const fn = jest.fn().mockResolvedValue('ok');

    await expect(conReintentoSerializable(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('reintenta ante un conflicto de serializacion y acaba bien', async () => {
    const fn = jest.fn().mockRejectedValueOnce({ code: 'P2034' }).mockResolvedValue('ok');

    await expect(conReintentoSerializable(fn, { esperaBaseMs: 0 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('NO reintenta un error de negocio: un turno lleno sigue lleno', async () => {
    const error = new Error('CUPO_COMPLETO');
    const fn = jest.fn().mockRejectedValue(error);

    await expect(conReintentoSerializable(fn, { esperaBaseMs: 0 })).rejects.toBe(error);
    // Reintentar aqui castigaria al usuario con tres veces la latencia para
    // darle exactamente el mismo 409.
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('al agotar los intentos lanza 409, no el error crudo de Prisma', async () => {
    const fn = jest.fn().mockRejectedValue({ code: 'P2034' });

    // REGRESION. Antes se relanzaba el P2034 tal cual, y como AllExceptionsFilter
    // no traduce codigos de Prisma, el cliente recibia un 500 opaco. Se detecto
    // con el e2e de 10 reservas simultaneas: salian 1 creada, 8 rechazadas y una
    // que no era ni lo uno ni lo otro. Un 409 es la respuesta honesta: la
    // peticion choco con otra y no se aplico.
    await expect(
      conReintentoSerializable(fn, { intentos: 3, esperaBaseMs: 0 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('por defecto reintenta 5 veces, no 3', async () => {
    const fn = jest.fn().mockRejectedValue({ code: '40001' });

    // Con 10 peticiones simultaneas sobre el mismo lugar, 3 intentos se quedaban
    // cortos y la contencion se le notaba al usuario.
    await expect(conReintentoSerializable(fn, { esperaBaseMs: 0 })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(fn).toHaveBeenCalledTimes(5);
  });
});
