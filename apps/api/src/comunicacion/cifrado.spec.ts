import { cifrar, claveDesdeHex, descifrar } from './cifrado';

const CLAVE = claveDesdeHex('a'.repeat(64));
const OTRA = claveDesdeHex('b'.repeat(64));

describe('cifrado de credenciales', () => {
  it('cifrar y descifrar da la vuelta', () => {
    expect(descifrar(cifrar('mi-password-smtp', CLAVE), CLAVE)).toBe('mi-password-smtp');
  });

  it('el texto cifrado NO contiene el claro', () => {
    // Suena obvio y es justo lo que un cifrado mal montado no cumple.
    expect(cifrar('mi-password-smtp', CLAVE)).not.toContain('mi-password-smtp');
  });

  it('dos cifrados del mismo texto son distintos', () => {
    // El IV es aleatorio. Si dos cifrados coincidieran, un observador de la
    // base sabria que dos gimnasios usan la misma contrasena.
    expect(cifrar('igual', CLAVE)).not.toBe(cifrar('igual', CLAVE));
  });

  it('lleva el prefijo de version', () => {
    expect(cifrar('x', CLAVE).startsWith('v1:')).toBe(true);
  });

  it('descifrar con OTRA clave falla en vez de devolver basura', () => {
    // GCM autentica: no descifra mal en silencio.
    expect(() => descifrar(cifrar('secreto', CLAVE), OTRA)).toThrow();
  });

  it('un cifrado manipulado falla', () => {
    const original = cifrar('secreto', CLAVE);
    const partes = original.split(':');
    // Se toca el ultimo byte del texto cifrado.
    const datos = Buffer.from(partes[3]!, 'base64');
    datos[datos.length - 1] = datos[datos.length - 1]! ^ 0xff;
    partes[3] = datos.toString('base64');

    expect(() => descifrar(partes.join(':'), CLAVE)).toThrow();
  });

  it('una version desconocida falla con un mensaje que lo dice', () => {
    expect(() => descifrar('v9:a:b:c', CLAVE)).toThrow(/version/i);
  });

  it('un valor con partes de mas se rechaza con el mensaje de formato', () => {
    // Un ':' de mas no debe descartar la quinta parte en silencio y fallar
    // mas abajo con un error crudo de node:crypto.
    expect(() => descifrar('v1:a:b:c:d', CLAVE)).toThrow(/forma v1:<iv>:<tag>:<datos>/);
  });

  it('una clave que no son 32 bytes se rechaza', () => {
    expect(() => claveDesdeHex('abcd')).toThrow(/32 bytes/);
  });

  it('una clave de 64 caracteres no hexadecimales se rechaza diciendo que no es hexadecimal', () => {
    // Longitud correcta, alfabeto equivocado: el mensaje tiene que distinguir
    // esto de "longitud equivocada", no confundirlas.
    const clave = 'z'.repeat(64);

    expect(() => claveDesdeHex(clave)).toThrow(/no es hexadecimal/);
    expect(() => claveDesdeHex(clave)).not.toThrow(/32 bytes/);
  });
});
