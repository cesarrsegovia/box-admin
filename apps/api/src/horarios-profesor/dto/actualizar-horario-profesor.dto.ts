import { IsBoolean, IsInt, IsOptional, Matches, Max, Min, ValidateIf } from 'class-validator';
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

  /**
   * TRES ESTADOS, NO DOS: ausente, `null`, y una fecha.
   *
   * - **ausente** = «no toques la vigencia».
   * - **`null`** = «indefinido», que es un valor LEGITIMO y el estado normal de
   *   casi todos los horarios: la columna es nullable y `aHorarioPublico` lo
   *   devuelve como `null`.
   * - **una fecha** = la vigencia termina ahi.
   *
   * `@ValidateIf` y no `@IsOptional` a secas, por la misma razon que
   * `AsignarProfesorDto` lo usa para `profesorId: null`: el null es un valor que
   * el cliente manda a proposito y hay que distinguirlo de «no vino la clave».
   * La condicion deja fuera tambien `undefined` porque esta propiedad SI es
   * opcional —ausente significa otra cosa que null—, y sin eso `@Matches` se
   * ejecutaria sobre `undefined` y un PATCH que no toca la vigencia se caeria
   * con un 400.
   *
   * SIN ESTO NO HAY REACTIVACION. `DELETE /horarios-profesor/:id` da de baja y
   * ADEMAS cierra el `hasta` en hoy, asi que un horario reactivado sin poder
   * volver a abrir la vigencia deja de etiquetar turnos a partir de manana —en
   * silencio, porque la API contesta 200—.
   */
  @ValidateIf((_objeto, valor) => valor !== null && valor !== undefined)
  @Matches(PATRON_FECHA, { message: 'hasta debe tener formato YYYY-MM-DD' })
  hasta?: string | null;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @IsOptional()
  @Matches(PATRON_TARIFA, {
    message: 'tarifaPorHora debe ser un numero con hasta 2 decimales, como "1500.00"',
  })
  tarifaPorHora?: string;
}
