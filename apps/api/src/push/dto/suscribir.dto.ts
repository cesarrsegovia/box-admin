import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SuscribirDto {
  /** La URL del servicio de push del navegador. Larga y opaca. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  endpoint!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  p256dh!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  auth!: string;
}
