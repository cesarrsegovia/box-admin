import { IsNotEmpty, IsString } from 'class-validator';

export class ReasignarReservaDto {
  /** Turno destino. El origen sale de la propia reserva. */
  @IsString()
  @IsNotEmpty()
  turnoId!: string;
}
