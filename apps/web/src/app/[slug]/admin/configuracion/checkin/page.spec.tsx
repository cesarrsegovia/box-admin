import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigCheckIn, RolUsuario } from '@boxadmin/shared';
import { ErrorDeApi } from '@/lib/cliente';
import { vigilarEstosDatos } from '@/test/espia-de-consola';
import { ProveedorDeRol } from '../../rol-del-panel';
import PaginaDeCheckIn from './page';

// ---------------------------------------------------------------------------
// Andamiaje
// ---------------------------------------------------------------------------

const { pedirEspia } = vi.hoisted(() => ({ pedirEspia: vi.fn() }));

vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'mi-gym' }),
  usePathname: () => '/mi-gym/admin/configuracion/checkin',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));

/**
 * Se dobla `pedir`, no `fetch`.
 *
 * Que `pedir` arme bien la URL ya lo fija `use-configuracion.spec`. Lo que se
 * audita aqui es un escalon mas arriba: QUE pide esta pantalla, CUANDO, y
 * sobre todo QUE NO pide por ahi —la imagen del QR no puede salir por este
 * camino—. `ErrorDeApi` se deja REAL: el fijo del fallo es un error de la API
 * de verdad y no un `Error` pelado.
 */
vi.mock('@/lib/cliente', async (original) => ({
  ...(await original<typeof import('@/lib/cliente')>()),
  pedir: pedirEspia,
}));

/** La ruta de lectura de la ventana. Escrita a mano: es el contrato. */
const RUTA_DE_LA_VENTANA = '/config/checkin-qr';

/**
 * LA RUTA DE LA IMAGEN, ESCRITA A MANO Y NO IMPORTADA.
 *
 * La pantalla importa `RUTA_DE_LA_IMAGEN_DEL_QR` de `use-configuracion`.
 * Importarla aqui tambien compararia la constante contra si misma: cambiarla
 * por `/api/bx/loquesea` moveria los dos lados a la vez y el test seguiria en
 * verde. Es la primera de las cinco formas de que un test no pueda fallar.
 */
const RUTA_DE_LA_IMAGEN = '/api/bx/config/checkin-qr/imagen';

/** Lo que dice la API cuando la lectura o el guardado fallan. Palabra por palabra. */
const MENSAJE_DE_LA_API = 'La base de datos del gimnasio no contesta';

/**
 * EL UNICO CENTINELA POSIBLE DE ESTA PANTALLA, Y POR QUE ES UNO SOLO.
 *
 * Los doce tapones globales de `vitest.setup.ts` buscan los datos VIGILADOS
 * dentro de la consola, el titulo, `window.name`, el `<head>`, los cinco
 * almacenes, el buffer de User Timing, el `src` de una imagen, las tres
 * salidas laterales, el service worker, IndexedDB y los atributos del `<html>`
 * y del `<body>`. Sembrar lo que esta pantalla tiene en la mano es lo que
 * convierte esos doce ejes en una auditoria de ESTA pantalla.
 *
 * Y lo que tiene en la mano son DOS ENTEROS Y UN MENSAJE DE ERROR. Los dos
 * enteros NO SE PUEDEN SEMBRAR: un centinela `'15'` o `'0'` es una subcadena
 * de casi cualquier cosa —de una clase de Tailwind, de una fecha, de la propia
 * ruta de la imagen si algun dia lleva un tamaño— y daria falsos positivos en
 * los doce ejes a la vez. Es la casualidad ortografica otra vez, del lado del
 * tapon. El mensaje de la API si es una cadena distintiva, y es ademas el dato
 * que de verdad no deberia acabar en la consola ni en el titulo.
 */
vigilarEstosDatos({ loQueDijoLaApi: MENSAJE_DE_LA_API });

interface OpcionesDeMontaje {
  /** `null` se monta SIN proveedor: ver el comentario de `montar`. */
  rol?: RolUsuario | null;
  /** Lo que contesta `GET /config/checkin-qr`. */
  ventana?: ConfigCheckIn;
  /** Si se pasa, la LECTURA falla con esto en vez de contestar. */
  falloAlLeer?: ErrorDeApi;
  /** Si se pasa, el `PUT` falla con esto en vez de contestar. */
  falloAlGuardar?: ErrorDeApi;
}

function montar({
  rol = 'ADMIN_SALON',
  ventana = { minutosAntes: 15, minutosDespues: 15 },
  falloAlLeer,
  falloAlGuardar,
}: OpcionesDeMontaje = {}) {
  pedirEspia.mockImplementation(
    (ruta: string, opciones?: { metodo?: string; cuerpo?: unknown }) => {
      // Cualquier ruta que no sea LA de la ventana es un error del codigo bajo
      // prueba —la imagen del QR incluida— y tiene que verse como tal en vez de
      // resolver en vacio.
      if (ruta !== RUTA_DE_LA_VENTANA) {
        throw new Error(`La pantalla pidio por \`pedir\` una ruta que nadie espera: ${ruta}`);
      }

      if (opciones?.metodo === 'PUT') {
        return falloAlGuardar === undefined
          ? Promise.resolve(opciones.cuerpo)
          : Promise.reject(falloAlGuardar);
      }

      return falloAlLeer === undefined ? Promise.resolve(ventana) : Promise.reject(falloAlLeer);
    },
  );

  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  const pantalla = <PaginaDeCheckIn />;

  render(
    <QueryClientProvider client={cliente}>
      {/* Sin rol se monta SIN proveedor: envolverla con un `rol={null}` no
          compila y, peor, probaria otra cosa —un contexto puesto en nulo— y no
          el caso que importa, que es la pantalla fuera del armazon del panel. */}
      {rol === null ? pantalla : <ProveedorDeRol rol={rol}>{pantalla}</ProveedorDeRol>}
    </QueryClientProvider>,
  );

  return cliente;
}

/** Deja que la consulta y la mutacion se resuelvan y que React pinte. */
async function esperar(): Promise<void> {
  await act(async () => {
    for (let vuelta = 0; vuelta < 5; vuelta += 1) {
      await new Promise((resolver) => setTimeout(resolver, 0));
    }
  });
}

/** Monta y espera a que la primera lectura haya llegado. */
async function montarYEsperar(opciones: OpcionesDeMontaje = {}) {
  const cliente = montar(opciones);
  await esperar();
  return cliente;
}

/** Las rutas que pasaron por `pedir`, en orden. */
function rutasPedidas(): string[] {
  return pedirEspia.mock.calls.map(([ruta]) => ruta as string);
}

/** Lo que `pedir` recibio en la llamada numero `indice`. */
function llamada(indice: number): { ruta: string; metodo: string | undefined; cuerpo: unknown } {
  const argumentos = pedirEspia.mock.calls[indice] as
    [string, { metodo?: string; cuerpo?: unknown } | undefined] | undefined;
  if (argumentos === undefined) throw new Error(`No hubo llamada numero ${indice}`);

  const [ruta, opciones] = argumentos;
  return { ruta, metodo: opciones?.metodo, cuerpo: opciones?.cuerpo };
}

/**
 * Las imagenes del MARCADO CRUDO con su `src` tal como se escribio.
 *
 * `getAttribute` y no la propiedad `.src`: jsdom resuelve la propiedad a una
 * URL absoluta (`http://localhost:3000/api/bx/…`), asi que comparar contra la
 * ruta del contrato fallaria por el origen y empujaria a usar un `toContain`
 * —que es justo lo que no se quiere—.
 *
 * Y del marcado crudo y no por `*ByRole`: el arbol de accesibilidad excluye lo
 * que lleva `hidden` y una imagen con `alt=""` es `presentation`, asi que un
 * `queryByRole('img')` en null no distingue «no esta» de «esta y no se ve».
 */
function imagenesDelDocumento(): [string, string][] {
  return [...document.querySelectorAll('img')].map((img) => [
    img.getAttribute('src') ?? '',
    img.getAttribute('alt') ?? '',
  ]);
}

/** El texto del nodo marcado con ese selector, con los espacios normalizados. */
function textoDe(selector: string): string | null {
  const nodo = document.querySelector(selector);
  if (nodo === null) return null;

  // El colapso de espacios es por el FORMATO del JSX —los saltos de linea del
  // archivo acaban en el texto—, no una rebaja de la afirmacion: lo que se
  // compara sigue siendo el contenido entero y por igualdad.
  return (nodo.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** El valor que tiene escrito un campo del formulario, como cadena. */
function valorDelCampo(id: string): string | null {
  const campo = document.querySelector<HTMLInputElement>(`#${id}`);
  return campo === null ? null : campo.value;
}

const botonesDelDocumento = () => [...document.querySelectorAll('button')];

beforeEach(() => {
  pedirEspia.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Lo que la pantalla DICE y lo que NO puede afirmar
// ---------------------------------------------------------------------------

describe('la ventana que rige hoy', () => {
  /**
   * LA FRASE ENTERA, POR IGUALDAD, Y LOS DOS NUMEROS EN NODOS PROPIOS.
   *
   * Escrita a mano y no importada de la pagina: importar la constante la
   * compararia contra si misma. Y por igualdad y no por `toContain('30')`,
   * que pasa en verde sobre un `300`.
   */
  it('dice que ventana rige hoy', async () => {
    await montarYEsperar({ ventana: { minutosAntes: 30, minutosDespues: 5 } });

    expect(textoDe('[data-ventana-rige]')).toBe(
      'Hoy se puede marcar presente desde 30 minutos antes del inicio del turno y hasta 5 ' +
        'minutos despues.',
    );
    expect(textoDe('[data-minutos="antes"]')).toBe('30');
    expect(textoDe('[data-minutos="despues"]')).toBe('5');
  });

  /**
   * LO QUE LA RESPUESTA NO SOSTIENE: CUAL DE LOS DOS CASOS ES.
   *
   * `ConfigCheckInService.ver()` devuelve `CONFIG_CHECKIN_POR_DEFECTO`
   * —quince y quince— cuando no hay fila, SIN NINGUNA MARCA. Comprobado
   * leyendo el service: el `findFirst` da `null` y el `ver()` sustituye la
   * constante. Desde el cliente, «nadie toco nada» y «alguien eligio quince y
   * quince» son la MISMA respuesta.
   *
   * ⚠️ COMO SE AFIRMA QUE ALGO NO SE DICE, SIN BUSCAR SUBCADENAS.
   *
   * Un `not.toContain('sin configurar')` tiene dos agujeros: pasa en verde
   * sobre «Sin Configurar» o «no configurado», y no cubre las otras veinte
   * formas de decirlo. Asi que no se busca NINGUNA palabra: se monta la
   * pantalla DOS VECES —con los quince y quince por defecto, y con una ventana
   * que nadie confundiria con el default— y se afirma que el documento entero
   * es EL MISMO salvo los digitos.
   *
   * Eso mata cualquier cartel, nota, asterisco o parentesis que aparezca solo
   * en uno de los dos casos, lo diga como lo diga y este donde este. Y el
   * escenario donde la distincion existe es justamente el par de montajes: con
   * un solo montaje el test no podria fallar.
   */
  it('NO afirma si esta configurado o si son los valores por defecto', async () => {
    const sinDigitos = (texto: string) => texto.replace(/\s+/g, ' ').replace(/\d+/g, '#').trim();

    await montarYEsperar({ ventana: { minutosAntes: 15, minutosDespues: 15 } });
    const conElDefecto = sinDigitos(document.body.textContent ?? '');

    cleanupEntreMontajes();

    await montarYEsperar({ ventana: { minutosAntes: 7, minutosDespues: 42 } });
    const conUnaVentanaPropia = sinDigitos(document.body.textContent ?? '');

    // La premisa del test: los dos montajes dibujaron algo. Sin esto, una
    // pantalla que no pintara nada pasaria en verde comparando '' contra ''.
    expect(conElDefecto).not.toBe('');
    expect(conElDefecto).toBe(conUnaVentanaPropia);
  });

  /**
   * CERO ES UN VALOR Y NO UN HUECO, EN LOS TRES SITIOS DONDE SE PUEDE PERDER.
   *
   * `Min(0)` en `GuardarConfigQrDto` y su comentario: cero significa «solo a
   * partir de la hora exacta del inicio». Un `minutosAntes || 15` lo pintaria
   * como quince, un `value={campos.antes || ''}` lo dejaria en blanco y un
   * `if (!minutos)` lo mandaria como ausente.
   *
   * El escenario donde la distincion existe: la ventana trae UN cero y un no
   * cero, asi que un test que confundiera cero con vacio no podria apoyarse en
   * que «los dos estan igual».
   */
  it('cero minutos es un valor, no un hueco', async () => {
    await montarYEsperar({ ventana: { minutosAntes: 0, minutosDespues: 20 } });

    // 1. En la frase: un `0`, no un hueco ni un quince.
    expect(textoDe('[data-minutos="antes"]')).toBe('0');
    expect(textoDe('[data-ventana-rige]')).toBe(
      'Hoy se puede marcar presente desde 0 minutos antes del inicio del turno y hasta 20 ' +
        'minutos despues.',
    );

    // 2. En el campo: el input dice '0' y no ''.
    expect(valorDelCampo('minutos-antes')).toBe('0');
    expect(valorDelCampo('minutos-despues')).toBe('20');

    // 3. Y al guardar, el cero VIAJA.
    await pulsarGuardar();

    expect(llamada(1).cuerpo).toEqual({ minutosAntes: 0, minutosDespues: 20 });
  });
});

// ---------------------------------------------------------------------------
// El QR
// ---------------------------------------------------------------------------

describe('el cartel del QR', () => {
  /**
   * LA IMAGEN VA COMO `src`, Y NADIE LA PIDE ADEMAS POR `pedir`.
   *
   * `GET /config/checkin-qr/imagen` responde `image/png`: `pedir` hace
   * `JSON.parse` de lo que llega y reventaria con un `SyntaxError` que no
   * dice nada de lo que pasa.
   *
   * ⚠️ LAS DOS AFIRMACIONES HACEN FALTA Y NINGUNA SOBRA. Que haya un `<img>`
   * no prueba que nadie lo haya pedido ADEMAS por `pedir` —las dos cosas
   * conviven sin romperse, y la peticion de mas seria invisible en pantalla—.
   * Y la lista de peticiones sola no prueba que la imagen se dibuje.
   *
   * La lista se afirma por IGUALDAD y no con un `not.toContain('imagen')`:
   * una ruta de mas de CUALQUIER otra forma tambien tiene que caerse.
   */
  it('el QR se pide como imagen, no por `pedir`', async () => {
    await montarYEsperar();

    expect(imagenesDelDocumento()).toEqual([
      [
        RUTA_DE_LA_IMAGEN,
        'El codigo QR de check-in del gimnasio, para imprimir y pegar en la pared.',
      ],
    ]);

    expect(rutasPedidas()).toEqual([RUTA_DE_LA_VENTANA]);
  });

  /**
   * GUARDAR LA VENTANA NO VUELVE A PEDIR EL PNG.
   *
   * El cartel lleva la firma del gimnasio y no los minutos: el que esta pegado
   * en la pared sigue sirviendo. El `src` es una ruta FIJA —sin `?t=`— asi que
   * el atributo es identico antes y despues, que es lo que el navegador mira
   * para decidir si vuelve a pedir la imagen.
   */
  it('y guardar no cambia el `src`, porque el cartel no cambia', async () => {
    await montarYEsperar({ ventana: { minutosAntes: 15, minutosDespues: 15 } });
    const antesDeGuardar = imagenesDelDocumento();

    await escribirEnElCampo('minutos-antes', '45');
    await pulsarGuardar();

    expect(imagenesDelDocumento()).toEqual(antesDeGuardar);
    expect(textoDe('[data-resultado="exito"]')).toBe(
      'Ventana guardada. El cartel del QR no cambia: lleva la firma del gimnasio y no los ' +
        'minutos, asi que el que ya esta pegado en la pared sigue sirviendo.',
    );
  });
});

// ---------------------------------------------------------------------------
// Guardar
// ---------------------------------------------------------------------------

describe('guardar la ventana', () => {
  /**
   * LOS DOS CAMPOS VIAJAN SIEMPRE, Y NADA MAS QUE LOS DOS.
   *
   * `GuardarConfigQrDto` declara los dos como obligatorios y la API corre con
   * `forbidNonWhitelisted`: mandar uno solo es un 400, y mandar uno de mas
   * tambien. Por eso el cuerpo se afirma con `toEqual` sobre el objeto ENTERO
   * y no campo a campo.
   */
  it('guardar manda los dos campos', async () => {
    await montarYEsperar({ ventana: { minutosAntes: 15, minutosDespues: 15 } });

    // Se toca UNO SOLO a proposito: el que no se toca es el que un guardado
    // «solo lo que cambio» se dejaria fuera.
    await escribirEnElCampo('minutos-antes', '45');
    await pulsarGuardar();

    expect(llamada(1)).toEqual({
      ruta: RUTA_DE_LA_VENTANA,
      metodo: 'PUT',
      cuerpo: { minutosAntes: 45, minutosDespues: 15 },
    });
  });

  /**
   * UN CAMPO VACIO NO ES UN CERO, y no sale de la pantalla.
   *
   * `Number('')` es CERO: sin el corte del vacio, borrar el campo y guardar
   * mandaria «solo a la hora exacta» sin que nadie lo eligiera. Es el mismo
   * error que el del test de arriba, mirado desde el otro lado.
   */
  it('un campo vacio no se manda como cero', async () => {
    await montarYEsperar({ ventana: { minutosAntes: 15, minutosDespues: 15 } });

    await escribirEnElCampo('minutos-antes', '');
    await pulsarGuardar();

    // No salio ninguna escritura: la unica llamada sigue siendo la lectura.
    expect(rutasPedidas()).toEqual([RUTA_DE_LA_VENTANA]);
    expect(llamada(0).metodo).toBeUndefined();
    expect(textoDe('#minutos-antes-error')).toBe('Poné un numero entero de minutos.');
  });

  /**
   * UN FALLO AL GUARDAR NO SE PARECE A UN EXITO, y se distingue por un
   * ATRIBUTO PROPIO y no por el color. Las dos afirmaciones hacen falta: con
   * la del error sola, una pantalla que pintara los dos carteles a la vez
   * pasaria en verde.
   */
  it('un fallo al guardar dice el motivo de la API, tal cual', async () => {
    await montarYEsperar({ falloAlGuardar: new ErrorDeApi(MENSAJE_DE_LA_API, 503) });

    await escribirEnElCampo('minutos-antes', '45');
    await pulsarGuardar();

    expect(textoDe('[data-resultado="exito"]')).toBeNull();
    expect(textoDe('[data-resultado="error"]')).toBe(
      `No se pudo guardar la ventana: ${MENSAJE_DE_LA_API}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Cuando la lectura falla
// ---------------------------------------------------------------------------

describe('cuando no se puede leer la ventana', () => {
  /**
   * UN FALLO AL LEER NO SE DIBUJA COMO UNA CONFIGURACION EN CERO.
   *
   * Dos ceros son una ventana VALIDA —«solo a la hora exacta»— asi que un
   * fallo pintado como ceros no se ve como un fallo: se ve como un gimnasio
   * configurado asi. Es el 404-dibujado-como-dato-vacio de la Fase 10, pero
   * con una forma plausible.
   *
   * El escenario donde la distincion existe esta en el test de abajo: una
   * ventana de ceros DE VERDAD si se dibuja, y se dibuja distinto de esto. Sin
   * ese par, «no hay frase de ventana» podria cumplirse pintando nada nunca.
   */
  it('un fallo al leer no se parece a una configuracion en cero', async () => {
    await montarYEsperar({ falloAlLeer: new ErrorDeApi(MENSAJE_DE_LA_API, 503) });

    expect(textoDe('[data-fallo="lectura"]')).toBe(
      `No se pudo leer la ventana del check-in: ${MENSAJE_DE_LA_API}`,
    );

    // Ni frase de ventana, ni numeros, ni campos que rellenar: no hay nada que
    // se pueda leer como «mi gimnasio tiene la ventana en cero».
    expect(textoDe('[data-ventana-rige]')).toBeNull();
    expect(textoDe('[data-minutos="antes"]')).toBeNull();
    expect(textoDe('[data-minutos="despues"]')).toBeNull();
    expect(valorDelCampo('minutos-antes')).toBeNull();
    expect(valorDelCampo('minutos-despues')).toBeNull();
    expect(botonesDelDocumento()).toEqual([]);
  });

  /** La otra mitad del par: una ventana en cero DE VERDAD si se dibuja. */
  it('y una ventana en cero de verdad si se dibuja', async () => {
    await montarYEsperar({ ventana: { minutosAntes: 0, minutosDespues: 0 } });

    expect(textoDe('[data-fallo="lectura"]')).toBeNull();
    expect(textoDe('[data-minutos="antes"]')).toBe('0');
    expect(textoDe('[data-minutos="despues"]')).toBe('0');
    expect(valorDelCampo('minutos-antes')).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// La puerta de rol
// ---------------------------------------------------------------------------

describe('la puerta de rol', () => {
  /**
   * PARA UN OPERATIVO NO HAY MARCADO, NO HAY PETICION Y —LO QUE AQUI ES
   * NUEVO— NO HAY `<img>`.
   *
   * El `src` de una imagen es una peticion de red que no pasa por `fetch` ni
   * por `pedir`: una puerta que escondiera con CSS dejaria el `<img>` puesto y
   * el navegador pediria el PNG igual. Por eso las tres afirmaciones, y sobre
   * el marcado CRUDO —un `queryByRole` en null no distingue «no esta» de
   * «esta oculto»—.
   */
  it('un ADMIN_OPERATIVO no tiene nada en el marcado, ni la imagen', async () => {
    montar({ rol: 'ADMIN_OPERATIVO' });

    // Se pulsa PRIMERO y se afirma despues: con la afirmacion del marcado
    // delante, el test abortaria ahi y la mitad de «no pide» no se ejercitaria.
    for (const boton of botonesDelDocumento()) fireEvent.click(boton);
    await esperar();

    expect(document.body.textContent).toBe('');
    expect(imagenesDelDocumento()).toEqual([]);
    expect(pedirEspia).not.toHaveBeenCalled();
  });

  /** FALLA CERRADA: sin proveedor no hay rol, y eso no alcanza para nada. */
  it('sin proveedor de rol tampoco se dibuja', async () => {
    montar({ rol: null });
    await esperar();

    expect(document.body.textContent).toBe('');
    expect(imagenesDelDocumento()).toEqual([]);
    expect(pedirEspia).not.toHaveBeenCalled();
  });

  /**
   * `rolAlcanza` ES UNA JERARQUIA: un `rol === 'ADMIN_SALON'` dejaria al
   * superadmin fuera de su propio sistema y pasaria todos los demas tests.
   */
  it('un SUPERADMIN entra, porque la puerta es una jerarquia', async () => {
    await montarYEsperar({ rol: 'SUPERADMIN' });

    expect(rutasPedidas()).toEqual([RUTA_DE_LA_VENTANA]);
    expect(imagenesDelDocumento()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// El eje decimotercero: la URL del documento
// ---------------------------------------------------------------------------

/**
 * LO QUE NO ESTA NI EN EL `<body>` NI EN NINGUNO DE LOS DOCE TAPONES: LA URL.
 *
 * Los doce canales globales miran la consola, el titulo, `window.name`, el
 * `<head>`, los cinco almacenes, el buffer de User Timing, el `src` de una
 * imagen, las tres salidas laterales, CacheStorage, el service worker,
 * IndexedDB y los atributos del `<html>` y del `<body>`. Los tests de pantalla
 * miran DENTRO del `<body>` y la lista de peticiones.
 *
 * `history.replaceState(null, '', '?…')` no cae en ninguno de los dos lados.
 * Y no esta ciego por el entorno —jsdom lo implementa ENTERO, igual que los
 * atributos del `<html>`—: esta ciego porque nadie lo habia nombrado. Es el
 * hueco ENTRE dos defensas.
 *
 * Como canal de fuga es de los peores que tiene un navegador: la URL va en la
 * barra de direcciones de la maquina del mostrador, entra en el historial, se
 * copia y se pega entera, se guarda en los registros de cualquier servidor al
 * que se navegue despues y viaja como `Referer` a TERCEROS. Y nada de eso
 * deja rastro en la pestaña de red ni en el marcado.
 *
 * Sobrevive a `cleanup()` —que desmonta el `<body>` y no toca `location`— asi
 * que, como los atributos del `<html>`, lo que una pantalla escriba ahi
 * sobrevive a su propio test.
 *
 * ESTO DEBERIA SER EL EJE TRECE DE `vigilarLosCanalesDeSalida()`, por los tres
 * motivos del docblock de ese archivo: es una DIMENSION y no un caso. Vive
 * aqui porque los archivos compartidos no son de esta tarea.
 */
describe('lo que la pantalla NO escribe en la URL', () => {
  const URL_AL_EMPEZAR = window.location.href;

  it('la URL del documento queda como estaba', async () => {
    await montarYEsperar({ ventana: { minutosAntes: 0, minutosDespues: 20 } });

    await escribirEnElCampo('minutos-antes', '45');
    await pulsarGuardar();

    expect(window.location.href).toBe(URL_AL_EMPEZAR);
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('');
  });

  it('ni siquiera cuando la lectura falla', async () => {
    await montarYEsperar({ falloAlLeer: new ErrorDeApi(MENSAJE_DE_LA_API, 503) });

    expect(window.location.href).toBe(URL_AL_EMPEZAR);
    expect(window.location.search).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Utilidades que usan `screen` y hay que declarar despues del andamiaje
// ---------------------------------------------------------------------------

/**
 * Desmonta lo montado para poder montar otra vez DENTRO del mismo test.
 *
 * El `cleanup()` global corre entre tests, no entre montajes: sin esto, el
 * segundo `render` del test del default dejaria los dos documentos juntos.
 */
function cleanupEntreMontajes(): void {
  cleanup();
  pedirEspia.mockReset();
}

/** Escribe un valor en un campo, reemplazando lo que hubiera. */
async function escribirEnElCampo(id: string, valor: string): Promise<void> {
  const campo = document.querySelector<HTMLInputElement>(`#${id}`);
  if (campo === null) throw new Error(`No hay ningun campo con id ${id}`);

  const usuario = userEvent.setup();
  await usuario.clear(campo);
  if (valor !== '') await usuario.type(campo, valor);
  await esperar();
}

async function pulsarGuardar(): Promise<void> {
  const usuario = userEvent.setup();
  await usuario.click(screen.getByRole('button', { name: 'Guardar la ventana' }));
  await esperar();
}
