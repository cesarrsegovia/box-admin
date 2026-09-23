import { PATRON_CLAVE_HEX } from '../comunicacion/cifrado';

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
  'APP_ENCRYPTION_KEY',
  'EMAIL_TIPO',
  'PUSH_TIPO',
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

  // 32 bytes en hexadecimal: es la longitud que exige aes-256-gcm. Validarlo
  // aqui y no en el primer cifrado hace que un despliegue mal configurado muera
  // al arrancar en vez de la primera vez que alguien guarda su SMTP. El patron
  // vive en cifrado.ts, que es quien sabe que forma tiene una clave valida.
  const clave = config.APP_ENCRYPTION_KEY;
  if (typeof clave !== 'string' || !PATRON_CLAVE_HEX.test(clave)) {
    throw new Error(
      'APP_ENCRYPTION_KEY debe ser 32 bytes en hexadecimal (64 caracteres). ' +
        "Generala con: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }

  const email = config.EMAIL_TIPO;
  if (email !== 'memoria' && email !== 'smtp') {
    throw new Error(`EMAIL_TIPO debe ser "memoria" o "smtp", no ${JSON.stringify(email)}.`);
  }

  // Las VAPID NO se exigen, ni siquiera con PUSH_TIPO=web-push: sin ellas el
  // push se desactiva, POST /push/suscripcion responde 503 y el email sigue
  // saliendo. Es una capacidad del despliegue, no un estado roto — a diferencia
  // de la clave de cifrado, que si falta deja credenciales ilegibles en la base.
  const push = config.PUSH_TIPO;
  if (push !== 'memoria' && push !== 'web-push') {
    throw new Error(`PUSH_TIPO debe ser "memoria" o "web-push", no ${JSON.stringify(push)}.`);
  }

  // Opcional a proposito: un despliegue solo-API no tiene frontend al que
  // abrirle la puerta, y exigirla obligaria a inventar un valor. Una cadena
  // vacia cuenta como ausente: es lo que deja un .env con la clave escrita y
  // el valor sin rellenar.
  const webOrigin = config.WEB_ORIGIN;
  if (webOrigin !== undefined && webOrigin !== '') {
    if (typeof webOrigin !== 'string') {
      throw new Error('WEB_ORIGIN debe ser una cadena con el origen del frontend.');
    }
    try {
      // Un origen es esquema + host + puerto. `new URL` lo valida de verdad;
      // una expresion regular casera aqui seria peor que inutil.
      new URL(webOrigin);
    } catch {
      throw new Error(
        `WEB_ORIGIN no es un origen valido: ${webOrigin}. ` +
          'Se espera algo como http://localhost:3001 o https://app.boxadmin.io.',
      );
    }
  }

  return config;
}
