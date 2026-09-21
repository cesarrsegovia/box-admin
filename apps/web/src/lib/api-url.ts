/**
 * Compone la URL de la API a partir de los segmentos que llegan al proxy.
 *
 * Este archivo es un CORTAFUEGOS, no una utilidad de concatenar cadenas. El
 * proxy corre en el servidor, dentro de la red donde vive la API; si aceptara
 * cualquier destino, cualquiera podria usarlo para que el servidor pida cosas
 * que el no alcanza desde su navegador (SSRF).
 *
 * Por eso vive aparte del handler y con sus propios tests: es la pieza que hay
 * que poder auditar de un vistazo.
 */

export class RutaInvalidaError extends Error {
  constructor(motivo: string) {
    super(`Ruta rechazada por el proxy: ${motivo}`);
    this.name = 'RutaInvalidaError';
  }
}

/**
 * Un segmento aceptable: letras, numeros, guion, guion bajo y punto.
 *
 * Deliberadamente estrecho. Todos los identificadores de la API son cuids y
 * todas sus rutas son palabras con guiones, asi que no hace falta nada mas — y
 * lo que no hace falta, no se admite. Esto solo ya descarta barras, dos puntos,
 * arrobas y bytes nulos, que son las formas habituales de escaparse del host.
 */
const SEGMENTO_VALIDO = /^[A-Za-z0-9._-]+$/;

export function urlDeApi(segmentos: string[], query: string): string {
  const base = process.env.API_URL;
  if (!base) {
    throw new RutaInvalidaError('API_URL no esta configurada');
  }

  if (segmentos.length === 0) {
    throw new RutaInvalidaError('sin segmentos');
  }

  for (const segmento of segmentos) {
    // Next ya decodifica los segmentos, pero un `%2e%2e` doblemente codificado
    // llegaria aqui como `%2e%2e` literal y pasaria un test ingenuo de "..".
    // Se comprueba tambien la forma decodificada.
    let decodificado: string;
    try {
      decodificado = decodeURIComponent(segmento);
    } catch {
      throw new RutaInvalidaError(`segmento mal codificado: ${segmento}`);
    }

    for (const forma of [segmento, decodificado]) {
      if (!SEGMENTO_VALIDO.test(forma)) {
        throw new RutaInvalidaError(`segmento con caracteres no admitidos: ${segmento}`);
      }
      if (forma === '.' || forma === '..') {
        throw new RutaInvalidaError(`subida de directorio: ${segmento}`);
      }
    }
  }

  const url = `${base.replace(/\/+$/, '')}/${segmentos.join('/')}${query}`;

  // Red de seguridad final. Si alguna de las reglas de arriba se quedara corta,
  // esto sigue garantizando que el destino cuelga del origen de la API.
  const destino = new URL(url);
  const origen = new URL(base);
  if (destino.origin !== origen.origin) {
    throw new RutaInvalidaError(`el destino sale del origen de la API: ${destino.origin}`);
  }

  return url;
}
