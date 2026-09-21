import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { urlDeApi } from '@/lib/api-url';
import { COOKIE_ACCESS, COOKIE_REFRESH, borrarCookiesDeSesion } from '@/lib/cookies';

/**
 * Cierra la sesion.
 *
 * Avisa a la API para que revoque el refresh token —si no, seguiria sirviendo
 * aunque el navegador ya no lo tenga— y borra las cookies pase lo que pase.
 * Un logout que falla a medias y deja al usuario "dentro" es peor que uno que
 * no revoca: al menos aqui el navegador queda limpio.
 */
export async function POST(): Promise<NextResponse> {
  const almacen = await cookies();
  const access = almacen.get(COOKIE_ACCESS)?.value;
  const refresh = almacen.get(COOKIE_REFRESH)?.value;

  if (access && refresh) {
    try {
      await fetch(urlDeApi(['auth', 'logout'], ''), {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${access}` },
        body: JSON.stringify({ refreshToken: refresh }),
        cache: 'no-store',
      });
    } catch {
      // La API puede estar caida y el alumno sigue teniendo derecho a salir.
    }
  }

  const salida = NextResponse.json({ ok: true });
  borrarCookiesDeSesion(salida.cookies);
  return salida;
}

export const dynamic = 'force-dynamic';
