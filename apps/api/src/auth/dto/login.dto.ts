import { IsEmail, IsString, Length } from 'class-validator';

export class LoginDto {
  @IsString()
  @Length(2, 60)
  tenantSlug!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @Length(1, 200)
  password!: string;
}
