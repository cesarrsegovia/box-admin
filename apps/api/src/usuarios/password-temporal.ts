import { randomBytes } from 'node:crypto';

/**
 * Contraseña inicial de un usuario dado de alta por el admin.
 *
 * `randomBytes`, no `Math.random()`: esto protege una cuenta. 12 bytes en
 * base64url dan 16 caracteres y ~72 bits de entropia, de sobra para una clave
 * que solo vive hasta que el usuario la cambie, y corta como para dictarla por
 * telefono sin equivocarse.
 *
 * Se devuelve al admin UNA sola vez, en la respuesta del alta o del reset. En
 * la base solo queda su hash argon2id.
 */
export function generarPasswordTemporal(): string {
  return randomBytes(12).toString('base64url');
}
