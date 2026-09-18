import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AutoRegistroDto } from './dto/auto-registro.dto';

const CONFIG_TEST: Record<string, string> = {
  JWT_SECRET: 'access-secret-test',
  JWT_EXPIRES_IN: '15m',
  JWT_REFRESH_SECRET: 'refresh-secret-test',
  JWT_REFRESH_EXPIRES_IN: '7d',
};

const DTO: AutoRegistroDto = {
  tenantSlug: 'gimnasio',
  codigo: 'a'.repeat(32),
  nombreCompleto: 'Ana Perez',
  // En mayusculas a proposito: el servicio tiene que normalizarlo.
  email: 'Ana@Ejemplo.COM',
  password: 'Password123!',
};

const CLAVE = {
  id: 'clave-1',
  tenantId: 'gym-1',
  codigo: 'a'.repeat(32),
  activa: true,
  usosMax: 10,
  usosActuales: 0,
  expiraEn: null as Date | null,
  packId: 'pack-1',
  salas: [{ salaId: 'sala-1' }, { salaId: 'sala-2' }],
};

const USUARIO_CREADO = {
  id: 'usr-nuevo',
  tenantId: 'gym-1',
  nombreCompleto: 'Ana Perez',
  email: 'ana@ejemplo.com',
  rol: 'ALUMNO' as const,
  activo: true,
};

function montar() {
  const claveInvitacion = {
    findFirst: jest.fn().mockResolvedValue(CLAVE),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const usuario = {
    findFirst: jest.fn().mockResolvedValue(null),
    findUnique: jest.fn(),
    count: jest.fn(),
    create: jest.fn().mockResolvedValue(USUARIO_CREADO),
  };
  const perfil = { create: jest.fn().mockResolvedValue({ id: 'perfil-nuevo' }) };
  const usuarioSala = { createMany: jest.fn().mockResolvedValue({ count: 2 }) };
  const tenant = {
    findUnique: jest.fn().mockResolvedValue({ id: 'gym-1', slug: 'gimnasio', activo: true }),
    findFirst: jest.fn(),
    create: jest.fn(),
  };
  const historialAccion = { create: jest.fn().mockResolvedValue({}) };
  const refreshToken = { create: jest.fn().mockResolvedValue({}) };

  const db: Record<string, unknown> = {
    claveInvitacion,
    usuario,
    perfil,
    usuarioSala,
    tenant,
    historialAccion,
    refreshToken,
  };
  db.$transaction = jest.fn((fn: (tx: unknown) => unknown): unknown => fn(db));

  const config = {
    getOrThrow: (clave: string) => {
      const valor = CONFIG_TEST[clave];
      if (valor === undefined) throw new Error(`Falta config de test: ${clave}`);
      return valor;
    },
  } as unknown as ConfigService;

  const servicio = new AuthService({ db } as unknown as PrismaService, new JwtService({}), config);

  return { servicio, db, claveInvitacion, usuario, perfil, usuarioSala, tenant, historialAccion };
}

describe('AuthService.autoRegistro — alta correcta', () => {
  it('crea el usuario como ALUMNO, nunca con el rol que pida el cuerpo', async () => {
    const { servicio, usuario } = montar();

    await servicio.autoRegistro({ ...DTO, rol: 'ADMIN_SALON' } as never);

    expect(usuario.create.mock.calls[0][0].data.rol).toBe('ALUMNO');
  });

  it('normaliza el email a minusculas', async () => {
    const { servicio, usuario } = montar();

    await servicio.autoRegistro(DTO);

    expect(usuario.create.mock.calls[0][0].data.email).toBe('ana@ejemplo.com');
  });

  it('marca el perfil como autoRegistrado y le pone el pack de la clave', async () => {
    const { servicio, perfil } = montar();

    await servicio.autoRegistro(DTO);

    expect(perfil.create.mock.calls[0][0].data).toMatchObject({
      autoRegistrado: true,
      packId: 'pack-1',
      usuarioId: 'usr-nuevo',
    });
  });

  it('le da las salas de la clave: sin ellas no podria reservar nada', async () => {
    const { servicio, usuarioSala } = montar();

    await servicio.autoRegistro(DTO);

    expect(usuarioSala.createMany).toHaveBeenCalledWith({
      data: [
        { tenantId: 'gym-1', perfilId: 'perfil-nuevo', salaId: 'sala-1' },
        { tenantId: 'gym-1', perfilId: 'perfil-nuevo', salaId: 'sala-2' },
      ],
    });
  });

  it('devuelve tokens y el usuario: el alumno queda logueado', async () => {
    const { servicio } = montar();

    const r = await servicio.autoRegistro(DTO);

    expect(r.accessToken).toEqual(expect.any(String));
    expect(r.refreshToken).toEqual(expect.any(String));
    expect(r.usuario).toMatchObject({ id: 'usr-nuevo', rol: 'ALUMNO' });
  });

  it('deja rastro del alta en el historial', async () => {
    const { servicio, historialAccion } = montar();

    await servicio.autoRegistro(DTO);

    expect(historialAccion.create.mock.calls[0][0].data).toMatchObject({
      entidad: 'Usuario',
      accion: 'AUTO_REGISTRADO',
    });
  });
});

describe('AuthService.autoRegistro — concurrencia sobre usosMax', () => {
  it('incrementa los usos con un updateMany CONDICIONAL', async () => {
    const { servicio, claveInvitacion } = montar();

    await servicio.autoRegistro(DTO);

    // El where lleva usosActuales para que dos registros simultaneos no puedan
    // pasar los dos: es el mismo compare-and-swap que protege la rotacion de
    // refresh tokens desde la Fase 0.
    expect(claveInvitacion.updateMany).toHaveBeenCalledWith({
      where: { id: 'clave-1', usosActuales: 0 },
      data: { usosActuales: 1 },
    });
  });

  it('si el CAS no afecta ninguna fila, la clave se agoto en la carrera', async () => {
    const { servicio, claveInvitacion } = montar();
    claveInvitacion.updateMany.mockResolvedValue({ count: 0 });

    await expect(servicio.autoRegistro(DTO)).rejects.toBeInstanceOf(ConflictException);
  });

  it('corre en Serializable: usosMax es un cupo', async () => {
    const { servicio, db } = montar();

    await servicio.autoRegistro(DTO);

    expect(db.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: 'Serializable' }),
    );
  });
});

describe('AuthService.autoRegistro — claves no utilizables', () => {
  it('rechaza un codigo que no existe', async () => {
    const { servicio, claveInvitacion } = montar();
    claveInvitacion.findFirst.mockResolvedValue(null);

    await expect(servicio.autoRegistro(DTO)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rechaza una clave desactivada', async () => {
    const { servicio, claveInvitacion } = montar();
    claveInvitacion.findFirst.mockResolvedValue({ ...CLAVE, activa: false });

    await expect(servicio.autoRegistro(DTO)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rechaza una clave caducada', async () => {
    const { servicio, claveInvitacion } = montar();
    claveInvitacion.findFirst.mockResolvedValue({
      ...CLAVE,
      expiraEn: new Date('2020-01-01T00:00:00.000Z'),
    });

    await expect(servicio.autoRegistro(DTO)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rechaza una clave con los usos agotados', async () => {
    const { servicio, claveInvitacion } = montar();
    claveInvitacion.findFirst.mockResolvedValue({ ...CLAVE, usosMax: 3, usosActuales: 3 });

    await expect(servicio.autoRegistro(DTO)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('una clave sin usosMax es ilimitada', async () => {
    const { servicio, claveInvitacion } = montar();
    claveInvitacion.findFirst.mockResolvedValue({ ...CLAVE, usosMax: null, usosActuales: 9999 });

    await expect(servicio.autoRegistro(DTO)).resolves.toMatchObject({
      accessToken: expect.any(String),
    });
  });

  it('el mensaje es el MISMO para las cuatro formas de clave invalida', async () => {
    const mensajes: string[] = [];

    for (const clave of [
      null,
      { ...CLAVE, activa: false },
      { ...CLAVE, expiraEn: new Date('2020-01-01T00:00:00.000Z') },
      { ...CLAVE, usosMax: 1, usosActuales: 1 },
    ]) {
      const { servicio, claveInvitacion } = montar();
      claveInvitacion.findFirst.mockResolvedValue(clave);

      await servicio.autoRegistro(DTO).catch((e: Error) => mensajes.push(e.message));
    }

    // Un endpoint publico no tiene por que decirle a quien prueba codigos cual
    // de las cuatro acerto.
    expect(new Set(mensajes).size).toBe(1);
    expect(mensajes).toHaveLength(4);
  });
});

describe('AuthService.autoRegistro — tenant y email', () => {
  it('rechaza un tenant inexistente', async () => {
    const { servicio, tenant } = montar();
    tenant.findUnique.mockResolvedValue(null);

    await expect(servicio.autoRegistro(DTO)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rechaza un tenant desactivado', async () => {
    const { servicio, tenant } = montar();
    tenant.findUnique.mockResolvedValue({ id: 'gym-1', slug: 'gimnasio', activo: false });

    await expect(servicio.autoRegistro(DTO)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('409 si el email ya existe en ese gimnasio', async () => {
    const { servicio, usuario } = montar();
    usuario.findFirst.mockResolvedValue({ id: 'usr-existente' });

    await expect(servicio.autoRegistro(DTO)).rejects.toBeInstanceOf(ConflictException);
  });

  it('busca el email ya normalizado, no como vino en el cuerpo', async () => {
    const { servicio, usuario } = montar();

    await servicio.autoRegistro(DTO);

    expect(usuario.findFirst).toHaveBeenCalledWith({ where: { email: 'ana@ejemplo.com' } });
  });
});
