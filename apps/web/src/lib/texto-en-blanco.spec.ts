import { describe, expect, it } from 'vitest';
import {
  conTextosRecortados,
  estaEnBlanco,
  sinFilasIncompletas,
  sinTextosEnBlanco,
} from './texto-en-blanco';

describe('sinTextosEnBlanco', () => {
  it('lo que esta en blanco pasa a null', () => {
    expect(sinTextosEnBlanco({ a: '', b: '   ', c: '\n', d: '\t ', e: 'hola' })).toEqual({
      a: null,
      b: null,
      c: null,
      d: null,
      e: 'hola',
    });
  });

  it('recorta los bordes de lo que si tiene contenido', () => {
    expect(sinTextosEnBlanco({ a: '  hola  ' })).toEqual({ a: 'hola' });
  });

  /**
   * LA TRAMPA CLASICA. Una funcion que se llame "esta vacio" y se trague el
   * cero rompe el dia que se le pase un precio o una bandera. Aqui conviven
   * con `destacado: false` y con contadores, asi que se fija el objeto ENTERO
   * y no solo el campo que interesa.
   */
  it('no se come ni un 0, ni un false, ni un null, ni una lista vacia', () => {
    const entrada = {
      cero: 0,
      falso: false,
      nulo: null,
      indefinido: undefined,
      lista: [],
      objeto: {},
      nan: NaN,
    };

    expect(sinTextosEnBlanco(entrada)).toEqual(entrada);
  });

  it('no entra dentro de las listas ni de los objetos anidados', () => {
    const entrada = { packs: [{ nombre: '  Mensual  ' }], config: { tagline: '   ' } };

    expect(sinTextosEnBlanco(entrada)).toEqual(entrada);
  });

  it('no muta el objeto que recibe', () => {
    const entrada = { a: '   ' };

    sinTextosEnBlanco(entrada);

    expect(entrada).toEqual({ a: '   ' });
  });

  it('un objeto sin cadenas sale identico', () => {
    expect(sinTextosEnBlanco({ n: 1 })).toEqual({ n: 1 });
  });
});

describe('estaEnBlanco', () => {
  it.each([null, undefined, '', '   ', '\n', '\t '])('%j esta en blanco', (valor) => {
    expect(estaEnBlanco(valor)).toBe(true);
  });

  /**
   * LA MISMA TRAMPA, otra vez: esta funcion decide si una fila se descarta, y
   * un `0` o un `false` que se tomen por "vacio" borran datos legitimos.
   */
  it.each([0, false, NaN, [], {}, 'a', ' a ', '0'])('%j NO esta en blanco', (valor) => {
    expect(estaEnBlanco(valor)).toBe(false);
  });
});

describe('sinFilasIncompletas', () => {
  it('descarta la fila a la que le falta el campo que manda', () => {
    const filas = [
      { nombre: 'Ana', texto: '' },
      { nombre: 'Beto', texto: 'Muy bueno' },
      { nombre: 'Cora', texto: '   ' },
    ];

    expect(sinFilasIncompletas(filas, ['texto'])).toEqual([{ nombre: 'Beto', texto: 'Muy bueno' }]);
  });

  it('con varios campos, basta que falte uno', () => {
    const filas = [
      { pregunta: '¿Cuanto?', respuesta: '' },
      { pregunta: '', respuesta: 'Depende' },
      { pregunta: '¿Hay duchas?', respuesta: 'Si' },
    ];

    expect(sinFilasIncompletas(filas, ['pregunta', 'respuesta'])).toEqual([
      { pregunta: '¿Hay duchas?', respuesta: 'Si' },
    ]);
  });

  it('respeta el orden que puso el admin', () => {
    const filas = [{ t: 'uno' }, { t: '' }, { t: 'dos' }, { t: 'tres' }];

    expect(sinFilasIncompletas(filas, ['t'])).toEqual([{ t: 'uno' }, { t: 'dos' }, { t: 'tres' }]);
  });

  it('un campo que no se mira no descarta nada', () => {
    const filas = [{ nombre: '', texto: 'vale' }];

    expect(sinFilasIncompletas(filas, ['texto'])).toEqual(filas);
  });

  it('si no vino la lista, sigue sin venir: no se inventa una vacia', () => {
    // `undefined` es "la bandera esta apagada"; `[]` es "esta encendida y no
    // hay nada". No son lo mismo aunque la landing los trate igual.
    expect(sinFilasIncompletas(undefined, ['texto'])).toBeUndefined();
  });

  it('si se descartan todas, queda la lista vacia', () => {
    expect(sinFilasIncompletas([{ t: '' }, { t: '  ' }], ['t'])).toEqual([]);
  });

  it('no muta la lista que recibe', () => {
    const filas = [{ t: '' }, { t: 'uno' }];

    sinFilasIncompletas(filas, ['t']);

    expect(filas).toHaveLength(2);
  });
});

describe('conTextosRecortados', () => {
  it('quita lo que sobra a los lados', () => {
    expect(conTextosRecortados({ a: '  hola  ', b: '\n\nchau\n' })).toEqual({
      a: 'hola',
      b: 'chau',
    });
  });

  /**
   * EL INTERIOR ES DEL ADMIN. `sobreElSalon` se pinta con `whitespace-pre-line`
   * justo para que sus saltos de linea se vean: colapsarlos aqui seria
   * reescribirle el texto.
   */
  it('NO toca los saltos de linea de adentro', () => {
    expect(conTextosRecortados({ a: '\nuno\ndos\n' })).toEqual({ a: 'uno\ndos' });
    expect(conTextosRecortados({ a: 'uno\n\n\ndos' })).toEqual({ a: 'uno\n\n\ndos' });
    expect(conTextosRecortados({ a: 'uno  dos' })).toEqual({ a: 'uno  dos' });
  });

  it('recorta, pero no anula: lo que queda vacio sigue siendo una cadena', () => {
    // Quien decide que una cadena vacia vale `null` es `sinTextosEnBlanco`.
    // Esta solo recorta, y por eso se puede usar sobre filas cuyos campos el
    // contrato declara como `string`.
    expect(conTextosRecortados({ a: '   ' })).toEqual({ a: '' });
  });

  it('no se mete con lo que no es texto', () => {
    const entrada = { cero: 0, falso: false, nulo: null, lista: [], anidado: { a: '  x  ' } };

    expect(conTextosRecortados(entrada)).toEqual(entrada);
  });
});

describe('sinFilasIncompletas · tambien recorta', () => {
  it('las filas que sobreviven salen con sus textos recortados', () => {
    expect(sinFilasIncompletas([{ t: '  hola  ' }], ['t'])).toEqual([{ t: 'hola' }]);
  });
});
