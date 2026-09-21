import { NextResponse, type NextRequest } from 'next/server';
import { urlDeApi } from '@/lib/api-url';
import {
  COOKIE_ACCESS,
  COOKIE_REFRESH,
  COOKIE_SLUG,
  VIDA_ACCESS,
  VIDA_REFRESH,
  opcionesDeCookie,
} from '@/lib/cookies';

/**
 * Auto-registro con clave de invitacion.
 *
 * Es uno de los tres unicos sitios de toda la aplicacion donde los tokens
 * existen como texto, y de aqui pasan directamente a cookies httpOnly. La
 * respuesta que ve el navegador lleva el usuario y NO lleva los tokens: si los
 * llevara, el JavaScript de la pagina podria leerlos y todo el diseño de
 * cookies httpOnly no serviria de nada.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const cuerpo = (await req.json()) as { tenantSlug?: string };

  const respuesta = await fetch(urlDeApi(['auth', 'auto-registro'], ''), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
    cache: 'no-store',
  });

  const datos = (await respuesta.json()) as {
    accessToken?: string;
    refreshToken?: string;
    usuario?: unknown;
    message?: string;
  };

  if (!respuesta.ok || !datos.accessToken || !datos.refreshToken) {
    return NextResponse.json(
      { message: datos.message ?? 'No se pudo completar el registro' },
      { status: respuesta.ok ? 502 : respuesta.status },
    );
  }

  const salida = NextResponse.json({ usuario: datos.usuario }, { status: 201 });
  salida.cookies.set(COOKIE_ACCESS, datos.accessToken, opcionesDeCookie(VIDA_ACCESS));
  salida.cookies.set(COOKIE_REFRESH, datos.refreshToken, opcionesDeCookie(VIDA_REFRESH));
  salida.cookies.set(COOKIE_SLUG, cuerpo.tenantSlug ?? '', opcionesDeCookie(VIDA_REFRESH));

  return salida;
}

export const dynamic = 'force-dynamic';
