import { IsString, Length, Matches } from 'class-validator';
import { Recortado } from '../../common/decorators/recortado.decorator';

export class CreateTenantDto {
  @Recortado()
  @IsString()
  @Length(2, 120)
  nombre!: string;

  @IsString()
  @Length(2, 60)
  @Matches(/^[a-z0-9-]+$/, {
    message: 'El slug solo admite minusculas, numeros y guiones',
  })
  slug!: string;
}
