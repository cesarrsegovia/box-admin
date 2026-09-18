import { Injectable, NotFoundException } from '@nestjs/common';
import {
  calcularDisponibilidad,
  resolverConfiguracion,
  type ConfiguracionEfectiva,
  type Disponibilidad,
  type JwtPayload,
} from '@boxadmin/shared';
import { PrismaService, type ClientePrismaTx } from '../prisma/prisma.service';

/** Las columnas de Sala que hacen falta para decidir. */
const SALA_PARA_DISPONIBILIDAD = {
  activa: true,
  visibleAlumnos: true,
  soloCuposLiberados: true,
  minMinutosCancelar: true,
  minMinutosAnotarse: true,
  listaEsperaHabilitada: true,
} as const;

@Injectable()
export class DisponibilidadService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Disponibilidad de UN turno para UN alumno.
   *
   * Aqui no hay reglas de negocio: se cargan los datos y decide
   * `calcularDisponibilidad`. Si aparece un `if` sobre cupos o ventanas en este
   * archivo, esta en el sitio equivocado.
   *
   * `ahora` entra por parametro y no se lee del reloj aqui para que los tests
   * puedan fijarlo sin trucos de timers.
   */
  async paraTurno(
    _actor: JwtPayload,
    perfilId: string,
    turnoId: string,
    ahora: Date = new Date(),
    cliente: ClientePrismaTx = this.prisma.db,
  ): Promise<Disponibilidad> {
    const turno = await cliente.turno.findFirst({
      where: { id: turnoId },
      include: { sala: { select: SALA_PARA_DISPONIBILIDAD } },
    });
    if (!turno) throw new NotFoundException('Turno inexistente');

    const config = await this.configuracionDeSala(turno.sala, cliente);

    const [ocupados, canceladas, misReservas, accesos, publicados, cola] = await Promise.all([
      cliente.reserva.count({ where: { turnoId, canceladaEn: null } }),
      cliente.reserva.count({ where: { turnoId, canceladaEn: { not: null } } }),
      cliente.reserva.findMany({ where: { turnoId, perfilId, canceladaEn: null } }),
      cliente.usuarioSala.findMany({ where: { perfilId, salaId: turno.salaId } }),
      cliente.mesCalendario.findMany({
        where: {
          salaId: turno.salaId,
          anio: turno.fecha.getUTCFullYear(),
          mes: turno.fecha.getUTCMonth() + 1,
          estado: 'HABILITADO',
        },
      }),
      cliente.listaEspera.findMany({
        where: { turnoId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    ]);

    // La posicion se deriva del orden: 1 = el proximo en entrar. No hay ningun
    // contador guardado que renumerar.
    const indice = cola.findIndex((fila) => fila.perfilId === perfilId);

    return calcularDisponibilidad({
      turno: {
        id: turno.id,
        salaId: turno.salaId,
        fecha: turno.fecha,
        horaInicio: turno.horaInicio,
        cupo: turno.cupo,
      },
      sala: turno.sala,
      config,
      ocupados,
      huboCancelaciones: canceladas > 0,
      mesPublicado: publicados.length > 0,
      tieneAccesoASala: accesos.length > 0,
      yaReservado: misReservas.length > 0,
      enListaEspera: indice >= 0,
      posicionEnLista: indice >= 0 ? indice + 1 : null,
      ahora,
    });
  }

  /**
   * Resuelve la cascada `Sala ?? Tenant ?? sistema`.
   *
   * En contexto de tenant, `findFirst()` sobre Tenant ya queda restringido al
   * propio gimnasio (la extension fuerza `where.id = tenantId`): no hace falta
   * —ni se debe— pasar el id a mano.
   */
  async configuracionDeSala(
    sala: {
      minMinutosCancelar: number | null;
      minMinutosAnotarse: number | null;
      listaEsperaHabilitada: boolean | null;
    },
    cliente: ClientePrismaTx = this.prisma.db,
  ): Promise<ConfiguracionEfectiva> {
    const tenant = await cliente.tenant.findFirst();

    return resolverConfiguracion(sala, {
      minMinutosCancelar: tenant?.minMinutosCancelar ?? null,
      minMinutosAnotarse: tenant?.minMinutosAnotarse ?? null,
      listaEsperaHabilitada: tenant?.listaEsperaHabilitada ?? null,
    });
  }
}
