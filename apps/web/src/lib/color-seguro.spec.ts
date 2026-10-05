import { describe, expect, it } from 'vitest';
import {
  COLOR_PRIMARIO_POR_DEFECTO,
  COLOR_SECUNDARIO_POR_DEFECTO,
  colorSeguro,
} from './color-seguro';

describe('colorSeguro · lo que deja pasar', () => {
  it.each([
    ['#000000', '#000000'],
    ['#ffffff', '#ffffff'],
    ['#AABBCC', '#AABBCC'],
    // Las cuatro formas hexadecimales validas de CSS: #rgb, #rgba, #rrggbb,
    // #rrggbbaa. No se admite nada mas.
    ['#abc', '#abc'],
    ['#abcd', '#abcd'],
    ['#aabbccdd', '#aabbccdd'],
  ])('%s pasa tal cual', (entrada, esperado) => {
    expect(colorSeguro(entrada, '#123456')).toBe(esperado);
  });
});

describe('colorSeguro · lo que no', () => {
  it.each([
    // El caso que da nombre a todo esto: un valor que es CSS valido y que
    // abre una peticion a un tercero desde la landing del gimnasio.
    'red; background: url(https://evil.example/pixel.png)',
    'javascript:alert(1)',
    'url(javascript:alert(1))',
    '',
    '   ',
    'red',
    'rgb(255,0,0)',
    // Sin almohadilla. `@IsHexColor` de la API la da por opcional, asi que
    // esto PUEDE llegar desde el servidor; como variable CSS no es un color,
    // de modo que vale mas el valor por defecto que una variable rota.
    'aabbcc',
    '#gggggg',
    '#12345',
    '#aabbcc ',
    '#aabbcc;',
    '#aabbcc\n',
    '#aabbcc/*',
    'var(--algo)',
  ])('%j cae al color por defecto', (entrada) => {
    expect(colorSeguro(entrada, '#123456')).toBe('#123456');
  });

  it('un valor que no es ni siquiera una cadena cae al por defecto', () => {
    expect(colorSeguro(undefined as unknown as string, '#123456')).toBe('#123456');
    expect(colorSeguro(null as unknown as string, '#123456')).toBe('#123456');
    expect(colorSeguro({ toString: () => '#aabbcc' } as unknown as string, '#123456')).toBe(
      '#123456',
    );
  });
});

describe('colorSeguro · los valores por defecto', () => {
  /**
   * Si un defecto dejara de ser un hexadecimal, el saneado devolveria basura
   * creyendo que la sanea. Se comprueba que los dos se validan a si mismos.
   */
  it('los dos por defecto pasan su propia validacion', () => {
    expect(colorSeguro(COLOR_PRIMARIO_POR_DEFECTO, '#123456')).toBe(COLOR_PRIMARIO_POR_DEFECTO);
    expect(colorSeguro(COLOR_SECUNDARIO_POR_DEFECTO, '#123456')).toBe(COLOR_SECUNDARIO_POR_DEFECTO);
  });

  it('son los mismos que la base de datos usa por defecto', () => {
    expect(COLOR_PRIMARIO_POR_DEFECTO).toBe('#000000');
    expect(COLOR_SECUNDARIO_POR_DEFECTO).toBe('#ffffff');
  });
});
