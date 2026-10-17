'use client';

import { Suspense, useEffect } from 'react';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { rolAlcanza, type MetricasOperativas } from '@boxadmin/shared';
import { Tabla, type ColumnaDeTabla } from '@/componentes/tabla';
import { Aviso, Boton } from '@/componentes/ui';
import { ErrorDeApi } from '@/lib/cliente';
import { destinoDeLoginDesde } from '@/lib/destino-de-login';
import { useOperativo, type Mes } from '@/hooks/use-stats';
import { useRolDeQuienMira } from '../rol-del-panel';
import { mesDelValor, mesDeLaBusqueda, mesesOfrecidos, textoDelMes, valorDelMes } from './filtros';
import { LAS_CINCO_METRICAS, Porcentaje, PorcentajeEnCelda } from './porcentaje';
import { BloqueDeCaja } from './caja';
import { BloqueDeComposicion } from './composicion';

/**
 * ANALISIS: los numeros que la Fase 6A calcula desde hace cuatro fases y que
 * hasta hoy solo se leian con un `curl`.
 *
 * Esta pantalla no calcula NADA. Pide `/stats/operativo` y pinta lo que vuelve.
 * Todo el trabajo esta en no aplanar las distinciones que ese contrato se tomo
 * el trabajo de hacer, y la principal es la de `porcentaje.tsx`: un
 * `denominador: 0` no es un 0%.
 *
 * ---------------------------------------------------------------------------
 * EL ROL: UNA SOLA PUERTA, Y ES LA DE LA CAJA.
 *
 * `/stats/operativo` y `/stats/composicion-alumnos` piden `ADMIN_OPERATIVO`,
 * que es el rol MINIMO con el que se entra al panel —`enlacesPara` devuelve la
 * lista vacia para `ALUMNO` y para `PROFESOR`, y el layout no los deja pasar—.
 * O sea que cualquiera que pueda ver esta pantalla puede pedir esos dos
 * reportes, y comprobar el rol ahi seria una comprobacion que nunca puede
 * fallar: ruido que el proximo lector confundiria con una defensa.
 *
 * LA DE LA CAJA SI ES DE VERDAD: `/stats/caja` pide `ADMIN_SALON` —es el unico
 * de los seis— porque lleva el margen y lo que cuesta cada profesora. Es el
 * criterio de la 5A y lo explica el controller: registrar un cobro es
 * operativo, mirar el margen del salon no. Ver `LaCaja`, aqui abajo.
 *
 * ---------------------------------------------------------------------------
 * TRES REPORTES Y UN SOLO SELECTOR.
 *
 * La caja y la composicion se piden con el MISMO mes: los tres endpoints toman
 * `anio` y `mes` y nada mas. Por eso el mes se resuelve UNA vez en
 * `PanelDeAnalisis` y el selector es uno solo: los tres bloques reciben el mes
 * ya resuelto y no vuelven a leer la URL cada uno por su cuenta. Dos lecturas
 * del mismo parametro son dos sitios donde un dia uno se queda atras.
 *
 * Y LOS TRES BLOQUES SON INDEPENDIENTES: cada uno tiene su carga, su error y
 * su boton de reintentar. Que la caja no conteste no puede borrar la ocupacion
 * del mes, que ya esta en la pantalla y se leyo bien.
 *
 * ---------------------------------------------------------------------------
 * NO SE PROMETE «EN VIVO», y la spec dice que es lo unico inaceptable.
 *
 * `CacheDeStats` guarda cada reporte 300 segundos del lado del servidor, y las
 * escrituras invalidan subiendo una version por gimnasio: en el camino normal,
 * registrar un pago SI mueve la caja. Pero puede no moverla, y la pantalla no
 * tiene forma de saber cual de los dos casos esta enseñando. Asi que lo dice
 * en una frase y no ofrece un boton de «actualizar»: ese boton volveria a
 * pedir, el servidor contestaria lo mismo desde su cache, y la promesa
 * —«ahora si es el numero de verdad»— seria falsa justo cuando alguien la
 * necesita.
 */

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
 */
function SelectorDeMes({ elegido, ahora }: { elegido: Mes; ahora: Date }) {
  const parametros = useSearchParams();
  const ruta = usePathname();
  const router = useRouter();

  function cambiar(valor: string): void {
    const mes = mesDelValor(valor);
    // Un valor que no se entiende NO navega: dejar la URL como esta es mejor
    // que escribir en ella un mes que nadie eligio.
    if (mes === null) return;

    // Se parte de la URL que YA HAY: el mes no puede borrar lo que la Task 3
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
        <label htmlFor="analisis-mes" className="text-xs font-medium text-slate-600">
          Mes
        </label>
        <select
          id="analisis-mes"
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

/**
 * Las columnas del trimestre, derivadas de las cinco y no escritas dos veces.
 *
 * La lista blanca que fija el conjunto vive en el spec Y ESCRITA A MANO:
 * derivarla aqui y comprobarla contra lo mismo seria autorreferencial —una
 * columna de mas moveria los dos lados a la vez y el test seguiria verde—.
 */
function columnasDelTrimestre(): readonly ColumnaDeTabla<MetricasOperativas>[] {
  return [
    { encabezado: 'Mes', celda: (fila) => textoDelMes(fila) },
    ...LAS_CINCO_METRICAS.map((descripcion) => ({
      encabezado: descripcion.titulo,
      celda: (fila: MetricasOperativas) => <PorcentajeEnCelda dato={fila[descripcion.clave]} />,
    })),
  ];
}

/**
 * EL TRIMESTRE SE PINTA EN EL ORDEN EN QUE LLEGA, Y ESE ORDEN ES DEL MAS VIEJO
 * AL MAS NUEVO.
 *
 * Lo fija el contrato («Los tres meses anteriores, del mas viejo al mas
 * nuevo») y lo cumple `mesesAnteriores` en el service. Esta pantalla NO
 * ordena: ordenar aqui seria una segunda opinion sobre el mismo orden, y el
 * dia que las dos discrepen nadie sabria cual creer. Lo que si hay es un test
 * que fija que lo pintado sale del mas viejo al mas nuevo, para que darlo
 * vuelta —en el service o aqui— se vea.
 *
 * Y SE PINTAN LOS QUE VENGAN, NI UNO MAS. Nada de rellenar hasta tres con
 * huecos: un mes inventado en una serie de tiempo es un dato falso con forma
 * de dato.
 */
function ElTrimestre({ trimestre }: { trimestre: readonly MetricasOperativas[] }) {
  return (
    // `data-bloque` como en el mes: esta pantalla tiene TRES tablas y un
    // `tbody tr` suelto en el spec las mezclaria.
    <section data-bloque="trimestre" className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        Los meses anteriores
      </h2>
      <Tabla
        etiqueta="Los meses anteriores"
        columnas={columnasDelTrimestre()}
        filas={trimestre}
        claveDeFila={(fila) => `${fila.anio}-${fila.mes}`}
        vacio={<Aviso>Todavia no hay meses anteriores que comparar.</Aviso>}
      />
    </section>
  );
}

/** Los cinco porcentajes del mes elegido, cada uno con su fraccion al lado. */
function ElMes({ actual }: { actual: MetricasOperativas }) {
  return (
    <section data-bloque="mes" className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        {textoDelMes(actual)}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {LAS_CINCO_METRICAS.map((descripcion) => (
          <Porcentaje
            key={descripcion.clave}
            descripcion={descripcion}
            dato={actual[descripcion.clave]}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * LA PUERTA DE LA CAJA. Es la unica de esta pantalla y es de verdad.
 *
 * `/stats/caja` es el unico de los seis reportes que pide `ADMIN_SALON`, y lo
 * que lleva dentro dice por que: el margen del salon y lo que cuesta cada
 * profesora. Un operativo registra cobros —eso es su trabajo— y no mira el
 * sueldo de nadie.
 *
 * `rolAlcanza` ES UNA JERARQUIA Y NO UNA LISTA DE ROLES EXACTOS: un
 * `ADMIN_SALON` ve la caja Y ADEMAS todo lo operativo, y un `SUPERADMIN`
 * tambien. Comparar con `rol === 'ADMIN_SALON'` dejaria al superadmin fuera de
 * su propio sistema.
 *
 * `rol === null` es SIN PROVEEDOR, y vale «no alcanza para nada». Si un dia un
 * reordenamiento del layout deja esta pantalla fuera del armazon del panel, lo
 * que no puede pasar es que eso ABRA el dato mas sensible del sistema.
 *
 * NO SE DIBUJA, NO SE ESCONDE, Y TAMPOCO SE PIDE. El contenido vive en otro
 * componente —`BloqueDeCaja`— a proposito: ahi dentro esta el `useCaja`, asi
 * que no montarlo es no pedir. Un `enabled: false` dejaria la peticion escrita
 * y a un refactor de distancia de salir; y un `hidden` dejaria los numeros en
 * el marcado, legibles desde las herramientas del navegador —y encima pasaria
 * en verde cualquier test que use `*ByRole`, porque el arbol de accesibilidad
 * ya excluye lo oculto—. Es la leccion que costo la fase anterior.
 *
 * Y NO SE DICE NADA EN SU LUGAR. Un cartel de «tu rol no alcanza» en la
 * pantalla que el operativo usa todos los dias es ruido permanente sobre algo
 * que no puede cambiar, y de paso anuncia que hay un numero que no esta
 * viendo. Mismo criterio que el boton de publicar el mes: no se ofrece lo que
 * no se puede hacer.
 */
function LaCaja({ mes }: { mes: Mes }) {
  const rol = useRolDeQuienMira();

  if (rol === null || !rolAlcanza(rol, 'ADMIN_SALON')) return null;

  return <BloqueDeCaja mes={mes} />;
}

function PanelDeAnalisis() {
  const { slug } = useParams<{ slug: string }>();
  const parametros = useSearchParams();
  const ruta = usePathname();
  const router = useRouter();

  /**
   * El reloj se lee UNA vez y se reparte, en vez de llamarse en cada sitio que
   * lo necesita. Dos lecturas a caballo entre dos meses —una a las 23:59:59.9
   * del 31 y otra un instante despues— darian un mes distinto al selector y al
   * reporte, y la pantalla pintaria un mes que no esta marcado en el control.
   */
  const ahora = new Date();
  const mes = mesDeLaBusqueda(parametros, ahora);

  const operativo = useOperativo(mes);

  const sesionCaducada = operativo.error instanceof ErrorDeApi && operativo.error.esSesionCaducada;

  useEffect(() => {
    if (!sesionCaducada) return;

    // La puerta del panel mira la sesion en el servidor una vez, al entrar: el
    // token puede caducar con la pantalla abierta. El destino conserva el
    // query porque el mes vive ahi: volver del login al mes de hoy es perder
    // el mes que la persona acababa de elegir.
    router.push(destinoDeLoginDesde(ruta, parametros.toString(), slug));
  }, [sesionCaducada, router, ruta, parametros, slug]);

  return (
    <div className="flex flex-col gap-4">
      <SelectorDeMes elegido={mes} ahora={ahora} />

      {/* Sin sesion no se enseña el «Unauthorized» crudo de la API, que no le
          dice nada a nadie, y tampoco se ofrece reintentar: seria volver a
          fallar mientras la pantalla ya se esta yendo al login. Va UNA vez y
          fuera de los bloques: el 401 es del token, no de un reporte, y tres
          carteles iguales taparian el unico que importa. */}
      {sesionCaducada && <Aviso tono="error">Tu sesion caduco. Te llevamos al login.</Aviso>}

      {/* Cada reporte en su bloque, con su carga y su error: asi un fallo de la
          caja no borra la ocupacion que ya se leyo bien. */}
      <div data-bloque="operativo" className="flex flex-col gap-4">
        {operativo.isPending && <p className="text-sm text-slate-500">Cargando…</p>}

        {/* UN FALLO AL LEER NO SE PARECE A UN MES SIN DATOS, y es la distincion
            mas cara de esta pantalla despues del `denominador: 0`. Un 404 o un
            500 dibujados como celdas vacias dirian que el gimnasio no tuvo
            clases, no que no se pudo preguntar. Se dice QUE paso y se ofrece
            volver a intentarlo; los cinco numeros NO se pintan. */}
        {operativo.error !== null && !sesionCaducada && (
          <div className="flex flex-col items-start gap-2">
            <Aviso tono="error">No se pudieron leer los numeros: {operativo.error.message}</Aviso>
            <Boton tono="secundario" onClick={() => void operativo.refetch()}>
              Reintentar
            </Boton>
          </div>
        )}

        {operativo.data !== undefined && (
          <>
            <ElMes actual={operativo.data.actual} />
            <ElTrimestre trimestre={operativo.data.trimestre} />
          </>
        )}
      </div>

      {/* El dinero, solo para quien alcanza. Y la composicion, para todos. */}
      <LaCaja mes={mes} />
      <BloqueDeComposicion mes={mes} />
    </div>
  );
}

/**
 * `useSearchParams` obliga a una frontera de Suspense.
 *
 * Sin ella, `next build` falla en cuanto algo deje esta ruta prerenderizable, y
 * el error («missing-suspense-with-csr-bailout») aparece lejos de aqui y cuesta
 * de ubicar. El encabezado queda FUERA para que no parpadee.
 *
 * Y ESTE ARCHIVO NO EXPORTA NADA MAS QUE ESTO. Next 15 prohibe que un
 * `page.tsx` exporte cualquier otra cosa; lo demas vive en `filtros.ts` y en
 * `porcentaje.tsx`. Ver el comentario de `filtros.ts`.
 */
export default function PaginaDeAnalisis() {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-slate-900">Analisis</h1>
      <p className="text-sm text-slate-600">
        Como le fue al gimnasio ese mes, como venia en los tres anteriores y como estan repartidos
        los alumnos. Cada porcentaje lleva su fraccion al lado: «50%» son dos de cuatro o cien de
        doscientas, y no son lo mismo.
      </p>
      <p className="text-sm text-slate-600">
        Los numeros pueden tener hasta cinco minutos: el servidor los guarda ese rato. Esto no es un
        tablero en vivo.
      </p>

      <Suspense fallback={<p className="text-sm text-slate-500">Cargando…</p>}>
        <PanelDeAnalisis />
      </Suspense>
    </section>
  );
}
