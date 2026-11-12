import { IsEmail, IsString, Length } from 'class-validator';
import { Recortado } from '../../common/decorators/recortado.decorator';

export class RegisterDto {
  @IsString()
  @Length(2, 60)
  tenantSlug!: string;

  @Recortado()
  @IsString()
  @Length(2, 160)
  nombreCompleto!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @Length(10, 200)
  password!: string;
}
