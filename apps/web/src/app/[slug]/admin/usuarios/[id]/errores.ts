import type { RolAsignable, RolUsuario } from '@boxadmin/shared';
import { ErrorDeApi } from '@/lib/cliente';

/**
 * Como se lee un fallo de la API en esta pantalla.
 *
 * Dos cosas que ningun otro sitio del front necesitaba todavia:
 *
 * 1. El ValidationPipe de Nest contesta `message` como un ARRAY de frases, una
 *    por campo invalido. `pedir` lo aplana con `String(...)` para tener algo que
 *    enseñar, pero para repartir cada frase en SU campo hace falta el array
 *    crudo, que viaja en `ErrorDeApi.cuerpo`.
 *
 * 2. Un 403 de la API no es el 403 de la puerta del panel. Aqui hay sesion y el
 *    rol alcanza para entrar; lo que no alcanza es para ESTA accion. Decir
 *    "algo salio mal" manda a quien lo lee a mirar la red cuando lo que tiene
 *    que hacer es llamar al dueño del salon.
 */

/** Las frases que mando la API, ya desenvueltas del array de Nest. */
export function frasesDeLaApi(error: ErrorDeApi): string[] {
  const cuerpo = error.cuerpo;

  if (typeof cuerpo === 'object' && cuerpo !== null && 'message' in cuerpo) {
    const mensaje = (cuerpo as { message: unknown }).message;
    if (Array.isArray(mensaje)) return mensaje.map((frase) => String(frase));
    if (typeof mensaje === 'string') return [mensaje];
  }

  return [error.message];
}

export interface FalloRepartido<C extends string> {
  /** La frase que le toca a cada campo, cuando la API lo nombro. */
  porCampo: Partial<Record<C, string>>;
  /** Lo que no nombra ningun campo. Eso si va a un cartel. */
  sueltas: string[];
}

/**
 * Reparte las frases de la API entre los campos que las nombran.
 *
 * La API escribe los nombres del contrato (`vigenciaDesde`, `telefono`), no las
 * etiquetas de la pantalla, asi que se busca el identificador dentro de la
 * frase. Lo que no case con ninguno queda suelto: inventarle un campo seria
 * peor que el cartel, porque señalaria el equivocado.
 */
export function repartirPorCampo<C extends string>(
  error: ErrorDeApi,
  campos: readonly C[],
): FalloRepartido<C> {
  const porCampo: Partial<Record<C, string>> = {};
  const sueltas: string[] = [];

  for (const frase of frasesDeLaApi(error)) {
    // Los nombres largos primero: `vigenciaDesde` contiene a `vigencia`, y sin
    // este orden una frase podria caer en el campo mas corto que la case.
    const campo = [...campos]
      .sort((a, b) => b.length - a.length)
      .find((nombre) => new RegExp(`\\b${nombre}\\b`).test(frase));

    if (campo !== undefined && porCampo[campo] === undefined) porCampo[campo] = frase;
    else sueltas.push(frase);
  }

  return { porCampo, sueltas };
}

const ROLES_LEGIBLES: Record<RolUsuario, string> = {
  SUPERADMIN: 'superadministrador',
  ADMIN_SALON: 'administrador del salon',
  ADMIN_OPERATIVO: 'administrador operativo',
  PROFESOR: 'profesor',
  ALUMNO: 'alumno',
  FANTASMA: 'fantasma',
};

/**
 * El texto que se le enseña a quien no pudo hacer algo.
 *
 * `minimo` es el rol que la RUTA exige, y lo sabe quien llama porque lo sabe la
 * API: `reset-password` pide `ADMIN_SALON` y todo lo demas del area pide
 * `ADMIN_OPERATIVO`.
 */
export function mensajeDeFallo(error: unknown, minimo: RolAsignable): string {
  if (!(error instanceof ErrorDeApi)) return 'No se pudo completar la accion.';

  if (error.estado === 403) {
    return `Para esto hace falta ser ${ROLES_LEGIBLES[minimo]}. Tu rol no alcanza.`;
  }

  // Para todo lo demas, el mensaje de la API tal cual: se escribio para quien
  // esta mirando ("Un profesor no tiene packId...") y cambiarlo por uno generico
  // seria tirar la parte util.
  return error.message;
}
