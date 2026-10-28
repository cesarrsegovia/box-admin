import { describe, expect, it } from 'vitest';
import {
  contenidoDeUnaEscrituraEnDisco,
  raizDeMentira,
  SECRETOS_DEL_PANEL,
} from './espia-de-consola';

/**
 * EL GUARDIAN DEL DECIMOSEXTO CANAL, Y POR QUE ESTE SI TIENE SPEC.
 *
 * Los canales no tienen spec a proposito: lo que hay que comprobar de un tapon
 * es que una mutacion lo hace caer, y eso se mide con la mutacion y no con un
 * test que repita el codigo del tapon en otro orden. Aqui la situacion es la de
 * `relojes-falsos.spec.ts`, la de `alfabeto-de-centinelas.spec.ts`, la de
 * `red-por-fuera-de-pedir.spec.ts` y la de
 * `lo-que-el-marcado-no-serializa.spec.ts`: **ESTO NO SE VE DESDE FUERA**.
 *
 * No hay un solo uso de OPFS en `apps/web/src` —esa es, de hecho, la medida
 * que permite afirmar la forma fuerte—, asi que NINGUN spec de pantalla toca
 * este canal nunca. O sea que si alguien:
 *
 *  - «simplifica» `contenidoDeUnaEscrituraEnDisco` a mirar solo las cadenas,
 *  - se deja de anotar el NOMBRE en `getFileHandle` porque «el dato va en el
 *    contenido»,
 *  - pregunta por `type` en vez de por `data` al desenvolver la cuarta forma,
 *    y manda todos los `Blob` por la rama equivocada,
 *  - o quita una de las puertas de escritura —el `getWriter()`, la manija
 *    sincrona, el `move`—,
 *
 * LOS 1735 TESTS SIGUEN EN VERDE y el canal se queda ciego. Las cuatro averias
 * son invisibles desde cualquier spec de pantalla, asi que la unica forma de
 * custodiarlas es medirlas. Este archivo mide las cuatro.
 *
 * SE MIDE CONTRA UNA RAIZ PROPIA, no contra el tapon instalado, y no es una
 * comodidad: el tapon se afirma por la FORMA FUERTE —tocar el disco privado ES
 * el fallo—, asi que un test que ejercitara la raiz de verdad se haria caer a
 * si mismo en el `afterEach` del espia. `raizDeMentira` se exporta justamente
 * para esto, como `vinoDePedir` y `escondidoEnElCuerpo`: el guardian arma la
 * suya con su propio `anotar` y recorre las puertas sin tocar nada global.
 *
 * NO REGISTRA NINGUN CENTINELA PROPIO —no llama a `vigilarEstosDatos`— y nada
 * de lo que escribe sale por ningun canal: la raiz de aqui abajo esta
 * desconectada del tapon y no guarda nada en ninguna parte.
 *
 * EL DATO QUE MUEVE ES `claveDelReset`, QUE ES UN SECRETO DEL PANEL, y eso es a
 * proposito y por dos cosas. La primera es la de `red-por-fuera-de-pedir.spec.ts`:
 * un guardian que moviera una cadena cualquiera no probaria nada contra el
 * tapon, y con un centinela de verdad, si alguna de estas lineas lo sacara por
 * un canal sin querer, el espia lo diria. La segunda es que viene de
 * `SECRETOS_DEL_PANEL` y no escrito a mano: con la cadena en dos sitios, cambiar
 * la de alla dejaria a este archivo midiendo contra un centinela que ya no
 * existe.
 *
 * Y SE AFIRMA SOBRE BOOLEANOS, NUNCA CON `toContain(valor)`, que es la regla de
 * `espia-de-consola.ts` llevada aqui: un `toContain` imprime el argumento
 * esperado en el informe, o sea que el fallo de un test sobre un secreto
 * publicaria el secreto en el registro de CI. Lo unico que sale de aqui es un
 * `true` o un `false`.
 */

/** El centinela que recorre este archivo. Vive en un sitio solo. */
const CENTINELA = SECRETOS_DEL_PANEL.claveDelReset;

/** El tipo que `raizDeMentira` entrega: manijas de mentira, sin forma publica. */
type Manija = Record<string, unknown>;

/** Un paso anotado, con la misma forma que el tapon usa por dentro. */
interface Paso {
  puerta: string;
  ruta: string[];
  contenido: string;
}

/** Llama a una puerta de una manija de mentira y devuelve lo que entrega. */
function llamar(manija: Manija, puerta: string, ...partes: unknown[]): unknown {
  return (manija[puerta] as (...a: unknown[]) => unknown)(...partes);
}

/** Lo mismo, cuando la puerta devuelve una promesa de otra manija. */
async function abrir(manija: Manija, puerta: string, ...partes: unknown[]): Promise<Manija> {
  return (await llamar(manija, puerta, ...partes)) as Manija;
}

/** Una raiz recien hecha y la lista donde va anotando. */
function unDisco(): { raiz: Manija; pasos: Paso[] } {
  const pasos: Paso[] = [];
  const raiz = raizDeMentira((paso) => {
    pasos.push(paso);
  });

  return { raiz, pasos };
}

// ---------------------------------------------------------------------------
// Las cuatro formas que acepta `write`
// ---------------------------------------------------------------------------

describe('lo que una escritura en el disco lleva dentro', () => {
  /**
   * LAS TRES FORMAS QUE YA SABIA LEER `cuerpoDeUnaBaliza`, fijadas aqui.
   *
   * No se fijan por desconfianza del desmenuzador del octavo canal —ese tiene
   * su propia medida— sino porque LA REUTILIZACION es la decision de diseño de
   * esta pieza: si alguien la deshiciera y escribiera una decodificacion propia
   * «mas simple», estas tres caen y dicen por que.
   */
  it('lee una cadena tal cual', () => {
    expect(contenidoDeUnaEscrituraEnDisco(CENTINELA).includes(CENTINELA)).toBe(true);
  });

  /**
   * EL BUFFER **CRUDO** Y LA VISTA, Y EL CRUDO ES EL QUE DESCUBRIO UNA AVERIA.
   *
   * Esta linea estaba escrita para fijar algo que se daba por hecho y se puso
   * roja a la primera: `new TextEncoder().encode(x).buffer` NO pasaba el
   * `instanceof ArrayBuffer` de `cuerpoDeUnaBaliza` —el `ArrayBuffer` del
   * `TextEncoder` de Node y el global de un spec son dos clases distintas,
   * medido— y el buffer se serializaba a `'[object ArrayBuffer] {}'`. O sea
   * una RAMA MUERTA en los tres canales que usan ese desmenuzador. El arreglo
   * —preguntar por la etiqueta y no por la clase— vive en `esUnArrayBuffer`, y
   * estas dos lineas son lo que lo custodia: la vista pasaba antes por
   * `ArrayBuffer.isView`, que si funciona entre realms, y el crudo no.
   */
  it('decodifica un ArrayBuffer crudo y una vista sobre el', () => {
    const bytes = new TextEncoder().encode(CENTINELA);

    expect([
      contenidoDeUnaEscrituraEnDisco(bytes.buffer).includes(CENTINELA),
      contenidoDeUnaEscrituraEnDisco(bytes).includes(CENTINELA),
    ]).toEqual([true, true]);
  });

  it('decodifica un Blob', () => {
    expect(contenidoDeUnaEscrituraEnDisco(new Blob([CENTINELA])).includes(CENTINELA)).toBe(true);
  });

  /**
   * LA CUARTA FORMA, QUE ES LA UNICA QUE ESTE CANAL TUVO QUE AGREGAR.
   *
   * `write({ type: 'write', data, position })` esconde el contenido detras de
   * una clave. Sin desenvolverla, el objeto cae en `comoTexto` y un `Blob` ahi
   * dentro se serializa a `{"type":"write"}`: el canal verde y ciego justo en
   * la forma que escribe quien necesita posicionar la escritura.
   */
  it('desenvuelve la forma { type: "write", data }', () => {
    const orden = { type: 'write', data: CENTINELA, position: 0 };

    expect(contenidoDeUnaEscrituraEnDisco(orden).includes(CENTINELA)).toBe(true);
  });

  it('y la desenvuelve ADEMAS de decodificar lo que lleve dentro', () => {
    const conBlob = { type: 'write', data: new Blob([CENTINELA]) };
    const conBytes = { type: 'write', data: new TextEncoder().encode(CENTINELA).buffer };

    expect([
      contenidoDeUnaEscrituraEnDisco(conBlob).includes(CENTINELA),
      contenidoDeUnaEscrituraEnDisco(conBytes).includes(CENTINELA),
    ]).toEqual([true, true]);
  });

  /**
   * LA TRAMPA QUE DECIDE DE QUE SE PREGUNTA, Y POR LA QUE SE PREGUNTA POR
   * `data` Y NO POR `type`.
   *
   * `'type' in unBlob` es TRUE —`Blob.prototype.type` es el tipo MIME—, asi que
   * una comprobacion por `type` mandaria TODOS los `Blob` por la rama del
   * objeto, buscaria un `data` que no existe y devolveria cadena vacia. Esto
   * fija el signo correcto: el `Blob` de arriba se lee, y la premisa de por que
   * la otra pregunta fallaria se fija aqui para que no haya que volver a
   * descubrirla.
   */
  it('y no confunde un Blob con la forma del objeto, aunque un Blob tenga `type`', () => {
    const blob = new Blob([CENTINELA], { type: 'application/json' });

    expect(['type' in blob, contenidoDeUnaEscrituraEnDisco(blob).includes(CENTINELA)]).toEqual([
      true,
      true,
    ]);
  });

  /**
   * LO QUE NO ES NINGUNA DE LAS CUATRO FORMAS CAE DEL LADO SEGURO.
   *
   * Una orden `{ type: 'truncate', size: 3 }` no escribe un byte, y aun asi se
   * anota como texto porque cae en `comoTexto`. Es ruido en el volcado, no un
   * agujero: este canal puede permitirse mirar de mas y nunca de menos. Queda
   * fijado aqui para que nadie lo «arregle» con una lista de ordenes
   * reconocidas, que seria una lista negra y dejaria fuera la forma que
   * invente la plataforma el año que viene.
   *
   * Lo que si tiene que dar vacio es lo que no lleva nada.
   */
  it('y lo que no es ninguna de las cuatro formas cae del lado seguro', () => {
    expect([
      contenidoDeUnaEscrituraEnDisco(undefined),
      contenidoDeUnaEscrituraEnDisco(null),
    ]).toEqual(['', '']);

    expect(contenidoDeUnaEscrituraEnDisco({ type: 'truncate', size: 3 })).not.toBe('');
  });
});

// ---------------------------------------------------------------------------
// Las puertas del arbol: el nombre lleva dato igual que el contenido
// ---------------------------------------------------------------------------

describe('las puertas del disco privado', () => {
  /**
   * LA PUERTA QUE PUBLICA EL SECRETO SIN ESCRIBIR UN BYTE.
   *
   * Es la leccion de `indexedDB.open(nombre)` y la de
   * `localStorage.setItem(claveTemporal, '1')`: el NOMBRE es un sitio donde
   * cabe el dato. Si esta anotacion desapareciera, un
   * `raiz.getFileHandle(claveTemporal, { create: true })` pasaria en verde.
   */
  it('anota el nombre de un archivo aunque no se escriba nada', async () => {
    const { raiz, pasos } = unDisco();

    await abrir(raiz, 'getFileHandle', 'cobros-del-dia.json', { create: true });

    expect(pasos).toEqual([
      { puerta: 'getFileHandle', ruta: ['cobros-del-dia.json'], contenido: '' },
    ]);
  });

  /** Y el de un directorio, que es la otra mitad de la misma puerta. */
  it('anota el nombre de un directorio y anida la ruta', async () => {
    const { raiz, pasos } = unDisco();

    const carpeta = await abrir(raiz, 'getDirectoryHandle', 'mostrador', { create: true });
    await abrir(carpeta, 'getFileHandle', 'cobros.json', { create: true });

    expect(pasos.map((paso) => paso.ruta)).toEqual([['mostrador'], ['mostrador', 'cobros.json']]);
  });

  /** Borrar tambien nombra, como `deleteDatabase` en el undecimo canal. */
  it('anota el nombre de lo que se borra', async () => {
    const { raiz, pasos } = unDisco();

    await llamar(raiz, 'removeEntry', 'cobros-del-dia.json');

    expect(pasos).toEqual([
      { puerta: 'removeEntry', ruta: ['cobros-del-dia.json'], contenido: '' },
    ]);
  });

  /** Renombrar publica el nombre NUEVO, en el directorio del archivo. */
  it('anota el nombre nuevo de un archivo que se mueve', async () => {
    const { raiz, pasos } = unDisco();

    const carpeta = await abrir(raiz, 'getDirectoryHandle', 'mostrador');
    const archivo = await abrir(carpeta, 'getFileHandle', 'uno.json');
    await llamar(archivo, 'move', 'renombrado.json');

    expect(pasos.at(-1)).toEqual({
      puerta: 'move',
      ruta: ['mostrador', 'renombrado.json'],
      contenido: '',
    });
  });

  /**
   * LAS TRES PUERTAS POR LAS QUE SE VAN LOS BYTES, Y HACEN FALTA LAS TRES.
   *
   * `createWritable().write` es la de manual, `getWriter().write` es la misma
   * corriente por la otra boca —un `FileSystemWritableFileStream` ES un
   * `WritableStream`— y `createSyncAccessHandle().write` es la puerta rapida y
   * SINCRONA que traen algunos navegadores. Cubrir una y no las otras seria
   * reabrir el canal cambiando una palabra, que es el argumento de `mark` sin
   * `measure`.
   */
  it('anota lo escrito por las tres puertas de escritura, con la ruta del archivo', async () => {
    const { raiz, pasos } = unDisco();

    const archivo = await abrir(raiz, 'getFileHandle', 'cobros.json', { create: true });

    const flujo = await abrir(archivo, 'createWritable');
    await llamar(flujo, 'write', 'por-el-flujo');

    const escritor = llamar(flujo, 'getWriter') as Manija;
    await llamar(escritor, 'write', new Blob(['por-el-escritor']));

    const sincrona = await abrir(archivo, 'createSyncAccessHandle');
    llamar(sincrona, 'write', new TextEncoder().encode('por-la-sincrona'));

    expect(pasos.slice(1)).toEqual([
      {
        puerta: 'createWritable().write',
        ruta: ['cobros.json'],
        contenido: 'por-el-flujo',
      },
      {
        puerta: 'createWritable().write',
        ruta: ['cobros.json'],
        contenido: 'por-el-escritor',
      },
      {
        puerta: 'createSyncAccessHandle().write',
        ruta: ['cobros.json'],
        contenido: 'por-la-sincrona',
      },
    ]);
  });

  /**
   * LA MANIJA SINCRONA DEVUELVE BYTES, que es lo que pide su API.
   *
   * No es cosmetica: el codigo de manual compara lo escrito con el tamaño del
   * buffer, y una manija que devolviera siempre cero haria que ese codigo
   * tomara la rama de error y la fuga no llegara a la segunda linea.
   */
  it('y la sincrona devuelve cuantos bytes escribio', async () => {
    const { raiz } = unDisco();

    const archivo = await abrir(raiz, 'getFileHandle', 'cobros.json');
    const sincrona = await abrir(archivo, 'createSyncAccessHandle');
    const bytes = new TextEncoder().encode('doce-de-doce');

    expect(llamar(sincrona, 'write', bytes)).toBe(bytes.byteLength);
  });

  /**
   * LAS LECTURAS NO ANOTAN NADA, y esta escrito como test para que no se
   * «arregle» al reves.
   *
   * Leer no saca un dato de esta pagina: lo trae. Anotarlas pondria el canal
   * rojo con el codigo correcto el dia que alguien lea algo legitimamente, que
   * es la forma de ser rojo que este archivo evita en todas partes.
   */
  it('y leer el disco no anota nada', async () => {
    const { raiz, pasos } = unDisco();

    const archivo = await abrir(raiz, 'getFileHandle', 'cobros.json');
    await llamar(archivo, 'getFile');
    await llamar(raiz, 'resolve', archivo);

    const recorrido: unknown[] = [];
    for await (const entrada of llamar(raiz, 'values') as AsyncIterable<unknown>) {
      recorrido.push(entrada);
    }

    // La unica anotacion es la del NOMBRE, que la puso `getFileHandle`.
    expect([pasos.length, recorrido.length]).toEqual([1, 0]);
  });
});
