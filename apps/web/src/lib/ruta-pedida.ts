import { headers } from 'next/headers';
import { rutaDeRetornoSegura } from './ruta-de-retorno';

/**
 * La cabecera donde el middleware deja la ruta pedida.
 *
 * El middleware NO importa esta constante: tendria que arrastrar este modulo
 * —y con el `next/headers`— al bundle del edge, donde `next/headers` no corre.
 * Alli el nombre va escrito a mano, y un test del middleware comprueba que los
 * dos dicen lo mismo. La duplicacion existe; lo que no existe es que se
 * separen sin que nadie se entere.
 */
export const CABECERA_DE_RUTA = 'x-ruta';

/**
 * De donde se esta echando al usuario, para poder devolverlo ahi.
 *
 * ⚠️ LA CABECERA NO SE CONFIA. Que la escriba el middleware no la hace segura:
 * en cualquier ruta que el matcher no cubra, una `x-ruta` puesta por el
 * cliente llega intacta. Por eso pasa por el MISMO filtro que el `volverA` del
 * query —`rutaDeRetornoSegura`, la pieza que ya existia y ya estaba auditada—
 * y no por una comprobacion nueva escrita aqui: dos ideas de que destino es
 * aceptable es lo que se separa con el tiempo.
 *
 * Sin cabecera se cae a `porDefecto`, que es la entrada del area: exactamente
 * lo que habia antes de que existiera el middleware. Nunca una cadena vacia ni
 * un `null` metido en la URL.
 */
export async function rutaPedida(slug: string, porDefecto: string): Promise<string> {
  const cabeceras = await headers();

  // `?? undefined` y no `?? ''`: la ausencia de destino y un destino vacio no
  // son lo mismo, y solo el primero tiene que caer al respaldo por ausencia.
  const estampada = cabeceras.get(CABECERA_DE_RUTA) ?? undefined;

  return rutaDeRetornoSegura(estampada, slug, porDefecto);
}
