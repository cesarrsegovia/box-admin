'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { TipoUsuarioNegocio } from '@boxadmin/shared';
import type { FiltrosDeUsuarios } from '@/hooks/use-usuarios';

/**
 * Los filtros del listado, declarados en un solo sitio.
 *
 * La misma idea que `ENLACES_DEL_PANEL`: agregar un filtro es una linea aqui y
 * no un `<select>` nuevo cableado en el JSX. Es tambien lo que permite que el
 * parseo y el pintado no se separen con el tiempo, porque los dos leen de aqui.
 *
 * `salaId` existe en `FiltrosDeUsuarios` pero NO esta: no hay todavia pantalla
 * ni hook que traiga las salas, y un filtro que viaja en la URL sin un control
 * que lo muestre es un listado recortado sin que se vea por que. Cuando llegue
 * el selector de salas se agrega aqui, y se parsea aqui.
 */
interface ControlDeFiltro {
  clave: 'tipo' | 'activo' | 'autoRegistrado';
  etiqueta: string;
  opciones: readonly { valor: string; texto: string }[];
}

const CONTROLES: readonly ControlDeFiltro[] = [
  {
    clave: 'tipo',
    etiqueta: 'Tipo',
    opciones: [
      { valor: '', texto: 'Todos' },
      { valor: 'alumno', texto: 'Alumnos' },
      { valor: 'profesor', texto: 'Profesores' },
    ],
  },
  {
    clave: 'activo',
    etiqueta: 'Estado',
    opciones: [
      { valor: '', texto: 'Todos' },
      { valor: 'true', texto: 'Activos' },
      { valor: 'false', texto: 'Dados de baja' },
    ],
  },
  {
    clave: 'autoRegistrado',
    etiqueta: 'Alta',
    opciones: [
      { valor: '', texto: 'Todas' },
      { valor: 'true', texto: 'Se registraron solos' },
      { valor: 'false', texto: 'Los dio de alta el gimnasio' },
    ],
  },
];

const TIPOS: readonly string[] = ['alumno', 'profesor'];

/**
 * `"true"`/`"false"` y nada mas.
 *
 * Cualquier otra cosa es ausencia de filtro, no `false`: la URL la escribe
 * cualquiera, y un `?activo=quiza` convertido en `activo=false` le enseñaria al
 * admin la lista de bajas creyendo que ve la de altas.
 */
function booleanoDeLaUrl(valor: string | null): boolean | undefined {
  if (valor === 'true') return true;
  if (valor === 'false') return false;
  return undefined;
}

/**
 * La URL es la fuente de verdad de los filtros.
 *
 * Se exporta porque la pantalla la usa para armar la consulta y el spec la usa
 * para saber con que clave sembrar la cache: que las dos cosas salgan de la
 * MISMA funcion es lo que impide que un test pase con una lectura equivocada.
 *
 * Lo que no reconoce NO se devuelve, y un filtro ausente no es lo mismo que un
 * filtro vacio: `queryDeFiltros` manda `activo=false` pero no manda `activo=`,
 * porque el `ParseBoolPipe` de la API rechaza el segundo con un 400.
 */
export function filtrosDeLaBusqueda(parametros: URLSearchParams): FiltrosDeUsuarios {
  const filtros: FiltrosDeUsuarios = {};

  const tipo = parametros.get('tipo');
  if (tipo !== null && TIPOS.includes(tipo)) filtros.tipo = tipo as TipoUsuarioNegocio;

  const activo = booleanoDeLaUrl(parametros.get('activo'));
  if (activo !== undefined) filtros.activo = activo;

  const autoRegistrado = booleanoDeLaUrl(parametros.get('autoRegistrado'));
  if (autoRegistrado !== undefined) filtros.autoRegistrado = autoRegistrado;

  return filtros;
}

/** El valor que le toca a cada `<select>`, sacado de los filtros YA validados. */
function valorDelControl(filtros: FiltrosDeUsuarios, clave: ControlDeFiltro['clave']): string {
  const valor = filtros[clave];
  return valor === undefined ? '' : String(valor);
}

/**
 * Los filtros escriben la URL, nunca `useState`.
 *
 * Un filtro en la URL se comparte por chat ("mirá, estos son los que deben") y
 * sobrevive al boton de atras. En estado se pierde al navegar y nadie entiende
 * por que, y encima la pantalla y la barra de direcciones dicen cosas distintas.
 */
export function FiltrosDePersonas() {
  const parametros = useSearchParams();
  const ruta = usePathname();
  const router = useRouter();
  const filtros = filtrosDeLaBusqueda(parametros);

  function cambiar(clave: string, valor: string): void {
    // Se parte de los parametros ACTUALES: cambiar un filtro no puede borrar
    // los otros dos ni lo que lleve la URL por su cuenta.
    const siguientes = new URLSearchParams(parametros.toString());

    if (valor === '') siguientes.delete(clave);
    else siguientes.set(clave, valor);

    const texto = siguientes.toString();

    // UNA sola navegacion. Un `push` de cortesia antes del bueno deja una
    // entrada basura en el historial y un parpadeo en la pantalla.
    router.push(texto === '' ? ruta : `${ruta}?${texto}`);
  }

  return (
    <form className="flex flex-wrap items-end gap-3">
      {CONTROLES.map((control) => {
        const id = `filtro-${control.clave}`;

        return (
          <div key={control.clave} className="flex flex-col gap-1">
            {/* `htmlFor` y no una etiqueta que envuelva al select: envolviendolo,
                el nombre accesible se lleva por delante el texto de todas las
                opciones. */}
            <label htmlFor={id} className="text-xs font-medium text-slate-600">
              {control.etiqueta}
            </label>
            <select
              id={id}
              value={valorDelControl(filtros, control.clave)}
              onChange={(evento) => cambiar(control.clave, evento.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            >
              {control.opciones.map((opcion) => (
                <option key={opcion.valor} value={opcion.valor}>
                  {opcion.texto}
                </option>
              ))}
            </select>
          </div>
        );
      })}
    </form>
  );
}
