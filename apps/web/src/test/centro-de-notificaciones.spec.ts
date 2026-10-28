import { describe, expect, it } from 'vitest';
import {
  camposDeUnAviso,
  formaQueSeFue,
  notificacionDeMentira,
  SECRETOS_DEL_PANEL,
} from './espia-de-consola';

/**
 * EL GUARDIAN DEL DECIMOSEPTIMO CANAL, Y POR QUE ESTE SI TIENE SPEC.
 *
 * Los canales no tienen spec a proposito: lo que hay que comprobar de un tapon
 * es que una mutacion lo hace caer, y eso se mide con la mutacion y no con un
 * test que repita el codigo del tapon en otro orden. Aqui la situacion es la de
 * `relojes-falsos.spec.ts`, la de `alfabeto-de-centinelas.spec.ts`, la de
 * `red-por-fuera-de-pedir.spec.ts`, la de `lo-que-el-marcado-no-serializa.spec.ts`
 * y la de `disco-privado.spec.ts`: **ESTO NO SE VE DESDE FUERA**.
 *
 * No hay un solo `new Notification` ni un solo `showNotification` en
 * `apps/web/src` fuera de `sw.ts` —esa es, de hecho, la medida que permite
 * afirmar la forma fuerte—, asi que NINGUN spec de pantalla toca este canal
 * nunca. O sea que si alguien:
 *
 *  - monta `Notification.permission` en `'default'` —que es el valor «neutro» y
 *    el que cualquiera elegiria sin pensarlo—, LA RAMA DE LA FUGA NO SE
 *    EJECUTA: el canal queda instalado, el informe dice que se miro y no se
 *    mira nada;
 *  - «simplifica» `camposDeUnAviso` a mirar el titulo y el `body`, y entonces
 *    un `tag: \`cobro-${perfilId}\`` o un `data` anidado pasan enteros;
 *  - decide que las URLs no llevan dato y deja fuera `icon`, `badge` e `image`;
 *  - monta `PushManager` «ya que estamos», y enciende el boton de push en los
 *    81 specs sin que nadie lo pida;
 *  - o le quita el `showNotification` al registro de mentira del decimo canal,
 *    y entonces la OTRA puerta del mismo centro de notificaciones vuelve a ser
 *    invisible,
 *
 * LOS 1762 TESTS SIGUEN EN VERDE y el canal se queda ciego. Las cinco averias
 * son invisibles desde cualquier spec de pantalla, asi que la unica forma de
 * custodiarlas es medirlas. Este archivo mide las cinco.
 *
 * DOS COSAS SE MIDEN CONTRA EL TAPON DE VERDAD Y EL RESTO CONTRA UNA CLASE
 * PROPIA, y la frontera no es una comodidad: el tapon se afirma por la FORMA
 * FUERTE —mostrar una notificacion ES el fallo—, asi que un test que
 * construyera un aviso con el `Notification` instalado se haria caer a si mismo
 * en el `afterEach` del espia. Lo que SI se puede leer del tapon de verdad es
 * lo que no es una puerta: el valor de `permission`, la existencia de las dos
 * funciones y la AUSENCIA de `PushManager`. `notificacionDeMentira` y
 * `camposDeUnAviso` se exportan justamente para el resto, como `raizDeMentira`
 * y `vinoDePedir`: el guardian arma la suya con su propio `anotar` y construye
 * avisos sin tocar nada global.
 *
 * NO REGISTRA NINGUN CENTINELA PROPIO —no llama a `vigilarEstosDatos`— y nada
 * de lo que construye sale por ningun canal: la clase de aqui abajo esta
 * desconectada del tapon y no muestra nada en ninguna parte.
 *
 * EL DATO QUE MUEVE ES `claveDelReset`, QUE ES UN SECRETO DEL PANEL, y eso es a
 * proposito y por dos cosas. La primera es la de `disco-privado.spec.ts`: un
 * guardian que moviera una cadena cualquiera no probaria nada contra el tapon,
 * y con un centinela de verdad, si alguna de estas lineas lo sacara por un
 * canal sin querer, el espia lo diria. La segunda es que viene de
 * `SECRETOS_DEL_PANEL` y no escrito a mano: con la cadena en dos sitios,
 * cambiar la de alla dejaria a este archivo midiendo contra un centinela que ya
 * no existe.
 *
 * Y SE AFIRMA SOBRE BOOLEANOS, NUNCA CON `toContain(valor)`, que es la regla de
 * `espia-de-consola.ts` llevada aqui: un `toContain` imprime el argumento
 * esperado en el informe, o sea que el fallo de un test sobre un secreto
 * publicaria el secreto en el registro de CI. Lo unico que sale de aqui es un
 * `true` o un `false`.
 */

/** El centinela que recorre este archivo. Vive en un sitio solo. */
const CENTINELA = SECRETOS_DEL_PANEL.claveDelReset;

/** Un aviso anotado, con la misma forma que el tapon usa por dentro. */
interface Aviso {
  puerta: string;
  campos: { nombre: string; contenido: string }[];
}

/** Una clase de mentira desconectada del tapon, con su propia libreta. */
function conLibreta(): { Aviso: ReturnType<typeof notificacionDeMentira>; anotados: Aviso[] } {
  const anotados: Aviso[] = [];

  return { Aviso: notificacionDeMentira((uno) => anotados.push(uno)), anotados };
}

/** Si ALGUNO de los campos anotados lleva el centinela, en cualquiera de sus formas. */
function algunCampoLoLleva(campos: { nombre: string; contenido: string }[]): boolean {
  return campos.some((campo) => formaQueSeFue(campo.contenido, CENTINELA) !== undefined);
}

/** En QUE campo quedo, para poder afirmar sobre el nombre sin publicar el valor. */
function dondeQuedo(campos: { nombre: string; contenido: string }[]): string[] {
  return campos
    .filter((campo) => formaQueSeFue(campo.contenido, CENTINELA) !== undefined)
    .map((campo) => campo.nombre);
}

describe('el permiso con el que se monta el canal, que es lo que decide si ve algo', () => {
  it('`Notification.permission` dice `granted`, no `default`', () => {
    // LA MEDIDA QUE SOSTIENE EL CANAL ENTERO. El codigo prudente —y aqui el
    // prudente es el unico correcto— pregunta antes de construir:
    //
    //     if (typeof Notification !== 'undefined' && Notification.permission === 'granted')
    //
    // Con `'default'` esa condicion es falsa, la fuga no llega a ejecutarse ni
    // una vez dentro del test, y el tapon pasa en verde sin haber mirado nada.
    // Medido con la mutacion del cobro en la ficha de una persona: `'default'`
    // tira 0 tests de 26 y `'granted'` tira 7.
    expect(Notification.permission).toBe('granted');
  });

  it('y es de SOLO LECTURA, para que nadie deje el canal ciego asignandolo', () => {
    // Es un getter estatico, como en la plataforma. Asignarle algo no hace
    // nada (y en modo estricto lanza): lo que no puede pasar es que una linea
    // de produccion apague el canal de los 81 specs con una asignacion.
    expect(() => {
      (Notification as unknown as { permission: string }).permission = 'denied';
    }).toThrow();

    expect(Notification.permission).toBe('granted');
  });

  it('`requestPermission()` contesta que si, y NO cuenta como usar el canal', () => {
    // No saca ningun dato de la pagina y es lo UNICO de esta familia que el
    // producto llama de verdad (`boton-de-push.tsx`). Contarla como puerta
    // pondria la forma fuerte roja con el codigo correcto.
    const { Aviso, anotados } = conLibreta();

    void Aviso.requestPermission();

    expect(anotados.length).toBe(0);
  });
});

describe('que se monta y que NO se monta, que tambien es una decision', () => {
  it('`Notification` existe y es construible', () => {
    expect(typeof Notification).toBe('function');
  });

  it('`PushManager` sigue SIN existir, a proposito', () => {
    // `elNavegadorPuede()` en `boton-de-push.tsx` pide las tres cosas. Montando
    // solo `Notification`, el boton sigue sin pintarse donde nadie lo pide
    // —que es como estaba— y el canal queda entero igualmente: para escribir
    // `new Notification(...)` no hace falta `PushManager`.
    expect('PushManager' in globalThis).toBe(false);
  });

  it('el registro del service worker trae `showNotification`, que es la OTRA puerta', async () => {
    // No se LLAMA: llamarla seria mostrar una notificacion, que por la forma
    // fuerte es el fallo. Lo que se custodia es que siga estando: sin ella, la
    // mitad del canal que usa el push vuelve a ser invisible.
    const registro = (await navigator.serviceWorker.ready) as unknown as Record<string, unknown>;

    expect(typeof registro.showNotification).toBe('function');
  });
});

describe('los campos que se auditan: el titulo y CADA clave de las opciones', () => {
  it('el titulo', () => {
    const { Aviso, anotados } = conLibreta();

    new Aviso(`Cobro de ${CENTINELA}`);

    expect(anotados.length).toBe(1);
    expect(algunCampoLoLleva(anotados[0]?.campos ?? [])).toBe(true);
    expect(dondeQuedo(anotados[0]?.campos ?? [])).toEqual(['titulo']);
  });

  it('el `body`, que es el sitio de manual', () => {
    const { Aviso, anotados } = conLibreta();

    new Aviso('Cobro registrado', { body: `Ana: 100 (efectivo). ${CENTINELA}` });

    expect(dondeQuedo(anotados[0]?.campos ?? [])).toEqual(['body']);
  });

  it('el `tag` SOLO, que no se ve en el aviso y por eso es peor', () => {
    // La forma de manual es `tag: \`cobro-${perfilId}\``: no sale en la
    // pantalla del sistema, asi que una fuga ahi no la ve ni quien mira el
    // aviso. Un tapon que mirara solo lo visible pasaria esto en verde.
    const { Aviso, anotados } = conLibreta();

    new Aviso('Cobro registrado', { tag: `cobro-${CENTINELA}` });

    expect(dondeQuedo(anotados[0]?.campos ?? [])).toEqual(['tag']);
  });

  it('el `data` ANIDADO, que es un campo libre y acepta cualquier cosa', () => {
    // Es el caso del `detail` de `performance.mark` y el del valor de un `put`
    // de IndexedDB: el dato va dentro, no en el primer nivel. Mirar solo las
    // cadenas de primer nivel dejaria pasar la forma normal de la fuga.
    const { Aviso, anotados } = conLibreta();

    new Aviso('Cobro registrado', { data: { cobro: { id: 7, clave: CENTINELA } } });

    expect(dondeQuedo(anotados[0]?.campos ?? [])).toEqual(['data']);
  });

  it('un `data` que no es JSON: `data` admite BYTES, y un `Blob` serializa a `{}`', () => {
    // `data` es un valor CLONABLE ESTRUCTURADAMENTE, no un JSON: admite un
    // `Blob` y un `ArrayBuffer`. Con un `JSON.stringify` los dos quedan en
    // `{}` y el centinela desaparece. Se desmenuzan reusando
    // `cuerpoDeUnaBaliza`, que es lo que ya hacen la baliza, el cuerpo de un
    // `fetch` y el disco privado.
    const { Aviso, anotados } = conLibreta();

    new Aviso('Cobro registrado', { data: new Blob([CENTINELA]) });

    expect(dondeQuedo(anotados[0]?.campos ?? [])).toEqual(['data']);
  });

  it('y lo mismo con un `ArrayBuffer`, que es la otra forma de los bytes', () => {
    const { Aviso, anotados } = conLibreta();

    new Aviso('Cobro registrado', { data: new TextEncoder().encode(CENTINELA) });

    expect(dondeQuedo(anotados[0]?.campos ?? [])).toEqual(['data']);
  });

  it('las TRES URLs —`icon`, `badge`, `image`—, porque una URL lleva dato', () => {
    // La leccion del septimo canal: un `icon: '/avatar.png?de=' + dato`
    // publica el secreto sin escribir una palabra en el aviso, y ademas lo
    // PIDE a la red. Las tres a la vez y en un solo aviso: si alguien deja una
    // fuera, este test nombra cual falta.
    const { Aviso, anotados } = conLibreta();

    new Aviso('Cobro registrado', {
      icon: `/avatar.png?de=${CENTINELA}`,
      badge: `/badge.png?de=${CENTINELA}`,
      image: `/grande.png?de=${CENTINELA}`,
    });

    expect(dondeQuedo(anotados[0]?.campos ?? [])).toEqual(['icon', 'badge', 'image']);
  });

  it('y un campo que la plataforma agregue mañana, sin tocar una linea', () => {
    // NO HAY LISTA BLANCA, que es la decision de este canal: se recorre
    // `Object.entries` de lo que llegue. Un campo que hoy no existe —o uno que
    // alguien invente para colar algo— entra solo.
    const { Aviso, anotados } = conLibreta();

    new Aviso('Cobro registrado', { campoQueNoExisteTodavia: CENTINELA });

    expect(dondeQuedo(anotados[0]?.campos ?? [])).toEqual(['campoQueNoExisteTodavia']);
  });

  it('el NOMBRE del campo tambien cuenta, como la clave de un almacen', () => {
    // Un `{ [claveTemporal]: 1 }` publica el dato en el propio nombre, igual
    // que un `localStorage.setItem(claveTemporal, '1')`. El tapon busca el
    // centinela en `nombre + contenido`, asi que aqui se comprueba que el
    // nombre llega entero a la libreta.
    const { Aviso, anotados } = conLibreta();

    new Aviso('Cobro registrado', { [CENTINELA]: 1 });

    const nombres = (anotados[0]?.campos ?? []).map((campo) => campo.nombre);

    expect(nombres.some((uno) => formaQueSeFue(uno, CENTINELA) !== undefined)).toBe(true);
  });
});

describe('camposDeUnAviso: la aritmetica que nadie ve desde fuera', () => {
  it('un aviso sin opciones deja solo el titulo', () => {
    expect(camposDeUnAviso('Cobro registrado', undefined).map((campo) => campo.nombre)).toEqual([
      'titulo',
    ]);
  });

  it('los campos vacios no se guardan, para no pagar un `includes` por nada', () => {
    const campos = camposDeUnAviso('Hola', { body: '', tag: '   ', data: null });

    expect(campos.map((campo) => campo.nombre)).toEqual(['titulo']);
  });

  it('un titulo vacio no inventa un campo', () => {
    expect(camposDeUnAviso('', { body: 'algo' }).map((campo) => campo.nombre)).toEqual(['body']);
  });

  it('un aviso que no lleva ningun centinela se anota IGUAL', () => {
    // Es lo que sostiene la forma fuerte: el canal cuenta la LLAMADA, no solo
    // los datos sembrados. Un aviso con la lista de clases del dia no lleva
    // centinela y publica el gimnasio entero.
    const { Aviso, anotados } = conLibreta();

    new Aviso('Clases de hoy', { body: 'CrossFit 9:00, Funcional 10:00' });

    expect(anotados.length).toBe(1);
    expect(algunCampoLoLleva(anotados[0]?.campos ?? [])).toBe(false);
  });

  it('la puerta se nombra, para que el informe diga por cual de las dos salio', () => {
    const { Aviso, anotados } = conLibreta();

    new Aviso('Cobro registrado');

    expect(anotados[0]?.puerta).toBe('new Notification');
  });
});
