import { afterEach, beforeEach, expect, vi } from 'vitest';

/**
 * LOS TRES CANALES POR LOS QUE UNA PANTALLA DICE ALGO FUERA DEL DOM.
 *
 * `console.*`, `document.title` y `window.name`. Ninguno lo mira un test de
 * pantalla: los tests miran el marcado, los cuerpos, las rutas, los almacenes y
 * las dos caches. Los tres se vigilan juntos, GLOBAL —desde `vitest.setup.ts`—
 * y contra EL MISMO registro de datos vigilados, por tres motivos que ya se
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
 */
export function vigilarLosCanalesDeSalida(): void {
  const dicho: unknown[] = [];
  let tituloAlEmpezar = '';

  beforeEach(() => {
    tituloAlEmpezar = document.title;
    dicho.length = 0;

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
  });

  afterEach(() => {
    const titulo = document.title;
    const nombreDeLaPestana = window.name;
    // Se mira el TOTAL de lo dicho, serializado, no un metodo concreto ni el
    // primer argumento: el dato suele viajar DENTRO de un objeto que se pasa
    // como segundo o tercer argumento y que la consola expande sola.
    const loDicho = comoTexto(dicho);

    // Los tres canales se devuelven a como estaban ANTES de afirmar nada: si no,
    // el test que ensucia uno hace caer tambien a los que vengan detras y el
    // informe acusa al inocente.
    document.title = tituloAlEmpezar;
    window.name = '';
    dicho.length = 0;

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
    }
  });
}
