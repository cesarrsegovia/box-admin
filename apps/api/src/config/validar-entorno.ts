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
  'ALMACEN_TIPO',
] as const;

/**
 * Variables que solo hacen falta con ALMACEN_TIPO=s3. Pedirlas siempre
 * obligaria a inventar valores falsos en desarrollo y en los tests, que es
 * justo como se acaba con credenciales de mentira commiteadas.
 */
const VARIABLES_DE_S3 = [
  'S3_ENDPOINT',
  'S3_REGION',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
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

  const tipo = config.ALMACEN_TIPO;
  if (tipo !== 'local' && tipo !== 's3') {
    throw new Error(
      `ALMACEN_TIPO debe ser "local" o "s3", no ${JSON.stringify(tipo)}. ` +
        'Definilo en el .env correspondiente.',
    );
  }

  if (tipo === 's3') {
    for (const variable of VARIABLES_DE_S3) {
      const valor = config[variable];

      if (typeof valor !== 'string' || valor.trim() === '') {
        throw new Error(
          `Variable de entorno requerida ausente o vacia: ${variable}. ` +
            'Es obligatoria cuando ALMACEN_TIPO=s3.',
        );
      }
    }
  }

  return config;
}
