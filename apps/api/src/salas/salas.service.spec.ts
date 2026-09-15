import { ConflictException, NotFoundException } from '@nestjs/common';
import type { JwtPayload } from '@boxadmin/shared';
import { SalasService } from './salas.service';
import type { HistorialService } from '../common/historial/historial.service';
import type { PrismaService } from '../prisma/prisma.service';

const ADMIN: JwtPayload = { sub: 'usr-1', tenantId: 'gym-1', rol: 'ADMIN_SALON' };
const ALUMNO: JwtPayload = { sub: 'usr-2', tenantId: 'gym-1', rol: 'ALUMNO' };
const PROFESOR: JwtPayload = { sub: 'usr-3', tenantId: 'gym-1', rol: 'PROFESOR' };
const OPERATIVO: JwtPayload = { sub: 'usr-4', tenantId: 'gym-1', rol: 'ADMIN_OPERATIVO' };

const FILA = {
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

function crearServicio() {
  const sala = {
    create: jest.fn().mockResolvedValue(FILA),
    findFirst: jest.fn().mockResolvedValue(FILA),
    findMany: jest.fn().mockResolvedValue([FILA]),
    update: jest.fn().mockResolvedValue(FILA),
  };
  const turno = { count: jest.fn().mockResolvedValue(0) };

  const db = {
    sala,
    turno,
    // El doble de $transaction ejecuta el callback con el propio db: basta para
    // comprobar la logica; que la transaccion sea real lo verifican los e2e.
    //
    // El tipo de retorno va anotado a proposito: `db` se referencia a si mismo
    // dentro de su propio inicializador y sin la anotacion TypeScript en strict
    // no puede inferirlo (TS7022 / TS7024).
    $transaction: jest.fn((fn: (tx: unknown) => unknown): unknown => fn(db)),
  };

  const prisma = { db } as unknown as PrismaService;
  const historial = { registrar: jest.fn().mockResolvedValue(undefined) };

  return {
    servicio: new SalasService(prisma, historial as unknown as HistorialService),
    sala,
    turno,
    historial,
  };
}

describe('SalasService.crear', () => {
  it('crea la sala y deja rastro en el historial', async () => {
    const { servicio, sala, historial } = crearServicio();

    const creada = await servicio.crear(ADMIN, { nombre: 'Sala A' });

    expect(sala.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenantId: 'gym-1', nombre: 'Sala A' }),
    });
    expect(historial.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ entidad: 'Sala', entidadId: 'sala-1', accion: 'CREADA' }),
      expect.anything(),
    );
    expect(creada.id).toBe('sala-1');
  });

  it('escribe los ocho valores por defecto de una sala nueva', async () => {
    const { servicio, sala } = crearServicio();

    await servicio.crear(ADMIN, { nombre: 'Sala A' });

    // Assert exacto, no objectContaining: los defaults SON el contrato del alta.
    // Los cuatro heredables van a null a proposito ("hereda del tenant"), no a 0.
    expect(sala.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'gym-1',
        nombre: 'Sala A',
        visibleAlumnos: true,
        soloCuposLiberados: false,
        exclusiva: false,
        cupoBase: null,
        minMinutosCancelar: null,
        minMinutosAnotarse: null,
        listaEsperaHabilitada: null,
      },
    });
  });

  it('no filtra createdAt ni updatedAt al cliente', async () => {
    const { servicio } = crearServicio();

    const creada = await servicio.crear(ADMIN, { nombre: 'Sala A' });

    expect(creada).not.toHaveProperty('createdAt');
    expect(creada).not.toHaveProperty('updatedAt');
  });
});

describe('SalasService.listar', () => {
  it('un admin ve todas las salas, incluidas las ocultas y las de baja', async () => {
    const { servicio, sala } = crearServicio();

    await servicio.listar(ADMIN);

    expect(sala.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  it('un alumno solo ve las activas y visibles', async () => {
    const { servicio, sala } = crearServicio();

    await servicio.listar(ALUMNO);

    expect(sala.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { activa: true, visibleAlumnos: true } }),
    );
  });

  it('un profesor ve las activas aunque no sean visibles para alumnos', async () => {
    const { servicio, sala } = crearServicio();

    await servicio.listar(PROFESOR);

    // visibleAlumnos esconde la sala a los alumnos, no al profesor que da clase
    // en ella: sin esto no podria ver ni su propia sala.
    expect(sala.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { activa: true } }),
    );
  });

  it('un admin operativo ve todas, igual que el admin de salon', async () => {
    const { servicio, sala } = crearServicio();

    await servicio.listar(OPERATIVO);

    expect(sala.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });
});

describe('SalasService.obtener', () => {
  it('usa findFirst y no findUnique', async () => {
    const { servicio, sala } = crearServicio();

    await servicio.obtener(ADMIN, 'sala-1');

    // findUnique esta prohibido dentro del contexto de tenant: su where solo
    // admite campos unicos, asi que la extension no puede inyectarle el filtro
    // y lanza UnsafeUniqueOperationError.
    expect(sala.findFirst).toHaveBeenCalledWith({ where: { id: 'sala-1' } });
  });

  it('404 si la sala no existe en este gimnasio', async () => {
    const { servicio, sala } = crearServicio();
    sala.findFirst.mockResolvedValue(null);

    await expect(servicio.obtener(ADMIN, 'sala-x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404 para un alumno si la sala esta oculta: no confirma que existe', async () => {
    const { servicio, sala } = crearServicio();
    sala.findFirst.mockResolvedValue({ ...FILA, visibleAlumnos: false });

    await expect(servicio.obtener(ALUMNO, 'sala-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('un profesor si puede obtener una sala no visible para alumnos', async () => {
    const { servicio, sala } = crearServicio();
    sala.findFirst.mockResolvedValue({ ...FILA, visibleAlumnos: false });

    await expect(servicio.obtener(PROFESOR, 'sala-1')).resolves.toMatchObject({ id: 'sala-1' });
  });

  it('404 para un profesor si la sala esta de baja: obtener y listar usan el mismo criterio', async () => {
    const { servicio, sala } = crearServicio();
    sala.findFirst.mockResolvedValue({ ...FILA, activa: false });

    await expect(servicio.obtener(PROFESOR, 'sala-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('SalasService.darDeBaja', () => {
  it('marca activa=false en vez de borrar', async () => {
    const { servicio, sala } = crearServicio();

    await servicio.darDeBaja(ADMIN, 'sala-1');

    expect(sala.update).toHaveBeenCalledWith({
      where: { id: 'sala-1' },
      data: { activa: false },
    });
  });

  it('409 si la sala tiene turnos futuros', async () => {
    const { servicio, turno, sala } = crearServicio();
    turno.count.mockResolvedValue(3);

    await expect(servicio.darDeBaja(ADMIN, 'sala-1')).rejects.toBeInstanceOf(ConflictException);
    expect(sala.update).not.toHaveBeenCalled();
  });

  it('404 si la sala no existe', async () => {
    const { servicio, sala } = crearServicio();
    sala.findFirst.mockResolvedValue(null);

    await expect(servicio.darDeBaja(ADMIN, 'sala-x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('es idempotente: repetir la baja no vuelve a escribir en el historial', async () => {
    const { servicio, sala, historial } = crearServicio();
    sala.findFirst.mockResolvedValue({ ...FILA, activa: false });

    const devuelta = await servicio.darDeBaja(ADMIN, 'sala-1');

    expect(devuelta.activa).toBe(false);
    expect(sala.update).not.toHaveBeenCalled();
    expect(historial.registrar).not.toHaveBeenCalled();
  });
});

describe('SalasService.actualizar', () => {
  it('404 si la sala no existe en este gimnasio', async () => {
    const { servicio, sala } = crearServicio();
    sala.findFirst.mockResolvedValue(null);

    await expect(servicio.actualizar(ADMIN, 'sala-x', { nombre: 'Otra' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(sala.update).not.toHaveBeenCalled();
  });

  it('manda al update exactamente los campos que trae el PATCH', async () => {
    const { servicio, sala } = crearServicio();

    await servicio.actualizar(ADMIN, 'sala-1', { nombre: 'Sala B', cupoBase: 12 });

    expect(sala.update).toHaveBeenCalledWith({
      where: { id: 'sala-1' },
      data: { nombre: 'Sala B', cupoBase: 12 },
    });
  });

  it('deja rastro ACTUALIZADA en el historial', async () => {
    const { servicio, historial } = crearServicio();

    await servicio.actualizar(ADMIN, 'sala-1', { nombre: 'Sala B' });

    expect(historial.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        entidad: 'Sala',
        entidadId: 'sala-1',
        accion: 'ACTUALIZADA',
        detalle: { nombre: 'Sala B' },
      }),
      expect.anything(),
    );
  });

  it('409 al mandar activa:false si la sala tiene turnos futuros', async () => {
    const { servicio, sala, turno } = crearServicio();
    turno.count.mockResolvedValue(3);

    // El PATCH no puede ser una puerta trasera para dar de baja una sala
    // esquivando la proteccion que aplica el DELETE.
    await expect(servicio.actualizar(ADMIN, 'sala-1', { activa: false })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(sala.update).not.toHaveBeenCalled();
  });

  it('audita activa:false como DADA_DE_BAJA, no como ACTUALIZADA', async () => {
    const { servicio, historial } = crearServicio();

    await servicio.actualizar(ADMIN, 'sala-1', { activa: false });

    expect(historial.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ entidadId: 'sala-1', accion: 'DADA_DE_BAJA' }),
      expect.anything(),
    );
  });

  it('reactivar con activa:true no comprueba turnos ni audita una baja', async () => {
    const { servicio, turno, historial } = crearServicio();

    await servicio.actualizar(ADMIN, 'sala-1', { activa: true });

    expect(turno.count).not.toHaveBeenCalled();
    expect(historial.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'ACTUALIZADA' }),
      expect.anything(),
    );
  });

  it('activa:false sobre una sala ya de baja no vuelve a auditar una baja', async () => {
    const { servicio, sala, turno, historial } = crearServicio();
    sala.findFirst.mockResolvedValue({ ...FILA, activa: false });

    await servicio.actualizar(ADMIN, 'sala-1', { activa: false, nombre: 'Sala B' });

    expect(turno.count).not.toHaveBeenCalled();
    expect(historial.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'ACTUALIZADA' }),
      expect.anything(),
    );
  });
});
