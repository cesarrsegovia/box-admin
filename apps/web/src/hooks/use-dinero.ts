'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ComprobantePublico,
  EstadoComprobante,
  LiquidacionProfesor,
  MetodoPago,
  PackPublico,
  PagoPublico,
} from '@boxadmin/shared';
import { type ErrorDeApi, pedir } from '@/lib/cliente';
import { claves } from './use-calendario';
import { clavesDeCatalogos } from './use-catalogos';
import { clavesDeUsuarios } from './use-usuarios';
import type { Mes } from './use-stats';

/**
 * EL DINERO: LOS NUEVE ENDPOINTS QUE QUEDABAN SIN PANTALLA EN TODO EL PROYECTO.
 *
 * LAS DIEZ RUTAS SALEN DE LOS CONTROLLERS, leidas una por una, y NINGUNA se
 * dedujo del nombre del modulo —en la Fase 10 una ruta deducida asi era falsa y
 * el 404 se veia en pantalla como un dato vacio—:
 *
 *  - `@Controller('pagos')` en `apps/api/src/pagos/pagos.controller.ts`:
 *    `POST /` (ADMIN_OPERATIVO), `GET /` (ADMIN_OPERATIVO) y
 *    `PATCH :id/anular` (**ADMIN_SALON**).
 *  - `@Controller('packs')` en `apps/api/src/packs/packs.controller.ts`:
 *    `POST /` (ADMIN_SALON), `GET :id` (**SIN `@Roles`**), `PATCH :id`
 *    (ADMIN_SALON) y `DELETE :id` (ADMIN_SALON). El `GET /` ya lo pide
 *    `usePacks` en `use-catalogos`, asi que no se repite aqui.
 *  - `@Controller('comprobantes')` en
 *    `apps/api/src/comprobantes/comprobantes.controller.ts`:
 *    `PATCH :id/aprobar` y `PATCH :id/rechazar` (los dos ADMIN_OPERATIVO), mas
 *    el `GET /` que ya existia y que se usa aqui con filtro.
 *  - `@Controller('liquidacion')` en
 *    `apps/api/src/liquidacion/liquidacion.controller.ts`: `GET :profesorId`
 *    (ADMIN_SALON: «esto ensena tarifas», dice el comentario del controller).
 *
 * EL REPARTO IMPORTA: son CUATRO lecturas (`GET /pagos`, `GET /packs/:id`,
 * `GET /comprobantes` y `GET /liquidacion/:profesorId`) y SEIS escrituras. Cada
 * escritura es un `gcTime: 0` y una invalidacion que decidir, y ninguna de las
 * seis queda sin las dos cosas.
 *
 * ---------------------------------------------------------------------------
 * LA SUTILEZA DE LA FASE: `GET /comprobantes` PIDE `@Roles('ALUMNO')` Y AUN ASI
 * ES LA COLA DEL ADMIN. NO «ARREGLAR» ESE DECORADOR.
 *
 * `rolAlcanza` (`packages/shared/src/roles.ts`) es JERARQUIA NUMERICA:
 * ADMIN_SALON 40, ADMIN_OPERATIVO 30, PROFESOR 20, ALUMNO 10, y
 * `rolAlcanza(rol, minimo)` es `JERARQUIA[rol] >= JERARQUIA[minimo]`. O sea que
 * un ADMIN_OPERATIVO **pasa** un guard de `ALUMNO`: 30 >= 10.
 *
 * Y el service se ramifica ADENTRO (`ComprobantesService.listar`):
 *
 *     const esPersonal = rolAlcanza(actor.rol, 'ADMIN_OPERATIVO');
 *     if (esPersonal) where.subidoEn = { not: null };
 *     else            where.perfilId = (perfil del actor).id;
 *
 * Al admin le devuelve los de TODO el gimnasio; al alumno, SOLO los suyos. Es
 * el mismo endpoint y la misma clave de cache, pero no es la misma lista.
 *
 * Esto queda escrito aqui porque es exactamente el tipo de cosa que alguien
 * «arregla»: ver `@Roles('ALUMNO')` encima de lo que la pantalla del admin
 * llama «la cola», pensar que es un olvido y subirlo a `ADMIN_OPERATIVO`.
 * Subirlo deja al alumno sin poder ver sus propios comprobantes —la pantalla
 * donde sube la foto de la transferencia—, y el sintoma aparece en la otra
 * punta del producto.
 *
 * Y LA RAMA DEL ADMIN TIENE UNA DECISION ESCRITA: `where.subidoEn = { not: null }`.
 * Al admin NO se le muestran las filas sin archivo, «porque serian enlaces
 * rotos» (comentario del service). O sea: la cola que cuenta esta pantalla y el
 * numero de comprobantes que hay en la base NO tienen por que coincidir, y eso
 * no es un bug de paginacion.
 *
 * ---------------------------------------------------------------------------
 * EL DINERO VIAJA COMO CADENA. SIEMPRE.
 *
 * `PagoPublico.monto` y `PackPublico.precio` son strings con dos decimales,
 * nunca numbers: un float binario no representa 25000.10 exactamente. Los DTO
 * de la API lo exigen con un `@Matches(/^\d{1,8}(\.\d{1,2})?$/)`, asi que un
 * number aqui no es «una conversion de mas»: es un 400.
 *
 * ⚠️ INCONSISTENCIA REAL DEL REPO, ANOTADA Y NO ARREGLADA. Conviven DOS formas
 * de lo mismo:
 *
 *  - `PagoPublico.monto` y `PackPublico.precio`: **cadena pelada** (`"25000.00"`).
 *  - `LiquidacionProfesor.importes.*`: un `Importe`, o sea
 *    `{ centavos: number; texto: string }` (`packages/shared/src/dinero.contracts.ts`).
 *
 * Las dos son correctas por separado y ninguna usa un float de pesos. Pero
 * quien pinte las dos pantallas tiene que acordarse de que `pago.monto` es un
 * string y `liquidacion.importes.aPagar` es un objeto con el string DENTRO
 * (`.texto`) y la verdad al lado (`.centavos`). No se unifica aqui: vive en
 * `packages/shared`, que esta fuera del alcance de esta fase. Se deja escrito
 * para que la proxima pantalla no descubra la diferencia con un `[object Object]`
 * pintado donde iba un importe.
 *
 * ---------------------------------------------------------------------------
 * LA INVALIDACION ES DIRIGIDA, Y AQUI CRUZA RECURSOS.
 *
 * Nunca `invalidateQueries()` pelado: ver el bloque de `src/test/consulta-ajena.ts`.
 * Con un solo consumidor del `QueryClient`, una invalidacion global y una
 * dirigida son indistinguibles, y asi se escapo una en la Fase 9.
 *
 * Lo que cruza de verdad, medido en los services:
 *
 *  - REGISTRAR Y ANULAR UN PAGO cambian los pagos de esa persona Y el
 *    `pagoAlDia` de su ficha, que desde la Fase 5A es DERIVADO («hay un pago
 *    vigente, no anulado y que no sea una sena, cubriendo hoy») y no una
 *    columna.
 *  - APROBAR UN COMPROBANTE **ACUÑA UN PAGO** en la misma transaccion
 *    (`ComprobantesService.aprobar` hace un `cliente.pago.create(...)`), asi
 *    que no mueve solo la cola. Ver `useAprobarComprobante`.
 *  - RECHAZAR no mueve dinero: solo la cola.
 */

// ---------------------------------------------------------------------------
// Las claves, en un solo sitio, como en `use-stats` y `use-usuarios`
// ---------------------------------------------------------------------------

/** Los tres filtros de `GET /pagos`, los tres opcionales. */
export interface FiltroDePagos {
  perfilId?: string;
  /** `YYYY-MM-DD`. Filtra por CUANDO ENTRO el dinero, no por lo que cubre. */
  desde?: string;
  hasta?: string;
}

/**
 * Un opcional de la pantalla, visto como lo ve la peticion.
 *
 * Copiado a proposito de `sinVacio` en `use-stats`: una cadena vacia es lo que
 * manda un `<select>` en «todos», y para la API no es «sin filtro» sino un id
 * vacio. Aqui se vuelve `null` UNA vez y el mismo resultado gobierna las dos
 * cosas que tienen que coincidir: si el parametro viaja y bajo que clave se
 * guarda. Si la clave distinguiera `''` de `undefined` —dos peticiones
 * identicas— la misma respuesta quedaria cacheada dos veces y una invalidacion
 * dirigida alcanzaria a una sola.
 */
function sinVacio(valor: string | undefined): string | null {
  return valor === undefined || valor === '' ? null : valor;
}

/**
 * LAS CLAVES, Y EL ORDEN DE SUS PIEZAS NO ES COSMETICO.
 *
 * React Query empareja por PREFIJO de array. En `pagos` el `perfilId` va
 * PRIMERO y las fechas detras justamente para que exista un prefijo
 * `['pagos', perfilId]` que alcance a los pagos de esa persona en CUALQUIER
 * rango de fechas. Con las fechas delante, invalidar «lo de Ana» obligaria a
 * conocer todos los rangos abiertos en pantalla, que es lo mismo que no poder
 * invalidar nada.
 *
 * Y `pack` es SINGULAR (`['pack', id]`), separado de `['packs']` —el catalogo
 * de `use-catalogos`— por la misma razon por la que `clavesDeUsuarios` tiene
 * `uno: ['usuario', id]` y `lista: ['usuarios', filtros]`: son dos consultas
 * distintas contra dos rutas distintas.
 */
export const clavesDeDinero = {
  pagos: (f: FiltroDePagos) =>
    ['pagos', sinVacio(f.perfilId), sinVacio(f.desde), sinVacio(f.hasta)] as const,
  /** El PREFIJO que alcanza los pagos de una persona en todos los rangos. */
  pagosDe: (perfilId: string | null) => ['pagos', perfilId] as const,
  pack: (id: string) => ['pack', id] as const,
  /**
   * La cola del admin, por estado.
   *
   * Cuelga de `claves.comprobantes()` —`['comprobantes']`, la lista del
   * alumno— A PROPOSITO y no por descuido: es la MISMA ruta y el MISMO
   * recurso, con el service ramificando por rol adentro. Asi, invalidar
   * `['comprobantes']` alcanza a la lista sin filtrar y a todas las colas
   * filtradas de una vez, que es justo lo que hace falta: subir un comprobante
   * y aprobarlo dejan rancias las dos cosas.
   */
  colaDeComprobantes: (estado?: EstadoComprobante) =>
    [...claves.comprobantes(), estado ?? null] as const,
  liquidacion: (profesorId: string, m: Mes) => ['liquidacion', profesorId, m.anio, m.mes] as const,
  /** La de quien mira: otra raiz, para que invalidar la del admin no la toque. */
  miLiquidacion: (m: Mes) => ['mi-liquidacion', m.anio, m.mes] as const,
};

// ---------------------------------------------------------------------------
// Los query strings: SOLO lo que tiene valor
// ---------------------------------------------------------------------------

/**
 * Los tres filtros de los pagos, y solo los que tienen valor.
 *
 * `?perfilId=` vacio NO es «todos los pagos»: el service hace
 * `if (filtro.perfilId) where.perfilId = filtro.perfilId`, asi que una cadena
 * vacia es falsy y hoy se ignora igual. Pero el `?desde=` vacio SI llega a
 * `desdeFechaISO('')`, y pedir un rango desde una fecha invalida no es pedir
 * «desde siempre». Se recortan los tres por el mismo criterio y no uno solo:
 * lo que se fija es «un filtro vacio no se manda», no «este filtro en concreto
 * sobrevive a la implementacion actual del service».
 */
export function queryDePagos(f: FiltroDePagos): string {
  const partes = new URLSearchParams();

  const perfil = sinVacio(f.perfilId);
  if (perfil !== null) partes.set('perfilId', perfil);
  const desde = sinVacio(f.desde);
  if (desde !== null) partes.set('desde', desde);
  const hasta = sinVacio(f.hasta);
  if (hasta !== null) partes.set('hasta', hasta);

  const texto = partes.toString();
  return texto === '' ? '' : `?${texto}`;
}

/** El estado, y solo si lo hay. Sin estado, la cola entera. */
export function queryDeComprobantes(estado?: EstadoComprobante): string {
  return estado === undefined ? '' : `?estado=${estado}`;
}

/**
 * EL MES VIAJA SIEMPRE, y no es una comodidad: es obligatorio.
 *
 * El controller declara `@Query('anio', ParseIntPipe)` y
 * `@Query('mes', ParseIntPipe)` SIN `{ optional: true }`. Omitir uno no pide
 * «el mes corriente»: es un 400 de `ParseIntPipe`. Mismo caso que el mes de
 * `/stats/caja`, y el motivo por el que esto NO sigue el patron de «un filtro
 * vacio no se manda»: no es un filtro.
 */
export function queryDeLiquidacion(m: Mes): string {
  const partes = new URLSearchParams();
  partes.set('anio', String(m.anio));
  partes.set('mes', String(m.mes));
  return `?${partes.toString()}`;
}

// ---------------------------------------------------------------------------
// Recurso 1: los pagos
// ---------------------------------------------------------------------------

/** Los pagos, opcionalmente de una persona y/o de un rango. ADMIN_OPERATIVO. */
export function usePagos(filtro: FiltroDePagos = {}) {
  return useQuery({
    queryKey: clavesDeDinero.pagos(filtro),
    queryFn: () => pedir<PagoPublico[]>(`/pagos${queryDePagos(filtro)}`),
  });
}

/**
 * Lo que el formulario de cobro tiene en la mano.
 *
 * `monto` es `string` Y NO `number`, y el tipo es la primera defensa: el DTO de
 * la API exige `^\d{1,8}(\.\d{1,2})?$` y un number se serializa como `25000.1`
 * —un decimal, no dos— o directamente como `25000.100000000001`. Es dinero.
 *
 * `esSena` es OBLIGATORIO AQUI aunque sea `@IsOptional()` en `CrearPagoDto`.
 * MEDIDO, no supuesto: `PagosService.crear` escribe `esSena: dto.esSena ?? false`,
 * o sea que el defecto del servidor es `false` y omitir la clave hoy equivale a
 * mandarla en `false`. Se manda igual, siempre, por lo que costo la Fase 12:
 * alli `mostrarPrecios` y `seguro` venian en `true` por defecto, omitir el
 * booleano publicaba los precios de un gimnasio que los tenia ocultos y le
 * encendia el TLS a uno que corria sin cifrar. La regla que salio de ahi es que
 * un booleano con consecuencias LO DECIDE LA PANTALLA y viaja escrito, para que
 * el dia que alguien cambie el `?? false` del service no cambie en silencio lo
 * que cobra el mostrador. Una sena reserva un lugar y NO pone al alumno al dia:
 * confundirla con un pago normal es cobrarle dos veces o dejarlo entrar gratis.
 */
export interface PagoARegistrar {
  perfilId: string;
  /** Cadena con hasta dos decimales, p. ej. `"25000.00"`. NUNCA un number. */
  monto: string;
  metodo: MetodoPago;
  /** `YYYY-MM-DD`. */
  cubreDesde: string;
  cubreHasta: string;
  esSena: boolean;
  comprobanteId?: string;
  nota?: string;
}

/**
 * LO QUE UN PAGO DEJA RANCIO, Y LO QUE NO.
 *
 * Dos cosas, y las dos dirigidas:
 *
 *  1. `['pagos', perfilId]` — los pagos de ESA persona, en cualquier rango de
 *     fechas que haya abierto. Los de otra persona no se tocan.
 *  2. `['pagos', null]` — el listado SIN filtrar, que es la caja y que
 *     contiene a esa persona. No lo alcanza el prefijo de arriba (son dos
 *     ramas hermanas del arbol de claves) y haria falta igual: un cobro nuevo
 *     aparece en la caja del dia.
 *  3. `['usuario', usuarioId]` — la ficha, por el `pagoAlDia` DERIVADO de la
 *     Fase 5A. Sin esto, el admin cobra y la ficha que tiene delante sigue
 *     diciendo «no esta al dia».
 *
 * LO QUE NO SE INVALIDA, a proposito: `['usuarios']` (el listado de personas,
 * que tambien lleva `pagoAlDia`) y `['stats', ...]`. Los dos quedan rancios de
 * verdad, y aun asi no se tocan desde aqui: el gesto ocurre en la ficha de UNA
 * persona, y arrastrar el listado entero y los seis reportes detras de cada
 * cobro es el refetch-de-todo que `consulta-ajena.ts` existe para impedir. Se
 * vuelven a pedir solos cuando el admin navega a ellos.
 *
 * EL `usuarioId` VIENE DEL HOOK Y EL `perfilId` DE LA RESPUESTA, y son DOS
 * identificadores distintos: `Usuario` y `Perfil` son dos tablas, la ficha se
 * pide por el id del usuario (`GET /usuarios/:id`) y el pago se registra contra
 * el id del perfil. No se puede derivar uno del otro desde aqui, asi que el
 * llamador —la ficha, que tiene los dos— pasa el suyo.
 */
function useInvalidarElDineroDeUnaPersona(usuarioId: string) {
  const cliente = useQueryClient();

  return (perfilId: string) => {
    void cliente.invalidateQueries({ queryKey: clavesDeDinero.pagosDe(perfilId) });
    void cliente.invalidateQueries({ queryKey: clavesDeDinero.pagosDe(null) });
    void cliente.invalidateQueries({ queryKey: clavesDeUsuarios.uno(usuarioId) });
  };
}

/**
 * Registra un cobro. ADMIN_OPERATIVO.
 *
 * `gcTime: 0` como todas: las `variables` de esta mutacion son el monto, el
 * metodo y la nota de un cobro concreto de una persona con nombre, y sin el
 * TanStack las conserva cinco minutos en el `QueryClient` unico de la
 * aplicacion —legible desde la consola de la maquina del mostrador— despues de
 * que la pantalla se desmonte.
 */
export function useRegistrarPago(usuarioId: string) {
  const invalidar = useInvalidarElDineroDeUnaPersona(usuarioId);

  return useMutation<PagoPublico, ErrorDeApi, PagoARegistrar>({
    mutationFn: (datos) => pedir<PagoPublico>('/pagos', { metodo: 'POST', cuerpo: datos }),
    onSuccess: (pago) => invalidar(pago.perfilId),
    gcTime: 0,
  });
}

/**
 * Anula un cobro. **ADMIN_SALON**, no ADMIN_OPERATIVO.
 *
 * No es un descuido ni una asimetria que convenga uniformar: lo dice el
 * controller, «registrar un cobro es operativo, deshacerlo es contable». Quien
 * pinte el boton tiene que esconderselo a un ADMIN_OPERATIVO, que SI puede
 * registrar. Un boton que siempre contesta 403 es peor que no estar.
 *
 * El `id` va en las VARIABLES y no en el hook: la pantalla lista N pagos con su
 * boton de anular en cada fila, y un hook por fila seria un hook dentro de un
 * bucle. Mismo criterio que `useBorrarTestimonio` en `use-configuracion`.
 *
 * El `perfilId` para invalidar sale de la RESPUESTA (`PagoPublico.perfilId`) y
 * no de lo que la fila tenia pintado: lo que se invalida es la persona cuyo
 * pago la API dice haber anulado.
 */
export function useAnularPago(usuarioId: string) {
  const invalidar = useInvalidarElDineroDeUnaPersona(usuarioId);

  return useMutation<PagoPublico, ErrorDeApi, string>({
    mutationFn: (id) => pedir<PagoPublico>(`/pagos/${id}/anular`, { metodo: 'PATCH' }),
    onSuccess: (pago) => invalidar(pago.perfilId),
    gcTime: 0,
  });
}

// ---------------------------------------------------------------------------
// Recurso 2: los packs
// ---------------------------------------------------------------------------

/**
 * UN pack por id. **Sin `@Roles`**: cualquier autenticado lo resuelve.
 *
 * El controller lo deja asi a proposito (igual que el de salas) para poder
 * resolver un `packId` suelto —el del perfil de un alumno, p. ej.— sin bajarse
 * el catalogo entero. El service aplica el mismo criterio de visibilidad que el
 * listado: a quien no es personal, un pack de baja le contesta 404 y no un pack
 * con `activo: false`.
 */
export function usePack(id: string) {
  return useQuery({
    queryKey: clavesDeDinero.pack(id),
    queryFn: () => pedir<PackPublico>(`/packs/${id}`),
  });
}

/**
 * Lo que el formulario de un pack manda. `precio` es CADENA o no va.
 *
 * `undefined` en `precio` significa «a consultar», que es un valor con sentido
 * en el contrato (`PackPublico.precio: string | null`) y no un campo sin
 * llenar. `JSON.stringify` borra las claves `undefined`, asi que omitirlo aqui
 * es exactamente mandar el cuerpo sin la clave, que es lo que espera el DTO.
 */
export interface PackAGuardar {
  nombre?: string;
  salaId?: string;
  tipo?: 'MENSUAL' | 'TOTAL';
  /** Cadena con hasta dos decimales, p. ej. `"12500.00"`. NUNCA un number. */
  precio?: string;
  clasesPorMes?: number;
  clasesTotales?: number;
  cancelacionesPermitidas?: number;
  /** Solo en el PATCH: `ActualizarPackDto` lo admite y `CrearPackDto` no. */
  activo?: boolean;
}

/**
 * Las tres escrituras de packs dejan rancio el CATALOGO y el pack tocado.
 *
 * El catalogo (`['packs']`, de `use-catalogos`) porque `usePacks` lista todos,
 * activos e inactivos, y es lo que lee el selector de la ficha. El pack suelto
 * (`['pack', id]`) porque `usePack` es otra consulta contra otra ruta: no cuelga
 * del catalogo y un `['packs']` no lo alcanza.
 *
 * NO se invalidan los usuarios aunque `UsuarioDetalle.pack` lleve un
 * `PackPublico` DENTRO. Renombrar un pack deja rancia cada ficha que lo tenga
 * asignado, y aun asi arrastrar `['usuarios']` detras de cada guardado del
 * catalogo es el refetch-de-todo. Se vuelve a pedir sola cuando el admin abre
 * la ficha.
 */
function useInvalidarUnPack(id: string | null) {
  const cliente = useQueryClient();

  return (pack: PackPublico) => {
    void cliente.invalidateQueries({ queryKey: clavesDeCatalogos.packs() });
    // En el alta no hay id hasta que la API contesta: sale de la respuesta.
    void cliente.invalidateQueries({ queryKey: clavesDeDinero.pack(id ?? pack.id) });
  };
}

/** Crea un pack. ADMIN_SALON. */
export function useCrearPack() {
  const invalidar = useInvalidarUnPack(null);

  return useMutation<PackPublico, ErrorDeApi, PackAGuardar>({
    mutationFn: (datos) => pedir<PackPublico>('/packs', { metodo: 'POST', cuerpo: datos }),
    onSuccess: invalidar,
    gcTime: 0,
  });
}

/** Edita un pack. ADMIN_SALON. El PATCH toca solo lo que trae. */
export function useActualizarPack(id: string) {
  const invalidar = useInvalidarUnPack(id);

  return useMutation<PackPublico, ErrorDeApi, PackAGuardar>({
    mutationFn: (datos) => pedir<PackPublico>(`/packs/${id}`, { metodo: 'PATCH', cuerpo: datos }),
    onSuccess: invalidar,
    gcTime: 0,
  });
}

/**
 * DA DE BAJA un pack. ADMIN_SALON. **No lo borra.**
 *
 * `DELETE /packs/:id` responde `PackPublico` con `activo: false`, no un 204:
 * `PacksService.darDeBaja` hace siempre baja logica, tenga o no perfiles
 * asignados, porque borrarlo de verdad dejaria perfiles apuntando al vacio y
 * haria imposible calcular sus clases pasadas. Si este hook esperara `null`
 * —como los borrados de `use-configuracion`, que SI son 204— la pantalla
 * mostraria un error despues de una baja que ocurrio.
 *
 * Y es IDEMPOTENTE: repetir el DELETE sobre un pack ya de baja devuelve 200 con
 * la misma fila y no escribe en el historial una baja que no ocurrio.
 *
 * El `id` va en el hook y no en las variables porque la baja se dispara desde
 * la pantalla de UN pack, no desde una fila de un listado. Si algun dia se
 * necesita el boton por fila, se mueve a las variables como en
 * `useBorrarTestimonio`.
 */
export function useDarDeBajaPack(id: string) {
  const invalidar = useInvalidarUnPack(id);

  return useMutation<PackPublico, ErrorDeApi, void>({
    mutationFn: () => pedir<PackPublico>(`/packs/${id}`, { metodo: 'DELETE' }),
    onSuccess: invalidar,
    gcTime: 0,
  });
}

// ---------------------------------------------------------------------------
// Recurso 3: la cola de comprobantes
// ---------------------------------------------------------------------------

/**
 * La cola del admin. Ver el bloque de arriba sobre `@Roles('ALUMNO')`.
 *
 * Sin `estado`, todo lo que el service deje ver; con `estado: 'PENDIENTE'`, lo
 * que hay por revisar. El filtro vacio no se manda: `?estado=` seria un estado
 * que no esta en el enum y la respuesta —una lista vacia— se leeria como «no
 * hay nada pendiente», que es la peor forma de equivocarse en esta pantalla.
 */
export function useColaDeComprobantes(estado?: EstadoComprobante) {
  return useQuery({
    queryKey: clavesDeDinero.colaDeComprobantes(estado),
    queryFn: () => pedir<ComprobantePublico[]>(`/comprobantes${queryDeComprobantes(estado)}`),
  });
}

/**
 * Lo que el admin decide al aprobar. NO es un clic.
 *
 * `AprobarComprobanteDto` exige `monto` y `cubreHasta`: el admin esta mirando
 * la foto de la transferencia y es el unico que sabe de cuanto era y hasta
 * cuando vale. `metodo` y `nota` son opcionales, y el defecto del servidor para
 * el metodo es `TRANSFERENCIA` (`dto.metodo ?? 'TRANSFERENCIA'`), que es lo que
 * un comprobante es casi siempre.
 */
export interface AprobacionDeComprobante {
  id: string;
  /** Cadena con hasta dos decimales. NUNCA un number. */
  monto: string;
  /** `YYYY-MM-DD`. */
  cubreHasta: string;
  metodo?: MetodoPago;
  nota?: string;
}

/** Invalida la cola entera: la lista del alumno y todas las colas filtradas. */
function useInvalidarLaCola() {
  const cliente = useQueryClient();
  return () => void cliente.invalidateQueries({ queryKey: claves.comprobantes() });
}

/**
 * APROBAR UN COMPROBANTE ES REGISTRAR UN COBRO, y por eso no invalida solo la
 * cola.
 *
 * `ComprobantesService.aprobar` crea el `Pago` EN LA MISMA TRANSACCION que
 * marca el comprobante como aprobado —con un comentario que explica por que:
 * «si naciera fuera, un fallo entre las dos escrituras dejaria un comprobante
 * aprobado sin cobro registrado, y eso no se descubre hasta cuadrar la caja a
 * fin de mes»—. Del lado del cliente eso significa que aprobar deja rancios
 * los pagos de esa persona exactamente igual que `useRegistrarPago`.
 *
 * ⚠️ La plantilla de esta tarea pedia «aprobar invalida la cola y nada mas».
 * Medido en el service, eso es FALSO: tambien acuña un pago. Se invalidan las
 * dos cosas y «nada mas» queda en su sentido util —no se toca lo que no es
 * suyo: ni los packs, ni la liquidacion, ni los pagos de OTRA persona—.
 *
 * El `perfilId` sale de la RESPUESTA (`ComprobantePublico.perfilId`): el admin
 * aprueba un comprobante, no elige una persona, y el id del perfil no esta en
 * las variables.
 *
 * NO invalida la ficha (`['usuario', id]`): esta pantalla es la cola, no la
 * ficha de nadie, y ahi no hay un `usuarioId` en la mano. El `perfilId` que
 * trae la respuesta es de otra tabla. Es una limitacion conocida, no un olvido.
 *
 * El `id` viaja en las VARIABLES y se quita del cuerpo: la cola tiene N filas
 * con su boton, y un `id` de mas en el cuerpo es un 400 porque la API corre con
 * `forbidNonWhitelisted`. Mismo reparto que `useGuardarPlantilla`.
 */
export function useAprobarComprobante() {
  const cliente = useQueryClient();
  const invalidarLaCola = useInvalidarLaCola();

  return useMutation<ComprobantePublico, ErrorDeApi, AprobacionDeComprobante>({
    mutationFn: ({ id, ...cuerpo }) =>
      pedir<ComprobantePublico>(`/comprobantes/${id}/aprobar`, { metodo: 'PATCH', cuerpo }),
    onSuccess: (comprobante) => {
      invalidarLaCola();
      void cliente.invalidateQueries({
        queryKey: clavesDeDinero.pagosDe(comprobante.perfilId),
      });
      void cliente.invalidateQueries({ queryKey: clavesDeDinero.pagosDe(null) });
    },
    gcTime: 0,
  });
}

/**
 * RECHAZAR NO MUEVE DINERO: solo la cola.
 *
 * Lo dice el DTO: `rechazar` usa `RevisarComprobanteDto`, que solo lleva
 * `nota`, mientras `aprobar` usa el suyo con `monto` y `cubreHasta`. No se crea
 * ningun `Pago`, asi que invalidar los pagos aqui seria un refetch que no
 * corresponde a ningun cambio.
 *
 * Sin `nota`, el cuerpo sale como `{}`: `JSON.stringify` borra las claves
 * `undefined`. La API lo acepta —todos los campos del DTO son opcionales— y el
 * service guarda `dto.nota ?? null`.
 */
export interface RechazoDeComprobante {
  id: string;
  nota?: string;
}

export function useRechazarComprobante() {
  const invalidarLaCola = useInvalidarLaCola();

  return useMutation<ComprobantePublico, ErrorDeApi, RechazoDeComprobante>({
    mutationFn: ({ id, nota }) =>
      pedir<ComprobantePublico>(`/comprobantes/${id}/rechazar`, {
        metodo: 'PATCH',
        cuerpo: { nota },
      }),
    onSuccess: invalidarLaCola,
    gcTime: 0,
  });
}

// ---------------------------------------------------------------------------
// Recurso 4: la liquidacion de una profesora
// ---------------------------------------------------------------------------

/**
 * Lo que se le paga a una profesora en un mes. **ADMIN_SALON**.
 *
 * No ADMIN_OPERATIVO, y el controller dice por que: «esto ensena tarifas».
 * Mismo criterio que `/stats/caja`, el unico reporte de la Fase 6A que tambien
 * pide ADMIN_SALON.
 *
 * SIN MUTACION NINGUNA: la liquidacion se CALCULA, no se guarda. No hay
 * `gcTime: 0` que poner aqui ni invalidacion que escribir, y ninguna escritura
 * de este archivo la invalida: lo que la mueve son las horas y las tarifas
 * —ausencias, horarios, vacaciones—, que viven en otros hooks. Un cobro a un
 * alumno no cambia una liquidacion.
 *
 * ⚠️ Los importes vienen como `Importe` (`{ centavos, texto }`) y NO como la
 * cadena pelada de `PagoPublico.monto`. Ver el bloque de arriba.
 *
 * EL ID SE CODIFICA, y es el unico de este archivo que lo necesita: los demas
 * salen de una respuesta de la API, y este sale del `?profesora=` de la URL de
 * Analisis, que cualquiera puede escribir en un enlace. Sin codificar,
 * `../usuarios` es un segmento de ruta y `fetch` lo resuelve contra el
 * endpoint de al lado.
 */
export function useLiquidacion(profesorId: string, m: Mes) {
  return useQuery({
    queryKey: clavesDeDinero.liquidacion(profesorId, m),
    queryFn: () =>
      pedir<LiquidacionProfesor>(
        `/liquidacion/${encodeURIComponent(profesorId)}${queryDeLiquidacion(m)}`,
      ),
  });
}

/**
 * La liquidacion de quien mira. **PROFESOR**: el perfil sale del token, asi
 * que aqui no viaja id ninguno —ni hay nada que codificar, a diferencia de
 * `useLiquidacion`—.
 */
export function useMiLiquidacion(m: Mes) {
  return useQuery({
    queryKey: clavesDeDinero.miLiquidacion(m),
    queryFn: () => pedir<LiquidacionProfesor>(`/mi-liquidacion${queryDeLiquidacion(m)}`),
  });
}
