import { plainToInstance } from 'class-transformer';
import { Recortado } from './recortado.decorator';

class ConUnTexto {
  @Recortado()
  texto?: unknown;
}

function recortar(texto: unknown): unknown {
  return plainToInstance(ConUnTexto, { texto }).texto;
}

describe('Recortado', () => {
  it('saca los espacios de los dos bordes, y SOLO de los bordes', () => {
    expect(recortar('  Box 2  ')).toBe('Box 2');
  });

  it('tambien tabs y saltos de linea, que un pegado trae', () => {
    expect(recortar('\tFuncional\n')).toBe('Funcional');
  });

  it('solo espacios queda vacio: el @IsNotEmpty de al lado lo rechaza', () => {
    expect(recortar('   ')).toBe('');
  });

  /**
   * LO QUE NO ES TEXTO PASA TAL CUAL. Un `123` tiene que seguir llegando a
   * `@IsString()` como numero para que de su 400; convertirlo, o tirarlo,
   * cambiaria el error que ve quien llama.
   */
  it.each([
    ['un numero', 123],
    ['null', null],
    ['undefined', undefined],
    ['un objeto', { a: 1 }],
  ])('%s no se toca', (_caso, valor) => {
    expect(recortar(valor)).toEqual(valor);
  });
});
