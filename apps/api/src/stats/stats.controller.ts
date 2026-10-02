import { Controller, Get, Query } from '@nestjs/common';
import type {
  CajaDelMes,
  ComposicionAlumnos,
  JwtPayload,
  Operativo,
  PagoPendiente,
  ReporteAsistencia,
  ReporteTurnosLibres,
} from '@boxadmin/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ConsultaMensualDto } from './dto/consulta-mensual.dto';
import { ConsultaOperativaDto } from './dto/consulta-operativa.dto';
import { ConsultaPagosPendientesDto } from './dto/consulta-pagos-pendientes.dto';
import { ConsultaRangoDto } from './dto/consulta-rango.dto';
import { ConsultaTurnosLibresDto } from './dto/consulta-turnos-libres.dto';
import { StatsService } from './stats.service';

@Controller('stats')
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  /**
   * ADMIN_SALON y no ADMIN_OPERATIVO, mismo criterio que fijo la 5A para los
   * pagos: registrar un cobro es operativo, mirar el margen del salon no lo es.
   *
   * El actor sale del token y nunca del query: es de el de donde el service
   * saca el `tenantId` con el que cachea. Un `?tenantId=` seria la unica forma
   * de que este reporte mostrara el numero de otro gimnasio, asi que no existe.
   */
  @Roles('ADMIN_SALON')
  @Get('caja')
  caja(
    @CurrentUser() actor: JwtPayload,
    @Query() consulta: ConsultaMensualDto,
  ): Promise<CajaDelMes> {
    return this.stats.caja(actor, consulta);
  }

  /**
   * ADMIN_OPERATIVO y no ADMIN_SALON: aqui no hay un solo peso.
   *
   * Es la otra mitad del criterio de la 5A. La caja muestra el margen del salon
   * y lo que cuesta cada profesora, y eso no lo mira recepcion; la ocupacion, la
   * asistencia y las cancelaciones son justamente el trabajo de recepcion. Un
   * ADMIN_SALON tambien entra, porque `rolAlcanza` es una jerarquia y no una
   * lista de roles exactos.
   *
   * El `salaId` es opcional y SI es legitimo aqui, al reves que en la caja: un
   * `Turno` tiene sala propia. El porque de la asimetria esta en el docblock de
   * `StatsService.caja`; que la cobranza quede fuera de ese recorte esta en el
   * de `StatsService.operativo`.
   */
  @Roles('ADMIN_OPERATIVO')
  @Get('operativo')
  operativo(
    @CurrentUser() actor: JwtPayload,
    @Query() consulta: ConsultaOperativaDto,
  ): Promise<Operativo> {
    return this.stats.operativo(actor, consulta);
  }

  /**
   * ADMIN_OPERATIVO: donde hay lugar es la pregunta de recepcion por excelencia
   * —"donde meto a este alumno los martes"— y no hay un solo peso en la
   * respuesta. Un ADMIN_SALON tambien entra, porque `rolAlcanza` es una
   * jerarquia y no una lista de roles exactos.
   *
   * El `salaId` SI va, igual que en el operativo: un `Turno` tiene sala propia.
   * Y `mesesAdelante` no tiene techo en el DTO sino en el service, para que
   * pedir dos anos devuelva uno y no un 400; ver `ConsultaTurnosLibresDto`. La
   * respuesta dice cuantos meses se miraron DE VERDAD, que es la otra mitad de
   * esa decision: recortar sin avisar deja a quien pidio dos anos leyendo una
   * lista corta como "no hay mas turnos".
   */
  @Roles('ADMIN_OPERATIVO')
  @Get('turnos-libres')
  turnosLibres(
    @CurrentUser() actor: JwtPayload,
    @Query() consulta: ConsultaTurnosLibresDto,
  ): Promise<ReporteTurnosLibres> {
    return this.stats.turnosLibres(actor, consulta);
  }

  /**
   * ADMIN_OPERATIVO, y la decision de rol es la que mas se presta a discusion
   * de toda la fase: aqui hay importes. Van igual a recepcion porque este
   * reporte NO dice cuanto factura el gimnasio ni cuanto cobra una profesora
   * —eso es la caja, y pide ADMIN_SALON—: dice a quien hay que llamar y cuanto
   * sale su pack, que es el precio de lista que recepcion ya le canta por
   * telefono. Es el mismo criterio que la 5A, donde registrar un cobro es
   * operativo.
   *
   * EL `@Query()` APUNTA A UN DTO VACIO Y ESO ES LO QUE HACE EL TRABAJO: sin el,
   * Nest ignoraria `?salaId=` en silencio; con el, el ValidationPipe global
   * devuelve 400. El porque de que no haya `salaId` esta entero en
   * `ConsultaPagosPendientesDto`.
   */
  @Roles('ADMIN_OPERATIVO')
  @Get('pagos-pendientes')
  pagosPendientes(
    @CurrentUser() actor: JwtPayload,
    @Query() consulta: ConsultaPagosPendientesDto,
  ): Promise<PagoPendiente[]> {
    return this.stats.pagosPendientes(actor, consulta);
  }

  /**
   * ADMIN_OPERATIVO: cuenta alumnos y clases, no pesos. Ni el precio del pack
   * aparece aqui, solo su nombre.
   *
   * Reutiliza `ConsultaMensualDto`, el mismo de la caja, y eso le trae de
   * regalo el rechazo del `salaId`: la composicion es del gimnasio, porque un
   * alumno con acceso a tres salas esta en UN pack y no en tres.
   */
  @Roles('ADMIN_OPERATIVO')
  @Get('composicion-alumnos')
  composicionAlumnos(
    @CurrentUser() actor: JwtPayload,
    @Query() consulta: ConsultaMensualDto,
  ): Promise<ComposicionAlumnos> {
    return this.stats.composicionAlumnos(actor, consulta);
  }

  /**
   * ADMIN_OPERATIVO: quien viene y quien no es exactamente el trabajo de
   * recepcion.
   *
   * Es el unico reporte de la fase que NO se pide por mes: la conversacion con
   * un alumno sobre su asistencia no empieza ni termina un dia 1. Por eso lleva
   * un rango libre y un `perfilId` opcional para mirar a uno solo.
   */
  @Roles('ADMIN_OPERATIVO')
  @Get('asistencia')
  asistencia(
    @CurrentUser() actor: JwtPayload,
    @Query() consulta: ConsultaRangoDto,
  ): Promise<ReporteAsistencia> {
    return this.stats.asistencia(actor, consulta);
  }
}
