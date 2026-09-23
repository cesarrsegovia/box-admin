import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LIMITE_GENERAL, TTL_GENERAL } from './common/throttling';
import { AlmacenModule } from './almacen/almacen.module';
import { AusenciasModule } from './ausencias/ausencias.module';
import { AuthModule } from './auth/auth.module';
import { CalendarioModule } from './calendario/calendario.module';
import { ComprobantesModule } from './comprobantes/comprobantes.module';
import { ComunicacionModule } from './comunicacion/comunicacion.module';
import { DisponibilidadModule } from './disponibilidad/disponibilidad.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { HistorialModule } from './common/historial/historial.module';
import { InvitacionesModule } from './invitaciones/invitaciones.module';
import { TenantContextMiddleware } from './common/tenant/tenant.middleware';
import { validarEntorno } from './config/validar-entorno';
import { JobsModule } from './jobs/jobs.module';
import { ListaEsperaModule } from './lista-espera/lista-espera.module';
import { MiCalendarioModule } from './mi-calendario/mi-calendario.module';
import { LiquidacionModule } from './liquidacion/liquidacion.module';
import { PagosModule } from './pagos/pagos.module';
import { MisClasesModule } from './mis-clases/mis-clases.module';
import { NotificacionesModule } from './notificaciones/notificaciones.module';
import { PacksModule } from './packs/packs.module';
import { PrismaModule } from './prisma/prisma.module';
import { PushModule } from './push/push.module';
import { ReservasModule } from './reservas/reservas.module';
import { HorariosProfesorModule } from './horarios-profesor/horarios-profesor.module';
import { RutinasModule } from './rutinas/rutinas.module';
import { SalasModule } from './salas/salas.module';
import { TurnosModule } from './turnos/turnos.module';
import { UsuariosModule } from './usuarios/usuarios.module';
import { VacacionesModule } from './vacaciones/vacaciones.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // El .env vive en la raíz del monorepo, dos niveles por encima de apps/api
      // (las rutas son relativas al cwd, que siempre es el paquete).
      //
      // El primer elemento es explícito a propósito: en los tests, dotenv-cli ya
      // ha cargado .env.test en process.env antes de que Nest arranque, y
      // @nestjs/config nunca pisa una variable existente — así que sin esta línea
      // el entorno de test funcionaría por casualidad, cargando el .env de
      // desarrollo y descartándolo en silencio. Dentro de Docker ninguno de los
      // dos archivos existe y compose ya inyecta las variables; ConfigModule
      // omite sin error los envFilePath que no encuentra.
      envFilePath: [`../../.env.${process.env.NODE_ENV ?? 'development'}`, '../../.env'],
      validate: validarEntorno,
    }),
    JwtModule.register({ global: true }),
    // Limite permisivo global: no esta para moderar el uso normal, sino para
    // que ningun endpoint quede completamente sin freno. Las rutas publicas de
    // auth llevan ademas su propio limite estricto (@Throttle en el controller).
    ThrottlerModule.forRoot([{ name: 'default', ttl: TTL_GENERAL, limit: LIMITE_GENERAL }]),
    // Conexion a Redis para BullMQ.
    //
    // Desviacion respecto al documento original de la Fase 0, que escribia
    // `connection: { url: process.env.REDIS_URL }`: las opciones de ioredis no
    // admiten un campo `url`, asi que hay que desmontarla en sus partes.
    //
    // Se pasan OPCIONES y no una instancia de Redis construida a mano, aunque
    // el constructor si acepte la URL entera: una instancia creada aqui no la
    // gestiona Nest, asi que sobrevive a `app.close()` y deja el proceso vivo.
    // Se detecto en los e2e, donde Jest terminaba los 16 tests en verde y
    // despues se quedaba colgado para siempre. Con opciones, BullMQ crea y
    // cierra sus propias conexiones en el ciclo de vida del modulo.
    //
    // `maxRetriesPerRequest: null` lo exige BullMQ para sus workers.
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = new URL(config.getOrThrow<string>('REDIS_URL'));

        return {
          connection: {
            host: url.hostname,
            port: Number(url.port || 6379),
            username: url.username || undefined,
            password: url.password || undefined,
            maxRetriesPerRequest: null,
          },
        };
      },
    }),
    PrismaModule,
    HistorialModule,
    AlmacenModule.forRoot(),
    ComunicacionModule.forRoot(),
    DisponibilidadModule,
    NotificacionesModule,
    ListaEsperaModule,
    AuthModule,
    SalasModule,
    PacksModule,
    UsuariosModule,
    InvitacionesModule,
    TurnosModule,
    ReservasModule,
    RutinasModule,
    HorariosProfesorModule,
    VacacionesModule,
    AusenciasModule,
    CalendarioModule,
    MiCalendarioModule,
    MisClasesModule,
    LiquidacionModule,
    ComprobantesModule,
    PagosModule,
    PushModule,
    JobsModule,
  ],
  providers: [
    // Primero de los tres a proposito: los guards corren en el orden en que se
    // declaran (verificado empiricamente con un spike antes de escribir esto),
    // y el freno tiene que aplicarse ANTES de que JwtAuthGuard gaste tiempo
    // validando el token de quien esta probando credenciales.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }
}
