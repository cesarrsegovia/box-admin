import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type {
  JwtPayload,
  LoginRespuesta,
  MeRespuesta,
  TenantPublico,
  TokensRespuesta,
  UsuarioPublico,
} from '@boxadmin/shared';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import {
  conReintentoSerializable,
  esConflictoDeSerializacion,
} from '../common/prisma/serializable';
import { runUnscoped, runWithTenant } from '../common/tenant/tenant-context';
import { PrismaService, type ClientePrismaTx } from '../prisma/prisma.service';
import type { AutoRegistroDto } from './dto/auto-registro.dto';
import type { CreateTenantDto } from './dto/create-tenant.dto';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';

/** Mismo mensaje para email inexistente y password incorrecta: no filtra que emails estan dados de alta. */
const CREDENCIALES_INVALIDAS = 'Credenciales invalidas';

/**
 * Mismo mensaje para las cuatro formas de clave no utilizable —inexistente,
 * desactivada, caducada y agotada—. Un endpoint publico no tiene por que
 * decirle a quien prueba codigos cual de las cuatro acerto.
 */
const CLAVE_INVALIDA = 'Clave de invitacion invalida';

interface RefreshPayload {
  sub: string;
  jti: string;
}

@Injectable()
export class AuthService {
  /**
   * Hash señuelo argon2id, generado perezosamente la primera vez que hace
   * falta y reutilizado despues. Sirve para que la rama "no hay usuario
   * utilizable" del login cueste lo mismo que la rama "password incorrecta":
   * ambas terminan haciendo un argon2.verify sobre un hash con los mismos
   * parametros. La contraseña que protege es un randomUUID() de un solo uso
   * en memoria, que nadie mas puede conocer ni predecir.
   */
  private hashSenueloPromise: Promise<string> | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async crearTenant(dto: CreateTenantDto): Promise<TenantPublico> {
    const tenant = await runUnscoped(async () => {
      const existente = await this.prisma.db.tenant.findUnique({
        where: { slug: dto.slug },
      });
      if (existente) throw new ConflictException('Ya existe un tenant con ese slug');

      return await this.prisma.db.tenant.create({
        data: { nombre: dto.nombre, slug: dto.slug },
      });
    });

    return this.aTenantPublico(tenant);
  }

  /** Crea el primer usuario de un tenant, siempre con rol ADMIN_SALON. */
  async register(dto: RegisterDto): Promise<UsuarioPublico> {
    const tenant = await runUnscoped(
      async () =>
        await this.prisma.db.tenant.findUnique({ where: { slug: dto.tenantSlug } }),
    );
    if (!tenant) throw new UnauthorizedException('Tenant inexistente');

    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });

    const usuario = await runWithTenant(tenant.id, async () => {
      const yaHayUsuarios = await this.prisma.db.usuario.count();
      if (yaHayUsuarios > 0) {
        throw new ConflictException('Este tenant ya tiene usuarios; usa el alta normal');
      }

      return await this.prisma.db.usuario.create({
        data: {
          // tenantId es redundante en tiempo de ejecucion (la extension lo
          // sobrescribe con el mismo valor, tomado del contexto de
          // runWithTenant), pero el tipo generado por Prisma para
          // UsuarioUncheckedCreateInput lo exige: sin esta linea `tsc --strict`
          // no compila.
          tenantId: tenant.id,
          nombreCompleto: dto.nombreCompleto,
          email: dto.email.toLowerCase(),
          passwordHash,
          rol: 'ADMIN_SALON',
        },
      });
    });

    return this.aUsuarioPublico(usuario);
  }

  /**
   * Alta de un alumno por su cuenta, con una clave de invitacion.
   *
   * Tres cosas que no son evidentes:
   *
   * 1. **Corre en Serializable con reintento.** `usosMax` es un cupo y tiene
   *    exactamente la misma carrera que el cupo de un turno: sin aislamiento,
   *    dos registros simultaneos con una clave de un solo uso leen ambos
   *    `usosActuales = 0` y ambos pasan. Ademas del aislamiento, el incremento
   *    se hace con un updateMany CONDICIONAL (compare-and-swap), como la
   *    rotacion de refresh tokens: cinturon y tirantes.
   * 2. **Todo va dentro de `runWithTenant`.** Es un endpoint publico: no hay JWT,
   *    asi que el middleware no abrio ningun contexto y la extension de Prisma
   *    lanzaria `MissingTenantContextError` en la primera query. El tenant sale
   *    del slug, igual que en `register` desde la Fase 0.
   * 3. **El rol se fija aqui a ALUMNO.** El DTO no lo acepta y el ValidationPipe
   *    rechazaria el campo, pero una sola linea de defensa en un endpoint
   *    publico no basta.
   */
  async autoRegistro(dto: AutoRegistroDto): Promise<LoginRespuesta> {
    const tenant = await runUnscoped(
      async () => await this.prisma.db.tenant.findUnique({ where: { slug: dto.tenantSlug } }),
    );
    if (!tenant || !tenant.activo) throw new UnauthorizedException(CLAVE_INVALIDA);

    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    const email = dto.email.toLowerCase();

    const usuario = await runWithTenant(tenant.id, () =>
      this.conReintentoDeClave(() =>
        this.prisma.db.$transaction(
          async (tx) => {
            const cliente = tx as ClientePrismaTx;

            const clave = await cliente.claveInvitacion.findFirst({
              where: { codigo: dto.codigo },
              include: { salas: { select: { salaId: true } } },
            });

            if (!clave || !clave.activa) throw new UnauthorizedException(CLAVE_INVALIDA);
            if (clave.expiraEn !== null && clave.expiraEn.getTime() <= Date.now()) {
              throw new UnauthorizedException(CLAVE_INVALIDA);
            }
            if (clave.usosMax !== null && clave.usosActuales >= clave.usosMax) {
              throw new UnauthorizedException(CLAVE_INVALIDA);
            }

            const yaExiste = await cliente.usuario.findFirst({ where: { email } });
            if (yaExiste) {
              throw new ConflictException('Ya hay una cuenta con ese email en este gimnasio');
            }

            const creado = await cliente.usuario.create({
              data: {
                tenantId: tenant.id,
                nombreCompleto: dto.nombreCompleto,
                email,
                passwordHash,
                // Fijo, nunca del cuerpo. Ver el punto 3 del comentario.
                rol: 'ALUMNO',
              },
            });

            const perfil = await cliente.perfil.create({
              data: {
                tenantId: tenant.id,
                usuarioId: creado.id,
                packId: clave.packId,
                autoRegistrado: true,
              },
            });

            // Sin estas filas el alumno no veria ni podria reservar NADA: toda
            // reserva se valida contra UsuarioSala. Es el agujero que el PDF de
            // la fase dejaba abierto.
            if (clave.salas.length > 0) {
              await cliente.usuarioSala.createMany({
                data: clave.salas.map((union) => ({
                  tenantId: tenant.id,
                  perfilId: perfil.id,
                  salaId: union.salaId,
                })),
              });
            }

            // CAS: solo una de dos peticiones simultaneas puede afectar una fila.
            const consumida = await cliente.claveInvitacion.updateMany({
              where: { id: clave.id, usosActuales: clave.usosActuales },
              data: { usosActuales: clave.usosActuales + 1 },
            });
            if (consumida.count === 0) {
              throw new ConflictException(
                'Otra alta consumio esta clave al mismo tiempo; vuelve a intentarlo.',
              );
            }

            await cliente.historialAccion.create({
              data: {
                tenantId: tenant.id,
                usuarioId: creado.id,
                entidad: 'Usuario',
                entidadId: creado.id,
                accion: 'AUTO_REGISTRADO',
                detalle: { claveId: clave.id, salaIds: clave.salas.map((u) => u.salaId) },
              },
            });

            return creado;
          },
          { isolationLevel: 'Serializable' },
        ),
      ),
    );

    const tokens = await this.emitirTokens({
      id: usuario.id,
      tenantId: usuario.tenantId,
      rol: usuario.rol,
    });

    return { ...tokens, usuario: this.aUsuarioPublico(usuario) };
  }

  /**
   * Como `conReintentoDeCupo` en ReservasService: si los reintentos se agotan,
   * sale un 409 y no un 500. Que la base aborte por solape no es un fallo del
   * servidor, es un conflicto.
   */
  private async conReintentoDeClave<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await conReintentoSerializable(fn, { intentos: 5 });
    } catch (error) {
      if (esConflictoDeSerializacion(error)) {
        throw new ConflictException(
          'Varias altas estan usando esta clave ahora mismo; reintenta en unos segundos.',
        );
      }
      throw error;
    }
  }

  async login(dto: LoginDto): Promise<LoginRespuesta> {
    const usuario = await runUnscoped(async () => {
      const tenant = await this.prisma.db.tenant.findUnique({
        where: { slug: dto.tenantSlug },
      });
      if (!tenant || !tenant.activo) return null;

      return await this.prisma.db.usuario.findUnique({
        where: { tenantId_email: { tenantId: tenant.id, email: dto.email.toLowerCase() } },
      });
    });

    if (!usuario || !usuario.activo || usuario.rol === 'FANTASMA') {
      // No hay usuario utilizable: verificamos igualmente contra un hash
      // señuelo para que esta rama cueste lo mismo que la de password
      // incorrecta (ver comentario en obtenerHashSenuelo). El resultado se
      // descarta: solo interesa el coste, no si "coincide".
      await argon2.verify(await this.obtenerHashSenuelo(), dto.password);
      throw new UnauthorizedException(CREDENCIALES_INVALIDAS);
    }

    const passwordOk = await argon2.verify(usuario.passwordHash, dto.password);
    if (!passwordOk) throw new UnauthorizedException(CREDENCIALES_INVALIDAS);

    const tokens = await this.emitirTokens({
      id: usuario.id,
      tenantId: usuario.tenantId,
      rol: usuario.rol,
    });

    return { ...tokens, usuario: this.aUsuarioPublico(usuario) };
  }

  /**
   * Rotacion con deteccion de reuso (OWASP): cada refresh revoca el token usado
   * y emite otro. Si llega un token ya revocado, se asume robo y se revocan
   * todas las sesiones del usuario.
   *
   * Todo va en runUnscoped porque /auth/refresh es publico: no hay JWT de acceso
   * y por tanto no hay contexto de tenant.
   */
  async refresh(refreshToken: string): Promise<TokensRespuesta> {
    let payload: RefreshPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshPayload>(refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Refresh token invalido');
    }

    const usuario = await runUnscoped(async () => {
      const fila = await this.prisma.db.refreshToken.findUnique({
        where: { id: payload.jti },
      });
      if (!fila || fila.usuarioId !== payload.sub) {
        throw new UnauthorizedException('Refresh token invalido');
      }

      if (fila.revokedAt) {
        await this.revocarTodasLasSesionesUnscoped(fila.usuarioId);
        throw new UnauthorizedException('Refresh token reutilizado; sesiones revocadas');
      }

      if (fila.expiresAt.getTime() <= Date.now()) {
        throw new UnauthorizedException('Refresh token expirado');
      }

      const coincide = await argon2.verify(fila.tokenHash, refreshToken);
      if (!coincide) {
        await this.revocarTodasLasSesionesUnscoped(fila.usuarioId);
        throw new UnauthorizedException('Refresh token invalido');
      }

      const u = await this.prisma.db.usuario.findUnique({ where: { id: fila.usuarioId } });
      if (!u || !u.activo) throw new UnauthorizedException('Refresh token invalido');

      // CAS (compare-and-swap), no un update a secas: con 10 peticiones
      // concurrentes con el mismo token, todas leen revokedAt: null antes de
      // que ninguna escriba (TOCTOU), asi que un update incondicional dejaria
      // rotar a todas. Al condicionar la escritura a where: { revokedAt: null }
      // solo una fila afectada (count === 1) gana la carrera: esa es la unica
      // peticion que puede seguir y emitir el par nuevo. Todas las demas
      // encuentran count: 0 (o bien esta ganadora ya escribio, o bien el token
      // ya venia revocado) y se tratan como reuso: se asume robo y se revocan
      // todas las sesiones del usuario.
      const revocado = await this.prisma.db.refreshToken.updateMany({
        where: { id: fila.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      if (revocado.count === 0) {
        // Otra peticion nos gano la carrera y ya lo revoco, o llego revocado de antes.
        // En ambos casos el token se esta usando dos veces: se asume robo.
        await this.revocarTodasLasSesionesUnscoped(fila.usuarioId);
        throw new UnauthorizedException('Refresh token reutilizado; sesiones revocadas');
      }

      return u;
    });

    return this.emitirTokens({
      id: usuario.id,
      tenantId: usuario.tenantId,
      rol: usuario.rol,
    });
  }

  /** Logout corre autenticado, asi que hay contexto de tenant: la extension filtra por la relacion usuario. */
  async logout(usuarioId: string, refreshToken: string): Promise<void> {
    let payload: RefreshPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshPayload>(refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      // Logout es idempotente: un token ilegible ya no sirve para nada.
      return;
    }

    await this.prisma.db.refreshToken.updateMany({
      where: { id: payload.jti, usuarioId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async usuarioActual(payload: JwtPayload): Promise<MeRespuesta> {
    const usuario = await this.prisma.db.usuario.findFirst({ where: { id: payload.sub } });
    if (!usuario) throw new UnauthorizedException('Usuario inexistente');

    // En contexto de tenant, findFirst() sobre Tenant ya queda restringido al
    // propio gimnasio (la extension fuerza where.id = tenantId): no hace falta
    // -ni se debe- pasar el id a mano.
    const tenant = await this.prisma.db.tenant.findFirst();
    if (!tenant) throw new UnauthorizedException('Tenant inexistente');

    return { ...this.aUsuarioPublico(usuario), tenant: this.aTenantPublico(tenant) };
  }

  /**
   * Emite el par de tokens. La fila RefreshToken se crea en runUnscoped porque
   * el modelo no tiene columna tenantId propia y la extension prohibe crearlo
   * incluso dentro de un contexto de tenant.
   */
  private async emitirTokens(usuario: {
    id: string;
    tenantId: string;
    rol: UsuarioPublico['rol'];
  }): Promise<TokensRespuesta> {
    const accessToken = await this.jwt.signAsync(
      { sub: usuario.id, tenantId: usuario.tenantId, rol: usuario.rol } satisfies JwtPayload,
      {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
        expiresIn: this.config.getOrThrow<string>('JWT_EXPIRES_IN'),
      },
    );

    const jti = randomUUID();
    const refreshToken = await this.jwt.signAsync(
      { sub: usuario.id, jti } satisfies RefreshPayload,
      {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.config.getOrThrow<string>('JWT_REFRESH_EXPIRES_IN'),
      },
    );

    const { exp } = this.jwt.decode(refreshToken) as { exp: number };
    const tokenHash = await argon2.hash(refreshToken, { type: argon2.argon2id });

    await runUnscoped(
      async () =>
        await this.prisma.db.refreshToken.create({
          data: {
            id: jti,
            usuarioId: usuario.id,
            tokenHash,
            expiresAt: new Date(exp * 1000),
          },
        }),
    );

    return { accessToken, refreshToken };
  }

  /**
   * Hash señuelo, generado una sola vez y cacheado en memoria. La contraseña
   * que protege es un randomUUID() generado en el momento: no se guarda ni se
   * necesita en ningun otro sitio, solo existe para que argon2 tenga algo
   * costoso que verificar. Usa los mismos parametros ({ type: argon2id }) que
   * los hashes reales para que el coste sea comparable; si no, la rama del
   * señuelo seguiria siendo mas barata (o mas cara) y la fuga de tiempos no se
   * cerraria.
   */
  private async obtenerHashSenuelo(): Promise<string> {
    this.hashSenueloPromise ??= argon2.hash(randomUUID(), { type: argon2.argon2id });
    return this.hashSenueloPromise;
  }

  /** Solo se llama desde dentro de un runUnscoped. */
  private async revocarTodasLasSesionesUnscoped(usuarioId: string): Promise<void> {
    await this.prisma.db.refreshToken.updateMany({
      where: { usuarioId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private aUsuarioPublico(u: {
    id: string;
    tenantId: string;
    nombreCompleto: string;
    email: string;
    rol: UsuarioPublico['rol'];
    activo: boolean;
  }): UsuarioPublico {
    return {
      id: u.id,
      tenantId: u.tenantId,
      nombreCompleto: u.nombreCompleto,
      email: u.email,
      rol: u.rol,
      activo: u.activo,
    };
  }

  private aTenantPublico(t: {
    id: string;
    nombre: string;
    slug: string;
    activo: boolean;
  }): TenantPublico {
    return { id: t.id, nombre: t.nombre, slug: t.slug, activo: t.activo };
  }
}
