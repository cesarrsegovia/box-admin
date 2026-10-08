import { describe, expect, it } from 'vitest';
import { rutaDeRetornoSegura } from './ruta-de-retorno';

const SLUG = 'mi-gym';
const CALENDARIO = '/mi-gym/calendario';

describe('rutaDeRetornoSegura', () => {
  it('sin destino pedido, vuelve al calendario del gimnasio', () => {
    expect(rutaDeRetornoSegura(undefined, SLUG)).toBe(CALENDARIO);
  });

  it('una cadena vacia tampoco es un destino', () => {
    expect(rutaDeRetornoSegura('', SLUG)).toBe(CALENDARIO);
  });

  it('acepta la ruta legitima CON su query, que es el punto de todo esto', () => {
    // Sin la query, el alumno que escaneo el QR volveria del login sin la
    // firma y tendria que ir otra vez a la pared.
    expect(rutaDeRetornoSegura('/mi-gym/checkin?f=abc', SLUG)).toBe('/mi-gym/checkin?f=abc');
  });

  it('acepta cualquier otra ruta de ESE gimnasio', () => {
    expect(rutaDeRetornoSegura('/mi-gym/mi-pack', SLUG)).toBe('/mi-gym/mi-pack');
  });

  it('una ruta de OTRO gimnasio cae al calendario del propio', () => {
    // El cruce de inquilinos es la clase de bug mas grave de este sistema: la
    // sesion recien creada es de mi-gym y no tiene nada que hacer en otro.
    expect(rutaDeRetornoSegura('/otro-gimnasio/calendario', SLUG)).toBe(CALENDARIO);
  });

  it('un slug que es PREFIJO de otro no abre la puerta', () => {
    // Con "empieza con /gim" bastaria para colarse en /gimnasio-rival. Por eso
    // la comparacion lleva la barra final.
    expect(rutaDeRetornoSegura('/gimnasio-rival/x', 'gim')).toBe('/gim/calendario');
  });

  it('rechaza la protocol-relative, que SI empieza por barra y se va a otro dominio', () => {
    expect(rutaDeRetornoSegura('//evil.com/x', SLUG)).toBe(CALENDARIO);
  });

  it('rechaza una URL absoluta https', () => {
    expect(rutaDeRetornoSegura('https://evil.com', SLUG)).toBe(CALENDARIO);
  });

  it('rechaza una URL absoluta http', () => {
    expect(rutaDeRetornoSegura('http://evil.com', SLUG)).toBe(CALENDARIO);
  });

  it('rechaza un javascript:', () => {
    expect(rutaDeRetornoSegura('javascript:alert(1)', SLUG)).toBe(CALENDARIO);
  });

  it('rechaza la barra invertida, que el navegador normaliza a barra', () => {
    // `/\evil.com` se comporta como `//evil.com`.
    expect(rutaDeRetornoSegura('/\\evil.com', SLUG)).toBe(CALENDARIO);
    expect(rutaDeRetornoSegura('\\\\evil.com', SLUG)).toBe(CALENDARIO);
  });

  it('rechaza la barra invertida tambien DENTRO del gimnasio propio', () => {
    // `/mi-gym/x\..\..` empieza bien y termina fuera. La lista blanca mira el
    // principio; la barra invertida hay que mirarla entera.
    expect(rutaDeRetornoSegura('/mi-gym/x\\..\\..', SLUG)).toBe(CALENDARIO);
  });

  it('rechaza los segmentos que suben de directorio', () => {
    // `/mi-gym/../otro-gimnasio/x` pasa la comparacion del prefijo y despues
    // el navegador lo normaliza fuera del gimnasio.
    expect(rutaDeRetornoSegura('/mi-gym/../otro-gimnasio/x', SLUG)).toBe(CALENDARIO);
  });

  it('rechaza saltos de linea y caracteres de control', () => {
    // Los navegadores los eliminan de la URL antes de resolverla, asi que
    // sirven para disfrazar cualquiera de los casos de arriba.
    expect(rutaDeRetornoSegura('/\n/evil.com', SLUG)).toBe(CALENDARIO);
    expect(rutaDeRetornoSegura('/mi-gym/\tx', SLUG)).toBe(CALENDARIO);
  });

  it('una ruta relativa sin barra inicial no vale', () => {
    expect(rutaDeRetornoSegura('mi-gym/calendario', SLUG)).toBe(CALENDARIO);
  });

  it('el slug pelado, sin barra final, no vale', () => {
    // No es peligroso, pero no es una ruta: `/mi-gymotra-cosa` empieza igual.
    expect(rutaDeRetornoSegura('/mi-gym', SLUG)).toBe(CALENDARIO);
  });
});

describe('rutaDeRetornoSegura · el destino por defecto tambien se valida', () => {
  // `porDefecto` existe para que el login mande cada rol a su sitio, pero
  // acaba en el mismo `router.push` que `volverA`. Si no se mirara, la puerta
  // tendria una ventana abierta al lado.

  it('un porDefecto hacia otro dominio cae al calendario del slug propio', () => {
    expect(rutaDeRetornoSegura(undefined, SLUG, 'https://evil.com')).toBe(CALENDARIO);
  });

  it('un porDefecto protocol-relative tampoco pasa', () => {
    expect(rutaDeRetornoSegura(undefined, SLUG, '//evil.com')).toBe(CALENDARIO);
  });

  it('un porDefecto hacia OTRO gimnasio cae al calendario del propio', () => {
    // El cruce de inquilinos no deja de serlo porque venga del tercer
    // argumento en vez del query.
    expect(rutaDeRetornoSegura(undefined, SLUG, '/otro-gimnasio/admin')).toBe(CALENDARIO);
  });

  it('un porDefecto legitimo SI se respeta: es el caso que el login necesita', () => {
    expect(rutaDeRetornoSegura(undefined, SLUG, '/mi-gym/admin')).toBe('/mi-gym/admin');
  });

  it('un volverA invalido cae al porDefecto legitimo, no al calendario a secas', () => {
    expect(rutaDeRetornoSegura('/otro-gimnasio/x', SLUG, '/mi-gym/admin')).toBe('/mi-gym/admin');
  });

  it('con los DOS invalidos queda el calendario, que es el unico cableado', () => {
    expect(rutaDeRetornoSegura('https://evil.com', SLUG, '//evil.com')).toBe(CALENDARIO);
  });

  it('un volverA legitimo gana al porDefecto', () => {
    expect(rutaDeRetornoSegura('/mi-gym/checkin?f=abc', SLUG, '/mi-gym/admin')).toBe(
      '/mi-gym/checkin?f=abc',
    );
  });

  it('las seis comprobaciones valen igual para porDefecto', () => {
    // Las mismas trampas que para `volverA`: barra invertida, control y `..`.
    expect(rutaDeRetornoSegura(undefined, SLUG, '/mi-gym/x\\..\\..')).toBe(CALENDARIO);
    expect(rutaDeRetornoSegura(undefined, SLUG, '/mi-gym/\tx')).toBe(CALENDARIO);
    expect(rutaDeRetornoSegura(undefined, SLUG, '/mi-gym/../otro-gimnasio/x')).toBe(CALENDARIO);
    expect(rutaDeRetornoSegura(undefined, SLUG, '/mi-gym')).toBe(CALENDARIO);
    expect(rutaDeRetornoSegura(undefined, SLUG, '')).toBe(CALENDARIO);
  });
});

describe('rutaDeRetornoSegura · los `..` codificados', () => {
  // Todo lo de aqui esta MEDIDO con `new URL`, que es el mismo parser que usa
  // el navegador, y no deducido. El parser decodifica `%2e` a `.` antes de
  // normalizar, asi que `%2e%2e` sube de directorio igual que `..` literal:
  // `/mi-gym/%2e%2e/otro-gimnasio/x` resuelve a `/otro-gimnasio/x`.
  //
  // No es un open redirect (la ruta sigue siendo relativa y no sale del
  // dominio): es un CRUCE DE INQUILINOS, que en este sistema es peor.

  it('rechaza %2e%2e, que el navegador resuelve igual que ..', () => {
    expect(rutaDeRetornoSegura('/mi-gym/%2e%2e/otro-gimnasio/x', SLUG)).toBe(CALENDARIO);
  });

  it('rechaza %2E%2E en mayusculas, que resuelve igual', () => {
    expect(rutaDeRetornoSegura('/mi-gym/%2E%2E/otro-gimnasio/x', SLUG)).toBe(CALENDARIO);
  });

  it('rechaza las mezclas de punto literal y codificado', () => {
    // Medido: los tres resuelven a `/otro-gimnasio/x`.
    expect(rutaDeRetornoSegura('/mi-gym/.%2e/otro-gimnasio/x', SLUG)).toBe(CALENDARIO);
    expect(rutaDeRetornoSegura('/mi-gym/%2e./otro-gimnasio/x', SLUG)).toBe(CALENDARIO);
    expect(rutaDeRetornoSegura('/mi-gym/%2e%2E/otro-gimnasio/x', SLUG)).toBe(CALENDARIO);
  });

  it('rechaza el %2e%2e final, que resuelve a la raiz del dominio', () => {
    // Medido: `/mi-gym/%2e%2e` resuelve a `/`, fuera del gimnasio.
    expect(rutaDeRetornoSegura('/mi-gym/%2e%2e', SLUG)).toBe(CALENDARIO);
  });

  it('ACEPTA la doble codificacion, que no es un bypass', () => {
    // Medido: el parser decodifica UNA vez, asi que `%252e%252e` se queda en
    // `%2e%2e` y nunca llega a ser `..`. El pathname resuelto conserva el
    // segmento entero dentro de `/mi-gym/`.
    expect(rutaDeRetornoSegura('/mi-gym/%252e%252e/x', SLUG)).toBe('/mi-gym/%252e%252e/x');
  });

  it('ACEPTA un %2e suelto, que es un solo punto y no sube', () => {
    // Medido: `/mi-gym/%2e/x` resuelve a `/mi-gym/x`, dentro del gimnasio.
    expect(rutaDeRetornoSegura('/mi-gym/%2e/x', SLUG)).toBe('/mi-gym/%2e/x');
  });

  it('un %2e%2e en la QUERY no cuenta: la comprobacion mira solo el camino', () => {
    // Medido: `/mi-gym/x?v=%2e%2e` resuelve a `/mi-gym/x`. La query no sube de
    // directorio, y el alumno del QR necesita que su `?f=` llegue entero.
    expect(rutaDeRetornoSegura('/mi-gym/checkin?f=%2e%2e', SLUG)).toBe('/mi-gym/checkin?f=%2e%2e');
  });

  it('rechaza un % suelto, que ni siquiera se puede decodificar', () => {
    // `decodeURIComponent` lanza `URIError`. Rechazar es deliberado: una ruta
    // que no se puede decodificar no es una ruta legitima.
    expect(rutaDeRetornoSegura('/mi-gym/100%/x', SLUG)).toBe(CALENDARIO);
    expect(rutaDeRetornoSegura('/mi-gym/%zz/x', SLUG)).toBe(CALENDARIO);
  });

  it('el porDefecto tambien pasa por esto', () => {
    expect(rutaDeRetornoSegura(undefined, SLUG, '/mi-gym/%2e%2e/otro-gimnasio/x')).toBe(CALENDARIO);
  });
});
