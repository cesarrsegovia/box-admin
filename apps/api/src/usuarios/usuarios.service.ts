import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import type { Pack, Perfil, Sala, Usuario } from '@prisma/client';
import {
  desdeFechaISO,
  rolAlcanza,
  type Advertencia,
  type AltaUsuarioRespuesta,
  type JwtPayload,
  type ResetPasswordRespuesta,
  type RolUsuario,
  type TipoUsuarioNegocio,
  type UsuarioDetalle,
  type UsuarioResumen,
} from '@boxadmin/shared';
import { HistorialService } from '../common/historial/historial.service';
import { PrismaService, type ClientePrismaTx } from '../prisma/prisma.service';
import type { ActualizarSalasDto } from './dto/actualizar-salas.dto';
import type { ActualizarUsuarioDto } from './dto/actualizar-usuario.dto';
import type { CrearAlumnoDto } from './dto/crear-alumno.dto';
import type { CrearProfesorDto } from './dto/crear-profesor.dto';
import { generarPasswordTemporal } from './password-temporal';
import {
  aUsuarioDetalle,
  aUsuarioResumen,
  aplanar,
  type UsuarioConPerfil,
  type UsuarioConRelaciones,
} from './usuarios.mapper';

export interface FiltroUsuarios {
  tipo?: TipoUsuarioNegocio;
  salaId?: string;
  activo?: boolean;
  /** Altas entradas por auto-registro, pendientes de revision del admin. */
  autoRegistrado?: boolean;
}

/** Campos que solo tienen sentido en un alumno. */
const CAMPOS_DE_ALUMNO = [
  'packId',
  'pagoAlDia',
  'clasesExtra',
  'cancelacionesUsadas',
  'vigenciaDesde',
  'vigenciaHasta',
] as const;

const RELACIONES = {
  perfil: { include: { pack: true, salas: { include: { sala: true } } } },
} as const;

/** Datos que solo tiene un alumno. Un profesor entra con esto en `undefined`. */
interface DatosDeAlumno {
  packId?: string;
  pagoAlDia?: boolean;
  clasesExtra?: number;
  vigenciaDesde?: string;
  vigenciaHasta?: string;
}

@Injectable()
export class UsuariosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly historial: HistorialService,
  ) {}

  crearAlumno(actor: JwtPayload, dto: CrearAlumnoDto): Promise<AltaUsuarioRespuesta> {
    return this.crear(actor, 'ALUMNO', dto, {
      packId: dto.packId,
      pagoAlDia: dto.pagoAlDia,
      clasesExtra: dto.clasesExtra,
      vigenciaDesde: dto.vigenciaDesde,
      vigenciaHasta: dto.vigenciaHasta,
    });
  }

  crearProfesor(actor: JwtPayload, dto: CrearProfesorDto): Promise<AltaUsuarioRespuesta> {
    // Sin datos de alumno. No es que se ignoren: el DTO ni los acepta.
    return this.crear(actor, 'PROFESOR', dto, undefined);
  }

  async listar(actor: JwtPayload, filtro: FiltroUsuarios): Promise<UsuarioResumen[]> {
    const where: Record<string, unknown> = {
      // Sin tipo se listan alumnos y profesores, nunca administradores: este
      // endpoint es "Administrar Usuarios" del salon, no la gestion de cuentas
      // del sistema.
      rol:
        filtro.tipo === undefined
          ? { in: ['ALUMNO', 'PROFESOR'] }
          : filtro.tipo === 'alumno'
            ? 'ALUMNO'
            : 'PROFESOR',
    };

    if (filtro.activo !== undefined) where.activo = filtro.activo;

    // Los dos filtros que tocan el perfil se combinan en un solo objeto en vez
    // de pisarse el uno al otro. `autoRegistrado` vive en Perfil y no en
    // Usuario, asi que el filtro va por la relacion: un
    // `where: { autoRegistrado }` a secas ni siquiera compilaria contra el tipo
    // generado de Prisma.
    const filtroDePerfil: Record<string, unknown> = {};
    if (filtro.autoRegistrado !== undefined) {
      filtroDePerfil.autoRegistrado = filtro.autoRegistrado;
    }
    if (filtro.salaId) {
      filtroDePerfil.salas = { some: { salaId: filtro.salaId } };
    }
    if (Object.keys(filtroDePerfil).length > 0) {
      where.perfil = filtroDePerfil;
    }

    const filas = await this.prisma.db.usuario.findMany({
      where,
      include: RELACIONES,
      orderBy: { nombreCompleto: 'asc' },
    });

    return filas
      .map((fila) => aplanar(fila as UsuarioConRelaciones))
      .filter((datos): datos is NonNullable<typeof datos> => datos !== null)
      .map(aUsuarioResumen);
  }

  async obtener(actor: JwtPayload, id: string): Promise<UsuarioDetalle> {
    const esPersonal = rolAlcanza(actor.rol, 'ADMIN_OPERATIVO');
    // Un alumno solo puede pedir su propio detalle. 403 y no 404 a proposito:
    // aqui no hay nada que ocultar, el actor sabe perfectamente que el recurso
    // existe porque le acaba de pasar un id.
    if (!esPersonal && actor.sub !== id) {
      throw new ForbiddenException('Solo puedes consultar tu propio perfil');
    }

    const datos = await this.buscarConRelaciones(id);

    // La ficha medica es un dato de salud: la ven ADMIN_SALON y su dueno. Un
    // ADMIN_OPERATIVO gestiona turnos y reservas, no necesita el historial
    // clinico de nadie.
    const puedeVerFicha = rolAlcanza(actor.rol, 'ADMIN_SALON') || actor.sub === id;

    return aUsuarioDetalle(datos, puedeVerFicha);
  }

  async actualizar(
    actor: JwtPayload,
    id: string,
    dto: ActualizarUsuarioDto,
  ): Promise<UsuarioDetalle> {
    const datos = await this.buscarConRelaciones(id);

    if (datos.usuario.rol === 'PROFESOR') {
      const invalidos = CAMPOS_DE_ALUMNO.filter((campo) => dto[campo] !== undefined);
      if (invalidos.length > 0) {
        throw new BadRequestException(
          `Un profesor no tiene ${invalidos.join(', ')}. Esos campos son de alumno.`,
        );
      }
    }

    if (dto.packId) await this.resolverPack(dto.packId);

    await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      if (dto.nombreCompleto !== undefined) {
        await cliente.usuario.update({
          where: { id },
          data: { nombreCompleto: dto.nombreCompleto },
        });
      }

      await cliente.perfil.update({
        where: { id: datos.perfil.id },
        data: {
          telefono: dto.telefono,
          fichaMedica: dto.fichaMedica,
          packId: dto.packId,
          pagoAlDia: dto.pagoAlDia,
          clasesExtra: dto.clasesExtra,
          cancelacionesUsadas: dto.cancelacionesUsadas,
          vigenciaDesde: dto.vigenciaDesde ? desdeFechaISO(dto.vigenciaDesde) : undefined,
          vigenciaHasta: dto.vigenciaHasta ? desdeFechaISO(dto.vigenciaHasta) : undefined,
        },
      });

      await this.historial.registrar(
        { actor, entidad: 'Usuario', entidadId: id, accion: 'ACTUALIZADA', detalle: { ...dto } },
        cliente,
      );
    });

    return aUsuarioDetalle(await this.buscarConRelaciones(id), true);
  }

  async actualizarSalas(
    actor: JwtPayload,
    id: string,
    dto: ActualizarSalasDto,
  ): Promise<UsuarioDetalle> {
    // Doble cinturon: el DTO ya lleva @ArrayNotEmpty, pero el service tambien lo
    // comprueba para que la regla siga viva si alguien llama al servicio desde
    // otro sitio (un job, un seed) sin pasar por el ValidationPipe.
    if (dto.salaIds.length === 0) {
      throw new BadRequestException(
        'Un usuario sin salas no puede reservar nada. Manda al menos una sala.',
      );
    }

    const datos = await this.buscarConRelaciones(id);
    const salas = await this.resolverSalas(dto.salaIds);

    await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      // Reemplazo completo, no merge: el cliente manda el conjunto final.
      await cliente.usuarioSala.deleteMany({ where: { perfilId: datos.perfil.id } });
      await cliente.usuarioSala.createMany({
        data: salas.map((sala) => ({
          tenantId: actor.tenantId,
          perfilId: datos.perfil.id,
          salaId: sala.id,
        })),
      });

      await this.historial.registrar(
        {
          actor,
          entidad: 'Usuario',
          entidadId: id,
          accion: 'SALAS_ACTUALIZADAS',
          detalle: {
            antes: datos.salas.map((sala) => sala.id),
            despues: salas.map((sala) => sala.id),
          },
        },
        cliente,
      );
    });

    return aUsuarioDetalle(await this.buscarConRelaciones(id), true);
  }

  async resetearPassword(actor: JwtPayload, id: string): Promise<ResetPasswordRespuesta> {
    await this.buscarConRelaciones(id);

    const passwordTemporal = generarPasswordTemporal();
    const passwordHash = await argon2.hash(passwordTemporal, { type: argon2.argon2id });

    await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;
      await cliente.usuario.update({ where: { id }, data: { passwordHash } });
      await this.historial.registrar(
        { actor, entidad: 'Usuario', entidadId: id, accion: 'PASSWORD_RESETEADA' },
        cliente,
      );
    });

    return { usuarioId: id, passwordTemporal };
  }

  async darDeBaja(actor: JwtPayload, id: string): Promise<UsuarioDetalle> {
    await this.buscarConRelaciones(id);

    await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;
      // Baja logica. Las reservas futuras NO se cancelan aqui: eso es una
      // decision de negocio que el admin debe tomar a mano, y cancelarlas en
      // silencio borraria lugares que quiza queria conservar.
      await cliente.usuario.update({ where: { id }, data: { activo: false } });
      await this.historial.registrar(
        { actor, entidad: 'Usuario', entidadId: id, accion: 'DADA_DE_BAJA' },
        cliente,
      );
    });

    return aUsuarioDetalle(await this.buscarConRelaciones(id), true);
  }

  private async crear(
    actor: JwtPayload,
    rol: Extract<RolUsuario, 'ALUMNO' | 'PROFESOR'>,
    base: {
      nombreCompleto: string;
      email: string;
      telefono?: string;
      fichaMedica?: string;
      salaIds: string[];
    },
    alumno: DatosDeAlumno | undefined,
  ): Promise<AltaUsuarioRespuesta> {
    const email = base.email.toLowerCase();

    // findFirst y no findUnique: dentro de un contexto de tenant, findUnique
    // lanza UnsafeUniqueOperationError porque su where solo admite campos
    // unicos y la extension no puede inyectarle el tenantId. El filtro por
    // gimnasio lo pone ella sola sobre este findFirst.
    const yaExiste = await this.prisma.db.usuario.findFirst({ where: { email } });
    if (yaExiste) {
      throw new ConflictException('Ya hay un usuario con ese email en este gimnasio');
    }

    const salas = await this.resolverSalas(base.salaIds);
    const pack = alumno?.packId ? await this.resolverPack(alumno.packId) : null;

    // El hash se calcula FUERA de la transaccion: argon2id tarda ~40 ms a
    // proposito, y mantener una transaccion abierta ese tiempo por cada alta
    // castiga a todo el que este esperando una fila.
    const passwordTemporal = generarPasswordTemporal();
    const passwordHash = await argon2.hash(passwordTemporal, { type: argon2.argon2id });

    const creado = await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      const usuario = await cliente.usuario.create({
        data: {
          tenantId: actor.tenantId,
          nombreCompleto: base.nombreCompleto,
          email,
          passwordHash,
          rol,
        },
      });

      const perfil = await cliente.perfil.create({
        data: {
          tenantId: actor.tenantId,
          usuarioId: usuario.id,
          telefono: base.telefono ?? null,
          fichaMedica: base.fichaMedica ?? null,
          packId: alumno?.packId ?? null,
          pagoAlDia: alumno?.pagoAlDia ?? false,
          clasesExtra: alumno?.clasesExtra ?? 0,
          vigenciaDesde: alumno?.vigenciaDesde ? desdeFechaISO(alumno.vigenciaDesde) : null,
          vigenciaHasta: alumno?.vigenciaHasta ? desdeFechaISO(alumno.vigenciaHasta) : null,
        },
      });

      if (salas.length > 0) {
        await cliente.usuarioSala.createMany({
          data: salas.map((sala) => ({
            tenantId: actor.tenantId,
            perfilId: perfil.id,
            salaId: sala.id,
          })),
        });
      }

      await this.historial.registrar(
        {
          actor,
          entidad: 'Usuario',
          entidadId: usuario.id,
          accion: 'CREADA',
          detalle: { rol, email, salaIds: salas.map((s) => s.id) },
        },
        cliente,
      );

      return { usuario, perfil };
    });

    const datos: UsuarioConPerfil = { ...creado, salas, pack };

    return {
      ...aUsuarioDetalle(datos, true),
      passwordTemporal,
      advertencias: this.advertenciasDeAlta(rol, salas, pack),
    };
  }

  /**
   * Advertencias que no bloquean el alta pero que el admin tiene que ver.
   *
   * Guardar en silencio un alumno sin salas es el bug de "Sin sala" de
   * Wellness: el alta parecia funcionar y el alumno no podia reservar nada.
   */
  private advertenciasDeAlta(rol: RolUsuario, salas: Sala[], pack: Pack | null): Advertencia[] {
    const advertencias: Advertencia[] = [];

    if (salas.length === 0) {
      advertencias.push({
        codigo: 'SIN_SALAS',
        mensaje:
          'El usuario no tiene ninguna sala con acceso, asi que no podra reservar. ' +
          'Asignale salas con PATCH /usuarios/:id/salas.',
      });
    }

    if (rol === 'ALUMNO' && pack === null) {
      advertencias.push({
        codigo: 'SIN_PACK',
        mensaje: 'El alumno no tiene pack asignado; sus clases no tendran tope definido.',
      });
    }

    return advertencias;
  }

  /** Comprueba que todas las salas pedidas existen en este gimnasio. */
  private async resolverSalas(
    salaIds: string[],
    cliente: ClientePrismaTx = this.prisma.db,
  ): Promise<Sala[]> {
    if (salaIds.length === 0) return [];

    const salas = await cliente.sala.findMany({ where: { id: { in: salaIds } } });

    if (salas.length !== salaIds.length) {
      const encontradas = new Set(salas.map((sala) => sala.id));
      const faltan = salaIds.filter((id) => !encontradas.has(id));
      // 400 y no 404: el problema esta en el cuerpo de la peticion, y decir
      // cuales fallan ahorra una ronda de depuracion. Las salas de otro
      // gimnasio caen aqui tambien, porque la extension ya las filtro.
      throw new BadRequestException(`Salas inexistentes en este gimnasio: ${faltan.join(', ')}`);
    }

    return salas;
  }

  /** Carga usuario + perfil + salas + pack, o lanza 404. */
  private async buscarConRelaciones(
    id: string,
    cliente: ClientePrismaTx = this.prisma.db,
  ): Promise<UsuarioConPerfil> {
    const fila = await cliente.usuario.findFirst({ where: { id }, include: RELACIONES });
    if (!fila) throw new NotFoundException('Usuario inexistente');

    const datos = aplanar(fila as UsuarioConRelaciones);
    if (!datos) throw new NotFoundException('El usuario no tiene perfil de negocio');

    return datos;
  }

  private async resolverPack(
    packId: string,
    cliente: ClientePrismaTx = this.prisma.db,
  ): Promise<Pack> {
    const pack = await cliente.pack.findFirst({ where: { id: packId } });
    if (!pack) throw new NotFoundException('Pack inexistente');
    return pack;
  }
}
