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
