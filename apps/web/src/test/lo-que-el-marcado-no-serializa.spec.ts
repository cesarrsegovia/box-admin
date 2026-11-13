import { cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  escondidoEnElCuerpo,
  esconditesSinRestar,
  formaQueSeFue,
  fotoDelCuerpo,
} from './espia-de-consola';

/**
 * EL GUARDIAN DEL DECIMOQUINTO CANAL, Y POR QUE ESTE SI TIENE SPEC.
 *
 * Los otros canales no tienen spec a proposito: lo que hay que comprobar de un
 * tapon es que una mutacion lo hace caer, y eso se mide con la mutacion y no
 * con un test que repita el codigo del tapon en otro orden. Aqui la situacion
 * es la de `relojes-falsos.spec.ts`, la de `alfabeto-de-centinelas.spec.ts` y
 * la de `red-por-fuera-de-pedir.spec.ts`: LO QUE DECIDE SI ESTO SIRVE ES
 * INVISIBLE DESDE FUERA.
 *
 * Tres «simplificaciones» razonables dejan este canal CIEGO sin poner rojo ni
 * uno de los 1665 tests:
 *
 *  1. Cambiar el `typeof valor === 'string'` por una lista de etiquetas
 *     —`input`, `textarea`, `select`—, que es lo que escribe cualquiera y es
 *     una lista negra.
 *  2. Quitar la rama del `shadowRoot`, que hoy no caza nada porque no hay un
 *     solo `attachShadow` en `src/`: parece codigo muerto y no lo es.
 *  3. Mover la lectura detras del `cleanup()`, que es donde se leen DIEZ de
 *     los otros canales y donde «encaja» si uno no se fija. El `<body>` queda
 *     vacio y la barrida devuelve la lista vacia PARA SIEMPRE.
 *
 * Y una cuarta, que es la que de verdad asusta: dar por supuesto que una
 * propiedad del nodo no se serializa. Ahi abajo se mide tipo por tipo, porque
 * medirlo ya corrigio una vez la premisa de esta tarea —`type="hidden"` SI se
 * refleja— y la siguiente persona que lo dé por hecho se va a equivocar igual.
 *
 * NADA DE LO QUE HAY AQUI ES UN CENTINELA REGISTRADO: este spec no llama a
 * `vigilarEstosDatos` y las cadenas de abajo son inventadas para la medicion,
 * asi que los diecinueve tapones globales siguen mirando lo suyo mientras corre.
 * Y lo que este spec siembra en el `<body>` lo limpia el `cleanup()` del tapon
 * global, igual que en cualquier otro archivo.
 */

/** Una marca que no puede aparecer por casualidad en ningun marcado. */
const MARCA = 'VOLCADO-QUE-NO-SE-SERIALIZA-7F3';

/**
 * EL CUERPO SE VACIA A MANO, y es la unica concesion rara de este archivo.
 *
 * Los nodos de aqui se cuelgan del `<body>` sin pasar por `render`, asi que el
 * `cleanup()` del tapon global —que solo desmonta lo que Testing Library
 * monto— no se los lleva, y sin esto cada test heredaria los escondites del
 * anterior. Se hace en el `beforeEach` y no en un `afterEach` a proposito:
 * asi lo sembrado sigue puesto cuando el tapon global corre su barrida, que es
 * el camino de verdad de este canal. Nada de lo que hay aqui es un centinela
 * registrado, asi que el tapon lo mira y no dice nada.
 */
beforeEach(() => {
  document.body.innerHTML = '';
});

/** Pone un nodo en el cuerpo y devuelve lo que la barrida ve despues. */
function conEsteNodo(etiqueta: string, preparar: (nodo: HTMLElement) => void): HTMLElement {
  const nodo = document.createElement(etiqueta);
  document.body.append(nodo);
  preparar(nodo);

  return nodo;
}

/** Los contenidos de los escondites, para buscar la marca dentro. */
function loEscondido(): string[] {
  return escondidoEnElCuerpo().map((escondite) => escondite.contenido);
}

/** Los nombres de sitio, que son lo UNICO que el informe publica. */
function losSitios(): string[] {
  return escondidoEnElCuerpo().map((escondite) => escondite.sitio);
}

/**
 * Solo los sitios del `.value`, para los tests que miden ESA rama.
 *
 * Desde que la barrida mira tambien los atributos, un `<li>` con `.value = 7`
 * deja un `value="7"` —se refleja— y un `<input type="text">` deja su `type`.
 * Esos sitios son de la otra rama y no dicen nada de esta.
 */
function losSitiosDelValue(): string[] {
  return losSitios().filter((sitio) => sitio.startsWith('el .value '));
}

describe('la premisa: hay sitios del cuerpo que el marcado no publica', () => {
  /**
   * LA MEDICION QUE DEFINE EL CANAL, Y LA QUE CORRIGIO LA PREMISA.
   *
   * El `value` IDL de un control tiene DOS modos. En «modo valor» —el tipo por
   * defecto, `text`, `password`, y los demas que se teclean— asignarlo NO toca
   * el atributo. En «modo defecto» —`hidden`, `checkbox`, `radio`, los
   * botones— el `.value` es un REFLEJO del atributo y asignarlo lo escribe.
   *
   * La mutacion que motivo este canal usaba `<input type="hidden">`, que es
   * del SEGUNDO grupo: medida sobre la agenda, esa mutacion NO se escapa —el
   * test de marcado de esa pantalla la caza con el `value="…"` entero en el
   * informe—. Lo que se escapa es `type="text"` y `<textarea>`.
   *
   * Esto se mide y no se escribe en un comentario porque es la clase de cosa
   * que una version de jsdom puede cambiar, y si cambiara, este canal estaria
   * defendiendo un sitio que ya no existe mientras el de al lado se abre.
   */
  it('el .value de un control en modo VALOR no sale en el innerHTML', () => {
    for (const tipo of ['text', 'password', 'search', 'tel', 'url', 'email']) {
      const marca = `${MARCA}-${tipo}`;
      conEsteNodo('input', (nodo) => {
        (nodo as HTMLInputElement).type = tipo;
        (nodo as HTMLInputElement).value = marca;
      });

      expect(document.body.innerHTML, tipo).not.toContain(marca);
      expect(loEscondido().join(' '), tipo).toContain(marca);
    }

    const marcaDelArea = `${MARCA}-textarea`;
    conEsteNodo('textarea', (nodo) => {
      (nodo as HTMLTextAreaElement).value = marcaDelArea;
    });

    expect(document.body.innerHTML).not.toContain(marcaDelArea);
    expect(document.body.textContent ?? '').not.toContain(marcaDelArea);
    expect(loEscondido().join(' ')).toContain(marcaDelArea);
  });

  /**
   * EL CONTRAEJEMPLO, Y NO ES UN ADORNO: es lo que impide que la premisa se
   * cuente al reves otra vez.
   *
   * Si esto se pusiera rojo —si `type="hidden"` dejara de reflejar— habria que
   * revisar el reparto entero: los tests de marcado de las pantallas dejarian
   * de cazar esa mutacion y pasaria a depender de este canal.
   */
  it('el de un control en modo DEFECTO si sale, y por eso lo caza el marcado', () => {
    for (const tipo of ['hidden', 'checkbox', 'radio', 'submit', 'button']) {
      const marca = `${MARCA}-${tipo}`;
      conEsteNodo('input', (nodo) => {
        (nodo as HTMLInputElement).type = tipo;
        (nodo as HTMLInputElement).value = marca;
      });

      expect(document.body.innerHTML, tipo).toContain(marca);
    }
  });

  /**
   * `dataset` SE REFLEJA, Y POR ESO SE QUEDA FUERA DEL CANAL.
   *
   * Es la exclusion que mas facil es deshacer por buena fe —«es una propiedad
   * del nodo, no se serializa»— y la unica de la lista que se apoya en una
   * medida en vez de en un criterio. Si esto se pusiera rojo, `dataset`
   * tendria que entrar.
   */
  it('dataset se refleja al atributo, asi que el innerHTML ya lo ve', () => {
    conEsteNodo('div', (nodo) => {
      nodo.dataset.loMio = MARCA;
    });

    expect(document.body.innerHTML).toContain(MARCA);
    expect(document.body.innerHTML).toContain('data-lo-mio');
  });
});

describe('la sombra: un shadowRoot abierto no lo alcanza ninguna de las dos defensas', () => {
  it('no esta en el innerHTML, no esta en el textContent y no lo barre el querySelectorAll', () => {
    const anfitrion = conEsteNodo('div', (nodo) => {
      nodo.attachShadow({ mode: 'open' }).innerHTML = `<p>${MARCA}</p>`;
    });

    expect(document.body.innerHTML).not.toContain(MARCA);
    expect(document.body.textContent ?? '').not.toContain(MARCA);
    // La otra mitad, y es la que obliga a tratar la sombra aparte: la barrida
    // del cuerpo NO desciende. Sin la rama del `shadowRoot`, un arbol entero
    // de datos vive ahi sin que la vuelta de `querySelectorAll('*')` lo pise.
    expect([...document.body.querySelectorAll('*')]).not.toContain(
      anfitrion.shadowRoot?.querySelector('p'),
    );

    expect(loEscondido().join(' ')).toContain(MARCA);
    expect(losSitios()).toContain('el shadowRoot de un <div>');
  });

  /**
   * EL LIMITE ESCRITO: una sombra CERRADA no se puede mirar desde aqui.
   *
   * No es una decision, es la plataforma: `host.shadowRoot` vale `null`. Queda
   * medido para que nadie lea el verde de este canal como «tampoco hay nada en
   * una sombra cerrada».
   */
  it('una sombra CERRADA no es alcanzable, y eso no es cobertura', () => {
    const anfitrion = conEsteNodo('div', (nodo) => {
      nodo.attachShadow({ mode: 'closed' }).innerHTML = `<p>${MARCA}</p>`;
    });

    expect(anfitrion.shadowRoot).toBeNull();
    expect(loEscondido().join(' ')).not.toContain(MARCA);
  });
});

describe('los atributos de los descendientes del <body>', () => {
  /**
   * LA 42 DE LA FASE 12, Y OTRA VEZ LA T5 DE LA FASE 16.
   *
   * El canal doce mira los atributos SOLO del `<html>` y del `<body>`; los de
   * un `<form>`, un `<a>` o un `<div>` de dentro no los miraba nadie. La
   * barrida ya recorre cada nodo del cuerpo por su `.value`: los atributos
   * entran por el mismo bucle, y el sitio los NOMBRA para que el informe diga
   * cual fue.
   *
   * Esto mide la BARRIDA. Que el canal la cierre depende de la RESTA, que
   * para un atributo va contra el texto y no contra el marcado: eso lo mide
   * el bloque «la resta de los atributos» de mas abajo.
   */
  it('un atributo de un nodo de dentro sale en la barrida, nombrado', () => {
    conEsteNodo('div', (nodo) => {
      nodo.setAttribute('title', MARCA);
    });

    expect(loEscondido().join(' ')).toContain(MARCA);
    expect(losSitios()).toContain('el atributo title de un <div>');
  });

  /**
   * El `value` de un campo donde la persona escribio se resta, igual que su
   * `.value`: React refleja lo tecleado en un campo controlado como atributo,
   * y sin esta resta el canal seria rojo con el codigo correcto en las mismas
   * dos pantallas que obligaron a escribir `TECLEADO_POR_LA_PERSONA`.
   */
  it('el atributo value de un campo donde se tecleo no es un escondite', () => {
    const campo = conEsteNodo('input', (nodo) => {
      nodo.setAttribute('value', MARCA);
    });

    campo.dispatchEvent(new Event('input', { bubbles: true }));

    expect(loEscondido().join(' ')).not.toContain(MARCA);
    expect(losSitios()).not.toContain('el atributo value de un <input>');
  });

  /**
   * Y SOLO el `value`: el resto de los atributos del MISMO campo tecleado se
   * siguen mirando. Restar el nodo entero dejaria pasar un `title={dato}` en
   * cualquier campo donde alguien haya escrito una letra.
   */
  it('los otros atributos de un campo donde se tecleo siguen en la barrida', () => {
    const campo = conEsteNodo('input', (nodo) => {
      nodo.setAttribute('title', MARCA);
    });

    campo.dispatchEvent(new Event('input', { bubbles: true }));

    expect(losSitios()).toContain('el atributo title de un <input>');
  });
});

/**
 * Los sitios donde el `afterEach` del tapon veria `valor` ESCONDIDO: la barrida,
 * la resta y la busqueda, en el mismo orden que el tapon y con la foto del
 * cuerpo tomada en el mismo instante.
 */
function dondeSeEsconde(valor: string): string[] {
  return esconditesSinRestar(valor, escondidoEnElCuerpo(), fotoDelCuerpo())
    .filter((escondite) => formaQueSeFue(escondite.contenido, valor) !== undefined)
    .map((escondite) => escondite.sitio);
}

describe('la resta de los atributos: contra el TEXTO, no contra el marcado', () => {
  /**
   * LA 42, CERRADA DE PUNTA A PUNTA.
   *
   * Un atributo SIEMPRE sale en el `innerHTML`, asi que restarlo contra el
   * marcado lo descontaba siempre: la mutacion `title={tenantId}` paso 29 de
   * 29 con la barrida puesta. Un atributo se resta contra lo que la persona
   * LEE —el `textContent`—, y entonces un `title` con un dato es una fuga
   * aunque el `innerHTML` lo lleve.
   */
  it('un title con un dato es una fuga aunque este en el marcado', () => {
    conEsteNodo('form', (nodo) => {
      nodo.setAttribute('title', MARCA);
    });

    expect(document.body.innerHTML).toContain(MARCA);
    expect(dondeSeEsconde(MARCA)).toEqual(['el atributo title de un <form>']);
  });

  it('y deja de serlo si el mismo dato esta escrito en la pantalla', () => {
    conEsteNodo('p', (nodo) => {
      nodo.setAttribute('title', MARCA);
      nodo.textContent = MARCA;
    });

    expect(dondeSeEsconde(MARCA)).toEqual([]);
  });

  /**
   * LAS DOS EXCEPCIONES CON NOMBRE, y son dos HUECOS CONOCIDOS: un secreto en
   * la query de un enlace, o en un `data-x`, pasa. Ver el docblock de
   * `ATRIBUTOS_QUE_SE_RESTAN_CONTRA_EL_MARCADO`.
   */
  it('un href con un dato no es una fuga: los enlaces llevan ids a proposito', () => {
    conEsteNodo('a', (nodo) => {
      nodo.setAttribute('href', `/admin/usuarios/${MARCA}`);
    });

    expect(dondeSeEsconde(MARCA)).toEqual([]);
  });

  it('un data-* con un dato tampoco: los specs los usan de selector', () => {
    conEsteNodo('span', (nodo) => {
      nodo.setAttribute('data-foo', MARCA);
    });

    expect(dondeSeEsconde(MARCA)).toEqual([]);
  });

  it('ni el value de un campo donde la persona tecleo', () => {
    const campo = conEsteNodo('input', (nodo) => {
      nodo.setAttribute('value', MARCA);
    });

    campo.dispatchEvent(new Event('input', { bubbles: true }));

    expect(dondeSeEsconde(MARCA)).toEqual([]);
  });

  /**
   * El `.value` sigue con SU resta, contra el marcado: una pantalla de
   * edicion pinta `<input value={nombre}>` a proposito.
   */
  it('el .value que el marcado tambien publica sigue sin ser una fuga', () => {
    render(createElement('input', { type: 'text', defaultValue: MARCA }));

    expect(dondeSeEsconde(MARCA)).toEqual([]);
  });
});

describe('lo que la barrida deja fuera, y no por descuido', () => {
  /**
   * Un `.value` NUMERICO no puede llevar un nombre dentro.
   *
   * Si esto se pusiera rojo, querria decir que la barrida empezo a recoger
   * numeros: ruido con forma de rigor, y un `includes` mas por cada barra de
   * progreso del panel.
   */
  it('el .value numerico de un <progress>, un <meter> o un <li> no entra', () => {
    for (const etiqueta of ['progress', 'meter', 'li']) {
      conEsteNodo(etiqueta, (nodo) => {
        (nodo as unknown as { value: number }).value = 7;
      });
    }

    expect(losSitiosDelValue()).toEqual([]);
  });

  it('un .value vacio no es un escondite', () => {
    conEsteNodo('input', (nodo) => {
      (nodo as HTMLInputElement).type = 'text';
    });

    expect(losSitiosDelValue()).toEqual([]);
  });

  /**
   * LO QUE LA PERSONA TECLEO NO ES UN ESCONDITE.
   *
   * Es la segunda mitad de la definicion y la que salio de medir: sin ella, el
   * canal se pone rojo con el codigo correcto en `configuracion/email` —la
   * clave del SMTP vive en el `.value` de su campo porque alguien la escribio—
   * y en `usuarios/[id]`. Se distingue por el EVENTO, que una pantalla que
   * escribe a escondidas en un `useEffect` no despacha.
   */
  it('un campo donde se despacho un evento de escritura queda fuera', () => {
    const campo = conEsteNodo('input', (nodo) => {
      (nodo as HTMLInputElement).type = 'text';
      (nodo as HTMLInputElement).value = MARCA;
    });

    expect(loEscondido().join(' ')).toContain(MARCA);

    campo.dispatchEvent(new Event('input', { bubbles: true }));

    expect(loEscondido().join(' ')).not.toContain(MARCA);
  });
});

describe('donde encaja en el afterEach', () => {
  /**
   * LA MEDIDA QUE DECIDE EL SITIO DE LA LECTURA.
   *
   * Diez de los otros canales se leen DESPUES del `cleanup()`, porque lo suyo
   * sobrevive al desmontaje y asi cazan ademas lo que escriba la limpieza de
   * un `useEffect`. Este NO puede: vive dentro del `<body>`, que es justo lo
   * que `cleanup()` vacia. Leerlo detras seria leer siempre la lista vacia
   * —verde y ciego—, que es el modo de fallo contra el que esta escrito el
   * archivo entero.
   */
  it('cleanup() vacia el <body>, asi que la barrida va ANTES', () => {
    render(createElement('input', { type: 'text', defaultValue: MARCA }));

    const campo = document.body.querySelector('input');
    if (campo !== null) campo.value = `${MARCA}-escrito-a-mano`;

    expect(loEscondido().join(' ')).toContain(MARCA);

    cleanup();

    expect(document.body.children).toHaveLength(0);
    expect(escondidoEnElCuerpo()).toEqual([]);
  });
});

describe('el informe no publica el volcado', () => {
  /**
   * LA REGLA DE TODO EL ARCHIVO, MEDIDA EN ESTE CANAL.
   *
   * El contenido de un escondite ES el dato que se escapo. El nombre del sitio
   * es vocabulario fijo —la etiqueta y el `type`— y es lo unico que llega al
   * registro de CI. La copia local de este test que descubrio el agujero usaba
   * `not.toContain(centinela)`, que imprime el `'[{"perfilId":"…'` entero.
   */
  it('el nombre del sitio no lleva ni un caracter de lo que esconde', () => {
    conEsteNodo('input', (nodo) => {
      (nodo as HTMLInputElement).type = 'password';
      (nodo as HTMLInputElement).value = MARCA;
    });

    expect(losSitios()).toEqual([
      'el .value de un <input type="password">',
      'el atributo type de un <input type="password">',
    ]);
  });
});
