import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { tenantScopedExtension } from '../common/tenant/tenant-scoped.extension';

function crearClienteExtendido(base: PrismaClient) {
  return base.$extends(tenantScopedExtension);
}

export type ClientePrismaExtendido = ReturnType<typeof crearClienteExtendido>;

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  /**
   * Cliente base, SIN scoping. Reservado para conectar, desconectar y limpiar
   * la base en los tests. El código de aplicación nunca debe tocarlo.
   */
  readonly base: PrismaClient;

  /** Cliente con aislamiento por tenant. Es el que usa toda la aplicación. */
  readonly db: ClientePrismaExtendido;

  constructor(config: ConfigService) {
    // Prisma 7 ya no acepta `new PrismaClient()` sin más: exige un driver adapter
    // explícito (se acabó la resolución implícita de DATABASE_URL vía el
    // datasource.url del schema).
    //
    // La URL se pide con getOrThrow y no leyendo process.env a pelo por una razón
    // concreta: si falta, el driver `pg` cae a sus defaults (localhost:5432, usuario
    // del sistema, sin contraseña) e intenta conectar a lo que sea que haya ahí. Ni
    // el adapter ni $connect() fallan — el error aparece mucho después, en la primera
    // query, como "SASL: client password must be a string", que no menciona
    // DATABASE_URL por ningún lado. Peor aún, en otra máquina podría conectar con
    // éxito a una base equivocada. Así falla en el arranque y diciendo qué falta.
    const connectionString = config.getOrThrow<string>('DATABASE_URL');

    this.base = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    this.db = crearClienteExtendido(this.base);
  }

  async onModuleInit(): Promise<void> {
    await this.base.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.base.$disconnect();
  }
}

/**
 * Cliente utilizable dentro de un `$transaction`: el cliente extendido menos las
 * operaciones de conexion y la transaccion anidada, que Prisma no expone ahi.
 *
 * `this.prisma.db` tambien encaja en este tipo (tiene todo lo que pide y algo
 * mas), asi que un servicio puede declarar `cliente: ClientePrismaTx = this.prisma.db`
 * y funcionar tanto dentro como fuera de una transaccion.
 */
export type ClientePrismaTx = Omit<
  ClientePrismaExtendido,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;
