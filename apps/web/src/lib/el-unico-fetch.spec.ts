import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Donde corre el archivo, medido y no declarado: ver `dondeCorre`.
 *
 * La diferencia importa porque la promesa de `lib/cliente.ts` es sobre el
 * NAVEGADOR. Un `fetch` del servidor contra la API no es una excepcion a esa
 * promesa: es el otro lado del mostrador, y ahi el token esta en la mano.
 */
type Donde = 'navegador' | 'servidor';

interface Excepcion {
  donde: Donde;
  /** Cuantos sitios del archivo llaman al `fetch` global. */
  llamadas: number;
  /** Por que NO puede pasar por `pedir`. Si no hay respuesta, sobra. */
  porque: string;
}

/**
 * LOS UNICOS SITIOS DE `src/` QUE LLAMAN AL `fetch` GLOBAL POR FUERA DE
 * `pedir`, Y POR QUE CADA UNO NO PUEDE PASAR POR AHI.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTE ARCHIVO EXISTE.
 *
 * `lib/cliente.ts` se abria diciendo «el unico fetch del navegador en toda la
 * aplicacion». Era cierto el dia que se escribio y dejo de serlo cuatro fases
 * despues, en silencio, porque una medicion anotada en un comentario ENVEJECE
 * SIN AVISAR: parece documentacion, asi que nadie la vuelve a medir. Es la
 * tercera vez en tres fases que aparece esta misma forma de deuda, y las dos
 * anteriores se cerraron igual — con un test que cuenta.
 *
 * La auditoria del canal catorce la pillo midiendo el trafico de los 74 specs:
 * 467 peticiones, 371 de `pedir` y 96 de cinco sitios de produccion. Lo que
 * aquel numero NO podia ver es lo que ningun spec de jsdom ejecuta: el codigo
 * de SERVIDOR. Por eso este inventario no se hace corriendo tests sino LEYENDO
 * `src/` entero, y por eso encuentra diez archivos y no cinco.
 *
 * ---------------------------------------------------------------------------
 * COMO CUENTA, Y POR QUE ASI.
 *
 * Es el molde de `apps/api/src/common/guards/rutas-publicas.spec.ts`: no una
 * lista de archivos, sino una tabla de archivos CONTRA SU MOTIVO, comparada
 * ENTERA y EN LOS DOS SENTIDOS con lo que hay en el disco.
 *
 * - AGREGAR un `fetch` suelto deja la tabla corta. Es el error que importa: la
 *   proxima pantalla que hable con la red por su cuenta no pasa sin que
 *   alguien lo decida y lo escriba aqui.
 * - QUITAR uno deja la tabla larga, y eso tambien se dice: una excepcion que
 *   ya no existe es ruido que le hace creer al siguiente que el patron es
 *   normal.
 * - CAMBIAR el numero de llamadas de un archivo mueve la tabla sin cambiar la
 *   lista de archivos. Es el caso que no se ve venir — colar una segunda
 *   peticion en `boton-de-salir.tsx` no agrega ningun archivo nuevo— y es la
 *   razon de que `llamadas` este en la tabla y no solo el motivo.
 *
 * Y `donde` no se cree: se MIDE con la directiva del archivo y se compara con
 * lo declarado, porque la frase de `lib/cliente.ts` habla del navegador y
 * mezclar las dos mitades la volveria a dejar sin contenido.
 *
 * Tocar esta tabla tiene que costar, y tiene que verse en el diff.
 */
const EL_FETCH_GLOBAL_SE_LLAMA_EN: Record<string, Excepcion> = {
  // -------------------------------------------------------------------------
  // EN EL NAVEGADOR: las cuatro de verdad, las que la frase de `cliente.ts`
  // tiene que admitir.
  // -------------------------------------------------------------------------

  // Las tres rutas del BFF que ESCRIBEN la cookie httpOnly se llaman desde
  // aqui. No pueden pasar por `pedir`, que va a `/api/bx`: estas van a
  // `/api/auth/…`, que es el unico sitio del sistema que pone la cookie.
  'app/[slug]/(publico)/login/formulario-de-login.tsx': {
    donde: 'navegador',
    llamadas: 1,
    porque: 'POST /api/auth/login, la ruta del BFF que escribe la cookie httpOnly',
  },
  'app/[slug]/(publico)/registro/formulario-de-registro.tsx': {
    donde: 'navegador',
    llamadas: 1,
    porque: 'POST /api/auth/auto-registro, que escribe la cookie httpOnly',
  },
  'app/[slug]/(alumno)/perfil/boton-de-salir.tsx': {
    donde: 'navegador',
    llamadas: 1,
    porque: 'POST /api/auth/logout, que BORRA la cookie httpOnly',
  },

  // La unica que no habla con el propio servidor: sube el archivo crudo a la
  // URL firmada que la API acaba de dar. Mandar un comprobante de varios mega
  // por el proxy seria pasar un archivo por un sitio que no lo necesita.
  'hooks/use-comprobantes.ts': {
    donde: 'navegador',
    llamadas: 1,
    porque: 'PUT del archivo a la URL firmada del almacen, que no es la API',
  },

  // -------------------------------------------------------------------------
  // EN EL SERVIDOR: no son excepciones a la promesa de `cliente.ts`, son el
  // otro lado. Estan en la tabla igual porque el dia que una de ellas se mueva
  // a un componente de cliente, la unica forma de enterarse es que esta linea
  // cambie de `servidor` a `navegador` y el test lo diga.
  // -------------------------------------------------------------------------

  // EL PROXY. Es literalmente el destino de `pedir`: reenvia la peticion a la
  // API con el token de la cookie, y pide un par nuevo cuando esta vencido.
  'app/api/bx/[...ruta]/route.ts': {
    donde: 'servidor',
    llamadas: 2,
    porque: 'el proxy: reenvia a la API (1) y refresca el par de tokens (1)',
  },

  // Las tres rutas del BFF, vistas desde dentro. Hablan con la API directa
  // porque son ellas las que convierten la respuesta en cookie.
  'app/api/auth/login/route.ts': {
    donde: 'servidor',
    llamadas: 1,
    porque: 'POST /auth/login contra la API, para convertir el par en cookie',
  },
  'app/api/auth/auto-registro/route.ts': {
    donde: 'servidor',
    llamadas: 1,
    porque: 'POST /auth/auto-registro contra la API, idem',
  },
  'app/api/auth/logout/route.ts': {
    donde: 'servidor',
    llamadas: 1,
    porque: 'POST /auth/logout contra la API, para revocar el refresh',
  },

  // La landing publica, desde el servidor y con `credentials: 'omit'`: el
  // proxy existe para poner la cookie y aqui no hay ninguna que poner.
  'app/[slug]/page.tsx': {
    donde: 'servidor',
    llamadas: 1,
    porque: 'GET /public/salon/:slug sin sesion; el proxy no aporta nada',
  },

  // El rol, para las puertas de los layouts. Va contra la API y no por
  // `/api/bx` porque `/api/bx` ES el proxy del navegador, y esto corre en el
  // servidor con el token ya en la mano.
  'lib/sesion.ts': {
    donde: 'servidor',
    llamadas: 1,
    porque: 'GET /auth/me desde el servidor, que ya tiene el access token',
  },
};

/** La raiz de `src/`, que es este mismo directorio menos `lib`. */
const SRC = join(__dirname, '..');

/** Donde vive `pedir`. No es una excepcion: es la regla. */
const EL_CLIENTE = join(SRC, 'lib', 'cliente.ts');

/**
 * Los fuentes de PRODUCCION de `src/`.
 *
 * Fuera los `*.spec.*` y `src/test/` enteros: ahi se dobla el `fetch` global a
 * proposito —`vi.stubGlobal`, los espias, los cuatro canales— y contarlos
 * convertiria la tabla en un inventario de la instrumentacion. Y fuera
 * `lib/cliente.ts`, que es el sitio donde la llamada es correcta.
 */
function fuentesDeProduccion(directorio: string): string[] {
  return readdirSync(directorio, { withFileTypes: true }).flatMap((entrada) => {
    const ruta = join(directorio, entrada.name);

    if (entrada.isDirectory()) {
      return entrada.name === 'test' ? [] : fuentesDeProduccion(ruta);
    }
    if (ruta === EL_CLIENTE) return [];
    if (!/\.tsx?$/.test(entrada.name)) return [];
    if (/\.spec\.tsx?$/.test(entrada.name)) return [];

    return [ruta];
  });
}

/**
 * El texto sin comentarios.
 *
 * Hace falta porque medio repo HABLA de `fetch` en sus docblocks —este archivo
 * el primero— y un contador que los cuente daria una tabla de cincuenta
 * entradas que nadie mantendria. Se quitan los de bloque y los de linea.
 */
function sinComentarios(codigo: string): string {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Cuantas veces se llama al `fetch` GLOBAL en un fuente.
 *
 * SE EXPORTA SOLO PARA SU GUARDIAN, abajo en este mismo archivo, y por el
 * mismo motivo por el que el canal catorce exporta `vinoDePedir`: si esto
 * empezara a devolver 0 siempre —un parentesis de mas en la expresion, un
 * `.tsx` que deja de entrar— la tabla seguiria cuadrando VACIA contra una
 * tabla vacia, y el inventario quedaria ciego sin ponerse rojo.
 *
 * El `(?<!\w)` es lo unico fino: sin el, los cuarenta y pico `refetch()` de
 * React Query entran todos y la tabla pasa a tener treinta archivos. Con el,
 * `agenda.refetch()` y `void refetch()` quedan fuera y `await fetch(` entra.
 * Las formas calificadas —`window.fetch(`, `globalThis.fetch(`— se cuentan a
 * proposito: son el mismo global escrito de la manera que esquivaria un
 * contador ingenuo.
 */
export function llamadasAlFetchGlobal(codigo: string): number {
  const agujas = /(?<!\w)(?:(?:window|globalThis|global|self)\s*\.\s*)?fetch\s*\(/g;

  return sinComentarios(codigo).match(agujas)?.length ?? 0;
}

/**
 * Si el archivo se empaqueta para el navegador, leido de la DIRECTIVA.
 *
 * LIMITACION CONOCIDA, escrita para que quien la rompa sepa por que: un modulo
 * SIN `'use client'` que solo se importe desde componentes de cliente tambien
 * acaba en el navegador, y aqui saldria como `servidor`. Hoy los diez archivos
 * de la tabla se clasifican bien —los seis del servidor usan `next/headers`,
 * `next/server` o son `route.ts`— y perseguir el grafo de imports para cubrir
 * el caso hipotetico costaria mas de lo que vale. Lo que esta medida SI
 * garantiza es la direccion peligrosa: ponerle `'use client'` a uno de los seis
 * lo mueve a `navegador` y el test lo canta.
 */
function dondeCorre(codigo: string): Donde {
  return /^\s*(['"])use client\1/.test(codigo) ? 'navegador' : 'servidor';
}

function inventario(): Record<string, Excepcion> {
  const encontradas: Record<string, Excepcion> = {};

  for (const archivo of fuentesDeProduccion(SRC)) {
    const codigo = readFileSync(archivo, 'utf8');
    const llamadas = llamadasAlFetchGlobal(codigo);
    if (llamadas === 0) continue;

    // Barras al derecho siempre: en Windows `relative` devuelve `lib\sesion.ts`
    // y la tabla quedaria entera en rojo por el separador. Es la misma trampa
    // que se comio la primera sonda del canal catorce.
    const clave = relative(SRC, archivo).replace(/\\/g, '/');

    encontradas[clave] = {
      donde: dondeCorre(codigo),
      llamadas,
      porque: EL_FETCH_GLOBAL_SE_LLAMA_EN[clave]?.porque ?? '(sin motivo declarado)',
    };
  }

  return encontradas;
}

function soloDel(donde: Donde, tabla: Record<string, Excepcion>): string[] {
  return Object.keys(tabla)
    .filter((clave) => tabla[clave]?.donde === donde)
    .sort();
}

describe('el inventario del `fetch` por fuera de `pedir`', () => {
  it('estos archivos, y SOLO estos, llaman al fetch global, y esto los justifica', () => {
    expect(inventario()).toEqual(EL_FETCH_GLOBAL_SE_LLAMA_EN);
  });

  /**
   * LA FRASE CON LA QUE SE ABRE `lib/cliente.ts`, CONVERTIDA EN TEST.
   *
   * El docblock de ahi ya no dice «el unico fetch del navegador» a secas: dice
   * que hay cuatro excepciones y que estan contadas aqui. Esta es la linea que
   * hace que esa frase deje de poder envejecer sola.
   */
  it('en el NAVEGADOR son exactamente estos cuatro sitios, y ninguno habla con la API', () => {
    expect(soloDel('navegador', inventario())).toEqual([
      'app/[slug]/(alumno)/perfil/boton-de-salir.tsx',
      'app/[slug]/(publico)/login/formulario-de-login.tsx',
      'app/[slug]/(publico)/registro/formulario-de-registro.tsx',
      'hooks/use-comprobantes.ts',
    ]);
  });

  /**
   * EL CASO QUE IMPIDE QUE LA TABLA CUADRE VACIA.
   *
   * Un inventario que no encuentra nada compara `{}` contra `{}` el dia que
   * alguien borra la tabla, y contra una tabla llena se pondria rojo — pero el
   * modo de fallo real es el otro: que el contador deje de contar. Si esto
   * mide 0 llamadas en el unico archivo donde la llamada es SEGURA que existe,
   * el inventario entero es decorativo.
   */
  it('el contador encuentra el `fetch` de `pedir`, que es el que nunca falta', () => {
    expect(llamadasAlFetchGlobal(readFileSync(EL_CLIENTE, 'utf8'))).toBeGreaterThan(0);
  });

  it('y el barrido NO incluye a `lib/cliente.ts`, que es la regla y no la excepcion', () => {
    expect(Object.keys(inventario())).not.toContain('lib/cliente.ts');
  });
});

/**
 * EL GUARDIAN DEL CONTADOR.
 *
 * Mismo caso que `relojes-falsos.spec.ts` y que el alfabeto de centinelas: la
 * aritmetica del `(?<!\w)` y el recorte de comentarios son INVISIBLES desde
 * fuera. Las dos «simplificaciones» razonables —quitar el look-behind, o
 * contar sobre el texto crudo— dejan el inventario inservible sin poner rojo
 * ninguno de los otros tests de este archivo: con una tabla al tamaño
 * equivocado, lo unico que pasa es que alguien agranda la tabla.
 */
describe('como cuenta el contador', () => {
  it('cuenta una llamada normal', () => {
    expect(llamadasAlFetchGlobal('const r = await fetch(url);')).toBe(1);
  });

  it('cuenta las formas calificadas, que son el mismo global', () => {
    expect(llamadasAlFetchGlobal('window.fetch(u); globalThis.fetch(u); self.fetch(u);')).toBe(3);
  });

  it('NO cuenta `refetch`, que es de React Query y hay cuarenta', () => {
    expect(llamadasAlFetchGlobal('void agenda.refetch(); const x = refetch();')).toBe(0);
  });

  it('NO cuenta lo que solo se NOMBRA en un comentario de linea', () => {
    expect(llamadasAlFetchGlobal('// aqui habria que llamar a fetch(url)')).toBe(0);
  });

  it('NO cuenta lo que solo se nombra en un docblock', () => {
    expect(llamadasAlFetchGlobal('/**\n * No se llama a fetch(x) aqui.\n */\nconst a = 1;')).toBe(
      0,
    );
  });

  it('cuenta la llamada de verdad aunque el archivo hable de fetch en su docblock', () => {
    const codigo = '/** Envuelve a fetch(). */\nexport async function f() {\n  return fetch(u);\n}';
    expect(llamadasAlFetchGlobal(codigo)).toBe(1);
  });

  it('una URL con `//` dentro no se come el resto de la linea', () => {
    // El recorte de comentarios de linea es el sitio donde esto se rompe: un
    // `replace(/\/\/.*$/gm, '')` sin mas deja `const u = 'https:` y se lleva
    // por delante cualquier llamada escrita despues en esa misma linea.
    expect(llamadasAlFetchGlobal("const u = 'https://api.test'; await fetch(u);")).toBe(1);
  });
});
