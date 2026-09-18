import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { JwtPayload } from '@boxadmin/shared';
import { MiCalendarioService } from './mi-calendario.service';
import type { DisponibilidadService } from '../disponibilidad/disponibilidad.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { ReservasService } from '../reservas/reservas.service';

const ALUMNO: JwtPayload = { sub: 'usr-1', tenantId: 'gym-1', rol: 'ALUMNO' };

const LIBRE = {
  turnoId: 'turno-1',
  estado: 'LIBRE' as const,
  cupo: 5,
  ocupados: 1,
  puedeReservar: true,
  motivo: null,
  enListaEspera: false,
  posicionEnLista: null,
};

const RESERVA = {
  id: 'reserva-1',
  perfilId: 'perfil-1',
  turnoId: 'turno-1',
  canceladaEn: null,
  turno: {
    fecha: new Date('2099-10-02T00:00:00.000Z'),
    horaInicio: '10:00',
    sala: {
      activa: true,
      visibleAlumnos: true,
      soloCuposLiberados: false,
      minMinutosCancelar: 120,
      minMinutosAnotarse: null,
      listaEsperaHabilitada: null,
    },
  },
};

function crearServicio() {
  const db = {
    perfil: { findFirst: jest.fn().mockResolvedValue({ id: 'perfil-1' }) },
    reserva: { findFirst: jest.fn().mockResolvedValue(RESERVA), findMany: jest.fn() },
    turno: { findMany: jest.fn() },
    usuarioSala: { findMany: jest.fn() },
  };
  const disponibilidad = {
    paraTurno: jest.fn().mockResolvedValue(LIBRE),
    configuracionDeSala: jest.fn().mockResolvedValue({
      minMinutosCancelar: 120,
      minMinutosAnotarse: 0,
      listaEsperaHabilitada: false,
    }),
  };
  const reservas = {
    crear: jest.fn().mockResolvedValue({ id: 'reserva-nueva', advertencias: [] }),
    cancelar: jest.fn().mockResolvedValue({ id: 'reserva-1', canceladaEn: 'x' }),
  };

  return {
    servicio: new MiCalendarioService(
      { db } as unknown as PrismaService,
      disponibilidad as unknown as DisponibilidadService,
      reservas as unknown as ReservasService,
    ),
    db,
    disponibilidad,
    reservas,
  };
}

describe('MiCalendarioService.reservar', () => {
  it('delega en ReservasService con origen ALUMNO y el perfil del actor', async () => {
    const { servicio, reservas } = crearServicio();

    await servicio.reservar(ALUMNO, 'turno-1');

    // El perfilId sale del actor, NUNCA del cuerpo: si viniera del cliente, un
    // alumno podria reservar a nombre de otro.
    expect(reservas.crear).toHaveBeenCalledWith(ALUMNO, 'turno-1', {
      perfilId: 'perfil-1',
      origen: 'ALUMNO',
    });
  });

  it('propaga las advertencias de pack: el pack avisa, no bloquea', async () => {
    const { servicio, reservas } = crearServicio();
    reservas.crear.mockResolvedValue({
      id: 'reserva-nueva',
      advertencias: [{ codigo: 'PACK_AGOTADO', mensaje: 'x' }],
    });

    const creada = await servicio.reservar(ALUMNO, 'turno-1');

    // Decision D3 de la Fase 1, que esta fase mantiene: pasarse del pack no
    // impide reservar.
    expect(creada.advertencias).toHaveLength(1);
  });

  it('403 si no tiene acceso a la sala', async () => {
    const { servicio, disponibilidad } = crearServicio();
    disponibilidad.paraTurno.mockResolvedValue({
      ...LIBRE,
      puedeReservar: false,
      motivo: 'SIN_ACCESO_A_SALA',
    });

    await expect(servicio.reservar(ALUMNO, 'turno-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('409 con la ventana de anotacion cerrada, y sin llegar al servicio de reservas', async () => {
    const { servicio, disponibilidad, reservas } = crearServicio();
    disponibilidad.paraTurno.mockResolvedValue({
      ...LIBRE,
      puedeReservar: false,
      motivo: 'VENTANA_CERRADA',
    });

    await expect(servicio.reservar(ALUMNO, 'turno-1')).rejects.toBeInstanceOf(ConflictException);
    expect(reservas.crear).not.toHaveBeenCalled();
  });

  it('409 con el mes sin publicar', async () => {
    const { servicio, disponibilidad } = crearServicio();
    disponibilidad.paraTurno.mockResolvedValue({
      ...LIBRE,
      puedeReservar: false,
      motivo: 'MES_NO_PUBLICADO',
    });

    await expect(servicio.reservar(ALUMNO, 'turno-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('409 si ya tiene reserva activa en ese turno', async () => {
    const { servicio, disponibilidad } = crearServicio();
    disponibilidad.paraTurno.mockResolvedValue({
      ...LIBRE,
      puedeReservar: false,
      motivo: 'YA_RESERVADO',
    });

    await expect(servicio.reservar(ALUMNO, 'turno-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('409 en una sala de solo cupos liberados sin cancelaciones', async () => {
    const { servicio, disponibilidad } = crearServicio();
    disponibilidad.paraTurno.mockResolvedValue({
      ...LIBRE,
      estado: 'SOLO_ADMIN',
      puedeReservar: false,
      motivo: 'SOLO_CUPOS_LIBERADOS',
    });

    await expect(servicio.reservar(ALUMNO, 'turno-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('el mensaje de un turno en LISTA_ESPERA sugiere anotarse, no un error generico', async () => {
    const { servicio, disponibilidad } = crearServicio();
    disponibilidad.paraTurno.mockResolvedValue({
      ...LIBRE,
      estado: 'LISTA_ESPERA',
      ocupados: 5,
      puedeReservar: false,
      motivo: null,
    });

    // Punto del checklist del PDF: "reservar un turno lleno ofrece anotarse en
    // lista de espera en vez de un error generico".
    await expect(servicio.reservar(ALUMNO, 'turno-1')).rejects.toThrow(/lista de espera/i);
  });

  it('un turno LLENO sin lista de espera da un 409 con el recuento', async () => {
    const { servicio, disponibilidad } = crearServicio();
    disponibilidad.paraTurno.mockResolvedValue({
      ...LIBRE,
      estado: 'LLENO',
      ocupados: 5,
      puedeReservar: false,
      motivo: null,
    });

    await expect(servicio.reservar(ALUMNO, 'turno-1')).rejects.toThrow(/5\/5/);
  });
});

describe('MiCalendarioService.cancelarPropia', () => {
  it('cancela como RECUPERABLE dentro de la ventana', async () => {
    const { servicio, reservas } = crearServicio();

    await servicio.cancelarPropia(ALUMNO, 'reserva-1', new Date('2099-10-02T07:00:00.000Z'));

    // Dentro de ventana la clase vuelve al pack. El alumno no elige el tipo:
    // lo decide la ventana.
    expect(reservas.cancelar).toHaveBeenCalledWith(ALUMNO, 'reserva-1', 'RECUPERABLE');
  });

  it('409 fuera de la ventana de cancelacion', async () => {
    const { servicio, reservas } = crearServicio();

    await expect(
      servicio.cancelarPropia(ALUMNO, 'reserva-1', new Date('2099-10-02T09:00:00.000Z')),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(reservas.cancelar).not.toHaveBeenCalled();
  });

  it('403 si la reserva es de otro alumno', async () => {
    const { servicio, db } = crearServicio();
    db.reserva.findFirst.mockResolvedValue({ ...RESERVA, perfilId: 'otro' });

    await expect(
      servicio.cancelarPropia(ALUMNO, 'reserva-1', new Date('2099-10-02T07:00:00.000Z')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('404 si la reserva no existe', async () => {
    const { servicio, db } = crearServicio();
    db.reserva.findFirst.mockResolvedValue(null);

    await expect(servicio.cancelarPropia(ALUMNO, 'reserva-9', new Date())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('409 si ya estaba cancelada', async () => {
    const { servicio, db } = crearServicio();
    db.reserva.findFirst.mockResolvedValue({ ...RESERVA, canceladaEn: new Date() });

    await expect(
      servicio.cancelarPropia(ALUMNO, 'reserva-1', new Date('2099-10-02T07:00:00.000Z')),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('el mensaje de fuera de ventana dice cuantos minutos pedia', async () => {
    const { servicio } = crearServicio();

    await expect(
      servicio.cancelarPropia(ALUMNO, 'reserva-1', new Date('2099-10-02T09:00:00.000Z')),
    ).rejects.toThrow(/120 minutos/);
  });
});
