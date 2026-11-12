'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { mesDelValor, mesesOfrecidos, textoDelMes, valorDelMes, type Mes } from '@/lib/mes';

const CLASES_DE_CONTROL =
  'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900';

/**
 * EL MES ESCRIBE LA URL, NUNCA `useState`.
 *
 * Un mes en la URL se comparte por chat («mira la ocupacion de marzo»),
 * sobrevive al boton de atras, se puede guardar en favoritos y vuelve puesto
 * desde el login. En estado se pierde al navegar y nadie entiende por que, y
 * encima la pantalla y la barra de direcciones dicen cosas distintas.
 *
 * Las DOS claves se escriben juntas: medio mes en la URL no es media eleccion,
 * es ninguna. Ver `mesDeLaBusqueda`.
 *
 * Lo usan Analisis y «Mi liquidacion» de la profesora: cada una le pasa su
 * `id`, que es lo que ata la etiqueta «Mes» a su `<select>`.
 */
export function SelectorDeMes({ id, elegido, ahora }: { id: string; elegido: Mes; ahora: Date }) {
  const parametros = useSearchParams();
  const ruta = usePathname();
  const router = useRouter();

  function cambiar(valor: string): void {
    const mes = mesDelValor(valor);
    // Un valor que no se entiende NO navega: dejar la URL como esta es mejor
    // que escribir en ella un mes que nadie eligio.
    if (mes === null) return;

    // Se parte de la URL que YA HAY: el mes no puede borrar lo que otro filtro
    // o un enlace compartido lleven al lado.
    const siguientes = new URLSearchParams(parametros.toString());
    siguientes.set('anio', String(mes.anio));
    siguientes.set('mes', String(mes.mes));

    // UNA sola navegacion por cambio: un `push` de cortesia antes del bueno
    // deja una entrada basura en el historial y un parpadeo en la pantalla.
    router.push(`${ruta}?${siguientes.toString()}`);
  }

  return (
    // «Filtros» y no «Mes»: con `aria-label="Mes"` el formulario y su
    // `<select>` tendrian el mismo nombre accesible, y entonces son
    // indistinguibles para quien navega con lector de pantalla —y para quien
    // escribe un test—.
    <form aria-label="Filtros" className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        {/* `htmlFor` y no una etiqueta que envuelva al control: envolviendolo,
            el nombre accesible se lleva por delante el texto de las opciones. */}
        <label htmlFor={id} className="text-xs font-medium text-slate-600">
          Mes
        </label>
        <select
          id={id}
          value={valorDelMes(elegido)}
          onChange={(evento) => cambiar(evento.target.value)}
          className={CLASES_DE_CONTROL}
        >
          {mesesOfrecidos(ahora, elegido).map((mes) => (
            <option key={valorDelMes(mes)} value={valorDelMes(mes)}>
              {textoDelMes(mes)}
            </option>
          ))}
        </select>
      </div>
    </form>
  );
}
