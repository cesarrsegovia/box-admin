import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { RutaInvalidaError, urlDeApi } from '@/lib/api-url';
import {
  COOKIE_ACCESS,
  COOKIE_REFRESH,
  VIDA_ACCESS,
  VIDA_REFRESH,
  borrarCookiesDeSesion,
  opcionesDeCookie,
} from '@/lib/cookies';

/**
 * Proxy generico hacia la API.
 *
 * Existe para que el token nunca llegue al navegador: el JavaScript de la
 * pagina llama a `/api/bx/lo-que-sea` sin credenciales, y es este handler —en
 * el servidor— quien añade el Authorization desde la cookie httpOnly.
 *
 * Es generico a proposito: un handler por endpoint serian veinte archivos casi
 * identicos. El precio es que la validacion del destino tiene que ser seria, y
 * por eso vive en `lib/api-url.ts` con sus propios tests.
 */

/** Cabeceras que NO se reenvian a la API. */
const CABECERAS_A_OMITIR = new Set([
  // La pone el proxy desde la cookie; la que venga del cliente se ignora.
  'authorization',
  // Las cookies del navegador no son asunto de la API.
  'cookie',
  // Las recalcula fetch; reenviarlas produce respuestas truncadas o corruptas.
  'host',
  'connection',
  'content-length',
  'accept-encoding',
]);

/**
 * Cabeceras que NO se devuelven al navegador.
 *
 * `content-encoding` y `content-length` describen el cuerpo tal como salio de
 * la API; al reenviar el stream por otro canal dejan de ser ciertas y el
 * navegador corta la respuesta a medias.
 */
const CABECERAS_A_NO_DEVOLVER = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
]);

function cabecerasParaLaApi(req: NextRequest, accessToken: string): Headers {
  const salida = new Headers();

  req.headers.forEach((valor, nombre) => {
    if (!CABECERAS_A_OMITIR.has(nombre.toLowerCase())) salida.set(nombre, valor);
  });
  salida.set('authorization', `Bearer ${accessToken}`);

  return salida;
}

function cabecerasParaElNavegador(respuesta: Response): Headers {
  const salida = new Headers();

  respuesta.headers.forEach((valor, nombre) => {
    if (!CABECERAS_A_NO_DEVOLVER.has(nombre.toLowerCase())) salida.set(nombre, valor);
  });

  return salida;
}

async function reenviar(
  req: NextRequest,
  url: string,
  accessToken: string,
  cuerpo: string | undefined,
): Promise<Response> {
  return fetch(url, {
    method: req.method,
    headers: cabecerasParaLaApi(req, accessToken),
    body: cuerpo,
    // El proxy sigue la cadena el mismo: dejar que fetch redirija podria
    // llevarlo fuera del origen de la API sin pasar por el cortafuegos.
    redirect: 'manual',
    cache: 'no-store',
  });
}

/**
 * Pide un par de tokens nuevo. Devuelve null si el refresh ya no sirve.
 */
async function refrescar(
  refreshToken: string,
): Promise<{ access: string; refresh: string } | null> {
  const respuesta = await fetch(urlDeApi(['auth', 'refresh'], ''), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
    cache: 'no-store',
  });

  if (!respuesta.ok) return null;

  const datos = (await respuesta.json()) as { accessToken: string; refreshToken: string };
  return { access: datos.accessToken, refresh: datos.refreshToken };
}

async function manejar(
  req: NextRequest,
  ctx: { params: Promise<{ ruta: string[] }> },
): Promise<NextResponse> {
  const { ruta } = await ctx.params;

  let url: string;
  try {
    url = urlDeApi(ruta, new URL(req.url).search);
  } catch (error) {
    if (error instanceof RutaInvalidaError) {
      return NextResponse.json({ message: error.message }, { status: 400 });
    }
    throw error;
  }

  const almacen = await cookies();
  const access = almacen.get(COOKIE_ACCESS)?.value;
  const refresh = almacen.get(COOKIE_REFRESH)?.value;

  if (!access) {
    return NextResponse.json({ message: 'Sin sesion' }, { status: 401 });
  }

  // El cuerpo se lee UNA vez: un Request no se puede consumir dos veces, y el
  // reintento tras el refresh necesita volver a mandarlo.
  const cuerpo = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text();

  let respuesta = await reenviar(req, url, access, cuerpo);

  // Un 401 puede ser simplemente que el access token caduco. Se intenta el
  // refresh UNA vez: si tambien falla, la sesion se acabo de verdad.
  if (respuesta.status === 401 && refresh) {
    const nuevos = await refrescar(refresh);

    if (!nuevos) {
      const fin = NextResponse.json({ message: 'Sesion expirada' }, { status: 401 });
      borrarCookiesDeSesion(fin.cookies);
      return fin;
    }

    respuesta = await reenviar(req, url, nuevos.access, cuerpo);

    const conTokens = new NextResponse(respuesta.body, {
      status: respuesta.status,
      headers: cabecerasParaElNavegador(respuesta),
    });
    conTokens.cookies.set(COOKIE_ACCESS, nuevos.access, opcionesDeCookie(VIDA_ACCESS));
    conTokens.cookies.set(COOKIE_REFRESH, nuevos.refresh, opcionesDeCookie(VIDA_REFRESH));
    return conTokens;
  }

  return new NextResponse(respuesta.body, {
    status: respuesta.status,
    headers: cabecerasParaElNavegador(respuesta),
  });
}

export const GET = manejar;
export const POST = manejar;
export const PATCH = manejar;
export const PUT = manejar;
export const DELETE = manejar;

/** Nada de este proxy se puede cachear: cada respuesta depende de la sesion. */
export const dynamic = 'force-dynamic';
