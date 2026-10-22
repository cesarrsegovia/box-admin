import { afterEach, describe, expect, it, vi } from 'vitest';
import { pedir } from '@/lib/cliente';
import { SECRETOS_DEL_PANEL, vinoDePedir } from './espia-de-consola';

/**
 * EL GUARDIAN DEL DECIMOCUARTO CANAL, Y POR QUE ESTE SI TIENE SPEC.
 *
 * Los demas canales no tienen spec a proposito: lo que hay que comprobar de
 * un tapon es que una mutacion lo hace caer, y eso se mide con la mutacion y no
 * con un test que repita el codigo del tapon en otro orden. Aqui la situacion
 * es la de `relojes-falsos.spec.ts`, la de `alfabeto-de-centinelas.spec.ts` y
 * la de `lo-que-el-marcado-no-serializa.spec.ts`: ESTO NO SE VE DESDE FUERA.
 *
 * El canal entero cuelga de UNA pregunta —«¿esta llamada salio de dentro de
 * `pedir`?»—, que se contesta leyendo la pila. Si `vinoDePedir` empezara a
 * decir que si siempre —porque alguien movio `cliente.ts`, porque alguien
 * «simplifico» la normalizacion de barras, porque alguien cambio el literal—,
 * LOS 1645 TESTS SEGUIRIAN EN VERDE y el canal se quedaria ciego para todas las
 * fugas a la vez. Y si empezara a decir que no siempre, el paquete se pondria
 * rojo en cinco specs y alguien lo arreglaria apagandolo.
 *
 * Las dos averias son invisibles desde cualquier spec de pantalla, asi que la
 * unica forma de custodiarlas es medirlas. Este archivo mide las dos.
 *
 * NO REGISTRA NINGUN CENTINELA PROPIO —no llama a `vigilarEstosDatos`— y el
 * unico dato que mueve es `claveDelAlta`, que es un secreto del panel y por
 * tanto esta vigilado en los 74 specs. Eso es a proposito: el control de abajo
 * no vale nada si el dato que manda no es uno de los que el tapon persigue.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// La pregunta del canal: de donde salio la llamada
// ---------------------------------------------------------------------------

describe('de donde salio la llamada', () => {
  /**
   * LAS DOS FORMAS DE LA MISMA PILA, Y HACEN FALTA LAS DOS.
   *
   * No es una rebuscadura: es el error que tuvo la primera medida de este
   * canal. La sonda buscaba `/src/lib/cliente.ts` con las barras al derecho y
   * en Windows la pila dice `D:\…\src\lib\cliente.ts`, asi que el resultado fue
   * «ninguna de las 467 peticiones del paquete paso por `pedir`» — o sea el
   * canal entero rojo, que por lo menos se ve. Con el signo cambiado —una
   * normalizacion que tape de mas— el canal se quedaria verde y ciego, que es
   * peor. Las dos formas se fijan aqui para que ninguna de las dos averias
   * dependa de en que maquina corra el paquete.
   */
  it('reconoce a `pedir` con las barras de Windows y con las de CI', () => {
    const deWindows =
      'Error\n    at pedir (D:\\Dev\\box-admin\\apps\\web\\src\\lib\\cliente.ts:56:23)';
    const deCi = 'Error\n    at pedir (/home/runner/box-admin/apps/web/src/lib/cliente.ts:56:23)';

    expect([vinoDePedir(deWindows), vinoDePedir(deCi)]).toEqual([true, true]);
  });

  /**
   * EL CASO QUE DECIDE: una peticion escrita en cualquier otro archivo.
   *
   * Es la mutacion que motivo el canal, con su pila de verdad. Si esto diera
   * `true`, el tapon dejaria pasar TODAS las fugas y nada se pondria rojo.
   */
  it('y NO reconoce una peticion escrita en una pantalla', () => {
    const deUnaPantalla =
      'Error\n    at CuentaDeLaClase (D:\\Dev\\box-admin\\apps\\web\\src\\app\\[slug]\\(profesor)\\mis-clases\\page.tsx:210:9)';

    expect(vinoDePedir(deUnaPantalla)).toBe(false);
  });

  /**
   * NO ALCANZA CON QUE EL NOMBRE `cliente` APAREZCA EN ALGUN SITIO.
   *
   * El literal es la RUTA del archivo, no una palabra. Un hook que se llamara
   * `use-cliente.ts`, o un componente en `componentes/cliente.tsx`, no son
   * `pedir` y no pueden heredar su permiso.
   */
  it('y tampoco a un archivo que solo se parece en el nombre', () => {
    const parecido =
      'Error\n    at algo (/home/runner/box-admin/apps/web/src/hooks/use-cliente.ts:12:3)';

    expect(vinoDePedir(parecido)).toBe(false);
  });

  /**
   * LA PILA DE VERDAD, QUE ES LA UNICA QUE NO SE PUEDE INVENTAR.
   *
   * Las tres de arriba son cadenas escritas a mano: fijan la aritmetica, pero
   * no fijan la PREMISA, que es que `pedir` llame a `fetch` de forma sincrona
   * desde su propio cuerpo y por tanto aparezca en la pila. Esa premisa es del
   * runtime y de `lib/cliente.ts`, no de este archivo: si alguien envolviera el
   * `fetch` de `pedir` en un `setTimeout` o lo mandara a un helper de otro
   * modulo, el marco desapareceria de la pila y el canal pasaria a acusar a
   * `pedir` de hablar por fuera de `pedir`.
   *
   * Aqui se mide con `pedir` de verdad y con la pila de verdad.
   */
  it('y una llamada de `pedir` de verdad SI trae su marco en la pila', async () => {
    const pilas: string[] = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        pilas.push(new Error().stack ?? '');
        return Promise.resolve(new Response('{}', { status: 200 }));
      }),
    );

    await pedir('/lo-que-sea');

    expect(pilas.map(vinoDePedir)).toEqual([true]);
  });
});

// ---------------------------------------------------------------------------
// El control que importa
// ---------------------------------------------------------------------------

describe('el control del canal', () => {
  /**
   * UNA PETICION LEGITIMA POR `pedir`, CON UN CENTINELA DENTRO, NO CAE.
   *
   * Es el control, y es el unico test de este archivo cuya afirmacion no esta
   * escrita aqui: la hace el `afterEach` del espia, que corre despues y que
   * tiene que quedarse callado.
   *
   * El cuerpo lleva `claveDelAlta`, que es uno de los tres secretos del panel y
   * por tanto esta vigilado en los 74 specs. O sea que si el canal se afirmara
   * sobre TODAS las peticiones —o si `vinoDePedir` dejara de reconocer a
   * `pedir`—, este test caeria con «una peticion de red por fuera de `pedir`
   * lleva claveDelAlta», que es exactamente la forma de ser rojo con el codigo
   * correcto que este canal tiene que evitar en los 23 specs donde el `pedir`
   * de produccion corre de verdad.
   *
   * Y el destino es `/api/bx/...`, que es lo que `pedir` arma: el control cubre
   * tambien que el tapon no se quede mirando el origen.
   */
  it('una peticion legitima por `pedir` con un secreto en el cuerpo no hace caer nada', async () => {
    const red = vi.fn((_destino: unknown, _opciones?: unknown) =>
      Promise.resolve(new Response('{}', { status: 200 })),
    );
    vi.stubGlobal('fetch', red);

    await pedir('/usuarios', {
      metodo: 'POST',
      cuerpo: { clave: SECRETOS_DEL_PANEL.claveDelAlta },
    });

    // Lo que se fija aqui es que la peticion SALIO —si no saliera, el silencio
    // del espia no probaria nada— y que salio por donde tenia que salir.
    expect(red).toHaveBeenCalledTimes(1);
    expect(String(red.mock.calls[0]?.[0])).toBe('/api/bx/usuarios');
  });
});
