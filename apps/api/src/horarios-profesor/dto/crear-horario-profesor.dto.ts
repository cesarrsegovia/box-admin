import { IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { PATRON_FECHA, PATRON_HORA } from '@boxadmin/shared';

/** Hasta 8 enteros y como mucho 2 decimales: encaja en DECIMAL(10, 2). */
const PATRON_TARIFA = /^\d{1,8}(\.\d{1,2})?$/;

export class CrearHorarioProfesorDto {
  @IsString()
  @IsNotEmpty()
  profesorId!: string;

  @IsString()
  @IsNotEmpty()
  salaId!: string;

  /** 0 = domingo ... 6 = sabado, igual que Date.getUTCDay(). */
  @IsInt()
  @Min(0)
  @Max(6)
  diaSemana!: number;

  @Matches(PATRON_HORA, { message: 'horaInicio debe tener formato HH:MM en 24 h' })
  horaInicio!: string;

  @Matches(PATRON_HORA, { message: 'horaFin debe tener formato HH:MM en 24 h' })
  horaFin!: string;

  @Matches(PATRON_FECHA, { message: 'desde debe tener formato YYYY-MM-DD' })
  desde!: string;

  /** Ausente = indefinido. */
  @IsOptional()
  @Matches(PATRON_FECHA, { message: 'hasta debe tener formato YYYY-MM-DD' })
  hasta?: string;

  /**
   * String, nunca number: es dinero. Ausente = usa la tarifa general del
   * gimnasio.
   */
  @IsOptional()
  @Matches(PATRON_TARIFA, {
    message: 'tarifaPorHora debe ser un numero con hasta 2 decimales, como "1500.00"',
  })
  tarifaPorHora?: string;
}
