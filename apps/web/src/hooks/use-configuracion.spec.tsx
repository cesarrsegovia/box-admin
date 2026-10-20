import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import { vigilarEstosDatos } from '@/test/espia-de-consola';
import { vigilarUnaConsultaAjena } from '@/test/consulta-ajena';
import {
  cacheDeConsultas,
  dobleDe204,
  dobleDeFetch,
  dobleQueFalla,
  llamada,
  montar,
} from '@/test/andamiaje-de-hooks';
import {
  RUTA_DE_LA_IMAGEN_DEL_QR,
  clavesDeConfig,
  useBorrarPregunta,
  useBorrarTestimonio,
  useConfigCheckIn,
  useConfigSmtp,
  useConfigWebSalon,
  useCrearPregunta,
  useCrearTestimonio,
  useEncolarHealthCheck,
  useGuardarCheckIn,
  useGuardarPlantilla,
  useGuardarSmtp,
  useGuardarWebSalon,
  usePlantillas,
} from './use-configuracion';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * LO MAS SENSIBLE QUE MANEJA EL SISTEMA, SEMBRADO PARA QUE SE VEA SI SE ESCAPA.
 *
 * La clave del servidor de correo es una credencial de verdad: no es un
 * secreto del panel que caduca —como la contraseña temporal de un alta—, es la
 * que manda correo con el nombre del gimnasio hasta que alguien la cambie. Y
 * no va sola: el `host` y el `usuario` son las otras dos terceras partes de la
 * misma credencial, y los dos SI vuelven en `ConfiguracionSmtpPublica`, asi que
 * viven en la cache de consultas con toda legitimidad y lo unico que hay que
 * vigilar es que no salgan por otra puerta.
 *
 * Registrados aqui, los diez tapones globales de `vitest.setup.ts` los buscan
 * en los diez canales que no son el `<body>` —consola, titulo, nombre de la
 * pestaña, `<head>`, los tres almacenes, el buffer de User Timing, el `src` de
 * una imagen, las salidas laterales, CacheStorage y el service worker— en
 * TODOS los tests de este archivo, sin que ninguno tenga que acordarse.
 */
const CENTINELAS = {
  hostSmtp: 'smtp.centinela-del-gimnasio.test',
  usuarioSmtp: 'casillero@centinela-del-gimnasio.test',
  claveSmtp: 'Clave-SMTP-Centinela-42',
};

vigilarEstosDatos(CENTINELAS);

// ---------------------------------------------------------------------------
// Los datos de ida y de vuelta
// ---------------------------------------------------------------------------

/** Lo que devuelve `GET /config/web-salon`, con marcadores para rastrearlo. */
const WEB_SALON = {
  activa: true,
  colorPrimario: '#101010',
  colorSecundario: '#202020',
  tituloPrincipal: 'Gimnasio-Centinela',
  tagline: null,
  sobreElSalon: null,
  imagenPrincipalUrl: null,
  whatsapp: null,
  instagram: null,
  linkExtra: null,
  mostrarPrecios: true,
  mostrarTestimonios: true,
  mostrarFAQ: true,
  mostrarTurnosLibres: false,
  planDestacadoId: null,
  testimonios: [{ id: 't1', nombre: 'Ana-Centinela', texto: 'Muy bien', orden: 0 }],
  preguntas: [{ id: 'f1', pregunta: '¿Horarios?', respuesta: 'De 8 a 22', orden: 0 }],
};

/**
 * Lo que devuelve el SMTP: SIN la clave, que es como contesta la API.
 *
 * `ConfiguracionSmtpPublica` no la lleva ni enmascarada —solo `tieneClave`—, y
 * la respuesta se siembra asi a proposito: lo que se mide es que nada en el
 * camino la reinvente a partir de lo que se mando.
 */
const SMTP_PUBLICO = {
  host: CENTINELAS.hostSmtp,
  puerto: 587,
  seguro: false,
  usuario: CENTINELAS.usuarioSmtp,
  emailOrigen: 'hola@centinela-del-gimnasio.test',
  emailDestino: null,
  tieneClave: true,
  actualizadoEn: '2026-10-19T10:00:00.000Z',
};

/** Lo que manda el formulario del SMTP. La clave viaja AQUI y en ningun otro sitio. */
const SMTP_A_GUARDAR = {
  host: CENTINELAS.hostSmtp,
  puerto: 587,
  seguro: false,
  usuario: CENTINELAS.usuarioSmtp,
  clave: CENTINELAS.claveSmtp,
  emailOrigen: 'hola@centinela-del-gimnasio.test',
};

const PLANTILLA = {
  tipo: 'CONFIRMACION' as const,
  asunto: 'Tu reserva quedo confirmada',
  cuerpoHtml: '<p>Hola {{nombre}}</p>',
};

const CHECKIN = { minutosAntes: 15, minutosDespues: 15 };

const TESTIMONIO = { id: 't9', nombre: 'Ana-Centinela', texto: 'Muy bien', orden: 3 };
const PREGUNTA = { id: 'f9', pregunta: '¿Hay duchas?', respuesta: 'Si', orden: 3 };

// ---------------------------------------------------------------------------
// Las cuatro claves
// ---------------------------------------------------------------------------

/** React Query empareja por PREFIJO de array: esto es lo que hay que descartar. */
function esPrefijoDe(corta: readonly unknown[], larga: readonly unknown[]): boolean {
  return corta.every((parte, i) => JSON.stringify(parte) === JSON.stringify(larga[i]));
}

describe('cada recurso tiene su propia clave', () => {
  const CLAVES: [string, readonly unknown[]][] = [
    ['webSalon', clavesDeConfig.webSalon()],
    ['smtp', clavesDeConfig.smtp()],
    ['plantillas', clavesDeConfig.plantillas()],
    ['checkin', clavesDeConfig.checkin()],
  ];

  it('las cuatro son distintas entre si', () => {
    const textos = CLAVES.map(([, clave]) => JSON.stringify(clave));
    expect(new Set(textos).size, 'dos recursos comparten clave: se pisan en la cache').toBe(4);
  });

  it('ninguna es PREFIJO de otra', () => {
    // Un `['config']` compartido, o un `['config','smtp']` del que colgaran las
    // plantillas, haria que invalidar uno arrastrara al otro sin que ningun
    // test de ruta, de metodo ni de cuerpo lo notara.
    for (const [nombreA, a] of CLAVES) {
      for (const [nombreB, b] of CLAVES) {
        if (nombreA === nombreB) continue;
        expect(
          esPrefijoDe(a, b),
          `la clave de ${nombreA} es prefijo de la de ${nombreB}: invalidar una alcanza a la otra`,
        ).toBe(false);
      }
    }
  });

  it('las cuatro lecturas ocupan CUATRO entradas de cache, no menos', () => {
    // El instrumento de verdad: dos recursos bajo la misma clave no dan un
    // error, dan UNA entrada —y el segundo en montarse lee los datos del
    // primero—. Contar las entradas es lo unico que distingue las dos cosas.
    dobleDeFetch({});

    const { cliente } = montar(() => ({
      web: useConfigWebSalon(),
      smtp: useConfigSmtp(),
      plantillas: usePlantillas(),
      checkin: useConfigCheckIn(),
    }));

    expect(cacheDeConsultas(cliente).entradas).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Cada recurso pide SU ruta, con SU metodo
// ---------------------------------------------------------------------------

describe('cada recurso pide SU ruta, con SU metodo: las lecturas', () => {
  // Las cuatro rutas salen de los `@Controller(...)`, leidas una por una. En
  // la Fase 10 una ruta deducida del nombre del modulo era falsa y el 404 se
  // veia en pantalla como un dato vacio.
  const LECTURAS: [string, () => unknown, string][] = [
    ['la web del salon', useConfigWebSalon, '/api/bx/config/web-salon'],
    ['el SMTP', useConfigSmtp, '/api/bx/config/smtp'],
    ['las plantillas', usePlantillas, '/api/bx/config/plantillas'],
    ['la ventana del check-in', useConfigCheckIn, '/api/bx/config/checkin-qr'],
  ];

  for (const [nombre, hook, ruta] of LECTURAS) {
    it(`${nombre} pide ${ruta} con GET, UNA vez`, async () => {
      const doble = dobleDeFetch({});

      const { result } = montar(() => hook() as { isSuccess: boolean });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(llamada(doble).url).toBe(ruta);
      expect(llamada(doble).metodo).toBe('GET');
      expect(doble, 'la lectura salio mas de una vez').toHaveBeenCalledTimes(1);
    });
  }
});

describe('cada recurso pide SU ruta, con SU metodo: las escrituras', () => {
  it('guardar la web va con PUT a /config/web-salon y manda lo que le dieron', async () => {
    const doble = dobleDeFetch(WEB_SALON);

    const { result } = montar(() => useGuardarWebSalon());
    result.current.mutate({ activa: true, colorPrimario: '#101010' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble)).toEqual({
      url: '/api/bx/config/web-salon',
      metodo: 'PUT',
      cuerpo: { activa: true, colorPrimario: '#101010' },
    });
    expect(doble).toHaveBeenCalledTimes(1);
  });

  it('crear un testimonio va con POST a /config/web-salon/testimonios', async () => {
    const doble = dobleDeFetch(TESTIMONIO);

    const { result } = montar(() => useCrearTestimonio());
    result.current.mutate({ nombre: 'Ana-Centinela', texto: 'Muy bien' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble)).toEqual({
      url: '/api/bx/config/web-salon/testimonios',
      metodo: 'POST',
      cuerpo: { nombre: 'Ana-Centinela', texto: 'Muy bien' },
    });
    expect(doble).toHaveBeenCalledTimes(1);
  });

  it('crear una pregunta va con POST a /config/web-salon/faq', async () => {
    // `faq` y no `preguntas`: el controller lo escribe asi aunque el service y
    // el contrato las llamen `preguntas`. Deducirlo del nombre del tipo seria
    // un 404.
    const doble = dobleDeFetch(PREGUNTA);

    const { result } = montar(() => useCrearPregunta());
    result.current.mutate({ pregunta: '¿Hay duchas?', respuesta: 'Si' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble)).toEqual({
      url: '/api/bx/config/web-salon/faq',
      metodo: 'POST',
      cuerpo: { pregunta: '¿Hay duchas?', respuesta: 'Si' },
    });
    expect(doble).toHaveBeenCalledTimes(1);
  });

  it('guardar el SMTP va con PUT a /config/smtp', async () => {
    const doble = dobleDeFetch(SMTP_PUBLICO);

    const { result } = montar(() => useGuardarSmtp());
    result.current.mutate(SMTP_A_GUARDAR);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble).url).toBe('/api/bx/config/smtp');
    expect(llamada(doble).metodo).toBe('PUT');
    expect(doble).toHaveBeenCalledTimes(1);
  });

  it('guardar la ventana del check-in va con PUT a /config/checkin-qr', async () => {
    const doble = dobleDeFetch(CHECKIN);

    const { result } = montar(() => useGuardarCheckIn());
    result.current.mutate(CHECKIN);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble)).toEqual({
      url: '/api/bx/config/checkin-qr',
      metodo: 'PUT',
      cuerpo: CHECKIN,
    });
    expect(doble).toHaveBeenCalledTimes(1);
  });

  it('el health-check va con POST a /jobs/health-check y SIN cuerpo', async () => {
    // `/jobs/health-check`, no `/config/...`: sale de `@Controller('jobs')` y
    // es el unico endpoint de la fase que no cuelga de `config`.
    const doble = dobleDeFetch({ jobId: '42' });

    const { result } = montar(() => useEncolarHealthCheck());
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble).url).toBe('/api/bx/jobs/health-check');
    expect(llamada(doble).metodo).toBe('POST');
    expect(llamada(doble).cuerpo).toBeUndefined();
    expect(doble).toHaveBeenCalledTimes(1);
  });

  it('el jobId puede no venir, y eso no rompe la mutacion', async () => {
    // El controller declara `{ jobId: string | undefined }`, y
    // `JSON.stringify({ jobId: undefined })` es `{}`: la clave puede no llegar
    // siquiera. Quien lo pinte tiene que contemplar que no este.
    dobleDeFetch({});

    const { result } = montar(() => useEncolarHealthCheck());
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.jobId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Los dos borrados: 204 y sin cuerpo
// ---------------------------------------------------------------------------

describe('borrar un testimonio no manda cuerpo', () => {
  it('va con DELETE al testimonio, sin cuerpo', async () => {
    const doble = dobleDe204();

    const { result } = montar(() => useBorrarTestimonio());
    result.current.mutate('t9');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble).url).toBe('/api/bx/config/web-salon/testimonios/t9');
    expect(llamada(doble).metodo).toBe('DELETE');
    expect(
      llamada(doble).cuerpo,
      'el DELETE salio con cuerpo: el controller no declara DTO y no hay nada que mandar',
    ).toBeUndefined();
    expect(doble).toHaveBeenCalledTimes(1);
  });

  it('un 204 sin cuerpo no rompe la mutacion', async () => {
    // Los dos borrados de esta fase llevan `@HttpCode(204)` y `Promise<void>`.
    // Si el hook esperara la fila de vuelta, el admin veria un error despues
    // de un borrado que SI ocurrio.
    dobleDe204();

    const { result } = montar(() => useBorrarTestimonio());
    result.current.mutate('t9');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toBeNull();
  });
});

describe('borrar una pregunta no manda cuerpo', () => {
  it('va con DELETE a la pregunta, sin cuerpo', async () => {
    const doble = dobleDe204();

    const { result } = montar(() => useBorrarPregunta());
    result.current.mutate('f9');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble).url).toBe('/api/bx/config/web-salon/faq/f9');
    expect(llamada(doble).metodo).toBe('DELETE');
    expect(llamada(doble).cuerpo).toBeUndefined();
    expect(doble).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// El tipo de plantilla
// ---------------------------------------------------------------------------

describe('el tipo de plantilla viaja en la URL, no en el cuerpo', () => {
  it('la URL lleva el tipo y el cuerpo lleva EXACTAMENTE asunto y cuerpoHtml', async () => {
    // `GuardarPlantillaDto` solo declara `asunto` y `cuerpoHtml`, y la API
    // corre con `forbidNonWhitelisted`: un `tipo` de mas en el cuerpo
    // convierte un guardado valido en un 400 que el admin lee como «no se
    // pudo guardar» sin mas.
    const doble = dobleDeFetch(PLANTILLA);

    const { result } = montar(() => useGuardarPlantilla());
    result.current.mutate(PLANTILLA);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble)).toEqual({
      url: '/api/bx/config/plantillas/CONFIRMACION',
      metodo: 'PUT',
      cuerpo: { asunto: PLANTILLA.asunto, cuerpoHtml: PLANTILLA.cuerpoHtml },
    });
    expect(doble).toHaveBeenCalledTimes(1);
  });

  it('otro tipo va a OTRA URL, y el cuerpo sigue sin llevarlo', async () => {
    // Con un solo tipo probado, un hook que mandara siempre el mismo literal
    // en la URL pasaria igual.
    const doble = dobleDeFetch({ ...PLANTILLA, tipo: 'VENCIMIENTO_PACK' });

    const { result } = montar(() => useGuardarPlantilla());
    result.current.mutate({ ...PLANTILLA, tipo: 'VENCIMIENTO_PACK' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble).url).toBe('/api/bx/config/plantillas/VENCIMIENTO_PACK');
    expect(llamada(doble).cuerpo).not.toHaveProperty('tipo');
  });
});

// ---------------------------------------------------------------------------
// LA CREDENCIAL: entra en el cuerpo y no vuelve
// ---------------------------------------------------------------------------

describe('la clave SMTP viaja en el cuerpo y NO vuelve en la respuesta', () => {
  it('el cuerpo del PUT la lleva: es el unico sitio por el que pasa', async () => {
    const doble = dobleDeFetch(SMTP_PUBLICO);

    const { result } = montar(() => useGuardarSmtp());
    result.current.mutate(SMTP_A_GUARDAR);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const cuerpo = llamada(doble).cuerpo as Record<string, unknown>;
    expect(cuerpo.clave, 'la clave no llego al servidor: no se podria mandar un correo').toBe(
      CENTINELAS.claveSmtp,
    );
  });

  it('nada la reinventa en la respuesta', async () => {
    // La respuesta se siembra SIN clave, que es como contesta la API. La
    // tentacion del formulario —«ya que la tengo, la dejo puesta para no
    // tener que reescribirla»— seria reinventar en el cliente el unico dato
    // que el servidor se cuida de no devolver.
    const doble = dobleDeFetch(SMTP_PUBLICO);

    const { result } = montar(() => useGuardarSmtp());
    result.current.mutate(SMTP_A_GUARDAR);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(SMTP_PUBLICO);
    expect(JSON.stringify(result.current.data)).not.toContain(CENTINELAS.claveSmtp);
    expect(doble).toHaveBeenCalledTimes(1);
  });

  it('la lectura del SMTP tampoco la trae', async () => {
    dobleDeFetch(SMTP_PUBLICO);

    const { result, cliente } = montar(() => useConfigSmtp());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // El host y el usuario SI estan ahi con toda legitimidad: son parte de
    // `ConfiguracionSmtpPublica`. Lo que no puede estar es la clave.
    expect(cacheDeConsultas(cliente).texto).toContain(CENTINELAS.hostSmtp);
    expect(cacheDeConsultas(cliente).texto).not.toContain(CENTINELAS.claveSmtp);
    expect(result.current.data?.tieneClave).toBe(true);
  });

  it('tras desmontar, la clave no queda en la cache de MUTACIONES', async () => {
    // Esto es lo que compra el `gcTime: 0` y lo que el barrido estatico de
    // `mutaciones-sin-gctime.spec.ts` no puede comprobar: por defecto TanStack
    // conserva las `variables` CINCO MINUTOS despues del desmontaje, en un
    // `QueryClient` que dura lo que dura la pestaña del mostrador.
    dobleDeFetch(SMTP_PUBLICO);

    const { result, cliente, unmount } = montar(() => useGuardarSmtp());
    result.current.mutate(SMTP_A_GUARDAR);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    unmount();

    await waitFor(() => expect(cliente.getMutationCache().getAll()).toHaveLength(0));
    expect(JSON.stringify(cliente.getMutationCache().getAll())).not.toContain(CENTINELAS.claveSmtp);
  });

  it('la escritura no siembra la cache de CONSULTAS', async () => {
    // `gcTime: 0` tapa la cache de MUTACIONES. La de CONSULTAS la comparte
    // toda la aplicacion y se lee desde el devtools con una linea: un
    // `setQueryData` «por comodidad» dejaria ahi la credencial entera.
    dobleDeFetch(SMTP_PUBLICO);

    const { result, cliente } = montar(() => useGuardarSmtp());
    result.current.mutate(SMTP_A_GUARDAR);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const cache = cacheDeConsultas(cliente);
    expect(cache.texto).not.toContain(CENTINELAS.claveSmtp);
    expect(cache.entradas).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// LA INVALIDACION ES DIRIGIDA, POR RECURSO
// ---------------------------------------------------------------------------

/** Siembra las cuatro consultas para poder mirar cual se movio y cual no. */
function sembrarLosCuatroRecursos(cliente: QueryClient): void {
  cliente.setQueryData(clavesDeConfig.webSalon(), WEB_SALON);
  cliente.setQueryData(clavesDeConfig.smtp(), SMTP_PUBLICO);
  cliente.setQueryData(clavesDeConfig.plantillas(), [PLANTILLA]);
  cliente.setQueryData(clavesDeConfig.checkin(), CHECKIN);
}

/** Que recursos quedaron marcados rancios, por nombre. */
function invalidados(cliente: QueryClient): string[] {
  const nombres: [string, readonly unknown[]][] = [
    ['webSalon', clavesDeConfig.webSalon()],
    ['smtp', clavesDeConfig.smtp()],
    ['plantillas', clavesDeConfig.plantillas()],
    ['checkin', clavesDeConfig.checkin()],
  ];

  return nombres
    .filter(([, clave]) => cliente.getQueryCache().find({ queryKey: clave })?.state.isInvalidated)
    .map(([nombre]) => nombre);
}

describe('guardar el SMTP no invalida las plantillas', () => {
  it('solo queda rancio el SMTP', async () => {
    // Los dos salen del MISMO `@Controller('config')`, que es justo lo que
    // hace facil ensanchar el alcance sin notarlo: un `['config']` a secas
    // empareja por prefijo y se lleva los cuatro recursos por delante.
    dobleDeFetch(SMTP_PUBLICO);

    const { result, cliente } = montar(() => useGuardarSmtp());
    sembrarLosCuatroRecursos(cliente);

    result.current.mutate(SMTP_A_GUARDAR);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidados(cliente)).toEqual(['smtp']);
  });

  it('y la llamada va con la clave del SMTP y nada mas', async () => {
    dobleDeFetch(SMTP_PUBLICO);

    const { result, cliente } = montar(() => useGuardarSmtp());
    const espia = vi.spyOn(cliente, 'invalidateQueries');

    result.current.mutate(SMTP_A_GUARDAR);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(espia).toHaveBeenCalledWith({ queryKey: clavesDeConfig.smtp() });
    // `toHaveBeenCalledWith` nunca pregunta con que MAS se llamo.
    expect(espia, 'se invalido algo mas ademas del SMTP').toHaveBeenCalledTimes(1);
  });
});

describe('guardar una plantilla invalida SOLO las plantillas', () => {
  it('los otros tres recursos no se mueven', async () => {
    dobleDeFetch(PLANTILLA);

    const { result, cliente } = montar(() => useGuardarPlantilla());
    sembrarLosCuatroRecursos(cliente);

    result.current.mutate(PLANTILLA);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidados(cliente)).toEqual(['plantillas']);
  });
});

describe('cada escritura invalida SU recurso y ninguno mas', () => {
  const CASOS: [
    string,
    () => { mutate: (v: never) => void; isSuccess: boolean },
    unknown,
    string,
  ][] = [
    ['guardar la web', useGuardarWebSalon, { activa: true }, 'webSalon'],
    ['crear un testimonio', useCrearTestimonio, { nombre: 'a', texto: 'b' }, 'webSalon'],
    ['crear una pregunta', useCrearPregunta, { pregunta: 'a', respuesta: 'b' }, 'webSalon'],
    ['guardar el check-in', useGuardarCheckIn, CHECKIN, 'checkin'],
  ];

  for (const [nombre, hook, variables, recurso] of CASOS) {
    it(`${nombre} deja rancio solo ${recurso}`, async () => {
      dobleDeFetch({});

      const { result, cliente } = montar(hook);
      sembrarLosCuatroRecursos(cliente);

      result.current.mutate(variables as never);
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(invalidados(cliente)).toEqual([recurso]);
    });
  }

  it('borrar un testimonio deja rancia la web, que es quien lo lleva dentro', async () => {
    // `ConfiguracionWebSalon` lleva `testimonios` DENTRO: no hay un
    // `GET /config/web-salon/testimonios` al que apuntar, asi que la unica
    // consulta que cambia es la de la web.
    dobleDe204();

    const { result, cliente } = montar(() => useBorrarTestimonio());
    sembrarLosCuatroRecursos(cliente);

    result.current.mutate('t9');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidados(cliente)).toEqual(['webSalon']);
  });

  it('borrar una pregunta deja rancia la web y nada mas', async () => {
    dobleDe204();

    const { result, cliente } = montar(() => useBorrarPregunta());
    sembrarLosCuatroRecursos(cliente);

    result.current.mutate('f9');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidados(cliente)).toEqual(['webSalon']);
  });

  it('el health-check no invalida NADA: no es un recurso', async () => {
    // No tiene GET, no tiene clave y no cambia ninguna configuracion. Una
    // invalidacion «por las dudas» seria un refetch del panel entero cada vez
    // que alguien toca el boton de diagnostico.
    dobleDeFetch({ jobId: '42' });

    const { result, cliente } = montar(() => useEncolarHealthCheck());
    sembrarLosCuatroRecursos(cliente);
    const espia = vi.spyOn(cliente, 'invalidateQueries');

    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidados(cliente)).toEqual([]);
    expect(espia).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// EL ALCANCE: el centinela de la consulta ajena
// ---------------------------------------------------------------------------

describe('ninguna escritura refresca una consulta ajena', () => {
  // Con un unico consumidor del `QueryClient`, una invalidacion dirigida y una
  // global son INDISTINGUIBLES. Ver `src/test/consulta-ajena.ts`: asi se
  // escapo una en la Fase 9.

  it('guardar el SMTP', async () => {
    dobleDeFetch(SMTP_PUBLICO);

    const { result, cliente } = montar(() => useGuardarSmtp());
    const sinTocarLoAjeno = vigilarUnaConsultaAjena(cliente);

    result.current.mutate(SMTP_A_GUARDAR);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await sinTocarLoAjeno();
  });

  it('guardar una plantilla', async () => {
    dobleDeFetch(PLANTILLA);

    const { result, cliente } = montar(() => useGuardarPlantilla());
    const sinTocarLoAjeno = vigilarUnaConsultaAjena(cliente);

    result.current.mutate(PLANTILLA);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await sinTocarLoAjeno();
  });

  it('guardar la web', async () => {
    dobleDeFetch(WEB_SALON);

    const { result, cliente } = montar(() => useGuardarWebSalon());
    const sinTocarLoAjeno = vigilarUnaConsultaAjena(cliente);

    result.current.mutate({ activa: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await sinTocarLoAjeno();
  });

  it('crear un testimonio', async () => {
    dobleDeFetch(TESTIMONIO);

    const { result, cliente } = montar(() => useCrearTestimonio());
    const sinTocarLoAjeno = vigilarUnaConsultaAjena(cliente);

    result.current.mutate({ nombre: 'Ana-Centinela', texto: 'Muy bien' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await sinTocarLoAjeno();
  });

  it('borrar un testimonio', async () => {
    dobleDe204();

    const { result, cliente } = montar(() => useBorrarTestimonio());
    const sinTocarLoAjeno = vigilarUnaConsultaAjena(cliente);

    result.current.mutate('t9');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await sinTocarLoAjeno();
  });

  it('crear una pregunta', async () => {
    dobleDeFetch(PREGUNTA);

    const { result, cliente } = montar(() => useCrearPregunta());
    const sinTocarLoAjeno = vigilarUnaConsultaAjena(cliente);

    result.current.mutate({ pregunta: '¿Hay duchas?', respuesta: 'Si' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await sinTocarLoAjeno();
  });

  it('borrar una pregunta', async () => {
    dobleDe204();

    const { result, cliente } = montar(() => useBorrarPregunta());
    const sinTocarLoAjeno = vigilarUnaConsultaAjena(cliente);

    result.current.mutate('f9');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await sinTocarLoAjeno();
  });

  it('guardar el check-in', async () => {
    dobleDeFetch(CHECKIN);

    const { result, cliente } = montar(() => useGuardarCheckIn());
    const sinTocarLoAjeno = vigilarUnaConsultaAjena(cliente);

    result.current.mutate(CHECKIN);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await sinTocarLoAjeno();
  });

  it('el health-check', async () => {
    dobleDeFetch({ jobId: '42' });

    const { result, cliente } = montar(() => useEncolarHealthCheck());
    const sinTocarLoAjeno = vigilarUnaConsultaAjena(cliente);

    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await sinTocarLoAjeno();
  });
});

// ---------------------------------------------------------------------------
// EL CAMINO DE ERROR: el unico sitio donde se ve un reintento
// ---------------------------------------------------------------------------

/**
 * `retry` SOLO ACTUA AL FALLAR, y por eso ninguno de los conteos de arriba lo
 * ve: todos corren sobre un 200, y sobre un 200 no hay reintento que contar.
 *
 * Y se espera a que el error este PINTADO antes de contar. Contar en cuanto la
 * promesa de `mutate` se asienta daria 1 aunque hubiera tres: el segundo y el
 * tercer intento llegan despues, con el retardo exponencial de TanStack en
 * medio.
 *
 * Duplicar aqui no es cosmetico: un `POST /config/web-salon/testimonios`
 * repetido deja el mismo testimonio tres veces en la landing publica, y un
 * `POST /jobs/health-check` repetido encola tres jobs.
 */
describe('una escritura que falla sale UNA sola vez', () => {
  const ESCRITURAS: [string, () => { mutate: (v: never) => void; isError: boolean }, unknown][] = [
    ['guardar la web', useGuardarWebSalon, { activa: true }],
    ['crear un testimonio', useCrearTestimonio, { nombre: 'a', texto: 'b' }],
    ['borrar un testimonio', useBorrarTestimonio, 't9'],
    ['crear una pregunta', useCrearPregunta, { pregunta: 'a', respuesta: 'b' }],
    ['borrar una pregunta', useBorrarPregunta, 'f9'],
    ['guardar el SMTP', useGuardarSmtp, SMTP_A_GUARDAR],
    ['guardar una plantilla', useGuardarPlantilla, PLANTILLA],
    ['guardar el check-in', useGuardarCheckIn, CHECKIN],
    ['el health-check', useEncolarHealthCheck, undefined],
  ];

  for (const [nombre, hook, variables] of ESCRITURAS) {
    it(nombre, { timeout: 20_000 }, async () => {
      const doble = dobleQueFalla(409);

      const { result } = montar(hook);
      result.current.mutate(variables as never);
      await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 15_000 });

      expect(doble, 'la escritura se reintento: podria quedar duplicada').toHaveBeenCalledTimes(1);
    });
  }

  it('un fallo no invalida nada', async () => {
    dobleQueFalla(409);

    const { result, cliente } = montar(() => useGuardarSmtp());
    sembrarLosCuatroRecursos(cliente);
    const espia = vi.spyOn(cliente, 'invalidateQueries');

    result.current.mutate(SMTP_A_GUARDAR);
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(espia).not.toHaveBeenCalled();
    expect(invalidados(cliente)).toEqual([]);
  });

  it('un fallo del SMTP no deja la clave en la cache de consultas', async () => {
    dobleQueFalla(400, 'Host invalido');

    const { result, cliente } = montar(() => useGuardarSmtp());
    result.current.mutate(SMTP_A_GUARDAR);
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(cacheDeConsultas(cliente).texto).not.toContain(CENTINELAS.claveSmtp);
  });
});

// ---------------------------------------------------------------------------
// La imagen del QR: una ruta, no una consulta
// ---------------------------------------------------------------------------

describe('la imagen del QR', () => {
  it('es una ruta del proxy, con el prefijo /api/bx puesto', () => {
    // No pasa por `pedir` —que hace `JSON.parse` y reventaria con un PNG—, asi
    // que nadie le pone el prefijo por ella: tiene que traerlo escrito.
    expect(RUTA_DE_LA_IMAGEN_DEL_QR).toBe('/api/bx/config/checkin-qr/imagen');
  });

  it('no lleva rompe-caches: el cartel no cambia al mover la ventana', () => {
    // Un `?t=${Date.now()}` volveria a pedir el PNG en cada render, y ademas
    // ataria el `src` de una imagen al reloj.
    expect(RUTA_DE_LA_IMAGEN_DEL_QR).not.toContain('?');
  });

  it('pedir la ventana del check-in NO arrastra la imagen', async () => {
    // Si alguien metiera la imagen en el `queryFn` «para tenerla a mano»,
    // `pedir` intentaria parsear un PNG como JSON y la pantalla veria un
    // error de sintaxis donde deberia ver los minutos.
    const doble = dobleDeFetch(CHECKIN);

    const { result } = montar(() => useConfigCheckIn());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(doble).toHaveBeenCalledTimes(1);
    expect(llamada(doble).url).not.toContain('imagen');
  });
});

// ---------------------------------------------------------------------------
// EL CANAL QUE NINGUN TAPON GLOBAL MIRA: el gestor de contraseñas del navegador
// ---------------------------------------------------------------------------

/**
 * `navigator.credentials` NO EXISTE EN JSDOM, Y POR ESO HAY QUE PONERLO.
 *
 * Medido con una sonda: `typeof navigator.credentials` es `'undefined'` bajo
 * el entorno de test de este paquete. Igual que con `caches` y con
 * `navigator.serviceWorker` antes de que los tapones globales los montaran,
 * eso NO es cobertura aunque lo parezca: un
 * `navigator.credentials.store(...)` a pelo revienta con un `TypeError` y el
 * test cae solo, pero la misma linea escrita con el cuidado que escribiria
 * cualquiera —`navigator.credentials?.store?.(...)`, o detras de un
 * `if ('credentials' in navigator)`— NO HACE NADA y pasa en verde. La ausencia
 * del entorno de test se vuelve silencio.
 *
 * Y NO ES UN ALMACEN MAS. Los diez tapones vigilan sitios que son NUESTROS:
 * la consola de esta pestaña, los tres almacenes de este origen, la
 * CacheStorage de este origen, el service worker de este scope. El gestor de
 * contraseñas del navegador no es de este origen ni de esta maquina: lo que
 * se guarde ahi se sincroniza con la cuenta de Google o de Firefox de quien
 * este sentado en el mostrador y aparece en SU telefono. Un
 * `navigator.credentials.store(new PasswordCredential({ id: usuario,
 * password: clave }))` tras guardar el SMTP —«asi el navegador se la ofrece
 * la proxima vez», que es exactamente para lo que la API existe— se lee como
 * una cortesia en una revision y saca la credencial del servidor de correo del
 * gimnasio fuera del edificio.
 *
 * Es el vecino del portapapeles, que `espia-de-consola.ts` deja fuera a
 * proposito y con el motivo escrito —el panel copia secretos A PROPOSITO en
 * dos pantallas—. Aqui no pasa eso: NADA en este repo guarda credenciales en
 * el navegador, asi que de este canal se puede afirmar que esta VACIO, que es
 * la forma fuerte.
 *
 * VIVE AQUI Y NO EN EL TAPON GLOBAL porque este es el unico sitio del producto
 * por el que pasa una credencial de servidor. El dia que haya un segundo, su
 * sitio es `vigilarLosCanalesDeSalida()`, montado UNA vez para todo el
 * paquete, por el mismo motivo por el que la consola dejo de engancharse spec
 * a spec.
 */
function vigilarElGestorDeContrasenas(): ReturnType<typeof vi.fn> {
  const guardar = vi.fn(() => Promise.resolve(null));

  Object.defineProperty(navigator, 'credentials', {
    configurable: true,
    value: { store: guardar, get: vi.fn(), create: vi.fn(), preventSilentAccess: vi.fn() },
  });
  // Sin el constructor, una linea que haga `new PasswordCredential(...)`
  // reventaria por el otro lado y el test diria que todo esta bien por el
  // motivo equivocado.
  vi.stubGlobal(
    'PasswordCredential',
    class {
      constructor(public datos: unknown) {}
    },
  );

  onTestFinished(() => {
    Reflect.deleteProperty(navigator, 'credentials');
  });

  return guardar;
}

describe('la credencial no se le entrega al gestor de contraseñas del navegador', () => {
  it('guardar el SMTP no llama a `navigator.credentials.store`', async () => {
    const guardar = vigilarElGestorDeContrasenas();
    dobleDeFetch(SMTP_PUBLICO);

    const { result } = montar(() => useGuardarSmtp());
    result.current.mutate(SMTP_A_GUARDAR);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(
      guardar,
      'la clave del SMTP se guardo en el gestor del navegador: sale del edificio con la cuenta de quien este en el mostrador',
    ).not.toHaveBeenCalled();
  });

  it('el instrumento esta puesto: el doble registra lo que SI se le manda', async () => {
    // Un test que no puede caer nunca no es un test. Si `navigator.credentials`
    // no estuviera donde este archivo cree, el de arriba seria verde para
    // siempre, que es el modo de fallo que este canal existe para evitar.
    const guardar = vigilarElGestorDeContrasenas();

    await navigator.credentials?.store({ id: 'sonda' } as unknown as Credential);

    expect(guardar).toHaveBeenCalledTimes(1);
  });

  it('leer el SMTP tampoco lo toca', async () => {
    const guardar = vigilarElGestorDeContrasenas();
    dobleDeFetch(SMTP_PUBLICO);

    const { result } = montar(() => useConfigSmtp());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(guardar).not.toHaveBeenCalled();
  });
});
