import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  aFechaISO,
  comienzoDeHoyUtc,
  type CheckInRechazado,
  type JwtPayload,
  type PresenteMarcado,
} from '@boxadmin/shared';
import { PrismaService, type ClientePrismaTx } from '../prisma/prisma.service';
import { ConfigCheckInService } from './config-checkin.service';
import { elegirReserva, type CandidataDeCheckIn } from './eleccion-de-reserva';
import { verificarFirma } from './firma-qr';

/**
 * Lo que el controller saca del request y el service recibe como argumento.
 *
 * LA IP Y EL USER-AGENT SON DATOS DEL REQUEST, NO DEL DOMINIO. Llegan asi, ya
 * extraidos, para que el service no conozca `Request`: es lo que permite
 * probarlo entero sin montar HTTP.
 */
export interface RastroDelDispositivo {
  ip: string | null;
  dispositivo: string | null;
}

/**
 * Tope del `User-Agent` que se guarda.
 *
 * Es texto que elige el cliente y la columna no tiene limite: sin esto, cada
 * check-in puede escribir en la base tanto como quepa en una cabecera HTTP. Se
 * guarda para poder mirar "desde que aparato se marco", y para eso 512
 * caracteres sobran —los User-Agent reales andan por los 120—.
 */
const MAXIMO_DISPOSITIVO = 512;

const UN_DIA_MS = 24 * 60 * 60 * 1000;

/**
 * El 409, con el cuerpo TIPADO contra el contrato compartido.
 *
 * `new ConflictException({ ... })` acepta cualquier objeto, asi que un motivo
 * mal escrito aqui compilaria y la pantalla de check-in caeria en su rama por
 * defecto sin que nada avisara. Pasando por `CheckInRechazado` las dos listas
 * —la de la API y la de la PWA— son la misma lista y tsc las compara.
 */
function rechazo(cuerpo: CheckInRechazado): ConflictException {
  return new ConflictException(cuerpo);
}

/** Fila de reserva tal como la devuelve el `select` de `candidatas`. */
interface FilaCandidata {
  id: string;
  turnoId: string;
  asistio: boolean | null;
  turno: { nombre: string; fecha: Date; horaInicio: string };
  asistencia: { id: string } | null;
}

/**
 * El codigo del indice unico violado, visto por los dos caminos por los que
 * Prisma 7 lo entrega.
 *
 * Con el adapter `pg` algunos errores no llegan con `code`: el adapter los
 * traduce a `{ kind }` y los envuelve en un DriverAdapterError. Mirar solo
 * `code` dejaria la red de seguridad sin dispararse, que es exactamente lo que
 * paso con el reintento de serializacion en la Fase 1 (ver `serializable.ts`).
 */
function esUnicidadViolada(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;

  if ((error as { code?: unknown }).code === 'P2002') return true;

  const { name, cause } = error as { name?: unknown; cause?: unknown };
  if (name !== 'DriverAdapterError' || typeof cause !== 'object' || cause === null) return false;

  return (cause as { kind?: unknown }).kind === 'UniqueConstraintViolation';
}

@Injectable()
export class CheckinService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configCheckIn: ConfigCheckInService,
    private readonly config: ConfigService,
  ) {}

  /**
   * El alumno marca presente escaneando el QR de la pared.
   *
   * `ahora` es inyectable para los tests; en produccion es el reloj.
   */
  async marcarPresente(
    actor: JwtPayload,
    firma: string,
    rastro: RastroDelDispositivo,
    ahora: Date = new Date(),
  ): Promise<PresenteMarcado> {
    this.exigirFirmaDeEsteGimnasio(actor.tenantId, firma);

    const perfil = await this.perfilDelActor(actor);
    const config = await this.configCheckIn.ver();
    const zona = this.config.getOrThrow<string>('ZONA_HORARIA');

    const candidatas = await this.candidatas(perfil.id, ahora);
    const resultado = elegirReserva(candidatas, ahora, config, zona);

    switch (resultado.tipo) {
      case 'sin-reserva':
        throw rechazo({
          motivo: 'sin-reserva',
          message: 'No tenes ninguna reserva para marcar ahora mismo.',
        });

      case 'fuera-de-ventana': {
        const { masCercana } = resultado;
        // Se le dice CUAL era y a que hora. Son sus propios datos, asi que no
        // filtra nada, y es la diferencia entre que resuelva solo o llame a
        // recepcion.
        throw rechazo({
          motivo: 'fuera-de-ventana',
          message:
            `Todavia no se puede marcar: tu clase mas cercana es ${masCercana.clase} ` +
            `a las ${masCercana.horaInicio}.`,
          clase: masCercana.clase,
          fecha: aFechaISO(masCercana.fecha),
          horaInicio: masCercana.horaInicio,
        });
      }

      case 'ya-marcada':
        throw this.yaEstabaMarcada(resultado.candidata);

      case 'lista-ya-pasada': {
        const { candidata } = resultado;
        // NO se reusa `ya-marcada`. Esta persona no marco nada: la profesora
        // paso lista. Decirle "ya marcaste" la manda a buscar un problema que
        // no existe; lo que tiene que hacer es hablar con quien si puede
        // corregir el parte.
        throw rechazo({
          motivo: 'lista-ya-pasada',
          message:
            `En ${candidata.clase} de las ${candidata.horaInicio} ya se paso lista, ` +
            'asi que el check-in esta cerrado. Si no quedo bien, hablalo con tu profesora.',
          clase: candidata.clase,
          fecha: aFechaISO(candidata.fecha),
          horaInicio: candidata.horaInicio,
        });
      }

      case 'elegida':
        return await this.escribir(actor, resultado.candidata, rastro);
    }
  }

  /**
   * La firma del QR tiene que ser la de ESTE gimnasio.
   *
   * 404 Y NO 403, deliberadamente. Un 403 diria "la firma es buena, pero no es
   * tuya", o sea confirmaria que el gimnasio de esa firma existe. Con un 404
   * la firma de otro gimnasio, la inventada y la caducada son la misma
   * respuesta y no hay nada que enumerar.
   *
   * Va ANTES de tocar la base: una firma ajena no debe ni provocar una query.
   */
  private exigirFirmaDeEsteGimnasio(tenantId: string, firma: string): void {
    const clave = this.config.getOrThrow<string>('APP_ENCRYPTION_KEY');

    if (!verificarFirma(tenantId, firma, clave)) {
      throw new NotFoundException('Ese codigo QR no es de este gimnasio');
    }
  }

  /**
   * El perfil del actor. Como en `/mi-calendario` desde la Fase 3A: la ruta
   * opera sobre SU perfil, nunca sobre un perfilId del cuerpo.
   */
  private async perfilDelActor(actor: JwtPayload): Promise<{ id: string }> {
    const perfil = await this.prisma.db.perfil.findFirst({
      where: { usuarioId: actor.sub },
      select: { id: true },
    });
    if (perfil === null) {
      throw new NotFoundException(
        'Este usuario no tiene perfil de alumno, asi que no tiene reservas que marcar.',
      );
    }

    return perfil;
  }

  /**
   * Las reservas vivas del alumno que podrian ser la que esta marcando.
   *
   * SE CARGAN TRES DIAS UTC (ayer, hoy y mañana) Y NO "EL DIA DE HOY", y no es
   * exceso de celo: `Turno.fecha` es una columna `@db.Date` en UTC, pero la
   * ventana se calcula en el reloj del gimnasio. En Argentina una clase de las
   * 23:00 del 5 de octubre empieza a las 02:00 UTC del 6: a esa hora "hoy en
   * UTC" ya es el 6 y la reserva, fechada el 5, no aparecia. En una zona al
   * este de Greenwich pasa lo simetrico con las clases de la mañana. Filtrar
   * por el dia UTC seria repetir, en la consulta, el mismo error de huso que
   * esta fase existe para arreglar.
   *
   * No hay coste: un alumno tiene unas pocas reservas en tres dias, y quien
   * decide cual entra en la ventana es `elegirReserva`, que si conoce la zona.
   */
  private async candidatas(perfilId: string, ahora: Date): Promise<CandidataDeCheckIn[]> {
    const hoy = comienzoDeHoyUtc(ahora).getTime();

    const reservas = await this.prisma.db.reserva.findMany({
      where: {
        perfilId,
        canceladaEn: null,
        turno: { fecha: { gte: new Date(hoy - UN_DIA_MS), lte: new Date(hoy + UN_DIA_MS) } },
      },
      select: {
        id: true,
        turnoId: true,
        // La unica verdad sobre si vino. Si ya no es null, alguien paso lista.
        asistio: true,
        turno: { select: { nombre: true, fecha: true, horaInicio: true } },
        // La evidencia del check-in. Si existe, ya paso por aqui.
        asistencia: { select: { id: true } },
      },
    });

    return (reservas as unknown as FilaCandidata[]).map((reserva) => ({
      reservaId: reserva.id,
      turnoId: reserva.turnoId,
      fecha: reserva.turno.fecha,
      horaInicio: reserva.turno.horaInicio,
      // `Turno.nombre`: "clase" es como se le dice de cara al alumno.
      clase: reserva.turno.nombre,
      // `yaMarcada` mira la fila de Asistencia: solo existe si se marco por
      // aqui, y es la misma condicion que impone el @@unique([tenantId,
      // reservaId]) de la base.
      yaMarcada: reserva.asistencia !== null,
      // `listaPasada` mira `Reserva.asistio`, que es otra cosa: lo escribe
      // tambien la profesora al pasar lista, sin dejar fila de Asistencia. Van
      // separados porque los dos bloquean el check-in pero con mensajes
      // distintos, y porque fusionarlos le diria "ya marcaste" a alguien que
      // no marco.
      listaPasada: reserva.asistio !== null,
    }));
  }

  /**
   * `Reserva.asistio` y la fila de `Asistencia`, EN LA MISMA TRANSACCION.
   *
   * `asistio` es la unica verdad sobre si vino; `Asistencia` es la evidencia de
   * como se marco. Escribir una sin la otra deja el sistema mintiendo en uno de
   * los dos sentidos: un presente sin rastro, o un rastro de un presente que no
   * figura.
   */
  private async escribir(
    actor: JwtPayload,
    candidata: CandidataDeCheckIn,
    rastro: RastroDelDispositivo,
  ): Promise<PresenteMarcado> {
    try {
      const asistencia = await this.prisma.db.$transaction(async (tx) => {
        const cliente = tx as ClientePrismaTx;

        await cliente.reserva.update({
          where: { id: candidata.reservaId },
          data: { asistio: true },
        });

        return await cliente.asistencia.create({
          data: {
            // La extension lo inyecta, pero el tipo generado lo exige bajo
            // strict. Mismo caso que HistorialService.registrar.
            tenantId: actor.tenantId,
            reservaId: candidata.reservaId,
            origen: 'QR',
            ip: rastro.ip,
            dispositivo: rastro.dispositivo?.slice(0, MAXIMO_DISPOSITIVO) ?? null,
          },
          select: { marcadaEn: true },
        });
      });

      return {
        reservaId: candidata.reservaId,
        turnoId: candidata.turnoId,
        fecha: aFechaISO(candidata.fecha),
        horaInicio: candidata.horaInicio,
        clase: candidata.clase,
        marcadaEn: asistencia.marcadaEn.toISOString(),
      };
    } catch (error) {
      // LA RED DEL PASO DE COMPROBACION. Entre mirar `yaMarcada` y escribir hay
      // una ventana: dos escaneos simultaneos pasan los dos la comprobacion y
      // uno choca contra el @@unique([tenantId, reservaId]). El usuario no
      // tiene por que ver la diferencia, asi que recibe el mismo 409 que por el
      // camino normal.
      if (esUnicidadViolada(error)) throw this.yaEstabaMarcada(candidata);

      throw error;
    }
  }

  /** El 409 de "ya estabas marcado", identico venga de donde venga. */
  private yaEstabaMarcada(candidata: CandidataDeCheckIn): ConflictException {
    return rechazo({
      motivo: 'ya-marcada',
      message: `Ya habias marcado presente en ${candidata.clase} de las ${candidata.horaInicio}.`,
      clase: candidata.clase,
      fecha: aFechaISO(candidata.fecha),
      horaInicio: candidata.horaInicio,
    });
  }
}
