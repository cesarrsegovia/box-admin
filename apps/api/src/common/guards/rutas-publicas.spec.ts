import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { THROTTLER_LIMIT, THROTTLER_TTL } from '@nestjs/throttler/dist/throttler.constants';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { LIMITE_AUTH, TTL_AUTH } from '../throttling';

/** El freno estricto de las rutas de auth, tal y como lo declara `@Throttle`. */
const FRENO_DE_AUTH = { ttl: TTL_AUTH, limite: LIMITE_AUTH };

/** Solo el limite general del ThrottlerModule; la ruta no declara el suyo. */
const FRENO_GENERAL = null;

interface Defensa {
  /** Los guards que la ruta declara con `@UseGuards`, por nombre de clase. */
  guards: string[];
  /** El `@Throttle` propio de la ruta, o `null` si no declara ninguno. */
  freno: { ttl: number; limite: number } | null;
}

/**
 * LAS UNICAS RUTAS DE LA API QUE NO PIDEN JWT, Y QUE LAS PROTEGE EN SU LUGAR.
 *
 * No es una lista de rutas: es una tabla de rutas CONTRA SU DEFENSA, y esa es
 * la diferencia que la hace valer. Una entrada que diga "sin JWT" y nada mas
 * no distingue `POST /auth/tenants` —crear un inquilino, el peor endpoint del
 * sistema para dejar abierto— de la landing, que no tiene nada que proteger.
 *
 * Se compara en los dos sentidos y entera:
 *
 * - QUITAR un `@Public()` deja la tabla corta. Sin esto, borrar el del endpoint
 *   publico del salon dejaba tsc limpio y 1283 unitarios y 179 e2e en verde, y
 *   la landing se caia entera en produccion sin que nada avisara: un `grep` de
 *   `IS_PUBLIC|@Public` en los specs de la API daba cero.
 * - PONER un `@Public()` de mas deja la tabla larga, y ese es el error
 *   peligroso de los dos: abre al mundo un endpoint con datos de un gimnasio
 *   sin que nadie lo decida. Un test puntual sobre un handler concreto no lo ve
 *   nunca; este si.
 * - QUITAR LA DEFENSA y dejar el `@Public()` no cambia la lista de rutas pero
 *   si esta tabla. Es el caso que no se ve venir: el `@Public()` de
 *   `/auth/tenants` y `/auth/register` es correcto —al arrancar no hay ningun
 *   usuario con el que autenticarse—, y lo unico que impide que cualquiera
 *   cree inquilinos es el `BootstrapKeyGuard`. Sin este fichero, quitarlo no
 *   rompia nada.
 *
 * Tocar esta tabla tiene que costar, y tiene que verse en el diff.
 */
const RUTAS_SIN_SESION: Record<string, Defensa> = {
  // Montaje de la instalacion: resuelven el huevo y la gallina, porque al
  // inicio no existe ningun usuario. La clave de arranque del .env hace de
  // credencial.
  'POST /auth/tenants': { guards: ['BootstrapKeyGuard'], freno: FRENO_GENERAL },
  'POST /auth/register': { guards: ['BootstrapKeyGuard'], freno: FRENO_GENERAL },

  // Quien las llama todavia no tiene sesion, por definicion. Lo que las
  // protege es el freno estricto: cinco intentos por IP y minuto hacen
  // inviable adivinar por fuerza bruta un codigo de invitacion de 32
  // hexadecimales, o una contrasena.
  'POST /auth/auto-registro': { guards: [], freno: FRENO_DE_AUTH },
  'POST /auth/login': { guards: [], freno: FRENO_DE_AUTH },
  'POST /auth/refresh': { guards: [], freno: FRENO_DE_AUTH },

  // El almacen local. Su defensa NO es un guard ni un freno, sino una firma
  // HMAC con caducidad que comprueba el propio handler (`exigirFirma`): la
  // firma ES la credencial, como en una URL presignada de S3. Ademas este
  // controller solo se registra cuando ALMACEN_TIPO es `local`; en produccion
  // estas dos rutas no existen.
  'PUT /archivos-locales/:clave': { guards: [], freno: FRENO_GENERAL },
  'GET /archivos-locales/:clave': { guards: [], freno: FRENO_GENERAL },

  // La landing. EL UNICO ENDPOINT SIN SESION QUE LEE DATOS DE UN GIMNASIO, y
  // la unica entrada de la tabla que no tiene ninguna credencial detras, a
  // proposito: lo que la defiende no es una puerta sino el contenido —los
  // cuatro caminos de "no hay web" devuelven la misma respuesta, asi que no
  // hay directorio de gimnasios que enumerar, y cada campo que sale esta
  // escrito a mano en `publico.service.ts`.
  'GET /public/salon/:slug': { guards: [], freno: FRENO_GENERAL },
};

/**
 * Todos los `*.controller.ts` de la API, buscados y no enumerados a mano.
 *
 * LIMITACION CONOCIDA: solo ve clases EXPORTADAS desde un archivo que acabe en
 * `.controller.ts`. Un controller registrado desde un `.module.ts` pero
 * definido en un archivo con otro nombre se le escaparia. Hoy son 25 de 25 y
 * no merece la pena perseguir el caso hipotetico; queda escrito para que quien
 * lo rompa sepa por que.
 */
function archivosDeControllers(directorio: string): string[] {
  return readdirSync(directorio, { withFileTypes: true }).flatMap((entrada) => {
    const ruta = join(directorio, entrada.name);
    if (entrada.isDirectory()) return archivosDeControllers(ruta);
    return entrada.name.endsWith('.controller.ts') ? [ruta] : [];
  });
}

function comoLista(valor: unknown): string[] {
  if (Array.isArray(valor)) return valor as string[];
  return [typeof valor === 'string' ? valor : ''];
}

function unir(base: string, resto: string): string {
  const partes = [base, resto].flatMap((parte) => parte.split('/')).filter((parte) => parte !== '');

  return `/${partes.join('/')}`;
}

/** Los `@UseGuards` de la clase y del handler, por nombre, como los lee Nest. */
function guardsDe(clase: object, handler: object): string[] {
  return [
    ...((Reflect.getMetadata(GUARDS_METADATA, clase) as unknown[] | undefined) ?? []),
    ...((Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[] | undefined) ?? []),
  ].map((guard) => (typeof guard === 'function' ? guard.name : (guard as object).constructor.name));
}

/**
 * El `@Throttle({ default: ... })` propio del handler, o `null`.
 *
 * Se leen las dos claves que escribe el decorador, no el decorador: asi,
 * cambiar el limite estricto de auth por el general tambien cae, no solo
 * borrarlo entero.
 */
function frenoDe(handler: object): Defensa['freno'] {
  const ttl: unknown = Reflect.getMetadata(`${THROTTLER_TTL}default`, handler);
  const limite: unknown = Reflect.getMetadata(`${THROTTLER_LIMIT}default`, handler);

  if (typeof ttl !== 'number' || typeof limite !== 'number') return null;

  return { ttl, limite };
}

/**
 * Las rutas marcadas `@Public()`, leidas de los METADATOS con `Reflector` y no
 * del texto de los archivos.
 *
 * Es la misma lectura que hace `JwtAuthGuard` en produccion —misma clave, mismo
 * `getAllAndOverride`, mismos dos objetivos— asi que un `@Public()` puesto en
 * la CLASE en vez de en el handler tambien aparece aqui, igual que el guard lo
 * honraria. Un `grep` del fichero no distinguiria eso de un comentario.
 */
function inventario(): Record<string, Defensa> {
  const reflector = new Reflector();
  const encontradas: Record<string, Defensa> = {};

  for (const archivo of archivosDeControllers(join(__dirname, '..', '..'))) {
    const modulo = require(archivo) as Record<string, unknown>;

    for (const exportado of Object.values(modulo)) {
      if (typeof exportado !== 'function') continue;

      const clase = exportado as new (...args: never[]) => object;
      const basePath: unknown = Reflect.getMetadata(PATH_METADATA, clase);
      if (basePath === undefined) continue;

      for (const nombre of Object.getOwnPropertyNames(clase.prototype)) {
        if (nombre === 'constructor') continue;

        const handler = (clase.prototype as Record<string, unknown>)[nombre];
        if (typeof handler !== 'function') continue;

        const metodo: unknown = Reflect.getMetadata(METHOD_METADATA, handler);
        if (metodo === undefined) continue;

        const esPublica = reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [handler, clase]);
        if (!esPublica) continue;

        const defensa: Defensa = { guards: guardsDe(clase, handler), freno: frenoDe(handler) };
        const verbo = RequestMethod[metodo as RequestMethod];

        for (const base of comoLista(basePath)) {
          for (const sufijo of comoLista(Reflect.getMetadata(PATH_METADATA, handler))) {
            encontradas[`${verbo} ${unir(base, sufijo)}`] = defensa;
          }
        }
      }
    }
  }

  return encontradas;
}

describe('El inventario de rutas sin sesion', () => {
  it('estas rutas, y SOLO estas, no piden JWT, y esto es lo que las protege', () => {
    expect(inventario()).toEqual(RUTAS_SIN_SESION);
  });

  it('crear un inquilino NO esta abierto a internet', () => {
    // Dicho de frente porque es el peor estado posible del sistema, y porque
    // el `@Public()` de estas dos es CORRECTO: al arrancar no hay ningun
    // usuario con el que autenticarse. Lo unico que las cierra es la clave de
    // arranque, y sin este caso quitarla no rompia nada.
    expect(inventario()['POST /auth/tenants']?.guards).toEqual(['BootstrapKeyGuard']);
    expect(inventario()['POST /auth/register']?.guards).toEqual(['BootstrapKeyGuard']);
  });

  it('las rutas de auth sin sesion llevan el freno ESTRICTO, no el general', () => {
    // El limite general (300 por minuto) no frena una fuerza bruta contra el
    // login ni contra un codigo de invitacion. Degradar una de estas tres al
    // general no cambia ninguna lista de rutas: cambia esto.
    for (const ruta of ['POST /auth/login', 'POST /auth/refresh', 'POST /auth/auto-registro']) {
      expect(inventario()[ruta]?.freno).toEqual(FRENO_DE_AUTH);
    }
  });

  it('la landing esta en el inventario, y por tanto en los metadatos', () => {
    // El endpoint publico del salon NO pide sesion. Quitarle el `@Public()` lo
    // deja detras del JwtAuthGuard global y la landing deja de cargar para
    // todo el mundo.
    expect(Object.keys(inventario())).toContain('GET /public/salon/:slug');
  });
});
