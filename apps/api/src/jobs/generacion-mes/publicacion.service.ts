import { Injectable, Logger } from '@nestjs/common';
import {
  desdeFechaISO,
  type JwtPayload,
  type PlanDeMes,
  type ResumenDelPlan,
} from '@boxadmin/shared';
import { HistorialService } from '../../common/historial/historial.service';
import { PrismaService, type ClientePrismaTx } from '../../prisma/prisma.service';

/**
 * ¿Este error significa "la fila ya existia"?
 *
 * Se reconocen las DOS formas en que puede llegar una violacion de indice unico,
 * y eso no es paranoia: en la Fase 1, comprobar solo `code` dejo el reintento de
 * serializacion sin dispararse durante toda una fase, porque con el driver
 * adapter `pg` de Prisma 7 el error llega como DriverAdapterError con
 * `cause.kind` y SIN `code`.
 */
function esDuplicado(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;

  const { code, name, cause } = error as { code?: unknown; name?: unknown; cause?: unknown };
  if (code === 'P2002') return true;

  if (name !== 'DriverAdapterError' || typeof cause !== 'object' || cause === null) return false;
  return (cause as { kind?: unknown }).kind === 'UniqueConstraintViolation';
}

/** Clave de una franja horaria: identifica el turno al que engancha una reserva. */
const franjaDe = (fecha: string, horaInicio: string): string => `${fecha}|${horaInicio}`;

@Injectable()
export class PublicacionService {
  private readonly logger = new Logger(PublicacionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly historial: HistorialService,
  ) {}

  /**
   * Aplica un plan ya calculado y deja el mes HABILITADO.
   *
   * Todo va en una transaccion, y el cerrojo es la propia fila de MesCalendario:
   * se toma con un `updateMany` condicional antes de escribir nada, asi que dos
   * publicaciones simultaneas del mismo mes no se pisan. La que llega segunda
   * encuentra `count: 0` y aborta sin haber tocado un solo turno.
   */
  async aplicar(
    actor: JwtPayload,
    salaId: string,
    anio: number,
    mes: number,
    plan: PlanDeMes,
  ): Promise<ResumenDelPlan> {
    return await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      // 1. El cerrojo, antes que cualquier escritura.
      const tomado = await cliente.mesCalendario.updateMany({
        where: { salaId, anio, mes },
        data: { estado: 'HABILITADO', publicadoEn: new Date(), publicadoPor: actor.sub },
      });

      if (tomado.count === 0) {
        // La fila la crea `encolarPublicacion` antes de meter el job en la cola,
        // asi que llegar aqui sin fila significa que otro job la tomo o que algo
        // la borro por debajo. En ninguno de los dos casos hay que escribir.
        this.logger.warn(
          `No se tomo el mes ${anio}-${mes} de la sala ${salaId}: otro job lo esta publicando, o no hay fila`,
        );
        return { turnos: 0, reservas: 0, conflictos: 0, exclusiones: 0 };
      }

      // 2. Los turnos primero: las reservas cuelgan de ellos.
      const idPorFranja = new Map<string, string>();

      for (const turno of plan.turnosACrear) {
        const creado = await cliente.turno.create({
          data: {
            // tenantId explicito: el tipo generado de Prisma lo exige bajo strict,
            // aunque la extension de aislamiento lo sobrescriba con el del contexto.
            tenantId: actor.tenantId,
            salaId: turno.salaId,
            nombre: turno.nombre,
            fecha: desdeFechaISO(turno.fecha),
            horaInicio: turno.horaInicio,
            horaFin: turno.horaFin,
            cupo: turno.cupo,
            profesorId: turno.profesorId,
          },
        });

        idPorFranja.set(franjaDe(turno.fecha, turno.horaInicio), creado.id);
      }

      // 3. Las reservas. El turno se resuelve por sala + fecha + hora, NUNCA por
      //    indice: el plan puede referirse a turnos que ya existian en la base.
      let reservasCreadas = 0;

      for (const reserva of plan.reservasACrear) {
        const franja = franjaDe(reserva.fecha, reserva.horaInicio);
        let turnoId = idPorFranja.get(franja);

        if (!turnoId) {
          const existente = await cliente.turno.findFirst({
            where: {
              salaId: reserva.salaId,
              fecha: desdeFechaISO(reserva.fecha),
              horaInicio: reserva.horaInicio,
            },
          });

          if (!existente) {
            this.logger.warn(`Sin turno para ${franja}; se omite la reserva`);
            continue;
          }

          turnoId = existente.id;
          idPorFranja.set(franja, turnoId);
        }

        try {
          await cliente.reserva.create({
            data: {
              tenantId: actor.tenantId,
              turnoId,
              perfilId: reserva.perfilId,
              origen: 'RUTINA',
            },
          });
          reservasCreadas += 1;
        } catch (error) {
          // El indice unico parcial sobre reservas activas es la red de debajo de
          // la idempotencia. Que dispare significa que la reserva YA ESTABA, no
          // que algo fallara: se sigue con el resto del mes.
          //
          // Solo el duplicado se ignora. Tragarse cualquier error convertiria la
          // idempotencia en perdida silenciosa de datos.
          if (!esDuplicado(error)) throw error;
          this.logger.log(`Reserva ya existente en ${franja} para ${reserva.perfilId}`);
        }
      }

      // 4. Las etiquetas de profesora sobre turnos que ya existian.
      //
      // El `profesorId: null` del where es una segunda red: el plan ya solo trae
      // huecos, pero entre planificar y aplicar puede haber pasado un rato, y en
      // ese rato el admin puede haber puesto una suplencia a mano. Con la
      // condicion, la escritura simplemente no afecta a ninguna fila.
      let etiquetadas = 0;

      for (const etiqueta of plan.etiquetasDeProfesor) {
        const { count } = await cliente.turno.updateMany({
          where: { id: etiqueta.turnoId, profesorId: null },
          data: { profesorId: etiqueta.profesorId },
        });
        etiquetadas += count;
      }

      const resumen: ResumenDelPlan = {
        turnos: plan.turnosACrear.length,
        reservas: reservasCreadas,
        conflictos: plan.conflictos.length,
        exclusiones: plan.exclusiones.length,
      };

      const fila = await cliente.mesCalendario.findFirst({ where: { salaId, anio, mes } });

      await this.historial.registrar(
        {
          actor,
          entidad: 'MesCalendario',
          entidadId: fila?.id ?? `${salaId}-${anio}-${mes}`,
          accion: 'PUBLICADA',
          // `etiquetadas` va aqui y no en el resumen: anadir un contador al
          // contrato de ResumenDelPlan cambiaria la respuesta de publicar y
          // obligaria a retocar e2e de la Fase 2 que no tienen nada que ver.
          detalle: { salaId, anio, mes, ...resumen, etiquetadas },
        },
        cliente,
      );

      return resumen;
    });
  }
}
