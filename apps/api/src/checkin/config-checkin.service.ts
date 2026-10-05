import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { toBuffer } from 'qrcode';
import type { ConfigCheckIn, JwtPayload } from '@boxadmin/shared';
import { PrismaService, type ClientePrismaTx } from '../prisma/prisma.service';
import type { GuardarConfigQrDto } from './dto/guardar-config-qr.dto';
import { firmarTenant } from './firma-qr';

/**
 * Lo que usa un gimnasio que nunca toco la configuracion.
 *
 * Los mismos quince minutos que el `@default` del schema, a proposito: la
 * ausencia de fila no puede significar "check-in roto" ni "check-in siempre
 * abierto". Si los dos numeros divergieran, el gimnasio veria una ventana en la
 * pantalla y tendria otra en la practica hasta el primer guardado.
 */
export const CONFIG_CHECKIN_POR_DEFECTO: ConfigCheckIn = { minutosAntes: 15, minutosDespues: 15 };

/** Lado del PNG, en pixeles. Suficiente para imprimirlo en un A5 y escanearlo. */
const LADO_DEL_QR = 512;

/**
 * Lo que va DENTRO del QR, aparte para poder afirmarlo en un test.
 *
 * Un PNG no se puede leer de vuelta en una prueba sin meter un decodificador,
 * asi que, dentro del service, la URL que se codifica seria el unico dato del
 * cartel que nadie comprueba: podria apuntar a cualquier sitio y los tests
 * seguirian en verde mientras el PNG tuviera cabecera de PNG.
 *
 * `firma` NO se pasa por `encodeURIComponent`: es base64url por construccion
 * (hay un test que lo fija en `firma-qr.spec.ts`) y no tiene ningun caracter
 * que escapar. El slug tampoco: es el mismo que ya usan todas las rutas de la
 * PWA.
 */
export function urlDeCheckIn(webOrigin: string, slug: string, firma: string): string {
  // La barra final del origen se recorta: con ella, la URL saldria con '//' en
  // el medio y Next la resolveria a otra ruta.
  return `${webOrigin.replace(/\/+$/, '')}/${slug}/checkin?f=${firma}`;
}

@Injectable()
export class ConfigCheckInService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** La ventana del gimnasio, o los quince por defecto si no hay fila. */
  async ver(): Promise<ConfigCheckIn> {
    const fila = await this.prisma.db.configCheckInQR.findFirst({
      select: { minutosAntes: true, minutosDespues: true },
    });

    // Se reconstruye campo a campo en vez de devolver la fila: asi el dia que
    // el modelo crezca —o que alguien ensanche el `select`— no se escapa una
    // columna nueva por el contrato publico sin que nadie lo decida.
    return fila === null
      ? CONFIG_CHECKIN_POR_DEFECTO
      : { minutosAntes: fila.minutosAntes, minutosDespues: fila.minutosDespues };
  }

  async guardar(actor: JwtPayload, dto: GuardarConfigQrDto): Promise<ConfigCheckIn> {
    const campos = { minutosAntes: dto.minutosAntes, minutosDespues: dto.minutosDespues };

    await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      // NO es un `upsert`, y no puede serlo: la extension de aislamiento lo
      // tiene en OPERACIONES_UNICAS y lanza UnsafeUniqueOperationError. Mismo
      // camino que `config-email.service.ts` desde la Fase 5B, y no se pierde
      // nada: las dos ramas corren dentro de la misma transaccion, que ya
      // serializa la lectura y la escritura.
      const existente = await cliente.configCheckInQR.findFirst({ select: { tenantId: true } });

      if (existente === null) {
        // La extension inyecta el tenantId, pero el tipo generado por Prisma lo
        // exige bajo strict.
        await cliente.configCheckInQR.create({ data: { tenantId: actor.tenantId, ...campos } });
      } else {
        // El `data` NO lleva tenantId: en un `update` seria un intento de mover
        // la fila a otro gimnasio y la extension lo lee como ataque
        // (ReasignacionDeTenantError).
        await cliente.configCheckInQR.update({ where: { tenantId: actor.tenantId }, data: campos });
      }
    });

    return campos;
  }

  /**
   * El PNG del cartel: un QR a `<WEB_ORIGIN>/<slug>/checkin?f=<firma>`.
   *
   * ES ESTATICO Y SE IMPRIME. Quien tenga la foto del cartel puede marcar
   * presente desde su casa, y es una decision tomada: hoy la asistencia no
   * factura nada, asi que el check-in es comodidad y no prueba de presencia. El
   * dia que tenga que probarla hara falta un QR que rote en una pantalla, y eso
   * es otro diseno, no un parche sobre este.
   */
  async imagenQr(actor: JwtPayload): Promise<Buffer> {
    // `Tenant` es un modelo GLOBAL para la extension (no lleva columna
    // tenantId), asi que no se le inyecta ningun filtro: el `where` por
    // `actor.tenantId` es lo unico que impide leer el slug de otro gimnasio, y
    // por eso es explicito en vez de venir de la URL.
    //
    // `findFirst` Y NO `findUnique`: dentro de un contexto de tenant la
    // extension rechaza las operaciones de `where` unico
    // (UnsafeUniqueOperationError), asi que un findUnique aqui es un 500 en
    // CADA descarga del cartel. Mismo camino que `liquidacion.datos.ts`, que lee
    // el tenant del actor igual que esto.
    const tenant = await this.prisma.db.tenant.findFirst({
      where: { id: actor.tenantId },
      select: { slug: true },
    });
    if (tenant === null) throw new NotFoundException('El gimnasio no existe');

    const origen = this.config.get<string>('WEB_ORIGIN');
    if (origen === undefined || origen.trim() === '') {
      // WEB_ORIGIN es opcional en el entorno (ver validar-entorno.ts), asi que
      // esto es alcanzable. Un 503 con el motivo y no un 500 opaco: lo que
      // falta es configuracion del despliegue, no un bug, y el admin tiene que
      // poder decirselo a quien lo monto.
      throw new ServiceUnavailableException(
        'No se puede generar el QR: este despliegue no tiene WEB_ORIGIN configurado, ' +
          'asi que no hay una direccion publica a la que apuntar.',
      );
    }

    const firma = firmarTenant(actor.tenantId, this.claveDeApp());
    const url = urlDeCheckIn(origen, tenant.slug, firma);

    return await toBuffer(url, { type: 'png', width: LADO_DEL_QR, errorCorrectionLevel: 'M' });
  }

  /**
   * La APP_ENCRYPTION_KEY TAL CUAL llega del entorno, en hex, y no el Buffer de
   * `claveDesdeHex`. Es a proposito: ver el comentario de `firmarTenant`.
   */
  private claveDeApp(): string {
    return this.config.getOrThrow<string>('APP_ENCRYPTION_KEY');
  }
}
