import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITMO = 'aes-256-gcm';
const VERSION_ACTUAL = 'v1';
const BYTES_DE_IV = 12;

/**
 * La forma valida de APP_ENCRYPTION_KEY: 64 caracteres hexadecimales, porque
 * 32 bytes es lo que exige aes-256-gcm. Vive aca y no en validar-entorno.ts:
 * este archivo es quien sabe que forma tiene una clave de cifrado valida,
 * validar-entorno.ts solo la consume al arrancar. Una sola definicion evita
 * que las dos copias del regex discrepen el dia que alguien cambie una.
 */
export const PATRON_CLAVE_HEX = /^[0-9a-fA-F]{64}$/;

/**
 * Convierte la clave hexadecimal del entorno en el buffer de 32 bytes que pide
 * aes-256-gcm.
 *
 * El chequeo de caracteres va antes de convertir: `Buffer.from(hex, 'hex')`
 * trunca en silencio ante un caracter fuera de rango, asi que sin esto una
 * clave con, por ejemplo, una 'z' de mas terminaria reportando una longitud
 * equivocada en vez del problema real (que no es hexadecimal).
 */
export function claveDesdeHex(hex: string): Buffer {
  if (!/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error(
      'La clave de cifrado no es hexadecimal: contiene caracteres fuera de 0-9, a-f y A-F.',
    );
  }

  const clave = Buffer.from(hex, 'hex');
  if (clave.length !== 32) {
    throw new Error(
      `La clave de cifrado debe ser 32 bytes (64 caracteres hex); llegaron ${clave.length}.`,
    );
  }

  return clave;
}

/**
 * Cifra un secreto para guardarlo en la base.
 *
 * El formato lleva VERSION delante: `v1:<iv>:<tag>:<datos>`, todo en base64.
 * Sin la version, rotar la clave obligaria a que cada gimnasio volviera a
 * teclear su contrasena SMTP — y hasta que lo hiciera, sus emails dejarian de
 * salir sin un error que lo explicara. La rotacion de clave (Fase 20) no
 * cambia el formato: cifra siempre con la actual, y `descifrar` prueba la
 * actual y la anterior (ver `clavesDeApp` y el comando `cifrado:rotar`).
 *
 * El IV es aleatorio en cada llamada: con uno fijo, dos gimnasios con la misma
 * contrasena tendrian el mismo texto cifrado, y eso ya es informacion.
 */
export function cifrar(claro: string, clave: Buffer): string {
  const iv = randomBytes(BYTES_DE_IV);
  const cifrador = createCipheriv(ALGORITMO, clave, iv);
  const datos = Buffer.concat([cifrador.update(claro, 'utf8'), cifrador.final()]);

  return [
    VERSION_ACTUAL,
    iv.toString('base64'),
    cifrador.getAuthTag().toString('base64'),
    datos.toString('base64'),
  ].join(':');
}

/**
 * Las claves de la app, ya convertidas: `actual` es la UNICA con la que se
 * cifra; `paraDescifrar` es la actual y, si hay, la anterior, en ese orden.
 *
 * La anterior existe solo durante una rotacion (ver el README): se despliega
 * la nueva como APP_ENCRYPTION_KEY y la vieja como APP_ENCRYPTION_KEY_ANTERIOR,
 * se corre `cifrado:rotar` y se quita la anterior. Una anterior vacia cuenta
 * como ausente: es lo que deja un .env con la variable escrita y sin valor.
 */
export function clavesDeApp(
  actualHex: string,
  anteriorHex: string | undefined,
): { actual: Buffer; paraDescifrar: readonly Buffer[] } {
  const actual = claveDesdeHex(actualHex);
  const paraDescifrar =
    anteriorHex === undefined || anteriorHex === ''
      ? [actual]
      : [actual, claveDesdeHex(anteriorHex)];

  return { actual, paraDescifrar };
}

/**
 * Descifra probando las claves EN ORDEN (la actual primero) y devuelve con la
 * primera que GCM acepta. Lanza si el texto fue manipulado o si no lo cifro
 * ninguna: GCM autentica, asi que una clave equivocada no devuelve basura en
 * silencio, lanza, y eso es lo que permite probar la siguiente.
 *
 * Si ninguna sirve se relanza el error de la ULTIMA. Los errores de formato
 * (version, partes) no dependen de la clave y saltan antes de probar ninguna.
 */
export function descifrar(guardado: string, claves: readonly Buffer[]): string {
  const partes = guardado.split(':');
  // split no limita cuantas partes devuelve: un ':' de mas en <datos> (base64
  // no lo lleva, pero nada impide que un valor corrupto lo tenga) haria que la
  // quinta parte se descartara en silencio y la funcion fallara mas abajo con
  // un error crudo de node:crypto en vez de este mensaje.
  if (partes.length !== 4) {
    throw new Error('El valor cifrado no tiene la forma v1:<iv>:<tag>:<datos>.');
  }
  const [version, iv, tag, datos] = partes;

  if (version !== VERSION_ACTUAL) {
    throw new Error(
      `Version de cifrado desconocida: ${String(version)}. ` +
        'Este valor se cifro con un formato que esta version no sabe leer.',
    );
  }
  if (!iv || !tag || !datos) {
    throw new Error('El valor cifrado no tiene la forma v1:<iv>:<tag>:<datos>.');
  }

  if (claves.length === 0) {
    throw new Error('No se paso ninguna clave para descifrar.');
  }

  let ultimoError: unknown;
  for (const clave of claves) {
    try {
      const descifrador = createDecipheriv(ALGORITMO, clave, Buffer.from(iv, 'base64'));
      descifrador.setAuthTag(Buffer.from(tag, 'base64'));

      return Buffer.concat([
        descifrador.update(Buffer.from(datos, 'base64')),
        descifrador.final(),
      ]).toString('utf8');
    } catch (error) {
      ultimoError = error;
    }
  }

  throw ultimoError;
}
