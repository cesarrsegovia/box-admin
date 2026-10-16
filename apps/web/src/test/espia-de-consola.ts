import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, vi } from 'vitest';

/**
 * LOS CANALES POR LOS QUE UNA PANTALLA DICE ALGO FUERA DEL `<body>`.
 *
 * `console.*`, `document.title`, `window.name`, el `<head>` del documento y los
 * tres almacenes del navegador. Ninguno lo mira un test de pantalla: los tests
 * miran el marcado DEL CUERPO, los cuerpos de las peticiones, las rutas y las
 * dos caches. Se vigilan todos juntos, GLOBAL —desde `vitest.setup.ts`— y
 * contra EL MISMO registro de datos vigilados, por tres motivos que ya se
 * pagaron una vez cada uno:
 *
 * 1. GLOBAL, porque un agujero de canal no es de una pantalla. El espia de la
 *    consola empezo siendo manual y lo engancharon cinco specs de cuarenta y
 *    nueve: `console.*` estaba sin vigilar en el 90% del paquete, incluida la
 *    ficha de una persona, que es la que enseña la contraseña del reset.
 *
 * 2. UN SOLO REGISTRO, porque pasarle el centinela a cada tapon por separado es
 *    acordarse tres veces. Un spec declara UNA vez lo que sembro y los tres lo
 *    cubren; el que viene detras no tiene que saber cuantos tapones hay.
 *
 * 3. Y EL REGISTRO ES ABIERTO, no una lista de tres literales. `vigilarElTitulo`
 *    nacio comparando contra `SECRETOS_DEL_PANEL` y nada mas: un `document.title`
 *    con el nombre de una profesora, o con la lista de turnos del dia, pasaba en
 *    verde. Era una lista negra —el patron contra el que este repo predica—
 *    puesta en infraestructura que comparten cuarenta y nueve specs.
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

/**
 * Como nombrar una clave guardada SIN publicar un secreto que venga de clave.
 *
 * `localStorage.setItem(claveTemporal, '1')` mete el dato en el NOMBRE, no en
 * el valor. El informe dice entonces como se llama el dato vigilado y no la
 * cadena, igual que hace el resto del tapon.
 */
function claveSegura(clave: string): string {
  for (const [nombre, valor] of todoLoVigilado()) {
    if (valor !== '' && clave.includes(valor)) return `«${nombre}»`;
  }

  return clave;
}

/**
 * EL TAPON DE LOS TRES CANALES, en todos los specs.
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
 */
export function vigilarLosCanalesDeSalida(): void {
  const dicho: unknown[] = [];
  let tituloAlEmpezar = '';
  let cabeceraAlEmpezar = new Set<Element>();
  let almacenesAlEmpezar = estadoDeLosAlmacenes();
  const escrito: EscrituraEnAlmacen[] = [];

  beforeEach(() => {
    tituloAlEmpezar = document.title;
    cabeceraAlEmpezar = new Set(nodosDeLaCabecera());
    almacenesAlEmpezar = estadoDeLosAlmacenes();
    dicho.length = 0;
    escrito.length = 0;

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
  });

  afterEach(() => {
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
    document.title = tituloAlEmpezar;
    window.name = '';
    dicho.length = 0;
    restaurarLosAlmacenes(almacenesAlEmpezar);
    escrito.length = 0;

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
      expect(titulo.includes(valor), `el titulo de la pagina lleva ${nombre}`).toBe(false);
      expect(loDicho.includes(valor), `la consola dijo ${nombre}`).toBe(false);
      expect(laCabecera.includes(valor), `la cabecera del documento lleva ${nombre}`).toBe(false);
      expect(loGuardado.includes(valor), `un almacen del navegador lleva ${nombre}`).toBe(false);
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
  });
}
