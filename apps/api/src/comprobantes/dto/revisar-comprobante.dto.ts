import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Recortado } from '../../common/decorators/recortado.decorator';

export class RevisarComprobanteDto {
  /** Motivo del rechazo, o cualquier apunte del admin al aprobar. */
  @Recortado()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  nota?: string;
}
