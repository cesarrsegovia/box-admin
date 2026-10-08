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

/**
 * La lista blanca, en un solo sitio.
 *
 * Esta extraida para poder aplicarse a TODO destino que salga de aqui, no solo
 * al que viene del query: la seguridad de una funcion no puede depender de
 * quien la llama.
 */
function esDestinoAceptable(ruta: string, slug: string): boolean {
  // `/\evil.com` y `\\evil.com`: los navegadores normalizan la barra invertida
  // a barra, asi que se comportan como `//evil.com` y salen del dominio. Se
  // rechaza la ruta entera, no solo el principio.
  if (ruta.includes('\\')) return false;

  // Un `\n` o un `\t` en medio sirve para disfrazar cualquiera de los casos de
  // abajo: el navegador los quita y queda otra URL distinta de la que se
  // comprobo aqui.
  if (CARACTER_DE_CONTROL.test(ruta)) return false;

  // Redundante con la comparacion del prefijo mientras el slug no sea vacio,
  // pero es la trampa concreta que esta funcion existe para evitar y no
  // depende de que el slug nunca llegue vacio.
  if (ruta.startsWith('//')) return false;

  // La barra final es lo que impide que un slug `gim` abra `/gimnasio-rival/x`.
  if (!ruta.startsWith(`/${slug}/`)) return false;

  // `/mi-gym/../otro-gimnasio/x` pasa el prefijo y el navegador lo normaliza
  // fuera del gimnasio. Ninguna ruta legitima lleva `..`.
  //
  // El camino se DECODIFICA antes de partirlo porque el parser del navegador
  // decodifica `%2e` a `.` antes de normalizar. Medido con `new URL`, no
  // deducido: `/mi-gym/%2e%2e/otro/x` resuelve a `/otro/x`, exactamente igual
  // que el `..` literal, y lo mismo las mezclas `.%2e` y `%2e.`.
  //
  // Se decodifica SOLO el camino, y SOLO para esta comparacion: las otras
  // comprobaciones siguen viendo la ruta cruda. Decodificar antes cambiaria
  // lo que ven todas.
  const camino = ruta.split(/[?#]/, 1)[0] ?? '';

  let caminoLegible: string;
  try {
    caminoLegible = decodeURIComponent(camino);
  } catch {
    // `decodeURIComponent` lanza `URIError` ante un `%` suelto o mal formado.
    // Rechazar es DELIBERADO, no un descuido al manejar el error: una ruta que
    // ni siquiera se puede decodificar no es una que nadie haya escrito con
    // buena intencion, y no hay motivo para llevar a nadie ahi.
    return false;
  }

  if (caminoLegible.split('/').includes('..')) return false;

  return true;
}

export function rutaDeRetornoSegura(
  volverA: string | undefined,
  slug: string,
  porDefecto = `/${slug}/calendario`,
): string {
  // `porDefecto` tambien acaba en un `router.push`, asi que tambien se mira.
  // Que hoy el unico llamador le pase un literal no es una defensa: es una
  // coincidencia, y las coincidencias no sobreviven tres fases.
  //
  // El calendario es el unico destino cableado aqui dentro y por eso el unico
  // que no puede mentir: es la red de la red.
  const respaldo = esDestinoAceptable(porDefecto, slug) ? porDefecto : `/${slug}/calendario`;

  if (!volverA) return respaldo;
  if (!esDestinoAceptable(volverA, slug)) return respaldo;

  return volverA;
}
