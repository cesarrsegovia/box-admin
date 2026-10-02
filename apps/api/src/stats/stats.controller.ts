import { Controller, Get, Query } from '@nestjs/common';
import type { CajaDelMes, JwtPayload } from '@boxadmin/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ConsultaMensualDto } from './dto/consulta-mensual.dto';
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
}
