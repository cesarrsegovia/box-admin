/**
 * Los `href` y los `src` de la landing publica, a partir de lo que escribio el
 * admin.
 *
 * Mismo criterio que `color-seguro.ts`: la API ya valida (`@IsUrl` con
 * `protocols: ['https']`), y aqui se vuelve a validar. No por desconfiar de
 * ese DTO, sino porque el dia que alguien lo relaje, o siembre la base a mano,
 * o cambie de donde salen estos datos, la landing no se puede quedar sin
 * ninguna defensa. Dos validaciones que se apoyan la una en la otra son cero.
 *
 * `whatsapp` e `instagram` NO son URLs en la API: son un telefono y un usuario
 * sueltos. El `href` lo arma esta pieza, asi que es ella la que tiene que
 * garantizar a donde apunta.
 */

/**
 * La URL si es https, y `null` si no.
 *
 * El esquema es toda la defensa: un `javascript:` en el `src` de la imagen de
 * portada es XSS almacenado en el sitio del gimnasio, y un `http://` en una
 * pagina servida por https es contenido mixto que el navegador bloquea en
 * silencio.
 *
 * Devuelve `url.href` y no la cadena original a proposito: lo que sale es lo
 * que el parser entendio, no lo que venia escrito. Si las dos cosas no
 * coinciden, la que vale es la que se compruebo.
 */
export function urlHttps(valor: string): string | null {
  if (typeof valor !== 'string') return null;

  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    return null;
  }

  return url.protocol === 'https:' ? url.href : null;
}

/** Entre 6 y 20 digitos: lo que cabe en un numero de telefono de verdad. */
const MINIMO_DE_DIGITOS = 6;
const MAXIMO_DE_DIGITOS = 20;

/**
 * El enlace de WhatsApp a partir de un telefono escrito como sea.
 *
 * Se CONSTRUYE con los digitos, no se reutiliza lo que vino. Da igual lo que
 * el admin escriba: lo unico que puede llegar al `href` son digitos detras de
 * `https://wa.me/`, asi que el enlace no puede apuntar a otro sitio.
 */
export function enlaceDeWhatsapp(valor: string): string | null {
  if (typeof valor !== 'string') return null;

  const digitos = valor.replace(/\D/g, '');
  if (digitos.length < MINIMO_DE_DIGITOS || digitos.length > MAXIMO_DE_DIGITOS) return null;

  return `https://wa.me/${digitos}`;
}

/** Lo que Instagram admite en un usuario: letras, numeros, punto y guion bajo. */
const USUARIO_DE_INSTAGRAM = /^[A-Za-z0-9._]{1,30}$/;

/** `instagram.com` y sus subdominios, y nada que simplemente termine asi. */
function esDeInstagram(host: string): boolean {
  return host === 'instagram.com' || host.endsWith('.instagram.com');
}

/**
 * El enlace de Instagram, tanto si escribieron el usuario como si pegaron la
 * URL entera —que es lo que hace la mitad de la gente—.
 */
export function enlaceDeInstagram(valor: string): string | null {
  if (typeof valor !== 'string') return null;

  const limpio = valor.trim();

  // Si parece una URL, tiene que ser una de Instagram. `notinstagram.com` y
  // `instagram.com.evil.example` no lo son, por mucho que una comparacion
  // descuidada con `endsWith` los deje pasar.
  if (limpio.includes('/') || limpio.includes(':')) {
    const url = urlHttps(limpio);
    if (url === null) return null;

    return esDeInstagram(new URL(url).host) ? url : null;
  }

  const usuario = limpio.startsWith('@') ? limpio.slice(1) : limpio;
  if (!USUARIO_DE_INSTAGRAM.test(usuario)) return null;

  return `https://instagram.com/${usuario}`;
}

/**
 * El texto visible del enlace de Instagram, sacado del enlace YA VALIDADO.
 *
 * No del valor crudo: si el admin pego la URL entera, enseñar lo que escribio
 * daria un `@https://instagram.com/migym`. Se saca del destino, que a estas
 * alturas se sabe que es de Instagram.
 */
export function usuarioDeInstagram(enlace: string): string {
  const ruta = new URL(enlace).pathname.replace(/^\/+|\/+$/g, '');

  return ruta === '' ? 'Instagram' : `@${ruta}`;
}
