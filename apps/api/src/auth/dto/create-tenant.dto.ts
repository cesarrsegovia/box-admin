import { IsString, Length, Matches } from 'class-validator';

export class CreateTenantDto {
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
