/**
 * Limites de peticiones, leidos del entorno.
 *
 * Son constantes de modulo y no configuracion inyectada porque el decorador
 * `@Throttle` es METADATA ESTATICA: se evalua cuando se define la clase del
 * controller, mucho antes de que exista un ConfigService. Leer `process.env`
 * aqui funciona porque para entonces dotenv ya cargo el `.env` que toque.
 *
 * Por que son configurables y no numeros fijos: con el limite estricto de
 * produccion, los e2e se rompen. `crearGimnasio` hace un login por cada
 * `beforeEach`, y un solo archivo de tests encadena mas de treinta contra la
 * misma instancia y la misma IP — a partir del sexto, 429. El valor de
 * produccion se mantiene como DEFECTO, asi que olvidarse de definir la
 * variable deja el sistema en el lado seguro; `.env.test` lo sube.
 */

/** Ventana de los limites de auth, en milisegundos. */
export const TTL_AUTH = Number(process.env.THROTTLE_AUTH_TTL ?? 60_000);

/**
 * Intentos permitidos por IP y ventana en las rutas publicas de auth.
 *
 * Cinco por minuto hace inviable adivinar por fuerza bruta un codigo de
 * invitacion de 32 hexadecimales, y de paso pone un freno al login, que desde
 * la Fase 0 no tenia ninguno.
 */
export const LIMITE_AUTH = Number(process.env.THROTTLE_AUTH_LIMIT ?? 5);

/**
 * Limite general. No esta para moderar el uso normal, sino para que ningun
 * endpoint quede completamente sin freno.
 */
export const TTL_GENERAL = Number(process.env.THROTTLE_GENERAL_TTL ?? 60_000);
export const LIMITE_GENERAL = Number(process.env.THROTTLE_GENERAL_LIMIT ?? 300);
