import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import type { OrigenReserva } from '@boxadmin/shared';

const ORIGENES: OrigenReserva[] = ['ADMIN', 'ALUMNO', 'RUTINA', 'PRUEBA', 'LISTA_ESPERA', 'EXTRA'];

export class CrearReservaDto {
  /**
   * El id del Perfil, no el del Usuario. Los listados de usuarios devuelven
   * `perfilId` justamente para esto.
   */
  @IsString()
  @IsNotEmpty()
  perfilId!: string;

  /** Por defecto ADMIN: en la Fase 1 todas las reservas las asigna el admin. */
  @IsOptional()
  @IsIn(ORIGENES)
  origen?: OrigenReserva;

  @IsOptional()
  @IsBoolean()
  esPrueba?: boolean;

  @IsOptional()
  @IsBoolean()
  pagoRealizado?: boolean;
}
