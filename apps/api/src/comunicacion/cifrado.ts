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
 * salir sin un error que lo explicara. Esta fase no implementa la rotacion;
 * implementa el formato que la hace posible.
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
 * Descifra. Lanza si la clave no es la correcta o si el texto fue manipulado:
 * GCM autentica, asi que no devuelve basura en silencio.
 */
export function descifrar(guardado: string, clave: Buffer): string {
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

  const descifrador = createDecipheriv(ALGORITMO, clave, Buffer.from(iv, 'base64'));
  descifrador.setAuthTag(Buffer.from(tag, 'base64'));

  return Buffer.concat([
    descifrador.update(Buffer.from(datos, 'base64')),
    descifrador.final(),
  ]).toString('utf8');
}
