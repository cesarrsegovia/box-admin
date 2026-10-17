'use client';

import { useQuery } from '@tanstack/react-query';
import type {
  CajaDelMes,
  ComposicionAlumnos,
  Operativo,
  PagoPendiente,
  ReporteAsistencia,
  ReporteTurnosLibres,
} from '@boxadmin/shared';
import { pedir } from '@/lib/cliente';

/**
 * Los seis reportes de la Fase 6A, que hasta hoy solo se leian con un `curl`.
 *
 * LAS SEIS RUTAS SALEN DEL `@Controller('stats')` de
 * `apps/api/src/stats/stats.controller.ts`, verificadas una por una: `caja`,
 * `operativo`, `composicion-alumnos`, `asistencia`, `pagos-pendientes` y
 * `turnos-libres`. Ninguna se dedujo del nombre del modulo.
 *
 * SON SEIS CONSULTAS Y NINGUNA MUTACION. No hay invalidacion que escribir ni
 * `gcTime: 0` que poner: nada de esto escribe en la API.
 *
 * LOS ROLES NO LOS DECIDE ESTE ARCHIVO, pero conviene tenerlos a mano porque
 * deciden en que pantalla puede montarse cada hook: `/stats/caja` pide
 * **ADMIN_SALON** —es el unico— y los otros cinco **ADMIN_OPERATIVO**. El
 * criterio viene de la 5A: registrar un cobro es operativo, mirar el margen
 * del salon no lo es.
 *
 * LA ASIMETRIA DEL `salaId` ES DELIBERADA Y NO SE UNIFORMA. `operativo` y
 * `turnos-libres` lo aceptan porque un `Turno` tiene sala propia; `caja` y
 * `composicion-alumnos` comparten `ConsultaMensualDto`, que no lo tiene, y con
 * `forbidNonWhitelisted` mandarlo es un 400. Viene de un bug real:
 * `/stats/caja?salaId=` validaba la sala y devolvia los numeros de TODAS —una
 * mentira con codigo 200—. Y `pagos-pendientes` no lleva ningun parametro, por
 * lo mismo: estar al dia es una propiedad del alumno, no de una sala.
 *
 * NINGUN REPORTE LLEVA `tenantId`: el service lo saca del token. Un
 * `?tenantId=` seria la unica forma de ver los numeros de otro gimnasio, y por
 * eso no existe.
 */

/** Los tres reportes que se piden por mes calendario. */
export interface Mes {
  anio: number;
  mes: number;
}

export interface RangoDeAsistencia {
  desde: string;
  hasta: string;
  perfilId?: string;
}

/**
 * Un opcional de la pantalla, visto como lo ve la peticion.
 *
 * Una cadena vacia es lo que manda un `<select>` en "todas las salas", y para
 * la API no es "sin filtro" sino un id vacio. Aqui se vuelve `null` UNA vez y
 * el mismo resultado gobierna las dos cosas que tienen que coincidir: si el
 * parametro viaja y bajo que clave se guarda. Si la clave distinguiera `''` de
 * `undefined` —dos peticiones identicas— la misma respuesta quedaria cacheada
 * dos veces, y una invalidacion dirigida alcanzaria a una sola.
 */
function sinVacio(valor: string | undefined): string | null {
  return valor === undefined || valor === '' ? null : valor;
}

/** Las claves, en un solo sitio, como en `use-turnos` y `use-horarios`. */
export const clavesDeStats = {
  caja: (m: Mes) => ['stats', 'caja', m] as const,
  operativo: (m: Mes, salaId?: string) => ['stats', 'operativo', m, sinVacio(salaId)] as const,
  composicion: (m: Mes) => ['stats', 'composicion', m] as const,
  asistencia: (r: RangoDeAsistencia) =>
    ['stats', 'asistencia', r.desde, r.hasta, sinVacio(r.perfilId)] as const,
  pagosPendientes: () => ['stats', 'pagos-pendientes'] as const,
  turnosLibres: (salaId?: string, mesesAdelante?: number) =>
    ['stats', 'turnos-libres', sinVacio(salaId), mesesAdelante ?? null] as const,
};

/**
 * EL MES VIAJA SIEMPRE, y esto NO es el patron de las fases 9 y 10.
 *
 * Alli una cadena vacia se omitia porque los filtros eran opcionales. Aqui
 * `ConsultaMensualDto` exige `anio` y `mes`: omitir uno no pide "todos los
 * meses", es un 400.
 *
 * Y SE MANDA TAL CUAL LLEGO, sin mirar si es "razonable". Un `mes: 0` no
 * existe y la API lo rechaza con un 400 que dice por que; una rama `if (m.mes)`
 * o un `m.mes || ...` lo borraria del query y la pantalla pediria —y
 * mostraria— un mes distinto del que le pidieron, sin un solo error por
 * delante. El sitio donde se decide que mes es valido es el DTO, no esto.
 */
function partesDelMes(m: Mes): URLSearchParams {
  const partes = new URLSearchParams();
  partes.set('anio', String(m.anio));
  partes.set('mes', String(m.mes));
  return partes;
}

export function queryDeMes(m: Mes): string {
  return `?${partesDelMes(m).toString()}`;
}

/** El mes, y la sala solo si tiene valor. */
export function queryDeOperativo(m: Mes, salaId?: string): string {
  const partes = partesDelMes(m);
  const sala = sinVacio(salaId);
  if (sala !== null) partes.set('salaId', sala);
  return `?${partes.toString()}`;
}

/**
 * El rango entero, y el perfil solo si tiene valor.
 *
 * `desde` y `hasta` son obligatorios en `ConsultaRangoDto`, asi que van
 * siempre, igual que el mes. El `perfilId` es el opcional de verdad: mandarlo
 * vacio seria pedir la asistencia de un alumno cuyo id es la cadena vacia, y
 * la respuesta —un reporte sin alumnos— se lee como "este alumno no vino
 * nunca".
 */
export function queryDeAsistencia(r: RangoDeAsistencia): string {
  const partes = new URLSearchParams();
  partes.set('desde', r.desde);
  partes.set('hasta', r.hasta);
  const perfil = sinVacio(r.perfilId);
  if (perfil !== null) partes.set('perfilId', perfil);
  return `?${partes.toString()}`;
}

/**
 * Los dos opcionales de los turnos libres, y nada mas.
 *
 * `mesesAdelante` se compara contra `undefined` y NO por verdadero/falso: un
 * `0` es invalido —`@Min(1)` en el DTO— y tiene que llegar para que la API
 * conteste 400. Borrarlo aqui convertiria ese error en la respuesta por
 * defecto del service, que mira varios meses: quien pidio cero leeria una
 * lista llena creyendo que es la de su pedido.
 */
export function queryDeTurnosLibres(salaId?: string, mesesAdelante?: number): string {
  const partes = new URLSearchParams();
  const sala = sinVacio(salaId);
  if (sala !== null) partes.set('salaId', sala);
  if (mesesAdelante !== undefined) partes.set('mesesAdelante', String(mesesAdelante));

  const texto = partes.toString();
  return texto === '' ? '' : `?${texto}`;
}

/** La caja del mes. ADMIN_SALON: es el unico reporte con el margen dentro. */
export function useCaja(m: Mes) {
  return useQuery({
    queryKey: clavesDeStats.caja(m),
    queryFn: () => pedir<CajaDelMes>(`/stats/caja${queryDeMes(m)}`),
  });
}

/** Las cinco metricas del mes y los tres anteriores, opcionalmente por sala. */
export function useOperativo(m: Mes, salaId?: string) {
  return useQuery({
    queryKey: clavesDeStats.operativo(m, salaId),
    queryFn: () => pedir<Operativo>(`/stats/operativo${queryDeOperativo(m, salaId)}`),
  });
}

/** Alumnos por pack y consumo del mes. Sin `salaId`: un alumno esta en UN pack. */
export function useComposicionAlumnos(m: Mes) {
  return useQuery({
    queryKey: clavesDeStats.composicion(m),
    queryFn: () => pedir<ComposicionAlumnos>(`/stats/composicion-alumnos${queryDeMes(m)}`),
  });
}

/** El unico reporte que no se pide por mes, sino por un rango libre. */
export function useAsistencia(r: RangoDeAsistencia) {
  return useQuery({
    queryKey: clavesDeStats.asistencia(r),
    queryFn: () => pedir<ReporteAsistencia>(`/stats/asistencia${queryDeAsistencia(r)}`),
  });
}

/**
 * A quien hay que llamar hoy. SIN UN SOLO PARAMETRO, y eso es la funcionalidad.
 *
 * `ConsultaPagosPendientesDto` esta vacio a proposito para que el
 * ValidationPipe conteste 400 ante un `?salaId=` en vez de ignorarlo en
 * silencio. Agregarle un filtro a este hook es romper esa decision desde el
 * otro lado del cable.
 */
export function usePagosPendientes() {
  return useQuery({
    queryKey: clavesDeStats.pagosPendientes(),
    queryFn: () => pedir<PagoPendiente[]>('/stats/pagos-pendientes'),
  });
}

/**
 * Donde hay lugar de aqui a unos meses.
 *
 * `mesesAdelante` no tiene techo en el DTO sino en el service, que recorta y
 * contesta: la respuesta trae los meses MIRADOS DE VERDAD, que pueden ser
 * menos que los pedidos. Ese numero lo pinta la pantalla desde la respuesta y
 * NO desde el argumento que mando: son dos valores distintos.
 */
export function useTurnosLibres(salaId?: string, mesesAdelante?: number) {
  return useQuery({
    queryKey: clavesDeStats.turnosLibres(salaId, mesesAdelante),
    queryFn: () =>
      pedir<ReporteTurnosLibres>(
        `/stats/turnos-libres${queryDeTurnosLibres(salaId, mesesAdelante)}`,
      ),
  });
}
