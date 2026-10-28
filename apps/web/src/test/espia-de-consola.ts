import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { despacharLaSalidaDeLaPestana } from './salida-de-la-pestana';

/**
 * LOS CANALES POR LOS QUE UNA PANTALLA DICE ALGO QUE NO MIRA NADIE.
 *
 * `console.*`, `document.title`, `window.name`, el `<head>` del documento, los
 * tres almacenes del navegador, el buffer de User Timing
 * (`performance.mark` / `performance.measure`), el `src` de una imagen
 * —`new Image()`, que es una peticion de red que no pasa por `fetch` ni por el
 * `<body>`—, las SALIDAS LATERALES —`window.postMessage`,
 * `BroadcastChannel` y `navigator.sendBeacon`—, el almacen de respuestas del
 * navegador (`CacheStorage`), el SERVICE WORKER
 * (`navigator.serviceWorker.controller.postMessage`), que en este producto
 * esta instalado de verdad, INDEXEDDB, que es el QUINTO almacen en disco y
 * el unico sin tope de tamaño, EL `<html>` Y EL `<body>` —sus ATRIBUTOS Y LO
 * QUE CUELGA DEL `<html>` fuera del `<head>` y del `<body>`—,
 * que son los dos elementos que envuelven al cuerpo y que no desmonta nadie, y
 * LA URL DEL DOCUMENTO —`location` y las cinco puertas de la History API—, que
 * es el hueco ENTRE las dos defensas de este repo y el unico canal que se
 * copia solo, y LA RED POR FUERA DE `pedir` —`fetch`, `XMLHttpRequest`,
 * `WebSocket`, `EventSource`, `Worker` y `SharedWorker`—, que es la defensa
 * que los canales septimo y octavo daban por supuesta y que vivia, a mano, en
 * tres specs de setenta y cuatro, y EL DISCO PRIVADO DEL ORIGEN —OPFS,
 * `navigator.storage.getDirectory()`—, que es el SEXTO almacen y un SISTEMA DE
 * ARCHIVOS entero: sobrevive al logout y al reinicio como `localStorage`, no
 * tiene el tope de 5 MB, guarda bytes sin que nadie serialice y NO SALE en la
 * pestaña «Application» donde si salen los otros cinco. Ninguno de esos
 * DIECIOCHO lo mira un test de pantalla: los tests
 * miran el marcado DEL CUERPO, los cuerpos de las peticiones, las rutas y las
 * dos caches.
 *
 * Y EL DECIMOQUINTO ESTA DEL OTRO LADO DE ESA FRASE, que es lo que lo hace
 * distinto de los otros quince: LO QUE EL MARCADO DEL `<body>` **NO SERIALIZA** —el
 * `.value` de un control, que para los tipos en modo valor y para un
 * `<textarea>` no se refleja a ningun atributo, y el contenido de un
 * `shadowRoot` abierto—. Esta DENTRO del cuerpo, o sea del lado que miran los
 * tests de pantalla, y aun asi no lo ve ninguno: leen `innerHTML` y
 * `textContent`, y ahi eso no sale. Es el hueco entre las DOS defensas visto
 * por dentro, como la URL del documento lo era visto por fuera.
 *
 * Se vigilan todos juntos, GLOBAL —desde `vitest.setup.ts`— y
 * contra EL MISMO registro de datos vigilados, por tres motivos que ya se
 * pagaron una vez cada uno:
 *
 * 1. GLOBAL, porque un agujero de canal no es de una pantalla. El espia de la
 *    consola empezo siendo manual y lo engancharon cinco specs de cuarenta y
 *    nueve: `console.*` estaba sin vigilar en el 90% del paquete, incluida la
 *    ficha de una persona, que es la que enseña la contraseña del reset.
 *
 * 2. UN SOLO REGISTRO, porque pasarle el centinela a cada tapon por separado es
 *    acordarse tres veces. Un spec declara UNA vez lo que sembro y TODOS lo
 *    cubren; el que viene detras no tiene que saber cuantos tapones hay.
 *
 * 3. Y EL REGISTRO ES ABIERTO, no una lista de tres literales. `vigilarElTitulo`
 *    nacio comparando contra `SECRETOS_DEL_PANEL` y nada mas: un `document.title`
 *    con el nombre de una profesora, o con la lista de turnos del dia, pasaba en
 *    verde. Era una lista negra —el patron contra el que este repo predica—
 *    puesta en infraestructura que comparten cuarenta y nueve specs.
 *
 * DIECIOCHO CANALES Y DOS EJES. Los canales son PUERTAS: sitios por donde sale
 * un dato. Los ejes no abren ninguna puerta nueva — mueven el MOMENTO en que la
 * pantalla habla a un hueco donde ninguno de los dieciocho tapones esta
 * mirando, y por eso los apagan todos de una linea, incluidos los que se tapen
 * mañana. Van numerados detras de los canales y viven cada uno en su archivo:
 *
 *  - EL DECIMOCTAVO, `src/test/rato-libre.ts`: `requestIdleCallback`, que
 *    jsdom no implementa, asi que lo aplazado al rato libre no corre NUNCA
 *    dentro del test. Se tapa MONTANDO la API para que corra.
 *  - EL DECIMONOVENO, `src/test/salida-de-la-pestana.ts`: los cinco eventos de
 *    salida de la pestaña —`beforeunload`, `visibilitychange`, `freeze`,
 *    `pagehide` y `unload`—, que jsdom no dispara NUNCA, asi que un oyente
 *    registrado en un `useEffect` vive y muere sin que nadie le hable. Se tapa
 *    DESPACHANDOLOS, como primera linea del `afterEach` de aqui abajo y antes
 *    del `cleanup()`, que es donde el oyente todavia esta puesto.
 */

/**
 * LOS SECRETOS DEL PANEL, nombrados UNA VEZ CADA UNO.
 *
 * Son los tres datos que esta fase pone delante del mostrador y que no se
 * pueden releer: el codigo con el que un alumno se registra, la contraseña
 * temporal que sale del alta y la que sale del reset.
 *
 * Viven aqui y no en cada spec porque los siembran los specs y los vigila el
 * tapon de abajo: con la cadena escrita en los dos sitios, cambiar la de un
 * spec dejaria al tapon mirando un centinela que ya no existe y pasando en
 * verde para siempre. Cada spec importa de aqui el suyo para sembrarlo.
 *
 * Son LA BASE del registro, no todo el registro: valen en todos los specs
 * —incluidos los que no siembran ninguno, donde no cuestan nada y siguen siendo
 * ciertos— y cada spec agrega los suyos con `vigilarEstosDatos`.
 */
export const SECRETOS_DEL_PANEL = {
  /** El codigo de la clave de invitacion (`/{slug}/admin/invitaciones`). */
  codigoDeInvitacion: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
  /** La contraseña temporal que devuelve el alta de un alumno. */
  claveDelAlta: 'Temp0ral!',
  /** La contraseña temporal que devuelve resetear la de alguien. */
  claveDelReset: 'Clave-Temporal-9',
} as const;

/**
 * Lo que ESTE spec considera sensible, ademas de los secretos del panel.
 *
 * Se llama UNA vez, en el cuerpo del modulo del spec —no dentro de un
 * `beforeEach`—: cada archivo de test corre aislado, asi que lo registrado vale
 * para ese archivo y para ninguno mas, y no hay que acordarse por test.
 *
 * Toma un objeto y no cadenas sueltas para que el fallo pueda decir QUE dato se
 * escapo sin ESCRIBIRLO: el mensaje nombra la clave («el titulo de la pagina
 * lleva nombreDeLaAnotada») y el valor no entra en el informe —que acaba en el
 * registro de CI, que lo guarda mas tiempo y lo lee mas gente que la consola
 * del mostrador—. Ver la forma de las afirmaciones en `vigilarLosCanalesDeSalida`.
 */
const vigilados = new Map<string, string>();

export function vigilarEstosDatos(datos: Record<string, string>): void {
  for (const [nombre, valor] of Object.entries(datos)) {
    if (valor.trim() !== '') vigilados.set(nombre, valor);
  }
}

function todoLoVigilado(): [string, string][] {
  return [...Object.entries(SECRETOS_DEL_PANEL), ...vigilados];
}

// ---------------------------------------------------------------------------
// EL ALFABETO: no es un canal mas, es COMO se busca el centinela en los dieciocho
// ---------------------------------------------------------------------------

/**
 * LOS DIECIOCHO CANALES COMPARTEN UNA PROPIEDAD, Y UNA SOLA LINEA LOS DERROTA.
 *
 * Todos afirman igual: `volcado.includes(valor)`. Esa decision es correcta y
 * esta razonada arriba canal por canal —un tapon que prohiba `console.info`,
 * pedir una imagen o hablarle al worker se desactiva el dia que alguien lo
 * necesite, y entonces no tapa nada—. Pero tiene un corolario que ningun test
 * enunciaba: **buscar por subcadena del valor CRUDO deja pasar cualquier
 * transformacion del dato, y la deja pasar por los dieciocho a la vez.** No es un
 * agujero de un canal: es un agujero del alfabeto.
 *
 * LA MUTACION QUE LO DESCUBRIO, medida, en el `onSuccess` de un hook:
 *
 *     console.info('[mis-clases] diagnostico', btoa(encodeURIComponent(JSON.stringify(lista))));
 *
 * donde `lista` lleva el nombre propio y la ausencia de cada alumno de una
 * clase. Sobrevivio los 1599 tests del paquete con los trece canales
 * enchufados, Y POR EL CANAL MAS VIGILADO DE LOS DIECIOCHO. El control que lo
 * prueba: la MISMA linea sin el `btoa` hace caer 5 tests con «la consola dijo
 * alumnaQueVino». El instrumento funcionaba; lo unico que cambiaba entre caer
 * y no caer era la codificacion.
 *
 * Y ES LA BRECHA MAS BARATA DE EXPLOTAR DE TODO ESTE ARCHIVO. Los doce canales
 * anteriores pedian ENCONTRAR una puerta —saber que jsdom no trae `caches`,
 * que `sendBeacon` existe, que la History API tiene cinco bocas—. Esta se
 * escribe sola, y ademas «lo codifico para que no se lea de un vistazo en la
 * consola» SUENA A BUENA PRACTICA: es lo que escribe, de buena fe, quien no
 * quiere ensuciar la consola del mostrador con un volcado.
 *
 * ASI QUE SE ARREGLA AQUI Y NO CANAL POR CANAL: lo que cambia no es QUE se
 * prohibe —sigue sin prohibirse ninguna llamada— sino COMO se busca el
 * centinela. Cada centinela se convierte en una LISTA DE AGUJAS —el valor y
 * sus formas codificadas— y los dieciocho canales buscan la lista entera. Un canal
 * que se tape mañana hereda el alfabeto sin escribir una linea, que es el
 * mismo motivo por el que el registro de datos es uno solo y no uno por tapon.
 *
 * LAS FORMAS QUE SE CUBREN, y el criterio por el que entran. Se cubre una
 * transformacion SOLO si es algo que alguien escribiria SIN MALA INTENCION:
 * contra una fuga deliberada no hay defensa razonable —quien quiera sacar un
 * dato puede partirlo en tres y mandarlo en tres lineas—, asi que el tapon que
 * sirve es el que caza al que no esta atacando a nadie.
 *
 *  - EN CLARO. La de siempre, y va PRIMERA para que el informe de la fuga
 *    normal siga diciendo exactamente lo que decia antes.
 *  - `encodeURIComponent` / `encodeURI`. Es meter el dato en una URL, o en un
 *    query, o en el `src` de una imagen: la cosa mas normal del mundo y la
 *    primera mitad de la mutacion de arriba. Las dos funciones se piden porque
 *    difieren en los caracteres reservados; cuando dan lo mismo —el caso
 *    habitual, un nombre con espacios— la segunda no agrega ninguna aguja.
 *  - `btoa`, EN SUS TRES DESPLAZAMIENTOS. Ver el detalle de abajo: sin los
 *    tres, esto no sirve para la fuga de verdad.
 *  - `btoa` DE LA FORMA %-CODIFICADA, tambien en tres desplazamientos. No es
 *    una rebuscadura: `btoa` solo admite Latin-1 y revienta con un acento mal
 *    colocado, asi que pasar por `encodeURIComponent` antes es LA FORMA
 *    CORRECTA de meter un texto en base64 — es lo que dice la documentacion y
 *    es, literalmente, lo que hacia la mutacion.
 *  - LAS TRES CAJAS DE LETRAS. Ver el comentario dentro de `formasDe`: un
 *    `.toLowerCase()` derrotaba los dieciocho canales a la vez.
 *  - LA FORMA LOCALIZADA DE UN IMPORTE —`toLocaleString`—, que es la unica del
 *    alfabeto que depende de parametros y por eso se argumenta aparte, entera,
 *    en el docblock de `agujasLocalizadas`: `25000.10` sale `25.000,1` y el
 *    centinela deja de estar en el volcado en ninguna de las formas de arriba.
 *
 * LO QUE SE QUEDA FUERA, DICHO AQUI PARA QUE NADIE LO DESCUBRA CREYENDO QUE
 * ESTO LO TAPABA —un limite escrito es una defensa; un limite tacito es una
 * trampa para el que venga—:
 *
 *  - PARTIR EL DATO. `nombre.split('')`, mandar la mitad por un canal y la
 *    mitad por otro, un carrusel de un caracter por linea. Es una fuga
 *    DELIBERADA: nadie parte un nombre en letras por comodidad. Y cubrirla
 *    exigiria buscar SUBSECUENCIAS en vez de subcadenas, lo que pondria rojo
 *    cualquier volcado que por azar contenga las letras en orden. El remedio
 *    seria peor que la enfermedad y ademas no cierra nada: el que parte en dos
 *    parte en tres.
 *  - COMPRIMIR (`CompressionStream`, gzip, LZ). Nadie comprime una traza de
 *    consola sin intencion, no hay API sincrona que usar desde el `afterEach`,
 *    y el resultado son bytes que no se comparan por subcadena.
 *  - HASHEAR O CIFRAR (SHA-256, HMAC, AES). No es que sea caro: es que no se
 *    puede. Un hash depende de la sal, del algoritmo y de la codificacion, y
 *    el espacio de combinaciones no tiene fondo. Tampoco encaja en el
 *    criterio: nadie hashea un dato para «no ensuciar la consola».
 *  - BYTES SUELTOS (`TextEncoder`, `Array.from(…, c => c.charCodeAt(0))`,
 *    hexadecimal, `Buffer.toString('hex')`). Un volcado de numeros no es algo
 *    que nadie escriba sin querer, y donde SI pasa de verdad —el cuerpo de una
 *    baliza— ya esta cubierto por el otro lado: `cuerpoDeUnaBaliza` decodifica
 *    los `ArrayBuffer` y los `Blob` de vuelta a texto antes de comparar.
 *  - DOS NIVELES DE LO MISMO (`encodeURIComponent` dos veces, `btoa(btoa(x))`).
 *    Se cubre UN nivel de %-codificado y UN `btoa` encima de el, que es la
 *    composicion que la gente escribe. Mas niveles son combinatoria sin final
 *    y ya no son un descuido.
 *
 *  - ⚠️ **LA FORMA GENERAL «LA SECUENCIA DE DIGITOS DEL CENTINELA»**, que es la
 *    que parece cubrir de un golpe la forma localizada y todas sus primas
 *    —cambiar los separadores sin cambiar las cifras: `25.000,10`,
 *    `25,000.10`, `25 000,10`, `25-000-10`—. SE PROBO Y SE MIDIO SOBRE EL
 *    PAQUETE ENTERO antes de descartarla, con la mutacion de los packs puesta
 *    y la comparacion hecha sobre el volcado SIN sus caracteres no numericos,
 *    con el mismo minimo de seis:
 *
 *        falsos positivos en los otros 83 archivos  →  0 de 1817 tests
 *        coste en reloj de pared                    →  31,8 s contra 31,8 s
 *        de los dos precios del catalogo, caza      →  UNO
 *
 *    **Y EL QUE NO CAZA ES JUSTO EL DE LA MUTACION.** `9900.25` conserva sus
 *    digitos al localizarse (`9.900,25` → `990025`) y cae; `25000.10` PIERDE EL
 *    CERO FINAL (`25.000,1` → `250001` contra `2500010` del centinela) y pasa
 *    en verde. O sea que la forma general no es mas general: cubre un conjunto
 *    DISTINTO que no incluye el caso que abrio esta tarea, y habria que poner
 *    las agujas concretas igualmente.
 *
 *    Y aunque cazara, no iria al sitio comun, por la razon que este archivo ya
 *    escribio para `decodeURIComponent` tres parrafos mas abajo: lo que se
 *    transforma es LA AGUJA, nunca el volcado. Proyectar el volcado a sus
 *    digitos SUELDA cifras que estaban separadas —un
 *    `{"clases":12,"cupo":20,"precio":500}` se vuelve `1220500` y empareja con
 *    un centinela `220500` que nadie publico—, y el cero de hoy es suerte de
 *    los centinelas que hay, no una propiedad de la defensa. Una aguja exacta
 *    no tiene ese modo de fallo.
 *
 * Y UNA COSA QUE NO SE DUPLICA, A PROPOSITO: el decimotercer canal resuelve el
 * %-codificado POR SU CUENTA, decodificando su propio volcado
 * —`urlComoTexto` le pega al `href` su `decodeURIComponent`—. Eso es MAS fuerte
 * que una aguja, porque atrapa tambien codificaciones que aqui no se generan
 * (hexadecimal en minuscula, un `encodeURI` a mano). Se deja como esta y NO se
 * lleva esa idea al sitio comun, que seria la forma obvia de generalizarlo y es
 * la mala: `decodeURIComponent` REVIENTA con un `%` suelto —un `console.log`
 * que diga «50% de asistencia» ya lo tiene— y el `catch` se comeria el volcado
 * entero, dejando el canal ciego justo por haberlo querido reforzar. Codificar
 * la AGUJA no tiene ese modo de fallo, y ademas se calcula UNA vez por
 * centinela en vez de una vez por volcado y por test.
 */
interface FormaDelDato {
  /** Lo que se busca por subcadena en el volcado de un canal. */
  aguja: string;
  /**
   * Como nombrar la forma en el informe, y NUNCA el valor ni su codificacion.
   *
   * Vacio cuando el dato salio en claro, para que el mensaje de la fuga normal
   * sea identico al de antes de que esto existiera.
   */
  comoSeDijo: string;
}

/**
 * EL DETALLE QUE DECIDE SI ESTO SIRVE: BASE64 SE ALINEA EN BLOQUES DE 3 BYTES.
 *
 * `btoa` toma los bytes de tres en tres y escribe cuatro caracteres por grupo.
 * O sea que la codificacion de un centinela aparece dentro de la codificacion
 * del volcado entero SOLO SI el centinela empieza en una posicion multiplo de
 * 3. En una fuga de verdad el centinela esta EN MEDIO —`btoa` del JSON entero,
 * con el nombre detras de `[{"alumna":"`— y la posicion es la que toque.
 *
 * MEDIDO, con `'Sofia-Pereyra-Vino-Marcador'` dentro de un volcado grande y el
 * relleno de delante variando de 0 a 6: la aguja alineada (k=0) empareja en
 * los rellenos 0, 3 y 6 — o sea que UNA SOLA aguja falla DOS DE CADA TRES
 * VECES. Con las tres, empareja siempre exactamente una: k=0 en los rellenos
 * 0/3/6, k=1 en 1/4 y k=2 en 2/5. Si solo se probara el caso alineado, el test
 * del tapon pasaria en verde y la defensa no serviria para la fuga real.
 *
 * COMO SE GENERAN LAS TRES. Se antepone al centinela `k` bytes de relleno
 * (k = 0, 1, 2) y se codifica; eso coloca el primer byte del centinela en la
 * posicion `k` del primer grupo, que es justo lo que le pasaria dentro del
 * volcado. Despues se RECORTAN LOS BORDES, que es la otra mitad:
 *
 *  - por delante, el primer grupo entero cuando hubo relleno (4 caracteres),
 *    porque sus bits llevan mezclado el relleno que nos inventamos;
 *  - por detras, lo que no sea un grupo COMPLETO de tres bytes del centinela,
 *    porque el ultimo grupo de `btoa` lleva relleno `=` y bits a cero que en
 *    el volcado de verdad serian los bytes que vienen detras del centinela.
 *
 * Lo que queda son solo caracteres que dependen UNICAMENTE del centinela, y
 * por eso aparecen literalmente dentro del volcado codificado.
 *
 * (Se recorta un grupo entero por delante aunque DOS de sus cuatro caracteres
 * sean ya deducibles del centinela solo. Quedarselos alargaria la aguja dos
 * caracteres y no cambia a quien caza: lo que decide es que la aguja sea
 * EXACTA, no que sea larga.)
 *
 * SE EXIGEN DOS GRUPOS COMPLETOS —8 caracteres, 6 bytes del centinela— para
 * emitir una aguja. Una aguja de 4 caracteres son 3 bytes y empieza a
 * emparejar por casualidad; un centinela tan corto tampoco sobreviviria a la
 * comparacion en claro, que ya lo encuentra en cualquier texto.
 */
const MINIMO_DE_GRUPOS = 2;

/** Un byte cualquiera de Latin-1 para desplazar: se recorta despues. */
const RELLENO_DE_BASE64 = '\u0000';

function agujasDeBase64(texto: string): string[] {
  const agujas: string[] = [];

  for (let desplazamiento = 0; desplazamiento < 3; desplazamiento += 1) {
    // Con `k` bytes de relleno delante, el primer grupo completo del centinela
    // empieza en su byte `3 - k`; lo anterior se recorta.
    const bytesCubiertos =
      desplazamiento === 0 ? texto.length : texto.length - (3 - desplazamiento);
    const grupos = Math.floor(bytesCubiertos / 3);
    if (grupos < MINIMO_DE_GRUPOS) continue;

    let codificado: string;

    try {
      codificado = btoa(RELLENO_DE_BASE64.repeat(desplazamiento) + texto);
    } catch {
      // `btoa` solo admite Latin-1 y revienta con cualquier cosa fuera de ese
      // rango. No es una perdida: quien quiera codificar un texto asi TIENE
      // que pasar antes por `encodeURIComponent`, y esa composicion es la otra
      // familia de agujas de `formasDe`.
      return agujas;
    }

    const desde = desplazamiento === 0 ? 0 : 4;
    agujas.push(codificado.slice(desde, desde + grupos * 4));
  }

  return agujas;
}

/**
 * LA FORMA LOCALIZADA DE UN IMPORTE, QUE ES LA UNICA DEL ALFABETO QUE NO ES
 * DETERMINISTA — Y LA QUE FALTABA EN LA FASE DEL DINERO.
 *
 * MEDIDO en el catalogo de packs de la Fase 14, por el canal MAS vigilado de
 * los dieciocho:
 *
 *     console.info('[packs] lista de precios', packs.data.map((p) =>
 *       Number(p.precio).toLocaleString('es-AR')))
 *       → pasan los 1841 tests del paquete.
 *     console.info('[packs] lista de precios', packs.data.map((p) => p.precio))
 *       → caen 25 de los 28 de ese archivo.
 *
 * Lo unico que cambia entre caer y no caer es la llamada a `toLocaleString`.
 * `25000.10` sale `25.000,1` y `9900.25` sale `9.900,25`: el punto se vuelve
 * coma y aparecen los separadores de miles, asi que el centinela no esta en el
 * volcado NI en claro, NI en base64, NI %-codificado, NI en otra caja de
 * letras. Es la familia del `.toLowerCase()` —una transformacion que suena a
 * buena practica y que derrota los dieciocho canales a la vez— y no es una
 * rebuscadura: FORMATEAR UN IMPORTE PARA LEERLO ES *LA* COSA QUE SE HACE CON EL
 * DINERO.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTA FORMA NO ES COMO LAS OTRAS, Y QUE SE DECIDIO POR ESO.
 *
 * `btoa`, `encodeURIComponent` y las dos cajas de letras son funciones SIN
 * PARAMETROS: dado el centinela, la aguja es una y esta. `toLocaleString`
 * depende de UNA REGION Y DE UNAS OPCIONES, y ese espacio no tiene fondo —cada
 * locale del mundo cruzado con `minimumFractionDigits`, `style`, `notation`,
 * `useGrouping`…—. No se puede cubrir entero, asi que se elige, y la eleccion
 * se escribe aqui con el mismo criterio que el resto del alfabeto: SE CUBRE LO
 * QUE ALGUIEN ESCRIBIRIA SIN MALA INTENCION.
 *
 * LAS REGIONES QUE ENTRAN, Y SON TRES:
 *
 *  - `'es-AR'`, la del producto. Es un gimnasio argentino y es la region que
 *    esta escrita en la mutacion de arriba, porque es la que escribe quien
 *    formatea un peso.
 *  - `'en-US'`, que NO es «ser mas ancho por si acaso» sino la leccion de las
 *    barras de `vinoDePedir`: el formato por defecto depende de la MAQUINA.
 *    MEDIDO aqui: `Intl.NumberFormat().resolvedOptions().locale` es `'es-AR'`
 *    en esta maquina y seria `'en-US'` en un CI con el entorno en ingles.
 *    Cubrir solo la region de quien corre el test es la manera de que esto
 *    quede verde y ciego en la otra maquina, que es exactamente como empezo la
 *    medida de la pila.
 *  - LA REGION POR DEFECTO (`undefined`), que es lo que de verdad se escribe
 *    —`monto.toLocaleString()` a secas— y que en una maquina u otra coincide
 *    con una de las dos de arriba. Cuando coincide, `agregar` la descarta sola:
 *    no cuesta nada donde no hace falta.
 *
 * LAS OPCIONES QUE ENTRAN, Y SON DOS:
 *
 *  - NINGUNA. `(25000.1).toLocaleString('es-AR')` → `25.000,1`.
 *  - DOS DECIMALES FIJOS, que es como se escribe un importe:
 *    `{ minimumFractionDigits: 2, maximumFractionDigits: 2 }` → `25.000,10`.
 *
 * Y ESA SEGUNDA CUBRE GRATIS LA MONEDA, que era la opcion obvia que falta en la
 * lista. MEDIDO: `(25000.1).toLocaleString('es-AR', { style: 'currency',
 * currency: 'ARS' })` es `'$ 25.000,10'`, y ahi dentro esta LITERALMENTE la
 * aguja de dos decimales. El simbolo va delante del numero, no en medio, asi
 * que la subcadena empareja. Agregar `style: 'currency'` no sumaria ni una
 * aguja nueva y obligaria a elegir una moneda.
 *
 * LO QUE SE QUEDA FUERA, DICHO AQUI PARA QUE NADIE LO DESCUBRA CREYENDO QUE
 * ESTO LO TAPABA —un limite escrito es una defensa; un limite tacito es una
 * trampa para el que venga—:
 *
 *  - LAS DEMAS REGIONES. `'de-DE'`, `'fr-FR'`, `'pt-BR'`… Nadie en el mostrador
 *    de un gimnasio argentino formatea un peso en frances, y ademas `'fr-FR'`
 *    separa los miles con un espacio fino (U+202F) que no se parece a nada de
 *    lo que este producto escribe. (`'es-ES'` NO es gratis y conviene no
 *    creerlo: MEDIDO, `(9900.25).toLocaleString('es-ES')` es `'9900,25'` SIN
 *    punto de miles, porque esa region no agrupa los numeros de cuatro cifras.
 *    Queda fuera igual, por el mismo criterio.)
 *  - `notation: 'compact'` (`25 mil`), `style: 'percent'`, `useGrouping: false`.
 *    Son formatos que cambian el NUMERO y no solo sus separadores: `'25 mil'`
 *    ya no identifica el importe, asi que ni siquiera seria una fuga del mismo
 *    dato.
 *  - UN CENTINELA QUE NO SEA UN NUMERO Y NADA MAS. `'$ 25000.10'`, `'25000,10'`
 *    o `'ARS 25000.10'` no pasan por aqui: `Number` no los lee y la aguja seria
 *    un invento. Lo que se localiza es lo que es un numero.
 *
 * ---------------------------------------------------------------------------
 * EL DIGITO QUE SE PIERDE, QUE ES LA PARTE QUE NO SE PUEDE DEDUCIR.
 *
 * `25000.10` localizado es `25.000,1`: EL CERO FINAL NO ESTA. O sea que la
 * forma localizada de un centinela NO siempre contiene los mismos caracteres
 * —ni los mismos digitos— que el centinela.
 *
 * A ESTA FORMA NO LE ROMPE NADA, y el motivo es que la aguja se CALCULA desde
 * el centinela en vez de deducirse de el: se le pide a la plataforma el mismo
 * `toLocaleString` que le pidio la pantalla, asi que el cero se pierde en los
 * dos sitios igual y la subcadena empareja. Es la misma propiedad por la que
 * `agujasDeBase64` codifica la AGUJA en vez de decodificar el volcado.
 *
 * LO QUE SI ROMPE ES LA FORMA GENERAL —buscar «la secuencia de digitos» en vez
 * de una aguja exacta—, y esto se midio sobre el paquete entero antes de
 * descartarla: el detalle esta en el ultimo punto de «lo que se queda fuera»
 * del docblock de `FormaDelDato`.
 *
 * ---------------------------------------------------------------------------
 * EL MINIMO, QUE ES LO QUE SEPARA UNA AGUJA DE UN FALSO POSITIVO.
 *
 * Es la misma decision que `MINIMO_DE_GRUPOS` en base64 y por el mismo motivo:
 * una aguja corta empareja por casualidad. Aqui el riesgo es concreto y tiene
 * nombre —LA COMA—: `(9.5).toLocaleString('es-AR')` es `'9,5'`, y un volcado de
 * JSON con la lista `[9,5]` dentro lleva esos tres caracteres sin que nadie
 * haya filtrado nada. Con seis caracteres, la aguja mas corta que se emite es
 * `'15.000'`, que ya no aparece por azar.
 *
 * Se mide la AGUJA y no los digitos del centinela a proposito: lo que decide si
 * una subcadena colisiona es su longitud, no cuantas cifras tenga el numero del
 * que salio.
 */
const SOLO_UN_NUMERO = /^-?\d+(?:\.\d+)?$/;

/** Las regiones cuyo formato se cubre. `undefined` es la de la maquina. */
const REGIONES_DEL_IMPORTE: readonly (string | undefined)[] = ['es-AR', 'en-US', undefined];

/** Sin opciones, y con los dos decimales de un importe. */
const FORMATOS_DEL_IMPORTE: readonly (Intl.NumberFormatOptions | undefined)[] = [
  undefined,
  { minimumFractionDigits: 2, maximumFractionDigits: 2 },
];

/** Por debajo de esto, la aguja empareja por casualidad. Ver el docblock. */
const MINIMO_DE_LA_FORMA_LOCAL = 6;

function agujasLocalizadas(valor: string): string[] {
  if (!SOLO_UN_NUMERO.test(valor)) return [];

  const numero = Number(valor);

  // Fuera del rango seguro, `Number` ya perdio cifras y `toLocaleString` pasa a
  // notacion cientifica: la aguja dejaria de ser una forma de ESTE centinela.
  if (!Number.isFinite(numero) || Math.abs(numero) > Number.MAX_SAFE_INTEGER) return [];

  const agujas: string[] = [];

  for (const region of REGIONES_DEL_IMPORTE) {
    for (const opciones of FORMATOS_DEL_IMPORTE) {
      let formateado: string;

      try {
        formateado = numero.toLocaleString(region, opciones);
      } catch {
        // Un entorno sin los datos de esa region lanza `RangeError`. No es una
        // perdida: las otras dos siguen emitiendo su aguja.
        continue;
      }

      if (formateado.length >= MINIMO_DE_LA_FORMA_LOCAL) agujas.push(formateado);
    }
  }

  return agujas;
}

/**
 * Las agujas de cada centinela, calculadas UNA VEZ para todo el archivo de test.
 *
 * Es lo que hace que esto no cueste nada: el registro de datos vigilados no
 * cambia dentro de un spec, asi que codificar se paga una vez por centinela y
 * no dieciocho veces por test. Lo que queda por test son unos pocos `includes` mas
 * sobre un volcado que casi siempre esta vacio.
 */
const AGUJAS_POR_CENTINELA = new Map<string, FormaDelDato[]>();

function formasDe(valor: string): FormaDelDato[] {
  const yaCalculadas = AGUJAS_POR_CENTINELA.get(valor);
  if (yaCalculadas !== undefined) return yaCalculadas;

  // EN CLARO PRIMERO, y el orden importa: si el dato salio sin codificar, el
  // informe tiene que decir lo mismo que decia antes y no acusar a una forma.
  const formas: FormaDelDato[] = [{ aguja: valor, comoSeDijo: '' }];
  const yaPuestas = new Set<string>([valor]);

  const agregar = (aguja: string, comoSeDijo: string): void => {
    if (aguja === '' || yaPuestas.has(aguja)) return;
    yaPuestas.add(aguja);
    formas.push({ aguja, comoSeDijo });
  };

  /**
   * LA CAJA DE LAS LETRAS ES UNA FORMA MAS, Y ERA LA MAS BARATA QUE QUEDABA.
   *
   * MEDIDO en la cola de comprobantes de la Fase 14, por el canal MAS vigilado
   * de los dieciocho:
   *
   *     console.info('[comprobantes] revisado', nombreDelArchivo + '|' + nota)
   *       → caen 7 tests de 1809.
   *     console.info('[comprobantes] revisado', (nombreDelArchivo + '|' + nota).toLowerCase())
   *       → pasan los 1809.
   *
   * Lo unico que cambiaba entre caer y no caer era el `.toLowerCase()`. Es el
   * mismo agujero que descubrio el `btoa` —buscar por subcadena del valor
   * CRUDO deja pasar cualquier transformacion— y es la instancia mas barata
   * que quedaba de el: no hay que saber que existe `caches` ni que `btoa`
   * agrupa de tres en tres. Se escribe sola y ADEMAS suena a buena practica
   * —«normalizo el nombre del archivo antes de registrarlo»—, que es
   * exactamente lo que la hacia peligrosa: la escribe de buena fe quien no
   * esta filtrando nada a proposito.
   *
   * Y NO PIERDE NADA POR EL CAMINO: «transferencia-ana-centinela-octubre.pdf»
   * identifica a la misma persona que el original, y un nombre propio en
   * mayusculas igual. Las dos cajas, y no solo la baja, porque un
   * `.toUpperCase()` para un encabezado es la misma linea.
   *
   * Las variantes pasan por la MISMA tuberia que el valor en claro —base64 con
   * sus tres desplazamientos y %-codificacion— porque componer las dos cosas
   * es una linea igual de barata que cada una por separado. Un valor sin
   * letras —un importe, un cuid en minusculas— produce la misma cadena y
   * `agregar` lo descarta solo: no cuesta nada donde no hace falta.
   */
  /**
   * Y LA FORMA LOCALIZADA VA POR LA MISMA TUBERIA, por lo mismo.
   *
   * El razonamiento entero —que regiones, que opciones, el minimo y el digito
   * que se pierde— esta en el docblock de `agujasLocalizadas`. Aqui lo unico
   * que importa es que entra en la MISMA lista que las cajas de letras: se
   * compone con base64 y con el %-codificado porque componer cuesta una linea
   * igual que cada cosa por separado, y porque la composicion es real —la coma
   * de `25.000,1` SI la escapa `encodeURIComponent`, que la deja en `%2C`, asi
   * que un importe formateado metido en el query de una imagen no aparece
   * literal—. Un centinela que no sea un numero no produce ninguna y no paga
   * nada mas que un `test` de expresion regular.
   */
  const enTodasLasFormas: [texto: string, porLaForma: string][] = [
    [valor, ''],
    [valor.toLowerCase(), ' con otra caja de letras'],
    [valor.toUpperCase(), ' con otra caja de letras'],
    ...agujasLocalizadas(valor).map((formateado): [string, string] => [
      formateado,
      ' con el numero formateado',
    ]),
  ];

  for (const [texto, porLaForma] of enTodasLasFormas) {
    // El valor en claro ya esta puesto arriba y no se vuelve a etiquetar: si
    // una variante coincide con el crudo, `agregar` la descarta sola y el
    // informe de la fuga normal sigue diciendo lo que decia.
    const comoFue = texto === valor ? '' : porLaForma;

    agregar(texto, comoFue === '' ? '' : ` (${comoFue.trim()})`);

    for (const aguja of agujasDeBase64(texto)) agregar(aguja, ` (en base64${comoFue})`);

    for (const codificar of [encodeURIComponent, encodeURI]) {
      let codificado: string;

      try {
        codificado = codificar(texto);
      } catch {
        // Un sustituto suelto hace que `encodeURIComponent` lance `URIError`.
        continue;
      }

      agregar(codificado, ` (%-codificado${comoFue})`);

      for (const aguja of agujasDeBase64(codificado)) {
        agregar(aguja, ` (en base64 de su forma %-codificada${comoFue})`);
      }
    }
  }

  AGUJAS_POR_CENTINELA.set(valor, formas);

  return formas;
}

/**
 * EN QUE FORMA lleva un volcado a un centinela, o `undefined` si no lo lleva.
 *
 * Es el unico sitio donde se compara un centinela con un volcado, y por eso es
 * el unico sitio que hay que tocar para que los dieciocho canales aprendan una
 * forma nueva.
 *
 * SE EXPORTA SOLO PARA SU GUARDIAN, `alfabeto-de-centinelas.spec.ts`, por el
 * mismo motivo por el que `relojes-falsos.ts` expone lo suyo: la aritmetica de
 * los desplazamientos es invisible desde fuera —si se rompe, los 71 specs
 * siguen en verde y el tapon se queda ciego sin que nadie se entere—, asi que
 * la unica forma de custodiarla es medirla. Ningun spec de pantalla la llama.
 */
export function formaQueSeFue(texto: string, valor: string): FormaDelDato | undefined {
  return formasDe(valor).find((forma) => texto.includes(forma.aguja));
}

/**
 * Se vigilan TODOS los metodos de `console`, no una lista escrita a mano.
 *
 * Con cinco nombres fijos, un `console.table(respuesta)` el año que viene
 * vuelve a abrir el agujero entero y el tapon seguiria en verde diciendo otra
 * cosa.
 */
function metodosDeConsola(): string[] {
  const consola = console as unknown as Record<string, unknown>;

  return Object.keys(consola).filter(
    (nombre) =>
      typeof consola[nombre] === 'function' &&
      // `Console` es la clase, no una forma de decir algo. Doblarla rompe a
      // quien construya una consola propia y no aporta nada aqui.
      nombre[0] === nombre[0]?.toLowerCase(),
  );
}

/** Todo lo dicho por la consola, serializado, para buscar dentro. */
function comoTexto(dicho: unknown[]): string {
  return dicho
    .map((parte) => {
      try {
        return `${String(parte)} ${JSON.stringify(parte)}`;
      } catch {
        // Referencias circulares, getters que explotan: lo que no se pueda
        // serializar se mira igual por su representacion de texto.
        return String(parte);
      }
    })
    .join(' ');
}

// ---------------------------------------------------------------------------
// El cuarto canal: la cabecera del documento
// ---------------------------------------------------------------------------

/**
 * Los nodos que YA ESTABAN en el `<head>`, para saber cuales aparecieron.
 *
 * Se guardan los nodos y no su cuenta: con la cuenta sola, un nodo que
 * sustituye a otro pasa en verde.
 */
function nodosDeLaCabecera(): Element[] {
  return [...document.head.children];
}

/**
 * Como nombrar un nodo del `<head>` en un informe SIN publicar lo que lleva.
 *
 * Solo la etiqueta. Ni el `content`, ni el `href`, ni el texto: el nodo que
 * este tapon existe para cazar es justamente el que lleva el dato dentro, y un
 * mensaje de fallo que lo copiara lo mandaria al registro de CI, que es el
 * mismo modo de fallo que el espia de la consola documenta y evita.
 */
function etiquetaDe(nodo: Element): string {
  return `<${nodo.tagName.toLowerCase()}>`;
}

// ---------------------------------------------------------------------------
// El quinto canal: los tres almacenes del navegador
// ---------------------------------------------------------------------------

/**
 * `localStorage`, `sessionStorage` y las galletas, que son TRES sitios en disco.
 *
 * Los dos primeros sobreviven al logout y al cambio de persona —`localStorage`
 * hasta que alguien borre los datos del sitio—; las galletas ademas VIAJAN: se
 * adjuntan a cada peticion al mismo dominio y acaban en los registros de acceso
 * del servidor.
 */
type NombreDeAlmacen = 'localStorage' | 'sessionStorage' | 'galletas';

const ALMACENES: readonly NombreDeAlmacen[] = ['localStorage', 'sessionStorage', 'galletas'];

interface EscrituraEnAlmacen {
  almacen: NombreDeAlmacen;
  clave: string;
  valor: string;
}

/** Lo guardado en un `Storage`, ENTERO. Una lista negra va siempre por detras. */
function contenidoDe(almacen: Storage): Record<string, string> {
  const guardado: Record<string, string> = {};

  for (let indice = 0; indice < almacen.length; indice += 1) {
    const clave = almacen.key(indice);
    if (clave !== null) guardado[clave] = almacen.getItem(clave) ?? '';
  }

  return guardado;
}

/** Las galletas del documento, por nombre. */
function galletasDelDocumento(): Record<string, string> {
  const guardadas: Record<string, string> = {};

  for (const trozo of document.cookie.split(';')) {
    const limpio = trozo.trim();
    if (limpio === '') continue;

    const corte = limpio.indexOf('=');
    if (corte === -1) guardadas[limpio] = '';
    else guardadas[limpio.slice(0, corte)] = limpio.slice(corte + 1);
  }

  return guardadas;
}

/** El estado de los tres, en un objeto, para comparar antes y despues. */
function estadoDeLosAlmacenes(): Record<NombreDeAlmacen, Record<string, string>> {
  return {
    localStorage: contenidoDe(localStorage),
    sessionStorage: contenidoDe(sessionStorage),
    galletas: galletasDelDocumento(),
  };
}

/**
 * EL DESCRIPTOR ORIGINAL DE `document.cookie`, cogido UNA VEZ al cargar.
 *
 * Hay que guardarlo antes de doblar nada: si se leyera desde dentro del
 * `beforeEach` despues de haber enganchado una vez, el segundo enganche
 * envolveria al primero y cada escritura se contaria dos veces.
 */
const GALLETAS_ORIGINALES = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');

/** Lo mismo para `setItem`: el de verdad, cogido antes de doblarlo nunca. */
const PONER_EN_UN_ALMACEN = Storage.prototype.setItem;

/**
 * Deja los tres almacenes como estaban al empezar el test.
 *
 * Se llama DESPUES de haber sacado la foto de lo guardado y ANTES de afirmar
 * nada, para que un test que ensucie no arrastre a los que vengan detras.
 */
function restaurarLosAlmacenes(alEmpezar: Record<NombreDeAlmacen, Record<string, string>>): void {
  for (const [almacen, nombre] of [
    [localStorage, 'localStorage'],
    [sessionStorage, 'sessionStorage'],
  ] as const) {
    almacen.clear();

    for (const [clave, valor] of Object.entries(alEmpezar[nombre])) {
      PONER_EN_UN_ALMACEN.call(almacen, clave, valor);
    }
  }

  for (const clave of Object.keys(galletasDelDocumento())) {
    if (clave in alEmpezar.galletas) continue;
    document.cookie = `${clave}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  }
}

// ---------------------------------------------------------------------------
// El sexto canal: el buffer de User Timing
// ---------------------------------------------------------------------------

/**
 * `performance.mark` y `performance.measure`: los dos nombres que pone la pagina.
 *
 * Son el MISMO canal con dos puertas. `measure` crea una entrada con nombre
 * propio igual que `mark` —y acepta ademas un `detail`—, asi que vigilar solo
 * `mark` dejaria la puerta de al lado abierta con la misma linea de codigo.
 */
type TipoDeEntrada = 'mark' | 'measure';

const TIPOS_DE_ENTRADA: readonly TipoDeEntrada[] = ['mark', 'measure'];

/**
 * EL `performance` DE VERDAD Y SU PROTOTIPO, cogidos UNA VEZ al cargar.
 *
 * Dos cosas medidas con una sonda, las dos contraintuitivas:
 *
 * 1. `mark` y `measure` NO son propiedades del objeto `performance` sino de su
 *    prototipo, y ese prototipo NO es `globalThis.Performance.prototype`: en el
 *    entorno de Vitest el `Performance` global es el de Node y el `performance`
 *    global es el de jsdom. Un `vi.spyOn(Performance.prototype, 'mark')` revienta
 *    con «mark does not exist». Hay que sacarlo del objeto.
 *
 * 2. `vi.useFakeTimers()` SIN `toFake` SUSTITUYE EL OBJETO `performance` ENTERO
 *    por el falso de sinon. Guardando el de verdad, leer el buffer y vaciarlo
 *    siguen funcionando aunque un test deje los relojes falsos puestos. Ver el
 *    punto ciego documentado en `vigilarLosCanalesDeSalida`.
 */
const EL_CRONOMETRO = performance;
const PROTOTIPO_DEL_CRONOMETRO = Object.getPrototypeOf(performance) as Performance;
const MARCAR = PROTOTIPO_DEL_CRONOMETRO.mark;
const MEDIR = PROTOTIPO_DEL_CRONOMETRO.measure;

/** Una entrada de User Timing vista por el espia: el nombre y el `detail`. */
interface EntradaDeTiempo {
  tipo: TipoDeEntrada;
  nombre: string;
  detalle: unknown;
}

/**
 * El `detail` de una entrada, que es la SEGUNDA mitad del canal.
 *
 * `performance.mark(nombre, { detail })` guarda el `detail` en la entrada, y
 * `entrada.toJSON()` lo devuelve: sale entero en cualquier volcado de
 * rendimiento. Medido con una sonda en jsdom 26 —`{"secreto":"..."}` dentro del
 * `toJSON()`—, asi que no basta con mirar el nombre. El getter deserializa, y
 * si explota se mira la entrada igualmente por su nombre.
 */
function detalleDe(entrada: PerformanceEntry): unknown {
  try {
    return (entrada as { detail?: unknown }).detail;
  } catch {
    return undefined;
  }
}

/** Lo que haya en el buffer de verdad, aunque alguien haya cambiado `performance`. */
function entradasDelBuffer(tipo: TipoDeEntrada): EntradaDeTiempo[] {
  return EL_CRONOMETRO.getEntriesByType(tipo).map((entrada) => ({
    tipo,
    nombre: entrada.name,
    detalle: detalleDe(entrada),
  }));
}

/** El `detail` que lleva el segundo argumento de `mark` o de `measure`, si lo lleva. */
function detalleDeLasOpciones(opciones: unknown): unknown {
  if (typeof opciones !== 'object' || opciones === null) return undefined;
  return (opciones as { detail?: unknown }).detail;
}

/** Nombres y detalles de un tipo, serializados, para buscar centinelas dentro. */
function comoTextoLasEntradas(entradas: EntradaDeTiempo[], tipo: TipoDeEntrada): string {
  return entradas
    .filter((entrada) => entrada.tipo === tipo)
    .map((entrada) => `${entrada.nombre} ${comoTexto([entrada.detalle])}`)
    .join(' ');
}

// ---------------------------------------------------------------------------
// El septimo canal: las imagenes que la pagina pide por su cuenta
// ---------------------------------------------------------------------------

/**
 * `new Image().src = '…'`: UNA PETICION DE RED QUE NO PASA POR `fetch`.
 *
 * El canal es el `src` de una imagen, y lo que lo hace peligroso es que las
 * seis puertas de arriba y las listas blancas de peticiones lo dejan pasar
 * ENTERO. Una imagen creada con `new Image()` nunca se adjunta al documento:
 * no esta en el `<body>` —ni `screen.*`, ni `document.body.innerHTML`, ni los
 * `querySelectorAll` la ven—, no esta en el `<head>`, no dice nada por la
 * consola, no toca el titulo ni el nombre de la pestaña ni ninguno de los tres
 * almacenes, no deja marca de rendimiento, no entra en ninguna de las dos
 * caches y NO ES UN `fetch`, asi que el DECIMOCUARTO canal —el que dobla el
 * `fetch` global— no lo ve. (Cuando se escribio esto ese canal no existia como
 * tal: era un test a mano que vivia en tres specs de setenta y cuatro, asi que
 * la frase «pasa en verde» era cierta en los otros setenta y uno sin que nadie
 * hiciera nada. Ver el docblock de `PuertaDeRed`.)
 *
 * Y sale igual. El navegador pide esa URL de verdad, CON LA COOKIE de sesion
 * si el destino la comparte, y la URL entera —con lo que lleve en el query—
 * queda en el registro de acceso del servidor del otro lado, en la pestaña de
 * red y en los breadcrumbs de cualquier SDK de errores que se enchufe mañana.
 * Medido en esta fase: un `pixel.src = \`…/uso.gif?d=${JSON.stringify(datos)}\``
 * en un `useEffect` de la pantalla de Analisis —con el reporte entero dentro—
 * paso los 1326 tests del paquete y el `tsc`.
 *
 * Y PASA UNA REVISION SIN HACER RUIDO: parece una precarga, o una metrica de
 * uso. Es la misma forma de las seis anteriores —agregar algo que no deberia
 * estar, sin quitar nada, donde nadie estaba mirando—.
 *
 * SE AFIRMA SOBRE CENTINELAS Y NO SOBRE «NINGUNA IMAGEN», que es la diferencia
 * con `window.name`. Pedir imagenes es legitimo y este repo ya lo hace: la
 * portada de un gimnasio pinta su logo con un `<img>` de URL externa y
 * arbitraria (`src/app/[slug]/page.tsx`). Un canal que prohiba las imagenes se
 * desactiva el dia que alguien necesite una. Lo que no es legitimo es meter un
 * dato del mostrador en la URL.
 */
const SRC_DE_UNA_IMAGEN = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');

// ---------------------------------------------------------------------------
// El octavo canal: las salidas laterales
// ---------------------------------------------------------------------------

/**
 * TRES PUERTAS QUE NO SON `fetch` NI EL DOM: mensajes, difusion y baliza.
 *
 * El septimo canal cubrio la peticion de red que no pasa por `fetch`. Este
 * cubre las que NI SIQUIERA SON UNA PETICION, o lo son por un camino que el
 * `fetch` doblado no toca:
 *
 * - `window.postMessage(datos, '*')`. No es red, no es DOM, no es almacen: es
 *   un evento `message` en esta misma ventana. Lo recibe CUALQUIER script que
 *   comparta la pagina —una etiqueta de analitica, un chat embebido, el
 *   content script de cualquier extension del navegador del mostrador— con
 *   una linea de `addEventListener('message', …)`. Y la forma de al lado,
 *   `parent.postMessage(datos, '*')`, se la lleva el documento que nos enmarca
 *   AUNQUE SEA DE OTRO ORIGEN, que es justamente lo que el segundo argumento
 *   existe para impedir y lo que `'*'` renuncia a impedir. En este entorno las
 *   dos caen por el mismo sitio: MEDIDO, `window.parent`, `window.top` y
 *   `window.self` son el MISMO objeto que `window`, asi que doblar una puerta
 *   cubre las tres escrituras.
 *
 * - `new BroadcastChannel(nombre).postMessage(datos)`. Lo recibe cualquier
 *   OTRA PESTAÑA del mismo origen, que en la maquina del mostrador es la
 *   pestaña que dejo abierta la persona del turno anterior. No hay peticion,
 *   no hay rastro en la pestaña de red y no sobrevive a ninguna revision
 *   porque parece sincronizacion entre pestañas, que es para lo que existe.
 *
 * - `navigator.sendBeacon(url, cuerpo)`. SI es una peticion de red, y es la
 *   peor de las tres: el navegador la manda aunque la pestaña se este
 *   cerrando —ese es su proposito—, no pasa por `fetch`, no se puede cancelar
 *   y no devuelve nada que mirar. El DECIMOCUARTO canal, que dobla el `fetch`
 *   global y las otras tres puertas de red, la deja pasar entera: por eso vive
 *   aqui y no alli.
 *
 * SE AFIRMA POR CENTINELAS, no por «ninguna llamada», igual que el canal de
 * imagenes y por el mismo motivo: comunicarse es legitimo —sincronizar dos
 * pestañas del panel con un `BroadcastChannel` seria una buena idea el dia que
 * haga falta— y un canal que lo prohiba se desactiva el dia que alguien lo
 * necesite. Lo que no es legitimo es que el mensaje lleve un dato del
 * mostrador dentro.
 *
 * Y SE MIRA EL OBJETO ENTERO, serializado, no las cadenas de primer nivel: la
 * mutacion que abrio este canal mandaba `{ tipo: 'analisis:caja-lista', caja }`
 * con el reporte entero anidado en la segunda clave. Es lo mismo que hace el
 * canal del `detail` de `performance.mark`, y por eso reusa `comoTexto`.
 */

/**
 * `postMessage` ES UN ACCESOR DE `window`, Y NO ESTA EN NINGUN PROTOTIPO.
 *
 * La misma trampa que `performance`, en otra forma, y tambien MEDIDA en vez de
 * leida. Dos cosas que no se adivinan:
 *
 * 1. `Object.getPrototypeOf(window)` NO es `Window.prototype` en este entorno
 *    —es un `Object` pelado, porque Vitest monta el global de jsdom a mano—, y
 *    `postMessage` no esta en el prototipo sino como propiedad PROPIA de
 *    `window`. Un `vi.spyOn(Window.prototype, 'postMessage')` no existe y un
 *    `Object.getPrototypeOf(window)` no lleva a ninguna parte: hay que cogerlo
 *    del objeto.
 *
 * 2. Esa propiedad propia es un ACCESOR (`get`/`set`), no un metodo: su
 *    descriptor trae `get` y `set` y no trae `value`. Por eso se engancha
 *    redefiniendola —como las galletas y el `src` de una imagen— y no con un
 *    `vi.spyOn`, y por eso la funcion de verdad se lee UNA VEZ al cargar, por
 *    el getter, antes de redefinir nada: leerla desde dentro del `beforeEach`
 *    despues del primer enganche envolveria el envoltorio de ayer y contaria
 *    cada mensaje dos veces.
 */
const MANDAR_UN_MENSAJE = window.postMessage;

/**
 * EL PROTOTIPO DEL CANAL DE DIFUSION, sacado de UNA INSTANCIA y no de la clase.
 *
 * Por la leccion de `performance`: el global de una API y su clase pueden ser
 * dos cosas distintas. Aqui MEDIDO resultan ser la misma
 * —`Object.getPrototypeOf(new BroadcastChannel(…)) === BroadcastChannel.prototype`—,
 * pero se saca igual del objeto, que es lo que no depende de que siga siendo
 * cierto. El canal de la sonda se cierra en el acto: no escucha nada.
 */
const PROTOTIPO_DEL_CANAL = (() => {
  const sonda = new BroadcastChannel('espia-de-consola:sonda');
  const prototipo = Object.getPrototypeOf(sonda) as BroadcastChannel;
  sonda.close();
  return prototipo;
})();

const DIFUNDIR = PROTOTIPO_DEL_CANAL.postMessage;

/**
 * `navigator.sendBeacon` NO EXISTE EN JSDOM, y por eso hay que PONERLO.
 *
 * Medido: `typeof navigator.sendBeacon` es `'undefined'` y no hay descriptor
 * en `Navigator.prototype`. Eso NO es cobertura, aunque lo parezca. Es verdad
 * que `navigator.sendBeacon(url, cuerpo)` a pelo revienta con un `TypeError` y
 * el test cae solo; pero la forma que escribe cualquiera que programe con
 * cuidado —`navigator.sendBeacon?.(url, cuerpo)`, o detras de un
 * `if ('sendBeacon' in navigator)`— no revienta: NO HACE NADA y pasa en verde,
 * mientras en el navegador del mostrador manda la peticion. El agujero se
 * cierra justo en la forma del codigo que mas probable es encontrar.
 *
 * Asi que el espia la DEFINE. El precio, dicho entero: a partir de aqui la
 * deteccion de capacidades ve una baliza que jsdom no tiene, y una pantalla
 * que pregunte `'sendBeacon' in navigator` tomara el camino de la baliza en
 * los tests. Hoy no lo pregunta nadie —no hay un solo `sendBeacon` en
 * `src/`—, y el cambio acerca el entorno al navegador de verdad en lugar de
 * alejarlo, que es la direccion correcta para una infraestructura de tests.
 *
 * Y es la UNICA puerta del espia que no «registra y deja pasar»: no hay nada
 * por debajo a lo que reenviar. Devuelve `true`, que es lo que devuelve un
 * navegador cuando acepta encolar la baliza.
 */
const PROTOTIPO_DEL_NAVEGANTE = Object.getPrototypeOf(navigator) as Navigator;

/**
 * El cuerpo de una baliza, en texto, para buscar centinelas dentro.
 *
 * `sendBeacon` acepta cualquier `BodyInit`, y el dato se puede ir por
 * cualquiera de esas formas. Un `JSON.stringify` del objeto no sirve: un
 * `URLSearchParams` serializa a `{}` y un `FormData` tambien.
 */
/**
 * SI ALGO ES UN `ArrayBuffer`, SIN PREGUNTARLE DE QUE REALM VIENE.
 *
 * `cuerpo instanceof ArrayBuffer` NO BASTA EN ESTE ENTORNO, y eso no se
 * dedujo: se midio con una sonda, y lo descubrio el guardian del decimosexto
 * canal al pedirle a `cuerpoDeUnaBaliza` que leyera un buffer crudo.
 *
 *     const crudo = new TextEncoder().encode('hola').buffer;
 *     crudo.constructor.name        → 'ArrayBuffer'
 *     Object.prototype.toString(…)  → '[object ArrayBuffer]'
 *     crudo instanceof ArrayBuffer  → FALSE
 *     crudo.constructor === ArrayBuffer → FALSE
 *     new ArrayBuffer(4) instanceof ArrayBuffer → true
 *
 * O sea: EL `ArrayBuffer` GLOBAL DE UN SPEC Y EL DEL `TextEncoder` DE NODE SON
 * DOS CLASES DISTINTAS. Es exactamente la leccion que este archivo ya se
 * llevo con `performance` y su `Performance` y con `window.postMessage` y su
 * `Window`, en otra forma: el global de una API y la clase que la fabrica
 * pueden no ser la misma cosa dentro de Vitest.
 *
 * Y LA CONSECUENCIA ERA UNA RAMA MUERTA. Un cuerpo que llegara como buffer
 * CRUDO —lo que devuelven `blob.arrayBuffer()`, `response.arrayBuffer()` y
 * `encoder.encode(x).buffer`— se caia al `comoTexto` del final y se
 * serializaba a `'[object ArrayBuffer] {}'`: el centinela invisible, y no en
 * un canal sino en los TRES que usan este desmenuzador —la baliza, el cuerpo
 * de un `fetch` y el de un `XMLHttpRequest`—. Las VISTAS (`Uint8Array` y
 * compañia) no estaban afectadas, porque `ArrayBuffer.isView` es una
 * comprobacion de marca y funciona entre realms; el buffer pelado no tiene
 * ninguna funcion asi en la plataforma.
 *
 * SE PREGUNTA POR LA ETIQUETA Y NO POR LA CLASE, que es la unica forma que no
 * depende del realm: `Symbol.toStringTag` de un `ArrayBuffer` es
 * `'ArrayBuffer'` por especificacion, venga de donde venga. Se deja delante el
 * `instanceof`, que es lo barato y acierta en el caso normal.
 *
 * (`TextDecoder().decode` SI acepta un buffer de otro realm — medido: devuelve
 * el texto entero. O sea que lo unico roto era la pregunta, no la lectura.)
 */
function esUnArrayBuffer(cosa: unknown): boolean {
  if (cosa instanceof ArrayBuffer) return true;

  const etiqueta = Object.prototype.toString.call(cosa);

  return etiqueta === '[object ArrayBuffer]' || etiqueta === '[object SharedArrayBuffer]';
}

function cuerpoDeUnaBaliza(cuerpo: unknown): string {
  if (cuerpo === undefined || cuerpo === null) return '';
  if (typeof cuerpo === 'string') return cuerpo;
  if (cuerpo instanceof URLSearchParams) return cuerpo.toString();

  if (cuerpo instanceof FormData) {
    return [...cuerpo.entries()].map(([clave, valor]) => `${clave}=${String(valor)}`).join('&');
  }

  if (esUnArrayBuffer(cuerpo) || ArrayBuffer.isView(cuerpo)) {
    try {
      return new TextDecoder().decode(cuerpo as ArrayBuffer);
    } catch {
      return '';
    }
  }

  if (cuerpo instanceof Blob) return textoDeUnBlob(cuerpo);

  return comoTexto([cuerpo]);
}

/**
 * LOS BYTES DE UN `Blob`, LEIDOS POR DENTRO, porque no hay forma sincrona.
 *
 * La plataforma solo ofrece `text()` y `arrayBuffer()`, que devuelven
 * promesas, y `sendBeacon` devuelve un booleano: o se lee aqui mismo o un
 * cuerpo de tipo `Blob` —que es la forma que recomienda la documentacion de
 * `sendBeacon` para mandar JSON con su `Content-Type`— no se mira nunca.
 *
 * MEDIDO en jsdom 26: el `Blob` tiene UNA sola clave propia, un simbolo, y
 * detras hay un objeto de implementacion con `_buffer` —el `Buffer` de Node
 * con el contenido—. Se busca por simbolo y no por nombre porque el nombre del
 * simbolo es interno de jsdom; si algun dia deja de estar, esto devuelve
 * cadena vacia y el canal pierde SOLO la forma `Blob`, sin romper nada.
 */
function textoDeUnBlob(blob: Blob): string {
  for (const simbolo of Object.getOwnPropertySymbols(blob)) {
    const implementacion = (blob as unknown as Record<symbol, unknown>)[simbolo];
    if (typeof implementacion !== 'object' || implementacion === null) continue;

    const bytes = (implementacion as { _buffer?: unknown })._buffer;
    if (bytes !== undefined && bytes !== null) return String(bytes);
  }

  return '';
}

// ---------------------------------------------------------------------------
// El noveno canal: el almacen de respuestas del navegador (CacheStorage)
// ---------------------------------------------------------------------------

/**
 * `caches` NO EXISTE EN JSDOM, y por eso hay que PONERLO.
 *
 * Medido con una sonda: `typeof globalThis.caches` es `'undefined'` en jsdom
 * 26. Igual que con `sendBeacon`, eso NO es cobertura aunque lo parezca. Un
 * `caches.open(...)` a pelo revienta con un `TypeError` y el test cae solo;
 * pero la forma que escribe cualquiera que programe con cuidado
 * —`globalThis.caches?.open(...)`, o detras de un `if ('caches' in window)`—
 * NO HACE NADA y pasa en verde, mientras en el navegador del mostrador
 * escribe en disco.
 *
 * POR QUE ESTE CANAL Y NO OTRO: ESTE REPO YA TIENE LA REGLA ESCRITA, Y DEL
 * OTRO LADO. `src/app/sw.ts` va a propagar que el panel del admin no entra
 * nunca en la cache, con el motivo entero: «un listado de gente con nombres,
 * emails y telefonos quedaria en la CacheStorage del navegador del mostrador,
 * que es una computadora compartida, legible por quien se siente despues». El
 * service worker lo cumple con una LISTA BLANCA de dos rutas del alumno.
 *
 * Lo que nadie miraba es que **una pantalla puede escribir en la CacheStorage
 * por su cuenta**, sin pasar por el service worker ni por su lista blanca: son
 * dos puertas al mismo almacen y la politica solo custodiaba una. Un
 * `caches.open('lo-mio').then((c) => c.put(ruta, new Response(datos)))` dentro
 * de un `useEffect` —la forma de «que al volver atras salga instantanea»—
 * guarda los nombres de los alumnos en el disco de una maquina compartida, y
 * ahi se quedan: la CacheStorage sobrevive al cierre de sesion, al cierre de
 * la pestaña y al reinicio, y se lee desde las herramientas del navegador sin
 * ninguna contraseña. Medido: esa mutacion paso los 1375 tests del paquete.
 *
 * ES UN CUARTO ALMACEN, y se afirma como los otros tres: por CENTINELAS y
 * ademas por «no se guardo NADA». Lo segundo no es exagerado aqui, es
 * exactamente la politica que ya existe: ninguna pantalla del panel tiene nada
 * que hacer escribiendo en este almacen, y el unico que si lo usa —el service
 * worker— no es una pantalla y no corre en estos tests.
 *
 * LO QUE ESTE TAPON NO MIRA, dicho sin adornar: EL CUERPO de la respuesta
 * guardada. `Response.text()` es asincrono y `put()` se registra en el acto,
 * asi que leerlo aqui obligaria a volver asincrono el `afterEach` entero —que
 * tiene un orden delicado con `cleanup()`— a cambio de poco: mientras la
 * afirmacion sea «no se guardo nada», el cuerpo nunca llega a existir. El dia
 * que alguien necesite una excepcion para guardar algo legitimo, esa excepcion
 * tendra que traerse el cuerpo consigo.
 *
 * El precio, dicho entero: a partir de aqui la deteccion de capacidades ve un
 * almacen que jsdom no tiene, y una pantalla que pregunte `'caches' in window`
 * tomara ese camino en los tests. Hoy no lo pregunta nadie —no hay un solo
 * `caches` en `src/` fuera de esto—, y el cambio acerca el entorno al
 * navegador de verdad en lugar de alejarlo.
 */
const CACHES_ORIGINAL = Object.getOwnPropertyDescriptor(globalThis, 'caches');

/** Bajo que nombre se guardo una respuesta: la clave de la entrada. */
function claveDeUnaPeticion(peticion: unknown): string {
  if (typeof peticion === 'string') return peticion;
  if (peticion instanceof URL) return peticion.href;

  if (typeof peticion === 'object' && peticion !== null && 'url' in peticion) {
    return String((peticion as { url: unknown }).url);
  }

  return String(peticion);
}

/** Una entrada escrita en el almacen de respuestas. */
interface RespuestaGuardada {
  almacen: string;
  clave: string;
}

// ---------------------------------------------------------------------------
// El decimo canal: el service worker, que SI existe en este producto
// ---------------------------------------------------------------------------

/**
 * `navigator.serviceWorker` NO EXISTE EN JSDOM, y por eso hay que PONERLO.
 *
 * Medido con una sonda: `typeof navigator.serviceWorker` es `'undefined'` en
 * jsdom 26 y no hay descriptor en `Navigator.prototype`. Igual que con la
 * baliza y que con `caches`, eso NO es cobertura aunque lo parezca. Un
 * `navigator.serviceWorker.controller.postMessage(datos)` a pelo revienta con
 * un `TypeError` y el test cae solo; la forma que escribe cualquiera que
 * programe con cuidado —`navigator.serviceWorker?.controller?.postMessage(…)`,
 * o detras de un `if ('serviceWorker' in navigator)`— NO HACE NADA y pasa en
 * verde, mientras en el navegador del mostrador entrega el dato.
 *
 * POR QUE ES UN CANAL DISTINTO DE LOS DOS `postMessage` QUE YA SE VIGILAN, y
 * no una tercera forma del mismo. Los otros dos se doblan por donde viven:
 * `window.postMessage` como propiedad propia de `window`, y el de difusion en
 * `BroadcastChannel.prototype`. El de un `ServiceWorker` vive en
 * `ServiceWorker.prototype`, que es una tercera funcion y en jsdom NI SIQUIERA
 * EXISTE: los dos taponazos de arriba pueden estar puestos y este mensaje
 * pasar entero por el medio. Se midio: un `postMessage` al controlador con el
 * nombre de un alumno y el `tenantId` dentro paso los 1421 tests del paquete
 * con los nueve canales enchufados.
 *
 * Y POR QUE IMPORTA EN ESTE PRODUCTO Y NO EN ABSTRACTO: AQUI HAY UN SERVICE
 * WORKER DE VERDAD. `src/app/sw.ts` existe, `next.config` lo monta con
 * `@serwist/next` y `componentes/boton-de-push.tsx` ya habla con el. O sea que
 * `navigator.serviceWorker.controller` NO es `null` en el mostrador: es un hilo
 * que sobrevive al cierre de la pestaña, corre con el origen del panel y puede
 * hacer `fetch` y `caches.put` con lo que reciba. Mandarle un dato es sacarlo
 * del alcance de los otros nueve tapones de un salto: el `caches` que se
 * vigila es el que abre LA PAGINA, y el que abriria el worker con este mensaje
 * no lo ve nadie. Es la misma asimetria que el noveno canal cerro por el otro
 * lado —la pagina escribiendo en el almacen del worker— vista desde aqui.
 *
 * El precio, dicho entero: a partir de aqui la deteccion de capacidades ve un
 * `serviceWorker` que jsdom no tiene. Se midio a quien le cambia algo y la
 * respuesta es a nadie: el unico sitio de `src/` que lo pregunta es
 * `elNavegadorPuede()` en `boton-de-push.tsx`, y pide ADEMAS `Notification` y
 * `PushManager`, que siguen sin existir. Y `boton-de-push.spec.tsx` instala el
 * suyo con `Object.defineProperty` en su propio `beforeEach`, que corre
 * DESPUES de este: el del spec gana, como tiene que ser.
 */
const SERVICE_WORKER_ORIGINAL = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');

/**
 * EL PORTAPAPELES NO SE VIGILA, Y ESTA ESCRITO AQUI PARA QUE NO SE REABRA.
 *
 * Es el cuarto vecino de esta familia y el unico que se queda fuera. No por
 * pereza: por dos medidas y una asimetria, en ese orden.
 *
 * 1. NO SE PUEDE VER DESDE AQUI. `navigator.clipboard` no existe en jsdom
 *    —medido—, asi que el unico portapapeles que hay en un test es el que
 *    instala un spec. Y los tres specs que lo ejercitan
 *    (`usuarios/nuevo/clave-temporal`, `usuarios/nuevo/page`, `invitaciones/page`)
 *    lo instalan con `Object.defineProperty(navigator, 'clipboard', …)`
 *    —propiedad PROPIA de `navigator`— DENTRO del cuerpo del test, o sea
 *    DESPUES de cualquier `beforeEach`. Medido con una sonda que hacia
 *    exactamente eso: el doble del tapon registro CERO escrituras y el del
 *    spec se llevo la llamada. Un espia global del portapapeles estaria ciego
 *    en los tres unicos sitios donde el portapapeles se usa, y «funcionando»
 *    en los cincuenta y siete donde no se puede usar. Verde y ciego es
 *    exactamente el modo de fallo que el resto de este archivo existe para
 *    evitar.
 *
 * 2. Y NO SE PUEDE AFIRMAR POR CENTINELAS. El panel copia secretos A
 *    PROPOSITO, y no en un sitio sino en DOS: `clave-temporal.tsx` copia la
 *    contraseña temporal del alta (`claveDelAlta`) e `invitaciones/page.tsx`
 *    copia el codigo de invitacion (`codigoDeInvitacion`). Los dos son
 *    centinelas registrados. «Ningun centinela sale por el portapapeles» seria
 *    rojo con el codigo correcto en las dos pantallas.
 *
 * SE MIRO EL CRITERIO QUE LOS DISTINGUIRIA, y existe: una copia deliberada
 * ocurre mientras se despacha un gesto de la persona y una copia accidental no.
 * Es medible —`window.event` esta presente durante un `dispatchEvent` y es
 * `undefined` fuera de el, medido con una sonda; `navigator.userActivation`, que
 * seria lo correcto, no existe en jsdom—. No se usa igualmente por dos cosas:
 * no arregla el punto 1, que es el que decide; y convierte el canal en una
 * regla sobre COMO se escribe una copia legitima, no sobre si se filtra algo.
 * Un boton de copiar que hiciera `await` de cualquier cosa antes del
 * `writeText` —formatear, pedir el dato— se pondria rojo con el codigo
 * correcto. Un canal que obliga a escribir el codigo bueno de una forma
 * concreta es el que alguien desactiva.
 *
 * LO QUE CUBRE EL HUECO MIENTRAS TANTO, dicho sin adornar. En los cincuenta y
 * siete specs que no instalan un doble, `navigator.clipboard` es `undefined` y
 * un `navigator.clipboard.writeText(dato)` revienta con un `TypeError`
 * —medido—, asi que el test cae. Y en los dos sitios que SI copian, el spec de
 * cada pantalla ya afirma que no se copia sola: «no se copia nada hasta que
 * alguien lo pide» en `clave-temporal.spec.tsx` y «no se copia solo al
 * portapapeles: copiar es una accion que se pide» en `invitaciones/page.spec.tsx`.
 *
 * EL AGUJERO QUE QUEDA, para que nadie lo descubra creyendo que esto lo tapaba:
 * un `await navigator.clipboard?.writeText(dato)` dentro de un `try/catch`, en
 * una pantalla que no instale doble, no revienta —se traga el `TypeError`— y
 * pasa en verde. Eso se tapa el dia que `navigator.clipboard` se monte UNA vez
 * para todo el paquete, desde aqui, en lugar de spec a spec; mientras los
 * specs se lo pisen a mano, este canal no se puede vigilar sin una excepcion
 * que lo vacie, y una excepcion que lo vacie es peor que no tenerlo.
 */

// ---------------------------------------------------------------------------
// El undecimo canal: IndexedDB, EL QUINTO ALMACEN
// ---------------------------------------------------------------------------

/**
 * `indexedDB` NO EXISTE EN JSDOM, y por eso hay que PONERLO.
 *
 * Medido con una sonda en jsdom 26: `typeof globalThis.indexedDB` es
 * `'undefined'`, `'indexedDB' in window` es `false`, no hay descriptor ni en
 * `window` ni en `globalThis`, y NINGUNA de las doce clases de la familia
 * —`IDBFactory`, `IDBDatabase`, `IDBObjectStore`, `IDBTransaction`,
 * `IDBRequest`, `IDBOpenDBRequest`, `IDBCursor`, `IDBCursorWithValue`,
 * `IDBIndex`, `IDBKeyRange`, `IDBVersionChangeEvent`— existe tampoco. Es la
 * misma situacion que `sendBeacon`, que `caches` y que `serviceWorker`, y la
 * misma leccion que ya dejo cuatro fugas: UNA API QUE JSDOM NO IMPLEMENTA ES
 * UN SITIO DONDE NADIE MIRA POR CONSTRUCCION. Un `indexedDB.open(...)` a pelo
 * revienta con un `ReferenceError` y el test cae solo; pero la forma que
 * escribe cualquiera que programe con cuidado —`globalThis.indexedDB?.open(…)`,
 * o detras de un `if ('indexedDB' in window)`— NO HACE NADA y pasa en verde,
 * mientras en el navegador del mostrador escribe en disco.
 *
 * (Y se define sobre `globalThis`, como `caches`: MEDIDO, en este entorno
 * `window === globalThis`, asi que el `window.indexedDB` de una pantalla y el
 * `globalThis.indexedDB` de un modulo son la misma propiedad.)
 *
 * POR QUE ES UN ALMACEN DISTINTO Y NO UNA FORMA MAS DE LOS QUE YA SE VIGILAN.
 * El tapon de «los tres almacenes» es una LISTA CERRADA —`localStorage`,
 * `sessionStorage` y las galletas— y `CacheStorage` se agrego en su dia por ser
 * un CUARTO almacen. IndexedDB es el QUINTO, y es PEOR que los tres primeros en
 * las tres cosas que importan:
 *
 *  - SOBREVIVE IGUAL. Al logout, al cierre de la pestaña y al reinicio, como
 *    `localStorage`, y se lee desde las herramientas del navegador sin ninguna
 *    contraseña, en una maquina que usan cuatro personas por turno.
 *  - NO TIENE TOPE DE 5 MB. Donde `localStorage` obliga a elegir que guardar,
 *    aqui cabe el listado entero.
 *  - GUARDA OBJETOS ESTRUCTURADOS. `setItem` obliga a serializar —o sea, a
 *    PENSAR que se esta guardando—; `put(variables)` mete el objeto entero sin
 *    que nadie tenga que acordarse de nada.
 *
 * LA MUTACION QUE LO DESCUBRIO, medida: tres lineas en `useGuardarSmtp` que
 * parecen una cortesia —«un borrador del formulario, por si alguien recarga a
 * medio configurar»— guardaban `variables` enteras en `boxadmin-config` /
 * `borradores` bajo la clave `smtp`: host, usuario y LA CLAVE DEL SERVIDOR DE
 * CORREO EN CLARO. Sobrevivio los 1481 tests del paquete con los diez canales
 * enchufados. Y es el unico sitio del panel por el que pasa una credencial de
 * servidor: `ConfiguracionSmtpPublica` no la devuelve ni enmascarada, asi que
 * ese disco es el unico lugar del mundo, fuera del cifrado de la API, donde
 * esa cadena queda escrita.
 *
 * SE AFIRMA POR LA FORMA FUERTE —«no se abrio NINGUNA base»— Y NO POR
 * CENTINELAS, que es la decision de este canal y esta MEDIDA, no leida:
 *
 *  1. No hay un solo `indexedDB`, `IDB*` ni `idb` en `apps/web/src`. Medido con
 *     `grep -rniE "indexeddb|IDBDatabase|IDBObjectStore|IDBCursor|idb"`: cero
 *     coincidencias. El producto no tiene NINGUN uso legitimo de esta puerta.
 *  2. La duda real era el arbol de dependencias, porque las librerias de
 *     service worker suelen usar IndexedDB para su propio estado — y aqui
 *     `serwist` lo hace: `node_modules/serwist/dist/index.mjs` importa
 *     `openDB` de `idb` y lo usa en la expiracion de caches. Pero eso NO corre
 *     en estos tests, y tambien esta medido: el unico spec que toca el worker
 *     —`src/app/sw.spec.ts`— sustituye `serwist` y `@serwist/next/worker`
 *     ENTEROS con `vi.mock`, asi que el modulo de verdad no se carga nunca. La
 *     comprobacion que decide no es esa lectura sino la del paquete completo:
 *     con este tapon puesto y la afirmacion fuerte, los 65 specs siguen en
 *     verde, o sea que NADIE del arbol abre una base durante un test.
 *
 * Es el mismo criterio que separa `window.name` —forma fuerte, porque el
 * producto no tiene ningun uso legitimo de esa puerta— del `src` de una
 * imagen, de las salidas laterales, de `CacheStorage` y del service worker
 * —centinelas, porque pintar un logo, sincronizar pestañas, medir latencia o
 * hablarle al worker SI son legitimos y un canal que los prohiba es de los que
 * alguien desactiva el dia que los necesita—. Aqui no hay nada que desactivar:
 * ninguna pantalla del panel tiene nada que hacer abriendo una base. Y la
 * forma fuerte caza ademas EL DATO QUE NADIE REGISTRO, que es justamente el
 * caso de un `put(variables)` que se lleva el objeto entero.
 *
 * Se afirman IGUALMENTE los centinelas, y antes que la forma fuerte, para que
 * el informe diga QUE dato se fue cuando se fue uno conocido: un
 * «una escritura en IndexedDB lleva claveDelReset» dice mas que un
 * «la pantalla escribio en IndexedDB».
 *
 * EL PRECIO, DICHO ENTERO: a partir de aqui la deteccion de capacidades ve una
 * base de datos que jsdom no tiene, y una pantalla que pregunte
 * `'indexedDB' in window` tomara ese camino en los tests. Hoy no lo pregunta
 * nadie —punto 1 de arriba—, y el cambio acerca el entorno al navegador de
 * verdad en lugar de alejarlo, que es la direccion correcta para una
 * infraestructura de tests.
 *
 * LO QUE ESTE TAPON NO MONTA, para que nadie lo descubra creyendo que lo
 * cubria: las doce CLASES de la familia siguen sin existir. Un
 * `IDBKeyRange.only(dato)` revienta con un `ReferenceError` y el test cae
 * —que es el comportamiento bueno—, y la forma prudente `globalThis.IDBKeyRange?.only(…)`
 * devuelve `undefined`, que es un rango vacio aceptable para los cursores de
 * mentira de abajo. Montarlas seria simular una base de datos; esto no esta
 * para eso, esta para que una escritura hacia ella no sea invisible.
 */
const INDEXED_DB_ORIGINAL = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');

/** Una escritura que paso por IndexedDB, con la PUERTA por la que entro. */
interface EscrituraEnLaBase {
  /** `put`, `add` o `cursor.update`: por cual de las tres entro. */
  puerta: string;
  base: string;
  almacen: string;
  /** La clave, en texto. Un `put(1, claveSecreta)` esconde el dato AQUI. */
  clave: string;
  /** El valor TAL CUAL, que puede ser un objeto anidado. Se serializa al mirar. */
  valor: unknown;
}

/** Un registro guardado en el almacen de mentira, para que los cursores tengan que recorrer. */
interface RegistroDeLaBase {
  clave: unknown;
  valor: unknown;
}

/**
 * Los oyentes de `addEventListener` de cada objeto de mentira, por fuera.
 *
 * En un `WeakMap` y no como propiedad del objeto para que la lista no aparezca
 * al serializar nada ni al recorrer las claves de un cursor.
 */
const OYENTES_DE_LA_BASE = new WeakMap<object, Map<string, ((evento: unknown) => void)[]>>();

function oyentesDe(objetivo: object): Map<string, ((evento: unknown) => void)[]> {
  let mapa = OYENTES_DE_LA_BASE.get(objetivo);

  if (mapa === undefined) {
    mapa = new Map();
    OYENTES_DE_LA_BASE.set(objetivo, mapa);
  }

  return mapa;
}

/** Le pone `addEventListener`/`removeEventListener` a un objeto de mentira. */
function conOyentes(cuerpo: Record<string, unknown>): Record<string, unknown> {
  cuerpo.addEventListener = (tipo: unknown, oyente: unknown) => {
    if (typeof oyente !== 'function') return;
    const mapa = oyentesDe(cuerpo);
    mapa.set(String(tipo), [
      ...(mapa.get(String(tipo)) ?? []),
      oyente as (evento: unknown) => void,
    ]);
  };

  cuerpo.removeEventListener = (tipo: unknown, oyente: unknown) => {
    const mapa = oyentesDe(cuerpo);
    mapa.set(
      String(tipo),
      (mapa.get(String(tipo)) ?? []).filter((otro) => otro !== oyente),
    );
  };

  cuerpo.dispatchEvent = () => true;

  return cuerpo;
}

/**
 * LAS DOS FORMAS DE ESCUCHAR UN EVENTO DE INDEXEDDB, y hacen falta las dos.
 *
 * `peticion.onsuccess = …` —la que escribe todo el mundo— y
 * `peticion.addEventListener('success', …)` —la que escribe quien ya se quemo
 * pisando un `onsuccess` ajeno—. Cubrir solo una dejaria la puerta de al lado
 * abierta cambiando una palabra, que es exactamente lo que pasaba con `mark` y
 * `measure`.
 *
 * El evento lleva `target` porque la forma mas comun de leer el resultado no es
 * `peticion.result` sino `evento.target.result`.
 */
function dispararEnLaBase(objetivo: Record<string, unknown>, tipo: string): void {
  const evento = { type: tipo, target: objetivo, currentTarget: objetivo };
  const propio = objetivo[`on${tipo}`];

  if (typeof propio === 'function') {
    (propio as (evento: unknown) => void).call(objetivo, evento);
  }

  for (const oyente of oyentesDe(objetivo).get(tipo) ?? []) {
    oyente.call(objetivo, evento);
  }
}

/**
 * APLAZAR SIN RELOJ: una microtarea de PROMESA NATIVA, no `queueMicrotask`.
 *
 * Hay que aplazar, y no es un detalle de fidelidad sino LO QUE DECIDE SI EL
 * TAPON VE ALGO. La forma de la fuga es siempre esta:
 *
 *     const apertura = indexedDB.open('boxadmin-config', 1);
 *     apertura.onsuccess = () => { …put… };
 *
 * El manejador se asigna DESPUES de que `open()` devuelva. Si `open()` llamara
 * a `onsuccess` antes de volver, no habria ningun manejador puesto todavia: el
 * tapon no veria la escritura y pasaria en verde —ciego— con la fuga delante.
 *
 * Y se aplaza con `Promise.resolve().then(…)` y no con `queueMicrotask` por la
 * leccion de `EL_CRONOMETRO`: `queueMicrotask` esta en el conjunto de relojes
 * que sinon falsea, asi que un spec con `vi.useFakeTimers()` lo dejaria
 * encolado hasta que alguien avanzara el reloj —o sea, nunca— y el canal se
 * quedaria ciego justo en los specs que usan relojes falsos. Las promesas
 * nativas no las falsea nadie. MEDIDO: una microtarea nativa encolada dentro de
 * un test ya corrio cuando corre el `afterEach`.
 *
 * Cada manejador va en su propio `try`: si el de `upgradeneeded` explota —cosa
 * de quien lo escribio, no nuestra—, el de `success` tiene que correr igual o
 * se perderia el `put` que viene detras.
 */
function masTardeEnLaBase(hacer: () => void): void {
  void Promise.resolve().then(() => {
    try {
      hacer();
    } catch {
      // Un manejador que explota es un fallo del codigo bajo prueba, no de este
      // tapon: en el navegador va a `window.onerror` y no rompe a quien disparo
      // el evento. Aqui se traga por lo mismo, y porque lo que este tapon tiene
      // que registrar —la escritura— ya quedo anotado antes de llamar a nadie.
    }
  });
}

/** Una `IDBRequest` de mentira, con su resultado ya puesto y su `success` aplazado. */
function peticionDeLaBase(resultado: unknown): Record<string, unknown> {
  const peticion = conOyentes({
    result: resultado,
    error: null,
    readyState: 'done',
    onsuccess: null,
    onerror: null,
    source: null,
    transaction: null,
  });

  masTardeEnLaBase(() => dispararEnLaBase(peticion, 'success'));

  return peticion;
}

/**
 * Una clave de IndexedDB en texto, para poder buscar centinelas dentro.
 *
 * Las claves no son solo cadenas: la plataforma admite numeros, fechas y
 * ARRAYS (`put(valor, [tenantId, email])`), y por cualquiera de esas formas se
 * va un dato igual de bien. Se pasan por `comoTexto`, como el `detail` de
 * `performance.mark` y como el cuerpo de un `postMessage`.
 */
function textoDeUnaClave(clave: unknown): string {
  if (clave === undefined || clave === null) return '';
  if (typeof clave === 'string') return clave;

  return comoTexto([clave]);
}

/**
 * UNA BASE DE DATOS DE MENTIRA QUE SI GUARDA LO QUE LE PONEN.
 *
 * Guarda de verdad —en memoria, y solo mientras dure el test— por una razon
 * concreta: SIN REGISTROS NO HAY CURSOR. `openCursor()` sobre un almacen vacio
 * entrega `null` y un `cursor.update(dato)` no llega a ejecutarse nunca; el
 * tapon pasaria en verde mientras en el navegador —donde el almacen tiene los
 * registros de la sesion anterior— la misma linea reescribe cada fila con el
 * dato dentro. Guardando lo que se pone, un `put` seguido de un recorrido cae
 * por las dos puertas.
 *
 * LO QUE ESTO NO ARREGLA, dicho sin adornar: un cursor sobre un almacen al que
 * ESTE test no escribio sigue sin entregar nada, porque la base nace vacia en
 * cada `beforeEach`. Tapar eso pedia inventar registros falsos, y entonces el
 * canal dejaria de medir lo que la pantalla hace para medir lo que hace con lo
 * que nos inventamos. El caso queda cubierto por el otro lado: con la forma
 * fuerte, ABRIR la base ya es el fallo, y para llegar a un cursor hay que
 * abrirla.
 *
 * Y LOS ALMACENES SE CREAN SOLOS al pedirlos. Un `transaction('borradores')`
 * sobre un almacen que no existe lanza `NotFoundError` en la plataforma de
 * verdad; aqui no, a proposito: ese error ocurriria DENTRO de un manejador de
 * eventos, donde nadie lo ve, y el resultado seria una escritura invisible en
 * vez de un fallo. Un tapon no puede permitirse ser mas estricto que la
 * plataforma en un sitio donde serlo lo deja ciego.
 */
function baseDeDatosDeMentira(
  base: string,
  version: number,
  anotar: (escritura: EscrituraEnLaBase) => void,
): Record<string, unknown> {
  const almacenes = new Map<string, RegistroDeLaBase[]>();

  const registrosDe = (nombre: string): RegistroDeLaBase[] => {
    let registros = almacenes.get(nombre);

    if (registros === undefined) {
      registros = [];
      almacenes.set(nombre, registros);
    }

    return registros;
  };

  const almacenDeMentira = (nombre: string): Record<string, unknown> => {
    const registros = registrosDe(nombre);

    /** Las dos puertas de escritura directa: `put` y `add`, que son la misma. */
    const guardar = (puerta: string) => (valor: unknown, clave?: unknown) => {
      // Se ANOTA ANTES de nada: si algo de aqui abajo explotara, la escritura
      // ya esta registrada. Es la regla del resto del tapon.
      anotar({ puerta, base, almacen: nombre, clave: textoDeUnaClave(clave), valor });
      registros.push({ clave, valor });

      return peticionDeLaBase(clave ?? registros.length);
    };

    /**
     * EL CURSOR, que es la TERCERA puerta de escritura y no se parece a las otras.
     *
     * `cursor.update(valor)` reescribe el registro sobre el que esta parado sin
     * pasar por `put` ni por `add`: doblar solo esas dos dejaria la puerta
     * abierta cambiando dos palabras, igual que vigilar `mark` sin `measure`.
     * `continue()` vuelve a disparar el `success` de la MISMA peticion con el
     * registro siguiente, que es como recorre la plataforma de verdad.
     */
    const abrirCursor = (): Record<string, unknown> => {
      const peticion = conOyentes({
        result: null,
        error: null,
        readyState: 'done',
        onsuccess: null,
        onerror: null,
      });

      const copia = [...registros];
      let indice = 0;

      const entregar = (): void => {
        const registro = copia[indice];

        peticion.result =
          registro === undefined
            ? null
            : {
                key: registro.clave,
                primaryKey: registro.clave,
                value: registro.valor,
                direction: 'next',
                update: (valor: unknown) => {
                  anotar({
                    puerta: 'cursor.update',
                    base,
                    almacen: nombre,
                    clave: textoDeUnaClave(registro.clave),
                    valor,
                  });
                  registro.valor = valor;

                  return peticionDeLaBase(registro.clave);
                },
                delete: () => peticionDeLaBase(undefined),
                continue: () => {
                  indice += 1;
                  entregar();
                },
                advance: (cuantos: unknown) => {
                  indice += Math.max(1, Number(cuantos) || 1);
                  entregar();
                },
              };

        masTardeEnLaBase(() => dispararEnLaBase(peticion, 'success'));
      };

      entregar();

      return peticion;
    };

    return {
      name: nombre,
      keyPath: null,
      autoIncrement: false,
      indexNames: [],
      put: guardar('put'),
      add: guardar('add'),
      delete: () => peticionDeLaBase(undefined),
      clear: () => peticionDeLaBase(undefined),
      get: (clave: unknown) =>
        peticionDeLaBase(registros.find((uno) => uno.clave === clave)?.valor),
      getAll: () => peticionDeLaBase(registros.map((uno) => uno.valor)),
      getAllKeys: () => peticionDeLaBase(registros.map((uno) => uno.clave)),
      count: () => peticionDeLaBase(registros.length),
      openCursor: abrirCursor,
      openKeyCursor: abrirCursor,
      createIndex: () => almacenDeMentira(nombre),
      deleteIndex: () => {},
      // Un indice es otra forma de llegar al MISMO registro, cursor incluido:
      // `store.index('por-email').openCursor()` entrega cursores con `update`.
      index: () => almacenDeMentira(nombre),
    };
  };

  const laBase: Record<string, unknown> = conOyentes({
    name: base,
    version,
    objectStoreNames: [] as string[],
    createObjectStore: (nombre: unknown) => {
      registrosDe(String(nombre));
      laBase.objectStoreNames = [...almacenes.keys()];

      return almacenDeMentira(String(nombre));
    },
    deleteObjectStore: (nombre: unknown) => {
      almacenes.delete(String(nombre));
      laBase.objectStoreNames = [...almacenes.keys()];
    },
    transaction: (nombres: unknown, modo?: unknown) => {
      const transaccion = conOyentes({
        db: laBase,
        mode: typeof modo === 'string' ? modo : 'readonly',
        objectStoreNames: Array.isArray(nombres) ? nombres.map(String) : [String(nombres)],
        error: null,
        oncomplete: null,
        onerror: null,
        onabort: null,
        objectStore: (nombre: unknown) => almacenDeMentira(String(nombre)),
        abort: () => {},
        commit: () => {},
      });

      masTardeEnLaBase(() => dispararEnLaBase(transaccion, 'complete'));

      return transaccion;
    },
    close: () => {},
    onversionchange: null,
  });

  return laBase;
}

/**
 * Como nombrar una escritura en un informe SIN publicar lo que lleva.
 *
 * La puerta, la base, el almacen y la clave; NUNCA el valor —que es justamente
 * el objeto que esta fuga se lleva entero—. Y los tres nombres pasan por
 * `claveSegura`, porque una base bautizada con el dato
 * (`indexedDB.open(claveTemporal)`) lo publica igual de bien que un valor.
 */
function descripcionDeUnaEscritura(escritura: EscrituraEnLaBase): string {
  const clave = escritura.clave === '' ? 'sin clave' : claveSegura(escritura.clave);

  return `${escritura.puerta} en ${claveSegura(escritura.base)}/${claveSegura(escritura.almacen)} (${clave})`;
}

/** Todo lo que paso por la base, serializado, para buscar centinelas dentro. */
function comoTextoLasEscrituras(escrituras: EscrituraEnLaBase[]): string {
  return escrituras
    .map((una) => `${una.base} ${una.almacen} ${una.puerta} ${una.clave} ${comoTexto([una.valor])}`)
    .join(' ');
}

/**
 * Como nombrar una clave guardada SIN publicar un secreto que venga de clave.
 *
 * `localStorage.setItem(claveTemporal, '1')` mete el dato en el NOMBRE, no en
 * el valor. El informe dice entonces como se llama el dato vigilado y no la
 * cadena, igual que hace el resto del tapon.
 */
function claveSegura(clave: string): string {
  for (const [nombre, valor] of todoLoVigilado()) {
    // Por el ALFABETO entero y no solo por el valor crudo: una clave de almacen
    // llamada `borrador-${btoa(email)}` publica el dato igual, y si aqui se
    // mirara solo la forma cruda el informe copiaria esa clave tal cual
    // —codificada, pero copiada— al registro de CI.
    if (valor !== '' && formaQueSeFue(clave, valor) !== undefined) return `«${nombre}»`;
  }

  return clave;
}

// ---------------------------------------------------------------------------
// El duodecimo canal: el `<html>` y el `<body>` — sus ATRIBUTOS, y lo que
// CUELGA del `<html>` fuera del `<head>` y del `<body>`
// ---------------------------------------------------------------------------

/**
 * LOS DOS ELEMENTOS QUE ENVUELVEN AL CUERPO, Y QUE NO MIRA NADIE.
 *
 * Los once tapones de arriba miran la consola, el titulo, `window.name`, el
 * CONTENIDO del `<head>`, los cinco almacenes, el buffer de User Timing, el
 * `src` de una imagen, las tres salidas laterales, el service worker e
 * IndexedDB. Los tests de pantalla miran lo que hay DENTRO del `<body>`:
 * nodos, texto y roles. Entre las dos cosas quedan DOS ELEMENTOS ENTEROS sin
 * mirar: los ATRIBUTOS del `<html>` y los del `<body>`. Medido antes de
 * escribir esto: cero coincidencias de `documentElement` en todo
 * `apps/web/src`, y ni un `setAttribute`, `classList` ni `dataset` sobre
 * ninguno de los dos.
 *
 * Es el sitio natural de una «marca de diagnostico» —la linea que cualquiera
 * escribe sin pensarla— porque es COMO SE PONEN LOS TEMAS, LOS IDIOMAS Y LAS
 * BANDERAS DE FUNCIONALIDAD: un `data-*` con un id, un rol o un nombre pasa
 * cualquier revision porque parece instrumentacion.
 *
 * MEDIDO: un `document.documentElement.dataset.ultimoHealthCheck = jobId` en
 * un `useEffect` de la pantalla de Configuracion paso los 1494 tests del
 * paquete con los ONCE tapones enchufados.
 *
 * ESTE EJE ES DISTINTO DE LOS CINCO ANTERIORES —`sendBeacon`, `caches`, el
 * service worker, IndexedDB y el rato libre—, y la diferencia es la que lo
 * hace peor. Aquellos pasaban por APIs que jsdom NO implementa, asi que la
 * fuga vivia detras de un `?.` que la delataba en cuanto alguien lo miraba.
 * JSDOM IMPLEMENTA ESTO ENTERO: no hay ningun `?.`, la linea es identica en el
 * test y en el navegador, y corre de verdad en los dos. El sitio no estaba
 * ciego por el entorno — estaba ciego porque nadie lo nombro nunca.
 *
 * Y tiene tres propiedades que lo hacen peor que un `console.log`:
 *
 *  1. NO ESTA EN EL ARBOL QUE `render` MONTA, asi que `cleanup()` NO lo borra:
 *     lo que una pantalla escriba ahi sobrevive a su propio test y contamina
 *     los siguientes del mismo archivo. Esta medido: con la mutacion puesta,
 *     un test fallo por el atributo que habia dejado el anterior. Por eso el
 *     tapon los QUITA antes de afirmar, igual que restaura los almacenes y
 *     vacia el buffer de marcas: si no, el informe acusa al inocente.
 *  2. En el navegador son EXACTAMENTE IGUAL DE PUBLICOS que el `<body>`:
 *     primera linea de «inspeccionar elemento», y salen enteros en «ver codigo
 *     fuente» y en cualquier volcado del DOM.
 *  3. Sobreviven a la navegacion de la SPA, porque no los desmonta nadie.
 *
 * SE AFIRMA POR IGUALDAD CONTRA EL CONJUNTO VACIO, no contra «lo que habia al
 * empezar», y es una decision con fuga conocida del otro lado: con una foto
 * inicial, un atributo que hubiera dejado un test ANTERIOR del archivo estaria
 * en las dos fotos y pasaria en verde —que es justamente la propiedad 1 usada
 * al reves—. La forma fuerte solo vale si los dos elementos nacen limpios, y
 * eso NO se leyo, se midio: en jsdom 26 `document.documentElement.attributes`
 * y `document.body.attributes` estan los dos VACIOS al empezar un spec y
 * siguen vacios tras un `render` con `QueryClientProvider`; y con el tapon
 * puesto con esta forma, los 66 specs del paquete siguen en verde, o sea que
 * NADIE —ni Next, ni React 19, ni Testing Library, ni ningun proveedor—
 * escribe ahi durante un test.
 *
 * CUBRE LOS DOS ELEMENTOS porque el hueco es el mismo en los dos, y se
 * informan POR SEPARADO para que el mensaje diga en cual de los dos fue.
 *
 * Y CUBRE ADEMAS LO QUE CUELGA DEL `<html>` fuera del `<head>` y del `<body>`,
 * que es la SEGUNDA MITAD de este canal y se agrego despues: un nodo hermano
 * del `<body>` no esta en el `<head>` —que mira el cuarto canal—, no es un
 * atributo —que es lo que miraba este— y no esta dentro del cuerpo —que es lo
 * que miran los tests de pantalla—. El razonamiento entero, la medida de los
 * tres huecos y por que se cierra aqui: el docblock de `loColgadoDelHtml`.
 *
 * NO HACE FALTA ESPIA NINGUNO, y por eso este canal es el unico que no se
 * engancha en el `beforeEach`. Los otros once doblan una funcion o un accesor
 * y tienen que volver a hacerlo en cada test, porque los specs llaman a
 * `vi.restoreAllMocks()` en su propio `afterEach`, que con el orden de hooks
 * de Vitest corre ANTES que este tapon. Aqui no hay nada que doblar: el estado
 * que delata la fuga son los atributos que QUEDAN en el documento, y eso se
 * lee directamente al terminar. Sin espia no hay nada que restaurar y, por
 * tanto, nada que `vi.restoreAllMocks()` pueda apagar.
 */
type ElementoDeAlrededor = '<html>' | '<body>';

const ALREDEDOR_DEL_CUERPO: readonly ElementoDeAlrededor[] = ['<html>', '<body>'];

/** El elemento de verdad detras del nombre con el que lo llama el informe. */
function elementoDeAlrededor(cual: ElementoDeAlrededor): Element {
  return cual === '<html>' ? document.documentElement : document.body;
}

/** Los atributos de un elemento, nombre y valor, tal cual estan. */
function atributosDe(elemento: Element): [string, string][] {
  return [...elemento.attributes].map((atributo) => [atributo.name, atributo.value]);
}

/**
 * Los atributos serializados, para buscar centinelas dentro.
 *
 * Se mira el NOMBRE ademas del valor: un
 * `document.documentElement.setAttribute(claveTemporal, '1')` mete el dato en
 * el nombre, igual que un `localStorage.setItem(claveTemporal, '1')`.
 */
function textoDeLosAtributos(atributos: [string, string][]): string {
  return atributos.map(([nombre, valor]) => `${nombre}=${valor}`).join(' ');
}

/**
 * LA SEGUNDA MITAD DEL DUODECIMO CANAL: LO QUE CUELGA DEL `<html>` Y NO ES NI
 * EL `<head>` NI EL `<body>`.
 *
 * MEDIDO en el catalogo de packs de la Fase 14, con el catalogo entero dentro
 * —los tres nombres y los dos precios, EN CLARO—:
 *
 *     const marca = document.createElement('div');
 *     marca.textContent = JSON.stringify(packs.data);
 *     document.documentElement.append(marca);
 *       → pasa los 1841 tests del paquete.
 *
 * Y la variante con el dato en un atributo (`marca.setAttribute('data-marca',
 * …)`) tambien pasa. No hace falta ni esconderlo: el TEXTO de ese nodo tampoco
 * lo ve nadie.
 *
 * CAE EN EL HUECO ENTRE TRES DEFENSAS, y las tres estan en este repo:
 *
 *  - EL CUARTO CANAL mira LOS HIJOS DEL `<head>` —`document.head.children`—,
 *    asi que un hermano del `<head>` no esta en su lista.
 *  - ESTE CANAL miraba LOS ATRIBUTOS del `<html>` y del `<body>`, no sus
 *    HIJOS.
 *  - Y LOS TESTS DE PANTALLA miran lo que hay DENTRO del `<body>`:
 *    `screen.*`, `document.body.innerHTML`, los `querySelectorAll` del cuerpo.
 *
 * EL CASO SIMETRICO —un nodo colgado del `<head>`— SI ESTABA CUBIERTO, y eso se
 * COMPROBO en vez de darse por hecho, porque si el cuarto canal mirara solo los
 * `<meta>` o solo el crecimiento el agujero seria el doble de grande. Sonda:
 * un `<div>` con un centinela dentro metido en el `<head>` hace caer el test
 * con «la cabecera del documento lleva …». El cuarto canal mira el `<head>`
 * ENTERO por `innerHTML` y ademas cuenta los hijos nuevos. Lo que no mira es su
 * hermano.
 *
 * ---------------------------------------------------------------------------
 * POR QUE SE CIERRA AQUI Y NO EN EL CUARTO CANAL NI EN UN CANAL NUEVO.
 *
 * Lo que agrupa un canal es EL SITIO DONDE ACABA EL DATO —es el criterio con el
 * que `showNotification` acabo en el decimoseptimo y no en el decimo—, y este
 * dato acaba colgado del `<html>`, que es LA SUPERFICIE DE ESTE CANAL. Las
 * cuatro cosas que hacen falta ya estan aqui y ya estan argumentadas:
 *
 *  1. LA FORMA FUERTE. Ver abajo: el `<html>` tiene DOS hijos y nada mas.
 *  2. LA LIMPIEZA ANTES DE AFIRMAR, que es la propiedad 1 de este canal
 *     (`cleanup()` no lo quita) aplicada a un nodo en vez de a un atributo.
 *  3. EL MOMENTO DE LA LECTURA: despues del `cleanup()`, como los atributos y
 *     por el mismo motivo —no se pierde nada y se gana el nodo que cuelgue la
 *     LIMPIEZA de un `useEffect`—.
 *  4. Y EL MISMO INFORME: la etiqueta y nunca el contenido.
 *
 * En el CUARTO canal no cabe: ese lee `document.head.children` y su vocabulario
 * es «la cabecera del documento»; un hermano del `<head>` no es la cabecera y
 * meterlo ahi obligaria a que ese canal dejara de poder decir donde estaba. Y
 * un canal NUEVO costaria renumerar los dieciocho en cuatro archivos para
 * agregar una lectura de `document.documentElement.children` sobre un elemento
 * que este canal ya vigila: seria contar dos veces el mismo sitio.
 *
 * ---------------------------------------------------------------------------
 * LA FORMA ES LA FUERTE —«EL `<html>` NO TIENE UN TERCER HIJO»— Y ESO SE MIDIO.
 *
 * Primero con una sonda: en un test normal de este paquete,
 * `[...document.documentElement.children].map((n) => n.tagName)` es
 * EXACTAMENTE `['HEAD', 'BODY']`, antes y despues de un `render` con
 * `QueryClientProvider`. Ni Next, ni React 19, ni Testing Library cuelgan nada
 * ahi. Y la medida que decide no es esa sonda sino la del paquete entero: con
 * esta afirmacion puesta, LOS 84 SPECS SIGUEN EN VERDE.
 *
 * Donde no hay uso legitimo que proteger la forma fuerte sale gratis, y aqui
 * ademas CAZA EL NODO QUE NO LLEVA NINGUN CENTINELA —una marca de diagnostico
 * con la lista de clases del dia, que es justo lo que una «marca» se lleva—.
 * Es la forma de `window.name`, de IndexedDB y de los atributos de al lado.
 *
 * SE FILTRA POR `<head>` Y `<body>` Y NO POR POSICION. Un `insertBefore` antes
 * del `<head>` es tan hijo del `<html>` como un `append`, y contar hijos
 * dejaria pasar al que SUSTITUYE a uno de los dos: es la misma leccion que
 * `nodosDeLaCabecera`, que guarda los nodos y no su cuenta.
 *
 * LO QUE NO VE, dicho sin adornar: un nodo que la pantalla cuelgue y QUITE
 * antes de terminar el test. Es el mismo limite que tienen los atributos de al
 * lado leidos por estado, y no es la fuga callada que este canal persigue: lo
 * que una «marca de diagnostico» hace es QUEDARSE.
 */
const HIJOS_LEGITIMOS_DEL_HTML: readonly string[] = ['HEAD', 'BODY'];

/** Un nodo colgado del `<html>` que no es ni el `<head>` ni el `<body>`. */
interface NodoColgadoDelHtml {
  /** Como se nombra en el informe: la etiqueta. NUNCA el contenido. */
  etiqueta: string;
  /** Lo que lleva dentro, para buscar centinelas. NUNCA entra en el informe. */
  contenido: string;
  /** El nodo, para quitarlo ANTES de afirmar. Ver la propiedad 1 del canal. */
  nodo: Element;
}

/**
 * Lo que cuelga del `<html>` fuera del `<head>` y del `<body>`.
 *
 * SE EXPORTA SOLO PARA SU GUARDIAN, `lo-que-cuelga-del-html.spec.ts`, por el
 * mismo motivo por el que se exportan `formaQueSeFue`, `vinoDePedir`,
 * `escondidoEnElCuerpo` y `contenidoDeUnaEscrituraEnDisco`: si alguien
 * «simplifica» el filtro a contar hijos, o se deja fuera los atributos del
 * nodo, los 84 specs siguen en verde y el canal se queda ciego. Ningun spec de
 * pantalla lo llama.
 *
 * SE MIRAN LAS TRES COSAS QUE UN NODO PUEDE LLEVAR —sus atributos en crudo, su
 * marcado serializado y su texto— porque son tres sitios distintos y los tres
 * salen enteros en «ver codigo fuente»: el `outerHTML` cubre de paso a los
 * DESCENDIENTES del nodo colgado, y los atributos se miran ademas en crudo
 * porque la serializacion escapa las comillas y un centinela con comillas
 * dentro no apareceria literal.
 */
export function loColgadoDelHtml(): NodoColgadoDelHtml[] {
  return [...document.documentElement.children]
    .filter((nodo) => !HIJOS_LEGITIMOS_DEL_HTML.includes(nodo.tagName))
    .map((nodo) => ({
      etiqueta: etiquetaDe(nodo),
      contenido: `${textoDeLosAtributos(atributosDe(nodo))} ${nodo.outerHTML} ${nodo.textContent ?? ''}`,
      nodo,
    }));
}

// ---------------------------------------------------------------------------
// El decimotercer canal: la URL del documento
// ---------------------------------------------------------------------------

/**
 * LA BARRA DE DIRECCIONES: EL HUECO ENTRE LAS DOS DEFENSAS DE ESTE REPO.
 *
 * Los doce tapones de arriba miran la consola, el titulo, `window.name`, el
 * `<head>`, los cinco almacenes, el buffer de User Timing, el `src` de una
 * imagen, las tres salidas laterales, CacheStorage, el service worker,
 * IndexedDB y los atributos del `<html>` y del `<body>`. Los tests de pantalla
 * miran DENTRO del `<body>` y la lista de peticiones. `location` NO CAE EN
 * NINGUNO DE LOS DOS LADOS: ni es un canal de los doce ni es marcado.
 *
 * MEDIDO: un `window.history.replaceState(null, '', '#dijo=' + config.error.message)`
 * en la pantalla de Configuracion —tres lineas que parecen una cortesia para
 * poder compartir el enlace con el fallo— dejo la URL en
 * `http://localhost:3000/#dijo=La%20base%20de%20datos%20del%20gimnasio%20no%20contesta`
 * y paso los 1507 tests del paquete con los doce canales enchufados.
 *
 * Y como canal de fuga es de los peores que tiene un navegador, porque es el
 * unico que se COPIA SOLO:
 *
 *  - Va en la barra de direcciones de la maquina del mostrador, que usan
 *    cuatro personas por turno y que se ve desde dos metros.
 *  - Entra en el historial EN DISCO y en el archivo de restauracion de sesion,
 *    igual que `document.title`, y sobrevive al logout.
 *  - Se copia y se pega ENTERA: el enlace que alguien manda por chat para
 *    enseñar la pantalla se lleva el dato dentro.
 *  - Queda en el REGISTRO DE ACCESO de cualquier servidor al que se navegue
 *    despues, y VIAJA COMO `Referer` A TERCEROS —a la CDN del logo, al tipo de
 *    letra, a la etiqueta de analitica que se enchufe mañana— sin que nadie lo
 *    decida.
 *
 * Nada de eso deja rastro en la pestaña de red ni en el marcado.
 *
 * Y, como los atributos del `<html>`, SOBREVIVE A SU PROPIO TEST: `cleanup()`
 * desmonta el `<body>` y no toca `location`. Esta medido en este mismo repo
 * antes de que esto existiera: la query que sembraba un test aparecia intacta
 * en el siguiente.
 *
 * ---------------------------------------------------------------------------
 * LA FORMA ES LA FUERTE —«LA URL NO CAMBIO»— Y ESO SE MIDIO, NO SE SUPUSO.
 *
 * La duda era real y cara: MEDIA DOCENA DE PANTALLAS ESCRIBEN EN LA URL A
 * PROPOSITO —los filtros de turnos, horarios, ausencias y analisis ponen su
 * estado ahi, razonado por escrito («sobrevive al boton de atras», «la pantalla
 * y la barra de direcciones no pueden decir cosas distintas»)—. Si eso llegara
 * a `location` en un test, la forma fuerte seria ROJA con el codigo correcto en
 * seis specs.
 *
 * No llega, y el motivo es estructural: LO HACEN POR EL ROUTER DE NEXT, Y EL
 * ROUTER ESTA DOBLADO EN LOS 26 SPECS QUE LO USAN. Medido uno por uno: los 26
 * montan `vi.mock('next/navigation', …)` con un `useRouter` que devuelve
 * `push`/`replace` como `vi.fn()`, y `useSearchParams` devuelve un
 * `URLSearchParams` que el spec fabrica a mano. NINGUNO toca `location`, y no
 * hay un solo spec que importe `next/navigation` sin doblarlo. O sea que lo
 * unico que puede mover `location` dentro de un test es alguien SALTANDOSE el
 * router — que es exactamente la fuga. La forma fuerte sale gratis.
 *
 * (Y la medida que decide no es esa lectura sino la del paquete entero: con
 * este tapon puesto con la forma fuerte, los 67 specs siguen en verde.)
 *
 * SE COMPARAN LAS PARTES POR SEPARADO —origen, ruta, query, hash y el ESTADO
 * del historial— y no solo el `href` entero, por dos cosas. La primera es el
 * informe: decir «cambio el hash» ubica la fuga sin publicar ni un caracter de
 * lo que lleva dentro, y un `href` entero en el mensaje seria publicar el dato
 * en el registro de CI, que es el modo de fallo que todo este archivo evita. La
 * segunda es el ESTADO, que no es parte del `href` y que sin nombrarlo
 * desaparece: ver abajo.
 *
 * Y SE COMPARA CONTRA LA FOTO DE AL CARGAR —la URL con la que el entorno
 * arranca, cogida UNA VEZ en el cuerpo del modulo— y no contra una foto del
 * `beforeEach`. Es la misma decision que el duodecimo canal y por el mismo
 * motivo: con una foto por test, una query que hubiera dejado un test ANTERIOR
 * del archivo estaria en las dos fotos y pasaria en verde, que es la propiedad
 * de arriba —`cleanup()` no toca `location`— usada al reves. La restauracion
 * del `afterEach` hace verdadera la premisa en cada test.
 *
 * ---------------------------------------------------------------------------
 * HAY VARIAS PUERTAS, Y SE MIDIO COMO ESTA MONTADA CADA UNA. NO ES UNIFORME.
 *
 * 1. `history.pushState` y `history.replaceState` VIVEN EN `History.prototype`
 *    y son escribibles y configurables —medido; `window.history` no tiene NI
 *    UNA propiedad propia—, asi que se doblan con `vi.spyOn` como `mark` y
 *    `measure`. Las dos cambian `location` de verdad en jsdom, hash Y query:
 *    `pushState(null, '', '?q=x')` deja `location.search` en `?q=x`.
 *
 * 2. ESCRIBIR `location.hash` FUNCIONA Y NO SE PUEDE DOBLAR. Medido: `href`,
 *    `hash`, `search` y `pathname` son accesores PROPIOS del objeto `location`
 *    con `configurable: false`, y `Location.prototype` no tiene ninguno de los
 *    cuatro. Un `Object.defineProperty(location, 'hash', …)` revienta con
 *    «Cannot redefine property». No hace falta: `location.hash = '#x'` SI
 *    cambia la URL en jsdom, y la otra mitad del canal —la comparacion— lo ve.
 *
 * 3. `location.assign` Y `location.replace` NO SE PUEDEN DOBLAR DE NINGUNA
 *    MANERA, y esto se midio hasta el final en lugar de darlo por hecho: son
 *    propiedades de DATOS propias de `location`, `writable: false` y
 *    `configurable: false`. `window.location` si es redefinible, asi que se
 *    probo el ultimo recurso —sustituirlo por un `Proxy` que delegue en el de
 *    verdad— y TAMBIEN FALLA, por invariante del lenguaje: un `Proxy` no puede
 *    devolver en `get` algo distinto del valor real de una propiedad de datos
 *    no configurable y no escribible, y lanza un `TypeError` al intentarlo.
 *    Quedan cubiertas por la comparacion: `assign('#x')` y `replace('#x')`
 *    cambian la URL en jsdom y caen.
 *
 * LO QUE ESTE TAPON NO VE, dicho sin adornar para que nadie lo descubra
 * creyendo que estaba tapado: LAS NAVEGACIONES QUE NO SON AL MISMO DOCUMENTO.
 * Medido: `location.href = 'http://…/otra'`, `location.search = '?q=x'` y un
 * `assign`/`replace` a una ruta distinta son NO-OPS en jsdom —implementa solo
 * el cambio de hash y la History API— asi que no cambian nada que comparar, y
 * por el punto 3 no hay donde engancharse. Es el agujero de forma
 * `sendBeacon`: silencioso en el test y real en el navegador. Se queda abierto
 * a proposito y no por pereza —no hay forma de cerrarlo sin fabricar un
 * `Location` entero de mentira, y entonces el canal mediria nuestro doble en
 * vez de la pantalla—, y es el menos grave de los cuatro: una navegacion a
 * otro documento SE LLEVA LA PAGINA, o sea que no es la fuga callada que este
 * canal persigue sino un fallo que se ve a simple vista. La fuga callada —la
 * que mantiene a la persona donde estaba y le mete el dato en la barra— es
 * siempre al MISMO documento, y esa cae entera.
 *
 * ---------------------------------------------------------------------------
 * DOS MITADES, Y HACEN FALTA LAS DOS. Es el patron de los almacenes y del
 * buffer de marcas, y aqui cada una caza algo que la otra no puede:
 *
 *  - LA COMPARACION sola no basta porque `pushState(estado, '', LA MISMA URL)`
 *    GUARDA EL OBJETO EN `history.state` SIN TOCAR NI UN CARACTER DE LA URL.
 *    Medido: tras esa llamada `location.href` es identico y
 *    `history.state` devuelve `{"secreto":"…"}` entero. Y ese estado se
 *    serializa al archivo de restauracion de sesion EN DISCO, que es
 *    `localStorage` por otro nombre. Por eso el estado es una de las partes
 *    que se comparan. Tampoco veria un `replaceState` con el dato seguido de
 *    otro que lo limpia tres lineas despues —el mismo caso que un `setItem`
 *    seguido de un `removeItem`—.
 *  - EL ESPIA solo no basta porque `location.hash = …`, `assign` y `replace`
 *    no pasan por el, y porque no ve lo que ya estuviera en la URL antes del
 *    `beforeEach`.
 *
 * SE VIGILAN LAS CINCO PUERTAS DEL HISTORIAL y no solo las dos que escriben.
 * `go`, `back` y `forward` no llevan un dato a ninguna parte, pero mueven la
 * barra de direcciones por detras del router igual que `replaceState`, y este
 * repo YA TENIA ESA REGLA ESCRITA: `turnos/page.spec.tsx` la custodiaba en un
 * spec desde la Fase 9 («la URL la escribe el router, no la History API a
 * mano»). Cubrir solo `pushState` y `replaceState` reabriria ese agujero
 * cambiando una palabra, que es lo mismo que pasaba con `mark` sin `measure`.
 * Al estar aqui, esa regla vale para los 67 specs en vez de para uno.
 *
 * SE AFIRMA TAMBIEN POR CENTINELAS, Y ANTES QUE LA FORMA FUERTE, como
 * IndexedDB y como los atributos del `<html>`: un «la URL del documento lleva
 * claveDelReset» dice QUE se fue, y la forma fuerte sola obligaria a ir a
 * buscarlo. Y LA URL SE MIRA ADEMAS DECODIFICADA, que no es un adorno: la URL
 * codifica los espacios, asi que el centinela
 * `La base de datos del gimnasio no contesta` NO aparece literal en
 * `#dijo=La%20base%20de%20datos%20del%20gimnasio%20no%20contesta` y la mitad de
 * las fugas con un mensaje dentro pasarian en verde. Medido.
 */
type PuertaDelHistorial = 'pushState' | 'replaceState' | 'go' | 'back' | 'forward';

const PUERTAS_DEL_HISTORIAL: readonly PuertaDelHistorial[] = [
  'pushState',
  'replaceState',
  'go',
  'back',
  'forward',
];

/**
 * LAS CINCO FUNCIONES DE VERDAD, cogidas UNA VEZ al cargar.
 *
 * Por la leccion de las galletas y del `src` de una imagen: leerlas desde
 * dentro del `beforeEach`, despues del primer enganche, envolveria el
 * envoltorio de ayer y contaria cada llamada tantas veces como tests lleve el
 * archivo. Y hacen falta ademas para dos cosas que el espia no puede hacer por
 * si mismo: REENVIAR —el tapon registra y deja pasar, como el resto— y
 * RESTAURAR la URL al terminar sin que esa restauracion se cuente como una
 * llamada de la pantalla.
 */
const HISTORIAL_ORIGINAL = new Map<PuertaDelHistorial, (...partes: unknown[]) => unknown>(
  PUERTAS_DEL_HISTORIAL.filter((puerta) => typeof History.prototype[puerta] === 'function').map(
    (puerta) => [puerta, History.prototype[puerta] as (...partes: unknown[]) => unknown],
  ),
);

/** Las partes de la URL que se comparan por separado, el estado incluido. */
type ParteDeLaUrl = 'origen' | 'ruta' | 'query' | 'hash' | 'estado';

const PARTES_DE_LA_URL: readonly ParteDeLaUrl[] = ['origen', 'ruta', 'query', 'hash', 'estado'];

/**
 * La URL del documento partida en pedazos, mas el estado del historial.
 *
 * El `estado` va aqui y no aparte porque es la parte de este canal que NO se
 * ve en la barra de direcciones y que sin nombrar se perderia: un
 * `pushState(datos, '', la misma URL)` no cambia ni un caracter del `href`.
 */
function fotoDeLaUrl(): Record<ParteDeLaUrl, string> {
  const url = new URL(window.location.href);

  return {
    origen: url.origin,
    ruta: url.pathname,
    query: url.search,
    hash: url.hash,
    // `?? null` porque jsdom deja el estado en `undefined` tras una navegacion
    // de hash y en `null` al cargar —medido—, y las dos cosas significan «no
    // hay estado»: sin igualarlas, un `location.hash = …` acusaria ademas a
    // una parte que nadie escribio.
    estado: comoTexto([window.history.state ?? null]),
  };
}

/** La URL con la que arranca el entorno: contra esta se compara y a esta se vuelve. */
const URL_AL_CARGAR = window.location.href;
const FOTO_AL_CARGAR = fotoDeLaUrl();
const ESTADO_AL_CARGAR = window.history.state as unknown;

/**
 * La URL en texto Y DECODIFICADA, para buscar centinelas dentro.
 *
 * Las dos formas, porque la plataforma codifica al escribir: un centinela con
 * espacios se guarda como `%20` y no aparece literal en el `href`. Si la
 * cadena no es decodificable —un `%` suelto— se mira igual por su forma cruda,
 * como hace `comoTexto` con lo que no se puede serializar.
 */
function urlComoTexto(href: string): string {
  try {
    return `${href} ${decodeURIComponent(href)}`;
  } catch {
    return href;
  }
}

/** Una llamada a la History API, vista por el espia: la puerta y lo que le pasaron. */
interface LlamadaAlHistorial {
  puerta: PuertaDelHistorial;
  argumentos: string;
}

// ---------------------------------------------------------------------------
// El decimocuarto canal: la red por fuera de `pedir`
// ---------------------------------------------------------------------------

/**
 * LA DEFENSA QUE ESTE ARCHIVO DABA POR SUPUESTA Y VIVIA EN 3 SPECS DE 74.
 *
 * Los docblocks del septimo y del octavo canal dicen, los dos, que `new Image()`
 * y `sendBeacon` son peligrosos porque «no son un `fetch`, asi que el test de no
 * habla con la red por fuera de `pedir` pasa en verde». Esa frase supone que el
 * test existe. MEDIDO: existia en TRES specs de setenta y cuatro —`analisis`,
 * `ausencias` y la ficha de `usuarios/[id]`—, cada uno con su copia a mano. En
 * los otros setenta y uno el `fetch` global no lo miraba nadie.
 *
 * Es la tercera vez que a este repo le pasa lo mismo: el espia de la consola
 * empezo enganchado en 5 specs de 49 y los tres almacenes tenian once copias a
 * mano y faltaban en el duodecimo. LA MUTACION QUE LO MIDIO ESTA VEZ, en la
 * pantalla de las clases de una profesora:
 *
 *     void fetch('https://…/clases', { method: 'POST', body: JSON.stringify(alumnos.data) })
 *
 * o sea LA LISTA ENTERA de una clase, con el nombre propio y la ausencia de cada
 * persona. Paso los 19 tests de ese spec y el `tsc`, porque ese spec no era uno
 * de los tres.
 *
 * ---------------------------------------------------------------------------
 * EL CRITERIO: NO «SE LLAMO A `fetch`» SINO «SE LLAMO A `fetch` SIN PASAR POR
 * `pedir`», Y SE DECIDE POR LA PILA DE LLAMADAS.
 *
 * `pedir` usa `fetch` por dentro (`lib/cliente.ts`), asi que el trafico
 * legitimo del panel pasa por esta misma puerta: un «no se llamo a `fetch`» a
 * secas seria ROJO CON EL CODIGO CORRECTO en los 23 specs que doblan el `fetch`
 * global y dejan correr el `pedir` de verdad. Hay que distinguir.
 *
 * SE DESCARTO DISTINGUIR POR LA URL —`/api/bx…` contra cualquier otra cosa—, y
 * no por gusto: el agujero que esa forma deja es EXACTAMENTE la mutacion que
 * `ausencias/page.spec.tsx` midio y escribio, un `void fetch('/api/bx/stats/caja')`
 * en un `useEffect`. Va al proxy CON LA COOKIE de sesion, trae la caja del
 * gimnasio a una pantalla que no tiene nada que ver con el dinero, y por la URL
 * es indistinguible de una peticion de `pedir`. La forma que se puede burlar
 * escribiendo la mutacion que ya esta documentada no sirve.
 *
 * SE MIRA LA PILA. `pedir` llama a `fetch` SINCRONAMENTE desde su propio cuerpo
 * —`respuesta = await fetch(...)`, el `await` es sobre el resultado, no sobre la
 * llamada—, asi que un `new Error().stack` leido dentro del envoltorio trae
 * `at pedir (…/src/lib/cliente.ts:56)` como SEGUNDO marco. Medido en este
 * entorno, con el camino entero: `sonda → pedir → queryFn → @tanstack/query`.
 * Lo que no sale de ahi dentro no es `pedir`, diga lo que diga su URL.
 *
 * Y NO SE PUEDE BURLAR SIN QUERER porque para parecer legitima una peticion
 * tiene que estar ESCRITA DENTRO DE `lib/cliente.ts`, que son ochenta lineas que
 * se revisan de un vistazo y cuyo docblock es justamente la regla. No hay forma
 * de escribir por descuido una linea en otro archivo que aparezca con ese marco
 * en la pila. Lo contrario —una peticion legitima que la pila NO reconozca— es
 * el modo de fallo barato: seria roja y se ve.
 *
 * (Las barras se normalizan antes de buscar: en Windows la pila dice
 * `D:\…\src\lib\cliente.ts` y en CI `/…/src/lib/cliente.ts`. Buscar la forma de
 * una sola plataforma es la manera de que esto quede verde y ciego en la otra, y
 * asi empezo esta medida: la primera sonda dio «ninguna peticion paso por
 * `pedir`» en las 467 del paquete, y la culpa era de la barra.)
 *
 * ---------------------------------------------------------------------------
 * LA FORMA ES POR CENTINELAS Y NO LA FUERTE, Y ESO SE MIDIO EN LOS 74 SPECS.
 *
 * La pregunta de la forma fuerte —«ni una peticion por fuera de `pedir`», que es
 * lo que afirman las tres copias a mano— se contesto con una sonda sobre el
 * paquete entero, no leyendo. De las 467 peticiones que los 74 specs hacen,
 * 371 salen de `pedir` y **96 NO**, y vienen de CINCO SITIOS DE PRODUCCION que
 * estan ahi a proposito y con su motivo escrito:
 *
 *  - `[slug]/page.tsx` (74) habla con la API PUBLICA directamente, desde el
 *    servidor y con `credentials: 'omit'`: el proxy existe para poner la cookie
 *    y aqui no hay cookie que poner. Su propio spec lo fija.
 *  - `formulario-de-login.tsx` (9) y `formulario-de-registro.tsx` (4) llaman a
 *    `/api/auth/…`, que son las rutas del BFF que ESCRIBEN la cookie httpOnly.
 *    No pueden pasar por `pedir`, que va a `/api/bx`.
 *  - `boton-de-salir.tsx` (3) llama a `/api/auth/logout`, por lo mismo.
 *  - `use-comprobantes.ts` (6) hace un `PUT` del archivo crudo a la URL firmada
 *    del almacen. Mandar un archivo por el proxy seria absurdo.
 *
 * O sea que la frase con la que se abria `lib/cliente.ts` —«el unico fetch del
 * navegador en toda la aplicacion»— YA NO ERA CIERTA, y no por una fuga: por
 * cuatro decisiones de diseño tomadas despues. (Esto se cerro: la frase esta
 * corregida y las excepciones las CUENTA `lib/el-unico-fetch.spec.ts`, que lee
 * `src/` entero en vez de medir trafico — y por eso encuentra diez archivos y
 * no cinco: los seis del servidor no los ejecuta ningun spec de jsdom.) Lo que
 * sigue valiendo es el razonamiento de abajo. Una forma fuerte global seria
 * roja con el codigo correcto en cinco specs, y la unica manera de sostenerla
 * seria una LISTA BLANCA DE DESTINOS —`/api/auth`, el almacen, la API publica—,
 * que es el patron contra el que este repo predica puesto en infraestructura
 * que comparten 74 specs: se queda vieja sola y el dia que alguien agregue un
 * destino legitimo lo que se agranda es el agujero.
 *
 * Asi que se afirma POR CENTINELAS, como el `src` de una imagen, las tres
 * salidas laterales y el service worker, y por el mismo motivo que ahi: hablar
 * con la red es legitimo y este producto ya lo hace por cinco sitios. Lo que no
 * es legitimo es que la peticion lleve un dato del mostrador dentro.
 *
 * LO QUE ESO DEJA FUERA, dicho sin adornar: un `fetch` a otro origen que NO
 * lleve ningun centinela —una traza de uso con la forma de la pantalla, sin
 * nombres— pasa en verde. Es el precio exacto de la medida de arriba, es el
 * mismo precio que pagan los canales 7, 8 y 10, y es la razon por la que LAS
 * TRES COPIAS A MANO SE QUEDAN donde estan: en esos tres specs `pedir` esta
 * doblado, no hay ni una peticion legitima, y ahi la forma fuerte sale gratis y
 * caza ademas el dato que nadie registro. Lo global y lo local no se tapan: lo
 * global cubre los 74 con centinelas, lo local cubre tres con la forma fuerte.
 *
 * ---------------------------------------------------------------------------
 * SE MIRAN LAS DOS MITADES DE CADA PETICION: EL DESTINO Y LA CARGA.
 *
 * No es lo mismo que pasen por el mismo sitio, igual que en la baliza: un dato
 * en el query sale al REGISTRO DE ACCESO del servidor del otro lado —que no es
 * nuestro y que se guarda por defecto— y uno en el cuerpo sale en la peticion.
 * La carga incluye LAS CABECERAS, que es donde acaba un dato que alguien mete
 * en un `x-contexto` «para depurar», y el cuerpo se desmenuza con
 * `cuerpoDeUnaBaliza`, que ya sabe leer un `URLSearchParams`, un `FormData`, un
 * `ArrayBuffer` y un `Blob`.
 *
 * LO QUE LA CARGA NO VE: el cuerpo de un `new Request(url, { body })` pasado
 * como primer argumento. `Request.body` es un flujo y solo se lee con una
 * promesa; mirarlo obligaria a volver asincrono el `afterEach` entero, que
 * tiene un orden delicado con `cleanup()`. El DESTINO de ese `Request` si se
 * mira, y nadie en `src/` construye uno.
 *
 * ---------------------------------------------------------------------------
 * LAS CUATRO PUERTAS, Y POR QUE ESTAS CUATRO. MEDIDO EN JSDOM 26:
 *
 *   fetch          function      XMLHttpRequest  function
 *   WebSocket      function      EventSource     undefined
 *   Worker         undefined     SharedWorker    undefined
 *   RTCPeerConnection undefined
 *
 * - `fetch`. La puerta del canal.
 * - `XMLHttpRequest`. EXISTE ENTERO en jsdom, asi que no hay ningun `?.` que
 *   delate la fuga: la linea corre igual en el test y en el navegador, como los
 *   atributos del `<html>`. Y es literalmente lo primero que escribe quien se
 *   encuentra con que `fetch` esta vigilado. Cubrir `fetch` y no esto seria
 *   reabrir el canal entero cambiando una palabra, que es el argumento de
 *   `mark` sin `measure`.
 * - `WebSocket`. Existe en jsdom y MARCA DE VERDAD: `new WebSocket(url)` abre un
 *   socket contra el destino. La URL y cada `send` llevan dato, y «avisos en
 *   vivo» o «el chat de soporte» son features que alguien escribe de buena fe.
 * - `EventSource`. NO existe en jsdom, que es justo el caso de `sendBeacon`, de
 *   `caches`, de `serviceWorker` y de IndexedDB: a pelo revienta y el test cae
 *   solo, pero la forma prudente —`if ('EventSource' in window)`— NO HACE NADA y
 *   pasa en verde mientras en el mostrador abre el flujo. Se DEFINE, como las
 *   otras cuatro, y el precio es el de siempre: la deteccion de capacidades ve
 *   una puerta que jsdom no tiene. Hoy no la pregunta nadie —cero
 *   `EventSource`, cero `WebSocket` y cero `XMLHttpRequest` en `src/`— y el
 *   cambio acerca el entorno al navegador en vez de alejarlo.
 *
 * LAS TRES ULTIMAS SE AFIRMAN POR LA FORMA FUERTE —ni una peticion— y no por
 * centinelas, al reves que `fetch`, y por la misma medida que IndexedDB y los
 * atributos del `<html>`: el producto no tiene NINGUN uso legitimo de esas tres
 * puertas, y nada del arbol de dependencias las toca durante un test. Donde no
 * hay uso legitimo que proteger, la forma fuerte es gratis y caza ademas el dato
 * que nadie registro.
 *
 * LO QUE SE QUEDA FUERA, ESCRITO AQUI PARA QUE NADIE LO DESCUBRA CREYENDO QUE
 * ESTO LO TAPABA —un limite escrito es una defensa; un limite tacito es una
 * trampa para el que venga—:
 *
 *  - `navigator.sendBeacon`. No falta: es la tercera puerta del OCTAVO canal,
 *    que la define y la mira entera. Se nombra aqui para que nadie la agregue
 *    dos veces.
 *  - EL `src` DE UNA IMAGEN. Tampoco falta: es el SEPTIMO canal.
 *  - LAS PETICIONES QUE NACEN DEL DOM: `<link rel="prefetch">`, `<script src>`,
 *    `<iframe src>`, `<video src>`. No pasan por ninguna funcion que se pueda
 *    doblar —las dispara el parser al insertar el nodo— y jsdom no las pide. Un
 *    `<link>` cae de refilon por el CUARTO canal, que afirma que la pantalla no
 *    metio NI UN nodo nuevo en el `<head>`; un `<iframe>` o un `<script>` en el
 *    `<body>` no los ve nadie. Para cerrarlo habria que barrer el documento
 *    entero por atributos de URL al terminar, que es un canal propio y no este.
 *  - WEBRTC (`RTCPeerConnection` y sus canales de datos). Es `undefined` en
 *    jsdom, o sea que valdria el argumento de `EventSource`. No entra por el
 *    OTRO criterio, el que este archivo ya usa para el alfabeto: se cubre lo
 *    que alguien escribiria SIN MALA INTENCION. Nadie abre una conexion WebRTC
 *    para mandar una metrica. Contra una fuga deliberada no hay defensa
 *    razonable, y el que quiera sacar un dato tiene caminos mas baratos que
 *    montar un par de ICE.
 *
 * ---------------------------------------------------------------------------
 * LAS DOS PUERTAS QUE SE AGREGARON DESPUES, Y EL AGUJERO QUE CIERRAN A MEDIAS:
 * `Worker` Y `SharedWorker`.
 *
 * Estaban en la lista de arriba, junto a WebRTC, con el argumento de «nadie
 * monta un hilo para mandar una metrica». LA MEDIDA QUE LO CAMBIO no es esa
 * frase sino otra, y es del propio canal: **UN `fetch` HECHO DENTRO DE UN
 * WORKER NO PASA POR EL `fetch` QUE ESTE CANAL DOBLA**, porque el worker tiene
 * su propio global y su propio `fetch`. O sea que `Worker` no es «una puerta
 * mas que nadie usa»: es LA FORMA DE APAGAR LA PUERTA PRINCIPAL. El canal
 * decimocuarto podia estar entero y la peticion salir igual.
 *
 * Y `Worker` es `undefined` en jsdom —medido, igual que `EventSource`—, asi que
 * el agujero tiene la forma de siempre: `new Worker(…)` a pelo revienta y el
 * test cae, pero detras de un `if ('Worker' in window)` no hace nada y pasa en
 * verde mientras en el mostrador levanta un hilo de verdad.
 *
 * ESTE ES EXACTAMENTE EL CASO DEL DECIMO CANAL, VISTO EN UN HILO SIN REGISTRAR.
 * Alli ya esta escrito el razonamiento entero, palabra por palabra: «mandarle
 * un dato es sacarlo del alcance de los otros nueve tapones de un salto: el
 * `caches` que se vigila es el que abre LA PAGINA, y el que abriria el worker
 * con este mensaje no lo ve nadie». Un `Worker` corriente es el mismo hilo con
 * el mismo origen y las mismas capacidades —`fetch`, `caches`, IndexedDB,
 * OPFS—; lo unico que cambia es que no hay que registrarlo. Si aquello merecia
 * un canal, esto merece dos puertas.
 *
 * SE CUBRE LA FRONTERA, QUE ES POR DONDE EL DATO TIENE QUE PASAR, Y SON DOS
 * SITIOS:
 *
 *  - EL SCRIPT. `new Worker(url)` es, literalmente, UNA PETICION DE RED: el
 *    navegador baja ese script. Por eso estas dos puertas viven en este canal
 *    y no en uno nuevo. Y la URL lleva dato igual que cualquier otra —un
 *    `new Worker('/w.js?d=' + datos)` lo publica sin mandar un solo mensaje—.
 *  - LOS MENSAJES. `worker.postMessage(datos)` para un `Worker` y
 *    `worker.port.postMessage(datos)` para un `SharedWorker`, que son LAS DOS
 *    formas de meterle un dato de esta pagina a ese hilo.
 *
 * LO QUE NO SE CUBRE, Y ES EL LIMITE QUE HAY QUE ESCRIBIR PARA QUE NADIE LEA
 * EL VERDE COMO «LOS WORKERS ESTAN TAPADOS»: **LO QUE EL SCRIPT DEL WORKER
 * HAGA POR SU CUENTA**. El doble de abajo REGISTRA Y NO EJECUTA: no baja el
 * script, no lo corre y no tiene dentro ningun `fetch` que doblar. Un worker
 * que se trajera el dato el solo —pidiendoselo a la API con la cookie de
 * sesion— y lo mandara fuera desde su propio hilo no lo ve nadie aqui.
 *
 * Y NO SE EJECUTA A PROPOSITO, que es la parte que no es pereza. Hacer que el
 * doble CORRA el script pide escribir un entorno de worker entero —otro global,
 * otro `fetch`, otro `postMessage`, otro ciclo de vida— y entonces lo que el
 * canal mediria no es lo que hace la pantalla sino lo que hace NUESTRO DOBLE:
 * es el mismo motivo por el que la base de mentira de IndexedDB no inventa
 * registros y por el que el tapon de la URL no fabrica un `Location`. Ademas
 * esa fuga ya no cabe en el criterio del alfabeto: escribir un segundo archivo,
 * que ese archivo pida los datos por su cuenta y los mande a otro sitio no es
 * un descuido de nadie, es un plan. Lo que SI es un descuido —«lo mando al
 * worker para no bloquear la interfaz»— pasa por la frontera, y la frontera se
 * mira entera.
 *
 * SE AFIRMAN POR LA FORMA FUERTE, como las otras tres que no son `fetch`, y
 * por la misma medida: cero `Worker` y cero `SharedWorker` en `apps/web/src`,
 * y con las dos puertas puestas los 80 specs siguen en verde, o sea que nadie
 * del arbol de dependencias levanta un hilo durante un test.
 */
type PuertaDeRed =
  'fetch' | 'XMLHttpRequest' | 'WebSocket' | 'EventSource' | 'Worker' | 'SharedWorker';

/** Una peticion de red vista por el espia. */
interface PeticionDeRed {
  puerta: PuertaDeRed;
  /** `GET`, `POST`, `send`… o vacio cuando la puerta no tiene metodo. */
  metodo: string;
  destino: string;
  /** Cabeceras y cuerpo, en texto, para buscar centinelas dentro. */
  carga: string;
  /** Si la llamada salio de DENTRO de `pedir`. Ver el docblock de arriba. */
  dePedir: boolean;
}

/** El archivo donde vive el unico `fetch` legitimo del navegador. */
const PEDIR_VIVE_EN = '/src/lib/cliente.ts';

/**
 * Si quien esta llamando a `fetch` es `pedir`, leyendo la pila.
 *
 * SE EXPORTA SOLO PARA SU GUARDIAN, `red-por-fuera-de-pedir.spec.ts`, por el
 * mismo motivo por el que se exporta `formaQueSeFue`: si esto empezara a
 * devolver `true` siempre, los 74 specs seguirian en verde y el canal se
 * quedaria ciego sin que nadie se entere. La unica forma de custodiarlo es
 * medirlo. Ningun spec de pantalla lo llama.
 */
export function vinoDePedir(pila: string): boolean {
  // Las barras al derecho: en Windows la pila dice `D:\…\src\lib\cliente.ts` y
  // en CI `/…/src/lib/cliente.ts`. Buscar una sola forma deja el canal verde y
  // ciego en la otra plataforma, que es como empezo esta medida.
  return pila.replace(/\\/g, '/').includes(PEDIR_VIVE_EN);
}

/**
 * LAS CUATRO PUERTAS DE VERDAD, cogidas UNA VEZ al cargar.
 *
 * Por la leccion de las galletas, del `src` de una imagen y de la History API:
 * leerlas desde dentro del `beforeEach`, despues del primer enganche,
 * envolveria el envoltorio de ayer y contaria cada peticion tantas veces como
 * tests lleve el archivo.
 */
const RED_ORIGINAL = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
const WEBSOCKET_ORIGINAL = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');
const EVENT_SOURCE_ORIGINAL = Object.getOwnPropertyDescriptor(globalThis, 'EventSource');
const WORKER_ORIGINAL = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
const SHARED_WORKER_ORIGINAL = Object.getOwnPropertyDescriptor(globalThis, 'SharedWorker');
const ABRIR_UN_XHR = XMLHttpRequest.prototype.open;

/** Lo que un `open()` dejo dicho, hasta que llegue su `send()`. */
const XHR_ABIERTO = new WeakMap<XMLHttpRequest, { metodo: string; destino: string }>();

/**
 * LAS PETICIONES DEL TEST EN CURSO, Y VIVEN EN EL MODULO Y NO EN EL TAPON.
 *
 * Es la unica lista de este archivo que no esta dentro de
 * `vigilarLosCanalesDeSalida`, y tiene que estarlo: el envoltorio de `fetch` se
 * fabrica UNA VEZ al cargar el modulo —lo necesita el enganche de
 * `vi.stubGlobal` de aqui abajo, que corre antes que cualquier hook— y escribe
 * aqui. El tapon la vacia en cada `beforeEach`, como vacia las suyas.
 */
const PETICIONES_DE_RED: PeticionDeRed[] = [];

type Red = (...partes: unknown[]) => unknown;

/** El doble que instalo el spec, si lo instalo. Ver el enganche de abajo. */
let elDobleDeLaRed: Red | undefined;

/** El metodo de una peticion, mire donde mire quien la escribio. */
function metodoDeUnFetch(que: unknown, opciones: unknown): string {
  if (typeof opciones === 'object' && opciones !== null) {
    const pedido = (opciones as { method?: unknown }).method;
    if (typeof pedido === 'string' && pedido !== '') return pedido.toUpperCase();
  }

  if (typeof que === 'object' && que !== null && 'method' in que) {
    return String((que as { method: unknown }).method).toUpperCase();
  }

  return 'GET';
}

/** Las cabeceras en texto: ahi acaba el dato que alguien mete en un `x-contexto`. */
function textoDeLasCabeceras(cabeceras: unknown): string {
  if (cabeceras === undefined || cabeceras === null) return '';

  if (typeof Headers === 'function' && cabeceras instanceof Headers) {
    return [...cabeceras.entries()].map(([nombre, valor]) => `${nombre}=${valor}`).join(' ');
  }

  if (Array.isArray(cabeceras)) {
    return cabeceras.map((par) => (Array.isArray(par) ? par.join('=') : String(par))).join(' ');
  }

  if (typeof cabeceras === 'object') {
    return Object.entries(cabeceras as Record<string, unknown>)
      .map(([nombre, valor]) => `${nombre}=${String(valor)}`)
      .join(' ');
  }

  return String(cabeceras);
}

/** Lo que una peticion lleva ademas del destino: cabeceras y cuerpo. */
function cargaDeUnFetch(que: unknown, opciones: unknown): string {
  const partes: string[] = [];

  if (typeof Request === 'function' && que instanceof Request) {
    partes.push(textoDeLasCabeceras(que.headers));
  }

  if (typeof opciones === 'object' && opciones !== null) {
    const init = opciones as { headers?: unknown; body?: unknown };
    partes.push(textoDeLasCabeceras(init.headers));
    // El mismo desmenuzador que la baliza: sabe leer `URLSearchParams`,
    // `FormData`, `ArrayBuffer` y `Blob`, que es por donde se va un cuerpo que
    // un `JSON.stringify` dejaria en `{}`.
    partes.push(cuerpoDeUnaBaliza(init.body));
  }

  return partes.join(' ');
}

/**
 * COMO NOMBRAR EL DESTINO DE UNA PETICION SIN PUBLICARLO.
 *
 * Es la decision de informe de este canal, y la regla de todo el archivo
 * llevada a su caso mas dificil: EL DESTINO ES DONDE VIVE LA FUGA. Un
 * `…/uso.gif?d=${JSON.stringify(datos)}` lleva el reporte entero en el query, y
 * un mensaje de fallo que copiara la URL mandaria el dato al registro de CI
 * —que lo guarda mas tiempo y lo lee mas gente que la consola del mostrador—,
 * que es exactamente el modo de fallo que este archivo evita desde la primera
 * linea.
 *
 * SE NOMBRA EL ORIGEN Y NUNCA LA RUTA NI EL QUERY. El origen ubica la fuga
 * —`https://analitica.ejemplo.com` dice todo lo que hace falta para ir a
 * buscarla con un `git diff`— y es la parte de la URL que NO puede llevar un
 * volcado dentro: lo que se mete en una URL de fuga va en el query o en la
 * ruta. Y pasa igualmente por `claveSegura`, como las claves de los almacenes y
 * los nombres de las bases, por si alguien escondio el dato en un subdominio.
 *
 * Y para el mismo origen no se dice ni el origen: `el proxy del panel` cuando
 * va a `/api/bx…` —una peticion escrita a mano contra el proxy, que es la
 * mutacion que `ausencias` midio— y `el mismo origen` para el resto. Vocabulario
 * fijo, como `hash`, `replaceState` o `<meta>`.
 */
function haciaDondeVa(destino: string): string {
  let url: URL;

  try {
    url = new URL(destino, window.location.href);
  } catch {
    return 'una URL que no se puede leer';
  }

  if (url.origin !== window.location.origin) return claveSegura(url.origin);
  if (url.pathname.startsWith('/api/bx')) return 'el proxy del panel';

  return 'el mismo origen';
}

/** Como se nombra una peticion en el informe: la puerta, el metodo y el origen. */
function laPuertaDe(peticion: PeticionDeRed): string {
  const metodo = peticion.metodo === '' ? '' : ` ${peticion.metodo}`;

  return `${peticion.puerta}${metodo} hacia ${haciaDondeVa(peticion.destino)}`;
}

/**
 * EL ENVOLTORIO DE `fetch`: UNO SOLO, DE MODULO, Y REGISTRA Y DEJA PASAR.
 *
 * Reenvia al doble que instalo el spec cuando lo hay, para que todas las
 * afirmaciones que los specs hacen sobre SU doble —`llamada(doble, 0)`,
 * `expect(doble).toHaveBeenCalled()`— sigan viendo exactamente lo que veian.
 *
 * Y CUANDO NO HAY DOBLE, CONTESTA UN 200 CON JSON en vez de reenviar al `fetch`
 * de verdad o devolver `undefined`. Las dos cosas importan y las dos vienen
 * medidas de las copias a mano, que ya se las habian ganado a los golpes:
 * reenviar al de verdad abriria una conexion de red desde un test, y devolver
 * `undefined` haria que una peticion clandestina muriera en un `TypeError` al
 * encadenarle un `.catch` —un fallo que apunta al sitio equivocado— en vez de
 * caer por la afirmacion de abajo, que dice QUE se fue y POR DONDE.
 */
const LA_RED: Red = function (this: unknown, ...partes: unknown[]) {
  const [que, opciones] = partes;

  PETICIONES_DE_RED.push({
    puerta: 'fetch',
    metodo: metodoDeUnFetch(que, opciones),
    destino: claveDeUnaPeticion(que),
    carga: cargaDeUnFetch(que, opciones),
    dePedir: vinoDePedir(new Error().stack ?? ''),
  });

  if (elDobleDeLaRed !== undefined) return elDobleDeLaRed.apply(this, partes);

  return Promise.resolve(
    new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
  );
};

/**
 * LA PUERTA TIENE DOS ENTRADAS, Y LA SEGUNDA ES `vi.stubGlobal('fetch', …)`.
 *
 * Esto no es un adorno: es lo que decide si el canal sirve. MEDIDO sobre el
 * paquete entero: las 467 peticiones de los 74 specs pasan por un doble que el
 * spec instalo con `vi.stubGlobal`, NI UNA por el `fetch` del entorno. O sea
 * que el enganche del `beforeEach`, solo, estaria ciego en los 23 specs donde
 * de verdad corre el `pedir` de produccion — que son los unicos donde hay
 * trafico que vigilar.
 *
 * Y NO SE PUEDE SOBREVIVIR DE OTRA FORMA, tambien medido en la fuente de Vitest
 * 3.2.7: `stubGlobal` hace `Object.defineProperty(globalThis, nombre, { value })`,
 * que SUSTITUYE el descriptor entero. Un accesor con `get`/`set` —la forma con
 * la que este archivo engancha las galletas y el `src` de una imagen— no
 * sobrevive. Y no hay ningun hook que corra DESPUES del `beforeEach` del spec:
 * Vitest corre los `beforeEach` en orden de registro, asi que el de este archivo
 * va siempre primero. O se engancha la funcion que instala el doble, o el canal
 * vive apagado justo donde hace falta.
 *
 * SE ENGANCHA UNA VEZ, AL CARGAR EL MODULO, y no desde el tapon: el modulo se
 * carga una sola vez por archivo de test, antes de cualquier hook y antes del
 * cuerpo del spec, que es donde algunos instalan su doble.
 *
 * NO LE CAMBIA NADA AL SPEC. El doble que el spec guarda en su variable sigue
 * recibiendo cada llamada, con los mismos argumentos y devolviendo lo suyo; lo
 * unico que cambia es que `globalThis.fetch` pasa a ser el envoltorio, que
 * registra y reenvia. Medido: los 1645 tests siguen en verde con esto puesto.
 *
 * EL LIMITE, ESCRITO: un spec que instalara su doble con una ASIGNACION a pelo
 * —`globalThis.fetch = doble`— en vez de con `vi.stubGlobal` le pasaria por
 * encima al envoltorio dentro de ese test. Medido: no lo hace ninguno de los
 * 74. Y no es el modo de fallo que importa, porque lo que este canal persigue
 * es codigo de PRODUCCION, que no instala dobles.
 */
const PONER_UN_GLOBAL = vi.stubGlobal.bind(vi) as (nombre: unknown, valor: unknown) => unknown;

(vi as unknown as { stubGlobal: (nombre: unknown, valor: unknown) => unknown }).stubGlobal = (
  nombre: unknown,
  valor: unknown,
) => {
  if (nombre !== 'fetch' || typeof valor !== 'function') return PONER_UN_GLOBAL(nombre, valor);

  elDobleDeLaRed = valor as Red;

  return PONER_UN_GLOBAL('fetch', LA_RED);
};

/**
 * Un `WebSocket`, un `EventSource`, un `Worker` o un `SharedWorker` de mentira:
 * ANOTA Y NO CONECTA.
 *
 * No reenvia a nada, como la baliza y como `caches`, y por un motivo ademas del
 * de ellos: el `WebSocket` de jsdom MARCA DE VERDAD contra el destino. Dejarlo
 * pasar seria abrir un socket desde un test. Para las dos puertas de hilo el
 * motivo es el otro, y esta escrito entero en el docblock de `PuertaDeRed`: el
 * doble REGISTRA Y NO EJECUTA, porque ejecutar el script pedia inventar un
 * entorno de worker y entonces el canal mediria nuestro doble.
 *
 * LAS CUATRO FORMAS DE HABLAR POR UNA DE ESTAS PUERTAS ESTAN TODAS AQUI, y
 * cuestan una linea cada una: el DESTINO, que lo anota el constructor —y que
 * para un worker es el script que el navegador baja, o sea una peticion de red
 * de verdad—, el `send` de un socket, el `postMessage` de un `Worker` y el
 * `port.postMessage` de un `SharedWorker`, que es la unica forma de hablarle a
 * ese. Cubrir unas y no otras seria reabrir la puerta cambiando una palabra,
 * que es el argumento de `mark` sin `measure`.
 */
function conexionDeMentira(puerta: PuertaDeRed) {
  return class {
    readonly url: string;
    readonly readyState = 0;
    /** La unica boca de un `SharedWorker`: `worker.port.postMessage(datos)`. */
    readonly port: Record<string, unknown>;

    constructor(destino: unknown) {
      this.url = String(destino);

      PETICIONES_DE_RED.push({
        puerta,
        metodo: '',
        destino: this.url,
        carga: '',
        dePedir: false,
      });

      this.port = {
        postMessage: (datos: unknown) => {
          this.anotar('port.postMessage', datos);
        },
        start: () => {},
        close: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
      };
    }

    private anotar(metodo: string, datos: unknown): void {
      PETICIONES_DE_RED.push({
        puerta,
        metodo,
        destino: this.url,
        carga: cuerpoDeUnaBaliza(datos),
        dePedir: false,
      });
    }

    /** `EventSource` no lo tiene; se deja igual, que cuesta una linea. */
    send(datos: unknown): void {
      this.anotar('send', datos);
    }

    /** La boca de un `Worker`, y la forma de meterle un dato de esta pagina. */
    postMessage(datos: unknown): void {
      this.anotar('postMessage', datos);
    }

    terminate(): void {}
    close(): void {}
    addEventListener(): void {}
    removeEventListener(): void {}
  };
}

// ---------------------------------------------------------------------------
// El decimoquinto canal: lo que el `<body>` LLEVA y el marcado NO SERIALIZA
// ---------------------------------------------------------------------------

/**
 * EL HUECO ENTRE LAS DOS DEFENSAS, POR DENTRO DEL `<body>` ESTA VEZ.
 *
 * El reparto de este repo era: los CATORCE canales de arriba miran todo lo que
 * NO es el `<body>`, y los tests de pantalla miran el `<body>` leyendo
 * `document.body.innerHTML` y `textContent`. ENTRE LOS DOS SE CUELA LO QUE EL
 * MARCADO NO SERIALIZA: hay cosas que estan en la pagina, se pintan, se
 * autocompletan, viajan en un envio de formulario y las lee cualquier
 * extension del navegador, y que NO aparecen en ningun `innerHTML` ni en
 * ningun `textContent`.
 *
 * Es el mismo sitio que la URL del documento ocupaba para el decimotercer
 * canal —ni de un lado ni del otro— pero por dentro del cuerpo en vez de por
 * fuera.
 *
 * ---------------------------------------------------------------------------
 * LO QUE SE CUBRE, Y EL CRITERIO: ¿PUEDE LLEVAR UN NOMBRE DENTRO?
 *
 *  - **EL `.value` DE UN CONTROL.** El `value` IDL de un control es una
 *    PROPIEDAD del nodo. Para los tipos en «modo valor» —`text`, `password`,
 *    `search`, `tel`, `url`, `email`, `number`, `date`…— y para `<textarea>`,
 *    asignarlo NO toca el atributo: el dato queda en la pagina y fuera del
 *    marcado.
 *
 *  - **UN `shadowRoot` ABIERTO.** El contenido de un shadow root no entra en
 *    el `innerHTML` de su anfitrion ni en su `textContent`, y
 *    `document.body.querySelectorAll('*')` NO desciende a el —medido: con un
 *    `<p>` dentro de la sombra, la barrida del cuerpo devuelve 8 nodos y el
 *    `<p>` no esta—. Es la otra mitad del mismo agujero, con la diferencia de
 *    que ahi cabe un arbol entero y no una cadena.
 *
 * ---------------------------------------------------------------------------
 * LO QUE MOTIVO ESTO, Y LA CORRECCION QUE SALIO DE MEDIRLO.
 *
 * La mutacion que lo abrio, en la pantalla de pasar lista:
 *
 *     const caja = useRef<HTMLInputElement>(null);
 *     useEffect(() => {
 *       // «un respaldo por si se recarga la pestaña a mitad del repaso»
 *       if (caja.current !== null) caja.current.value = JSON.stringify(alumnos);
 *     }, [alumnos]);
 *     …
 *     <input type="hidden" ref={caja} />
 *
 * donde `alumnos` lleva el nombre propio, el `perfilId` y la ausencia de cada
 * persona de la clase.
 *
 * ⚠️ **CON `type="hidden"` ESA MUTACION NO SE ESCAPA, Y ESO ESTA MEDIDO Y NO
 * LEIDO.** `type="hidden"` no esta en «modo valor» sino en MODO DEFECTO: su
 * `.value` es un REFLEJO del atributo `value`, asi que asignarlo escribe el
 * atributo y el dato sale entero en el `innerHTML`. Medido aplicando esa misma
 * mutacion a la agenda —`(profesor)/mis-clases/page.tsx`—: el test «ni un
 * nombre ni un perfilId de los alumnos llega al marcado» CAE, y el informe
 * imprime el `value="[{&quot;perfilId&quot;…"` del `<input type="hidden">`
 * entero. La sonda, tipo por tipo en jsdom 26 —`true` = el `innerHTML` lo ve—:
 *
 *     input (sin tipo) false   input[text]     false   input[password] false
 *     textarea          false   input[hidden]   TRUE    input[checkbox] TRUE
 *     input[radio]      TRUE    input[submit]   TRUE    input[button]   TRUE
 *     input[image]      TRUE    input[reset]    TRUE    button          TRUE
 *     output            TRUE    data            TRUE    option          TRUE
 *
 * O SEA QUE EL AGUJERO ES REAL PERO NO DONDE SE CREIA: la misma mutacion con
 * `<input type="text" readOnly>` o con `<textarea readOnly>` paso los 20 tests
 * de la agenda, el de marcado incluido. Lo que se escapa es el `.value` que no
 * se refleja, no el `<input>` escondido.
 *
 * NO SE ENUMERAN LOS TIPOS, a proposito. Se mira TODO `.value` que sea una
 * cadena, venga de donde venga, por el mismo motivo por el que la consola se
 * vigila entera y no con cinco nombres a mano: una lista de tipos es una lista
 * negra, y el dia que alguien escriba `type="search"` el tapon seguiria en
 * verde diciendo otra cosa. Los tipos que SI reflejan pasan por aqui y no
 * molestan: lo que llevan ya esta en el marcado, y la resta de abajo los deja
 * fuera del informe sola.
 *
 * ---------------------------------------------------------------------------
 * LA RESTA: SE AFIRMA QUE NO HAY NINGUNO **ESCONDIDO**, NO QUE NO HAYA
 * NINGUNO.
 *
 * Esta es la decision que hace que el canal sea usable, y no es una suavizada:
 * es la definicion misma de lo que se vigila. Una pantalla de edicion pinta
 * `<input value={persona.nombreCompleto}>` y eso es su trabajo; React escribe
 * ahi el atributo Y la propiedad, asi que el nombre esta en el `.value` Y en
 * el `innerHTML`. Afirmar «ningun centinela en ningun `.value`» seria rojo con
 * el codigo correcto en media docena de specs del panel, y un canal que se
 * pone rojo con el codigo correcto es de los que alguien desactiva.
 *
 * Lo que se afirma, entonces, es lo mismo que afirma el test que descubrio
 * esto: que el dato no este AGAZAPADO. Un centinela solo cuenta como fuga si
 * esta en un sitio no serializado Y NO ESTA en lo que el marcado publica. El
 * dato puede estar a la vista —ahi lo miran los tests de pantalla, que es el
 * otro lado del reparto—; lo que no puede es estar donde no mira ningun
 * instrumento.
 *
 * Y la resta no afloja nada del otro lado: la mutacion del `type="hidden"`
 * sigue cayendo, pero por donde le toca —el test de marcado de su pantalla—,
 * que es exactamente el reparto funcionando.
 *
 * TAMPOCO SE AFIRMA LA FORMA FUERTE («ni un sitio no serializado con algo
 * dentro»), y por lo mismo: el panel esta lleno de formularios y casi toda
 * casilla trae un `.value` de `'on'`. Donde `window.name`, IndexedDB y los
 * atributos del `<html>` no tienen un solo uso legitimo, este sitio SI lo
 * tiene y lo tiene por todas partes.
 *
 * ---------------------------------------------------------------------------
 * LO QUE SE QUEDA FUERA, DICHO AQUI PARA QUE NADIE LO DESCUBRA CREYENDO QUE
 * ESTO LO TAPABA —un limite escrito es una defensa; un limite tacito es una
 * trampa para el que venga—:
 *
 *  - **`.checked`, `.indeterminate`, `.selectedIndex`, `.valueAsNumber`.** No
 *    es que sean caros: es que NO PUEDEN LLEVAR EL DATO. Un booleano no tiene
 *    un nombre dentro y un entero tampoco, y un centinela no cabe en ninguno
 *    de los dos. Cubrirlos seria recorrer mas propiedades para buscar cadenas
 *    donde no hay cadenas: ruido con forma de rigor. (La AUSENCIA de alguien
 *    SI es un dato, y es el que la pantalla de pasar lista cuida — pero esa se
 *    lee en el `data-alumno` y el `checked` del marcado, que `innerHTML` SI
 *    serializa, y eso lo mira el spec de esa pantalla.)
 *
 *  - **`dataset`.** NO entra, y no por criterio sino porque esta MEDIDO que no
 *    hace falta: `dataset` se refleja a atributos `data-*`, asi que el marcado
 *    ya lo publica. Sonda: `div.dataset.loMio = 'DATASET-VALOR'` deja
 *    `<div data-lo-mio="DATASET-VALOR">` y `document.body.innerHTML` lo ve.
 *    Esto se comprobo en vez de darlo por hecho justamente porque «es una
 *    propiedad del nodo» suena a que no se serializa, y aqui si.
 *
 *  - **UN `shadowRoot` CERRADO.** Con `attachShadow({ mode: 'closed' })`,
 *    `host.shadowRoot` vale `null` —medido— y no hay forma de alcanzarlo desde
 *    fuera: no es una decision, es la plataforma. Queda escrito para que nadie
 *    lea el verde de este canal como «tampoco hay nada en una sombra cerrada».
 *    El consuelo es que no hay un solo `attachShadow` en `src/`, asi que hoy
 *    la puerta no esta ni abierta ni cerrada: no existe.
 *
 *  - **LOS INTERNOS DE REACT (`__reactProps$…`, `__reactFiber$…`).** Es la
 *    decision menos obvia de la lista y por eso va argumentada por los dos
 *    lados. A FAVOR de cubrirlos: existen de verdad —son propiedades propias
 *    del nodo, medido—, el `__reactProps$` de cualquier control lleva dentro
 *    el `value` y el `onChange` que la pantalla le paso, y nada de eso se
 *    serializa. EN CONTRA, y es lo que decide: NO LOS ESCRIBE UNA PANTALLA.
 *    Los pone React en cada nodo que monta, con lo que el JSX dijo, siempre,
 *    en los 76 specs — o sea que su contenido es una SOMBRA de lo que la
 *    pantalla ya pinta y no un sitio donde alguien pueda esconder algo: no hay
 *    forma de escribir ahi que no sea escribir en el marcado. Cubrirlos
 *    convertiria el canal en «el `.value` de cada control, otra vez, mas el
 *    arbol de props entero», con el coste de serializar objetos circulares en
 *    cada `afterEach` y la garantia de pisar la resta con falsos positivos en
 *    cuanto React cambie de forma. Y la nota fea, por si alguien quiere
 *    revisarlo: cubrir un interno del framework es atarse a un detalle de la
 *    version, que es lo contrario de lo que hace el resto de este archivo
 *    —doblar PUERTAS de la plataforma, no tripas de nadie—.
 *
 *  - **`.files` DE UN `<input type="file">`.** La `FileList` la elige la
 *    persona en un dialogo del sistema, no la escribe una pantalla, y en jsdom
 *    esta siempre vacia. No es un sitio donde esconder algo: es una entrada.
 *
 * ---------------------------------------------------------------------------
 * LO QUE CUESTA, MEDIDO, porque esto recorre TODOS los nodos del `<body>` en
 * cada `afterEach` de cada test de 77 archivos.
 *
 * A/B sobre el paquete entero, con la barrida y la foto del marcado
 * cortocircuitadas a `[]` y `''` contra la version de verdad: **216,0 s
 * acumulados contra 217,2 s sobre 1675 tests**, o sea ~1,2 s en total y unos
 * 0,7 ms por test (+0,55%). En reloj de pared, 30,5 s contra 30,3 s: por
 * debajo del ruido entre dos vueltas del mismo codigo.
 *
 * Por que sale tan barato, que no era obvio: la barrida es UNA vuelta por el
 * cuerpo con dos lecturas de propiedad por nodo, el `.value` vacio se descarta
 * antes de guardar nada, y la resta contra el marcado se calcula UNA vez por
 * centinela y no una por escondite. Lo caro habria sido lo contrario —un
 * `includes` del marcado entero por cada control de la pantalla—, y esa es la
 * unica parte que conviene no deshacer por «claridad».
 */

/**
 * LO QUE LA PERSONA TECLEO NO ES UN ESCONDITE, Y ESTO NO ES UNA SUAVIZADA: ES
 * LA SEGUNDA MITAD DE LA DEFINICION.
 *
 * SE DESCUBRIO MIDIENDO, no pensando. Con el canal afirmando solo con la resta
 * contra el marcado, la primera pasada sobre los 76 specs tiro **10 tests de
 * 2 archivos**, todos con el codigo correcto:
 *
 *     el .value de un <input type="password"> esconde claveSmtp   → 3 tests
 *     el .value de un <input> esconde motivoDeLasVacaciones       → 7 tests
 *
 * Y los dos casos son el MISMO y es el de manual: la persona ESCRIBIO el dato
 * en el campo. La clave del SMTP esta en el `.value` de su campo porque
 * alguien la tecleo, y no esta en el marcado porque esa pantalla decide a
 * proposito no escribirla ahi —su propio spec lo afirma: «la clave no aparece
 * en ninguno de los canales», con el `hostSmtp` de control para probar que un
 * campo CONTROLADO si deja su valor en el `outerHTML`—. El motivo de unas
 * vacaciones esta en su campo porque se escribio, y uno de los tests que cayo
 * se llama literalmente «tras un fallo el formulario sigue ahi, con lo que ya
 * se habia escrito»: el valor en el campo ES la cosa afirmada.
 *
 * O sea que la resta contra el marcado NO BASTA. Un campo de texto no
 * controlado —o controlado y re-renderizado— guarda lo tecleado en la
 * propiedad y no en el atributo, asi que lo que la persona escribe cae
 * exactamente en la definicion de «esta en la pagina y no en el marcado». Y
 * eso no es una fuga: es un campo de formulario haciendo su trabajo. Un canal
 * que lo llame fuga se pone rojo con el codigo correcto, y un canal que se
 * pone rojo con el codigo correcto es de los que alguien desactiva — que es el
 * criterio con el que este archivo decidio no prohibir `console.info`, no
 * prohibir pedir imagenes y no vigilar el portapapeles.
 *
 * COMO SE DISTINGUE, Y SE PUEDE: lo que la persona escribe llega por un EVENTO
 * —`input` o `change`, que burbujean los dos— y lo que una pantalla escribe a
 * escondidas en un `useEffect` NO despacha ninguno. Es el criterio que el
 * docblock del portapapeles identifica («una copia deliberada ocurre mientras
 * se despacha un gesto de la persona y una copia accidental no») y que alli se
 * descarto porque no arreglaba el problema de fondo; aqui SI lo arregla, y
 * ademas no hay que inventarse nada para medirlo: `fireEvent.change` y
 * `userEvent.type` despachan los eventos de verdad.
 *
 * SE ESCUCHA EN EL `document` Y EN FASE DE CAPTURA, una sola vez por archivo:
 * en captura porque un oyente de la pantalla que llame a `stopPropagation()`
 * no puede dejarnos ciegos, y en el `document` porque es el unico nodo que no
 * desmonta nadie. El registro es un `WeakSet` y no hace falta vaciarlo entre
 * tests: los nodos de un test se van con el `cleanup()` y los del siguiente son
 * objetos distintos.
 *
 * EL HUECO QUE DEJA, DICHO ENTERO: un campo en el que la persona escribio Y
 * que ademas recibe una fuga por `.value` queda fuera del canal. Es estrecho
 * —pide que la pantalla escriba justo donde se acaba de teclear, que es
 * ademas la forma mas visible de hacerlo, porque pisa lo que la persona ve— y
 * es el precio de no ser rojo en los dos specs de arriba. La alternativa era
 * una lista blanca de campos, que es el patron contra el que este repo predica.
 */
const TECLEADO_POR_LA_PERSONA = new WeakSet<object>();

function anotarLoTecleado(evento: Event): void {
  const donde = evento.target;
  if (donde !== null && typeof donde === 'object') TECLEADO_POR_LA_PERSONA.add(donde);
}

/** Un sitio del cuerpo que lleva algo dentro y que ningun `innerHTML` publica. */
interface EsconditeDelCuerpo {
  /** Como se nombra en el informe. Vocabulario fijo, NUNCA el contenido. */
  sitio: string;
  /** Lo que lleva dentro, para buscar centinelas. NUNCA entra en el informe. */
  contenido: string;
}

/**
 * Como nombrar un nodo en el informe SIN publicar lo que lleva.
 *
 * La etiqueta y, si lo tiene, el `type` —que es lo que distingue el `.value`
 * que se refleja del que no, o sea la informacion que de verdad ubica la
 * fuga—. Por `claveSegura`, como las claves de los almacenes: un
 * `type={claveTemporal}` seria raro, pero el informe no es sitio para
 * averiguarlo.
 */
function nombreDelNodo(nodo: Element): string {
  const tipo = nodo.getAttribute('type');
  const etiqueta = nodo.tagName.toLowerCase();

  return tipo === null ? `<${etiqueta}>` : `<${etiqueta} type="${claveSegura(tipo)}">`;
}

/**
 * Los escondites del `<body>`, recorriendo el cuerpo UNA vez.
 *
 * Se llama ANTES de `cleanup()`: lo que mira vive DENTRO del `<body>`, que el
 * desmontaje vacia. Ver el comentario de la llamada.
 *
 * SE EXPORTA SOLO PARA SU GUARDIAN,
 * `lo-que-el-marcado-no-serializa.spec.ts`, por el mismo motivo por el que se
 * exportan `formaQueSeFue` y lo de `relojes-falsos.ts`: lo que decide si esto
 * sirve es invisible desde fuera. Si alguien cambia el `typeof === 'string'`
 * por una lista de etiquetas, se deja la rama del `shadowRoot`, o mueve la
 * llamada detras del `cleanup()`, LOS 1665 TESTS SIGUEN EN VERDE y el canal se
 * queda ciego. Ningun spec de pantalla lo llama.
 */
export function escondidoEnElCuerpo(): EsconditeDelCuerpo[] {
  const escondites: EsconditeDelCuerpo[] = [];

  for (const nodo of document.body.querySelectorAll('*')) {
    // `typeof === 'string'` y no una lista de etiquetas: `<progress>`,
    // `<meter>` y `<li>` tienen un `.value` NUMERICO —medido— y ahi no cabe un
    // nombre. El vacio no es un escondite y se salta para no pagar un
    // `includes` por cada casilla del panel.
    const valor = (nodo as Partial<HTMLInputElement>).value;

    if (typeof valor === 'string' && valor !== '' && !TECLEADO_POR_LA_PERSONA.has(nodo)) {
      escondites.push({ sitio: `el .value de un ${nombreDelNodo(nodo)}`, contenido: valor });
    }

    // El `.value` de un `<select>` es DERIVADO —lo da el `<option>` elegido, y
    // ese `value` si se refleja—, asi que entra por la linea de arriba y la
    // resta lo deja fuera del informe sola. Se deja pasar igual en vez de
    // excluirlo: excluir pide saber que `<select>` es especial, y eso es
    // justamente el tipo de cosa que caduca.
    const sombra = nodo.shadowRoot;

    if (sombra !== null) {
      escondites.push({
        sitio: `el shadowRoot de un ${nombreDelNodo(nodo)}`,
        contenido: `${sombra.innerHTML} ${sombra.textContent ?? ''}`,
      });
    }
  }

  return escondites;
}

// ---------------------------------------------------------------------------
// El decimosexto canal: OPFS, EL SEXTO ALMACEN — un SISTEMA DE ARCHIVOS
// ---------------------------------------------------------------------------

/**
 * `navigator.storage` NO EXISTE EN JSDOM, y por eso hay que PONERLO.
 *
 * Medido con una sonda en jsdom 26: `typeof navigator.storage` es
 * `'undefined'`, no hay descriptor ni en `navigator` ni en su prototipo, y
 * NINGUNA de las clases de la familia —`StorageManager`, `FileSystemHandle`,
 * `FileSystemDirectoryHandle`, `FileSystemFileHandle`,
 * `FileSystemWritableFileStream`— existe tampoco. Es la misma situacion que
 * `sendBeacon`, que `caches`, que `serviceWorker` y que `indexedDB`, y la
 * misma leccion que ya dejo CINCO fugas: UNA API QUE JSDOM NO IMPLEMENTA ES UN
 * SITIO DONDE NADIE MIRA POR CONSTRUCCION. Un `navigator.storage.getDirectory()`
 * a pelo revienta con un `TypeError` y el test cae solo; pero la forma que
 * escribe cualquiera que programe con cuidado —`navigator.storage?.getDirectory?.()`,
 * o detras de un `if ('storage' in navigator)`— NO HACE NADA y pasa en verde,
 * mientras en el navegador del mostrador escribe un archivo en disco.
 *
 * LA MUTACION QUE LO DESCUBRIO, medida, en el `onSuccess` de una mutacion de
 * cobro y con el `?.` prudente:
 *
 *     // Respaldo del cobro en disco, por si se corta la luz en el mostrador.
 *     void navigator.storage?.getDirectory?.().then(async (raiz) => {
 *       const archivo = await raiz.getFileHandle('cobros-del-dia.json', { create: true });
 *       const flujo = await archivo.createWritable();
 *       await flujo.write(JSON.stringify(pago));   // monto, nota, perfilId, metodo, fechas
 *       await flujo.close();
 *     });
 *
 * Sobrevivio los 1721 tests del paquete con los quince canales enchufados. Y
 * el control que prueba que el instrumento funcionaba: EL MISMO DATO, EN LA
 * MISMA LINEA, por `localStorage.setItem(...)` TIRA 7 TESTS. Lo unico que
 * cambia entre caer y no caer es QUE API DE ALMACENAMIENTO SE USA.
 *
 * EL CONTROL SE REHIZO EN OTRA PANTALLA AL MONTAR ESTO, para medirlo donde el
 * agujero tambien existe y no solo donde se encontro. En `useGuardarSmtp`
 * —el mismo hook que abrio el canal de IndexedDB, y cuyo spec siembra los tres
 * centinelas del SMTP— las dos lineas quedan EMPATADAS:
 *
 *     localStorage.setItem('config-del-dia', JSON.stringify(datos))  → 9 de 60
 *     …getDirectory() … flujo.write(JSON.stringify(datos))           → 9 de 60
 *
 * La segunda es la que antes de este canal daba CERO de 60, y no por poco:
 * `typeof navigator.storage` es `'undefined'`, asi que el `?.` cortocircuita y
 * la fuga no llega a ejecutarse ni una vez dentro del test — mientras en el
 * mostrador escribe el archivo entero.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ES UN ALMACEN NUEVO Y NO UNA VARIANTE DE LOS CINCO QUE YA SE VIGILAN.
 *
 * Los cinco almacenes tapados son `localStorage`, `sessionStorage`, las
 * galletas, `CacheStorage` e IndexedDB. OPFS —el Origin Private File System—
 * es EL SEXTO, y es peor que los cinco en las cosas que importan:
 *
 *  - SOBREVIVE IGUAL. Al logout, al cierre de la pestaña y al reinicio, como
 *    `localStorage`, en una maquina que usan cuatro personas por turno.
 *  - NO TIENE EL TOPE DE 5 MB. Donde `localStorage` obliga a elegir que
 *    guardar, aqui cabe el dia entero del mostrador.
 *  - GUARDA BYTES SIN QUE NADIE SERIALICE. `setItem` obliga a pasar por texto
 *    —o sea, a PENSAR que se esta guardando—; aqui se escribe un `Blob` o un
 *    `ArrayBuffer` tal cual.
 *  - NO APARECE EN LA PESTAÑA «APPLICATION» como los otros cinco. Los cinco se
 *    ven de un vistazo en las herramientas del navegador; este no, y por eso
 *    una fuga ahi no la encuentra nadie mirando.
 *  - Y `cleanup()` NO LO TOCA, como no toca la URL ni los atributos de
 *    alrededor.
 *
 * Y LOS CINCO TAPONES NO LO PUEDEN VER, que es lo que lo hace un canal y no
 * una forma: CADA UNO LEE SU PROPIA API —`Storage.prototype.setItem`, el
 * accesor de las galletas, el `caches` de mentira, el `indexedDB` de
 * mentira—. Ninguno de los cinco sabe que existe un SISTEMA DE ARCHIVOS. No
 * hay ninguna lectura compartida que pudiera cazarlo de refilon.
 *
 * ---------------------------------------------------------------------------
 * EL ARBOL TIENE MAS DE UNA PUERTA, Y SE MIRAN TODAS. EL NOMBRE ES UNA DE ELLAS.
 *
 * Es la leccion de `open(nombre)` en IndexedDB y la de
 * `localStorage.setItem(claveTemporal, '1')`: **EL NOMBRE DEL ARCHIVO Y EL DEL
 * DIRECTORIO LLEVAN DATO IGUAL QUE EL CONTENIDO**. Un
 * `raiz.getFileHandle(claveTemporal, { create: true })` publica el secreto sin
 * escribir un solo byte, y ahi se queda, en el nombre de una entrada del disco.
 * Las puertas que se anotan:
 *
 *  - `navigator.storage.getDirectory()`. La entrada al arbol. Cuenta sola,
 *    como `indexedDB.open`: pedir el disco privado ya es usarlo.
 *  - `getFileHandle(nombre, { create })` y `getDirectoryHandle(nombre, { create })`.
 *    El nombre, por la ruta entera.
 *  - `removeEntry(nombre)`. Borrar tambien nombra: es la pareja de
 *    `deleteDatabase`, que el undecimo canal ya anota por lo mismo.
 *  - `createWritable()` y su `write`, que es donde van los bytes — y tambien
 *    el `getWriter().write` de su `WritableStream`, que es la otra forma de
 *    escribir el mismo flujo y cuesta una linea.
 *  - `createSyncAccessHandle()` y su `write`, que es la puerta rapida que
 *    existe en algunos navegadores y que es SINCRONA: ni promesa ni flujo.
 *  - `move(nombre)` y `remove()` de un archivo. Renombrar publica el nombre
 *    nuevo igual que crearlo.
 *
 * LO QUE NO SE ANOTA, dicho para que nadie lo descubra creyendo que lo cubria:
 * LAS LECTURAS —`getFile()`, `values()`, `entries()`, `resolve()`—. No sacan
 * un dato de esta pagina: lo traen. Devuelven lo que devuelve un disco vacio,
 * que es lo que hay en un test.
 *
 * ---------------------------------------------------------------------------
 * EL CONTENIDO PUEDE NO SER UNA CADENA, Y ESO NO SE DEDUJO: ESTA EN LA API.
 *
 * `write` acepta CUATRO formas —`string`, `ArrayBuffer` (y sus vistas), `Blob`
 * y un objeto `{ type: 'write', data, position }`—, y por las cuatro se va el
 * dato igual de bien. Un `JSON.stringify` del argumento no sirve: un `Blob`
 * serializa a `{}`.
 *
 * SE REUSA `cuerpoDeUnaBaliza`, que es el desmenuzador que el octavo canal
 * escribio para `sendBeacon` y que el decimocuarto ya reusa para el cuerpo de
 * un `fetch` y de un `XMLHttpRequest`: sabe decodificar un `ArrayBuffer` con
 * `TextDecoder` y leerle los bytes a un `Blob` por dentro, que es lo unico que
 * hay que hacer aqui. Lo UNICO que agrega este canal es desenvolver la cuarta
 * forma —la del objeto con `data` dentro—, que es la unica que esconde el
 * contenido detras de una clave y que `cuerpoDeUnaBaliza` no podia conocer.
 *
 * ---------------------------------------------------------------------------
 * LA FORMA ES LA FUERTE —«NO SE TOCO EL DISCO PRIVADO»— Y ESO SE MIDIO.
 *
 * Es la forma de `window.name`, de IndexedDB, de los atributos del `<html>` y
 * de las cinco puertas de red que no son `fetch`, y el criterio es el mismo:
 * donde no hay un uso legitimo que proteger, la forma fuerte sale gratis y
 * caza ademas EL DATO QUE NADIE REGISTRO —que es justo el caso de un
 * `write(JSON.stringify(pago))` que se lleva el objeto entero—.
 *
 *  1. No hay un solo uso de esta familia en `apps/web/src`. Medido con
 *     `grep -rniE "navigator\.storage|getDirectory|StorageManager|OPFS|FileSystemHandle"`:
 *     cero coincidencias. El producto no tiene NINGUNA puerta legitima aqui.
 *  2. La duda real era el arbol de dependencias, porque fue la que invalido
 *     media medida en IndexedDB: `serwist` SI usa IndexedDB, y lo que salvo la
 *     forma fuerte alli fue que ese modulo no se carga en los tests. Aqui la
 *     comprobacion que decide es la misma y es la del paquete completo: con
 *     este tapon puesto y la afirmacion fuerte, LOS 80 SPECS SIGUEN EN VERDE,
 *     o sea que nadie del arbol pide el disco privado durante un test.
 *
 * SE AFIRMAN IGUALMENTE LOS CENTINELAS, Y ANTES QUE LA FORMA FUERTE, como en
 * IndexedDB y por lo mismo: un «una escritura en el disco privado lleva
 * claveDelReset» dice QUE dato se fue, y la forma fuerte sola obligaria a ir a
 * buscarlo. Y se separan EL NOMBRE y EL CONTENIDO en dos afirmaciones porque
 * son dos sitios distintos —un `getFileHandle(claveTemporal)` publica el dato
 * sin escribir un byte— y el informe gana diciendo cual.
 *
 * EL INFORME NOMBRA LA PUERTA Y LA RUTA, NUNCA EL CONTENIDO. Y la ruta pasa
 * segmento a segmento por `claveSegura`, como las claves de los almacenes y
 * los nombres de las bases, por si alguien escondio el dato ahi: entonces el
 * mensaje dice como se llama el dato vigilado en vez de copiar la cadena al
 * registro de CI.
 *
 * EL PRECIO, DICHO ENTERO: a partir de aqui la deteccion de capacidades ve un
 * `navigator.storage` que jsdom no tiene, y una pantalla que pregunte
 * `'storage' in navigator` tomara ese camino en los tests. Hoy no lo pregunta
 * nadie —punto 1—, y el cambio acerca el entorno al navegador de verdad en
 * lugar de alejarlo, que es la direccion correcta para una infraestructura de
 * tests.
 *
 * LO QUE ESTE TAPON NO MONTA, por la misma regla que IndexedDB: las CLASES de
 * la familia siguen sin existir. Un `FileSystemHandle` suelto revienta con un
 * `ReferenceError` y el test cae —que es el comportamiento bueno—. Montarlas
 * seria simular un sistema de archivos; esto no esta para eso, esta para que
 * una escritura hacia el no sea invisible.
 */
const ALMACEN_DE_ARCHIVOS_ORIGINAL = Object.getOwnPropertyDescriptor(navigator, 'storage');

/** Un paso por el disco privado del origen, con la PUERTA por la que entro. */
interface PasoPorElDisco {
  /** `getFileHandle`, `createWritable().write`, `removeEntry`… */
  puerta: string;
  /** La ruta desde la raiz, por segmentos. CADA NOMBRE puede llevar el dato. */
  ruta: string[];
  /** Lo escrito, en texto. Vacio cuando la puerta no escribe bytes. */
  contenido: string;
}

/**
 * LO QUE UNA ESCRITURA EN EL DISCO LLEVA DENTRO, en texto, en sus cuatro formas.
 *
 * `write` acepta `string`, `ArrayBuffer` (y sus vistas), `Blob` y el objeto
 * `{ type: 'write', data, position }`. Las tres primeras ya las sabe
 * desmenuzar `cuerpoDeUnaBaliza` —es el desmenuzador del octavo canal, que
 * decodifica un `ArrayBuffer` con `TextDecoder` y le lee los bytes a un `Blob`
 * por dentro— y por eso se reusa en vez de escribir otra decodificacion.
 *
 * LA CUARTA ES LA QUE HAY QUE DESENVOLVER AQUI, y es la unica que no se puede
 * delegar: el contenido va escondido detras de la clave `data`, asi que sin
 * esto un `write({ type: 'write', data: unBlob })` acabaria en `comoTexto` y
 * se serializaria a `{"type":"write"}` — el canal verde y ciego justo en la
 * forma que escribe quien necesita posicionar la escritura.
 *
 * Se pregunta por `data` y no por `type` a proposito: `'type' in unBlob` es
 * TRUE —`Blob.prototype.type` es el tipo MIME— y preguntar por ahi mandaria
 * todos los `Blob` por la rama equivocada. Medido antes de escribirlo.
 *
 * SE EXPORTA SOLO PARA SU GUARDIAN, `disco-privado.spec.ts`, por el mismo
 * motivo por el que se exportan `formaQueSeFue`, `vinoDePedir` y
 * `escondidoEnElCuerpo`: si esto se «simplificara» a mirar solo las cadenas,
 * los 79 specs seguirian en verde y el canal se quedaria ciego para las otras
 * tres formas. Ningun spec de pantalla lo llama.
 */
export function contenidoDeUnaEscrituraEnDisco(datos: unknown): string {
  if (datos === undefined || datos === null) return '';

  if (
    typeof datos === 'object' &&
    !(datos instanceof Blob) &&
    !esUnArrayBuffer(datos) &&
    !ArrayBuffer.isView(datos) &&
    'data' in datos
  ) {
    return cuerpoDeUnaBaliza((datos as { data?: unknown }).data);
  }

  // Y lo que no sea ninguna de las cuatro formas cae en `cuerpoDeUnaBaliza`,
  // que acaba en `comoTexto`. Es ruido —una orden `{ type: 'truncate' }` se
  // anota como texto aunque no escriba un byte— y es el lado seguro: este
  // canal puede permitirse mirar de mas, nunca de menos.
  return cuerpoDeUnaBaliza(datos);
}

/** Cuantos bytes dice haber escrito una manija sincrona: lo que pide su API. */
function bytesDe(datos: unknown): number {
  if (ArrayBuffer.isView(datos)) return datos.byteLength;
  if (esUnArrayBuffer(datos)) return (datos as ArrayBuffer).byteLength;

  return 0;
}

/**
 * UN DISCO PRIVADO DE MENTIRA QUE ANOTA CADA PUERTA Y NO GUARDA NADA.
 *
 * Al reves que la base de IndexedDB, que SI guarda porque sin registros no hay
 * cursor que recorrer. Aqui no hace falta: no hay ninguna puerta de escritura
 * que dependa de que el archivo ya tenga algo dentro —`createWritable()`
 * empieza por el principio y `write` escribe—, asi que guardar seria inventar
 * un sistema de archivos para no cazar nada mas. Las lecturas devuelven lo que
 * devuelve un disco vacio, que es lo que hay en un test.
 *
 * SE EXPORTA SOLO PARA SU GUARDIAN, `disco-privado.spec.ts`, como el resto de
 * lo invisible de este archivo: el guardian arma una raiz SUYA con su propio
 * `anotar`, recorre las siete puertas y mide que cada una queda anotada con su
 * ruta y su contenido. Hacerlo contra el tapon de verdad no se puede —tocar el
 * disco privado es, por la forma fuerte, el fallo— y leer el codigo no mide
 * nada. Ningun spec de pantalla lo llama.
 */
export function raizDeMentira(anotar: (paso: PasoPorElDisco) => void): Record<string, unknown> {
  /** Lo que devuelve recorrer un directorio vacio, que es lo que hay aqui. */
  const vacio = (): AsyncGenerator<never> => {
    async function* nada(): AsyncGenerator<never> {
      // Un disco de mentira no tiene entradas que entregar.
    }

    return nada();
  };

  const flujoDeMentira = (ruta: string[], puerta: string): Record<string, unknown> => {
    const escribir = (datos: unknown): void => {
      anotar({ puerta, ruta, contenido: contenidoDeUnaEscrituraEnDisco(datos) });
    };

    return {
      write: (datos: unknown) => {
        escribir(datos);
        return Promise.resolve(undefined);
      },
      seek: () => Promise.resolve(undefined),
      truncate: () => Promise.resolve(undefined),
      close: () => Promise.resolve(undefined),
      abort: () => Promise.resolve(undefined),
      // Un `FileSystemWritableFileStream` ES un `WritableStream`, asi que
      // `getWriter().write(datos)` escribe el mismo archivo por otra boca.
      getWriter: () => ({
        write: (datos: unknown) => {
          escribir(datos);
          return Promise.resolve(undefined);
        },
        close: () => Promise.resolve(undefined),
        abort: () => Promise.resolve(undefined),
        releaseLock: () => {},
        ready: Promise.resolve(undefined),
        closed: Promise.resolve(undefined),
      }),
    };
  };

  /** La puerta SINCRONA: ni promesa ni flujo, y devuelve bytes escritos. */
  const manijaSincronaDeMentira = (ruta: string[]): Record<string, unknown> => ({
    write: (datos: unknown) => {
      anotar({
        puerta: 'createSyncAccessHandle().write',
        ruta,
        contenido: contenidoDeUnaEscrituraEnDisco(datos),
      });

      return bytesDe(datos);
    },
    read: () => 0,
    truncate: () => {},
    getSize: () => 0,
    flush: () => {},
    close: () => {},
  });

  const archivoDeMentira = (ruta: string[]): Record<string, unknown> => ({
    kind: 'file',
    name: ruta[ruta.length - 1] ?? '',
    createWritable: () => Promise.resolve(flujoDeMentira(ruta, 'createWritable().write')),
    createSyncAccessHandle: () => Promise.resolve(manijaSincronaDeMentira(ruta)),
    getFile: () => Promise.resolve(new Blob([])),
    /**
     * Renombrar PUBLICA EL NOMBRE NUEVO igual que crearlo.
     *
     * La plataforma acepta `move(nombre)` y `move(directorio, nombre)`: el
     * nombre es el ultimo argumento en las dos formas.
     */
    move: (uno: unknown, otro?: unknown) => {
      const nombre = otro === undefined ? uno : otro;
      anotar({
        puerta: 'move',
        ruta: [...ruta.slice(0, -1), String(nombre)],
        contenido: '',
      });

      return Promise.resolve(undefined);
    },
    remove: () => {
      anotar({ puerta: 'remove', ruta, contenido: '' });
      return Promise.resolve(undefined);
    },
    isSameEntry: () => Promise.resolve(false),
    queryPermission: () => Promise.resolve('granted'),
    requestPermission: () => Promise.resolve('granted'),
  });

  const directorioDeMentira = (ruta: string[]): Record<string, unknown> => ({
    kind: 'directory',
    name: ruta[ruta.length - 1] ?? '',
    getFileHandle: (nombre: unknown) => {
      const suya = [...ruta, String(nombre)];
      anotar({ puerta: 'getFileHandle', ruta: suya, contenido: '' });

      return Promise.resolve(archivoDeMentira(suya));
    },
    getDirectoryHandle: (nombre: unknown) => {
      const suya = [...ruta, String(nombre)];
      anotar({ puerta: 'getDirectoryHandle', ruta: suya, contenido: '' });

      return Promise.resolve(directorioDeMentira(suya));
    },
    removeEntry: (nombre: unknown) => {
      anotar({ puerta: 'removeEntry', ruta: [...ruta, String(nombre)], contenido: '' });
      return Promise.resolve(undefined);
    },
    resolve: () => Promise.resolve(null),
    keys: vacio,
    values: vacio,
    entries: vacio,
    [Symbol.asyncIterator]: vacio,
    isSameEntry: () => Promise.resolve(false),
    queryPermission: () => Promise.resolve('granted'),
    requestPermission: () => Promise.resolve('granted'),
  });

  return directorioDeMentira([]);
}

/**
 * Como nombrar un paso por el disco en un informe SIN publicar lo que lleva.
 *
 * La puerta y la ruta; NUNCA el contenido, que es justamente lo que esta fuga
 * se lleva. Y la ruta SEGMENTO A SEGMENTO por `claveSegura`, porque un archivo
 * bautizado con el dato lo publica igual de bien que su contenido.
 */
function descripcionDeUnPaso(paso: PasoPorElDisco): string {
  const ruta = paso.ruta.length === 0 ? 'la raiz' : `/${paso.ruta.map(claveSegura).join('/')}`;

  return `${paso.puerta} en ${ruta}`;
}

// ---------------------------------------------------------------------------
// El decimoseptimo canal: EL CENTRO DE NOTIFICACIONES DEL SISTEMA OPERATIVO
// ---------------------------------------------------------------------------

/**
 * `Notification` NO EXISTE EN JSDOM, y por eso hay que PONERLO.
 *
 * Medido con una sonda en jsdom 26: `typeof Notification` es `'undefined'`, no
 * hay descriptor en `globalThis` ni en `window`, y `PushManager` tampoco
 * existe. Es la misma situacion que `sendBeacon`, `caches`, `serviceWorker`,
 * `indexedDB`, `navigator.storage`, `EventSource` y `Worker`, y la misma
 * leccion que ya dejo OCHO fugas: UNA API QUE JSDOM NO IMPLEMENTA ES UN SITIO
 * DONDE NADIE MIRA POR CONSTRUCCION.
 *
 * Y AQUI LA AUSENCIA LA CONVIERTE EN SILENCIO EL `typeof`, QUE ES LA FORMA
 * OBLIGATORIA. Con los otros ocho la forma prudente era un `?.` opcional —se
 * podia escribir sin el, y entonces el test caia solo—. Aqui no: `Notification`
 * es un BINDING GLOBAL, asi que `Notification.permission` a pelo lanza un
 * `ReferenceError` en cualquier navegador que no lo traiga, y la unica manera
 * correcta de usar esta API es preguntar antes. O sea que el codigo BIEN
 * ESCRITO es exactamente el que pasa en verde:
 *
 *     if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
 *       new Notification('Cobro registrado', {
 *         body: `${usuario.nombreCompleto}: ${monto} (${metodo}). ${nota}`,
 *         tag: `cobro-${usuario.perfilId}`,
 *       });
 *     }
 *
 * MEDIDO: esa mutacion, en el `onSuccess` de la mutacion de cobro de la ficha
 * de una persona, SOBREVIVIO LOS 1761 TESTS del paquete con los dieciseis
 * canales enchufados. El control que prueba que el instrumento funcionaba: LA
 * MISMA TERNA DE DATOS, en la misma linea, por `console.info` TIRA 7 TESTS DE
 * 26. Lo unico que cambia entre caer y no caer es la puerta.
 *
 * Y ESTE ARCHIVO YA LO TENIA ESCRITO SIN DARSE CUENTA. El docblock de
 * `SERVICE_WORKER_ORIGINAL`, al justificar que montar el worker no le cambia
 * nada a nadie, dice: «el unico sitio de `src/` que lo pregunta es
 * `elNavegadorPuede()` en `boton-de-push.tsx`, y pide ADEMAS `Notification` y
 * `PushManager`, QUE SIGUEN SIN EXISTIR». Esa frase era la descripcion exacta
 * de un canal sin tapar, leida como si fuera una tranquilidad.
 *
 * ---------------------------------------------------------------------------
 * LO QUE LO HACE GRAVE NO ES LA API: ES QUE ESTE PRODUCTO YA PIDIO EL PERMISO.
 *
 * `componentes/boton-de-push.tsx` llama a `Notification.requestPermission()`
 * cuando un alumno activa los avisos, y `src/app/sw.ts` existe y los muestra.
 * O sea que en la maquina del mostrador `Notification.permission === 'granted'`
 * NO ES UNA HIPOTESIS: es el estado normal en cuanto alguien activo las
 * notificaciones una vez en ese navegador. La rama de la fuga no esta detras de
 * una condicion improbable — esta detras de una condicion que el propio
 * producto se encarga de hacer verdadera.
 *
 * Y EL DESTINO ES PEOR QUE CUALQUIERA DE LOS DIECISEIS ANTERIORES, porque no es
 * un sitio del navegador: es EL CENTRO DE NOTIFICACIONES DEL SISTEMA OPERATIVO.
 *
 *  - SE VE SIN TOCAR NADA. Aparece encima de todo, en una pantalla que esta de
 *    cara al publico, y lo lee cualquiera que pase por delante del mostrador.
 *    No hace falta abrir las herramientas del navegador como con los seis
 *    almacenes, ni mirar la barra de direcciones como con la URL.
 *  - SOBREVIVE A LA PESTAÑA, AL LOGOUT Y AL CIERRE DEL NAVEGADOR. Los seis
 *    almacenes sobreviven al logout; este sobrevive ademas a que el navegador
 *    ya no este abierto, porque el dato ya no lo guarda el navegador.
 *  - EN WINDOWS QUEDA EN EL HISTORIAL DE NOTIFICACIONES —el centro de
 *    actividades—, que no lo vacia ningun «borrar datos del sitio» y que no es
 *    nuestro: es del sistema.
 *  - Y NO LO MIRA NINGUNO DE LOS DIECISEIS TAPONES, porque no es un almacen
 *    web, no es una peticion de red, no es el DOM y no es la consola. Cada uno
 *    de los otros lee SU propia API; ninguno sabe que existe un centro de
 *    notificaciones.
 *
 * ---------------------------------------------------------------------------
 * CON QUE VALOR SE MONTA `permission`, QUE ES LO QUE DECIDE SI ESTO SIRVE.
 *
 * `Notification.permission` es un ACCESOR ESTATICO de solo lectura, y el codigo
 * prudente lo consulta antes de construir nada: es lo que hace la mutacion de
 * arriba y es lo que recomienda la documentacion. ASI QUE EL VALOR CON EL QUE
 * SE MONTE DECIDE SI LA RAMA DE LA FUGA LLEGA A EJECUTARSE.
 *
 * SE MONTA EN `'granted'`, Y NO ES UNA ELECCION DE COMODIDAD: medido con la
 * mutacion puesta en la ficha de una persona y el canal entero enchufado,
 *
 *     permission: 'default'   → 0 tests de 26 (la rama no corre: verde y ciego)
 *     permission: 'granted'   → 7 tests de 26 (el canal nombra el campo)
 *
 * Con `'default'` el tapon quedaria instalado, el informe diria que se miro, y
 * no se habria mirado nada — que es el modo de fallo que todo este archivo
 * existe para evitar. Y `'granted'` no es ademas una exageracion: es el estado
 * REAL del navegador del mostrador en cuanto alguien activo los avisos una vez,
 * asi que montarlo asi acerca el entorno al navegador de verdad en lugar de
 * alejarlo, que es la direccion correcta para una infraestructura de tests.
 *
 * `'denied'` se descarto por lo mismo que `'default'` y por una cosa mas: es el
 * unico de los tres que ademas cambia lo que PINTA `boton-de-push.tsx`, que
 * tiene una rama entera para quien dijo que no.
 *
 * ---------------------------------------------------------------------------
 * SE MONTA `Notification` Y NO SE MONTA `PushManager`, A PROPOSITO.
 *
 * Es la unica decision de este canal que mira hacia afuera, y esta medida.
 * `elNavegadorPuede()` en `boton-de-push.tsx` pide las TRES cosas:
 * `Notification`, `PushManager` y `'serviceWorker' in navigator`. El decimo
 * canal ya monta la tercera; este monta la primera. Dejando `PushManager`
 * fuera, `elNavegadorPuede()` sigue devolviendo `false` en los 81 specs y el
 * boton sigue sin pintarse donde no se pide —que es como estaba—, mientras el
 * canal queda entero: lo que se vigila es `new Notification(...)`, y para
 * escribir esa linea no hace falta `PushManager`.
 *
 * Montar `PushManager` encenderia el boton de push en cualquier spec que
 * monte la pantalla del perfil del alumno sin pedirlo, y ademas volveria falsa
 * la premisa de un test que ya existe —`boton-de-push.spec.tsx`, «en un
 * navegador sin Notification tampoco»—. No hace falta para nada y se queda
 * fuera.
 *
 * (Ese test SIGUE EN VERDE con esto puesto, y esta medido: lo que lo sostiene
 * ahora es la ausencia de `PushManager`, no la de `Notification`. Su comentario
 * dice «jsdom no trae ni Notification ni PushManager» y a partir de aqui eso ya
 * no es cierto de la primera mitad. El test es correcto; la frase se quedo
 * vieja.)
 *
 * ---------------------------------------------------------------------------
 * QUE CAMPOS SE AUDITAN. TODOS LOS QUE LLEVEN TEXTO, Y NO UNA LISTA BLANCA.
 *
 * El titulo —primer argumento— y CADA CLAVE del objeto de opciones, una por
 * una, sin enumerar cuales. Es la decision del decimoquinto canal
 * («no se enumeran los tipos, a proposito») por el mismo motivo: una lista de
 * campos es una lista negra, y el dia que la plataforma agregue uno —o que
 * alguien escriba `lang` con un nombre dentro— el tapon seguiria en verde
 * diciendo otra cosa. Lo que se recorre es `Object.entries` de lo que llegue.
 *
 * Los cuatro que la tarea pedia nombrar caen todos ahi dentro, y conviene decir
 * por que cada uno lleva dato:
 *
 *  - `title`. Es la linea grande del aviso: lo que se lee desde dos metros.
 *  - `body`. El cuerpo, y el sitio natural de «nombre: monto (metodo). nota».
 *  - `tag`. No se ve, y por eso es peor: es el identificador con el que el
 *    navegador agrupa avisos, la forma de manual es `cobro-${perfilId}`, y
 *    sigue ahi aunque el aviso se reemplace.
 *  - `data`. UN CAMPO LIBRE que acepta cualquier cosa estructurada, igual que
 *    el `detail` de `performance.mark` y que el valor de un `put` de IndexedDB.
 *    Se serializa con `comoTexto`, que es lo que ya hacen esos dos, para que un
 *    dato ANIDADO en la tercera clave de un objeto cuente igual.
 *
 * Y LAS URLS ENTRAN, que es lo que el septimo canal enseño: `icon`, `badge` e
 * `image` son URLs, Y UNA URL LLEVA DATO IGUAL QUE UN CUERPO. Un
 * `icon: '/avatar.png?de=' + nombre` publica el dato sin escribir una palabra
 * en el aviso, y ademas lo PIDE a la red. No hay que hacer nada especial para
 * cubrirlas: son tres claves mas del objeto de opciones y el recorrido las
 * mira solas. Lo mismo `actions`, que es un array de objetos con `title` y
 * `action` dentro.
 *
 * LO QUE SE QUEDA FUERA, DICHO AQUI PARA QUE NADIE LO DESCUBRA CREYENDO QUE
 * ESTO LO TAPABA —un limite escrito es una defensa; un limite tacito es una
 * trampa para el que venga—:
 *
 *  - `Notification.requestPermission()`. NO ES UNA PUERTA DE ESTE CANAL y no se
 *    anota: no saca ningun dato de esta pagina, no recibe ningun argumento con
 *    contenido y es ademas lo UNICO de esta familia que el producto llama de
 *    verdad. Contarla como uso del canal pondria la forma fuerte de abajo ROJA
 *    con el codigo correcto en `boton-de-push.spec.tsx`. Se monta —devuelve
 *    `'granted'`— para que el boton siga funcionando, y se ignora.
 *  - LO QUE EL USUARIO HACE DESPUES con el aviso: `notificationclick`, el foco
 *    de la ventana, el `close()`. No sacan nada; son entradas.
 *  - LOS CAMPOS QUE NO PUEDEN LLEVAR UN NOMBRE DENTRO no se excluyen a mano
 *    —`silent`, `renotify`, `requireInteraction` son booleanos y `timestamp` y
 *    `vibrate` son numeros—: pasan por el recorrido, no emparejan con ningun
 *    centinela y no cuestan nada. Excluirlos pedia una lista, que es lo que
 *    este canal evita. Es el lado seguro, como en
 *    `contenidoDeUnaEscrituraEnDisco`: aqui se puede mirar de mas, nunca de
 *    menos.
 *
 * ---------------------------------------------------------------------------
 * EL VECINO: `ServiceWorkerRegistration.showNotification()` ENTRA, Y AQUI.
 *
 * Es LA OTRA forma de mostrar una notificacion —la que usa el push, y la unica
 * que existe dentro de un service worker: `src/app/sw.ts` la llama en su
 * manejador de `push`—. Desde una PAGINA se escribe
 * `(await navigator.serviceWorker.ready).showNotification(titulo, opciones)`, y
 * es la forma que la documentacion recomienda porque admite `actions`.
 *
 * SE DECIDIO QUE ENTRA EN ESTE CANAL Y NO EN EL DECIMO, y el criterio es el que
 * este archivo ya uso para separar `sendBeacon` del decimocuarto canal: lo que
 * agrupa un canal es EL SITIO DONDE ACABA EL DATO, no la funcion por la que
 * pasa. El decimo canal vigila lo que se le MANDA al worker —un `postMessage`,
 * que se queda dentro del navegador en un hilo con nuestro origen—; esto SALE
 * del navegador al centro de notificaciones del sistema, exactamente igual que
 * `new Notification`. Mismo destino, mismos campos, mismo informe: un canal.
 *
 * Se monta sobre los registros de mentira que el DECIMO canal ya fabrica, que
 * es donde la plataforma la pone, y se anota con la puerta `showNotification`
 * para que el informe diga por cual de las dos salio.
 *
 * LO QUE ESO NO CUBRE, dicho entero: `getRegistration()` y `getRegistrations()`
 * siguen devolviendo «no hay nada registrado», que es lo que el decimo canal
 * decidio y lo que `boton-de-push.tsx` espera. Un
 * `(await navigator.serviceWorker.getRegistration())?.showNotification(dato)`
 * no se anota — pero tampoco se ejecuta, asi que no es una fuga silenciosa:
 * es la misma nada que en un navegador sin worker instalado. Y el camino que
 * SI usa el producto para esperar al worker es `ready`, que es el que se mira.
 *
 * ---------------------------------------------------------------------------
 * LA FORMA: CENTINELAS PRIMERO Y LA FUERTE DETRAS. LAS DOS, Y ESO SE MIDIO.
 *
 * La duda era real: notificar ES legitimo en este producto —hay un boton que
 * pide el permiso y un service worker que muestra avisos—, asi que la forma
 * fuerte podia ser ROJA CON EL CODIGO CORRECTO, que es el criterio con el que
 * este archivo decidio vigilar el `src` de una imagen, las salidas laterales y
 * `fetch` por centinelas y no por «ninguna llamada».
 *
 * NO LO ES, Y LA MEDIDA QUE LO DECIDE ES LA DEL PAQUETE ENTERO: con la forma
 * fuerte instalada, LOS 81 SPECS SIGUEN EN VERDE. El motivo es estructural y no
 * una casualidad: en este producto NINGUNA PANTALLA MUESTRA UN AVISO. Los
 * avisos los muestra el SERVICE WORKER —`sw.ts`, desde el manejador de `push`,
 * con lo que manda el servidor—, y lo unico que hace la pagina es PEDIR EL
 * PERMISO, que no es una puerta de este canal (ver arriba). Cero
 * `new Notification` y cero `showNotification` en `apps/web/src` fuera de
 * `sw.ts`, medido con `grep`.
 *
 * Donde no hay uso legitimo que proteger, la forma fuerte sale gratis y caza
 * ademas EL DATO QUE NADIE REGISTRO —que es justo el caso del `nota` de un
 * cobro, texto libre que nadie puede sembrar como centinela—. Es la forma de
 * `window.name`, de IndexedDB, de los atributos del `<html>` y de OPFS.
 *
 * SE AFIRMAN IGUALMENTE LOS CENTINELAS, Y ANTES, como en IndexedDB y en OPFS y
 * por lo mismo: un «una notificacion lleva claveDelReset (new Notification, el
 * campo body)» dice QUE dato se fue y POR DONDE, y la forma fuerte sola
 * obligaria a ir a buscarlo.
 *
 * EL INFORME NOMBRA LA PUERTA Y EL CAMPO, NUNCA EL CONTENIDO. Y el nombre del
 * campo pasa por `claveSegura`, como las claves de los almacenes y los
 * segmentos de una ruta del disco: un `{ [claveTemporal]: 1 }` en las opciones
 * publicaria el dato en el propio nombre.
 *
 * EL PRECIO, DICHO ENTERO: a partir de aqui la deteccion de capacidades ve un
 * `Notification` que jsdom no tiene. Se midio a quien le cambia algo y la
 * respuesta esta arriba: solo a `elNavegadorPuede()`, que pide ademas
 * `PushManager` y por eso sigue diciendo que no.
 */
const NOTIFICACION_ORIGINAL = Object.getOwnPropertyDescriptor(globalThis, 'Notification');

/** Un campo de una notificacion que puede llevar texto dentro. */
interface CampoDeUnAviso {
  /** El nombre del campo: `titulo`, `body`, `tag`, `data`, `icon`… */
  nombre: string;
  /** Lo que lleva dentro, para buscar centinelas. NUNCA entra en el informe. */
  contenido: string;
}

/** Una notificacion que una pantalla mando al centro de notificaciones. */
interface AvisoMostrado {
  /** `new Notification` o `showNotification`: por cual de las dos salio. */
  puerta: string;
  campos: CampoDeUnAviso[];
}

/**
 * LOS CAMPOS DE UNA NOTIFICACION, UNO POR UNO Y SIN LISTA BLANCA.
 *
 * El titulo mas CADA CLAVE del objeto de opciones. El razonamiento entero
 * —por que no se enumeran los campos, por que las URLs entran y que se queda
 * fuera— esta en el docblock de `NOTIFICACION_ORIGINAL`.
 *
 * CADA VALOR PASA POR `cuerpoDeUnaBaliza`, que es el desmenuzador que el octavo
 * canal escribio para `sendBeacon` y que el decimocuarto y el decimosexto ya
 * reusan. Hacen falta las dos cosas que sabe hacer:
 *
 *  - CAER EN `comoTexto` para un objeto, que es lo que ya hacen el `detail` de
 *    `performance.mark` y el valor de un `put` de IndexedDB. `data` acepta
 *    cualquier cosa estructurada y el dato suele ir ANIDADO, asi que mirar solo
 *    las cadenas de primer nivel dejaria pasar la forma normal de la fuga.
 *  - Y DECODIFICAR LOS BYTES. `data` no es JSON: es un valor CLONABLE
 *    ESTRUCTURADAMENTE, asi que admite un `Blob` y un `ArrayBuffer`, y los dos
 *    se serializan a `{}` con un `JSON.stringify`. Es exactamente la rama que
 *    el guardian del disco privado encontro muerta en `cuerpoDeUnaBaliza`, y
 *    aqui sale gratis por reusarlo en vez de escribir otra decodificacion.
 *
 * SE EXPORTA SOLO PARA SU GUARDIAN, `centro-de-notificaciones.spec.ts`, por el
 * mismo motivo por el que se exportan `formaQueSeFue`, `vinoDePedir`,
 * `escondidoEnElCuerpo` y `contenidoDeUnaEscrituraEnDisco`: si esto se
 * «simplificara» a mirar `title` y `body`, los 81 specs seguirian en verde y el
 * canal se quedaria ciego para el `tag`, para `data` y para las tres URLs.
 * Ningun spec de pantalla lo llama.
 */
export function camposDeUnAviso(titulo: unknown, opciones: unknown): CampoDeUnAviso[] {
  /**
   * SI UN CAMPO ESTA VACIO SE DECIDE SOBRE EL VALOR CRUDO, NO SOBRE EL TEXTO.
   *
   * Y eso NO se dedujo: lo encontro este canal en la primera corrida de su
   * guardian. El filtro estaba escrito sobre el resultado de `comoTexto`
   * —`campo.contenido.trim() !== ''`— y era UNA RAMA MUERTA, porque
   * `comoTexto([''])` devuelve ` ""` (la representacion de texto mas el JSON)
   * y eso no se vacia con un `trim`. O sea que un `{ body: '', tag: '' }` se
   * anotaba como dos campos con `""` dentro: un `includes` por campo vacio en
   * cada afirmacion, y —lo que importa— el mensaje de la forma fuerte
   * enumerando campos que el aviso no lleva.
   *
   * Es la misma leccion que el guardian del disco privado se llevo con
   * `instanceof ArrayBuffer`: una condicion que parece obvia y que en este
   * entorno no es cierta, invisible mientras nadie la mida.
   */
  const vacio = (valor: unknown): boolean =>
    valor === undefined || valor === null || (typeof valor === 'string' && valor.trim() === '');

  const campos: CampoDeUnAviso[] = vacio(titulo)
    ? []
    : [{ nombre: 'titulo', contenido: cuerpoDeUnaBaliza(titulo) }];

  if (typeof opciones === 'object' && opciones !== null) {
    for (const [clave, valor] of Object.entries(opciones as Record<string, unknown>)) {
      if (vacio(valor)) continue;

      campos.push({ nombre: clave, contenido: cuerpoDeUnaBaliza(valor) });
    }
  }

  return campos;
}

/**
 * UNA NOTIFICACION DE MENTIRA: ANOTA Y NO MUESTRA NADA.
 *
 * No reenvia a nada, como la baliza, como `caches` y como el disco privado: en
 * jsdom no hay centro de notificaciones debajo al que reenviar. La instancia
 * se queda con los campos que la plataforma expone —`title`, `body`, `tag`,
 * `data`— porque quien construye un aviso a veces los vuelve a leer, y con los
 * cuatro manejadores a `null` para que asignarles algo no explote.
 *
 * SE EXPORTA SOLO PARA SU GUARDIAN, como `raizDeMentira`: el guardian arma su
 * propia clase con su propio `anotar`, construye un aviso y mide que cada
 * campo queda anotado. Hacerlo contra el tapon de verdad no se puede —mostrar
 * una notificacion es, por la forma fuerte, el fallo—. Ningun spec de pantalla
 * lo llama.
 */
export function notificacionDeMentira(anotar: (aviso: AvisoMostrado) => void) {
  return class {
    readonly title: string;
    readonly body: string;
    readonly tag: string;
    readonly data: unknown;
    onclick: unknown = null;
    onclose: unknown = null;
    onerror: unknown = null;
    onshow: unknown = null;

    constructor(titulo: unknown, opciones?: unknown) {
      // Se ANOTA ANTES de nada, como en el resto del tapon: si algo de aqui
      // abajo explotara, el aviso ya esta registrado.
      anotar({ puerta: 'new Notification', campos: camposDeUnAviso(titulo, opciones) });

      const init = (typeof opciones === 'object' && opciones !== null ? opciones : {}) as Record<
        string,
        unknown
      >;

      this.title = String(titulo ?? '');
      this.body = typeof init.body === 'string' ? init.body : '';
      this.tag = typeof init.tag === 'string' ? init.tag : '';
      this.data = init.data ?? null;
    }

    close(): void {}
    addEventListener(): void {}
    removeEventListener(): void {}
    dispatchEvent(): boolean {
      return true;
    }

    /**
     * EL VALOR QUE DECIDE SI ESTE CANAL VE ALGO. Ver el docblock de arriba.
     *
     * Un GETTER y no una propiedad de datos, que es como lo expone la
     * plataforma: `Notification.permission` es de solo lectura, y un codigo que
     * intente asignarlo no debe poder dejar el canal ciego.
     */
    static get permission(): string {
      return 'granted';
    }

    static get maxActions(): number {
      return 2;
    }

    /**
     * NO ES UNA PUERTA DE ESTE CANAL Y NO SE ANOTA: no saca ningun dato.
     *
     * Se monta igualmente porque `boton-de-push.tsx` la llama de verdad, y se
     * admite la forma con callback ademas de la promesa porque las dos estan en
     * la plataforma y la vieja sigue siendo codigo que alguien escribe.
     */
    static requestPermission(alResponder?: unknown): Promise<string> {
      if (typeof alResponder === 'function') (alResponder as (permiso: string) => void)('granted');

      return Promise.resolve('granted');
    }
  };
}

/**
 * Como nombrar una notificacion en un informe SIN publicar lo que lleva.
 *
 * La puerta y los NOMBRES de los campos; nunca el contenido, que es justamente
 * lo que esta fuga se lleva. Y los nombres por `claveSegura`, como las claves
 * de los almacenes y los segmentos de una ruta del disco: un
 * `{ [claveTemporal]: 1 }` publica el dato en el propio nombre del campo.
 */
function descripcionDeUnAviso(aviso: AvisoMostrado): string {
  const campos = aviso.campos.map((campo) => claveSegura(campo.nombre)).join(', ');

  return campos === '' ? aviso.puerta : `${aviso.puerta} (${campos})`;
}

// ---------------------------------------------------------------------------
// El vigesimo canal: los objetos publicados con URL (`URL.createObjectURL`)
// ---------------------------------------------------------------------------

/**
 * `URL.createObjectURL` NO EXISTE EN JSDOM, y por eso hay que PONERLO.
 *
 * Medido con una sonda: `typeof URL.createObjectURL` es `'undefined'` en jsdom
 * 26, y `revokeObjectURL` tampoco esta. Igual que con `sendBeacon`, `caches`,
 * IndexedDB, el disco privado y `Notification`, eso NO es cobertura aunque lo
 * parezca: la forma que escribe quien programa con cuidado —un
 * `typeof URL.createObjectURL === 'function'` delante— no revienta, NO HACE
 * NADA y pasa en verde, mientras en el navegador del mostrador publica el
 * objeto.
 *
 * MEDIDO EN LA FASE 14, en la liquidacion de una profesora: un enlace
 * «Descargar» armado en el render con
 * `href={URL.createObjectURL(new Blob([csv]))}` —el CSV con el nombre, lo que
 * se paga y la tarifa de cada franja— PASO LOS 1874 TESTS DEL PAQUETE con los
 * diecisiete canales enchufados. Es de los patrones mas comunes que hay para
 * descargar algo en React, y casi nadie lo revoca.
 *
 * EL DATO ACABA EN UN SITIO QUE NO ES NINGUNO DE LOS OTROS: el almacen de
 * blobs del documento. No esta en el `<body>` —el marcado lleva `blob:…/uuid`,
 * no el contenido—, no es una peticion, no es un almacen con API propia y no
 * se serializa en ninguna parte. Pero el objeto sigue vivo hasta que alguien
 * lo revoque o se cierre el documento, y en una aplicacion de una sola pagina
 * el documento NO SE CIERRA AL SALIR DE LA SESION: el sueldo de la profesora
 * sigue en memoria para el turno siguiente, y `chrome://blob-internals` lo
 * enseña entero a quien se siente delante, sin ninguna contraseña.
 *
 * SE AFIRMA POR CENTINELAS Y ADEMAS POR LA FORMA FUERTE —«al terminar el test
 * no queda ningun objeto publicado sin revocar»— y se lee DESPUES del
 * `cleanup()`. Las dos cosas van juntas, y es lo que deja pasar el uso
 * legitimo sin abrirle la puerta a la fuga:
 *
 *  - Una descarga bien hecha crea la URL en el `onClick`, hace el `click()` del
 *    enlace y la revoca en la linea siguiente: al terminar el test no queda
 *    nada.
 *  - Una vista previa —el `<img>` de un comprobante antes de subirlo— la crea
 *    al montar y la revoca en la limpieza de su `useEffect`: leida despues del
 *    desmontaje, tampoco queda nada.
 *  - Lo unico que queda es lo que nadie revoca nunca, que es exactamente la
 *    fuga.
 *
 * Hoy no hay un solo `createObjectURL` en `apps/web/src`, y con este canal
 * puesto los specs siguen en verde: la forma fuerte sale gratis. Lo que NO
 * cubre, dicho entero: una revocacion aplazada con `setTimeout` —la forma de
 * «darle tiempo al navegador a empezar la descarga»— cuenta como no revocada
 * si el test termina antes. Es una falsa alarma y no un agujero, y se arregla
 * esperando en el test, no abriendo el canal.
 *
 * El precio, el de siempre: a partir de aqui la deteccion de capacidades ve
 * una API que jsdom no tiene. Y lo custodia un spec propio,
 * `objetos-con-url.spec.ts`, porque ningun spec de pantalla toca este canal.
 */
const CREAR_UNA_URL_DE_OBJETO_ORIGINAL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
const REVOCAR_UNA_URL_DE_OBJETO_ORIGINAL = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');

/** Un objeto publicado con `createObjectURL` y todavia sin revocar. */
export interface ObjetoPublicado {
  /** El tipo, para el informe: `text/csv`, `File`… Va por `claveSegura`. */
  tipo: string;
  /** Lo que lleva, en texto, para buscar centinelas dentro. */
  contenido: string;
}

export interface AlmacenDeObjetos {
  crear: (objeto: unknown) => string;
  revocar: (url: unknown) => void;
  /** Lo que sigue publicado, en el orden en que se publico. */
  vivos: () => ObjetoPublicado[];
}

/** El tipo de un objeto publicado, sin leer su contenido. */
function tipoDeUnObjeto(objeto: unknown): string {
  if (objeto instanceof Blob && objeto.type !== '') return objeto.type;
  if (typeof objeto === 'object' && objeto !== null) return objeto.constructor.name;

  return typeof objeto;
}

/**
 * EL ALMACEN DE OBJETOS CON URL, exportado como `raizDeMentira` y
 * `notificacionDeMentira`: el tapon instala uno por test, y el guardian arma
 * los suyos sin tocar nada global.
 *
 * El contenido se lee EN EL ACTO, al publicar, reusando `cuerpoDeUnaBaliza`
 * —que ya sabe leer un `Blob` por dentro, y un `File` es un `Blob`—: un
 * objeto que se publica y despues se muta no existe —un `Blob` es
 * inmutable—, y leerlo al final obligaria a guardar el objeto entero.
 *
 * REVOCAR UNA URL QUE NO ES SUYA NO BORRA NADA, como en la plataforma: es la
 * propiedad que impide que un `revokeObjectURL('')` de cortesia vacie el
 * almacen y deje la fuga en verde.
 */
export function almacenDeObjetosDeMentira(): AlmacenDeObjetos {
  const publicados = new Map<string, ObjetoPublicado>();
  let cuantos = 0;

  return {
    crear(objeto) {
      cuantos += 1;
      const url = `blob:${window.location.origin}/objeto-${cuantos}`;
      publicados.set(url, { tipo: tipoDeUnObjeto(objeto), contenido: cuerpoDeUnaBaliza(objeto) });

      return url;
    },
    revocar(url) {
      publicados.delete(String(url));
    },
    vivos: () => [...publicados.values()],
  };
}

/**
 * EL TAPON DE LOS DIECIOCHO CANALES —Y EL EJE DECIMONOVENO—, en todos los specs.
 *
 * Los dieciocho canales son los de abajo. El eje decimonoveno no es uno de ellos:
 * es el despacho de los eventos de salida de la pestaña, que corre como
 * PRIMERA linea del `afterEach` para que los dieciocho miren un mundo en el que la
 * pestaña ya se cerro. Vive en `src/test/salida-de-la-pestana.ts` y el porque
 * de su sitio exacto esta ahi y en el comentario de esa primera linea.
 *
 * **La consola.** Antes de que esto existiera, ni un solo spec de `apps/web`
 * mencionaba `console`, y un `console.info('[alta]', respuesta)` —la traza de
 * depuracion mas banal que existe— pasaba las cincuenta pruebas de la pantalla
 * del alta con la unica contraseña del sistema que se ve una vez dentro. El
 * daño es concreto: la maquina del mostrador la usan cuatro personas por turno,
 * la consola guarda lo dicho mientras la pestaña viva, y cualquier SDK de
 * errores que se enchufe mañana se lleva eso como breadcrumb a un servidor de
 * terceros sin que nadie lo decida. El espia REGISTRA Y DEJA PASAR: tragarse la
 * salida dejaria mudo al propio test el dia que React avise de algo por la
 * consola, que es justo cuando hace falta leerlo.
 *
 * **El titulo.** `document.title` va a la base de historial EN DISCO, al archivo
 * de restauracion de sesion, al conmutador de pestañas —visible para quien pase
 * por detras del mostrador—, a cualquier captura o pantalla compartida, y es lo
 * que toda SDK de analitica manda por defecto como nombre de pagina. Un
 * gimnasio que enchufe analitica mañana publica sus codigos de invitacion a un
 * tercero sin que nadie lo decida.
 *
 * **El nombre de la pestaña.** `window.name` es el UNICO almacen del navegador
 * que no esta atado al origen: no es como `localStorage`, `sessionStorage` ni
 * las galletas. Lo que una pantalla escriba ahi sigue ahi cuando la persona del
 * mostrador escribe otra direccion en la MISMA pestaña, y lo lee entero el
 * sitio al que vaya. Cualquier sitio. Un `window.name = 'anotados:' + nombres`
 * en la ficha de un turno —"para reconocer la pestaña cuando hay varias
 * abiertas"— paso los 971 tests del paquete: el DOM, las dos caches, los dos
 * almacenes, la consola, el titulo y las listas blancas de peticiones no lo
 * ven, y el spec de esa misma ficha monta ese bloque y tampoco. De ese canal se
 * afirma que esta VACIO y no que no contiene tal dato: su gracia es que se
 * lleva CUALQUIER cosa, y un centinela solo cubre la cadena que alguien se
 * acordo de escribir.
 *
 * **La cabecera del documento.** React 19 sube SOLO al `<head>` los `<meta>`,
 * `<title>` y `<link>` que se rendericen en cualquier parte del arbol, desde un
 * componente cliente, sin tocar el `metadata` de Next ni el layout. Y TODO este
 * repo afirma sobre el `<body>`: `screen.*`, `document.body.innerHTML`, los
 * `querySelectorAll` y el arbol de accesibilidad. Un
 * `<meta name="description" content={...}>` en el bloque de vacaciones de una
 * ficha —con nombre, correo, telefono y las fechas en que esa persona no esta
 * en su casa— paso los 1272 tests del paquete: medido con una sonda, el nodo
 * estaba en el `<head>` y `document.body.querySelector('meta')` daba `null`.
 * Duele porque `<meta name="description">` es EL campo que las SDK de analitica
 * mandan por defecto como descripcion de pagina, el que leen los
 * previsualizadores de enlaces y los rastreadores, y sale entero con «ver
 * codigo fuente» y en cualquier volcado del DOM. Y la linea pasa una revision
 * sin hacer ruido: parece SEO. Se afirman LAS DOS MITADES —que no crecio y que
 * no lleva centinelas— porque no son la misma: ver abajo.
 *
 * **Los tres almacenes.** `localStorage`, `sessionStorage` y las galletas. El
 * agujero no era del repo sino de los specs: siete pantallas tenian el test,
 * cada una con SU COPIA A MANO de `contenidoDe` y `galletasDelDocumento`, y a
 * las demas simplemente les faltaba sin que nada avisara. Un
 * `localStorage.setItem` tras un alta con el nombre de una profesora y su
 * tarifa —tres lineas que parecen una cortesia, «para rellenar el siguiente
 * horario»— sobrevivio a los 48 tests de la pantalla de la nomina: deja nombre
 * y tarifa en el disco de la maquina del mostrador, y sobrevive al logout y al
 * cambio de persona. Se afirma sobre las CLAVES y no sobre los valores: el
 * `toEqual` con los contenidos que tenian algunas copias a mano imprimiria en
 * el informe de CI justamente el dato que se escapo.
 *
 * **El buffer de User Timing.** `performance.mark` y `performance.measure`. Un
 * `performance.mark(`stats:caja:2026-3:fin:margen=${datos.margen.texto}`)` en
 * el hook de los reportes —y su gemelo con el `perfilId` del alumno en el de
 * asistencia— sobrevivio a los 1296 tests del paquete: medido con una sonda,
 * `performance.getEntriesByType('mark')` devolvia las marcas enteras, con el
 * margen del salon y el id dentro. Duele porque ese buffer lo lee cualquier
 * script de la pagina con UNA linea, sobrevive a toda la navegacion de la SPA,
 * sale entero en cualquier traza de rendimiento que se mande a soporte, y las
 * SDK de RUM —Datadog, NewRelic, Sentry performance— se llevan los user
 * timings POR DEFECTO, sin que nadie lo decida, exactamente como pasa con
 * `document.title`. Y pasa una revision sin ruido: parece medir latencia.
 *
 * **El `src` de una imagen.** `new Image().src = '…'` es una peticion de red
 * que no pasa por `fetch`, no esta en el `<body>` —la imagen nunca se adjunta
 * al documento—, no esta en el `<head>` y no toca ninguno de los otros cinco
 * canales. Medido en la Fase 11: un pixel con el reporte operativo entero en
 * el query —`uso.gif?d=${JSON.stringify(datos)}`, tres lineas en un
 * `useEffect` que parecen una metrica de uso— paso los 1326 tests del paquete,
 * incluido el de «no habla con la red por fuera de `pedir`», que dobla el
 * `fetch` global y por tanto no lo ve. El daño es el de siempre y uno mas: la
 * URL sale al servidor del otro lado con la cookie de sesion si comparte
 * dominio, y queda escrita en SU registro de acceso, que no es nuestro.
 * Se vigilan las dos mitades —lo que se ASIGNA al accesor y lo que QUEDA en el
 * documento— por lo mismo que los almacenes: el accesor no ve un
 * `setAttribute('src', …)` y la barrida no ve una imagen suelta que nunca se
 * adjunto. Y se afirma por centinelas, no por estar vacio: pedir imagenes es
 * legitimo y este repo ya lo hace.
 *
 * **Las salidas laterales.** `window.postMessage`, `BroadcastChannel` y
 * `navigator.sendBeacon`: tres puertas que no son `fetch` ni el DOM. Medido en
 * esta fase: un `window.postMessage({ tipo: 'analisis:caja-lista', caja }, '*')`
 * en un `useEffect` de la pantalla de la caja —«avisarle al armazon que los
 * numeros ya estan», con el reporte entero adentro porque elegir campos era
 * mas trabajo— paso los 1352 tests del paquete. No lo ve el test de «no habla
 * con la red por fuera de `pedir`», que dobla el `fetch` global y esto no es un
 * `fetch`; no lo ven los siete canales de arriba; y no lo ve ningun test de
 * pantalla, que mira el `<body>`. El daño es distinto en cada puerta y por eso
 * el informe las separa: el mensaje se lo lleva cualquier script que comparta
 * la pagina —y el documento que nos enmarque, si la escritura es
 * `parent.postMessage(…, '*')`—, la difusion se la lleva cualquier OTRA
 * PESTAÑA del mismo origen —en la maquina del mostrador, la que dejo abierta
 * el turno anterior— y la baliza es una peticion de red que SOBREVIVE AL
 * CIERRE DE LA PESTAÑA, no se puede cancelar y no devuelve nada que mirar.
 * Se afirma por centinelas y no por «ninguna llamada», como el canal de
 * imagenes: comunicarse es legitimo. Y se mira el objeto ENTERO serializado,
 * como el `detail` de `performance.mark`, porque la mutacion que abrio el
 * canal llevaba el dato anidado en la segunda clave.
 *
 * **IndexedDB.** El QUINTO almacen, y el que quedo fuera porque el tapon de
 * «los tres almacenes» es una lista cerrada y `CacheStorage` se agrego como
 * cuarto. Medido en esta fase: un borrador del formulario de SMTP
 * —`indexedDB.open('boxadmin-config', 1)` y un `put(variables, 'smtp')` en
 * `onsuccess`, tres lineas que parecen una cortesia «por si alguien recarga a
 * medio configurar»— guardaba host, usuario y LA CLAVE DEL SERVIDOR DE CORREO
 * EN CLARO, y paso los 1481 tests del paquete con los diez canales enchufados.
 * Pasa porque `typeof indexedDB` es `'undefined'` en jsdom y el `?.` que
 * escribe quien programa con cuidado convierte la ausencia del entorno en un
 * silencio. Y es peor que los tres almacenes que si se vigilaban: sobrevive al
 * logout, al cierre de la pestaña y al reinicio igual que `localStorage`, pero
 * ademas NO TIENE TOPE DE 5 MB y GUARDA OBJETOS ESTRUCTURADOS —`put(variables)`
 * mete el objeto entero sin que nadie tenga que acordarse de serializar—. Se
 * vigilan LAS TRES PUERTAS de escritura —`put`, `add` y `cursor.update`, que no
 * pasa por ninguna de las otras dos—, la CLAVE ademas del valor —un
 * `put(1, claveSecreta)` esconde el dato en el nombre— y el NOMBRE DE LA BASE.
 * Se afirma por LA FORMA FUERTE —«no se abrio ninguna base»— y no por
 * centinelas, que es la unica vez que se elige eso desde `window.name`: el
 * motivo medido, y por que `serwist` —que si usa IndexedDB— no lo invalida,
 * estan en el docblock de `INDEXED_DB_ORIGINAL`.
 *
 * **El `<html>` y el `<body>`: sus atributos, y lo que CUELGA del `<html>`.**
 * Los dos elementos que
 * envuelven al cuerpo, y que no mira NADIE: los once canales de arriba miran
 * la consola, el titulo, el nombre de la pestaña, el CONTENIDO del `<head>`,
 * los cinco almacenes, User Timing, el `src` de una imagen, las tres salidas
 * laterales, el service worker e IndexedDB, y los tests de pantalla miran lo
 * que hay DENTRO del `<body>`. Entre las dos cosas quedaban dos elementos
 * enteros. Medido en esta fase: un
 * `document.documentElement.dataset.ultimoHealthCheck = jobId` en un
 * `useEffect` —una «marca de diagnostico», que es como se ponen los temas, los
 * idiomas y las banderas de funcionalidad— paso los 1494 tests del paquete con
 * los once canales enchufados. Y ES DISTINTO DE LOS CINCO ANTERIORES: aquellos
 * pasaban por APIs que jsdom no implementa, asi que la fuga vivia detras de un
 * `?.` que la delataba; jsdom implementa ESTO entero, la linea es identica en
 * el test y en el navegador y corre de verdad en los dos. El sitio no estaba
 * ciego por el entorno, estaba ciego porque nadie lo nombro. Se afirma por LA
 * FORMA FUERTE —ni un atributo, contra el conjunto VACIO y no contra una foto
 * inicial, porque con la foto un atributo dejado por un test ANTERIOR pasaria
 * en verde— y el motivo por el que esa forma es legitima esta medido, no
 * leido: el docblock de `ALREDEDOR_DEL_CUERPO`. Y ESTE CANAL TIENE UNA SEGUNDA
 * MITAD: LO QUE CUELGA DEL `<html>` fuera del `<head>` y del `<body>`. Medido
 * en la Fase 14 con el catalogo de packs entero dentro —tres nombres y dos
 * precios EN CLARO—: un `document.documentElement.append(marca)` con el
 * `JSON.stringify` de la lista en el `textContent` paso los 1841 tests, y la
 * variante con el dato en un atributo tambien. Cae en el hueco entre TRES
 * defensas —el cuarto canal mira los HIJOS DEL `<head>`, este miraba los
 * ATRIBUTOS de los dos elementos y no sus hijos, y los tests de pantalla miran
 * lo que hay DENTRO del `<body>`— y `cleanup()` tampoco lo quita, asi que
 * sobrevive a su propio test y el tapon lo DESCUELGA antes de afirmar, igual
 * que borra los atributos. Se afirma tambien por la forma fuerte —«el `<html>`
 * no tiene un tercer hijo»—, que sale gratis y esta medida dos veces: una
 * sonda dice que en un test normal los hijos son exactamente `['HEAD','BODY']`
 * y el paquete entero sigue en verde con la afirmacion puesta. El caso
 * simetrico —un nodo colgado del `<head>`— SI estaba cubierto, y se comprobo
 * con una sonda en vez de darse por hecho.
 *
 * **La URL del documento.** EL HUECO ENTRE LAS DOS DEFENSAS: los doce canales
 * de arriba miran todo lo que no es el `<body>`, los tests de pantalla miran
 * el `<body>` y la lista de peticiones, y `location` no cae en ninguno de los
 * dos lados. Medido en esta fase: un
 * `history.replaceState(null, '', '#dijo=' + config.error.message)` en la
 * pantalla de Configuracion dejo el mensaje de la API entero en la barra de
 * direcciones y paso los 1507 tests del paquete con los doce canales
 * enchufados. Es el unico canal que SE COPIA SOLO: entra en el historial en
 * disco, se pega entero cuando alguien comparte el enlace, queda en el
 * registro de acceso del siguiente servidor y VIAJA COMO `Referer` A TERCEROS,
 * sin dejar rastro en la pestaña de red ni en el marcado. Y `cleanup()` no lo
 * toca, asi que sobrevive a su propio test. Se vigilan LAS DOS MITADES —la URL
 * que QUEDA, partida en origen, ruta, query, hash y ESTADO del historial, y
 * las CINCO puertas de la History API, dobladas con `vi.spyOn` sobre
 * `History.prototype`— porque cada una caza algo que la otra no puede: un
 * `pushState(datos, '', la misma URL)` guarda el objeto en `history.state` sin
 * mover ni un caracter del `href`, y un `location.hash = …` no pasa por
 * ninguna funcion que se pueda doblar. Se afirma por LA FORMA FUERTE —«la URL
 * no cambio»— y eso no se supuso: las seis pantallas que escriben en la URL a
 * proposito lo hacen por el router de Next, y los 26 specs que lo usan lo
 * doblan con `vi.fn()` sin tocar `location`. La URL se mira ademas
 * DECODIFICADA, porque un centinela con espacios se guarda como `%20` y no
 * aparece literal. Lo que este canal NO ve —las navegaciones que no son al
 * mismo documento, que jsdom no implementa y cuyas puertas no son doblables ni
 * con un `Proxy`— esta medido y escrito entero en el docblock de
 * `PUERTAS_DEL_HISTORIAL`.
 *
 * **La red por fuera de `pedir`.** `fetch`, `XMLHttpRequest`, `WebSocket`,
 * `EventSource`, `Worker` y `SharedWorker`. Es LA DEFENSA QUE ESTE MISMO
 * DOCBLOCK DABA POR SUPUESTA: los
 * parrafos del `src` de una imagen y de las salidas laterales dicen los dos que
 * aquello se escapa porque «no es un `fetch`, asi que el test de no habla con la
 * red por fuera de `pedir` pasa en verde». MEDIDO: ese test existia a mano en
 * TRES specs de setenta y cuatro, asi que en los otros setenta y uno el `fetch`
 * global no lo doblaba nadie. En la pantalla de las clases de una profesora, un
 * `void fetch('https://…/clases', { method: 'POST', body: JSON.stringify(alumnos.data) })`
 * —la lista entera de una clase, con el nombre propio y la ausencia de cada
 * persona— paso los 19 tests de ese spec y el `tsc`. Es la tercera vez que a
 * este repo le pasa lo mismo: el espia de la consola empezo en 5 specs de 49 y
 * los tres almacenes tenian once copias a mano. Lo que se distingue no es
 * «hubo un `fetch`» —`pedir` usa `fetch` por dentro y seria rojo con el codigo
 * correcto en 23 specs— sino SI LA LLAMADA SALIO DE DENTRO DE `pedir`, que se
 * contesta leyendo la pila. `fetch` se afirma POR CENTINELAS, no por la forma
 * fuerte, y eso tambien se midio: de las 467 peticiones del paquete, 96 no son
 * de `pedir` y vienen de cinco sitios de produccion que estan ahi a proposito.
 * Las otras tres puertas se afirman por LA FORMA FUERTE —ni una peticion—,
 * porque de esas no hay un solo uso en `src/`. El criterio, las medidas, las
 * puertas que se quedan fuera y lo que esta forma deja pasar: el docblock de
 * `PuertaDeRed`. Y lo custodia un spec propio, `red-por-fuera-de-pedir.spec.ts`,
 * porque la pregunta de la pila es invisible desde cualquier spec de pantalla.
 *
 * **Lo que el marcado del `<body>` no serializa.** EL UNICO DE LOS DIECIOCHO QUE
 * VIVE DENTRO DEL CUERPO, o sea del lado que los tests de pantalla miran — y
 * que aun asi no ve ninguno, porque leen `innerHTML` y `textContent` y ahi
 * esto no sale: el `.value` de un control, que para los tipos en modo valor y
 * para un `<textarea>` es una PROPIEDAD que no se refleja a ningun atributo, y
 * el contenido de un `shadowRoot` abierto, que no entra en el `innerHTML` de
 * su anfitrion ni lo alcanza un `querySelectorAll('*')` del cuerpo. El dato
 * esta en la pagina: se pinta, se autocompleta, viaja en un envio de
 * formulario y lo lee cualquier extension. Medido: la misma mutacion
 * —`caja.current.value = JSON.stringify(alumnos)` en un `useEffect`— paso los
 * 20 tests de la agenda, con su test de marcado incluido, cuando la caja era
 * un `<input type="text">` o un `<textarea>`. Se afirma POR CENTINELAS Y CON
 * UNA RESTA, que es la forma que no tiene ningun otro canal: un centinela solo
 * cuenta si NO esta tambien en el marcado, porque una pantalla de edicion
 * pinta `<input value={nombre}>` a proposito y por todo el panel. Lo que se
 * afirma no es «no hay centinelas» sino «no hay ninguno ESCONDIDO». Y una
 * correccion que salio de medir y que conviene no volver a perder: con
 * `type="hidden"` esa mutacion NO se escapa —ese tipo esta en modo defecto y
 * su `.value` SI se refleja al atributo—, asi que el agujero no es el `<input>`
 * escondido sino el `.value` que no se refleja. Los tipos medidos uno a uno,
 * lo que se queda fuera y por que: el docblock de `EsconditeDelCuerpo`.
 *
 * **El disco privado del origen (OPFS).** EL SEXTO ALMACEN, y el que quedo
 * fuera porque los cinco tapones de almacen leen CADA UNO SU PROPIA API y
 * ninguno sabe que existe un sistema de archivos. Medido en esta fase: un
 * respaldo del cobro en disco —`navigator.storage?.getDirectory?.()` y un
 * `flujo.write(JSON.stringify(pago))` en el `onSuccess` de una mutacion de
 * cobro, con el monto, la nota, el `perfilId`, el metodo y las fechas dentro—
 * SOBREVIVIO LOS 1721 TESTS del paquete con los quince canales enchufados. El
 * control que prueba que el instrumento funcionaba: el MISMO dato, en la MISMA
 * linea, por `localStorage.setItem(...)` tira 7 tests; lo unico que cambia
 * entre caer y no caer es QUE API DE ALMACENAMIENTO SE USA. Pasa porque
 * `typeof navigator.storage` es `'undefined'` en jsdom y el `?.` que escribe
 * quien programa con cuidado convierte la ausencia del entorno en un silencio
 * —la leccion que ya dejo cinco fugas—. Y es peor que los cinco almacenes que
 * si se vigilaban: sobrevive al logout y al reinicio como `localStorage`, NO
 * TIENE EL TOPE DE 5 MB, GUARDA BYTES SIN QUE NADIE SERIALICE y NO APARECE EN
 * LA PESTAÑA «APPLICATION», donde los otros cinco se ven de un vistazo. Se
 * vigilan TODAS las puertas del arbol —`getDirectory`, `getFileHandle`,
 * `getDirectoryHandle`, `removeEntry`, `move`, `remove`, el `write` de
 * `createWritable()` y el de su `getWriter()`, y el `write` de la manija
 * SINCRONA—, EL NOMBRE del archivo y del directorio ademas del contenido —un
 * `getFileHandle(claveTemporal)` publica el secreto sin escribir un byte,
 * igual que `open(nombre)` en IndexedDB— y LAS CUATRO FORMAS del contenido
 * —cadena, `ArrayBuffer`, `Blob` y `{ type: 'write', data }`—, que se
 * desmenuzan reusando `cuerpoDeUnaBaliza`. Se afirma por LA FORMA FUERTE —«no
 * se toco el disco privado»— y el motivo medido esta en el docblock de
 * `ALMACEN_DE_ARCHIVOS_ORIGINAL`. Y lo custodia un spec propio,
 * `disco-privado.spec.ts`, porque ningun spec de pantalla toca este canal
 * nunca y cualquier simplificacion de su aritmetica lo deja verde y ciego —de
 * hecho ese guardian ya encontro una: la rama de `ArrayBuffer` de
 * `cuerpoDeUnaBaliza` estaba MUERTA en este entorno, ver `esUnArrayBuffer`—.
 *
 * **El centro de notificaciones del sistema operativo.** EL UNICO DE LOS
 * DIECIOCHO QUE NO ACABA DENTRO DEL NAVEGADOR: `new Notification(titulo,
 * opciones)` y su vecina `ServiceWorkerRegistration.showNotification(…)` sacan
 * el dato a una pantalla del SISTEMA. Medido en esta fase: un aviso de «Cobro
 * registrado» en el `onSuccess` de la mutacion de cobro de la ficha de una
 * persona —con el nombre completo, el monto, el metodo y la nota en el `body`
 * y el `perfilId` en el `tag`— SOBREVIVIO LOS 1761 TESTS del paquete con los
 * dieciseis canales enchufados. El control que prueba que el instrumento
 * funcionaba: LA MISMA TERNA DE DATOS, en la misma linea, por `console.info`
 * TIRA 7 TESTS DE 26; lo unico que cambia entre caer y no caer es la puerta.
 * Pasa porque `typeof Notification` es `'undefined'` en jsdom y porque aqui el
 * `typeof` prudente NO ES OPCIONAL —`Notification` es un binding global, asi
 * que preguntar antes es la UNICA forma correcta de usar la API—: el codigo
 * bien escrito es exactamente el que pasa en verde. Y LO QUE LO HACE GRAVE NO
 * ES LA API SINO QUE ESTE PRODUCTO YA PIDIO EL PERMISO: `boton-de-push.tsx`
 * llama a `Notification.requestPermission()`, asi que en el mostrador
 * `permission === 'granted'` no es una hipotesis. El dato se ve sin tocar
 * nada, sobrevive a la pestaña, al logout Y AL CIERRE DEL NAVEGADOR, y en
 * Windows queda en el historial de notificaciones del sistema, que no vacia
 * ningun «borrar datos del sitio». Se vigilan LAS DOS PUERTAS y TODOS los
 * campos que lleven texto —el titulo y CADA clave de las opciones, sin lista
 * blanca: `body`, `tag` y el `data` libre, y tambien `icon`, `badge` e `image`,
 * que son URLs y UNA URL LLEVA DATO IGUAL QUE UN CUERPO, como enseño el
 * septimo canal—. Se afirma por LA FORMA FUERTE —«ninguna notificacion»—
 * ademas de por centinelas, y eso se midio: en este producto los avisos los
 * muestra el SERVICE WORKER desde su manejador de `push` y lo unico que hace
 * una pagina es PEDIR EL PERMISO, que NO es una puerta de este canal. Con que
 * valor se monta `Notification.permission` —y por que con `'default'` el canal
 * queda verde y ciego— esta medido en el docblock de `NOTIFICACION_ORIGINAL`.
 * Y lo custodia un spec propio, `centro-de-notificaciones.spec.ts`.
 *
 * **Los objetos publicados con URL.** EL VIGESIMO CANAL, y no el decimoctavo:
 * esos dos numeros ya los llevaban los ejes —`rato-libre.ts` y
 * `salida-de-la-pestana.ts`— y renumerarlos costaba tocar cuatro archivos para
 * nada. `URL.createObjectURL(blob)` deja el objeto en el almacen de blobs del
 * documento hasta que alguien lo revoque, y en una aplicacion de una sola
 * pagina el documento no se cierra al salir de la sesion. Medido en la Fase
 * 14: el CSV de la liquidacion de una profesora, publicado en el render para
 * un enlace «Descargar» y nunca revocado, paso los 1874 tests; con el canal
 * puesto caen 16 de 25 en `liquidacion.spec.tsx`, y la misma linea revocada en
 * la limpieza de un `useEffect` pasa los 25. Se afirma por centinelas Y por la
 * forma fuerte, leyendo DESPUES del `cleanup()`: el motivo y lo que no cubre
 * estan en el docblock de `CREAR_UNA_URL_DE_OBJETO_ORIGINAL`. Lo custodia
 * `objetos-con-url.spec.ts`.
 *
 * EL CUARTO VECINO DE ESA FAMILIA —`navigator.clipboard`— NO SE VIGILA, a
 * proposito y con el motivo medido escrito al lado de los otros tres: el panel
 * copia secretos registrados a proposito en DOS pantallas, y los tres specs
 * que ejercitan el portapapeles le pisan el objeto entero a `navigator` desde
 * dentro del test, donde ningun `beforeEach` llega. Un espia alli estaria
 * ciego justo donde el canal se usa. El razonamiento entero, el criterio que
 * si los distinguiria y el agujero que queda: en el comentario de
 * `textoDeUnBlob`, justo encima de `claveSegura`.
 *
 * Se vigilan las DOS puertas y las DOS mitades de cada una. `measure` crea una
 * entrada con nombre propio igual que `mark`, asi que cubrir solo `mark`
 * dejaria el agujero abierto cambiando una palabra. Y el `detail` —el segundo
 * argumento de las dos— va DENTRO de la entrada y sale en su `toJSON()`:
 * medido en jsdom 26, un `mark(nombre, { detail: { clave } })` devuelve la
 * clave entera en el volcado. Por eso se miran nombre Y detalle.
 *
 * EL PUNTO CIEGO DE LOS RELOJES FALSOS, YA TAPADO, Y NO DESDE AQUI.
 * `vi.useFakeTimers()` sin `toFake` sustituia el objeto `performance` global
 * por el falso de sinon, que acepta `mark()` y no guarda nada: mientras un
 * test tuviera los relojes falsos enteros puestos, este canal no veia nada —ni
 * el espia, que quedo colgado del objeto de verdad, ni el buffer, al que la
 * marca nunca llegaba—. Medido: con una marca sembrada en el codigo de
 * produccion, los tres sitios que escribian la linea desnuda (`ausencias`, la
 * ficha de `usuarios/[id]` y `use-calendario-admin`) pasaban en verde.
 *
 * Ya no se arregla spec a spec: `vitest.config.ts` fija un `toFake` POR
 * DEFECTO que no incluye `performance`, asi que el proximo
 * `vi.useFakeTimers()` nace cubierto sin que nadie tenga que acordarse. De
 * donde sale esa lista y quien la vigila: `src/test/relojes-falsos.ts`.
 *
 * Lo de abajo —guardar `EL_CRONOMETRO` y vaciar el buffer por el— se queda
 * igual: un spec puede pasar SU PROPIO `toFake` con `performance` dentro, y
 * entonces el `performance` global vuelve a ser el falso.
 */
export function vigilarLosCanalesDeSalida(): void {
  const dicho: unknown[] = [];
  let tituloAlEmpezar = '';
  let cabeceraAlEmpezar = new Set<Element>();
  let almacenesAlEmpezar = estadoDeLosAlmacenes();
  const escrito: EscrituraEnAlmacen[] = [];
  const cronometrado: EntradaDeTiempo[] = [];
  const imagenesPedidas: string[] = [];
  const mensajesMandados: string[] = [];
  const mensajesDifundidos: string[] = [];
  const balizasMandadas: string[] = [];
  const respuestasGuardadas: RespuestaGuardada[] = [];
  const mensajesAlTrabajador: string[] = [];
  const basesAbiertas: string[] = [];
  const escritoEnLaBase: EscrituraEnLaBase[] = [];
  const navegado: LlamadaAlHistorial[] = [];
  const pasosPorElDisco: PasoPorElDisco[] = [];
  const avisosMostrados: AvisoMostrado[] = [];
  let objetosConUrl = almacenDeObjetosDeMentira();

  /**
   * EL OYENTE DEL DECIMOQUINTO CANAL SE PONE AQUI, UNA VEZ POR ARCHIVO.
   *
   * Fuera de los hooks a proposito, como `montarElRatoLibre` y por el mismo
   * motivo: no es un espia que un `vi.restoreAllMocks()` pueda devolver a su
   * sitio, es un oyente de verdad sobre el `document`, que no desmonta nadie.
   * Ponerlo en el `beforeEach` apilaria uno por test y los 1665 se irian
   * sumando sobre el mismo nodo.
   */
  document.addEventListener('input', anotarLoTecleado, true);
  document.addEventListener('change', anotarLoTecleado, true);

  beforeEach(() => {
    tituloAlEmpezar = document.title;
    cabeceraAlEmpezar = new Set(nodosDeLaCabecera());
    almacenesAlEmpezar = estadoDeLosAlmacenes();
    dicho.length = 0;
    escrito.length = 0;
    cronometrado.length = 0;
    imagenesPedidas.length = 0;
    mensajesMandados.length = 0;
    mensajesDifundidos.length = 0;
    balizasMandadas.length = 0;
    respuestasGuardadas.length = 0;
    mensajesAlTrabajador.length = 0;
    basesAbiertas.length = 0;
    escritoEnLaBase.length = 0;
    navegado.length = 0;
    pasosPorElDisco.length = 0;
    avisosMostrados.length = 0;
    PETICIONES_DE_RED.length = 0;
    elDobleDeLaRed = undefined;

    const consola = console as unknown as Record<string, (...partes: unknown[]) => void>;

    // Se engancha en CADA test y no una vez: los specs llaman a
    // `vi.restoreAllMocks()` en su propio `afterEach`, que con el orden de
    // hooks de Vitest corre ANTES que este tapon y devuelve la consola a su
    // sitio. Sin volver a engancharla, a partir del segundo test el espia
    // estaria mirando una consola que ya nadie dobla, y pasaria en verde.
    for (const nombre of metodosDeConsola()) {
      const original = consola[nombre]?.bind(console);

      vi.spyOn(consola, nombre).mockImplementation((...partes: unknown[]) => {
        dicho.push(...partes);
        original?.(...partes);
      });
    }

    /**
     * LOS ALMACENES SE MIRAN DE DOS FORMAS, Y HACEN FALTA LAS DOS.
     *
     * Por el ESTADO (lo que haya guardado al terminar) y por las ESCRITURAS
     * (doblando `setItem` y el `document.cookie =`). No es redundancia:
     *
     * - El estado solo no basta porque los specs limpian los almacenes en SU
     *   propio `afterEach`, que con el orden de hooks de Vitest corre ANTES que
     *   este tapon: lo que el test guardo ya no esta cuando miramos. Ademas,
     *   una escritura seguida de un `removeItem` no deja estado y pasaria.
     * - Las escrituras solas no bastan porque en jsdom `localStorage.lo = 'x'`
     *   —asignacion por propiedad— NO pasa por `setItem`: lo resuelve el proxy
     *   del almacen. Medido con una sonda. Ese camino solo lo ve el estado.
     */
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      clave: string,
      valor: string,
    ) {
      escrito.push({
        almacen: this === sessionStorage ? 'sessionStorage' : 'localStorage',
        clave,
        valor,
      });

      // REGISTRA Y DEJA PASAR, como el espia de la consola: tragarse la
      // escritura cambiaria lo que hace la pantalla bajo prueba.
      PONER_EN_UN_ALMACEN.call(this, clave, valor);
    });

    // Las galletas no tienen metodo que doblar: son un ACCESOR de
    // `Document.prototype`. Se redefine como propiedad propia de `document`
    // —`vi.restoreAllMocks()` no la toca— y se borra la de la vuelta anterior
    // antes, para no envolver el enganche de ayer.
    delete (document as unknown as Record<string, unknown>).cookie;

    const leer = GALLETAS_ORIGINALES?.get;
    const poner = GALLETAS_ORIGINALES?.set;

    if (leer !== undefined && poner !== undefined) {
      Object.defineProperty(document, 'cookie', {
        configurable: true,
        get: () => leer.call(document) as string,
        set: (texto: string) => {
          const corte = String(texto).indexOf('=');
          const clave = corte === -1 ? String(texto) : String(texto).slice(0, corte);
          const resto = corte === -1 ? '' : String(texto).slice(corte + 1);

          escrito.push({
            almacen: 'galletas',
            clave: clave.trim(),
            // Solo el VALOR, sin los atributos (`; path=`, `; expires=`): lo
            // que se guarda es lo de antes del primer punto y coma.
            valor: (resto.split(';')[0] ?? '').trim(),
          });

          poner.call(document, texto);
        },
      });
    }

    /**
     * EL BUFFER DE MARCAS SE MIRA DE DOS FORMAS, Y HACEN FALTA LAS DOS.
     *
     * Igual que los almacenes: por lo que QUEDA en el buffer al terminar y por
     * las LLAMADAS, doblando `mark` y `measure`. No es redundancia:
     *
     * - El buffer solo no basta porque `performance.clearMarks()` es parte de
     *   la API publica y es lo que escribe cualquiera que «mida y limpie». Una
     *   marca con el margen del salon seguida de un `clearMarks()` tres lineas
     *   despues no deja rastro en el buffer, igual que un `setItem` seguido de
     *   un `removeItem` no deja estado. Medido con una sonda.
     * - Las llamadas solas no bastan porque solo ven lo que pase DESPUES de
     *   este `beforeEach`: una marca puesta en el cuerpo de un modulo —al
     *   importarlo— ya esta en el buffer antes de que exista el espia. Medido:
     *   `getEntriesByType('mark')` la devuelve en el primer test del archivo.
     *
     * Se engancha en CADA test por el mismo motivo que la consola: los specs
     * llaman a `vi.restoreAllMocks()` en su propio `afterEach`, que corre ANTES
     * que este tapon y devuelve los dos metodos a su sitio.
     */
    const llamada = (tipo: TipoDeEntrada) =>
      function (this: Performance, ...partes: unknown[]) {
        cronometrado.push({
          tipo,
          nombre: String(partes[0]),
          detalle: detalleDeLasOpciones(partes[1]),
        });

        // REGISTRA Y DEJA PASAR, como el resto del tapon. Y se reenvia con
        // `apply` y los argumentos TAL CUAL: `measure(nombre, opciones)` y
        // `measure(nombre, marcaInicial, marcaFinal)` son dos sobrecargas que
        // WebIDL distingue por `arguments.length`, asi que rellenar el tercero
        // con `undefined` cambiaria cual se elige.
        return (tipo === 'mark' ? MARCAR : MEDIR).apply(this, partes as [string]);
      };

    vi.spyOn(PROTOTIPO_DEL_CRONOMETRO, 'mark').mockImplementation(
      llamada('mark') as Performance['mark'],
    );
    vi.spyOn(PROTOTIPO_DEL_CRONOMETRO, 'measure').mockImplementation(
      llamada('measure') as Performance['measure'],
    );

    /**
     * EL `src` DE UNA IMAGEN ES UN ACCESOR DEL PROTOTIPO, no un metodo.
     *
     * Se redefine igual que las galletas y por los mismos dos motivos: un
     * `vi.spyOn` sobre un accesor no sobrevive al `vi.restoreAllMocks()` que
     * los specs llaman en SU `afterEach` —que corre ANTES que este tapon—, y
     * hay que envolver SIEMPRE el descriptor ORIGINAL, cogido una vez al
     * cargar, para que enganchar en cada test no apile un envoltorio sobre el
     * de ayer y cuente cada asignacion siete veces.
     *
     * CUBRE TAMBIEN EL `<img>` DE JSX, y eso se midio con una sonda en lugar
     * de suponerlo: React 19 acaba pasando por este mismo accesor al pintar un
     * `<img src=…>`, no solo por `setAttribute`. O sea que un `<img>` escondido
     * en el arbol con el dato en la URL cae por aqui aunque nadie mire ese
     * nodo. Lo que NO pasa por aqui es un `setAttribute('src', …)` a pelo
     * sobre un nodo suelto: para eso esta la otra mitad, la barrida del
     * documento al terminar.
     */
    const leerElSrc = SRC_DE_UNA_IMAGEN?.get;
    const ponerElSrc = SRC_DE_UNA_IMAGEN?.set;

    if (leerElSrc !== undefined && ponerElSrc !== undefined) {
      Object.defineProperty(HTMLImageElement.prototype, 'src', {
        configurable: true,
        enumerable: SRC_DE_UNA_IMAGEN?.enumerable ?? true,
        get(this: HTMLImageElement) {
          return leerElSrc.call(this) as string;
        },
        set(this: HTMLImageElement, valor: string) {
          // El valor CRUDO, antes de que el accesor lo resuelva a una URL
          // absoluta y le codifique las comillas: lo que se busca dentro es
          // un centinela tal como lo escribio quien lo filtro.
          imagenesPedidas.push(String(valor));
          ponerElSrc.call(this, valor);
        },
      });
    }

    /**
     * LAS TRES SALIDAS LATERALES, enganchadas en CADA test como el resto.
     *
     * Por el motivo de siempre: los specs llaman a `vi.restoreAllMocks()` en
     * su propio `afterEach`, que con el orden de hooks de Vitest corre ANTES
     * que este tapon. Lo que se dobla con `vi.spyOn` —el canal de difusion—
     * volveria a su sitio y el tapon miraria, a partir del segundo test de
     * cada archivo, algo que ya nadie dobla: verde y ciego.
     *
     * Las tres reenvian a la funcion ORIGINAL, cogida una vez al cargar, para
     * que volver a enganchar no apile un envoltorio sobre el de ayer y cuente
     * cada mensaje tantas veces como tests lleve el archivo.
     */
    Object.defineProperty(window, 'postMessage', {
      configurable: true,
      enumerable: false,
      writable: true,
      value: function (this: Window, ...partes: unknown[]) {
        // Solo el MENSAJE, que es lo que viaja. El segundo argumento es el
        // origen de destino —el `'*'` que hace peligrosa a esta puerta— y no
        // puede llevar un dato dentro: el navegador lo lee como un origen.
        mensajesMandados.push(comoTexto([partes[0]]));

        // REGISTRA Y DEJA PASAR, como el resto del tapon: tragarse el mensaje
        // cambiaria lo que hace la pantalla bajo prueba.
        return (MANDAR_UN_MENSAJE as (...a: unknown[]) => void).apply(this, partes);
      },
    });

    vi.spyOn(PROTOTIPO_DEL_CANAL, 'postMessage').mockImplementation(function (
      this: BroadcastChannel,
      mensaje: unknown,
    ) {
      // El NOMBRE del canal va junto al mensaje: un `new BroadcastChannel(…)`
      // bautizado con el dato lo publica igual que publicarlo en el cuerpo, y
      // cuesta lo mismo mirarlo.
      mensajesDifundidos.push(`${this.name} ${comoTexto([mensaje])}`);

      return (DIFUNDIR as (this: BroadcastChannel, m: unknown) => void).call(this, mensaje);
    });

    /**
     * LA BALIZA SON DOS SITIOS, Y HAY QUE MIRAR LOS DOS.
     *
     * La URL y el cuerpo. No es lo mismo que pasen por el mismo sitio: un
     * dato en el query sale al REGISTRO DE ACCESO del servidor del otro lado
     * —que no es nuestro, y que se guarda por defecto— mientras que uno en el
     * cuerpo sale en la peticion. Se miran juntos y se afirman juntos, como
     * las dos mitades del canal de imagenes.
     *
     * No reenvia a nada: en jsdom no hay baliza debajo. Ver arriba.
     */
    Object.defineProperty(PROTOTIPO_DEL_NAVEGANTE, 'sendBeacon', {
      configurable: true,
      enumerable: false,
      writable: true,
      value: function (url: unknown, cuerpo?: unknown): boolean {
        balizasMandadas.push(`${String(url)} ${cuerpoDeUnaBaliza(cuerpo)}`);
        return true;
      },
    });

    /**
     * EL NOVENO CANAL: el almacen de respuestas, que jsdom no trae.
     *
     * Se DEFINE, como la baliza, porque lo que hay que cazar es la forma
     * prudente —`globalThis.caches?.open(...)`—, que sin esto no hace nada y
     * pasa en verde. Y no reenvia a nada: no hay almacen debajo al que
     * reenviar, y las lecturas devuelven «no esta», que es lo que devuelve un
     * almacen vacio.
     */
    const almacenDeMentira = (nombre: string) => {
      const anotar = (peticion: unknown): void => {
        respuestasGuardadas.push({ almacen: nombre, clave: claveDeUnaPeticion(peticion) });
      };

      return {
        put: (peticion: unknown) => {
          anotar(peticion);
          return Promise.resolve(undefined);
        },
        add: (peticion: unknown) => {
          anotar(peticion);
          return Promise.resolve(undefined);
        },
        addAll: (peticiones: unknown[]) => {
          for (const una of peticiones) anotar(una);
          return Promise.resolve(undefined);
        },
        match: () => Promise.resolve(undefined),
        matchAll: () => Promise.resolve([]),
        delete: () => Promise.resolve(false),
        keys: () => Promise.resolve([]),
      };
    };

    Object.defineProperty(globalThis, 'caches', {
      configurable: true,
      enumerable: false,
      writable: true,
      value: {
        open: (nombre: unknown) => Promise.resolve(almacenDeMentira(String(nombre))),
        has: () => Promise.resolve(false),
        delete: () => Promise.resolve(false),
        keys: () => Promise.resolve([]),
        match: () => Promise.resolve(undefined),
      },
    });

    /**
     * EL DECIMO CANAL: el service worker, que en este producto esta instalado.
     *
     * Se DEFINE, como la baliza y como `caches`, porque lo que hay que cazar
     * es la forma prudente —`navigator.serviceWorker?.controller?.postMessage`—,
     * que sin esto no hace nada y pasa en verde.
     *
     * HAY TRES PUERTAS AL MISMO WORKER Y SE MIRAN LAS TRES, porque las tres
     * son la forma natural de escribirlo: el `controller` —el que ya controla
     * esta pagina—, el `active` del registro que devuelve `ready` —la forma
     * que usa `boton-de-push.tsx` para esperar a que este instalado— y el de
     * `register`. Cada mensaje se anota CON LA PUERTA por la que salio, para
     * que el informe diga cual sin decir el dato.
     *
     * El resto de la superficie se deja en lo que devuelve un navegador sin
     * nada registrado —`getRegistration()` da `undefined`, `getRegistrations()`
     * da una lista vacia— porque este tapon no esta para simular un worker:
     * esta para que un mensaje hacia el no sea invisible.
     */
    const anotarUnAviso = (aviso: AvisoMostrado): void => {
      avisosMostrados.push(aviso);
    };

    const trabajadorDeMentira = (puerta: string) => ({
      scriptURL: '/sw.js',
      state: 'activated',
      postMessage: (mensaje: unknown) => {
        mensajesAlTrabajador.push(`${puerta} ${comoTexto([mensaje])}`);
      },
      addEventListener: () => {},
      removeEventListener: () => {},
    });

    /**
     * EL REGISTRO DEL WORKER, QUE ES POR DONDE ENTRA EL DECIMOSEPTIMO CANAL.
     *
     * `showNotification` vive aqui —en el registro y no en el worker— porque es
     * donde la pone la plataforma, y lo que anota va al canal de las
     * notificaciones y no al del service worker: lo que agrupa un canal es
     * DONDE ACABA EL DATO, y esto acaba en el centro de notificaciones del
     * sistema, igual que `new Notification`. El razonamiento entero esta en el
     * docblock de `NOTIFICACION_ORIGINAL`.
     */
    const registroDeMentira = (puerta: string) => ({
      active: trabajadorDeMentira(puerta),
      scope: '/',
      showNotification: (titulo: unknown, opciones?: unknown) => {
        anotarUnAviso({ puerta: 'showNotification', campos: camposDeUnAviso(titulo, opciones) });

        return Promise.resolve(undefined);
      },
      getNotifications: () => Promise.resolve([]),
      update: () => Promise.resolve(undefined),
      unregister: () => Promise.resolve(true),
      addEventListener: () => {},
      removeEventListener: () => {},
    });

    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      enumerable: false,
      writable: true,
      value: {
        controller: trabajadorDeMentira('controller'),
        ready: Promise.resolve(registroDeMentira('ready.active')),
        register: () => Promise.resolve(registroDeMentira('register.active')),
        getRegistration: () => Promise.resolve(undefined),
        getRegistrations: () => Promise.resolve([]),
        startMessages: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    });

    /**
     * EL UNDECIMO CANAL: IndexedDB, que jsdom no trae.
     *
     * Se DEFINE, como la baliza, como `caches` y como el service worker,
     * porque lo que hay que cazar es la forma prudente
     * —`globalThis.indexedDB?.open(…)`—, que sin esto no hace nada y pasa en
     * verde mientras en el navegador del mostrador escribe en disco.
     *
     * SE ENGANCHA EN CADA TEST, como todo lo de arriba: los specs llaman a
     * `vi.restoreAllMocks()` en su propio `afterEach`, que con el orden de
     * hooks de Vitest corre ANTES que este tapon; y ademas el `afterEach` de
     * abajo devuelve `indexedDB` a no existir, asi que sin volver a ponerlo
     * aqui el canal estaria apagado a partir del segundo test de cada archivo:
     * verde y ciego.
     *
     * No reenvia a nada —no hay base debajo— y la de mentira nace VACIA en
     * cada test: lo que un test guarde no lo hereda el siguiente, igual que
     * los almacenes se restauran y las listas se vacian.
     */
    const anotarEscritura = (escritura: EscrituraEnLaBase): void => {
      escritoEnLaBase.push(escritura);
    };

    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      enumerable: false,
      writable: true,
      value: {
        open: (nombre: unknown, version?: unknown) => {
          const base = String(nombre);
          basesAbiertas.push(base);

          const laBase = baseDeDatosDeMentira(base, Number(version) || 1, anotarEscritura);

          const apertura = conOyentes({
            result: laBase,
            error: null,
            readyState: 'done',
            onsuccess: null,
            onerror: null,
            onblocked: null,
            onupgradeneeded: null,
            transaction: null,
          });

          /**
           * `upgradeneeded` SIEMPRE, y en su propia microtarea antes de
           * `success`.
           *
           * Siempre, porque en un test no hay ninguna base de la sesion
           * anterior: la version que hay en disco es cero y la plataforma de
           * verdad dispara la actualizacion. Es ademas lo que hace falta para
           * que el `createObjectStore` del codigo bajo prueba corra y el `put`
           * de `onsuccess` tenga donde caer.
           *
           * En dos microtareas encadenadas y no en una, como la plataforma, por
           * si alguien asigna `onsuccess` DENTRO de `onupgradeneeded` —que es
           * una forma que se escribe— en lugar de justo despues de `open()`.
           */
          masTardeEnLaBase(() => {
            // `apertura.transaction` es, durante la actualizacion, la
            // transaccion de `versionchange`: por ahi llega
            // `evento.target.transaction.objectStore('x')`, que es la forma de
            // tocar un almacen recien creado sin abrir otra transaccion.
            const abrirTransaccion = laBase.transaction as (
              nombres: unknown,
              modo?: unknown,
            ) => unknown;
            apertura.transaction = abrirTransaccion.call(laBase, [], 'versionchange');
            dispararEnLaBase(apertura, 'upgradeneeded');
          });
          masTardeEnLaBase(() => dispararEnLaBase(apertura, 'success'));

          return apertura;
        },
        /**
         * Borrar una base tambien es usarla, y el NOMBRE puede llevar el dato:
         * un `deleteDatabase(claveTemporal)` lo publica igual que una clave.
         */
        deleteDatabase: (nombre: unknown) => {
          basesAbiertas.push(String(nombre));
          return peticionDeLaBase(undefined);
        },
        databases: () => Promise.resolve([]),
        cmp: (uno: unknown, otro: unknown) => (String(uno) < String(otro) ? -1 : 1),
      },
    });

    /**
     * EL DECIMOTERCER CANAL: las cinco puertas de la History API.
     *
     * SE ENGANCHA EN CADA TEST, como la consola y como `mark`/`measure`, y por
     * el mismo motivo medido: los specs llaman a `vi.restoreAllMocks()` en su
     * propio `afterEach`, que con el orden de hooks de Vitest corre ANTES que
     * este tapon y devuelve las cinco funciones a su sitio. Sin volver a
     * engancharlas, a partir del segundo test de cada archivo el espia estaria
     * mirando un historial que ya nadie dobla: verde y ciego.
     *
     * (La OTRA mitad del canal —la comparacion de la URL— no necesita espia
     * ninguno, como el duodecimo: lo que delata la fuga es la URL que QUEDA, y
     * eso se lee al terminar. Esta mitad si lo necesita, porque un
     * `pushState(datos, '', la misma URL)` no deja nada que comparar.)
     *
     * Se dobla con `vi.spyOn` y no redefiniendo el descriptor —como si hay que
     * hacer con las galletas, el `src` de una imagen y `window.postMessage`—
     * porque aqui si hay un metodo de prototipo que doblar: MEDIDO,
     * `History.prototype.pushState` es una propiedad de DATOS escribible y
     * configurable, y `window.history` no tiene ni una propiedad propia que la
     * tape.
     *
     * REGISTRA Y DEJA PASAR, como el resto del tapon, reenviando a la funcion
     * ORIGINAL cogida al cargar: tragarse la llamada cambiaria lo que hace la
     * pantalla bajo prueba Y dejaria ciega a la otra mitad, porque la URL no
     * llegaria a moverse.
     */
    for (const puerta of PUERTAS_DEL_HISTORIAL) {
      const original = HISTORIAL_ORIGINAL.get(puerta);
      if (original === undefined) continue;

      vi.spyOn(History.prototype, puerta).mockImplementation(function (
        this: History,
        ...partes: unknown[]
      ) {
        // Se anota ANTES de reenviar: si la llamada de verdad explotara, la
        // fuga ya quedo registrada. Es la regla del resto del tapon.
        navegado.push({ puerta, argumentos: comoTexto(partes) });

        return original.apply(this, partes);
      } as never);
    }

    /**
     * EL DECIMOCUARTO CANAL: LAS CUATRO PUERTAS DE LA RED.
     *
     * SE ENGANCHAN EN CADA TEST, como todo lo de arriba y por los dos motivos
     * de siempre: los specs llaman a `vi.restoreAllMocks()` y a
     * `vi.unstubAllGlobals()` en su propio `afterEach`, que con el orden de
     * hooks de Vitest corre ANTES que este tapon; y el `afterEach` de abajo
     * devuelve las cuatro a como estaban. Sin volver a ponerlas aqui, el canal
     * estaria apagado a partir del segundo test de cada archivo: verde y ciego.
     *
     * `fetch` se pone como propiedad de DATOS y no como accesor: `vi.stubGlobal`
     * sustituye el descriptor entero, asi que un accesor no sobreviviria al
     * primer doble. Quien mantiene al espia en el camino cuando el spec instala
     * el suyo es el enganche de `vi.stubGlobal` de arriba.
     */
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      enumerable: true,
      writable: true,
      value: LA_RED,
    });

    /**
     * `XMLHttpRequest` SON DOS METODOS Y HAY QUE MIRAR LOS DOS.
     *
     * El destino llega en `open(metodo, url)` y el cuerpo en `send(datos)`, con
     * cualquier cosa en medio: se guarda lo del `open` hasta que llegue su
     * `send`, que es el momento en que la peticion sale de verdad. El `open` se
     * reenvia —no pide nada todavia y deja el objeto coherente— y el `send` NO:
     * en jsdom abre una conexion de verdad, y aqui no hay nada legitimo que
     * preservar (cero `XMLHttpRequest` en `src/`).
     */
    vi.spyOn(XMLHttpRequest.prototype, 'open').mockImplementation(function (
      this: XMLHttpRequest,
      ...partes: unknown[]
    ) {
      XHR_ABIERTO.set(this, {
        metodo: String(partes[0] ?? 'GET').toUpperCase(),
        destino: String(partes[1] ?? ''),
      });

      return (ABRIR_UN_XHR as (...a: unknown[]) => void).apply(this, partes);
    } as never);

    vi.spyOn(XMLHttpRequest.prototype, 'send').mockImplementation(function (
      this: XMLHttpRequest,
      cuerpo?: unknown,
    ) {
      const abierto = XHR_ABIERTO.get(this);

      PETICIONES_DE_RED.push({
        puerta: 'XMLHttpRequest',
        metodo: abierto?.metodo ?? '',
        destino: abierto?.destino ?? '',
        carga: cuerpoDeUnaBaliza(cuerpo),
        dePedir: false,
      });
    });

    for (const [puerta, donde] of [
      ['WebSocket', 'WebSocket'],
      ['EventSource', 'EventSource'],
      ['Worker', 'Worker'],
      ['SharedWorker', 'SharedWorker'],
    ] as const) {
      Object.defineProperty(globalThis, donde, {
        configurable: true,
        enumerable: false,
        writable: true,
        value: conexionDeMentira(puerta),
      });
    }

    /**
     * EL DECIMOSEXTO CANAL: el disco privado del origen, que jsdom no trae.
     *
     * Se DEFINE, como la baliza, como `caches`, como el service worker y como
     * IndexedDB, porque lo que hay que cazar es la forma prudente
     * —`navigator.storage?.getDirectory?.()`—, que sin esto no hace nada y pasa
     * en verde mientras en el navegador del mostrador escribe un archivo.
     *
     * SE ENGANCHA EN CADA TEST, como todo lo de arriba: los specs llaman a
     * `vi.restoreAllMocks()` en su propio `afterEach`, que con el orden de
     * hooks de Vitest corre ANTES que este tapon; y ademas el `afterEach` de
     * abajo devuelve `navigator.storage` a no existir, asi que sin volver a
     * ponerlo aqui el canal estaria apagado a partir del segundo test de cada
     * archivo: verde y ciego.
     *
     * `estimate`, `persist` y `persisted` se montan tambien aunque no lleven
     * dato: son el resto de `StorageManager`, y una pantalla que pregunte por
     * el espacio libre antes de guardar —la forma de manual— no tiene por que
     * reventar contra un objeto a medias. Ninguna de las tres se anota: no
     * sacan nada de esta pagina.
     */
    const anotarUnPaso = (paso: PasoPorElDisco): void => {
      pasosPorElDisco.push(paso);
    };

    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      enumerable: false,
      writable: true,
      value: {
        getDirectory: () => {
          // Pedir el disco privado YA es usarlo, como `indexedDB.open`: la
          // forma fuerte de abajo cuenta esta puerta como las demas.
          anotarUnPaso({ puerta: 'getDirectory', ruta: [], contenido: '' });

          return Promise.resolve(raizDeMentira(anotarUnPaso));
        },
        estimate: () => Promise.resolve({ quota: 0, usage: 0 }),
        persist: () => Promise.resolve(false),
        persisted: () => Promise.resolve(false),
      },
    });

    /**
     * EL DECIMOSEPTIMO CANAL: el centro de notificaciones, que jsdom no trae.
     *
     * Se DEFINE, como la baliza, como `caches`, como el service worker, como
     * IndexedDB y como el disco privado, porque lo que hay que cazar es la
     * forma prudente —y aqui la forma prudente es la UNICA correcta: un
     * `typeof Notification !== 'undefined'` delante, porque es un binding
     * global—. Sin esto, esa condicion es `false`, la rama no corre y pasa en
     * verde mientras en el mostrador el aviso sale a la pantalla del sistema.
     *
     * SE ENGANCHA EN CADA TEST, como todo lo de arriba: los specs llaman a
     * `vi.restoreAllMocks()` y a `vi.unstubAllGlobals()` en su propio
     * `afterEach`, que con el orden de hooks de Vitest corre ANTES que este
     * tapon; y ademas el `afterEach` de abajo devuelve `Notification` a no
     * existir, asi que sin volver a ponerlo aqui el canal estaria apagado a
     * partir del segundo test de cada archivo: verde y ciego.
     *
     * Y `boton-de-push.spec.tsx` instala el suyo con `vi.stubGlobal` DENTRO del
     * cuerpo de cada test, o sea DESPUES de este: el del spec gana, como tiene
     * que ser, y su `vi.unstubAllGlobals()` devuelve este.
     */
    Object.defineProperty(globalThis, 'Notification', {
      configurable: true,
      enumerable: false,
      writable: true,
      value: notificacionDeMentira(anotarUnAviso),
    });

    /**
     * EL VIGESIMO CANAL: los objetos con URL, que jsdom no trae.
     *
     * Se DEFINEN las dos funciones, como la baliza y como `Notification`,
     * porque lo que hay que cazar es la forma prudente —`typeof
     * URL.createObjectURL === 'function'`—, que sin esto no hace nada y pasa
     * en verde. Un almacen NUEVO por test, y no uno vaciado: lo que publico el
     * test anterior no puede acusar al siguiente.
     *
     * SE ENGANCHA EN CADA TEST, como todo lo de arriba: el `afterEach` de
     * abajo las devuelve a no existir.
     */
    objetosConUrl = almacenDeObjetosDeMentira();

    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      enumerable: false,
      writable: true,
      value: (objeto: unknown): string => objetosConUrl.crear(objeto),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      enumerable: false,
      writable: true,
      value: (url: unknown): void => {
        objetosConUrl.revocar(url);
      },
    });
  });

  afterEach(() => {
    /**
     * LA PESTAÑA SE CIERRA AQUI, ANTES DE LEER NI UNO DE LOS DIECIOCHO CANALES.
     *
     * Es el eje decimonoveno, y esta primero por dos medidas que no se
     * adivinan y estan las dos en `salida-de-la-pestana.ts`:
     *
     * 1. EL OYENTE DE UNA FUGA DE SALIDA SE QUITA EN EL DESMONTAJE. Lo registra
     *    un `useEffect` y lo borra su `return`, o sea que despues del
     *    `cleanup()` de mas abajo ya no escucha nadie. Medido: el mismo
     *    `dispatchEvent` da un golpe antes del `cleanup()` y cero despues.
     *    Despachar detras seria cerrar el eje EN FALSO —verde y ciego—, que es
     *    el modo de fallo que todo este archivo existe para evitar.
     *
     * 2. Y TAMPOCO ENTRE MEDIAS. El `<head>` y los `<img>` del documento se
     *    leen aqui abajo con el arbol todavia montado; el resto, despues del
     *    `cleanup()`. Despachando entre la foto de la cabecera y el desmontaje,
     *    un oyente de `pagehide` que subiera un `<meta>` al `<head>` no lo
     *    veria nadie. Desde aqui arriba, los dieciocho tapones miran un mundo en el
     *    que la pestaña ya se cerro.
     */
    despacharLaSalidaDeLaPestana();

    const titulo = document.title;
    const nombreDeLaPestana = window.name;
    // Se mira el TOTAL de lo dicho, serializado, no un metodo concreto ni el
    // primer argumento: el dato suele viajar DENTRO de un objeto que se pasa
    // como segundo o tercer argumento y que la consola expande sola.
    const loDicho = comoTexto(dicho);

    /**
     * LA CABECERA SE LEE AQUI, ANTES DE QUE `cleanup()` DESMONTE.
     *
     * Este `afterEach` se registra DESPUES del de `cleanup` en
     * `vitest.setup.ts`, y Vitest corre los `afterEach` en orden inverso al de
     * registro, asi que este va primero y el arbol sigue montado. Si corriera
     * detras, React ya habria quitado sus propios nodos del `<head>` y el
     * canal se miraria siempre vacio.
     */
    const laCabecera = document.head.innerHTML;
    const aparecidosEnLaCabecera = nodosDeLaCabecera().filter(
      (nodo) => !cabeceraAlEmpezar.has(nodo),
    );

    /**
     * LA OTRA MITAD DEL SEPTIMO CANAL, y tambien ANTES de desmontar.
     *
     * El espia del accesor ve lo que se ASIGNA, que es por donde se va una
     * imagen suelta y tambien el `<img>` de JSX. Esta barrida ve lo que QUEDA
     * en el documento, que es lo unico que caza un `setAttribute('src', …)` a
     * pelo —el accesor no se entera—. Como el `<head>`, se lee con el arbol
     * todavia montado: despues de `cleanup()` no hay ni un nodo que mirar.
     */
    const imagenesDelDocumento = [...document.querySelectorAll('img')].map(
      (imagen) => imagen.getAttribute('src') ?? '',
    );

    /**
     * EL DECIMOQUINTO CANAL SE LEE AQUI, ANTES DE `cleanup()`, COMO EL `<head>`
     * Y LAS IMAGENES — Y AL REVES QUE LOS OTROS TRECE.
     *
     * No es una preferencia y no se dedujo: esto vive DENTRO del `<body>`, que
     * es justamente lo que `cleanup()` vacia. Medido con una sonda en el
     * `afterEach`: `document.body.children.length` vale 0 detras del
     * desmontaje, asi que la barrida leida despues devolveria SIEMPRE la lista
     * vacia y el canal seria verde y ciego — el modo de fallo que todo este
     * archivo existe para evitar, y el mismo que obliga a leer el `<head>`
     * antes porque React 19 se lleva sus `<meta>` al desmontar.
     *
     * Lo que se pierde leyendo antes, dicho entero: el `.value` que escriba la
     * LIMPIEZA de un `useEffect` —que es lo que GANAN los atributos de
     * alrededor, la URL y el buffer de marcas leyendose despues—. No hay
     * eleccion: esos tres sobreviven al desmontaje y esto no. Y el agujero es
     * estrecho, porque el nodo sobre el que esa limpieza escribiria ya no esta
     * en el documento cuando corre.
     *
     * LA OTRA MITAD, Y ES LA QUE DEFINE EL CANAL: el marcado se fotografia AQUI
     * MISMO, en la misma linea, para poder RESTAR. Un centinela solo esta
     * escondido si NO esta en lo que el `innerHTML` y el `textContent`
     * publican, y las dos fotos tienen que ser del mismo instante: con el
     * marcado leido despues del `cleanup()` la resta compararia contra un
     * cuerpo vacio y el canal se pondria rojo con el codigo correcto en medio
     * panel.
     */
    const escondites = escondidoEnElCuerpo();
    const marcadoDelCuerpo = `${document.body.innerHTML} ${document.body.textContent ?? ''}`;

    /**
     * EL DESMONTAJE VA AQUI DENTRO, Y EL ORDEN ES LA PARTE DELICADA.
     *
     * `vitest.setup.ts` registra `afterEach(cleanup)` ANTES que este tapon, asi
     * que con el orden inverso de Vitest el tapon corre primero. Eso es lo que
     * hace falta —arriba se lee el `<head>` con el arbol todavia montado—, pero
     * tiene un coste: cuando una de las afirmaciones de abajo LANZA, Vitest
     * aborta la cadena de `afterEach` y el `cleanup()` de `vitest.setup.ts` NO
     * llega a correr. El DOM del test que fallo se arrastra al siguiente, que
     * cae con «Found multiple elements with the role ...» sin tener la culpa:
     * dos fallos de verdad llegan al informe con ocho lineas de ruido encima,
     * y la primera que se lee acusa al inocente.
     *
     * Se desmonta aqui, DESPUES de la foto de la cabecera y ANTES de afirmar.
     * El `afterEach(cleanup)` de `vitest.setup.ts` se queda igual: `cleanup()`
     * es idempotente —vacia su registro de montajes— y sigue cubriendo el caso
     * de que este tapon no llegue a correr.
     *
     * NO se puede mover una linea mas arriba: React 19 sube sus `<meta>` al
     * `<head>` y se los lleva al desmontar, asi que con el `cleanup()` delante
     * de la foto el cuarto canal se quedaria CIEGO —en verde, sin que nada lo
     * diga—, que es peor que el ruido que esto arregla.
     */
    cleanup();

    const almacenesAlTerminar = estadoDeLosAlmacenes();

    /**
     * EL VIGESIMO CANAL SE LEE AQUI, DESPUES DE `cleanup()`, COMO LA URL Y LOS
     * ATRIBUTOS DE ALREDEDOR.
     *
     * Leido antes, una vista previa que revoca su URL en la limpieza de su
     * `useEffect` contaria como fuga sin serlo. Leido despues, lo unico que
     * queda es lo que nadie revoca nunca. Ver `CREAR_UNA_URL_DE_OBJETO_ORIGINAL`.
     *
     * Se lee, se cambia el almacen y se devuelven las dos funciones a como
     * estaban —en jsdom, a no estar— ANTES de afirmar, como `Notification`: si
     * una afirmacion lanza, el test siguiente no hereda lo del que fallo.
     */
    const objetosSinRevocar = objetosConUrl.vivos();
    objetosConUrl = almacenDeObjetosDeMentira();
    const loPublicadoConUrl = objetosSinRevocar.map((uno) => uno.contenido).join(' ');
    const tiposSinRevocar = objetosSinRevocar.map((uno) => claveSegura(uno.tipo));

    for (const [nombre, original] of [
      ['createObjectURL', CREAR_UNA_URL_DE_OBJETO_ORIGINAL],
      ['revokeObjectURL', REVOCAR_UNA_URL_DE_OBJETO_ORIGINAL],
    ] as const) {
      if (original === undefined) Reflect.deleteProperty(URL, nombre);
      else Object.defineProperty(URL, nombre, original);
    }

    /**
     * EL BUFFER SE LEE AQUI, DESPUES DE `cleanup()`, Y NO ANTES.
     *
     * Al reves que el `<head>`: las marcas no se borran al desmontar —son una
     * lista que solo crece—, asi que leerlas despues del desmontaje caza
     * ademas la que ponga la limpieza de un `useEffect`. Antes no cazaria nada
     * mas y perderia esa.
     */
    /**
     * EL DUODECIMO CANAL SE LEE AQUI, DESPUES DE `cleanup()`, Y AL REVES QUE
     * EL `<head>`.
     *
     * El `<head>` tiene que leerse ANTES de desmontar porque React 19 sube sus
     * `<meta>` ahi y SE LOS LLEVA al desmontar: con el `cleanup()` delante, ese
     * canal se quedaria ciego en verde. Aqui es al reves, y es la propiedad 1
     * del docblock de `ALREDEDOR_DEL_CUERPO`: estos atributos NO estan en el
     * arbol que `render` monta, asi que el desmontaje no borra ni uno. Leer
     * despues no pierde NADA y gana una cosa —la misma que gana el buffer de
     * marcas, que se lee aqui abajo por lo mismo—: caza ademas el atributo que
     * ponga la LIMPIEZA de un `useEffect`, que es codigo de la pantalla que
     * solo corre al desmontar y que leyendo antes no se veria nunca.
     */
    const atributosDeAlrededor: Record<ElementoDeAlrededor, [string, string][]> = {
      '<html>': atributosDe(document.documentElement),
      '<body>': atributosDe(document.body),
    };

    /**
     * Y LO QUE CUELGA DEL `<html>`, AQUI MISMO Y POR LO MISMO.
     *
     * Es la segunda mitad de este canal y se lee en la misma linea que los
     * atributos porque comparte las dos propiedades que deciden el momento: no
     * esta en el arbol que `render` monta —asi que `cleanup()` no lo quita y
     * leer despues no pierde nada— y leyendo despues se caza ademas el nodo
     * que cuelgue la LIMPIEZA de un `useEffect`. El razonamiento entero esta
     * en el docblock de `loColgadoDelHtml`.
     */
    const colgadoDelHtml = loColgadoDelHtml();

    /**
     * EL DECIMOTERCER CANAL SE LEE AQUI, DESPUES DE `cleanup()`, COMO EL DOCE.
     *
     * Y por el mismo motivo exacto: `location` NO esta en el arbol que `render`
     * monta, asi que el desmontaje no toca ni un caracter de la URL. Leer
     * despues no pierde NADA y gana lo mismo que ganan los atributos del
     * `<html>` y el buffer de marcas: caza ademas la URL que escriba la
     * LIMPIEZA de un `useEffect`, que es codigo de la pantalla que solo corre
     * al desmontar y que leyendo antes no se veria nunca.
     *
     * Es el reves del `<head>`, que tiene que leerse ANTES porque React 19 se
     * lleva sus `<meta>` al desmontar y leer despues dejaria ese canal ciego en
     * verde.
     */
    const fotoAlTerminar = fotoDeLaUrl();
    const urlAlTerminar = window.location.href;

    const cronometradoEntero = [...entradasDelBuffer('mark'), ...entradasDelBuffer('measure')];
    cronometradoEntero.push(...cronometrado);

    const loCronometrado: Record<TipoDeEntrada, string> = {
      mark: comoTextoLasEntradas(cronometradoEntero, 'mark'),
      measure: comoTextoLasEntradas(cronometradoEntero, 'measure'),
    };

    /**
     * LAS DOS MITADES, juntadas por almacen: lo que quedo guardado que antes no
     * estaba, mas lo que se escribio aunque alguien lo borrara despues.
     */
    const guardado: Record<NombreDeAlmacen, Set<string>> = {
      localStorage: new Set(),
      sessionStorage: new Set(),
      galletas: new Set(),
    };

    for (const almacen of ALMACENES) {
      const antes = almacenesAlEmpezar[almacen];

      for (const [clave, valor] of Object.entries(almacenesAlTerminar[almacen])) {
        if (antes[clave] !== valor) guardado[almacen].add(clave);
      }
    }

    for (const escritura of escrito) guardado[escritura.almacen].add(escritura.clave);

    /** Todo lo que paso por un almacen, clave Y valor, para buscar centinelas. */
    const loGuardado = [
      ...escrito.map((escritura) => `${escritura.clave}=${escritura.valor}`),
      ...ALMACENES.map((almacen) => JSON.stringify(almacenesAlTerminar[almacen])),
    ].join(' ');

    // Los canales se devuelven a como estaban ANTES de afirmar nada: si no, el
    // test que ensucia uno hace caer tambien a los que vengan detras y el
    // informe acusa al inocente.
    //
    // EL `<head>` ES LA EXCEPCION Y NO SE TOCA: arrancarle un nodo que React
    // subio ahi rompe el desmontaje de `cleanup()` con un
    // «Cannot read properties of null (reading 'removeChild')» —medido—, y el
    // test siguiente hereda el estropicio. No hace falta: el `cleanup()` de
    // arriba ya corrio y React quita los suyos, y la foto de `beforeEach` hace
    // que un nodo que sobreviva no se le impute al inocente.
    //
    // EL BUFFER DE MARCAS SE VACIA AQUI, DESPUES DE LEERLO Y ANTES DE AFIRMAR.
    // Vaciarlo en el `beforeEach` dejaria el canal CIEGO para lo marcado al
    // importar el modulo —que ya esta en el buffer antes del primer hook— y
    // vaciarlo despues de las afirmaciones no llegaria a correr cuando una
    // lanza: el buffer solo crece, asi que el test siguiente heredaria las
    // marcas del que fallo y el informe acusaria al inocente.
    //
    // Se vacia por `EL_CRONOMETRO` y no por `performance`: si un test se fue
    // con `vi.useFakeTimers()` puesto, el `performance` global es el falso de
    // sinon y su `clearMarks()` no toca el buffer de verdad.
    document.title = tituloAlEmpezar;
    window.name = '';
    dicho.length = 0;
    restaurarLosAlmacenes(almacenesAlEmpezar);
    escrito.length = 0;
    EL_CRONOMETRO.clearMarks();
    EL_CRONOMETRO.clearMeasures();
    cronometrado.length = 0;

    /** Las dos mitades del septimo canal, juntas, para buscar dentro. */
    const loPedidoPorImagen = [...imagenesPedidas, ...imagenesDelDocumento].join(' ');
    imagenesPedidas.length = 0;

    /**
     * Las tres puertas del octavo canal, cada una por su lado.
     *
     * Separadas y no en una sola cadena para que el informe diga POR CUAL se
     * fue el dato, que es informacion distinta: un `postMessage` se lo lleva
     * quien comparta la pagina, un `BroadcastChannel` otra pestaña y una
     * baliza un servidor de fuera. Se vacian ANTES de afirmar, como el resto:
     * si una afirmacion lanza, el test siguiente no hereda lo del que fallo y
     * el informe no acusa al inocente.
     */
    const loMensajeado = mensajesMandados.join(' ');
    const loDifundido = mensajesDifundidos.join(' ');
    const loBalizado = balizasMandadas.join(' ');
    mensajesMandados.length = 0;
    mensajesDifundidos.length = 0;
    balizasMandadas.length = 0;

    /**
     * El noveno canal: lo guardado en el almacen de respuestas.
     *
     * Se vacia la lista y se devuelve `caches` a como estaba —en jsdom, a no
     * estar— ANTES de afirmar, como el resto: si una afirmacion lanza, el test
     * siguiente no hereda lo del que fallo y el informe no acusa al inocente.
     */
    const loCacheado = respuestasGuardadas.map((una) => `${una.almacen} ${una.clave}`);
    respuestasGuardadas.length = 0;

    if (CACHES_ORIGINAL === undefined) {
      delete (globalThis as unknown as Record<string, unknown>).caches;
    } else {
      Object.defineProperty(globalThis, 'caches', CACHES_ORIGINAL);
    }

    /**
     * El decimo canal: lo que se le mando al service worker.
     *
     * Se lee, se vacia la lista y se devuelve `navigator.serviceWorker` a como
     * estaba —en jsdom, a no estar— ANTES de afirmar, exactamente como
     * `caches`: si una afirmacion lanza, el test siguiente no hereda lo del
     * que fallo y el informe no acusa al inocente. Y dejarlo puesto entre
     * archivos cambiaria la deteccion de capacidades de un spec que no pidio
     * nada.
     */
    const loMandadoAlTrabajador = mensajesAlTrabajador.join(' ');
    mensajesAlTrabajador.length = 0;

    if (SERVICE_WORKER_ORIGINAL === undefined) {
      Reflect.deleteProperty(navigator, 'serviceWorker');
    } else {
      Object.defineProperty(navigator, 'serviceWorker', SERVICE_WORKER_ORIGINAL);
    }

    /**
     * El undecimo canal: lo que paso por IndexedDB.
     *
     * Se lee, se vacian las listas y se devuelve `indexedDB` a como estaba
     * —en jsdom, a no estar— ANTES de afirmar, exactamente como `caches` y
     * como el service worker: si una afirmacion lanza, el test siguiente no
     * hereda lo del que fallo y el informe no acusa al inocente. Y dejarlo
     * puesto entre archivos cambiaria la deteccion de capacidades de un spec
     * que no pidio nada.
     */
    const lasBasesAbiertas = basesAbiertas.join(' ');
    const loEscritoEnLaBase = comoTextoLasEscrituras(escritoEnLaBase);
    const puertasDeLaBase = escritoEnLaBase.map(descripcionDeUnaEscritura);
    // Por `claveSegura` y sin repetidos: una base bautizada con un dato
    // vigilado se nombra por el NOMBRE del dato, no por la cadena.
    const nombresDeLasBases = [...new Set(basesAbiertas.map(claveSegura))];
    basesAbiertas.length = 0;
    escritoEnLaBase.length = 0;

    if (INDEXED_DB_ORIGINAL === undefined) {
      delete (globalThis as unknown as Record<string, unknown>).indexedDB;
    } else {
      Object.defineProperty(globalThis, 'indexedDB', INDEXED_DB_ORIGINAL);
    }

    /**
     * EL DECIMOCUARTO CANAL: lo que se pidio a la red por fuera de `pedir`.
     *
     * Se lee, se vacia la lista y se devuelven las cuatro puertas a como
     * estaban ANTES de afirmar, exactamente como `caches`, el service worker e
     * IndexedDB: si una afirmacion lanza, el test siguiente no hereda lo del
     * que fallo y el informe no acusa al inocente.
     *
     * LAS PETICIONES DE `pedir` SE DESCUENTAN AQUI Y NO AL ANOTARLAS, para que
     * el conteo y la pila se midan en el momento de la llamada —que es el unico
     * en que la pila existe— y la decision de que hacer con ellas viva junto a
     * la afirmacion.
     */
    const peticionesSueltas = PETICIONES_DE_RED.filter((una) => !una.dePedir);
    const loPedidoPorRed = peticionesSueltas.map((una) => `${una.destino} ${una.carga}`).join(' ');
    // Las cinco puertas que no son `fetch`, para la forma fuerte: el producto
    // no tiene un solo uso legitimo de ninguna de las cinco.
    const puertasDeOtraRed = [
      ...new Set(PETICIONES_DE_RED.filter((una) => una.puerta !== 'fetch').map(laPuertaDe)),
    ];

    /** Por que puerta se fue un dato concreto, para el mensaje del fallo. */
    const redQueLleva = (valor: string): string => {
      const puertas = [
        ...new Set(
          peticionesSueltas
            .filter((una) => formaQueSeFue(`${una.destino} ${una.carga}`, valor) !== undefined)
            .map(laPuertaDe),
        ),
      ];

      return puertas.length === 0 ? 'una peticion que ya no esta' : puertas.join(', ');
    };

    PETICIONES_DE_RED.length = 0;
    elDobleDeLaRed = undefined;

    for (const [donde, original] of [
      ['fetch', RED_ORIGINAL],
      ['WebSocket', WEBSOCKET_ORIGINAL],
      ['EventSource', EVENT_SOURCE_ORIGINAL],
      ['Worker', WORKER_ORIGINAL],
      ['SharedWorker', SHARED_WORKER_ORIGINAL],
    ] as const) {
      if (original === undefined) delete (globalThis as unknown as Record<string, unknown>)[donde];
      else Object.defineProperty(globalThis, donde, original);
    }

    /**
     * EL DECIMOSEXTO CANAL: lo que paso por el disco privado del origen.
     *
     * Se lee, se vacia la lista y se devuelve `navigator.storage` a como
     * estaba —en jsdom, a no estar— ANTES de afirmar, exactamente como
     * `caches`, el service worker e IndexedDB: si una afirmacion lanza, el
     * test siguiente no hereda lo del que fallo y el informe no acusa al
     * inocente. Y dejarlo puesto entre archivos cambiaria la deteccion de
     * capacidades de un spec que no pidio nada.
     *
     * EL NOMBRE Y EL CONTENIDO VAN SEPARADOS porque son dos sitios distintos
     * —un `getFileHandle(claveTemporal)` publica el dato sin escribir un
     * byte—, igual que el undecimo canal separa el nombre de la base de lo que
     * se escribio dentro.
     */
    const pasosDelDisco = [...pasosPorElDisco];
    const losNombresDelDisco = pasosDelDisco.map((paso) => paso.ruta.join('/')).join(' ');
    const loEscritoEnElDisco = pasosDelDisco.map((paso) => paso.contenido).join(' ');
    // Por `claveSegura` y sin repetidos: un archivo bautizado con un dato
    // vigilado se nombra por el NOMBRE del dato, no por la cadena.
    const puertasDelDisco = [...new Set(pasosDelDisco.map(descripcionDeUnPaso))];
    pasosPorElDisco.length = 0;

    /**
     * POR QUE PUERTA DEL DISCO SE FUE UN DATO CONCRETO, para el mensaje del
     * fallo.
     *
     * Es lo mismo que hacen `puertasQueLlevan` en el decimotercer canal y
     * `redQueLleva` en el decimocuarto, y por lo mismo: el arbol de OPFS tiene
     * siete puertas y decir «una escritura en el disco privado» obliga a ir a
     * buscar cual. La descripcion es vocabulario fijo mas la ruta POR
     * `claveSegura` —`createWritable().write en /config-del-dia.json`—: ubica
     * la fuga sin publicar ni un caracter de lo que lleva dentro.
     */
    const discoQueLleva = (valor: string): string => {
      const puertas = [
        ...new Set(
          pasosDelDisco
            .filter(
              (paso) =>
                formaQueSeFue(`${paso.ruta.join('/')} ${paso.contenido}`, valor) !== undefined,
            )
            .map(descripcionDeUnPaso),
        ),
      ];

      return puertas.length === 0 ? 'una puerta que ya no esta' : puertas.join(', ');
    };

    if (ALMACEN_DE_ARCHIVOS_ORIGINAL === undefined) {
      Reflect.deleteProperty(navigator, 'storage');
    } else {
      Object.defineProperty(navigator, 'storage', ALMACEN_DE_ARCHIVOS_ORIGINAL);
    }

    /**
     * EL DECIMOSEPTIMO CANAL: lo que se mando al centro de notificaciones.
     *
     * Se lee, se vacia la lista y se devuelve `Notification` a como estaba —en
     * jsdom, a no estar— ANTES de afirmar, exactamente como `caches`, el
     * service worker, IndexedDB y el disco privado: si una afirmacion lanza, el
     * test siguiente no hereda lo del que fallo y el informe no acusa al
     * inocente. Y dejarlo puesto entre archivos cambiaria la deteccion de
     * capacidades de un spec que no pidio nada.
     *
     * UNA SOLA CADENA Y NO UNA POR CAMPO, al reves que el disco privado, que
     * separa el nombre del contenido: alli son dos SITIOS distintos —el nombre
     * de un archivo queda en el disco aunque no se escriba un byte— y aqui son
     * partes del MISMO aviso, que sale entero a la misma pantalla. El informe
     * no pierde nada: `avisoQueLleva` nombra la puerta Y el campo.
     */
    const avisosDeEsteTest = [...avisosMostrados];
    // El NOMBRE del campo va junto al contenido, como la clave de un almacen y
    // como la ruta del disco: un `{ [claveTemporal]: 1 }` publica el dato en el
    // propio nombre.
    const loAvisado = avisosDeEsteTest
      .flatMap((aviso) => aviso.campos.map((campo) => `${campo.nombre} ${campo.contenido}`))
      .join(' ');
    const puertasDeAviso = [...new Set(avisosDeEsteTest.map(descripcionDeUnAviso))];
    avisosMostrados.length = 0;

    /**
     * POR QUE PUERTA Y EN QUE CAMPO se fue un dato concreto, para el fallo.
     *
     * Es lo mismo que hacen `puertasQueLlevan`, `redQueLleva` y `discoQueLleva`
     * y por lo mismo: hay dos puertas y un objeto de opciones con muchos
     * campos, y decir «una notificacion» obliga a ir a buscar cual. El nombre
     * del campo pasa por `claveSegura` y el contenido no entra nunca.
     */
    const avisoQueLleva = (valor: string): string => {
      const puertas = [
        ...new Set(
          avisosDeEsteTest
            .map((aviso) => {
              // Los campos AGRUPADOS POR AVISO y no uno por uno: una fuga que
              // reparte el dato entre el `body` y el `tag` del MISMO aviso es
              // una sola fuga, y repetir ahi el nombre de la puerta hace el
              // mensaje ilegible justo en el caso mas comun.
              const campos = aviso.campos
                .filter((campo) => formaQueSeFue(campo.contenido, valor) !== undefined)
                .map((campo) => claveSegura(campo.nombre));

              return campos.length === 0 ? '' : `${aviso.puerta}, en ${campos.join(' y ')}`;
            })
            .filter((una) => una !== ''),
        ),
      ];

      return puertas.length === 0 ? 'una notificacion que ya no esta' : puertas.join('; ');
    };

    if (NOTIFICACION_ORIGINAL === undefined) {
      delete (globalThis as unknown as Record<string, unknown>).Notification;
    } else {
      Object.defineProperty(globalThis, 'Notification', NOTIFICACION_ORIGINAL);
    }

    /**
     * EL DUODECIMO CANAL SE LIMPIA AQUI, Y ES LO QUE EVITA ACUSAR AL INOCENTE.
     *
     * Es la unica parte de este canal que no es una lectura, y hace falta
     * exactamente por la propiedad que lo hace peligroso: `cleanup()` no borra
     * estos atributos, asi que sin esta vuelta el que escriba uno hace caer
     * TAMBIEN a todos los tests que vengan detras en el mismo archivo. Esta
     * medido: con la mutacion puesta, un test fallo por el atributo que habia
     * dejado el anterior. Es lo mismo que hacen `restaurarLosAlmacenes`,
     * `clearMarks` y el `window.name = ''` de aqui arriba, y por el mismo
     * motivo: se deja el canal como estaba ANTES de afirmar nada, para que el
     * informe tenga un solo fallo y señale al test que si lo causo.
     *
     * Se borran TODOS y no se restaura ninguno, que es la misma decision que
     * la forma fuerte de abajo y se apoya en la misma medida: los dos
     * elementos nacen sin ni un atributo y nadie del arbol les pone ninguno.
     */
    for (const cual of ALREDEDOR_DEL_CUERPO) {
      const elemento = elementoDeAlrededor(cual);

      for (const [nombre] of atributosDeAlrededor[cual]) elemento.removeAttribute(nombre);
    }

    const loPuestoAlrededor: Record<ElementoDeAlrededor, string> = {
      '<html>': textoDeLosAtributos(atributosDeAlrededor['<html>']),
      '<body>': textoDeLosAtributos(atributosDeAlrededor['<body>']),
    };

    /**
     * Y EL NODO COLGADO SE DESCUELGA AQUI, POR EL MISMO MOTIVO QUE EL ATRIBUTO.
     *
     * `cleanup()` no lo quita —esta FUERA del arbol que `render` monta—, asi
     * que sin esta linea el test que lo cuelga hace caer TAMBIEN a todos los
     * que vengan detras en el mismo archivo y el informe acusa al inocente.
     * MEDIDO con una sonda antes de escribir esto: un `<div>` y un `<span>`
     * colgados en dos tests distintos siguen los dos ahi en el cuarto.
     *
     * Se quitan TODOS y no se restaura ninguno, como los atributos y con la
     * misma medida detras: el `<html>` nace con dos hijos exactos y nadie del
     * arbol le cuelga un tercero.
     */
    const loColgado = colgadoDelHtml.map((uno) => uno.contenido).join(' ');
    // Por `claveSegura` como el resto del informe: una etiqueta propia
    // (`<x-25000-10>`) publicaria el dato en el nombre del elemento.
    const etiquetasColgadas = colgadoDelHtml.map((uno) => claveSegura(uno.etiqueta));

    for (const uno of colgadoDelHtml) uno.nodo.remove();

    /**
     * EL DECIMOTERCER CANAL SE DEVUELVE A SU SITIO AQUI, ANTES DE AFIRMAR.
     *
     * Es lo mismo que hacen `restaurarLosAlmacenes`, el `window.name = ''`,
     * el `clearMarks()` y el borrado de atributos de aqui arriba, y hace falta
     * por la propiedad que hace peligroso a este canal: `cleanup()` no toca
     * `location`, asi que sin esta vuelta la pantalla que ensucie la URL hace
     * caer TAMBIEN a todos los tests que vengan detras en el mismo archivo y
     * el informe acusa al inocente. Esta observado en este repo antes de que
     * el canal existiera: la query que sembraba un test aparecia intacta en el
     * siguiente.
     *
     * Se vuelve con la `replaceState` ORIGINAL y no con la doblada, por dos
     * cosas: el espia anotaria esta restauracion como una llamada de la
     * pantalla, y despues del `vi.restoreAllMocks()` de un spec puede que la
     * doblada ya no este. Y se vuelve a la foto DE AL CARGAR —no a una del
     * `beforeEach`—, que es la que hace verdadera la premisa de la forma
     * fuerte en cada test.
     *
     * `replaceState` y no `pushState`: volver no debe dejar una entrada mas en
     * el historial.
     */
    const volverALaUrl = HISTORIAL_ORIGINAL.get('replaceState');
    volverALaUrl?.call(window.history, ESTADO_AL_CARGAR, '', URL_AL_CARGAR);

    /**
     * Las dos mitades del decimotercer canal, leidas ya y vaciadas antes de
     * afirmar: la URL que QUEDO —cruda y decodificada, mas el estado del
     * historial— y las llamadas a las cinco puertas, con sus argumentos.
     */
    const laUrl = `${urlComoTexto(urlAlTerminar)} ${fotoAlTerminar.estado}`;
    const llamadasAlHistorial = [...navegado];
    const loNavegado = llamadasAlHistorial
      .map((una) => `${una.puerta} ${una.argumentos}`)
      .join(' ');
    const puertasDelHistorial = [...new Set(llamadasAlHistorial.map((una) => una.puerta))];
    const partesCambiadas = PARTES_DE_LA_URL.filter(
      (parte) => fotoAlTerminar[parte] !== FOTO_AL_CARGAR[parte],
    );
    navegado.length = 0;

    /**
     * POR QUE PUERTA SE FUE UN DATO CONCRETO, para el mensaje del fallo.
     *
     * El nombre de la puerta y el de la parte de la URL son vocabulario fijo
     * —`replaceState`, `hash`, `estado`—: ubican la fuga sin publicar ni un
     * caracter de lo que lleva dentro, que es la regla de todo este archivo.
     */
    const puertasQueLlevan = (valor: string): string => {
      const puertas = [
        ...new Set(
          llamadasAlHistorial
            .filter((una) => formaQueSeFue(una.argumentos, valor) !== undefined)
            .map((u) => u.puerta),
        ),
      ];

      // Sin ninguna puerta del historial, el dato entro escribiendo `location`
      // a pelo —`hash`, `assign` o `replace`—, que son accesores que no se
      // pueden doblar: ver el docblock de `PUERTAS_DEL_HISTORIAL`.
      return puertas.length === 0 ? 'una escritura directa en location' : puertas.join(', ');
    };

    expect(nombreDeLaPestana, 'la pantalla escribio en el nombre de la pestaña').toBe('');

    /**
     * `toBe(false)` sobre un `includes`, y NO `not.toContain(valor)`.
     *
     * Con `not.toContain`, Vitest imprime el argumento esperado en el informe:
     * el fallo de una contraseña filtrada filtraba la contraseña otra vez, al
     * registro de CI, que lo guarda mas tiempo y lo lee mas gente que la
     * consola del mostrador. Asi lo unico que se publica es el NOMBRE del dato
     * y un `true`.
     */
    for (const [nombre, valor] of todoLoVigilado()) {
      /**
       * LOS DIECIOCHO CANALES, CONTRA EL MISMO ALFABETO Y POR LA MISMA PUERTA.
       *
       * Cada afirmacion busca el centinela en TODAS sus formas —en claro,
       * %-codificado, en base64 con sus tres desplazamientos— y no solo en la
       * cruda: ver el docblock de `FormaDelDato` para el porque y para lo que
       * se queda fuera a proposito. Pasa por aqui para que una forma nueva se
       * agregue en UN sitio y la hereden los dieciocho, igual que el registro de
       * datos vigilados es uno solo y no uno por tapon.
       *
       * EL INFORME SIGUE SIN PUBLICAR NADA. `decirlo` recibe COMO se fue
       * —`' (en base64)'`, vocabulario fijo— y nunca el valor ni su
       * codificacion: publicar la codificacion seria publicar el dato, que es
       * el mismo modo de fallo que este archivo evita desde la primera linea.
       * Y cuando el dato sale en claro, que es el caso de siempre, `decirlo`
       * recibe la cadena vacia y el mensaje es IDENTICO al de antes.
       */
      const noSeFuePor = (texto: string, decirlo: (comoSeDijo: string) => string): void => {
        const forma = formaQueSeFue(texto, valor);
        expect(forma !== undefined, decirlo(forma?.comoSeDijo ?? '')).toBe(false);
      };

      noSeFuePor(titulo, (como) => `el titulo de la pagina lleva ${nombre}${como}`);
      noSeFuePor(loDicho, (como) => `la consola dijo ${nombre}${como}`);
      noSeFuePor(laCabecera, (como) => `la cabecera del documento lleva ${nombre}${como}`);
      noSeFuePor(loGuardado, (como) => `un almacen del navegador lleva ${nombre}${como}`);

      /**
       * EL SEPTIMO CANAL SE AFIRMA COMO EL BUFFER DE MARCAS, no como
       * `window.name`: por CENTINELAS y no por estar vacio. Pedir una imagen
       * es legitimo —la portada de un gimnasio pinta su logo con una URL
       * externa— y un canal que lo prohiba se desactiva el dia que alguien
       * necesite una. Lo que no es legitimo es meter un dato del mostrador en
       * la URL que se pide.
       */
      noSeFuePor(loPedidoPorImagen, (como) => `la URL de una imagen lleva ${nombre}${como}`);

      /**
       * EL OCTAVO CANAL, UN `expect` POR PUERTA.
       *
       * Como el de imagenes y el de marcas: por CENTINELAS y no por «ninguna
       * llamada». Mandar un mensaje, sincronizar dos pestañas o medir uso son
       * cosas legitimas; llevar un dato del mostrador dentro, no. Y como
       * siempre, el mensaje nombra la CLAVE del dato y nunca su valor: un
       * `not.toContain(secreto)` imprimiria el secreto en el informe de CI,
       * que lo guarda mas tiempo y lo lee mas gente que la consola del
       * mostrador.
       */
      /**
       * EL NOVENO CANAL, por centinelas Y ademas por «nada guardado», abajo.
       *
       * Este va en la clave de la entrada —`cache.put(claveTemporal, …)` mete
       * el dato en el NOMBRE, igual que un `localStorage.setItem`—. Lo que no
       * se mira es el CUERPO de la respuesta: ver el docblock de
       * `CACHES_ORIGINAL`.
       */
      noSeFuePor(
        loCacheado.join(' '),
        (como) => `el almacen de respuestas del navegador lleva ${nombre}${como}`,
      );

      noSeFuePor(loMensajeado, (como) => `un window.postMessage lleva ${nombre}${como}`);
      noSeFuePor(loDifundido, (como) => `un BroadcastChannel lleva ${nombre}${como}`);
      noSeFuePor(loBalizado, (como) => `un navigator.sendBeacon lleva ${nombre}${como}`);

      /**
       * EL DECIMO CANAL, por CENTINELAS y no por «ningun mensaje».
       *
       * Hablarle al service worker es legitimo y este producto ya lo hace:
       * `boton-de-push.tsx` espera a `navigator.serviceWorker.ready` para
       * suscribir las notificaciones de un alumno. Un canal que lo prohibiera
       * entero es de los que alguien desactiva el dia que lo necesita. Lo que
       * no es legitimo es meterle un dato del mostrador dentro: el worker
       * sobrevive a la pestaña y puede volver a sacarlo por puertas que ningun
       * tapon de esta pagina ve.
       *
       * El mensaje nombra la PUERTA y la CLAVE del dato, nunca su valor.
       */
      noSeFuePor(
        loMandadoAlTrabajador,
        (como) => `un postMessage al service worker lleva ${nombre}${como}`,
      );

      /**
       * EL UNDECIMO CANAL, por centinelas PRIMERO y por «ninguna base» abajo.
       *
       * Las dos mitades no sobran la una a la otra y el orden importa. Con la
       * forma fuerte sola, el informe de una credencial filtrada diria «la
       * pantalla escribio en IndexedDB» y habria que ir a buscar QUE se fue;
       * con los centinelas delante lo dice solo. Y los centinelas solos no
       * bastan: no cubren el dato que nadie registro, que es justamente el
       * caso de un `put(variables)` que se lleva el objeto entero.
       *
       * Se separan el NOMBRE DE LA BASE y LAS ESCRITURAS porque son dos sitios
       * distintos —un `indexedDB.open(claveTemporal)` publica el dato sin
       * escribir ni un registro— y el informe gana diciendo cual.
       *
       * El valor NUNCA entra en el mensaje, como en el resto del tapon: lo
       * unico que se publica es el NOMBRE del dato y un `true`.
       */
      noSeFuePor(
        lasBasesAbiertas,
        (como) => `el nombre de una base de IndexedDB lleva ${nombre}${como}`,
      );
      noSeFuePor(loEscritoEnLaBase, (como) => `una escritura en IndexedDB lleva ${nombre}${como}`);

      /**
       * EL DECIMOSEXTO CANAL, por centinelas PRIMERO y por «no se toco el
       * disco» abajo. Misma forma y mismo orden que IndexedDB, que es el
       * almacen al que mas se parece.
       *
       * DOS AFIRMACIONES porque son dos sitios: EL NOMBRE de un archivo o de
       * un directorio —un `getFileHandle(claveTemporal, { create: true })`
       * publica el secreto SIN ESCRIBIR UN BYTE, igual que un
       * `indexedDB.open(claveTemporal)`— y LO ESCRITO, que puede llegar como
       * cadena, como `ArrayBuffer`, como `Blob` o dentro de un
       * `{ type: 'write', data }` y que se desmenuza con
       * `contenidoDeUnaEscrituraEnDisco`.
       *
       * El valor NUNCA entra en el mensaje, como en el resto del tapon: lo
       * unico que se publica es el NOMBRE del dato y un `true`.
       */
      /**
       * EL DECIMOSEPTIMO CANAL, por centinelas PRIMERO y por «ninguna
       * notificacion» abajo. Misma forma y mismo orden que IndexedDB y que el
       * disco privado.
       *
       * UNA SOLA AFIRMACION para los dos sitios —el titulo y las opciones—
       * porque son partes del MISMO aviso y salen juntas a la misma pantalla;
       * lo que el informe necesita decir es POR CUAL DE LAS DOS PUERTAS y EN
       * QUE CAMPO, y eso lo dice `avisoQueLleva` sin publicar un caracter.
       *
       * El valor NUNCA entra en el mensaje, como en el resto del tapon: lo
       * unico que se publica es el NOMBRE del dato, la puerta, el nombre del
       * campo y un `true`.
       */
      noSeFuePor(
        loAvisado,
        (como) => `una notificacion del sistema lleva ${nombre}${como} (${avisoQueLleva(valor)})`,
      );

      /**
       * EL VIGESIMO CANAL, por centinelas PRIMERO y por «nada sin revocar»
       * abajo. Misma forma y mismo orden que las notificaciones: con los
       * centinelas delante el informe dice QUE se fue.
       */
      noSeFuePor(
        loPublicadoConUrl,
        (como) =>
          `un objeto publicado con URL.createObjectURL y sin revocar lleva ${nombre}${como}`,
      );

      noSeFuePor(
        losNombresDelDisco,
        (como) =>
          `el nombre de un archivo del disco privado lleva ${nombre}${como} (${discoQueLleva(valor)})`,
      );
      noSeFuePor(
        loEscritoEnElDisco,
        (como) =>
          `una escritura en el disco privado lleva ${nombre}${como} (${discoQueLleva(valor)})`,
      );

      /**
       * EL DUODECIMO CANAL, por centinelas PRIMERO y por «ni un atributo»
       * abajo.
       *
       * Las dos mitades no sobran la una a la otra, y el orden es el mismo que
       * el de IndexedDB y por el mismo motivo: con la forma fuerte sola, el
       * informe de un dato filtrado diria «la pantalla escribio atributos en
       * el <html>: data-ultimo-trabajo» y habria que ir a buscar QUE se fue en
       * el valor; con los centinelas delante lo dice solo. Y los centinelas
       * solos no bastan, porque no cubren el dato que nadie registro —una
       * bandera con el nombre del gimnasio, la lista de roles de quien entro—,
       * que es justamente lo que una «marca de diagnostico» se lleva.
       *
       * Un `expect` por elemento para que el informe diga en cual de los dos
       * fue. El valor NUNCA entra en el mensaje: lo unico que se publica es el
       * NOMBRE del dato y un `true`.
       */
      for (const cual of ALREDEDOR_DEL_CUERPO) {
        noSeFuePor(
          loPuestoAlrededor[cual],
          (como) => `un atributo del ${cual} lleva ${nombre}${como}`,
        );
      }

      /**
       * Y LA SEGUNDA MITAD DEL DUODECIMO: LO QUE CUELGA DEL `<html>`.
       *
       * Misma forma y mismo orden que los atributos de al lado —centinelas
       * primero, la forma fuerte abajo— y por lo mismo: con la forma fuerte
       * sola el informe diria «la pantalla colgo un <div>» y habria que ir a
       * buscar QUE llevaba dentro.
       *
       * El mensaje nombra la ETIQUETA y nunca el contenido, que es justamente
       * el volcado que esta fuga se lleva. Ver `loColgadoDelHtml`.
       */
      noSeFuePor(
        loColgado,
        (como) =>
          `un nodo colgado del <html> lleva ${nombre}${como} (${etiquetasColgadas.join(', ')})`,
      );

      /**
       * EL DECIMOTERCER CANAL, por centinelas PRIMERO y por «la URL no
       * cambio» abajo.
       *
       * Mismo orden y mismo motivo que IndexedDB y que los atributos del
       * `<html>`: con la forma fuerte sola, el informe diria «la pantalla
       * cambio la URL del documento: hash» y habria que ir a buscar QUE se
       * fue; con los centinelas delante lo dice solo. Y los centinelas solos
       * no bastan, porque no cubren el dato que nadie registro —el nombre del
       * gimnasio, la lista de quien entro hoy— que es justamente lo que un
       * «enlace para compartir la pantalla» se lleva.
       *
       * DOS AFIRMACIONES, una por mitad, porque son dos sitios distintos: la
       * URL que QUEDO —donde cae tambien un `location.hash = …`, que no pasa
       * por ninguna funcion doblable— y lo que se le PASO a una de las cinco
       * puertas, donde cae ademas un `pushState(datos, '', la misma URL)`, que
       * no deja nada en la barra de direcciones.
       *
       * El valor NUNCA entra en el mensaje, como en el resto del tapon: lo
       * unico que se publica es el NOMBRE del dato y un `true`. Un
       * `not.toContain(url)` aqui seria exactamente la fuga otra vez, hacia el
       * registro de CI.
       */
      noSeFuePor(
        laUrl,
        (como) =>
          `la URL del documento lleva ${nombre}${como} (cambio: ${partesCambiadas.join(', ')}; por: ${puertasQueLlevan(valor)})`,
      );

      noSeFuePor(
        loNavegado,
        (como) => `una llamada a ${puertasQueLlevan(valor)} lleva ${nombre}${como}`,
      );

      /**
       * EL DECIMOCUARTO CANAL, por CENTINELAS y no por «ninguna peticion».
       *
       * Es la forma del `src` de una imagen, de las salidas laterales y del
       * service worker, y aqui esta MEDIDA sobre los 74 specs: de las 467
       * peticiones del paquete, 96 no salen de `pedir` y vienen de cinco
       * sitios de produccion que estan ahi a proposito —el login y el registro
       * hablan con las rutas del BFF que escriben la cookie, la landing habla
       * con la API publica desde el servidor, el comprobante se sube firmado al
       * almacen—. La forma fuerte seria roja con el codigo correcto en cinco
       * specs y la unica manera de sostenerla seria una lista blanca de
       * destinos. El razonamiento entero y lo que esto deja pasar estan en el
       * docblock de `PuertaDeRed`.
       *
       * SE MIRAN EL DESTINO Y LA CARGA JUNTOS porque son dos sitios del mismo
       * agujero —el query sale al registro de acceso del otro lado y el cuerpo
       * en la peticion— y el informe no gana nada separandolos: el mensaje
       * nombra la PUERTA, que ya dice cual de los dos fue.
       *
       * Y EL MENSAJE NO PUBLICA LA URL, que en este canal es la parte dificil:
       * el destino es justamente donde vive la fuga. Se nombra el ORIGEN, por
       * `claveSegura`, y nunca la ruta ni el query. Ver `haciaDondeVa`.
       */
      noSeFuePor(
        loPedidoPorRed,
        (como) =>
          `una peticion de red por fuera de \`pedir\` lleva ${nombre}${como} (${redQueLleva(valor)})`,
      );

      /**
       * EL DECIMOQUINTO CANAL, por CENTINELAS **Y CON LA RESTA**, que es lo
       * que lo distingue de los otros quince.
       *
       * No se afirma «ningun centinela en un sitio no serializado», que seria
       * rojo con el codigo correcto en media docena de specs —una pantalla de
       * edicion pinta `<input value={persona.nombreCompleto}>` y React escribe
       * ahi el atributo Y la propiedad—. Se afirma que no hay ninguno
       * ESCONDIDO: que lo que lleva ese sitio no serializado NO este tambien
       * en lo que el marcado publica. El dato puede estar a la vista —ahi lo
       * miran los tests de pantalla, que es el otro lado del reparto—; lo que
       * no puede es estar donde no mira ningun instrumento.
       *
       * UN `expect` POR ESCONDITE, y no uno por todos juntos, porque el
       * informe gana nombrando EL SITIO: `el .value de un <input type="text">`
       * ubica la fuga de un vistazo y `un sitio del cuerpo` no.
       *
       * Y EL INFORME NO PUBLICA EL VOLCADO, que es la parte dificil aqui: el
       * contenido de un escondite es justamente el dato. Se afirma con la
       * misma forma que el resto del tapon —`toBe(false)` sobre un booleano,
       * nunca `not.toContain(valor)`—, asi que lo unico que sale al registro
       * de CI es el NOMBRE del dato, el nombre del sitio y un `true`. El test
       * local que descubrio esto usaba `not.toContain` y publicaba el
       * `'[{"perfilId":"perfil-ana-que-vino-lis…'` entero.
       */
      // La resta se calcula UNA vez por centinela y no una por escondite: no
      // depende del sitio, y en una pantalla con treinta controles serian
      // treinta barridas del marcado entero para contestar lo mismo.
      if (escondites.length > 0 && formaQueSeFue(marcadoDelCuerpo, valor) === undefined) {
        for (const escondite of escondites) {
          noSeFuePor(escondite.contenido, (como) => `${escondite.sitio} esconde ${nombre}${como}`);
        }
      }

      /**
       * EL SEXTO CANAL SE AFIRMA COMO LOS ALMACENES Y NO COMO `window.name`.
       *
       * De `window.name` se puede afirmar que esta VACIO porque nadie mas
       * escribe ahi. Del buffer de User Timing, NO, y conviene ser exacto con
       * el motivo, que SE REMIDIO al montar el duodecimo canal y ya no dice lo
       * que decia. Cuando se escribio esto el buffer estaba vacio en los 58
       * archivos que habia —ni React 19.1 ni Vitest 3.2 ponen una sola
       * entrada— y un `toBe(0)` sobre las entradas nuevas habria pasado en
       * verde. HOY, con 66 archivos, YA NO: sigue sin haber una sola entrada
       * de React ni del runner, pero `relojes-falsos.spec.ts` SIEMBRA UNA A
       * PROPOSITO —`performance.mark('relojes-falsos:sonda')`— para probar que
       * con los relojes falsos puestos la marca llega al buffer de verdad. O
       * sea que la forma fuerte seria ROJA hoy mismo, y contra el unico spec
       * que existe para custodiar este canal. No se pone, entonces, por TRES
       * cosas y ya no por dos. La primera es que ese verde no
       * depende de nosotros: React instrumenta con `performance.measure` en
       * sus pistas de rendimiento y basta una version para que el tapon
       * empiece a acusar al runner. La segunda es que medir latencia ES
       * legitimo —al reves que meter un `<meta>` en el `<head>`, que aqui no
       * lo es nunca—, y un canal que prohibe medir se desactiva el dia que
       * alguien necesite medir. Lo que no es legitimo es meter un dato del
       * mostrador en el nombre —o en el `detail`— de la medicion. Y la
       * tercera, la que ya no es hipotetica: el propio paquete mide a
       * proposito, asi que la forma fuerte no es que fuera a costar algo
       * mañana, es que cuesta hoy.
       *
       * Se separan `mark` y `measure` en dos afirmaciones para que el informe
       * diga por cual de las dos puertas se fue, sin decir por donde: lo unico
       * que se publica sigue siendo el NOMBRE del dato.
       */
      for (const tipo of TIPOS_DE_ENTRADA) {
        noSeFuePor(
          loCronometrado[tipo],
          (como) => `una entrada de performance.${tipo} lleva ${nombre}${como}`,
        );
      }
    }

    /**
     * LA OTRA MITAD DEL `<head>`, y NO es la misma que la de arriba.
     *
     * «No contiene centinelas» caza un dato metido en un nodo que ya estaba.
     * Esto caza el nodo NUEVO aunque lo que lleve dentro no sea ninguno de los
     * datos sembrados: un `<meta name="description">` con la lista de las
     * clases del dia no lleva centinela y publica el gimnasio entero.
     */
    expect(
      aparecidosEnLaCabecera.length,
      `la pantalla metio nodos en el <head>: ${aparecidosEnLaCabecera.map(etiquetaDe).join(', ')}`,
    ).toBe(0);

    for (const almacen of ALMACENES) {
      const claves = [...guardado[almacen]].map(claveSegura);

      expect(claves.length, `la pantalla guardo en ${almacen}: ${claves.join(', ')}`).toBe(0);
    }

    /**
     * EL CUARTO ALMACEN, afirmado como los otros tres: NADA GUARDADO.
     *
     * `sw.ts` ya lleva escrita la politica —el panel del admin no entra nunca
     * en la CacheStorage, porque el mostrador es una computadora compartida y
     * ese almacen sobrevive al cierre de sesion— y la cumple con una lista
     * blanca de dos rutas del alumno. Esto cierra la OTRA puerta al mismo
     * almacen: la que una pantalla puede abrir por su cuenta sin pasar por el
     * service worker.
     *
     * Las claves van por `claveSegura`, como las de los otros almacenes: el
     * informe nombra el dato vigilado en vez de publicar la cadena.
     */
    expect(
      loCacheado.length,
      `la pantalla guardo respuestas en CacheStorage: ${loCacheado.map(claveSegura).join(', ')}`,
    ).toBe(0);

    /**
     * EL QUINTO ALMACEN, afirmado por LA FORMA FUERTE: ni una base abierta.
     *
     * Es la forma de `window.name` y no la de las imagenes, y el motivo esta
     * medido en el docblock de `INDEXED_DB_ORIGINAL`: el producto no tiene
     * NINGUN uso legitimo de esta puerta —cero coincidencias de `indexedDB`,
     * `IDB*` o `idb` en `apps/web/src`— y nada del arbol de dependencias abre
     * una base durante un test. Donde no hay uso legitimo que proteger, la
     * forma fuerte es gratis y caza ademas el dato que nadie registro.
     *
     * DOS AFIRMACIONES Y NO UNA, y la mas especifica primero: si hubo una
     * escritura, el informe nombra LA PUERTA —`put`, `add` o `cursor.update`—,
     * la base, el almacen y la clave. Si solo se abrio la base sin escribir
     * nada, lo dice la segunda. Ni una de las dos imprime un valor.
     */
    expect(
      puertasDeLaBase.length,
      `la pantalla escribio en IndexedDB: ${puertasDeLaBase.join(', ')}`,
    ).toBe(0);

    expect(
      nombresDeLasBases.length,
      `la pantalla abrio una base de IndexedDB: ${nombresDeLasBases.join(', ')}`,
    ).toBe(0);

    /**
     * EL SEXTO ALMACEN, afirmado por LA FORMA FUERTE: ni una puerta del disco.
     *
     * Es la forma de `window.name`, de IndexedDB y de los atributos del
     * `<html>`, y no la de las imagenes. El motivo esta medido en el docblock
     * de `ALMACEN_DE_ARCHIVOS_ORIGINAL`: el producto no tiene NINGUN uso
     * legitimo de esta puerta —cero coincidencias de `navigator.storage`,
     * `getDirectory`, `StorageManager`, `OPFS` o `FileSystemHandle` en
     * `apps/web/src`— y nada del arbol de dependencias pide el disco privado
     * durante un test. Donde no hay uso legitimo que proteger, la forma fuerte
     * es gratis y caza ademas el dato que nadie registro, que es justo el caso
     * de un `write(JSON.stringify(pago))` que se lleva el objeto entero.
     *
     * UNA SOLA AFIRMACION Y NO DOS, al reves que IndexedDB: alli la base y el
     * almacen son dos nombres distintos y la escritura se nombra aparte; aqui
     * cada paso ya trae SU puerta y SU ruta, asi que una lista basta y el
     * informe dice igual de bien si solo se pidio la raiz
     * —`getDirectory en la raiz`— o si se escribio un archivo
     * —`createWritable().write en /cobros-del-dia.json`—.
     *
     * Ni la ruta ni el contenido se publican en crudo: cada segmento pasa por
     * `claveSegura`, como las claves de los almacenes y los nombres de las
     * bases, y el contenido no entra nunca en el mensaje.
     */
    expect(
      puertasDelDisco.length,
      `la pantalla uso el disco privado del origen: ${puertasDelDisco.join(', ')}`,
    ).toBe(0);

    /**
     * EL CENTRO DE NOTIFICACIONES DEL SISTEMA: NI UN AVISO.
     *
     * La forma de `window.name`, de IndexedDB, de los atributos del `<html>` y
     * del disco privado, y NO la del `src` de una imagen. La duda era real
     * —notificar ES legitimo en este producto— y la medida que la resuelve es
     * la del paquete entero: con esta afirmacion puesta, LOS 81 SPECS SIGUEN EN
     * VERDE, porque en este producto los avisos los muestra el SERVICE WORKER
     * desde su manejador de `push` y lo unico que hace una pagina es PEDIR EL
     * PERMISO —que no es una puerta de este canal—. Cero `new Notification` y
     * cero `showNotification` en `apps/web/src` fuera de `sw.ts`.
     *
     * Donde no hay uso legitimo que proteger, la forma fuerte sale gratis y
     * caza ademas EL DATO QUE NADIE REGISTRO, que es justo el caso de la `nota`
     * de un cobro: texto libre que nadie puede sembrar como centinela.
     *
     * El informe nombra LA PUERTA —`new Notification` o `showNotification`— y
     * los NOMBRES de los campos por `claveSegura`; nunca el titulo, nunca el
     * cuerpo, nunca el `tag` ni el `data`.
     */
    expect(
      puertasDeAviso.length,
      `la pantalla mostro una notificacion del sistema: ${puertasDeAviso.join(', ')}`,
    ).toBe(0);

    /**
     * LOS DOS ELEMENTOS QUE ENVUELVEN AL CUERPO: NI UN ATRIBUTO.
     *
     * La forma de `window.name` y de IndexedDB, no la de las imagenes, y el
     * motivo esta medido en el docblock de `ALREDEDOR_DEL_CUERPO`: el producto
     * no tiene NINGUN uso legitimo de esta puerta —cero `documentElement` y
     * ningun `setAttribute`, `classList` ni `dataset` sobre `<html>` o
     * `<body>` en `apps/web/src`— y nadie del arbol escribe ahi durante un
     * test. Poner el idioma, el tema o una bandera de funcionalidad desde un
     * efecto de PANTALLA no es cosa de una pantalla: eso lo decide el layout,
     * del lado del servidor, donde no corre este tapon. Donde no hay uso
     * legitimo que proteger, la forma fuerte es gratis y caza ademas el dato
     * que nadie registro.
     *
     * CONTRA EL CONJUNTO VACIO Y NO CONTRA UNA FOTO DEL `beforeEach`. Con una
     * foto inicial, un atributo que hubiera dejado un test ANTERIOR del
     * archivo estaria en las dos fotos y pasaria en verde — que es la propiedad
     * 1 del canal (`cleanup()` no los borra) usada al reves, y justo el caso
     * que este tapon existe para cazar. La limpieza de aqui arriba hace
     * verdadera la premisa de la forma fuerte en cada test.
     *
     * Los nombres van por `claveSegura`, como las claves de los almacenes y
     * como los nombres de las bases: un `setAttribute(claveTemporal, '1')`
     * mete el dato en el NOMBRE, y el informe dice entonces como se llama el
     * dato vigilado en vez de publicar la cadena. Y NUNCA se imprime el VALOR,
     * que es lo que la «marca de diagnostico» se lleva.
     */
    for (const cual of ALREDEDOR_DEL_CUERPO) {
      const nombresDeLosAtributos = atributosDeAlrededor[cual].map(([nombre]) =>
        claveSegura(nombre),
      );

      expect(
        nombresDeLosAtributos.length,
        `la pantalla escribio atributos en el ${cual}: ${nombresDeLosAtributos.join(', ')}`,
      ).toBe(0);
    }

    /**
     * Y EL `<html>` NO TIENE UN TERCER HIJO.
     *
     * La forma fuerte de la otra mitad de este canal, y sale gratis por la
     * misma clase de medida que la de los atributos: el `<html>` de un test de
     * este paquete tiene EXACTAMENTE `<head>` y `<body>` —sonda— y con esta
     * afirmacion puesta los 84 specs siguen en verde. Nadie —ni Next, ni React
     * 19, ni Testing Library, ni ningun proveedor— cuelga nada ahi.
     *
     * Y caza ademas EL NODO QUE NO LLEVA NINGUN CENTINELA, que es justo lo que
     * una «marca de diagnostico» se lleva: la lista entera de lo que haya en
     * pantalla, que nadie puede sembrar como centinela.
     *
     * Las etiquetas van por `claveSegura`, como los nombres de los atributos:
     * el informe dice QUE se colgo y nunca lo que llevaba dentro.
     */
    expect(
      etiquetasColgadas.length,
      `la pantalla colgo nodos del <html>, fuera del <head> y del <body>: ${etiquetasColgadas.join(', ')}`,
    ).toBe(0);

    /**
     * LA URL DEL DOCUMENTO: NI UN CARACTER DISTINTO, Y NI UNA LLAMADA A MANO.
     *
     * La forma de `window.name`, de IndexedDB y de los atributos del `<html>`,
     * no la de las imagenes, y el motivo esta MEDIDO en el docblock de
     * `PUERTAS_DEL_HISTORIAL`: media docena de pantallas escriben en la URL a
     * proposito —los filtros de turnos, horarios, ausencias y analisis— pero
     * lo hacen POR EL ROUTER DE NEXT, y los 26 specs que usan `next/navigation`
     * lo doblan con `vi.fn()` sin tocar `location`. Lo unico que puede mover
     * `location` dentro de un test es alguien saltandose el router, que es la
     * fuga. Donde no hay uso legitimo que proteger, la forma fuerte es gratis
     * y caza ademas el dato que nadie registro.
     *
     * DOS AFIRMACIONES Y NO UNA, y la mas concreta primero. Si la URL se
     * movio, el informe nombra LAS PARTES —origen, ruta, query, hash o el
     * estado del historial— y eso ubica la fuga sin publicar ni un caracter de
     * lo que lleva dentro. Si no se movio pero alguien llamo a una de las
     * cinco puertas —el caso del `pushState(datos, '', la misma URL)`, y el
     * del `replaceState` que limpia tres lineas despues lo que acaba de
     * escribir—, lo dice la segunda, nombrando LA PUERTA.
     *
     * Ni una de las dos imprime una URL, un estado ni un argumento.
     */
    expect(
      partesCambiadas.length,
      `la pantalla cambio la URL del documento: ${partesCambiadas.join(', ')}`,
    ).toBe(0);

    expect(
      puertasDelHistorial.length,
      `la pantalla movio el historial a mano: ${puertasDelHistorial.join(', ')}`,
    ).toBe(0);

    /**
     * LAS OTRAS CINCO PUERTAS DE RED: NI UNA PETICION.
     *
     * La forma de `window.name`, de IndexedDB y de los atributos del `<html>`,
     * y NO la de `fetch`, que es el unico de los seis que tiene uso legitimo
     * en este producto. El motivo esta medido: cero `XMLHttpRequest`, cero
     * `WebSocket`, cero `EventSource`, cero `Worker` y cero `SharedWorker` en
     * `apps/web/src`, y nada del arbol de dependencias abre ninguna de las
     * cinco durante un test. Donde no hay uso legitimo que proteger, la forma
     * fuerte es gratis y caza ademas el dato que nadie registro —que es justo
     * lo que `fetch` no puede cazar—.
     *
     * El informe nombra la PUERTA, el metodo y el ORIGEN por `claveSegura`:
     * nunca la ruta, nunca el query, nunca el cuerpo.
     */
    expect(
      puertasDeOtraRed.length,
      `la pantalla pidio red por una puerta que no es fetch: ${puertasDeOtraRed.join(', ')}`,
    ).toBe(0);

    /**
     * Y NINGUN OBJETO PUBLICADO SIN REVOCAR.
     *
     * La forma fuerte del vigesimo canal, gratis por la medida de siempre: cero
     * `createObjectURL` en `apps/web/src`. Caza ademas el objeto que no lleva
     * ningun centinela —un CSV con datos que nadie registro—, y el informe
     * dice el TIPO de lo que quedo y nunca lo que lleva.
     */
    expect(
      tiposSinRevocar.length,
      `la pantalla publico objetos con URL.createObjectURL y no los revoco: ${tiposSinRevocar.join(', ')}`,
    ).toBe(0);
  });
}
