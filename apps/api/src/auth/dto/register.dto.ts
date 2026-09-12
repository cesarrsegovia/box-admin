import { IsEmail, IsString, Length } from 'class-validator';

export class RegisterDto {
  @IsString()
  @Length(2, 60)
  tenantSlug!: string;

  @IsString()
  @Length(2, 160)
  nombreCompleto!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @Length(10, 200)
  password!: string;
}
