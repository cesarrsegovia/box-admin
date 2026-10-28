import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import { vigilarEstosDatos } from '@/test/espia-de-consola';
import { vigilarUnaConsultaAjena } from '@/test/consulta-ajena';
import {
  cacheDeConsultas,
  dobleDeFetch,
  dobleQueFalla,
  llamada,
  montar,
} from '@/test/andamiaje-de-hooks';
import { claves } from './use-calendario';
import { clavesDeCatalogos } from './use-catalogos';
import { clavesDeUsuarios } from './use-usuarios';
import type { Mes } from './use-stats';
import {
  clavesDeDinero,
  queryDeComprobantes,
  queryDeLiquidacion,
  queryDePagos,
  useActualizarPack,
  useAnularPago,
  useAprobarComprobante,
  useColaDeComprobantes,
  useCrearPack,
  useDarDeBajaPack,
  useLiquidacion,
  usePack,
  usePagos,
  useRechazarComprobante,
  useRegistrarPago,
  type AprobacionDeComprobante,
  type PackAGuardar,
  type PagoARegistrar,
} from './use-dinero';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * LO QUE ESTA FASE SIEMBRA EN LA CACHE, REGISTRADO PARA QUE SE VEA SI SE ESCAPA.
 *
 * Esta es la fase del dinero: por estos hooks pasan IMPORTES —cuanto cobro
 * cada persona y por que concepto—, NOMBRES PROPIOS y, lo mas delicado de
 * todo, LO QUE COBRA CADA PROFESORA. La tarifa de una profesora no es un dato
 * del gimnasio: es su sueldo, y el propio controller de `/liquidacion` pide
 * ADMIN_SALON y no ADMIN_OPERATIVO justamente porque «esto ensena tarifas».
 *
 * Registrados aqui, los quince tapones globales de `vitest.setup.ts` los
 * buscan en todos los canales que no son el `<body>` —consola, titulo, nombre
 * de la pestaña, `<head>`, los cinco almacenes, User Timing, el `src` de una
 * imagen, las salidas laterales, el service worker, los atributos del `<html>`
 * y del `<body>`, la URL y la red por fuera de `pedir`— en TODOS los tests de
 * este archivo, sin que ninguno tenga que acordarse. Y los busca TAMBIEN en
 * base64 y en las demas formas codificadas: el alfabeto, no la puerta.
 */
const CENTINELAS = {
  montoDelPago: '25000.10',
  notaDelPago: 'Nota-Centinela-del-cobro-en-mano',
  precioDelPack: '12500.75',
  nombreDelPack: 'Pack-Centinela-Ilimitado',
  nombreDeLaProfesora: 'Marina-Centinela-Profesora',
  loQueCobraLaProfesora: '48500.25',
};

vigilarEstosDatos(CENTINELAS);

// ---------------------------------------------------------------------------
// Los datos de ida y de vuelta
// ---------------------------------------------------------------------------

/** Los dos perfiles del archivo. `Perfil` y `Usuario` son DOS tablas. */
const ANA = { usuarioId: 'u-ana', perfilId: 'perfil-de-ana' };
const BRUNO = { usuarioId: 'u-bruno', perfilId: 'perfil-de-bruno' };

const MES: Mes = { anio: 2026, mes: 10 };

/**
 * Un pago como lo devuelve la API.
 *
 * `monto` es una CADENA con dos decimales. El centinela termina en `.10` a
 * proposito: es el caso que un float binario no representa, y el que delata a
 * quien convierta el importe a number por el camino —`25000.1` ya no es el
 * mismo texto—.
 */
const PAGO = {
  id: 'pg-1',
  tenantId: 't1',
  perfilId: ANA.perfilId,
  monto: CENTINELAS.montoDelPago,
  metodo: 'EFECTIVO' as const,
  esSena: false,
  cubreDesde: '2026-10-01',
  cubreHasta: '2026-10-31',
  comprobanteId: null,
  registradoPor: 'u-admin',
  nota: CENTINELAS.notaDelPago,
  anuladoEn: null,
  anuladoPor: null,
  createdAt: '2026-10-23T10:00:00.000Z',
};

const PAGO_ANULADO = { ...PAGO, anuladoEn: '2026-10-23T12:00:00.000Z', anuladoPor: 'u-jefa' };

/** Lo que el formulario de cobro manda. `esSena` SIEMPRE, aunque sea false. */
const PAGO_A_REGISTRAR: PagoARegistrar = {
  perfilId: ANA.perfilId,
  monto: CENTINELAS.montoDelPago,
  metodo: 'EFECTIVO',
  cubreDesde: '2026-10-01',
  cubreHasta: '2026-10-31',
  esSena: false,
  nota: CENTINELAS.notaDelPago,
};

const PACK = {
  id: 'pk-1',
  tenantId: 't1',
  nombre: CENTINELAS.nombreDelPack,
  salaId: null,
  tipo: 'MENSUAL' as const,
  precio: CENTINELAS.precioDelPack,
  clasesPorMes: 12,
  clasesTotales: null,
  cancelacionesPermitidas: 2,
  activo: true,
};

const PACK_DE_BAJA = { ...PACK, activo: false };

const PACK_A_GUARDAR: PackAGuardar = {
  nombre: CENTINELAS.nombreDelPack,
  tipo: 'MENSUAL',
  precio: CENTINELAS.precioDelPack,
  clasesPorMes: 12,
};

const COMPROBANTE = {
  id: 'cp-1',
  tenantId: 't1',
  perfilId: ANA.perfilId,
  nombreOriginal: 'transferencia.pdf',
  tipoMime: 'application/pdf',
  subidoEn: '2026-10-22T09:00:00.000Z',
  estado: 'APROBADO' as const,
  revisadoPor: 'u-admin',
  revisadoEn: '2026-10-23T10:00:00.000Z',
  nota: null,
  createdAt: '2026-10-22T08:00:00.000Z',
  urlDeDescarga: 'https://almacen.test/firmada',
};

const APROBACION: AprobacionDeComprobante = {
  id: 'cp-1',
  monto: CENTINELAS.montoDelPago,
  cubreHasta: '2026-11-30',
};

/**
 * Una liquidacion como la devuelve la API.
 *
 * ⚠️ AQUI VIVE LA INCONSISTENCIA DEL REPO, sembrada tal cual: los importes son
 * `Importe` (`{ centavos, texto }`) y NO la cadena pelada de `PagoPublico.monto`.
 * Son dos formas de lo mismo conviviendo en `packages/shared`. No se arregla
 * —esta fuera del alcance de esta fase— pero queda escrita y medida.
 */
const IMPORTE_CERO = { centavos: 0, texto: '0.00' };
const LIQUIDACION = {
  profesorId: 'pr-1',
  profesorNombre: CENTINELAS.nombreDeLaProfesora,
  anio: MES.anio,
  mes: MES.mes,
  minutosContratados: 2400,
  minutosDictados: 2400,
  minutosCerrados: 0,
  horasContratadas: '40.00',
  horasDictadas: '40.00',
  horasCerradas: '0.00',
  franjas: [],
  importes: {
    dictadas: { centavos: 4850025, texto: CENTINELAS.loQueCobraLaProfesora },
    contratadasSinDictar: IMPORTE_CERO,
    cerradas: IMPORTE_CERO,
    aPagar: { centavos: 4850025, texto: CENTINELAS.loQueCobraLaProfesora },
    minutosSinTarifa: 0,
  },
};

// ---------------------------------------------------------------------------
// Las once rutas: una por endpoint, con su metodo
// ---------------------------------------------------------------------------

/** Las cuatro lecturas: nombre, hook ya aplicado, respuesta y ruta. */
const LECTURAS: [string, () => { isSuccess: boolean }, unknown, string][] = [
  ['los pagos', () => usePagos(), [PAGO], '/api/bx/pagos'],
  ['un pack por id', () => usePack('pk-1'), PACK, '/api/bx/packs/pk-1'],
  [
    'la cola de comprobantes',
    () => useColaDeComprobantes('PENDIENTE'),
    [COMPROBANTE],
    '/api/bx/comprobantes?estado=PENDIENTE',
  ],
  [
    'la liquidacion',
    () => useLiquidacion('pr-1', MES),
    LIQUIDACION,
    '/api/bx/liquidacion/pr-1?anio=2026&mes=10',
  ],
];

interface EscrituraMontada {
  mutate: (v: never) => void;
  isSuccess: boolean;
  isError: boolean;
}

/** Las siete escrituras: nombre, hook, variables, respuesta, ruta y metodo. */
const ESCRITURAS: [string, () => EscrituraMontada, unknown, unknown, string, string][] = [
  [
    'registrar un pago',
    () => useRegistrarPago(ANA.usuarioId),
    PAGO_A_REGISTRAR,
    PAGO,
    '/api/bx/pagos',
    'POST',
  ],
  [
    'anular un pago',
    () => useAnularPago(ANA.usuarioId),
    'pg-1',
    PAGO_ANULADO,
    '/api/bx/pagos/pg-1/anular',
    'PATCH',
  ],
  ['crear un pack', () => useCrearPack(), PACK_A_GUARDAR, PACK, '/api/bx/packs', 'POST'],
  [
    'editar un pack',
    () => useActualizarPack('pk-1'),
    { precio: CENTINELAS.precioDelPack },
    PACK,
    '/api/bx/packs/pk-1',
    'PATCH',
  ],
  [
    'dar de baja un pack',
    () => useDarDeBajaPack('pk-1'),
    undefined,
    PACK_DE_BAJA,
    '/api/bx/packs/pk-1',
    'DELETE',
  ],
  [
    'aprobar un comprobante',
    () => useAprobarComprobante(),
    APROBACION,
    COMPROBANTE,
    '/api/bx/comprobantes/cp-1/aprobar',
    'PATCH',
  ],
  [
    'rechazar un comprobante',
    () => useRechazarComprobante(),
    { id: 'cp-1', nota: 'Ilegible' },
    COMPROBANTE,
    '/api/bx/comprobantes/cp-1/rechazar',
    'PATCH',
  ],
];

describe('las rutas', () => {
  it('cada endpoint pide SU ruta, con SU metodo', { timeout: 30_000 }, async () => {
    // LAS DOS COSAS Y NO UNA. Una ruta correcta con el metodo equivocado es un
    // 404 del router de Nest que en pantalla se ve igual que un dato vacio; y
    // un metodo correcto contra la ruta de al lado escribe en el recurso
    // equivocado. Las once salen de los `@Controller(...)`, leidas una por
    // una: en la Fase 10 una ruta deducida del nombre del modulo era falsa.
    for (const [nombre, hook, respuesta, ruta] of LECTURAS) {
      const doble = dobleDeFetch(respuesta);
      const { result, unmount } = montar(hook);
      await waitFor(() => expect(result.current.isSuccess, nombre).toBe(true));

      expect(llamada(doble).url, nombre).toBe(ruta);
      expect(llamada(doble).metodo, nombre).toBe('GET');
      // Y CONTANDO: `toHaveBeenCalledWith` nunca pregunta cuantas veces.
      expect(doble, `${nombre} salio mas de una vez`).toHaveBeenCalledTimes(1);
      unmount();
      vi.unstubAllGlobals();
    }

    for (const [nombre, hook, variables, respuesta, ruta, metodo] of ESCRITURAS) {
      const doble = dobleDeFetch(respuesta);
      const { result, unmount } = montar(hook);
      result.current.mutate(variables as never);
      await waitFor(() => expect(result.current.isSuccess, nombre).toBe(true));

      expect(llamada(doble).url, nombre).toBe(ruta);
      expect(llamada(doble).metodo, nombre).toBe(metodo);
      expect(doble, `${nombre} salio mas de una vez`).toHaveBeenCalledTimes(1);
      unmount();
      vi.unstubAllGlobals();
    }
  });

  it('el id de la profesora viaja CODIFICADO: sale de la URL de la pagina', async () => {
    // Es el unico id de este archivo que no sale de una respuesta de la API
    // sino de un `?profesora=` que cualquiera puede escribir en un enlace. Sin
    // codificar, `../usuarios` es un segmento de ruta y `fetch` lo resuelve:
    // la peticion deja de ir a `/liquidacion` y sale, con la sesion del admin,
    // contra el endpoint de al lado.
    const doble = dobleDeFetch(LIQUIDACION);

    const { result } = montar(() => useLiquidacion('../usuarios', MES));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble).url).toBe('/api/bx/liquidacion/..%2Fusuarios?anio=2026&mes=10');
  });

  it('el `id` del comprobante viaja en la URL y NO en el cuerpo', async () => {
    // La API corre con `forbidNonWhitelisted`: un `id` de mas en el cuerpo
    // convierte una aprobacion valida en un 400. Y al reves, un `id` que se
    // quedara fuera de la URL mandaria el PATCH a `/comprobantes/undefined/aprobar`.
    const doble = dobleDeFetch(COMPROBANTE);

    const { result } = montar(() => useAprobarComprobante());
    result.current.mutate(APROBACION);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble).cuerpo).toEqual({
      monto: CENTINELAS.montoDelPago,
      cubreHasta: '2026-11-30',
    });
  });

  it('rechazar sin nota manda un cuerpo vacio, no un `undefined` serializado', async () => {
    const doble = dobleDeFetch(COMPROBANTE);

    const { result } = montar(() => useRechazarComprobante());
    result.current.mutate({ id: 'cp-1' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble).cuerpo).toEqual({});
  });

  it('dar de baja un pack devuelve la FILA, no un 204', async () => {
    // `DELETE /packs/:id` responde `PackPublico` con `activo: false`: la baja
    // es logica. Si el hook esperara `null` —como los borrados de
    // `use-configuracion`, que SI son 204— la pantalla mostraria un error
    // despues de una baja que ocurrio.
    dobleDeFetch(PACK_DE_BAJA);

    const { result } = montar(() => useDarDeBajaPack('pk-1'));
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.activo).toBe(false);
    expect(result.current.data?.id).toBe('pk-1');
  });
});

// ---------------------------------------------------------------------------
// Las claves
// ---------------------------------------------------------------------------

/** ¿`corta` es prefijo de `larga`? Es como empareja React Query. */
function esPrefijoDe(corta: readonly unknown[], larga: readonly unknown[]): boolean {
  if (corta.length > larga.length) return false;
  return corta.every((pieza, i) => JSON.stringify(pieza) === JSON.stringify(larga[i]));
}

describe('las claves', () => {
  const CLAVES: [string, readonly unknown[]][] = [
    ['pagos', clavesDeDinero.pagos({ perfilId: ANA.perfilId })],
    ['pack', clavesDeDinero.pack('pk-1')],
    ['cola', clavesDeDinero.colaDeComprobantes('PENDIENTE')],
    ['liquidacion', clavesDeDinero.liquidacion('pr-1', MES)],
  ];

  it('cada recurso tiene su propia clave', () => {
    const textos = CLAVES.map(([, clave]) => JSON.stringify(clave));
    expect(new Set(textos).size, 'dos recursos comparten clave: se pisan en la cache').toBe(4);

    // Y CADA UNO CON SU RAIZ, que es lo que separa recursos de verdad en React
    // Query. Comparar claves de ejemplo no basta: `['pagos', 'pk-1']` para un
    // pack y `['pagos', perfilId, …]` para los pagos son distintas Y ninguna
    // es prefijo de la otra —el segundo elemento difiere— y aun asi son el
    // mismo recurso para cualquier invalidacion por prefijo `['pagos']`.
    // MEDIDO: esa mutacion exacta sobrevivia a los 31 tests de este archivo.
    const raices = CLAVES.map(([, clave]) => JSON.stringify(clave[0]));
    expect(new Set(raices).size, 'dos recursos cuelgan de la MISMA raiz').toBe(4);

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
    dobleDeFetch([]);

    const { cliente } = montar(() => ({
      pagos: usePagos({ perfilId: ANA.perfilId }),
      pack: usePack('pk-1'),
      cola: useColaDeComprobantes('PENDIENTE'),
      liquidacion: useLiquidacion('pr-1', MES),
    }));

    expect(cacheDeConsultas(cliente).entradas).toBe(4);
  });

  it('invalidar la raiz de un recurso no arrastra a los otros tres', () => {
    // La version de comportamiento del test de arriba: no mira las claves,
    // mira si la consulta se movio. Es la unica forma de ver una raiz
    // compartida con los ojos de React Query y no con los de un `JSON.stringify`.
    const { cliente } = montar(() => null);
    sembrarTodo(cliente);

    void cliente.invalidateQueries({ queryKey: ['pagos'] });

    const rancios = invalidados(cliente);
    expect(rancios, 'el pack cuelga de la raiz de los pagos').not.toContain('pack');
    expect(rancios).not.toContain('cola');
    expect(rancios).not.toContain('liquidacion');
    expect(rancios).toContain('pagos de Ana');
  });

  it('la cola CUELGA de la clave de comprobantes, y eso es a proposito', () => {
    // Es la MISMA ruta y el MISMO recurso, con `ComprobantesService.listar`
    // ramificando por rol adentro. Asi, invalidar `['comprobantes']` alcanza a
    // la lista del alumno y a todas las colas filtradas de una vez. Se afirma
    // en POSITIVO para que nadie lo "arregle" creyendo que es un descuido.
    expect(esPrefijoDe(claves.comprobantes(), clavesDeDinero.colaDeComprobantes())).toBe(true);
    expect(esPrefijoDe(claves.comprobantes(), clavesDeDinero.colaDeComprobantes('PENDIENTE'))).toBe(
      true,
    );
  });

  it('los pagos de dos personas tienen claves distintas', () => {
    const deAna = clavesDeDinero.pagos({ perfilId: ANA.perfilId });
    const deBruno = clavesDeDinero.pagos({ perfilId: BRUNO.perfilId });

    expect(JSON.stringify(deAna)).not.toBe(JSON.stringify(deBruno));
    expect(esPrefijoDe(deAna, deBruno)).toBe(false);
    expect(esPrefijoDe(deBruno, deAna)).toBe(false);

    // Y EL PREFIJO DE INVALIDACION TAMPOCO SE CRUZA: `['pagos', perfilId]`
    // tiene que alcanzar los rangos de ESA persona y ninguno de la otra.
    expect(esPrefijoDe(clavesDeDinero.pagosDe(ANA.perfilId), deAna)).toBe(true);
    expect(esPrefijoDe(clavesDeDinero.pagosDe(ANA.perfilId), deBruno)).toBe(false);

    // El `perfilId` va PRIMERO y las fechas detras justamente para esto: el
    // prefijo alcanza CUALQUIER rango abierto de esa persona.
    const deAnaEnOctubre = clavesDeDinero.pagos({
      perfilId: ANA.perfilId,
      desde: '2026-10-01',
      hasta: '2026-10-31',
    });
    expect(esPrefijoDe(clavesDeDinero.pagosDe(ANA.perfilId), deAnaEnOctubre)).toBe(true);

    // Y el listado SIN filtrar es una rama hermana, no un padre: invalidar lo
    // de Ana no lo alcanza, por eso se invalida aparte.
    expect(esPrefijoDe(clavesDeDinero.pagosDe(ANA.perfilId), clavesDeDinero.pagos({}))).toBe(false);
  });

  it('la liquidacion de dos profesoras, o de dos meses, tambien', () => {
    const marinaEnOctubre = clavesDeDinero.liquidacion('pr-1', MES);
    const otraEnOctubre = clavesDeDinero.liquidacion('pr-2', MES);
    const marinaEnNoviembre = clavesDeDinero.liquidacion('pr-1', { anio: 2026, mes: 11 });
    const marinaElAnoQueViene = clavesDeDinero.liquidacion('pr-1', { anio: 2027, mes: 10 });

    const textos = [marinaEnOctubre, otraEnOctubre, marinaEnNoviembre, marinaElAnoQueViene].map(
      (c) => JSON.stringify(c),
    );
    expect(
      new Set(textos).size,
      'dos liquidaciones comparten clave: una profesora veria el sueldo de otra, o el mes de al lado',
    ).toBe(4);
  });

  it('dos rangos de pagos de la misma persona son DOS entradas de cache', () => {
    dobleDeFetch([PAGO]);

    const { cliente } = montar(() => ({
      todo: usePagos({ perfilId: ANA.perfilId }),
      octubre: usePagos({ perfilId: ANA.perfilId, desde: '2026-10-01', hasta: '2026-10-31' }),
    }));

    expect(cacheDeConsultas(cliente).entradas).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// El dinero es una cadena
// ---------------------------------------------------------------------------

describe('el dinero', () => {
  it('el monto viaja como CADENA, no como numero', async () => {
    // Los DTO de la API exigen `^\d{1,8}(\.\d{1,2})?$`, asi que un number no
    // es "una conversion de mas": es un 400. Y antes de eso, `25000.10`
    // serializado como number es `25000.1` —un decimal, no dos— porque un
    // float binario no representa ese valor exactamente.
    const doble = dobleDeFetch(PAGO);

    const { result } = montar(() => useRegistrarPago(ANA.usuarioId));
    result.current.mutate(PAGO_A_REGISTRAR);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const cuerpo = llamada(doble).cuerpo as Record<string, unknown>;
    expect(typeof cuerpo.monto, 'el monto se mando como numero: es dinero').toBe('string');
    expect(cuerpo.monto).toBe('25000.10');

    // Y DE VUELTA: lo que la API devuelve tampoco se convierte por el camino.
    expect(typeof result.current.data?.monto).toBe('string');
    expect(result.current.data?.monto).toBe('25000.10');
  });

  it('el precio de un pack tambien, en el alta y en la edicion', async () => {
    for (const [nombre, hook] of [
      ['alta', () => useCrearPack()],
      ['edicion', () => useActualizarPack('pk-1')],
    ] as [string, () => EscrituraMontada][]) {
      const doble = dobleDeFetch(PACK);
      const { result, unmount } = montar(hook);
      result.current.mutate({ precio: CENTINELAS.precioDelPack } as never);
      await waitFor(() => expect(result.current.isSuccess, nombre).toBe(true));

      const cuerpo = llamada(doble).cuerpo as Record<string, unknown>;
      expect(typeof cuerpo.precio, nombre).toBe('string');
      expect(cuerpo.precio, nombre).toBe('12500.75');
      unmount();
      vi.unstubAllGlobals();
    }
  });

  it('el monto de una aprobacion tambien', async () => {
    const doble = dobleDeFetch(COMPROBANTE);

    const { result } = montar(() => useAprobarComprobante());
    result.current.mutate(APROBACION);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const cuerpo = llamada(doble).cuerpo as Record<string, unknown>;
    expect(typeof cuerpo.monto).toBe('string');
    expect(cuerpo.monto).toBe('25000.10');
  });

  it('la liquidacion trae `Importe` y NO una cadena pelada: dos formas conviviendo', async () => {
    // ⚠️ INCONSISTENCIA REAL DEL REPO, medida y no arreglada: vive en
    // `packages/shared`, fuera del alcance de esta fase. `PagoPublico.monto`
    // es `"25000.10"` y `LiquidacionProfesor.importes.aPagar` es
    // `{ centavos, texto }`. Ninguna de las dos usa un float de pesos, pero
    // quien pinte las dos pantallas tiene que acordarse de la diferencia o
    // pintara `[object Object]` donde iba un importe.
    dobleDeFetch(LIQUIDACION);

    const { result } = montar(() => useLiquidacion('pr-1', MES));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const aPagar = result.current.data?.importes.aPagar;
    expect(typeof aPagar).toBe('object');
    expect(aPagar?.texto).toBe(CENTINELAS.loQueCobraLaProfesora);
    expect(typeof aPagar?.centavos).toBe('number');
    expect(aPagar?.centavos).toBe(4850025);
  });

  it('`esSena` viaja SIEMPRE, incluso en false', async () => {
    // MEDIDO en `PagosService.crear`: `esSena: dto.esSena ?? false`. O sea que
    // el defecto del servidor HOY es false y omitir la clave equivale a
    // mandarla asi. Se manda igual por lo que costo la Fase 12: alli
    // `mostrarPrecios` y `seguro` venian en `true` por defecto, y omitir el
    // booleano publicaba los precios de un gimnasio que los tenia ocultos y le
    // encendia el TLS a uno que corria sin cifrar. Un booleano con
    // consecuencias lo decide la pantalla y viaja escrito.
    const doble = dobleDeFetch(PAGO);

    const { result } = montar(() => useRegistrarPago(ANA.usuarioId));
    result.current.mutate({ ...PAGO_A_REGISTRAR, esSena: false });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const cuerpo = llamada(doble).cuerpo as Record<string, unknown>;
    expect(Object.keys(cuerpo), 'la clave `esSena` no viajo').toContain('esSena');
    expect(cuerpo.esSena).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Los filtros
// ---------------------------------------------------------------------------

describe('los filtros', () => {
  it('un filtro vacio NO se manda', async () => {
    // Una cadena vacia es lo que manda un `<select>` en "todos", y para la API
    // no es "sin filtro": `?desde=` llega a `desdeFechaISO('')`, y pedir un
    // rango desde una fecha invalida no es pedir "desde siempre".
    expect(queryDePagos({ perfilId: '', desde: '', hasta: '' })).toBe('');
    expect(queryDePagos({})).toBe('');
    expect(queryDeComprobantes(undefined)).toBe('');

    const doble = dobleDeFetch([PAGO]);
    const { result } = montar(() => usePagos({ perfilId: '', desde: '', hasta: '' }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble).url, 'un filtro vacio salio en la URL').toBe('/api/bx/pagos');
    expect(doble).toHaveBeenCalledTimes(1);
  });

  it('la cola sin estado pide /comprobantes a secas', async () => {
    // `?estado=` seria un estado que no esta en el enum, y la respuesta —una
    // lista vacia— se leeria como "no hay nada pendiente", que es la peor
    // forma de equivocarse en esta pantalla.
    const doble = dobleDeFetch([COMPROBANTE]);

    const { result } = montar(() => useColaDeComprobantes());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble).url).toBe('/api/bx/comprobantes');
  });

  it('los filtros que SI tienen valor viajan, y solo esos', () => {
    expect(queryDePagos({ perfilId: ANA.perfilId })).toBe('?perfilId=perfil-de-ana');
    expect(queryDePagos({ desde: '2026-10-01' })).toBe('?desde=2026-10-01');
    expect(queryDePagos({ perfilId: ANA.perfilId, desde: '2026-10-01', hasta: '2026-10-31' })).toBe(
      '?perfilId=perfil-de-ana&desde=2026-10-01&hasta=2026-10-31',
    );
    expect(queryDeComprobantes('PENDIENTE')).toBe('?estado=PENDIENTE');
  });

  it('una cadena vacia y un `undefined` dan LA MISMA clave', () => {
    // Si la clave los distinguiera, la misma peticion quedaria cacheada dos
    // veces y una invalidacion dirigida alcanzaria a una sola.
    expect(JSON.stringify(clavesDeDinero.pagos({ perfilId: '', desde: '', hasta: '' }))).toBe(
      JSON.stringify(clavesDeDinero.pagos({})),
    );
  });

  it('`anio` y `mes` NO son filtros: viajan siempre', () => {
    // `@Query('anio', ParseIntPipe)` SIN `{ optional: true }`: omitir uno no
    // pide "el mes corriente", es un 400. Por eso esto NO sigue el patron de
    // "un filtro vacio no se manda".
    expect(queryDeLiquidacion(MES)).toBe('?anio=2026&mes=10');
    // Y se manda tal cual llego, sin mirar si es "razonable": el sitio donde
    // se decide que mes es valido es el pipe de la API, no esto.
    expect(queryDeLiquidacion({ anio: 2026, mes: 0 })).toBe('?anio=2026&mes=0');
  });
});

// ---------------------------------------------------------------------------
// El alcance de cada invalidacion
// ---------------------------------------------------------------------------

/** Todo lo que puede quedar rancio en este archivo, sembrado de una vez. */
function sembrarTodo(cliente: QueryClient): void {
  cliente.setQueryData(clavesDeDinero.pagos({ perfilId: ANA.perfilId }), [PAGO]);
  cliente.setQueryData(
    clavesDeDinero.pagos({ perfilId: ANA.perfilId, desde: '2026-10-01', hasta: '2026-10-31' }),
    [PAGO],
  );
  cliente.setQueryData(clavesDeDinero.pagos({ perfilId: BRUNO.perfilId }), []);
  cliente.setQueryData(clavesDeDinero.pagos({}), [PAGO]);
  cliente.setQueryData(clavesDeDinero.pack('pk-1'), PACK);
  cliente.setQueryData(clavesDeCatalogos.packs(), [PACK]);
  cliente.setQueryData(clavesDeDinero.colaDeComprobantes('PENDIENTE'), [COMPROBANTE]);
  cliente.setQueryData(claves.comprobantes(), [COMPROBANTE]);
  cliente.setQueryData(clavesDeDinero.liquidacion('pr-1', MES), LIQUIDACION);
  cliente.setQueryData(clavesDeUsuarios.uno(ANA.usuarioId), { id: ANA.usuarioId });
  cliente.setQueryData(clavesDeUsuarios.uno(BRUNO.usuarioId), { id: BRUNO.usuarioId });
}

const NOMBRES: [string, readonly unknown[]][] = [
  ['pagos de Ana', clavesDeDinero.pagos({ perfilId: ANA.perfilId })],
  [
    'pagos de Ana en octubre',
    clavesDeDinero.pagos({ perfilId: ANA.perfilId, desde: '2026-10-01', hasta: '2026-10-31' }),
  ],
  ['pagos de Bruno', clavesDeDinero.pagos({ perfilId: BRUNO.perfilId })],
  ['pagos sin filtrar', clavesDeDinero.pagos({})],
  ['pack', clavesDeDinero.pack('pk-1')],
  ['catalogo de packs', clavesDeCatalogos.packs()],
  ['cola', clavesDeDinero.colaDeComprobantes('PENDIENTE')],
  ['comprobantes del alumno', claves.comprobantes()],
  ['liquidacion', clavesDeDinero.liquidacion('pr-1', MES)],
  ['ficha de Ana', clavesDeUsuarios.uno(ANA.usuarioId)],
  ['ficha de Bruno', clavesDeUsuarios.uno(BRUNO.usuarioId)],
];

/** Que quedo marcado rancio, por nombre. */
function invalidados(cliente: QueryClient): string[] {
  return NOMBRES.filter(
    ([, clave]) => cliente.getQueryCache().find({ queryKey: clave })?.state.isInvalidated,
  ).map(([nombre]) => nombre);
}

describe('el alcance de cada invalidacion', () => {
  it('anular invalida los pagos de ESA persona y nada mas', async () => {
    dobleDeFetch(PAGO_ANULADO);

    const { result, cliente } = montar(() => useAnularPago(ANA.usuarioId));
    sembrarTodo(cliente);
    const sinTocarLoAjeno = vigilarUnaConsultaAjena(cliente);

    result.current.mutate('pg-1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Los de Ana en TODOS sus rangos, el listado sin filtrar —que la
    // contiene— y su ficha, por el `pagoAlDia` DERIVADO de la Fase 5A.
    expect(invalidados(cliente).sort()).toEqual(
      ['ficha de Ana', 'pagos de Ana', 'pagos de Ana en octubre', 'pagos sin filtrar'].sort(),
    );

    await sinTocarLoAjeno();
  });

  it('registrar invalida exactamente lo mismo que anular', async () => {
    dobleDeFetch(PAGO);

    const { result, cliente } = montar(() => useRegistrarPago(ANA.usuarioId));
    sembrarTodo(cliente);
    const sinTocarLoAjeno = vigilarUnaConsultaAjena(cliente);

    result.current.mutate(PAGO_A_REGISTRAR);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidados(cliente).sort()).toEqual(
      ['ficha de Ana', 'pagos de Ana', 'pagos de Ana en octubre', 'pagos sin filtrar'].sort(),
    );

    await sinTocarLoAjeno();
  });

  it('aprobar un comprobante invalida la cola y nada mas', async () => {
    dobleDeFetch(COMPROBANTE);

    const { result, cliente } = montar(() => useAprobarComprobante());
    sembrarTodo(cliente);
    const sinTocarLoAjeno = vigilarUnaConsultaAjena(cliente);

    result.current.mutate(APROBACION);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const rancios = invalidados(cliente);

    // La cola, y la lista del alumno que es su padre: el MISMO recurso.
    expect(rancios).toContain('cola');
    expect(rancios).toContain('comprobantes del alumno');

    // Y NADA MAS: ni los packs, ni la liquidacion, ni los pagos de OTRA
    // persona, ni las fichas. (Los pagos de ESA persona si, y eso tiene su
    // propio test aqui abajo: aprobar ACUÑA un pago.)
    expect(rancios).not.toContain('pack');
    expect(rancios).not.toContain('catalogo de packs');
    expect(rancios).not.toContain('liquidacion');
    expect(rancios).not.toContain('pagos de Bruno');
    expect(rancios).not.toContain('ficha de Ana');
    expect(rancios).not.toContain('ficha de Bruno');

    await sinTocarLoAjeno();
  });

  it('aprobar invalida TAMBIEN los pagos de esa persona, porque ACUÑA un pago', async () => {
    // ⚠️ La plantilla de esta tarea decia "aprobar invalida la cola y nada
    // mas". Medido en `ComprobantesService.aprobar`, eso es FALSO: el `Pago`
    // nace en la MISMA transaccion que marca el comprobante como aprobado, con
    // un comentario del service que explica por que («si naciera fuera, un
    // fallo entre las dos escrituras dejaria un comprobante aprobado sin cobro
    // registrado, y eso no se descubre hasta cuadrar la caja a fin de mes»).
    // La API invalida ademas su cache de stats ahi mismo. Del lado del cliente
    // eso significa que aprobar deja rancios los pagos de esa persona
    // exactamente igual que `useRegistrarPago`.
    dobleDeFetch(COMPROBANTE);

    const { result, cliente } = montar(() => useAprobarComprobante());
    sembrarTodo(cliente);

    result.current.mutate(APROBACION);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const rancios = invalidados(cliente);
    expect(rancios).toContain('pagos de Ana');
    expect(rancios).toContain('pagos de Ana en octubre');
    expect(rancios).toContain('pagos sin filtrar');
    // El `perfilId` sale de la RESPUESTA, no de las variables: el admin
    // aprueba un comprobante, no elige una persona.
    expect(rancios).not.toContain('pagos de Bruno');
  });

  it('rechazar NO toca los pagos: rechazar no mueve dinero', async () => {
    // Lo dice el DTO: `rechazar` usa `RevisarComprobanteDto`, que solo lleva
    // `nota`. No se crea ningun `Pago`.
    dobleDeFetch(COMPROBANTE);

    const { result, cliente } = montar(() => useRechazarComprobante());
    sembrarTodo(cliente);
    const sinTocarLoAjeno = vigilarUnaConsultaAjena(cliente);

    result.current.mutate({ id: 'cp-1', nota: 'Ilegible' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidados(cliente).sort()).toEqual(['cola', 'comprobantes del alumno'].sort());

    await sinTocarLoAjeno();
  });

  it('las tres escrituras de packs invalidan el catalogo y SU pack, nada mas', async () => {
    const CASOS: [string, () => EscrituraMontada, unknown, unknown][] = [
      ['crear', () => useCrearPack(), PACK_A_GUARDAR, PACK],
      ['editar', () => useActualizarPack('pk-1'), { nombre: 'Otro' }, PACK],
      ['dar de baja', () => useDarDeBajaPack('pk-1'), undefined, PACK_DE_BAJA],
    ];

    for (const [nombre, hook, variables, respuesta] of CASOS) {
      dobleDeFetch(respuesta);
      const { result, cliente, unmount } = montar(hook);
      sembrarTodo(cliente);
      const sinTocarLoAjeno = vigilarUnaConsultaAjena(cliente);

      result.current.mutate(variables as never);
      await waitFor(() => expect(result.current.isSuccess, nombre).toBe(true));

      expect(invalidados(cliente).sort(), nombre).toEqual(['catalogo de packs', 'pack'].sort());

      await sinTocarLoAjeno();
      unmount();
      vi.unstubAllGlobals();
    }
  });

  it('ninguna liquidacion se invalida desde aqui: se CALCULA, no se guarda', async () => {
    // Lo que mueve una liquidacion son las horas y las tarifas —ausencias,
    // horarios, vacaciones—, que viven en otros hooks. Un cobro a un alumno no
    // cambia lo que se le paga a una profesora.
    for (const [nombre, hook, variables, respuesta] of ESCRITURAS) {
      dobleDeFetch(respuesta);
      const { result, cliente, unmount } = montar(hook);
      sembrarTodo(cliente);

      result.current.mutate(variables as never);
      await waitFor(() => expect(result.current.isSuccess, nombre).toBe(true));

      expect(invalidados(cliente), nombre).not.toContain('liquidacion');
      unmount();
      vi.unstubAllGlobals();
    }
  });

  it('ninguna escritura refresca una consulta ajena', { timeout: 30_000 }, async () => {
    // Con un solo consumidor del `QueryClient`, una invalidacion dirigida y un
    // `invalidateQueries()` pelado son indistinguibles. Asi se escapo una en
    // la Fase 9.
    for (const [nombre, hook, variables, respuesta] of ESCRITURAS) {
      dobleDeFetch(respuesta);
      const { result, cliente, unmount } = montar(hook);
      const sinTocarLoAjeno = vigilarUnaConsultaAjena(cliente);

      result.current.mutate(variables as never);
      await waitFor(() => expect(result.current.isSuccess, nombre).toBe(true));

      await sinTocarLoAjeno();
      unmount();
      vi.unstubAllGlobals();
    }
  });

  it('un fallo no invalida nada', async () => {
    dobleQueFalla(409);

    const { result, cliente } = montar(() => useRegistrarPago(ANA.usuarioId));
    sembrarTodo(cliente);
    const espia = vi.spyOn(cliente, 'invalidateQueries');

    result.current.mutate(PAGO_A_REGISTRAR);
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(espia).not.toHaveBeenCalled();
    expect(invalidados(cliente)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Los reintentos
// ---------------------------------------------------------------------------

describe('los reintentos', () => {
  it('una escritura que falla sale UNA sola vez', { timeout: 40_000 }, async () => {
    // `retry` solo actua AL FALLAR: los conteos sobre un 200 no lo ven. Hay
    // que esperar a que el error este PINTADO antes de contar, o se contaria
    // uno aunque hubiera tres. Un cobro reintentado es un cobro duplicado.
    for (const [nombre, hook, variables] of ESCRITURAS) {
      const doble = dobleQueFalla(409);
      const { result, unmount } = montar(hook);

      result.current.mutate(variables as never);
      await waitFor(() => expect(result.current.isError, nombre).toBe(true), { timeout: 15_000 });

      expect(doble, `${nombre} se reintento: podria quedar duplicada`).toHaveBeenCalledTimes(1);
      unmount();
      vi.unstubAllGlobals();
    }
  });
});

// ---------------------------------------------------------------------------
// Lo que las mutaciones NO dejan atras
// ---------------------------------------------------------------------------

describe('la cache de mutaciones', () => {
  /** Todo lo que la cache de mutaciones tiene dentro, serializado. */
  function contenidoDeLasMutaciones(cliente: QueryClient): string {
    return JSON.stringify(
      cliente
        .getMutationCache()
        .getAll()
        .map((mutacion) => mutacion.state),
    );
  }

  it('el monto y la nota de un cobro no sobreviven al desmontaje', async () => {
    // `gcTime: 0` en las seis. Las `variables` de estas mutaciones son el
    // monto, el metodo y la nota de un cobro concreto de una persona con
    // nombre: sin el, TanStack las conserva cinco minutos en el `QueryClient`
    // unico de la aplicacion, en la maquina del mostrador, legibles desde la
    // consola.
    dobleDeFetch(PAGO);

    const { result, cliente, unmount } = montar(() => useRegistrarPago(ANA.usuarioId));
    result.current.mutate(PAGO_A_REGISTRAR);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // EL INSTRUMENTO, ANTES DEL VEREDICTO: con el cobro todavia montado las
    // variables SI estan ahi. Sin esta linea, el test pasaria igual contra una
    // mutacion sin `gcTime` si el volcado se tomara en el momento equivocado.
    expect(contenidoDeLasMutaciones(cliente)).toContain(CENTINELAS.montoDelPago);

    unmount();

    // `gcTime: 0` no borra en el mismo tick: programa el recolector con cero
    // de espera, que sigue siendo un turno del bucle de eventos.
    await waitFor(() => expect(cliente.getMutationCache().getAll()).toHaveLength(0));

    const volcado = contenidoDeLasMutaciones(cliente);
    expect(volcado).not.toContain(CENTINELAS.montoDelPago);
    expect(volcado).not.toContain(CENTINELAS.notaDelPago);
  });
});
