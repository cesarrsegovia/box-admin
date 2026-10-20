import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RolUsuario } from '@boxadmin/shared';
import { ErrorDeApi } from '@/lib/cliente';
import type { JobEncolado } from '@/hooks/use-configuracion';
import { vigilarEstosDatos } from '@/test/espia-de-consola';
import { ProveedorDeRol } from '../rol-del-panel';
import PaginaDeConfiguracion from './page';

// ---------------------------------------------------------------------------
// Andamiaje
// ---------------------------------------------------------------------------

const { pedirEspia } = vi.hoisted(() => ({ pedirEspia: vi.fn() }));

vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'mi-gym' }),
  usePathname: () => '/mi-gym/admin/configuracion',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));

/**
 * Se dobla `pedir`, no `fetch`.
 *
 * Que `pedir` arme bien la URL ya lo fija `use-configuracion.spec`. Lo que se
 * audita aqui es un escalon mas arriba: QUE pide esta pantalla —y sobre todo
 * CUANDO, porque la respuesta correcta para un operativo es «nada»—.
 * `ErrorDeApi` se deja REAL: el fijo del fallo es un error de la API de
 * verdad, no un `Error` pelado.
 */
vi.mock('@/lib/cliente', async (original) => ({
  ...(await original<typeof import('@/lib/cliente')>()),
  pedir: pedirEspia,
}));

/** El numero de trabajo que devuelve la cola. */
const JOB_ID = 'job-7f3a9c21';

/** Lo que dice la API cuando la cola no contesta. Palabra por palabra. */
const MENSAJE_DE_LA_API = 'Redis no contesta';

/**
 * LOS DOS DATOS DE ESTA PANTALLA, REGISTRADOS COMO CENTINELAS.
 *
 * Ninguno es una credencial —las del SMTP llegan en la Tarea 5— pero los doce
 * tapones globales de `vitest.setup.ts` no miran el `<body>`: miran la
 * consola, el titulo, `window.name`, el `<head>`, los cinco almacenes, el
 * buffer de User Timing, el `src` de una imagen, las tres salidas laterales,
 * el service worker, IndexedDB y los ATRIBUTOS del `<html>` y del `<body>`.
 * Sembrar aqui lo unico que esta pantalla tiene en la mano es lo que convierte
 * esos doce ejes en una auditoria de ESTA pantalla y no en una afirmacion
 * vacia.
 *
 * EL EJE DOCE NACIO AQUI Y YA NO VIVE AQUI. Este spec tuvo un
 * `describe('lo que la pantalla NO publica fuera del cuerpo')` que afirmaba
 * que ni el `<html>` ni el `<body>` llevaban un atributo; se subio a
 * `vigilarLosCanalesDeSalida()` porque es una DIMENSION y no un caso, y desde
 * alli corre tras CADA test de CADA spec —estos incluidos— en vez de tras los
 * dos que se acordo de escribir quien lo encontro.
 */
vigilarEstosDatos({ numeroDeTrabajo: JOB_ID, loQueDijoLaApi: MENSAJE_DE_LA_API });

interface OpcionesDeMontaje {
  /** `null` se monta SIN proveedor: ver el comentario de `montar`. */
  rol?: RolUsuario | null;
  /** Lo que contesta `POST /jobs/health-check`. */
  respuesta?: JobEncolado;
  /** Si se pasa, el POST falla con esto en vez de contestar. */
  fallo?: ErrorDeApi;
}

function montar({
  rol = 'ADMIN_SALON',
  respuesta = { jobId: JOB_ID },
  fallo,
}: OpcionesDeMontaje = {}) {
  pedirEspia.mockImplementation((ruta: string) => {
    // Cualquier ruta que no sea LA del health-check es un error del codigo
    // bajo prueba, y tiene que verse como tal en vez de resolver en vacio.
    if (ruta !== '/jobs/health-check') {
      throw new Error(`La pantalla pidio una ruta que nadie espera: ${ruta}`);
    }

    return fallo === undefined ? Promise.resolve(respuesta) : Promise.reject(fallo);
  });

  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  const pantalla = <PaginaDeConfiguracion />;

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

/** Deja que la mutacion se resuelva (o se rompa) y que React pinte. */
async function esperar(): Promise<void> {
  await act(async () => {
    for (let vuelta = 0; vuelta < 5; vuelta += 1) {
      await new Promise((resolver) => setTimeout(resolver, 0));
    }
  });
}

/**
 * Los enlaces del MARCADO CRUDO, no los del arbol de accesibilidad.
 *
 * `*ByRole` consulta el arbol de accesibilidad, que YA EXCLUYE lo que lleva
 * `hidden`: un `queryByRole` en null no distingue «no esta» de «esta oculto»,
 * que es justo la distincion que esta pantalla existe para sostener. Es la
 * misma funcion que `armazon.spec.tsx`, y por el mismo motivo.
 */
function enlacesDelDocumento(): [string, string][] {
  return [...document.querySelectorAll('a')].map((a) => [
    a.textContent?.trim() ?? '',
    a.getAttribute('href') ?? '',
  ]);
}

/** Los botones del marcado CRUDO. Mismo motivo que los enlaces. */
function botonesDelDocumento(): HTMLButtonElement[] {
  return [...document.querySelectorAll('button')];
}

/** El texto del nodo marcado con ese atributo, o `null` si no esta. */
function textoDe(selector: string): string | null {
  return document.querySelector(selector)?.textContent ?? null;
}

async function pulsarElBoton(): Promise<void> {
  const usuario = userEvent.setup();
  await usuario.click(screen.getByRole('button'));
  await esperar();
}

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// La puerta de rol: es del AREA ENTERA, no de un bloque
// ---------------------------------------------------------------------------

describe('la puerta de rol del area de configuracion', () => {
  /**
   * LA PRIMERA MITAD: NO ESTA EN EL MARCADO.
   *
   * Se afirma por IGUALDAD EXACTA sobre el texto del documento y no con un
   * `not.toContain('Configuracion')`: la casualidad ortografica ya mordio tres
   * veces en las dos fases anteriores —`not.toContain('0%')` pasa en verde
   * sobre un `100%`— y una subcadena suelta es exactamente esa familia.
   *
   * Y sobre el MARCADO CRUDO: un `queryByRole` devolviendo `null` no distingue
   * «no se dibujo» de «se dibujo con `hidden`».
   */
  it('un ADMIN_OPERATIVO no tiene Configuracion en el marcado', () => {
    montar({ rol: 'ADMIN_OPERATIVO' });

    expect(document.body.textContent).toBe('');
    expect(enlacesDelDocumento()).toEqual([]);
    expect(botonesDelDocumento()).toEqual([]);
  });

  /**
   * LA SEGUNDA MITAD: NO PIDE NADA. Hacen falta las dos.
   *
   * Una pantalla que no se dibuja pero pide igual filtra lo mismo que una
   * dibujada: la respuesta viaja al navegador y queda en la cache de TanStack,
   * legible desde las herramientas del navegador.
   *
   * ⚠️ LA AFIRMACION «no se pidio nada al montar» SOLA NO PODRIA FALLAR AQUI,
   * y conviene decirlo: este indice no tiene NINGUNA consulta —sus cuatro
   * recursos viven en las pantallas de las tareas 3 a 6— asi que tampoco pide
   * nada siendo `ADMIN_SALON`. Es el tercer modo de test que no puede fallar:
   * montado en el caso ciego.
   *
   * Por eso el test tiene las dos piezas que SI distinguen: el unico control
   * que en esta pantalla puede pedir algo —el boton de la cola— no esta en el
   * marcado crudo, y ademas se PULSA todo lo que haya ahi. Una puerta que
   * escondiera con CSS dejaria el boton puesto, `fireEvent` lo alcanzaria
   * —dispara sobre lo oculto igual— y la peticion saldria.
   */
  it('y la pantalla no le pide NADA', async () => {
    montar({ rol: 'ADMIN_OPERATIVO' });

    // Se pulsa PRIMERO y se afirma despues, en este orden a proposito: con la
    // afirmacion sobre el marcado delante, el test abortaria ahi y la mitad de
    // «no pide» no llegaria a ejercitarse nunca.
    for (const boton of botonesDelDocumento()) fireEvent.click(boton);
    await esperar();

    expect(pedirEspia).not.toHaveBeenCalled();
    expect(botonesDelDocumento()).toEqual([]);
  });

  /**
   * FALLA CERRADA. Sin proveedor no hay rol, y «no hay rol» vale «no alcanza
   * para nada»: si un reordenamiento del layout dejara esta pantalla fuera del
   * armazon del panel, lo que no puede pasar es que eso ABRA las credenciales
   * del servidor de correo.
   */
  it('sin proveedor de rol tampoco se dibuja', async () => {
    montar({ rol: null });

    expect(document.body.textContent).toBe('');
    expect(botonesDelDocumento()).toEqual([]);

    await esperar();
    expect(pedirEspia).not.toHaveBeenCalled();
  });

  /**
   * LISTA BLANCA Y NO LISTA DE PRESENCIA: el conjunto ENTERO de enlaces.
   *
   * Un enlace de mas —a una pantalla que todavia no existe, o a una que exista
   * y no deba colgar de aqui— es la familia de error que ningun
   * `getByText(...)` ve. Las tres rutas estan escritas a mano y no derivadas de
   * la constante de la pagina: derivarlas moveria los dos lados a la vez.
   *
   * ⚠️ LAS TRES RUTAS TODAVIA NO TIENEN ARCHIVO —las traen las tareas 3 a 6— y
   * los enlaces se dibujan igual: `next build` no valida el destino de un
   * `<Link>`, comprobado corriendo el build.
   */
  it('un ADMIN_SALON ve las tres secciones', () => {
    montar({ rol: 'ADMIN_SALON' });

    expect(enlacesDelDocumento()).toEqual([
      ['La web publica', '/mi-gym/admin/configuracion/web'],
      ['El email', '/mi-gym/admin/configuracion/email'],
      ['El check-in por QR', '/mi-gym/admin/configuracion/checkin'],
    ]);
  });

  /**
   * `rolAlcanza` ES UNA JERARQUIA, no una lista de roles exactos.
   *
   * Sin este test, un `rol === 'ADMIN_SALON'` en la puerta pasaria los otros
   * cuatro: deja fuera al superadmin de su propio sistema y a nadie mas.
   */
  it('y un SUPERADMIN tambien, porque la puerta es una jerarquia', () => {
    montar({ rol: 'SUPERADMIN' });

    expect(enlacesDelDocumento()).toEqual([
      ['La web publica', '/mi-gym/admin/configuracion/web'],
      ['El email', '/mi-gym/admin/configuracion/email'],
      ['El check-in por QR', '/mi-gym/admin/configuracion/checkin'],
    ]);
  });
});

// ---------------------------------------------------------------------------
// El health-check
// ---------------------------------------------------------------------------

describe('el health-check, nombrado por lo que prueba', () => {
  /**
   * EL NOMBRE DEL BOTON, POR IGUALDAD EXACTA.
   *
   * No hay endpoint que lea el resultado: el unico rastro es una linea del
   * registro del servidor, que quien esta en el mostrador no ve. Lo unico que
   * encolar demuestra es que la API ALCANZA la cola —si Redis esta caido, el
   * POST falla— y el boton no puede prometer mas que eso.
   *
   * Por igualdad y no por `toContain`: «Probar que todo funciona» contiene la
   * palabra «Probar», y un `toContain('Probar')` pasaria en verde encima.
   */
  it('el boton dice que prueba que la API ALCANZA la cola', () => {
    montar();

    expect(botonesDelDocumento()).toHaveLength(1);
    expect(screen.getByRole('button').textContent).toBe('Probar que la API alcanza la cola');
  });

  /**
   * AL MONTAR NO SALE NI UNA PETICION. El indice no lee nada: la cola se toca
   * cuando alguien la toca.
   */
  it('al montar no se pide nada: la cola se encola al pulsar', async () => {
    montar();
    await esperar();

    expect(pedirEspia.mock.calls.map(([ruta]) => ruta)).toEqual([]);

    await pulsarElBoton();

    expect(pedirEspia.mock.calls.map(([ruta]) => ruta)).toEqual(['/jobs/health-check']);
  });

  /**
   * EL EXITO DICE LO QUE PROBO Y, EN LA MISMA FRASE, LO QUE NO.
   *
   * El texto esta escrito ENTERO y a mano aqui, y se afirma por IGUALDAD. Si
   * se importara la constante de la pagina, cambiarla por «Todo funciona»
   * moveria los dos lados a la vez y el test seguiria verde: es la primera de
   * las cinco formas de que un test no pueda fallar.
   */
  it('el exito aclara que NO confirma que el job se haya procesado', async () => {
    montar();
    await pulsarElBoton();

    expect(textoDe('[data-resultado="exito"]')).toBe(
      'La API alcanzo la cola: el ping quedo encolado. Esto NO confirma que el trabajo se haya ' +
        'procesado — el resultado solo queda en el registro del servidor y no hay forma de leerlo ' +
        'desde aca.',
    );
  });

  /**
   * UN FALLO NO SE PARECE A UN EXITO, y se distingue por un ATRIBUTO PROPIO.
   *
   * Las dos afirmaciones hacen falta: con la del error sola, una pantalla que
   * pintara los dos carteles a la vez pasaria en verde. Y el mensaje de la API
   * va TAL CUAL —«Redis no contesta» dice que pasa; un «hubo un problema» no—.
   */
  it('un fallo se distingue de un exito', async () => {
    montar({ fallo: new ErrorDeApi(MENSAJE_DE_LA_API, 503) });
    await pulsarElBoton();

    expect(textoDe('[data-resultado="exito"]')).toBeNull();
    expect(textoDe('[data-resultado="error"]')).toBe(
      `No se pudo encolar el ping: ${MENSAJE_DE_LA_API}`,
    );
  });

  /**
   * NO SE ENCOLA DOS VECES POR UN DOBLE CLIC.
   *
   * La cola de verdad no es idempotente: dos pulsaciones son dos trabajos. El
   * boton se bloquea mientras la peticion esta en vuelo, y se mide con una
   * promesa que NO se resuelve hasta el final del test — con una respuesta
   * inmediata, el `isPending` dura menos que el hueco entre los dos clics y el
   * test pasaria en verde con el boton desbloqueado.
   */
  it('no se encola dos veces por un doble clic', async () => {
    let contestar: (datos: JobEncolado) => void = () => undefined;
    const enVuelo = new Promise<JobEncolado>((resolver) => {
      contestar = resolver;
    });

    pedirEspia.mockImplementation(() => enVuelo);

    const cliente = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={cliente}>
        <ProveedorDeRol rol="ADMIN_SALON">
          <PaginaDeConfiguracion />
        </ProveedorDeRol>
      </QueryClientProvider>,
    );

    const usuario = userEvent.setup();
    const boton = screen.getByRole('button');

    await usuario.click(boton);
    await usuario.click(boton);

    expect(pedirEspia).toHaveBeenCalledTimes(1);
    expect(boton).toBeDisabled();

    contestar({ jobId: JOB_ID });
    await esperar();

    // Y cuando vuelve, el boton se suelta: bloquearlo para siempre seria
    // arreglar el doble clic rompiendo el segundo intento legitimo.
    expect(boton).not.toBeDisabled();
  });

  /**
   * EL `jobId` ES OPCIONAL Y PUEDE NO LLEGAR SIQUIERA.
   *
   * `JSON.stringify({ jobId: undefined })` es `{}`: la respuesta buena puede
   * venir sin la clave. No se inventa un «—» ni un «desconocido» en su lugar
   * —un hueco con forma de dato es peor que no tener el dato— y el exito se
   * dice igual, porque lo que se probo no depende de que el numero llegara.
   */
  it('el numero de trabajo no se inventa cuando la API no lo manda', async () => {
    montar({ respuesta: {} });
    await pulsarElBoton();

    expect(document.querySelector('[data-numero-de-trabajo]')).toBeNull();
    expect(textoDe('[data-resultado="exito"]')).not.toBeNull();
  });

  it('y se pinta tal cual cuando si lo manda', async () => {
    montar();
    await pulsarElBoton();

    expect(textoDe('[data-numero-de-trabajo]')).toBe(JOB_ID);
  });
});
