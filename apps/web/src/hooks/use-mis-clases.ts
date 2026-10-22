'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AlumnoEnClase, ClaseDelProfesor } from '@boxadmin/shared';
import { type ErrorDeApi, pedir } from '@/lib/cliente';

/**
 * LA VISTA DE LA PROFESORA: SU AGENDA, SU CLASE Y PASAR LISTA.
 *
 * LAS TRES RUTAS SALEN DEL `@Controller('mis-clases')` de
 * `apps/api/src/mis-clases/mis-clases.controller.ts`, leidas una por una y no
 * deducidas del nombre del modulo:
 *
 *  - `GET /mis-clases?desde=&hasta=` → `ClaseDelProfesor[]`
 *  - `GET /mis-clases/:turnoId/alumnos` → `AlumnoEnClase[]`
 *  - `POST /mis-clases/:turnoId/asistencia` → `AlumnoEnClase[]`
 *
 * LAS TRES PIDEN `PROFESOR`, comprobado decorador por decorador: los tres
 * metodos llevan `@Roles('PROFESOR')` y no hay ninguno de admin. Y ninguna
 * lleva `profesorId`: el service lo saca del token y resuelve el perfil del
 * actor (`perfilDelActor`). Un `?profesorId=` seria la unica forma de mirar la
 * agenda de otra profesora, y por eso no existe.
 *
 * ESTE ARCHIVO ES EL UNICO SITIO DE TODO EL SISTEMA QUE PUEDE ESCRIBIR
 * `asistio: false`. El check-in por QR escribe `asistio: true` y nunca otra
 * cosa, asi que hasta que esta pantalla exista no hay un solo alumno marcado
 * ausente en ningun gimnasio, y el reporte de asistencia de la Fase 11 cuenta
 * ausentes que solo pueden ser cero. No es una pantalla mas: es la que deja de
 * hacer mentir a una que ya esta entregada.
 *
 * EL `POST` SI DEVUELVE CUERPO, y util: `pasarLista` del service termina con
 * `listaDeAlumnos(...)` y el controller lo declara `Promise<AlumnoEnClase[]>`.
 * O sea que la lista ya marcada vuelve en la respuesta. No es un 204 como los
 * borrados de la Fase 10.
 *
 * SON DOS LECTURAS Y UNA ESCRITURA. La escritura es la unica que lleva
 * `gcTime: 0` y la unica que invalida.
 */

/** El rango de la agenda. Los dos extremos, `YYYY-MM-DD`. */
export interface RangoDeClases {
  desde: string;
  hasta: string;
}

/**
 * LAS CLAVES, Y SU FORMA NO ES COSMETICA.
 *
 * La agenda y los alumnos cuelgan de `mis-clases` pero por RAMAS DISTINTAS
 * (`'agenda'` y `'alumnos'`), y eso es lo que hace posible la invalidacion
 * dirigida de mas abajo. React Query empareja por PREFIJO de array: si los
 * alumnos vivieran en `['mis-clases', turnoId, 'alumnos']`, invalidar la
 * agenda —que son N rangos distintos y hay que alcanzarlos a todos, o sea
 * `['mis-clases']` a secas— arrastraria de paso los alumnos de TODAS las
 * clases abiertas. Con las dos ramas separadas, `['mis-clases', 'agenda']`
 * alcanza los rangos que haga falta y no toca ni un alumno.
 *
 * El `turnoId` va DENTRO de la clave de alumnos, y no en una clave unica para
 * "la clase abierta": la profesora abre una clase, vuelve, abre otra, y las
 * dos listas son datos distintos. Con una sola clave la segunda clase
 * mostraria los alumnos de la primera hasta que el refetch volviera.
 */
export const clavesDeMisClases = {
  agenda: (r: RangoDeClases) => ['mis-clases', 'agenda', r.desde, r.hasta] as const,
  alumnos: (turnoId: string) => ['mis-clases', 'alumnos', turnoId] as const,
};

/**
 * EL RANGO VIAJA SIEMPRE Y TAL CUAL LLEGO.
 *
 * `desde` y `hasta` NO los valida un DTO: los valida A MANO el controller, en
 * `exigirRango` (`mis-clases.controller.ts`), con dos mensajes propios que la
 * pantalla va a tener que pintar:
 *
 *  - `'desde y hasta son obligatorios, con formato YYYY-MM-DD'`
 *  - `'desde no puede ser posterior a hasta'`
 *
 * Los dos estan copiados de la fuente, no de memoria.
 *
 * Por eso NO se omite un extremo vacio, que es justo lo contrario del patron
 * de las fases 9 y 10 —alli una cadena vacia era "sin filtro" y se quitaba—.
 * Aqui omitirlo no pide "todas las fechas": el comentario del propio
 * `exigirRango` lo dice —sin la comprobacion, un `desde` vacio se vuelve
 * `Invalid Date` y Prisma devuelve el historial entero de la profesora—. Si el
 * hook borrara el extremo vacio, el 400 que explica que falta no llegaria
 * nunca y la pantalla mostraria un rango que nadie pidio.
 *
 * Tampoco se juzga aqui si el rango es "razonable": un `desde` posterior a
 * `hasta` SE MANDA, para que la API conteste su segundo mensaje. El sitio
 * donde se decide que rango es valido es el controller, no esto.
 */
export function queryDeMisClases(r: RangoDeClases): string {
  const partes = new URLSearchParams();
  partes.set('desde', r.desde);
  partes.set('hasta', r.hasta);
  return `?${partes.toString()}`;
}

/** La agenda de la profesora en un rango de fechas. */
export function useMisClases(r: RangoDeClases) {
  return useQuery({
    queryKey: clavesDeMisClases.agenda(r),
    queryFn: () => pedir<ClaseDelProfesor[]>(`/mis-clases${queryDeMisClases(r)}`),
  });
}

/**
 * Los alumnos de UNA clase: nombre y si vino.
 *
 * `enabled` porque la pantalla nace sin clase elegida, y un `turnoId` vacio
 * pediria `/mis-clases//alumnos`, que no empareja con ninguna ruta y vuelve
 * 404. La profesora veria un error rojo antes de haber tocado nada. Mismo
 * criterio que `use-calendario-admin`.
 */
export function useAlumnosDeLaClase(turnoId: string) {
  return useQuery({
    queryKey: clavesDeMisClases.alumnos(turnoId),
    queryFn: () => pedir<AlumnoEnClase[]>(`/mis-clases/${turnoId}/alumnos`),
    enabled: turnoId !== '',
  });
}

/**
 * PASAR LISTA. ES UNA FOTO DE LA CLASE ENTERA, NO UN INCREMENTO.
 *
 * El cuerpo es `{ presentes: string[] }` Y NADA MAS —`PasarListaDto` declara
 * ese unico campo y la API corre con `forbidNonWhitelisted`: un `turnoId` de
 * adorno dentro del cuerpo convierte una lista valida en un 400—. El `turnoId`
 * va en la URL, que es donde el controller lo lee (`@Param`).
 *
 * LA LISTA VACIA SE MANDA VACIA. `presentes: []` es legitimo y significa "no
 * vino nadie": el service tiene una rama explicita para ese caso —marca
 * `asistio: false` a todas las reservas activas sin generar un `notIn: []`, que
 * distintas versiones de Prisma han resuelto de formas distintas—. Omitir la
 * clave no seria "lo mismo pero mas corto": seria un 400 de `@IsArray()` sobre
 * un `undefined`, y nadie sabria por que, porque la profesora SI hizo algo
 * —marcar a todos como ausentes— y la pantalla le diria que mando mal el
 * formulario.
 *
 * Los `string[]` son `perfilId`, no `usuarioId`: `AlumnoEnClase.perfilId` es lo
 * que devuelve la lectura y es contra `reserva.perfilId` que el service los
 * cruza. Mandar el id del usuario haria que CADA uno cayera en la rama de los
 * intrusos y la API contestaria nombrandolos todos.
 *
 * DOS RECHAZOS MAS QUE ESTE HOOK NO INTENTA ADIVINAR y que la pantalla tiene
 * que saber pintar, porque llegan como `ErrorDeApi` con su texto:
 *
 *  - una clase que todavia no empezo: `'Esa clase todavia no empezo'` (hacia
 *    atras no hay limite: quien se olvido tres semanas puede ponerse al dia);
 *  - un id sin reserva activa: `'No tienen reserva activa en esta clase: ...'`,
 *    que NOMBRA los intrusos. Sin esa comprobacion un id equivocado marcaria
 *    ausente a media clase en silencio.
 *
 * El `turnoId` va en el HOOK y los presentes en las VARIABLES: la pantalla de
 * pasar lista es la de UNA clase, y el boton se pulsa una vez con la lista
 * entera. Es lo contrario de los borrados de `use-configuracion`, donde el id
 * va en las variables porque hay N filas con N botones.
 *
 * `gcTime: 0` como todas las mutaciones del repo, y aqui no es higiene: lo que
 * queda en `variables` es la lista de quienes vinieron, y lo que queda en
 * `data` es la lista entera con el NOMBRE PROPIO y la AUSENCIA de cada alumno.
 * Sin
 * el, TanStack lo conserva CINCO MINUTOS en un `QueryClient` que dura lo que
 * dura la pestaña del movil de la profesora. El barrido de
 * `src/hooks/mutaciones-sin-gctime.spec.ts` lo exige para el directorio entero.
 */
export function usePasarLista(turnoId: string) {
  const cliente = useQueryClient();

  return useMutation<AlumnoEnClase[], ErrorDeApi, string[]>({
    mutationFn: (presentes) =>
      pedir<AlumnoEnClase[]>(`/mis-clases/${turnoId}/asistencia`, {
        metodo: 'POST',
        cuerpo: { presentes },
      }),
    onSuccess: () => {
      // DOS CLAVES, Y NI UNA MAS. Nada de `invalidateQueries()` pelado: con un
      // solo consumidor del `QueryClient` eso es indistinguible de esto, y en
      // el movil de la profesora marcaria rancia toda consulta abierta. Ver el
      // bloque de `src/test/consulta-ajena.ts`.

      // 1. Los alumnos de ESTA clase, que acaban de cambiar de `null` a
      //    `true`/`false`. Los de otra clase abierta no se tocan: su lista no
      //    cambio.
      void cliente.invalidateQueries({ queryKey: clavesDeMisClases.alumnos(turnoId) });

      // 2. La agenda, TODOS LOS RANGOS. `ClaseDelProfesor.listaPasada` sale de
      //    `reservas.some(r => r.asistio !== null)`, asi que la fila de esta
      //    clase acaba de cambiar; y la agenda es quien va a contar cuantos
      //    quedan sin marcar. Se invalida la rama entera y no un rango
      //    concreto porque este hook NO SABE que rangos hay cacheados: la
      //    pantalla de la clase no recibe el rango de la agenda que la trajo, y
      //    una clase del 3 de octubre vive en cualquier rango que la contenga
      //    —la semana, el mes, "los ultimos 30 dias"—. Invalidar solo el rango
      //    que este hook pudiera imaginarse dejaria a los demas mostrando
      //    `listaPasada: false` sobre una clase que ya se paso.
      void cliente.invalidateQueries({ queryKey: ['mis-clases', 'agenda'] });

      // LA RESPUESTA NO SE ESCRIBE EN LA CACHE con `setQueryData`, aunque el
      // `POST` devuelva la lista ya marcada. Seria pintarla dos veces —la
      // escrita a mano y la que trae el refetch que acaba de pedirse— y la
      // unica autoridad es la segunda. Quien quiera la respuesta inmediata la
      // tiene en `data` de la propia mutacion.
    },
    gcTime: 0,
  });
}
