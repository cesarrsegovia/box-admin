import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class MarcarPresenteDto {
  /**
   * La firma que venia en el QR (`?f=` de la URL impresa).
   *
   * `MaxLength` generoso y no exacto: el largo real de una firma valida es
   * fijo (43 caracteres, el base64url de un SHA-256 sin relleno) y lo comprueba
   * `verificarFirma`. Aqui solo se corta lo absurdo, para no pasarle a la
   * funcion de verificacion un megabyte de basura.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  firma!: string;
}
