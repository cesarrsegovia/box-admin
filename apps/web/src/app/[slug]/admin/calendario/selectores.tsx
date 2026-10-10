'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { MesElegido } from '@/hooks/use-calendario-admin';
import { useSalas } from '@/hooks/use-catalogos';
import type { MesOfrecido } from './meses';

/**
 * Los meses en castellano, escritos y no formateados.
 *
 * `Intl.DateTimeFormat` daria el nombre segun la configuracion regional de la
 * maquina: el mismo enlace compartido diria "November" en la computadora del
 * mostrador si alguien le cambio el idioma al sistema, y el test que fija los
 * textos pasaria o fallaria segun donde corra.
 */
const NOMBRES_DE_MES: readonly string[] = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/** Lo que el mes vale EN LA URL. Las dos partes van juntas o no van. */
function valorDelMes(mes: MesOfrecido): string {
  return `${mes.anio}-${mes.mes}`;
}

function textoDelMes(mes: MesOfrecido): string {
  return `${NOMBRES_DE_MES[mes.mes - 1] ?? String(mes.mes)} ${mes.anio}`;
}

/**
 * Un entero, o nada.
 *
 * `Number('')` es 0 y `Number(' 11 ')` es 11: la conversion directa acepta
 * cosas que la ruta de la API no acepta. Y `parseInt('11.5')` es 11, que
 * convertiria un parametro roto en uno valido en silencio.
 */
function enteroDeLaUrl(valor: string | null): number | null {
  if (valor === null || !/^-?\d+$/.test(valor)) return null;
  return Number(valor);
}

/**
 * EL MES QUE DICE LA URL, validado contra lo que el selector puede ofrecer.
 *
 * No alcanza con que `mes` este entre 1 y 12: un mes pasado la API lo rechaza
 * con 400, y un mes a tres anos vista no esta en la lista. Se valida por
 * PERTENENCIA a `ofrecidos` —la misma lista con la que se dibujan las
 * opciones— y asi no hay forma de que la URL admita algo que el selector no
 * ofrece, ni al reves.
 *
 * La URL la escribe cualquiera: `?mes=13` sin esto es un 400 y una pantalla en
 * blanco que no explica nada.
 */
export function mesDeLaBusqueda(
  parametros: URLSearchParams,
  ofrecidos: readonly MesOfrecido[],
): MesOfrecido | null {
  const anio = enteroDeLaUrl(parametros.get('anio'));
  const mes = enteroDeLaUrl(parametros.get('mes'));

  if (anio === null || mes === null) return null;

  return ofrecidos.find((cada) => cada.anio === anio && cada.mes === mes) ?? null;
}

/** La sala que dice la URL, o `''` cuando no dice ninguna. */
export function salaDeLaBusqueda(parametros: URLSearchParams): string {
  return parametros.get('salaId') ?? '';
}

/**
 * Los tres parametros juntos, que es lo unico que los hooks aceptan.
 *
 * `null` mientras falte alguno: `usePlanDelMes(null)` y `useMesDelCalendario(null)`
 * no piden nada, que es exactamente lo que tiene que pasar con media eleccion.
 */
export function mesElegidoDeLaBusqueda(
  parametros: URLSearchParams,
  ofrecidos: readonly MesOfrecido[],
): MesElegido | null {
  const salaId = salaDeLaBusqueda(parametros);
  if (salaId === '') return null;

  const mes = mesDeLaBusqueda(parametros, ofrecidos);
  if (mes === null) return null;

  return { salaId, anio: mes.anio, mes: mes.mes };
}

const CLASES_DE_SELECT =
  'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900';

/**
 * LA SALA Y EL MES VIAJAN EN LA URL, nunca en `useState`.
 *
 * No hay asistente con memoria porque no hace falta: `previsualizar` es de solo
 * lectura y funcion pura de (sala, anio, mes), asi que el servidor ya tiene
 * todo el estado. En la URL, recargar, compartir el enlace y volver con el
 * boton de atras dan exactamente lo mismo. En estado, el filtro se pierde al
 * navegar, la barra de direcciones y la pantalla dicen cosas distintas, y el
 * enlace que el admin manda por chat abre vacio del otro lado.
 */
export function SelectoresDelCalendario({ ofrecidos }: { ofrecidos: readonly MesOfrecido[] }) {
  const parametros = useSearchParams();
  const ruta = usePathname();
  const router = useRouter();
  const { data: salas } = useSalas();

  const mes = mesDeLaBusqueda(parametros, ofrecidos);

  /**
   * Escribe la URL partiendo de la que YA HAY.
   *
   * Cambiar la sala no puede borrar el mes ni al reves, y tampoco lo que la URL
   * lleve por su cuenta. Un valor vacio SACA la clave en vez de mandarla vacia:
   * `?salaId=` no es "sin sala", es una ruta `/calendario//2026/11`.
   */
  function cambiar(cambios: readonly (readonly [string, string])[]): void {
    const siguientes = new URLSearchParams(parametros.toString());

    for (const [clave, valor] of cambios) {
      if (valor === '') siguientes.delete(clave);
      else siguientes.set(clave, valor);
    }

    const texto = siguientes.toString();

    // UNA sola navegacion por cambio. Un `push` de cortesia antes del bueno
    // deja una entrada basura en el historial y el boton de atras deja de
    // llevar a donde la persona estaba.
    router.push(texto === '' ? ruta : `${ruta}?${texto}`);
  }

  /** El valor del selector de meses vuelve a salir de la URL, no de un estado. */
  function cambiarElMes(valor: string): void {
    const elegido = ofrecidos.find((cada) => valorDelMes(cada) === valor);

    if (elegido === undefined) {
      cambiar([
        ['anio', ''],
        ['mes', ''],
      ]);
      return;
    }

    cambiar([
      ['anio', String(elegido.anio)],
      ['mes', String(elegido.mes)],
    ]);
  }

  return (
    <form className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        {/* `htmlFor` y no una etiqueta que envuelva al select: envolviendolo, el
            nombre accesible se lleva por delante el texto de las opciones. */}
        <label htmlFor="calendario-sala" className="text-xs font-medium text-slate-600">
          Sala
        </label>
        <select
          id="calendario-sala"
          value={salaDeLaBusqueda(parametros)}
          onChange={(evento) => cambiar([['salaId', evento.target.value]])}
          className={CLASES_DE_SELECT}
        >
          <option value="">Elegi una sala</option>
          {(salas ?? []).map((sala) => (
            // Del catalogo solo salen el id y el nombre. `SalaPublica` trae
            // ademas el `tenantId`, y ese es justo el dato que la Fase 0 se
            // ocupo de que no cruzara entre gimnasios: no tiene nada que hacer
            // en el DOM de un `<option>`.
            <option key={sala.id} value={sala.id}>
              {sala.nombre}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="calendario-mes" className="text-xs font-medium text-slate-600">
          Mes
        </label>
        <select
          id="calendario-mes"
          // `null` -> `''`: un mes imposible en la URL deja el hueco vacio y no
          // se inventa una opcion para pintarlo. Ofrecer lo que la API rechaza
          // es una forma de mentir.
          value={mes === null ? '' : valorDelMes(mes)}
          onChange={(evento) => cambiarElMes(evento.target.value)}
          className={CLASES_DE_SELECT}
        >
          <option value="">Elegi un mes</option>
          {ofrecidos.map((cada) => (
            <option key={valorDelMes(cada)} value={valorDelMes(cada)}>
              {textoDelMes(cada)}
            </option>
          ))}
        </select>
      </div>
    </form>
  );
}
