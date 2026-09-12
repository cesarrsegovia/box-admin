/**
 * Variables de entorno que la aplicacion necesita para arrancar. Si falta
 * alguna (o llega vacia / solo con espacios), preferimos que el proceso muera
 * ya, con un mensaje claro, en vez de arrancar a medias y fallar mas tarde de
 * forma opaca (por ejemplo, BOOTSTRAP_KEY vacia dejando pasar a cualquiera).
 */
const VARIABLES_REQUERIDAS = [
  'DATABASE_URL',
  'REDIS_URL',
  'JWT_SECRET',
  'JWT_EXPIRES_IN',
  'JWT_REFRESH_SECRET',
  'JWT_REFRESH_EXPIRES_IN',
  'BOOTSTRAP_KEY',
] as const;

/**
 * Valida el objeto de configuracion que `ConfigModule.forRoot` recibe de
 * `process.env`. Se pasa como funcion `validate` para que Nest se niegue a
 * arrancar si el entorno esta incompleto.
 *
 * Devuelve el mismo config recibido (Nest lo requiere) si todo esta bien;
 * lanza un error accionable, nombrando la variable, si falta o esta vacia.
 */
export function validarEntorno(
  config: Record<string, unknown>,
): Record<string, unknown> {
  for (const variable of VARIABLES_REQUERIDAS) {
    const valor = config[variable];

    if (typeof valor !== 'string' || valor.trim() === '') {
      throw new Error(
        `Variable de entorno requerida ausente o vacia: ${variable}. ` +
          'Definila en el .env correspondiente antes de arrancar la aplicacion.',
      );
    }
  }

  return config;
}
