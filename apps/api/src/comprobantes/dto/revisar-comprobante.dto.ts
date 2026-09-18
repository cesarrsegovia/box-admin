import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RevisarComprobanteDto {
  /** Motivo del rechazo, o cualquier apunte del admin al aprobar. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  nota?: string;
}
