/**
 * A donde se vuelve despues de pasar por el login.
 *
 * Esto es un OPEN REDIRECT esperando a pasar: el destino viene del query
 * (`?volverA=`), o sea de quien haya escrito el enlace, y acaba en un
 * `router.push`. Un atacante que consiga `/mi-gym/login?volverA=https://evil`
 * tiene una pagina de phishing alojada en el dominio del gimnasio, con la
 * credibilidad del dominio del gimnasio.
 *
 * Por eso la regla es LISTA BLANCA y no lista negra: se acepta unicamente una
 * ruta relativa que empiece exactamente por `/<slug>/`, y todo lo demas cae al
 * calendario. Una lista negra ("si empieza por http...") siempre se queda
 * corta: `//evil.com` no empieza por http y se va igual de dominio.
 *
 * Vive en `lib/` y con sus propios tests, como `api-url.ts`: es una pieza de
 * seguridad que tiene que poder auditarse de un vistazo.
 */

/** Caracteres de control: el navegador los BORRA de la URL antes de resolverla. */
const CARACTER_DE_CONTROL = /[\u0000-\u001f\u007f]/;

export function rutaDeRetornoSegura(volverA: string | undefined, slug: string): string {
  // El calendario es la casa del alumno y es el destino que el login ya tenia
  // antes de que existiera `volverA`.
  const porDefecto = `/${slug}/calendario`;

  if (!volverA) return porDefecto;

  // `/\evil.com` y `\\evil.com`: los navegadores normalizan la barra invertida
  // a barra, asi que se comportan como `//evil.com` y salen del dominio. Se
  // rechaza la ruta entera, no solo el principio.
  if (volverA.includes('\\')) return porDefecto;

  // Un `\n` o un `\t` en medio sirve para disfrazar cualquiera de los casos de
  // abajo: el navegador los quita y queda otra URL distinta de la que se
  // comprobo aqui.
  if (CARACTER_DE_CONTROL.test(volverA)) return porDefecto;

  // Redundante con la comparacion del prefijo mientras el slug no sea vacio,
  // pero es la trampa concreta que esta funcion existe para evitar y no
  // depende de que el slug nunca llegue vacio.
  if (volverA.startsWith('//')) return porDefecto;

  // La barra final es lo que impide que un slug `gim` abra `/gimnasio-rival/x`.
  if (!volverA.startsWith(`/${slug}/`)) return porDefecto;

  // `/mi-gym/../otro-gimnasio/x` pasa el prefijo y el navegador lo normaliza
  // fuera del gimnasio. Ninguna ruta legitima lleva `..`.
  const camino = volverA.split(/[?#]/, 1)[0] ?? '';
  if (camino.split('/').includes('..')) return porDefecto;

  return volverA;
}
