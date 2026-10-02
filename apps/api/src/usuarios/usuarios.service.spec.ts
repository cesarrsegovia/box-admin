import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { JwtPayload } from '@boxadmin/shared';
import { UsuariosService } from './usuarios.service';
import type { HistorialService } from '../common/historial/historial.service';
import type { PrismaService } from '../prisma/prisma.service';

const ADMIN: JwtPayload = { sub: 'usr-admin', tenantId: 'gym-1', rol: 'ADMIN_SALON' };

const SALA = {
  id: 'sala-1',
  tenantId: 'gym-1',
  nombre: 'Sala A',
  activa: true,
  visibleAlumnos: true,
  soloCuposLiberados: false,
  exclusiva: false,
  cupoBase: null,
  minMinutosCancelar: null,
  minMinutosAnotarse: null,
  listaEsperaHabilitada: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const USUARIO = {
  id: 'usr-1',
  tenantId: 'gym-1',
  nombreCompleto: 'Ana Perez',
  email: 'ana@gym.com',
  passwordHash: 'hash',
  rol: 'ALUMNO' as const,
  activo: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const PERFIL = {
  id: 'perf-1',
  tenantId: 'gym-1',
  usuarioId: 'usr-1',
  telefono: null,
  fichaMedica: null,
  packId: null,
  clasesExtra: 0,
  cancelacionesUsadas: 0,
  vigenciaDesde: null,
  vigenciaHasta: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

/**
 * Forma anidada que devuelve la consulta de listado y detalle: el Usuario con
 * su Perfil, y dentro del Perfil el pack y las salas a traves de la tabla
 * union. Es lo que `aplanar()` tiene que saber deshacer.
 */
const CON_RELACIONES = {
  ...USUARIO,
  perfil: { ...PERFIL, pack: null, salas: [{ sala: SALA }] },
};

function crearServicio() {
  const usuario = {
    findFirst: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue(USUARIO),
    update: jest.fn().mockResolvedValue(USUARIO),
    findMany: jest.fn().mockResolvedValue([USUARIO]),
  };
  const perfil = {
    create: jest.fn().mockResolvedValue(PERFIL),
    findFirst: jest.fn().mockResolvedValue(PERFIL),
    findMany: jest.fn().mockResolvedValue([PERFIL]),
    update: jest.fn().mockResolvedValue(PERFIL),
  };
  const sala = { findMany: jest.fn().mockResolvedValue([SALA]) };
  const usuarioSala = {
    createMany: jest.fn().mockResolvedValue({ count: 1 }),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    findMany: jest.fn().mockResolvedValue([{ perfilId: 'perf-1', salaId: 'sala-1' }]),
  };
  const pack = { findFirst: jest.fn().mockResolvedValue(null) };

  // El listado y el detalle piden la forma anidada; la busqueda de email del
  // alta pide la plana y espera null. Se distinguen por el `include`.
  usuario.findMany.mockResolvedValue([CON_RELACIONES]);
  const usuarioConRelaciones = jest.fn().mockResolvedValue(CON_RELACIONES);
  usuario.findFirst.mockImplementation((args: { include?: unknown }) =>
    args?.include ? usuarioConRelaciones() : null,
  );

  const db = {
    usuario,
    perfil,
    sala,
    usuarioSala,
    pack,
    $transaction: jest.fn((fn: (tx: unknown) => unknown): unknown => fn(db)),
  };
  const prisma = { db } as unknown as PrismaService;
  const historial = { registrar: jest.fn().mockResolvedValue(undefined) };
  // Doble del servicio de pagos. Devuelve "nadie al dia" por defecto: este spec
  // prueba el alta y la gestion de usuarios, no el cobro.
  const pagos = {
    perfilesAlDia: jest.fn().mockResolvedValue(new Set<string>()),
    perfilAlDia: jest.fn().mockResolvedValue(false),
    fijarEstado: jest.fn().mockResolvedValue(undefined),
  };
  // El cache de reportes. Cambiarle el pack a un alumno lo mueve de grupo en la
  // composicion y le cambia el pendiente estimado; cambiarle el nombre cambia
  // como lo identifican los tres reportes nuevos.
  const cache = { invalidar: jest.fn().mockResolvedValue(undefined) };

  return {
    servicio: new UsuariosService(
      prisma,
      historial as unknown as HistorialService,
      pagos as never,
      cache as never,
    ),
    pagos,
    usuario,
    perfil,
    sala,
    usuarioSala,
    pack,
    historial,
    cache,
  };
}

/**
 * LA INVALIDACION DE LA TASK 7/8 DE LA FASE 6A.
 *
 * `actualizar` es la unica escritura de este servicio que mueve un reporte, y lo
 * mueve por tres caminos a la vez: el `packId` cambia de grupo al alumno en la
 * composicion y le cambia el `pendienteEstimado` sin que entre ni salga un peso,
 * el `nombreCompleto` es la columna con la que los tres reportes nuevos lo
 * identifican y por la que ordenan sus listas, y las vigencias entran en quien
 * esta al dia.
 */
describe('UsuariosService invalida el cache DESPUES del commit', () => {
  it('actualizar invalida el cache del gimnasio del actor', async () => {
    const { servicio, cache, pack } = crearServicio();
    pack.findFirst.mockResolvedValue({ id: 'pack-12', tenantId: 'gym-1' });

    await servicio.actualizar(ADMIN, 'usr-9', { packId: 'pack-12' });

    expect(cache.invalidar).toHaveBeenCalledWith('gym-1');
  });

  it('invalida tambien cuando el cambio no es el pack', async () => {
    // Un `if (dto.packId)` dejaria el panel mostrando el nombre viejo despues de
    // corregir un apellido mal escrito. El contador de version invalida de mas a
    // proposito: el peor caso es un recalculo de cinco minutos.
    const { servicio, cache } = crearServicio();

    await servicio.actualizar(ADMIN, 'usr-9', { nombreCompleto: 'Ana Perez' });

    expect(cache.invalidar).toHaveBeenCalledWith('gym-1');
  });

  it('nada se invalida mientras la transaccion sigue abierta', async () => {
    const { servicio, cache, perfil, usuario } = crearServicio();

    let invalidadoDentro = false;
    const db = { usuario, perfil };
    (
      servicio as unknown as { prisma: { db: { $transaction: jest.Mock } } }
    ).prisma.db.$transaction = jest.fn(async (fn: (tx: unknown) => unknown) => {
      const salida = await fn(db);
      invalidadoDentro = cache.invalidar.mock.calls.length > 0;
      return salida;
    });

    await servicio.actualizar(ADMIN, 'usr-9', { nombreCompleto: 'Ana Perez' });

    // Un INCR hecho dentro de una transaccion que despues se desanda no se
    // desanda con ella: invalidaria un cache que nadie cambio.
    expect(invalidadoDentro).toBe(false);
    expect(cache.invalidar).toHaveBeenCalledTimes(1);
  });

  it('crearAlumno invalida: el alta suma al total Y entra en los morosos', async () => {
    // EL HUECO EXACTO QUE LOS OTROS CUATRO `invalidar` VINIERON A TAPAR. Un
    // alumno nuevo suma un perfil al total de la composicion y al reparto por
    // pack, y ademas entra como alumno con pack que todavia no esta al dia: sale
    // en `/stats/pagos-pendientes` y en el `pendienteEstimado` de la caja. Es la
    // llamada de soporte del cache con el verbo cambiado: "di de alta al alumno
    // y no aparece en el panel".
    const { servicio, cache } = crearServicio();

    await servicio.crearAlumno(ADMIN, {
      nombreCompleto: 'Nueva Alumna',
      email: 'nueva@gym.test',
      salaIds: ['sala-1'],
    });

    expect(cache.invalidar).toHaveBeenCalledWith('gym-1');
  });

  it('crearProfesor tambien invalida, sin condicionarlo al rol', async () => {
    // Hoy no mueve nada —las horas de una profesora salen de sus horarios, que
    // todavia no tiene— pero el contador invalida de mas a proposito, y un `if`
    // por rol es un `if` mas por el que colarse. Ver `CacheDeStats`.
    const { servicio, cache } = crearServicio();

    await servicio.crearProfesor(ADMIN, {
      nombreCompleto: 'Nueva Profe',
      email: 'profe@gym.test',
      salaIds: ['sala-1'],
    });

    expect(cache.invalidar).toHaveBeenCalledWith('gym-1');
  });

  it('darDeBaja invalida: una baja saca al alumno de la composicion', async () => {
    // `/stats/composicion-alumnos` cuenta los perfiles ACTIVOS, asi que una baja
    // le cambia el total y el reparto por pack sin que nadie toque un pack ni un
    // pago. Lo encontro una mutacion mal aplicada, que dejo el `invalidar` en
    // tres metodos de este archivo en vez de en uno: de los dos sobrantes, este
    // resulto que hacia falta de verdad.
    const { servicio, cache } = crearServicio();

    await servicio.darDeBaja(ADMIN, 'usr-9');

    expect(cache.invalidar).toHaveBeenCalledWith('gym-1');
  });

  it('actualizarSalas NO invalida, y es a proposito', async () => {
    // A que salas accede un alumno no entra en ningun reporte: los que se acotan
    // por sala lo hacen por la sala del TURNO, que es de donde sale una clase, y
    // ni los morosos ni la composicion ni la asistencia miran `UsuarioSala`.
    const { servicio, cache } = crearServicio();

    await servicio.actualizarSalas(ADMIN, 'usr-9', { salaIds: ['sala-1'] });

    expect(cache.invalidar).not.toHaveBeenCalled();
  });

  it('un usuario inexistente no invalida nada', async () => {
    const { servicio, cache, usuario } = crearServicio();
    usuario.findFirst.mockResolvedValue(null);

    await expect(servicio.actualizar(ADMIN, 'usr-404', { packId: 'pack-12' })).rejects.toThrow(
      NotFoundException,
    );

    expect(cache.invalidar).not.toHaveBeenCalled();
  });
});

describe('UsuariosService.crearAlumno', () => {
  it('crea el Usuario con rol ALUMNO y su Perfil', async () => {
    const { servicio, usuario, perfil } = crearServicio();

    await servicio.crearAlumno(ADMIN, {
      nombreCompleto: 'Ana Perez',
      email: 'Ana@Gym.com',
      salaIds: ['sala-1'],
    });

    expect(usuario.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ rol: 'ALUMNO', email: 'ana@gym.com' }),
    });
    expect(perfil.create).toHaveBeenCalledTimes(1);
  });

  it('devuelve la contrasena temporal una sola vez y no la guarda en claro', async () => {
    const { servicio, usuario } = crearServicio();

    const alta = await servicio.crearAlumno(ADMIN, {
      nombreCompleto: 'Ana',
      email: 'ana@gym.com',
      salaIds: ['sala-1'],
    });

    expect(alta.passwordTemporal).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    const guardado = usuario.create.mock.calls[0][0].data.passwordHash;
    expect(guardado).toMatch(/^\$argon2id\$/);
    expect(guardado).not.toContain(alta.passwordTemporal);
  });

  it('advierte SIN_SALAS en vez de guardar en silencio un alumno inservible', async () => {
    const { servicio, sala } = crearServicio();
    sala.findMany.mockResolvedValue([]);

    const alta = await servicio.crearAlumno(ADMIN, {
      nombreCompleto: 'Ana',
      email: 'ana@gym.com',
      salaIds: [],
    });

    expect(alta.advertencias.map((a) => a.codigo)).toContain('SIN_SALAS');
  });

  it('advierte SIN_PACK si el alumno no trae pack', async () => {
    const { servicio } = crearServicio();

    const alta = await servicio.crearAlumno(ADMIN, {
      nombreCompleto: 'Ana',
      email: 'ana@gym.com',
      salaIds: ['sala-1'],
    });

    expect(alta.advertencias.map((a) => a.codigo)).toContain('SIN_PACK');
  });

  it('no advierte nada cuando el alta viene completa', async () => {
    const { servicio, pack } = crearServicio();
    pack.findFirst.mockResolvedValue({
      id: 'pack-1',
      tenantId: 'gym-1',
      nombre: '8 clases',
      salaId: null,
      tipo: 'MENSUAL',
      precio: null,
      clasesPorMes: 8,
      clasesTotales: null,
      cancelacionesPermitidas: null,
      activo: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const alta = await servicio.crearAlumno(ADMIN, {
      nombreCompleto: 'Ana',
      email: 'ana@gym.com',
      salaIds: ['sala-1'],
      packId: 'pack-1',
    });

    expect(alta.advertencias).toEqual([]);
  });

  it('409 si el email ya existe en este gimnasio', async () => {
    const { servicio, usuario } = crearServicio();
    usuario.findFirst.mockResolvedValue(USUARIO);

    await expect(
      servicio.crearAlumno(ADMIN, {
        nombreCompleto: 'Ana',
        email: 'ana@gym.com',
        salaIds: [],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('busca el email con findFirst: findUnique esta prohibido dentro del tenant', async () => {
    const { servicio, usuario } = crearServicio();

    await servicio.crearAlumno(ADMIN, {
      nombreCompleto: 'Ana',
      email: 'ana@gym.com',
      salaIds: [],
    });

    expect(usuario.findFirst).toHaveBeenCalledWith({ where: { email: 'ana@gym.com' } });
  });

  it('400 si alguna sala no pertenece a este gimnasio', async () => {
    const { servicio, sala } = crearServicio();
    sala.findMany.mockResolvedValue([SALA]); // solo una de las dos pedidas

    await expect(
      servicio.crearAlumno(ADMIN, {
        nombreCompleto: 'Ana',
        email: 'ana@gym.com',
        salaIds: ['sala-1', 'sala-de-otro-gym'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('deja rastro del alta en el historial', async () => {
    const { servicio, historial } = crearServicio();

    await servicio.crearAlumno(ADMIN, {
      nombreCompleto: 'Ana',
      email: 'ana@gym.com',
      salaIds: ['sala-1'],
    });

    expect(historial.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ entidad: 'Usuario', accion: 'CREADA' }),
      expect.anything(),
    );
  });
});

describe('UsuariosService.crearProfesor', () => {
  it('crea el Usuario con rol PROFESOR y un Perfil sin datos de alumno', async () => {
    const { servicio, usuario, perfil } = crearServicio();

    await servicio.crearProfesor(ADMIN, {
      nombreCompleto: 'Luis Gomez',
      email: 'luis@gym.com',
      salaIds: ['sala-1'],
    });

    expect(usuario.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ rol: 'PROFESOR' }),
    });

    const datosPerfil = perfil.create.mock.calls[0][0].data;
    expect(datosPerfil.packId).toBeNull();
    expect(datosPerfil.clasesExtra).toBe(0);
  });

  it('nunca advierte SIN_PACK: un profesor no tiene pack', async () => {
    const { servicio } = crearServicio();

    const alta = await servicio.crearProfesor(ADMIN, {
      nombreCompleto: 'Luis',
      email: 'luis@gym.com',
      salaIds: ['sala-1'],
    });

    expect(alta.advertencias.map((a) => a.codigo)).not.toContain('SIN_PACK');
  });

  it('si advierte SIN_SALAS cuando se le olvidan las salas', async () => {
    const { servicio, sala } = crearServicio();
    sala.findMany.mockResolvedValue([]);

    const alta = await servicio.crearProfesor(ADMIN, {
      nombreCompleto: 'Luis',
      email: 'luis@gym.com',
      salaIds: [],
    });

    expect(alta.advertencias.map((a) => a.codigo)).toEqual(['SIN_SALAS']);
  });
});

const OPERATIVO: JwtPayload = { sub: 'usr-op', tenantId: 'gym-1', rol: 'ADMIN_OPERATIVO' };
const PROPIO: JwtPayload = { sub: 'usr-1', tenantId: 'gym-1', rol: 'ALUMNO' };
const OTRO_ALUMNO: JwtPayload = { sub: 'usr-9', tenantId: 'gym-1', rol: 'ALUMNO' };

describe('UsuariosService.listar', () => {
  it('tipo=alumno filtra por rol ALUMNO', async () => {
    const { servicio, usuario } = crearServicio();

    await servicio.listar(ADMIN, { tipo: 'alumno' });

    expect(usuario.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ rol: 'ALUMNO' }) }),
    );
  });

  it('tipo=profesor filtra por rol PROFESOR', async () => {
    const { servicio, usuario } = crearServicio();

    await servicio.listar(ADMIN, { tipo: 'profesor' });

    expect(usuario.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ rol: 'PROFESOR' }) }),
    );
  });

  it('sin tipo devuelve alumnos y profesores, pero no administradores', async () => {
    const { servicio, usuario } = crearServicio();

    await servicio.listar(ADMIN, {});

    expect(usuario.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ rol: { in: ['ALUMNO', 'PROFESOR'] } }),
      }),
    );
  });

  it('filtra por sala con acceso', async () => {
    const { servicio, usuario } = crearServicio();

    await servicio.listar(ADMIN, { salaId: 'sala-1' });

    expect(usuario.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          perfil: { salas: { some: { salaId: 'sala-1' } } },
        }),
      }),
    );
  });

  it('nunca incluye fichaMedica en el listado', async () => {
    const { servicio } = crearServicio();

    const lista = await servicio.listar(ADMIN, {});

    expect(lista[0]).not.toHaveProperty('fichaMedica');
  });
});

describe('UsuariosService.obtener', () => {
  it('ADMIN_SALON ve la ficha medica', async () => {
    const { servicio } = crearServicio();

    const detalle = await servicio.obtener(ADMIN, 'usr-1');

    expect(detalle).toHaveProperty('fichaMedica');
  });

  it('ADMIN_OPERATIVO no ve la ficha medica de otro', async () => {
    const { servicio } = crearServicio();

    const detalle = await servicio.obtener(OPERATIVO, 'usr-1');

    expect(detalle).not.toHaveProperty('fichaMedica');
  });

  it('el propio usuario si ve su ficha medica', async () => {
    const { servicio } = crearServicio();

    const detalle = await servicio.obtener(PROPIO, 'usr-1');

    expect(detalle).toHaveProperty('fichaMedica');
  });

  it('403 si un alumno pide el detalle de otro', async () => {
    const { servicio } = crearServicio();

    await expect(servicio.obtener(OTRO_ALUMNO, 'usr-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('404 si el usuario no existe en este gimnasio', async () => {
    const { servicio, usuario } = crearServicio();
    usuario.findFirst.mockResolvedValue(null);

    await expect(servicio.obtener(ADMIN, 'usr-x')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('UsuariosService.actualizar', () => {
  it('400 si se intenta asignar un pack a un profesor', async () => {
    const { servicio, usuario } = crearServicio();
    usuario.findFirst.mockResolvedValue({
      ...CON_RELACIONES,
      rol: 'PROFESOR',
    });

    await expect(servicio.actualizar(ADMIN, 'usr-1', { packId: 'pack-1' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('un profesor si puede cambiar nombre y telefono', async () => {
    const { servicio, usuario, perfil } = crearServicio();
    usuario.findFirst.mockResolvedValue({ ...CON_RELACIONES, rol: 'PROFESOR' });

    await servicio.actualizar(ADMIN, 'usr-1', { telefono: '600123456' });

    expect(perfil.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ telefono: '600123456' }) }),
    );
  });
});

describe('UsuariosService.actualizarSalas', () => {
  it('reemplaza el conjunto de salas y lo audita', async () => {
    const { servicio, usuarioSala, historial } = crearServicio();

    await servicio.actualizarSalas(ADMIN, 'usr-1', { salaIds: ['sala-1'] });

    expect(usuarioSala.deleteMany).toHaveBeenCalledWith({ where: { perfilId: 'perf-1' } });
    expect(usuarioSala.createMany).toHaveBeenCalledWith({
      data: [{ tenantId: 'gym-1', perfilId: 'perf-1', salaId: 'sala-1' }],
    });
    expect(historial.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'SALAS_ACTUALIZADAS' }),
      expect.anything(),
    );
  });

  it('400 con lista vacia: no deja a nadie sin salas en silencio', async () => {
    const { servicio, usuarioSala } = crearServicio();

    await expect(servicio.actualizarSalas(ADMIN, 'usr-1', { salaIds: [] })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(usuarioSala.deleteMany).not.toHaveBeenCalled();
  });
});

describe('UsuariosService.resetearPassword', () => {
  it('devuelve una clave nueva y guarda solo su hash', async () => {
    const { servicio, usuario } = crearServicio();

    const resultado = await servicio.resetearPassword(ADMIN, 'usr-1');

    expect(resultado.passwordTemporal).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    const guardado = usuario.update.mock.calls[0][0].data.passwordHash;
    expect(guardado).toMatch(/^\$argon2id\$/);
    expect(guardado).not.toContain(resultado.passwordTemporal);
  });

  it('lo deja registrado en el historial', async () => {
    const { servicio, historial } = crearServicio();

    await servicio.resetearPassword(ADMIN, 'usr-1');

    expect(historial.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'PASSWORD_RESETEADA' }),
      expect.anything(),
    );
  });
});

describe('UsuariosService.darDeBaja', () => {
  it('marca activo=false en vez de borrar', async () => {
    const { servicio, usuario } = crearServicio();

    await servicio.darDeBaja(ADMIN, 'usr-1');

    expect(usuario.update).toHaveBeenCalledWith({
      where: { id: 'usr-1' },
      data: { activo: false },
    });
  });
});

describe('UsuariosService.listar con filtro autoRegistrado', () => {
  it('filtra a traves de la relacion perfil, no por un campo de Usuario', async () => {
    const { servicio, usuario } = crearServicio();

    await servicio.listar(ADMIN, { autoRegistrado: true });

    // El flag vive en Perfil. Un `where: { autoRegistrado: true }` a secas ni
    // siquiera compilaria contra el tipo generado de Prisma.
    expect(usuario.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ perfil: { autoRegistrado: true } }),
      }),
    );
  });

  it('sin el filtro no toca el where de perfil', async () => {
    const { servicio, usuario } = crearServicio();

    await servicio.listar(ADMIN, {});

    expect(usuario.findMany.mock.calls[0][0].where.perfil).toBeUndefined();
  });

  it('se combina con el filtro de sala en vez de pisarlo', async () => {
    const { servicio, usuario } = crearServicio();

    await servicio.listar(ADMIN, { autoRegistrado: true, salaId: 'sala-1' });

    expect(usuario.findMany.mock.calls[0][0].where.perfil).toEqual({
      autoRegistrado: true,
      salas: { some: { salaId: 'sala-1' } },
    });
  });

  it('autoRegistrado: false lista las altas hechas por el admin', async () => {
    const { servicio, usuario } = crearServicio();

    await servicio.listar(ADMIN, { autoRegistrado: false });

    expect(usuario.findMany.mock.calls[0][0].where.perfil).toEqual({ autoRegistrado: false });
  });
});

describe('UsuariosService.listar y el estado de pago', () => {
  it('resuelve el estado de TODOS los perfiles con UNA sola llamada', async () => {
    // El listado devuelve N alumnos y es la pantalla principal del admin.
    // Preguntar uno a uno serian N consultas contra la tabla de pagos.
    const { servicio, pagos } = crearServicio();

    await servicio.listar(ADMIN, {});

    expect(pagos.perfilesAlDia).toHaveBeenCalledTimes(1);
  });

  it('le pasa los ids de la pagina, no los pide de uno en uno', async () => {
    const { servicio, pagos } = crearServicio();

    await servicio.listar(ADMIN, {});

    const ids = pagos.perfilesAlDia.mock.calls[0]![1];
    expect(Array.isArray(ids)).toBe(true);
    expect(pagos.perfilAlDia).not.toHaveBeenCalled();
  });
});
