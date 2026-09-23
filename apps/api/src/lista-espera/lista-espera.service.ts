import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { EntradaListaEspera, JwtPayload } from '@boxadmin/shared';
import { HistorialService } from '../common/historial/historial.service';
import { DisponibilidadService } from '../disponibilidad/disponibilidad.service';
import { PrismaService, type ClientePrismaTx } from '../prisma/prisma.service';

/**
 * El cupo que se acaba de repartir, para que quien llamo pueda AVISAR.
 *
 * Se devuelve en vez de notificarse aqui dentro a proposito: `asignarPrimero`
 * corre dentro de la transaccion Serializable de la cancelacion que libero el
 * lugar, y esa transaccion puede abortar por conflicto (40001) y reintentarse
 * entera. Encolar aqui dejaria el job vivo en Redis —que no participa del
 * rollback de Postgres— y el reintento encolaria otro. La asignacion SI se
 * queda dentro, por el motivo que dice su propio comentario; lo que sale fuera
 * es solo el aviso.
 */
export interface CupoRepartido {
  reservaId: string;
  perfilId: string;
  turnoId: string;
  /** La entrada de la cola de la que salio, ya borrada de la tabla. */
  entradaId: string;
}

@Injectable()
export class ListaEsperaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly disponibilidad: DisponibilidadService,
    private readonly historial: HistorialService,
  ) {}

  /**
   * Anotarse solo es posible cuando el turno esta en LISTA_ESPERA. Delegar la
   * decision en DisponibilidadService en vez de repetir las reglas aqui es lo
   * que evita que "cuando se puede hacer cola" acabe definido en dos sitios que
   * se separan con el tiempo.
   */
  async anotarse(actor: JwtPayload, turnoId: string): Promise<EntradaListaEspera> {
    const perfil = await this.perfilDelActor(actor);

    const estado = await this.disponibilidad.paraTurno(actor, perfil.id, turnoId);

    if (estado.motivo === 'SIN_ACCESO_A_SALA' || estado.motivo === 'SALA_NO_VISIBLE') {
      throw new ForbiddenException('No tienes acceso a la sala de este turno');
    }
    if (estado.motivo === 'MES_NO_PUBLICADO') {
      throw new ConflictException('El mes de este turno todavia no esta publicado');
    }
    if (estado.enListaEspera) {
      throw new ConflictException(
        `Ya estas en la lista de espera de este turno, en la posicion ${estado.posicionEnLista}`,
      );
    }
    if (estado.estado === 'LIBRE') {
      throw new ConflictException('Este turno tiene cupo: reservalo en vez de hacer cola');
    }
    if (estado.estado !== 'LISTA_ESPERA') {
      throw new ConflictException('Este turno no admite lista de espera. Hablalo con el salon.');
    }

    const entrada = await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      const creada = await cliente.listaEspera.create({
        data: { tenantId: actor.tenantId, turnoId, perfilId: perfil.id },
      });

      await this.historial.registrar(
        {
          actor,
          entidad: 'ListaEspera',
          entidadId: creada.id,
          accion: 'ANOTADO',
          detalle: { turnoId, perfilId: perfil.id },
        },
        cliente,
      );

      return creada;
    });

    return {
      id: entrada.id,
      tenantId: entrada.tenantId,
      turnoId: entrada.turnoId,
      perfilId: entrada.perfilId,
      posicion: await this.posicionDe(turnoId, perfil.id),
      // `entrada.notificado` NO se expone: valdria siempre false. Ver el
      // comentario que dejo su hueco en `EntradaListaEspera`.
      createdAt: entrada.createdAt.toISOString(),
    };
  }

  async salirse(actor: JwtPayload, id: string): Promise<void> {
    const perfil = await this.perfilDelActor(actor);

    await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      const entrada = await cliente.listaEspera.findFirst({ where: { id } });
      if (!entrada) throw new NotFoundException('No estas en esa lista de espera');
      // 403 y no 404 a proposito, igual que en UsuariosService.obtener: el actor
      // sabe que el recurso existe porque acaba de pasar su id.
      if (entrada.perfilId !== perfil.id) {
        throw new ForbiddenException('Solo puedes salirte de tu propia lista de espera');
      }

      await cliente.listaEspera.deleteMany({ where: { id } });

      await this.historial.registrar(
        {
          actor,
          entidad: 'ListaEspera',
          entidadId: id,
          accion: 'SALIDO',
          detalle: { turnoId: entrada.turnoId },
        },
        cliente,
      );
    });
  }

  /**
   * Da el cupo recien liberado al primero de la cola.
   *
   * Se llama DENTRO de la transaccion que cancela la reserva, y recibe su
   * `cliente`: la asignacion tiene que revertirse con la cancelacion que la
   * origino. Si se hiciera fuera, una cancelacion que fallara despues dejaria
   * una reserva de la cola que nadie pidio.
   *
   * NO re-valida el pack ni la ventana del beneficiario. El lugar es suyo por
   * posicion en la cola; las validaciones son del momento de anotarse. Si la
   * reserva lo pasa de su pack, es la misma situacion que cualquier otra reserva
   * por encima del tope: se avisa, no se bloquea (decision D3 de la Fase 1).
   */
  async asignarPrimero(
    actor: JwtPayload,
    turnoId: string,
    cliente: ClientePrismaTx,
  ): Promise<CupoRepartido | null> {
    const cola = await cliente.listaEspera.findMany({
      where: { turnoId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    for (const entrada of cola) {
      // Alguien puede haber entrado por otra via mientras hacia cola (un admin
      // se lo asigno a mano, por ejemplo). Su fila se limpia igual, porque ya no
      // pinta nada ahi, y el cupo pasa al siguiente.
      const yaDentro = await cliente.reserva.findFirst({
        where: { turnoId, perfilId: entrada.perfilId, canceladaEn: null },
      });

      await cliente.listaEspera.deleteMany({ where: { id: entrada.id } });

      if (yaDentro) continue;

      const reserva = await cliente.reserva.create({
        data: {
          tenantId: actor.tenantId,
          turnoId,
          perfilId: entrada.perfilId,
          origen: 'LISTA_ESPERA',
        },
      });

      await this.historial.registrar(
        {
          actor,
          entidad: 'Reserva',
          entidadId: reserva.id,
          accion: 'ASIGNADA_DESDE_LISTA',
          // El origen queda registrado para que el alumno pueda entender
          // despues por que aparecio una clase que no reservo.
          detalle: { turnoId, perfilId: entrada.perfilId, desdeListaEspera: entrada.id },
        },
        cliente,
      );

      // NO se notifica aqui: se DEVUELVE lo que hay que notificar. Ver el
      // comentario de CupoRepartido. `entradaId` viaja porque el processor lo
      // necesita para marcar la entrada sin volver a adivinar cual era.
      return {
        reservaId: reserva.id,
        perfilId: entrada.perfilId,
        turnoId,
        entradaId: entrada.id,
      };
    }

    return null;
  }

  private async perfilDelActor(actor: JwtPayload): Promise<{ id: string }> {
    const perfil = await this.prisma.db.perfil.findFirst({
      where: { usuarioId: actor.sub },
      select: { id: true },
    });
    if (!perfil) throw new NotFoundException('Este usuario no tiene perfil de alumno');

    return perfil;
  }

  /** La posicion se deriva del orden: 1 = el proximo en entrar. */
  private async posicionDe(turnoId: string, perfilId: string): Promise<number> {
    const cola = await this.prisma.db.listaEspera.findMany({
      where: { turnoId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    return cola.findIndex((fila) => fila.perfilId === perfilId) + 1;
  }
}
