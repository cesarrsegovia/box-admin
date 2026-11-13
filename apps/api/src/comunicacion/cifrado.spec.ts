import { cifrar, claveDesdeHex, clavesDeApp, descifrar } from './cifrado';

const CLAVE = claveDesdeHex('a'.repeat(64));
const OTRA = claveDesdeHex('b'.repeat(64));

describe('cifrado de credenciales', () => {
  it('cifrar y descifrar da la vuelta', () => {
    expect(descifrar(cifrar('mi-password-smtp', CLAVE), [CLAVE])).toBe('mi-password-smtp');
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
    expect(() => descifrar(cifrar('secreto', CLAVE), [OTRA])).toThrow();
  });

  it('un cifrado manipulado falla', () => {
    const original = cifrar('secreto', CLAVE);
    const partes = original.split(':');
    // Se toca el ultimo byte del texto cifrado.
    const datos = Buffer.from(partes[3]!, 'base64');
    datos[datos.length - 1] = datos[datos.length - 1]! ^ 0xff;
    partes[3] = datos.toString('base64');

    expect(() => descifrar(partes.join(':'), [CLAVE])).toThrow();
  });

  it('una version desconocida falla con un mensaje que lo dice', () => {
    expect(() => descifrar('v9:a:b:c', [CLAVE])).toThrow(/version/i);
  });

  it('un valor con partes de mas se rechaza con el mensaje de formato', () => {
    // Un ':' de mas no debe descartar la quinta parte en silencio y fallar
    // mas abajo con un error crudo de node:crypto.
    expect(() => descifrar('v1:a:b:c:d', [CLAVE])).toThrow(/forma v1:<iv>:<tag>:<datos>/);
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

describe('descifrar con la clave actual y la anterior (rotacion)', () => {
  const ACTUAL = claveDesdeHex('c'.repeat(64));
  const ANTERIOR = claveDesdeHex('d'.repeat(64));
  /**
   * Una "clave" que node:crypto rechaza si se llega a usar ("Invalid key
   * length"). Puesta detras de la actual, prueba que la anterior NO se toca
   * cuando la actual ya sirve: si se tocara, el error de longitud saltaria.
   */
  const CLAVE_QUE_EXPLOTA = Buffer.alloc(5);

  it('descifra un valor cifrado con la ANTERIOR si se le pasan las dos', () => {
    const guardado = cifrar('smtp-de-antes', ANTERIOR);

    expect(descifrar(guardado, [ACTUAL, ANTERIOR])).toBe('smtp-de-antes');
  });

  it('con la actual sola, un valor de la anterior sigue lanzando', () => {
    const guardado = cifrar('smtp-de-antes', ANTERIOR);

    expect(() => descifrar(guardado, [ACTUAL])).toThrow();
  });

  it('un valor de la actual se descifra sin tocar la anterior', () => {
    const guardado = cifrar('smtp-de-ahora', ACTUAL);

    expect(descifrar(guardado, [ACTUAL, CLAVE_QUE_EXPLOTA])).toBe('smtp-de-ahora');
  });

  it('si ninguna sirve relanza el error de la ULTIMA', () => {
    const guardado = cifrar('de-otra-clave', OTRA);

    expect(() => descifrar(guardado, [ACTUAL, CLAVE_QUE_EXPLOTA])).toThrow(/key length/i);
  });

  it('un valor manipulado lanza con las dos claves: GCM no deja colar basura', () => {
    const partes = cifrar('secreto', ANTERIOR).split(':');
    const datos = Buffer.from(partes[3]!, 'base64');
    datos[0] = datos[0]! ^ 0xff;
    partes[3] = datos.toString('base64');

    expect(() => descifrar(partes.join(':'), [ACTUAL, ANTERIOR])).toThrow();
  });

  it('sin ninguna clave lanza diciendolo, no con un error crudo', () => {
    expect(() => descifrar(cifrar('x', ACTUAL), [])).toThrow(/ninguna clave/i);
  });
});

describe('clavesDeApp', () => {
  it('sin anterior, solo se descifra con la actual', () => {
    const claves = clavesDeApp('c'.repeat(64), undefined);

    expect(claves.actual.equals(claveDesdeHex('c'.repeat(64)))).toBe(true);
    expect(claves.paraDescifrar).toHaveLength(1);
    expect(claves.paraDescifrar[0]!.equals(claveDesdeHex('c'.repeat(64)))).toBe(true);
  });

  it('con anterior, primero la actual y despues la anterior', () => {
    const claves = clavesDeApp('c'.repeat(64), 'd'.repeat(64));

    expect(claves.paraDescifrar).toHaveLength(2);
    expect(claves.paraDescifrar[0]!.equals(claveDesdeHex('c'.repeat(64)))).toBe(true);
    expect(claves.paraDescifrar[1]!.equals(claveDesdeHex('d'.repeat(64)))).toBe(true);
  });

  it('una anterior vacia cuenta como ausente (la variable escrita y sin valor)', () => {
    expect(clavesDeApp('c'.repeat(64), '').paraDescifrar).toHaveLength(1);
  });
});
