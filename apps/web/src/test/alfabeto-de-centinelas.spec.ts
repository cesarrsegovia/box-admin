import { describe, expect, it } from 'vitest';
import { formaQueSeFue } from './espia-de-consola';

/**
 * EL GUARDIAN DEL ALFABETO, Y POR QUE ESTE SI TIENE SPEC Y LOS DEMAS NO.
 *
 * Los demas canales no tienen spec a proposito: lo que hay que comprobar de un
 * tapon es que una mutacion lo hace caer, y eso se mide con la mutacion, no con
 * un test que repita el codigo del tapon en otro orden. Aqui la situacion es
 * otra, y es exactamente la de `relojes-falsos.spec.ts`: ESTO NO SE VE DESDE
 * FUERA.
 *
 * La aritmetica de los desplazamientos de base64 es invisible para los 71
 * specs. Si alguien «simplifica» las tres agujas a una —que es la forma obvia
 * y la que parece correcta—, o si mueve el recorte de los bordes un caracter,
 * LOS 1599 TESTS SIGUEN EN VERDE y el tapon se queda ciego para la unica fuga
 * que existe de verdad: la que lleva el centinela EN MEDIO de un volcado. Un
 * verde que no depende de que la defensa funcione es el modo de fallo contra
 * el que esta escrito el archivo entero.
 *
 * Por eso este guardian MIDE en vez de repetir: codifica un volcado de verdad
 * con el centinela en las seis posiciones posibles y cuenta cuantas encuentra.
 *
 * NADA DE LO QUE HAY AQUI ES UN CENTINELA REGISTRADO: este spec no llama a
 * `vigilarEstosDatos` y los nombres de abajo son inventados para la medicion,
 * asi que los trece tapones globales siguen mirando lo suyo mientras corre.
 */

/** Un nombre propio de 27 caracteres: 9 grupos de base64 exactos, sin relleno `=`. */
const NOMBRE = 'Sofia-Pereyra-Vino-Marcador';

/**
 * EL VOLCADO DE VERDAD: el centinela EN MEDIO, no al principio.
 *
 * `relleno` corre la posicion del nombre un caracter cada vez. Es lo que pasa
 * en una fuga real sin que nadie lo elija: el nombre cae donde caiga dentro
 * del JSON, y la posicion depende de cuantas clases haya antes o de cuantas
 * letras tenga el gimnasio.
 */
function volcadoDe(relleno: number): string {
  return `{"${'x'.repeat(relleno)}":[{"alumna":"${NOMBRE}","vino":true}]}`;
}

describe('el centinela en medio de un volcado en base64', () => {
  it('se encuentra en las SEIS posiciones, no solo en las alineadas', () => {
    const encontradas = [0, 1, 2, 3, 4, 5].filter(
      (relleno) => formaQueSeFue(btoa(volcadoDe(relleno)), NOMBRE)?.comoSeDijo === ' (en base64)',
    );

    expect(encontradas).toEqual([0, 1, 2, 3, 4, 5]);
  });

  /**
   * LA MEDICION QUE JUSTIFICA LOS TRES DESPLAZAMIENTOS.
   *
   * `btoa(NOMBRE)` es la aguja que escribe cualquiera a la primera, y es la
   * que habria si alguien simplificara `agujasDeBase64`. Base64 agrupa de tres
   * en tres bytes, asi que esa aguja solo aparece dentro del volcado codificado
   * cuando el nombre empieza en una posicion multiplo de 3: DOS DE CADA TRES
   * FUGAS SE LE ESCAPAN. Si este test se pusiera verde con las seis, querria
   * decir que el problema no existe y que las tres agujas sobran.
   */
  it('y la aguja ingenua —btoa(centinela) a secas— solo caza una de cada tres', () => {
    const alineadas = [0, 1, 2, 3, 4, 5].filter((relleno) =>
      btoa(volcadoDe(relleno)).includes(btoa(NOMBRE)),
    );

    expect(alineadas).toHaveLength(2);
  });
});

describe('las formas que el alfabeto cubre', () => {
  it('el dato en claro sigue diciendo que fue en claro', () => {
    expect(formaQueSeFue(`[mis-clases] ${NOMBRE} vino`, NOMBRE)?.comoSeDijo).toBe('');
  });

  it('btoa a secas sobre el nombre', () => {
    expect(formaQueSeFue(btoa(`la lista: ${NOMBRE}!`), NOMBRE)?.comoSeDijo).toBe(' (en base64)');
  });

  it('%-codificado, que es lo que hace una URL con los espacios', () => {
    const conEspacio = 'Sofia Pereyra Vino Marcador';
    const volcado = `/uso.gif?d=${encodeURIComponent(conEspacio)}`;

    expect(formaQueSeFue(volcado, conEspacio)?.comoSeDijo).toBe(' (%-codificado)');
  });

  /**
   * LA MUTACION QUE ABRIO ESTE AGUJERO, ENTERA Y CON SU COMPOSICION.
   *
   * `btoa(encodeURIComponent(JSON.stringify(lista)))` en el `onSuccess` de
   * `usePasarLista`. No es una rebuscadura: `btoa` revienta con cualquier
   * caracter fuera de Latin-1, asi que pasar por `encodeURIComponent` antes es
   * LA forma correcta de meter un texto en base64, y por eso es la que se
   * escribe. Sin esta familia de agujas, la fuga pasa aunque esten las tres de
   * base64 puestas: el espacio del nombre ya no es un espacio, es `%20`.
   */
  it('btoa de la forma %-codificada: la composicion de la mutacion real', () => {
    const conEspacio = 'Sofia Pereyra Vino Marcador';
    const lista = [
      { nombreCompleto: conEspacio, asistio: true },
      { nombreCompleto: 'Martin Quiroga Falto', asistio: false },
    ];
    const volcado = btoa(encodeURIComponent(JSON.stringify(lista)));

    expect(formaQueSeFue(volcado, conEspacio)?.comoSeDijo).toBe(
      ' (en base64 de su forma %-codificada)',
    );
  });

  /**
   * LA CAJA DE LAS LETRAS, QUE ERA LA INSTANCIA MAS BARATA QUE QUEDABA ABIERTA.
   *
   * MEDIDA en la cola de comprobantes de la Fase 14, por el canal mas vigilado
   * de los diecisiete: el mismo `console.info` con el nombre del archivo tiraba
   * 7 tests de 1809 en claro y pasaba los 1809 con un `.toLowerCase()` pegado.
   * Lo unico que cambiaba entre caer y no caer era esa llamada, que ademas
   * suena a buena practica —«normalizo el nombre antes de registrarlo»—.
   *
   * Se mide aqui y no solo con una mutacion porque la mutacion se revierte y
   * esto se queda: sin este guardian, simplificar `enTodasLasCajas` a una sola
   * caja deja la rendija abierta otra vez con los 1809 en verde.
   */
  it('el mismo dato en minusculas sigue siendo el mismo dato', () => {
    expect(formaQueSeFue(`[cola] ${NOMBRE.toLowerCase()}`, NOMBRE)?.comoSeDijo).toBe(
      ' (con otra caja de letras)',
    );
  });

  it('y en mayusculas tambien', () => {
    expect(formaQueSeFue(`[cola] ${NOMBRE.toUpperCase()}`, NOMBRE)?.comoSeDijo).toBe(
      ' (con otra caja de letras)',
    );
  });

  /**
   * LA FORMA LOCALIZADA DEL IMPORTE, Y POR QUE SE MIDE AQUI ADEMAS DE CON LA
   * MUTACION.
   *
   * MEDIDA en el catalogo de packs de la Fase 14, por el canal mas vigilado de
   * los diecisiete: el mismo `console.info` con los precios pasaba los 1841
   * tests envuelto en `toLocaleString('es-AR')` y tiraba 25 de 28 con el
   * precio crudo. Lo unico que cambiaba entre caer y no caer era esa llamada.
   *
   * La mutacion se revierte y esto se queda: sin este guardian, recortar
   * `REGIONES_DEL_IMPORTE` a la region de la maquina —que es la forma obvia y
   * la que parece correcta— deja la rendija abierta otra vez en CI con los
   * 1841 en verde, que es exactamente lo que le paso a la pila de `pedir` con
   * las barras de Windows.
   */
  it('un importe con el formato de la region, que es lo que se hace con el dinero', () => {
    const importe = '25000.10';

    expect(
      formaQueSeFue(`[packs] lista de precios ${(25000.1).toLocaleString('es-AR')}`, importe)
        ?.comoSeDijo,
    ).toBe(' (con el numero formateado)');
  });

  /**
   * LA REGION NO LA ELIGE EL CENTINELA: LA ELIGE LA MAQUINA QUE CORRE EL TEST.
   *
   * Es la leccion de las barras de `vinoDePedir` en otra forma. Un
   * `monto.toLocaleString()` a secas da `25.000,1` en esta maquina y
   * `25,000.1` en un CI con el entorno en ingles, y buscar una sola de las dos
   * es la manera de que el canal quede verde y ciego en la otra.
   */
  it('y en la region de un CI en ingles tambien', () => {
    const importe = '25000.10';

    expect(
      formaQueSeFue(`[packs] lista de precios ${(25000.1).toLocaleString('en-US')}`, importe)
        ?.comoSeDijo,
    ).toBe(' (con el numero formateado)');
  });

  /**
   * ⚠️ EL CERO QUE SE PIERDE, QUE ES LA PARTE QUE NO SE PUEDE DEDUCIR.
   *
   * `25000.10` localizado es `25.000,1`: el cero final NO esta, asi que la
   * forma localizada de un centinela no contiene los mismos caracteres NI LOS
   * MISMOS DIGITOS que el centinela. A esta aguja no le rompe nada —se la pide
   * a la plataforma en vez de deducirla—, y por eso el test de arriba pasa.
   *
   * Lo que SI rompe es la forma general «la secuencia de digitos», y se mide
   * aqui para que quede escrito por que no esta puesta: sobre este mismo caso
   * da `250001` contra los `2500010` del centinela y no empareja.
   */
  it('el cero final que pierde el formato no deja fuera a la aguja', () => {
    const importe = '25000.10';
    const formateado = (25000.1).toLocaleString('es-AR');

    const digitosDelCentinela = importe.replace(/[^0-9]/g, '');
    const digitosDelVolcado = formateado.replace(/[^0-9]/g, '');

    expect(digitosDelVolcado.includes(digitosDelCentinela), 'la forma general lo cazaria').toBe(
      false,
    );
    expect(formaQueSeFue(formateado, importe) !== undefined, 'la aguja exacta lo caza').toBe(true);
  });

  /**
   * LOS DOS DECIMALES CUBREN LA MONEDA DE REGALO, y conviene no deshacerlo.
   *
   * `{ style: 'currency' }` pone el simbolo DELANTE del numero, no en medio,
   * asi que la aguja de dos decimales aparece literal dentro de `$ 25.000,10`.
   * Si alguien quitara ese formato de `FORMATOS_DEL_IMPORTE` creyendo que es
   * redundante con el de por defecto, esto se pondria rojo.
   */
  it('y la forma con la moneda delante cae por la aguja de dos decimales', () => {
    const importe = '25000.10';
    const conMoneda = (25000.1).toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });

    expect(formaQueSeFue(`[caja] cobrado ${conMoneda}`, importe)?.comoSeDijo).toBe(
      ' (con el numero formateado)',
    );
  });

  it('y las dos formas se componen con las otras: base64 de la minuscula', () => {
    // Es la composicion que hace cara de cerrar esto a medias: quien normaliza
    // para el registro es, a menudo, el mismo que lo codifica «para que no se
    // lea de un vistazo».
    expect(formaQueSeFue(btoa(volcadoDe(1).toLowerCase()), NOMBRE)?.comoSeDijo).toBe(
      ' (en base64 con otra caja de letras)',
    );
  });
});

describe('lo que el alfabeto NO hace', () => {
  it('un volcado codificado sin ningun centinela dentro no acusa a nadie', () => {
    const ajeno = btoa(encodeURIComponent(JSON.stringify({ clases: 12, cupo: 20 })));

    expect(formaQueSeFue(ajeno, NOMBRE)).toBeUndefined();
  });

  /**
   * UN CENTINELA CORTO NO GENERA AGUJA DE BASE64, a proposito.
   *
   * Hacen falta dos grupos completos —seis caracteres— para emitir una. Con
   * menos, la aguja son cuatro caracteres de base64, o sea tres bytes, y
   * empieza a emparejar por casualidad dentro de cualquier texto codificado.
   * Un falso positivo en infraestructura que comparten 71 specs es peor que el
   * agujero que taparia.
   */
  it('un centinela de cuatro caracteres no se busca en base64', () => {
    const corto = 'ab-d';

    expect(formaQueSeFue(btoa(`una frase cualquiera con ${corto} dentro`), corto)).toBeUndefined();
  });

  /**
   * UN IMPORTE CORTO NO GENERA FORMA LOCALIZADA, y el motivo tiene nombre: LA
   * COMA.
   *
   * `(9.5).toLocaleString('es-AR')` es `'9,5'`, y esos tres caracteres estan
   * dentro de CUALQUIER volcado de JSON que lleve la lista `[9,5]`. Es el
   * mismo razonamiento que `MINIMO_DE_GRUPOS` en base64: una aguja corta
   * empareja por casualidad, y un falso positivo en infraestructura que
   * comparten 84 specs es peor que el agujero que taparia.
   */
  it('un importe de un digito y medio no genera aguja localizada', () => {
    expect(formaQueSeFue('las notas fueron [9,5] y [8,5]', '9.5')).toBeUndefined();
  });

  /**
   * Y UN CENTINELA QUE NO ES UN NUMERO NO PASA POR AHI.
   *
   * `Number('Abono Centinela Bronce')` es `NaN` y su `toLocaleString` seria
   * `'NaN'`: una aguja de tres caracteres que emparejaria con cualquier
   * volcado que lleve un numero roto dentro. El filtro de «un numero y nada
   * mas» es lo que lo impide, y si alguien lo quitara esto se pondria rojo.
   */
  it('un centinela que no es un numero no se intenta formatear', () => {
    expect(formaQueSeFue('[packs] el precio salio NaN, revisar', 'Abono Centinela Bronce')).toBe(
      undefined,
    );
  });
});

/**
 * EL INFORME NO PUEDE PUBLICAR NI EL VALOR NI SU CODIFICACION.
 *
 * Es la regla de todo el espia y aqui vuelve a estar en juego: el fallo de una
 * defensa contra fugas seria, el mismo, una fuga hacia el registro de CI, que
 * guarda mas tiempo y lee mas gente que la consola del mostrador. Lo unico que
 * el mensaje puede decir es VOCABULARIO FIJO —«en base64»— y el nombre de la
 * clave, que lo pone quien llama.
 *
 * Se comprueba sobre booleanos para que el propio fallo de ESTE test tampoco
 * publique nada.
 */
describe('el informe', () => {
  it('nombra la forma con vocabulario fijo y nunca el dato ni su codificacion', () => {
    const volcados = [
      `en claro: ${NOMBRE}`,
      btoa(volcadoDe(1)),
      `/uso.gif?d=${encodeURIComponent('Sofia Pereyra Vino')}`,
      `[packs] ${(25000.1).toLocaleString('es-AR')}`,
    ];
    const valores = [NOMBRE, NOMBRE, 'Sofia Pereyra Vino', '25000.10'];

    for (const [indice, volcado] of volcados.entries()) {
      const valor = valores[indice] ?? '';
      const forma = formaQueSeFue(volcado, valor);

      expect(forma !== undefined, 'la forma se encontro').toBe(true);
      expect(forma?.comoSeDijo.includes(valor) === true, 'el informe copia el valor').toBe(false);
      expect(
        forma?.comoSeDijo.includes(forma.aguja) === true,
        'el informe copia la codificacion',
      ).toBe(false);
      expect(
        [
          '',
          ' (en base64)',
          ' (%-codificado)',
          ' (en base64 de su forma %-codificada)',
          ' (con el numero formateado)',
        ].includes(forma?.comoSeDijo ?? 'otra cosa'),
        'el informe usa vocabulario fijo',
      ).toBe(true);
    }
  });
});
