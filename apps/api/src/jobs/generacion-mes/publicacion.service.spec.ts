import type { JwtPayload, PlanDeMes } from '@boxadmin/shared';
import { PublicacionService } from './publicacion.service';
import type { HistorialService } from '../../common/historial/historial.service';
import type { PrismaService } from '../../prisma/prisma.service';

const ADMIN: JwtPayload = { sub: 'usr-1', tenantId: 'gym-1', rol: 'ADMIN_SALON' };

/** Plan vacio del que parten los casos: cada test rellena solo lo que le importa. */
function planVacio(): PlanDeMes {
  return {
    turnosACrear: [],
    reservasACrear: [],
    conflictos: [],
    exclusiones: [],
    resumen: { turnos: 0, reservas: 0, conflictos: 0, exclusiones: 0 },
  };
}

/** Un turno del plan, con los huecos rellenos para no repetirlo en cada caso. */
function turnoPlanificado(fecha: string, horaInicio: string) {
  return {
    salaId: 'sala-1',
    nombre: 'Pilates',
    fecha,
    horaInicio,
    horaFin: '11:00',
    cupo: 4,
  };
}

function crearServicio() {
  const turno = {
    // Cada turno creado devuelve un id distinto y reconocible, para poder
    // comprobar a que turno concreto se engancho cada reserva.
    create: jest
      .fn()
      .mockImplementation(({ data }: { data: { fecha: Date; horaInicio: string } }) =>
        Promise.resolve({
          id: `turno-${data.fecha.toISOString().slice(0, 10)}-${data.horaInicio}`,
        }),
      ),
    findFirst: jest.fn().mockResolvedValue(null),
  };
  const reserva = {
    create: jest.fn().mockResolvedValue({ id: 'res-1' }),
  };
  const mesCalendario = {
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    findFirst: jest.fn().mockResolvedValue({ id: 'mes-1' }),
  };
  const db = {
    turno,
    reserva,
    mesCalendario,
    // La anotacion `: unknown` del retorno no es decorativa: sin ella
    // `tsc --strict` lanza TS7022 por inferencia circular.
    $transaction: jest.fn((fn: (tx: unknown) => unknown): unknown => fn(db)),
  };
  const prisma = { db } as unknown as PrismaService;
  const historial = { registrar: jest.fn().mockResolvedValue(undefined) };

  return {
    servicio: new PublicacionService(prisma, historial as unknown as HistorialService),
    turno,
    reserva,
    mesCalendario,
    historial,
    db,
  };
}

/** Un error con la forma que Prisma da a la violacion de indice unico. */
function errorP2002(): Error {
  return Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
}

/** La misma violacion, pero envuelta por el driver adapter de Prisma 7. */
function errorDriverAdapter(): Error {
  const error = Object.assign(new Error('driver'), {
    cause: { kind: 'UniqueConstraintViolation' },
  });
  error.name = 'DriverAdapterError';
  return error;
}

describe('PublicacionService.aplicar', () => {
  it('crea los turnos del plan y despues sus reservas', async () => {
    const { servicio, turno, reserva } = crearServicio();
    const plan = planVacio();
    plan.turnosACrear = [turnoPlanificado('2099-10-05', '10:00')];
    plan.reservasACrear = [
      { perfilId: 'per-1', salaId: 'sala-1', fecha: '2099-10-05', horaInicio: '10:00' },
    ];

    await servicio.aplicar(ADMIN, 'sala-1', 2099, 10, plan);

    expect(turno.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'gym-1',
        salaId: 'sala-1',
        nombre: 'Pilates',
        fecha: new Date('2099-10-05T00:00:00.000Z'),
        horaInicio: '10:00',
        horaFin: '11:00',
        cupo: 4,
      },
    });
    expect(reserva.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'gym-1',
        turnoId: 'turno-2099-10-05-10:00',
        perfilId: 'per-1',
        origen: 'RUTINA',
      },
    });
    // El orden importa: las reservas cuelgan de los turnos, asi que ningun
    // turno puede crearse despues de la reserva que lo referencia.
    expect(turno.create.mock.invocationCallOrder[0]).toBeLessThan(
      reserva.create.mock.invocationCallOrder[0],
    );
  });

  it('resuelve el turnoId de cada reserva por sala+fecha+hora, no por indice', async () => {
    const { servicio, turno, reserva } = crearServicio();
    // El turno del dia 6 ya existia en la base: no esta en turnosACrear.
    turno.findFirst.mockResolvedValue({ id: 'turno-preexistente' });

    const plan = planVacio();
    plan.turnosACrear = [
      turnoPlanificado('2099-10-05', '10:00'),
      turnoPlanificado('2099-10-07', '18:00'),
    ];
    // Deliberadamente en otro orden que los turnos: si la implementacion casara
    // por indice, la primera reserva iria al turno del dia 5.
    plan.reservasACrear = [
      { perfilId: 'per-1', salaId: 'sala-1', fecha: '2099-10-07', horaInicio: '18:00' },
      { perfilId: 'per-2', salaId: 'sala-1', fecha: '2099-10-06', horaInicio: '09:00' },
      { perfilId: 'per-3', salaId: 'sala-1', fecha: '2099-10-05', horaInicio: '10:00' },
    ];

    await servicio.aplicar(ADMIN, 'sala-1', 2099, 10, plan);

    const turnoIds = reserva.create.mock.calls.map(
      ([argumento]: [{ data: { turnoId: string } }]) => argumento.data.turnoId,
    );
    expect(turnoIds).toEqual([
      'turno-2099-10-07-18:00',
      'turno-preexistente',
      'turno-2099-10-05-10:00',
    ]);
    // El turno preexistente se busca por sala+fecha+hora, no por id.
    expect(turno.findFirst).toHaveBeenCalledWith({
      where: {
        salaId: 'sala-1',
        fecha: new Date('2099-10-06T00:00:00.000Z'),
        horaInicio: '09:00',
      },
    });
  });

  it('no crea nada si el plan viene vacio', async () => {
    const { servicio, turno, reserva } = crearServicio();

    const resumen = await servicio.aplicar(ADMIN, 'sala-1', 2099, 10, planVacio());

    expect(turno.create).not.toHaveBeenCalled();
    expect(reserva.create).not.toHaveBeenCalled();
    expect(resumen).toEqual({ turnos: 0, reservas: 0, conflictos: 0, exclusiones: 0 });
  });

  it('marca el mes como HABILITADO con publicadoEn y publicadoPor', async () => {
    const { servicio, mesCalendario } = crearServicio();

    await servicio.aplicar(ADMIN, 'sala-1', 2099, 10, planVacio());

    expect(mesCalendario.updateMany).toHaveBeenCalledTimes(1);
    const [argumento] = mesCalendario.updateMany.mock.calls[0] as [
      { where: unknown; data: { estado: string; publicadoEn: Date; publicadoPor: string } },
    ];
    expect(argumento.where).toEqual({ salaId: 'sala-1', anio: 2099, mes: 10 });
    expect(argumento.data.estado).toBe('HABILITADO');
    expect(argumento.data.publicadoPor).toBe('usr-1');
    expect(argumento.data.publicadoEn).toBeInstanceOf(Date);
  });

  it('toma el cerrojo con updateMany antes de escribir', async () => {
    const { servicio, mesCalendario, turno, reserva, db } = crearServicio();
    const plan = planVacio();
    plan.turnosACrear = [turnoPlanificado('2099-10-05', '10:00')];
    plan.reservasACrear = [
      { perfilId: 'per-1', salaId: 'sala-1', fecha: '2099-10-05', horaInicio: '10:00' },
    ];

    await servicio.aplicar(ADMIN, 'sala-1', 2099, 10, plan);

    // Todo ocurre dentro de la misma transaccion...
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    // ...y el cerrojo es lo primero que se toca: si otro job gano la carrera,
    // este no debe haber escrito ni un turno.
    expect(mesCalendario.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      turno.create.mock.invocationCallOrder[0],
    );
    expect(mesCalendario.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      reserva.create.mock.invocationCallOrder[0],
    );
  });

  it('si el cerrojo devuelve count 0, otro job esta publicando y aborta sin escribir', async () => {
    const { servicio, mesCalendario, turno, reserva, historial } = crearServicio();
    mesCalendario.updateMany.mockResolvedValue({ count: 0 });

    const plan = planVacio();
    plan.turnosACrear = [turnoPlanificado('2099-10-05', '10:00')];
    plan.reservasACrear = [
      { perfilId: 'per-1', salaId: 'sala-1', fecha: '2099-10-05', horaInicio: '10:00' },
    ];

    const resumen = await servicio.aplicar(ADMIN, 'sala-1', 2099, 10, plan);

    expect(turno.create).not.toHaveBeenCalled();
    expect(reserva.create).not.toHaveBeenCalled();
    expect(historial.registrar).not.toHaveBeenCalled();
    expect(resumen).toEqual({ turnos: 0, reservas: 0, conflictos: 0, exclusiones: 0 });
  });

  it('un P2002 al crear una reserva no aborta el resto: la reserva ya existia', async () => {
    const { servicio, reserva } = crearServicio();
    // Primera reserva: duplicada tal como la reporta Prisma.
    // Segunda: la misma violacion, pero envuelta por el driver adapter.
    // Tercera: se crea de verdad.
    reserva.create
      .mockRejectedValueOnce(errorP2002())
      .mockRejectedValueOnce(errorDriverAdapter())
      .mockResolvedValueOnce({ id: 'res-3' });

    const plan = planVacio();
    plan.turnosACrear = [turnoPlanificado('2099-10-05', '10:00')];
    plan.reservasACrear = [
      { perfilId: 'per-1', salaId: 'sala-1', fecha: '2099-10-05', horaInicio: '10:00' },
      { perfilId: 'per-2', salaId: 'sala-1', fecha: '2099-10-05', horaInicio: '10:00' },
      { perfilId: 'per-3', salaId: 'sala-1', fecha: '2099-10-05', horaInicio: '10:00' },
    ];

    const resumen = await servicio.aplicar(ADMIN, 'sala-1', 2099, 10, plan);

    // El mes entero se recorre: un duplicado no interrumpe nada.
    expect(reserva.create).toHaveBeenCalledTimes(3);
    // Solo se cuenta lo que de verdad se creo.
    expect(resumen.reservas).toBe(1);
  });

  it('un error que NO sea duplicado si aborta la publicacion', async () => {
    const { servicio, reserva } = crearServicio();
    reserva.create.mockRejectedValueOnce(
      Object.assign(new Error('columna inexistente'), { code: 'P2022' }),
    );

    const plan = planVacio();
    plan.turnosACrear = [turnoPlanificado('2099-10-05', '10:00')];
    plan.reservasACrear = [
      { perfilId: 'per-1', salaId: 'sala-1', fecha: '2099-10-05', horaInicio: '10:00' },
      { perfilId: 'per-2', salaId: 'sala-1', fecha: '2099-10-05', horaInicio: '10:00' },
    ];

    // Tragarse cualquier error convertiria la idempotencia en perdida silenciosa
    // de datos: solo el duplicado se ignora.
    await expect(servicio.aplicar(ADMIN, 'sala-1', 2099, 10, plan)).rejects.toThrow(
      'columna inexistente',
    );
    expect(reserva.create).toHaveBeenCalledTimes(1);
  });

  it('devuelve el resumen del plan aplicado', async () => {
    const { servicio } = crearServicio();
    const plan = planVacio();
    plan.turnosACrear = [
      turnoPlanificado('2099-10-05', '10:00'),
      turnoPlanificado('2099-10-07', '10:00'),
    ];
    plan.reservasACrear = [
      { perfilId: 'per-1', salaId: 'sala-1', fecha: '2099-10-05', horaInicio: '10:00' },
      { perfilId: 'per-2', salaId: 'sala-1', fecha: '2099-10-07', horaInicio: '10:00' },
    ];
    plan.conflictos = [
      { tipo: 'CUPO_LLENO', perfilId: 'per-3', fecha: '2099-10-05', detalle: 'sin sitio' },
    ];
    plan.exclusiones = [
      { tipo: 'VACACION_ALUMNO', perfilId: 'per-4', fecha: '2099-10-07', detalle: 'vacaciones' },
      { tipo: 'AUSENCIA_SALA', perfilId: null, fecha: '2099-10-12', detalle: 'feriado' },
    ];

    const resumen = await servicio.aplicar(ADMIN, 'sala-1', 2099, 10, plan);

    expect(resumen).toEqual({ turnos: 2, reservas: 2, conflictos: 1, exclusiones: 2 });
  });

  it('audita la publicacion con el resumen en el detalle', async () => {
    const { servicio, historial, db } = crearServicio();
    const plan = planVacio();
    plan.turnosACrear = [turnoPlanificado('2099-10-05', '10:00')];

    await servicio.aplicar(ADMIN, 'sala-1', 2099, 10, plan);

    expect(historial.registrar).toHaveBeenCalledWith(
      {
        actor: ADMIN,
        entidad: 'MesCalendario',
        entidadId: 'mes-1',
        accion: 'PUBLICADA',
        detalle: {
          salaId: 'sala-1',
          anio: 2099,
          mes: 10,
          turnos: 1,
          reservas: 0,
          conflictos: 0,
          exclusiones: 0,
        },
      },
      // La auditoria va en la misma transaccion que el cambio que la origino.
      db,
    );
  });
});
