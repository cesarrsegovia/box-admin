'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { FiltrosDeTurnos } from '@/hooks/use-turnos';
import { useSalas } from '@/hooks/use-catalogos';
import { useUsuarios } from '@/hooks/use-usuarios';

/**
 * `YYYY-MM-DD` Y ADEMAS una fecha que existe.
 *
 * El patron solo no alcanza: `2026-02-31` lo pasa y la API lo rechaza con un
 * 400. Se reconstruye la fecha y se compara con lo escrito, que es la unica
 * forma de distinguir el 31 de febrero del 28.
 *
 * La URL la escribe cualquiera: un `?desde=ayer` sin esto es un 400 y una
 * pantalla en blanco que no explica nada.
 */
function fechaDeLaUrl(valor: string | null): string | undefined {
  if (valor === null || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return undefined;

  const fecha = new Date(`${valor}T00:00:00Z`);
  if (Number.isNaN(fecha.getTime())) return undefined;

  return fecha.toISOString().slice(0, 10) === valor ? valor : undefined;
}

/**
 * `"true"`/`"false"` y nada mas.
 *
 * Cualquier otra cosa es ausencia de filtro, no `false`: `?soloLibres=quiza`
 * convertido en `soloLibres=false` le enseñaria al admin una lista distinta de
 * la que pidio, y convertido en `soloLibres=` seria un 400 del `ParseBoolPipe`.
 *
 * Y `false` NO es ausencia: es "mostrame tambien los llenos", un filtro con
 * valor. Por eso esta funcion devuelve `boolean | undefined` y no un booleano a
 * secas, y por eso quien la llama pregunta por `undefined` y no por la verdad.
 */
function booleanoDeLaUrl(valor: string | null): boolean | undefined {
  if (valor === 'true') return true;
  if (valor === 'false') return false;
  return undefined;
}

/**
 * Un identificador con algo dentro, o nada.
 *
 * No se valida contra el catalogo a proposito: las salas y las profesoras
 * llegan por red y tarde, y rechazar un id mientras el catalogo viaja dejaria
 * el filtro de la URL sin efecto en el primer pintado y con efecto en el
 * segundo. Un id que no existe devuelve una lista vacia, que es un resultado
 * honesto; un `?salaId=` vacio seria un 400, y ese si se corta aqui.
 */
function identificadorDeLaUrl(valor: string | null): string | undefined {
  if (valor === null || valor.trim() === '') return undefined;
  return valor;
}

/**
 * LA URL ES LA FUENTE DE VERDAD DE LOS FILTROS.
 *
 * Se exporta porque la pantalla la usa para armar la consulta y el spec la usa
 * para saber con que clave sembrar la cache: que las dos cosas salgan de la
 * MISMA funcion es lo que impide que un test pase con una lectura equivocada.
 *
 * Lo que no reconoce NO se devuelve. Un filtro ausente no es lo mismo que un
 * filtro vacio: `queryDeTurnos` manda `soloLibres=false` pero no manda
 * `soloLibres=`.
 */
export function filtrosDeLaBusqueda(parametros: URLSearchParams): FiltrosDeTurnos {
  const filtros: FiltrosDeTurnos = {};

  const desde = fechaDeLaUrl(parametros.get('desde'));
  if (desde !== undefined) filtros.desde = desde;

  const hasta = fechaDeLaUrl(parametros.get('hasta'));
  if (hasta !== undefined) filtros.hasta = hasta;

  const salaId = identificadorDeLaUrl(parametros.get('salaId'));
  if (salaId !== undefined) filtros.salaId = salaId;

  const soloLibres = booleanoDeLaUrl(parametros.get('soloLibres'));
  if (soloLibres !== undefined) filtros.soloLibres = soloLibres;

  const profesorId = identificadorDeLaUrl(parametros.get('profesorId'));
  if (profesorId !== undefined) filtros.profesorId = profesorId;

  return filtros;
}

/** El valor que le toca a un control, sacado de los filtros YA validados. */
function valorDelControl(filtros: FiltrosDeTurnos, clave: keyof FiltrosDeTurnos): string {
  const valor = filtros[clave];
  return valor === undefined ? '' : String(valor);
}

const CLASES_DE_CONTROL =
  'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900';

/**
 * Las opciones del filtro de lugar, con sus TRES estados escritos.
 *
 * `''` no es lo mismo que `false`: el primero no manda el parametro y el
 * segundo manda `soloLibres=false`. Hoy la API devuelve lo mismo para los dos,
 * pero son dos peticiones distintas y la que el admin eligio es la que tiene
 * que salir: el dia que "incluir los llenos" signifique algo mas que el
 * silencio, la pantalla ya lo esta diciendo.
 */
const OPCIONES_DE_LUGAR: readonly { valor: string; texto: string }[] = [
  { valor: '', texto: 'Sin filtrar' },
  { valor: 'true', texto: 'Solo los que tienen lugar' },
  { valor: 'false', texto: 'Tambien los llenos' },
];

/**
 * LOS FILTROS ESCRIBEN LA URL, NUNCA `useState`.
 *
 * Un filtro en la URL se comparte por chat ("mira, estos son los turnos vacios
 * del jueves") y sobrevive al boton de atras. En estado se pierde al navegar y
 * nadie entiende por que, y encima la pantalla y la barra de direcciones dicen
 * cosas distintas.
 *
 * El catalogo de salas y el de profesoras los pide ESTE componente, que es
 * quien los dibuja. La tabla necesita ademas el de salas para la columna, y por
 * eso vuelve a llamar a `useSalas`: la clave es la misma, asi que es UNA sola
 * peticion y no dos. Hay un test que fija la lista entera de lo que se pide.
 */
export function FiltrosDelListado() {
  const parametros = useSearchParams();
  const ruta = usePathname();
  const router = useRouter();
  const { data: salas } = useSalas();
  const { data: profesoras } = useUsuarios({ tipo: 'profesor' });

  const filtros = filtrosDeLaBusqueda(parametros);

  /**
   * Escribe la URL partiendo de la que YA HAY.
   *
   * Cambiar un filtro no puede borrar los otros cuatro ni lo que la URL lleve
   * por su cuenta. Un valor vacio SACA la clave en vez de mandarla vacia.
   */
  function cambiar(clave: string, valor: string): void {
    const siguientes = new URLSearchParams(parametros.toString());

    if (valor === '') siguientes.delete(clave);
    else siguientes.set(clave, valor);

    const texto = siguientes.toString();

    // UNA sola navegacion por cambio. Un `push` de cortesia antes del bueno
    // deja una entrada basura en el historial y un parpadeo en la pantalla.
    router.push(texto === '' ? ruta : `${ruta}?${texto}`);
  }

  return (
    <form className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        {/* `htmlFor` y no una etiqueta que envuelva al control: envolviendolo,
            el nombre accesible se lleva por delante el texto de las opciones. */}
        <label htmlFor="turnos-desde" className="text-xs font-medium text-slate-600">
          Desde
        </label>
        <input
          id="turnos-desde"
          type="date"
          value={valorDelControl(filtros, 'desde')}
          onChange={(evento) => cambiar('desde', evento.target.value)}
          className={CLASES_DE_CONTROL}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="turnos-hasta" className="text-xs font-medium text-slate-600">
          Hasta
        </label>
        <input
          id="turnos-hasta"
          type="date"
          value={valorDelControl(filtros, 'hasta')}
          onChange={(evento) => cambiar('hasta', evento.target.value)}
          className={CLASES_DE_CONTROL}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="turnos-sala" className="text-xs font-medium text-slate-600">
          Sala
        </label>
        <select
          id="turnos-sala"
          value={valorDelControl(filtros, 'salaId')}
          onChange={(evento) => cambiar('salaId', evento.target.value)}
          className={CLASES_DE_CONTROL}
        >
          <option value="">Todas</option>
          {(salas ?? []).map((sala) => (
            // Del catalogo solo salen el id y el nombre. `SalaPublica` trae
            // ademas el `tenantId`, y ese es justo el dato que la Fase 0 se
            // ocupo de que no cruzara entre gimnasios.
            <option key={sala.id} value={sala.id}>
              {sala.nombre}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="turnos-profesora" className="text-xs font-medium text-slate-600">
          Profesora
        </label>
        <select
          id="turnos-profesora"
          value={valorDelControl(filtros, 'profesorId')}
          onChange={(evento) => cambiar('profesorId', evento.target.value)}
          className={CLASES_DE_CONTROL}
        >
          <option value="">Todas</option>
          {(profesoras ?? []).map((profesora) => (
            // EL `perfilId`, NO EL `id` DEL USUARIO. `Turno.profesorId`
            // referencia a `Perfil` —`profesor Perfil? @relation(fields:
            // [tenantId, profesorId], references: [tenantId, id])`—, asi que la
            // API compara `where.profesorId` contra un `perfilId`. Mandar el id
            // del usuario no da error: devuelve CERO turnos, que parece un
            // resultado legitimo y no lo es. `useUsuarios` trae los dos campos
            // justamente porque son dos espacios de id distintos.
            <option key={profesora.perfilId} value={profesora.perfilId}>
              {profesora.nombreCompleto}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="turnos-lugar" className="text-xs font-medium text-slate-600">
          Lugar
        </label>
        <select
          id="turnos-lugar"
          value={valorDelControl(filtros, 'soloLibres')}
          onChange={(evento) => cambiar('soloLibres', evento.target.value)}
          className={CLASES_DE_CONTROL}
        >
          {OPCIONES_DE_LUGAR.map((opcion) => (
            <option key={opcion.valor} value={opcion.valor}>
              {opcion.texto}
            </option>
          ))}
        </select>
      </div>
    </form>
  );
}
