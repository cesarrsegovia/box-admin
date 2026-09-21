import { IsBoolean, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { PATRON_FECHA, PATRON_HORA } from '@boxadmin/shared';

/** Hasta 8 enteros y como mucho 2 decimales: encaja en DECIMAL(10, 2). */
const PATRON_TARIFA = /^\d{1,8}(\.\d{1,2})?$/;

/**
 * Los mismos campos que al crear MENOS `profesorId` y `salaId`, por la misma
 * razon que ActualizarRutinaDto los excluye: mover un horario de profesora o de
 * sala por PATCH dejaria los turnos ya etiquetados colgando de un patron que ya
 * no existe. Para eso se da de baja y se crea otro.
 */
export class ActualizarHorarioProfesorDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  diaSemana?: number;

  @IsOptional()
  @Matches(PATRON_HORA, { message: 'horaInicio debe tener formato HH:MM en 24 h' })
  horaInicio?: string;

  @IsOptional()
  @Matches(PATRON_HORA, { message: 'horaFin debe tener formato HH:MM en 24 h' })
  horaFin?: string;

  @IsOptional()
  @Matches(PATRON_FECHA, { message: 'desde debe tener formato YYYY-MM-DD' })
  desde?: string;

  @IsOptional()
  @Matches(PATRON_FECHA, { message: 'hasta debe tener formato YYYY-MM-DD' })
  hasta?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @IsOptional()
  @Matches(PATRON_TARIFA, {
    message: 'tarifaPorHora debe ser un numero con hasta 2 decimales, como "1500.00"',
  })
  tarifaPorHora?: string;
}
