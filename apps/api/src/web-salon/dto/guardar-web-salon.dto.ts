import { IsBoolean, IsHexColor, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

/**
 * El PUT es un REEMPLAZO COMPLETO, no un parche.
 *
 * Un campo que no venga queda en su valor por defecto (null, o el `@default`
 * del schema), igual que hace `guardarSmtp` desde la Fase 5B. Es lo que permite
 * que el admin BORRE el tagline mandando el formulario sin el; con semantica de
 * parche no habria forma de vaciar un campo sin inventar un centinela.
 */
export class GuardarWebSalonDto {
  /**
   * El interruptor general. Apagado, el endpoint publico da el mismo 404 que un
   * slug inexistente.
   */
  @IsOptional()
  @IsBoolean()
  activa?: boolean;

  /**
   * `@IsHexColor` y no un string cualquiera: estos dos valores acaban en una
   * variable CSS de una pagina publica. Validarlos aqui es lo que permite que
   * la landing los interpole sin pensar.
   */
  @IsOptional()
  @IsHexColor()
  colorPrimario?: string;

  @IsOptional()
  @IsHexColor()
  colorSecundario?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  tituloPrincipal?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  tagline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  sobreElSalon?: string;

  /**
   * URL EXTERNA Y HTTPS, las dos cosas comprobadas.
   *
   * `require_protocol` + `protocols: ['https']` rechaza las tres formas que
   * importan: `javascript:alert(1)` (el esquema no esta en la lista), `http://`
   * (idem) y `ejemplo.com` a secas (sin protocolo). Un `javascript:` en el
   * `src` de una imagen de una pagina publica es XSS almacenado, y un `http://`
   * en una pagina servida por https es contenido mixto que el navegador bloquea
   * sin decirle nada al gimnasio.
   *
   * Para BORRAR la imagen se omite el campo, no se manda ''. El PUT es un
   * reemplazo completo, asi que lo que no viene queda en null.
   */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @IsUrl({ protocols: ['https'], require_protocol: true })
  imagenPrincipalUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  whatsapp?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  instagram?: string;

  /**
   * El "otro enlace" que el gimnasio quiera poner. Mismo criterio que la
   * imagen: sale en un `href` de una pagina publica, asi que https o nada.
   */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @IsUrl({ protocols: ['https'], require_protocol: true })
  linkExtra?: string;

  @IsOptional()
  @IsBoolean()
  mostrarPrecios?: boolean;

  @IsOptional()
  @IsBoolean()
  mostrarTestimonios?: boolean;

  @IsOptional()
  @IsBoolean()
  mostrarFAQ?: boolean;

  /**
   * OJO: publica la agenda del gimnasio y cuan vacia esta. Es una decision de
   * negocio, no un detalle de presentacion, y por eso viene apagada.
   */
  @IsOptional()
  @IsBoolean()
  mostrarTurnosLibres?: boolean;

  /**
   * El pack que la landing marca como destacado. El service comprueba que sea
   * de ESTE gimnasio antes de escribirlo: la FK compuesta ya lo impide en la
   * base, pero su violacion llega como un error de Postgres que nadie traduce y
   * sale como un 500 opaco en vez de un 400 que explica que pasa.
   */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  planDestacadoId?: string;
}
