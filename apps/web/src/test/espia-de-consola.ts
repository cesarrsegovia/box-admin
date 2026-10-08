import { afterEach, beforeEach, expect, vi } from 'vitest';

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
 * EL TITULO DE LA PAGINA ES UN CANAL DE SALIDA, no una decoracion.
 *
 * Meter el codigo de una invitacion en `document.title` sobrevive a los 48
 * tests de esa pantalla: todos miran el DOM, los cuerpos, las rutas, los
 * almacenes y las dos caches, y ninguno mira el titulo. No es inocuo: el titulo
 * va a la base de historial EN DISCO, al archivo de restauracion de sesion, al
 * conmutador de pestañas —visible para quien pase por detras del mostrador—, a
 * cualquier captura o pantalla compartida, y es lo que toda SDK de analitica o
 * de errores manda por defecto como nombre de pagina. Un gimnasio que enchufe
 * analitica mañana publica sus codigos de invitacion a un tercero sin que nadie
 * lo decida.
 *
 * Se registra GLOBAL (desde `vitest.setup.ts`) y no spec por spec: el agujero
 * no es de la pantalla de invitaciones, es de cualquier pantalla que tenga un
 * secreto a mano, y una pantalla nueva no deberia tener que acordarse de pedir
 * el tapon. Vigila los tres secretos en todos los specs; en los que no siembran
 * ninguno no cuesta nada y sigue siendo cierto.
 */
export function vigilarElTitulo(): void {
  let tituloAlEmpezar = '';

  beforeEach(() => {
    tituloAlEmpezar = document.title;
  });

  afterEach(() => {
    const titulo = document.title;

    // Se devuelve a como estaba ANTES de afirmar nada: si no, el test que
    // ensucia el titulo hace caer tambien a los que vengan detras y el informe
    // acusa al inocente.
    document.title = tituloAlEmpezar;

    for (const [nombre, secreto] of Object.entries(SECRETOS_DEL_PANEL)) {
      expect(titulo, `el titulo de la pagina lleva ${nombre}`).not.toContain(secreto);
    }
  });
}

/**
 * LO QUE LA PANTALLA DICE FUERA DEL DOM.
 *
 * Esto no es un test de un caso: es una DIMENSION que no auditaba nadie. Antes
 * de existir este archivo, ni un solo spec de `apps/web` mencionaba `console`,
 * y un `console.info('[alta]', respuesta)` —la traza de depuracion mas banal
 * que existe— pasaba las cincuenta pruebas de esta pantalla con la unica
 * contraseña del sistema que se ve una vez dentro.
 *
 * El daño es concreto: la maquina del mostrador la usan cuatro personas por
 * turno, la consola guarda lo dicho mientras la pestaña viva y cualquier SDK de
 * errores que se enchufe mañana se lleva eso como breadcrumb a un servidor de
 * terceros sin que nadie lo decida.
 *
 * Se vigilan TODOS los metodos de `console`, no una lista escrita a mano: con
 * cinco nombres fijos, un `console.table(respuesta)` el año que viene vuelve a
 * abrir el agujero entero y el test seguiria en verde diciendo otra cosa.
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

/**
 * Engancha el espia y devuelve el comprobador.
 *
 * Se usa en pareja: `beforeEach(() => { comprobar = espiarLaConsola(); })` y
 * `afterEach(() => comprobar('<centinela>'))`.
 */
export function espiarLaConsola(): (centinela: string) => void {
  const dicho: unknown[] = [];

  const consola = console as unknown as Record<string, (...partes: unknown[]) => void>;

  for (const nombre of metodosDeConsola()) {
    const original = consola[nombre]?.bind(console);

    // Registra Y deja pasar. Tragarse la salida dejaria mudo al propio test el
    // dia que React avise de algo por la consola, que es justo cuando hace
    // falta leerlo.
    vi.spyOn(consola, nombre).mockImplementation((...partes: unknown[]) => {
      dicho.push(...partes);
      original?.(...partes);
    });
  }

  return (centinela: string) => {
    // Se mira el TOTAL de lo dicho, serializado, no un metodo concreto ni el
    // primer argumento: la clave suele viajar DENTRO de un objeto que se pasa
    // como segundo o tercer argumento y que la consola expande sola.
    const todo = dicho
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

    dicho.length = 0;

    expect(todo).not.toContain(centinela);
  };
}
