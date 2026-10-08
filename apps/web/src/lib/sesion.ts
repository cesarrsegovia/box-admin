import { cookies } from 'next/headers';
import type { MeRespuesta } from '@boxadmin/shared';
import { urlDeApi } from './api-url';
import { COOKIE_ACCESS, COOKIE_REFRESH, COOKIE_SLUG } from './cookies';

export interface Sesion {
  access: string | undefined;
  refresh?: string | undefined;
  slug: string | undefined;
}

/** Lee la sesion de las cookies. Solo tiene sentido en el servidor. */
export async function leerSesion(): Promise<Sesion> {
  const almacen = await cookies();

  return {
    access: almacen.get(COOKIE_ACCESS)?.value,
    refresh: almacen.get(COOKIE_REFRESH)?.value,
    slug: almacen.get(COOKIE_SLUG)?.value,
  };
}

/**
 * Funcion pura, separada de la lectura de cookies para poder probarla.
 *
 * La comprobacion del slug NO es paranoia: las cookies son del dominio pero los
 * tokens son de un gimnasio, asi que sin esto alguien logueado en /gym-a/ que
 * abriera /gym-b/calendario veria los datos de A bajo la URL de B.
 */
export function sesionValidaPara(sesion: Sesion, slugDeLaUrl: string): boolean {
  if (!sesion.access) return false;
  if (!sesion.slug) return false;

  return sesion.slug === slugDeLaUrl;
}

/**
 * El rol se le pregunta a la API, NO se deduce del token aqui.
 *
 * El JWT lleva el rol, pero decodificarlo sin verificar la firma para decidir
 * que se dibuja es apoyarse en un dato que el cliente podria haber tocado.
 * `GET /auth/me` es el unico que verifica.
 *
 * Va contra la API directamente y no por `/api/bx`: eso es el proxy del
 * NAVEGADOR, y esto corre en el servidor, que ya tiene el token en la mano.
 */
export async function leerRol(access: string): Promise<MeRespuesta | null> {
  const respuesta = await fetch(urlDeApi(['auth', 'me'], ''), {
    headers: { authorization: `Bearer ${access}` },
    cache: 'no-store',
  });

  if (!respuesta.ok) return null;

  return (await respuesta.json()) as MeRespuesta;
}
