'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { rolAlcanza } from '@boxadmin/shared';
import { Aviso, Boton } from '@/componentes/ui';
import { useEncolarHealthCheck } from '@/hooks/use-configuracion';
import { useRolDeQuienMira } from '../rol-del-panel';

/**
 * EL INDICE DE CONFIGURACION: la puerta del area entera y el boton de la cola.
 *
 * ---------------------------------------------------------------------------
 * LA PUERTA ES DEL AREA ENTERA, Y ESA ES LA DIFERENCIA CON LA FASE 11.
 *
 * Los CATORCE endpoints de configuracion piden `ADMIN_SALON`, comprobado
 * decorador por decorador en la Tarea 1. En Analisis habia que esconder UN
 * bloque —la caja— dentro de una pantalla que un operativo usa todos los dias;
 * aqui no hay nada que un operativo pueda hacer, asi que la puerta esta
 * delante de todo y esta pantalla no se dibuja para el.
 *
 * LOS PACKS, QUE LLEGARON DESPUES, NO AFLOJAN ESA PUERTA. `GET /packs` no
 * lleva `@Roles` —es el catalogo que consume media docena de pantallas— pero
 * las CUATRO escrituras de `@Controller('packs')` piden `ADMIN_SALON`, y la
 * pantalla de packs es un editor: lo unico que un operativo podria hacer alli
 * es mirar, y ya mira el mismo catalogo en el selector de la ficha de cada
 * alumno. Ofrecerle un editor entero para que cada boton conteste 403 es
 * exactamente lo que esta puerta existe para no hacer.
 *
 * SON DOS MITADES Y HACEN FALTA LAS DOS:
 *
 *  1. La ENTRADA no existe en el marcado de la navegacion —`ENLACES_DEL_PANEL`
 *     la declara con `minimo: 'ADMIN_SALON'` y `enlacesPara` la filtra—, no
 *     escondida con CSS.
 *  2. Y la PANTALLA no pide NADA. Por eso la puerta va ANTES de los hooks y en
 *     un componente aparte: el `useEncolarHealthCheck` y el `useParams` viven
 *     dentro de `IndiceDeConfiguracion`, asi que no montarlo es no tenerlos.
 *     Un `enabled: false` dejaria la peticion escrita y a un refactor de
 *     distancia de salir, y un `hidden` dejaria el boton en el marcado
 *     —legible desde las herramientas del navegador, y en verde para cualquier
 *     test que use `*ByRole`, porque el arbol de accesibilidad ya excluye lo
 *     oculto—. Es la leccion que costo la Fase 10.
 *
 * `rolAlcanza` ES UNA JERARQUIA Y NO UNA LISTA DE ROLES EXACTOS: un
 * `SUPERADMIN` entra tambien. Comparar con `rol === 'ADMIN_SALON'` dejaria al
 * superadmin fuera de su propio sistema.
 *
 * `rol === null` es SIN PROVEEDOR, y vale «no alcanza para nada»: FALLA
 * CERRADA. Si un dia un reordenamiento del layout deja esta pantalla fuera del
 * armazon del panel, lo que no puede pasar es que eso abra las credenciales
 * del servidor de correo.
 *
 * Y NO SE DICE NADA EN SU LUGAR, como en la caja: un cartel de «tu rol no
 * alcanza» anuncia que hay algo que no se esta viendo y no se puede cambiar.
 * Al operativo esta ruta no le aparece en ningun sitio.
 *
 * Esto NO es la seguridad —esa son los `@Roles` de la API, que contestarian
 * 403 igual—: es no ofrecer lo que no se puede hacer.
 *
 * ---------------------------------------------------------------------------
 * LOS CUATRO ENLACES YA TIENEN ARCHIVO, Y AUN ASI NADIE LOS VALIDA.
 *
 * Cuando esto se escribio, las tres rutas de la Fase 12 no existian todavia y
 * los enlaces se dibujaban igual: `next build` NO valida los destinos de un
 * `<Link>` —no hay `typedRoutes` en `next.config.mjs`, asi que un `href` es
 * una cadena—, comprobado corriendo el build. Hoy las cuatro existen
 * (`web/`, `email/`, `checkin/` y `packs/`), pero la nota se queda: lo que
 * sostiene que un `href` de aqui llegue a algun sitio es el test de abajo con
 * las rutas escritas a mano, y no el compilador.
 *
 * ---------------------------------------------------------------------------
 * ESTE ARCHIVO NO EXPORTA NADA MAS QUE EL `default`.
 *
 * Next 15 lo prohibe en un `page.tsx` y ni `tsc --noEmit` ni los tests lo ven:
 * el error habla de `OmitWithTag` y «not assignable to never» y no se parece a
 * la causa. Por eso los textos de abajo son constantes del modulo SIN exportar
 * y el spec los repite escritos a mano — que ademas es lo unico que le da
 * dientes a «el exito aclara que NO confirma…»: importar la constante y
 * compararla contra si misma dejaria pasar en verde un «todo funciona».
 */

/**
 * Las pantallas del area.
 *
 * Las tres primeras van en el orden del contrato de configuracion: web, email,
 * QR. LOS PACKS VAN DETRAS Y NO INTERCALADOS porque no son configuracion del
 * gimnasio: son un RECURSO con su propio controller (`@Controller('packs')`),
 * su propia tabla y su propia clave de cache. Cuelgan de aqui por la misma
 * razon por la que cuelgan las otras tres —es lo que el gimnasio decide una
 * vez y casi no vuelve a tocar, y las cuatro escrituras piden `ADMIN_SALON`,
 * que es justo la puerta de este area— y no por ser parte de `/config`.
 */
const LAS_SECCIONES = [
  {
    ruta: 'web',
    titulo: 'La web publica',
    descripcion:
      'Lo que ve quien todavia no es alumno: la portada del gimnasio, los testimonios y las ' +
      'preguntas frecuentes.',
  },
  {
    ruta: 'email',
    titulo: 'El email',
    descripcion:
      'El servidor de correo con el que salen los avisos, y los textos que se mandan firmados ' +
      'con el nombre del gimnasio.',
  },
  {
    ruta: 'checkin',
    titulo: 'El check-in por QR',
    descripcion:
      'La ventana de tiempo alrededor del inicio del turno y el cartel con el codigo QR de la ' +
      'pared.',
  },
  {
    ruta: 'packs',
    titulo: 'Los packs',
    descripcion:
      'El catalogo de lo que el gimnasio vende: cuantas clases da cada pack y cuanto cuesta. Dar ' +
      'de baja uno no le quita el pack a quien ya lo tiene.',
  },
] as const;

/**
 * EL BOTON SE LLAMA POR LO QUE PRUEBA, Y PRUEBA MENOS DE LO QUE SU NOMBRE
 * HABITUAL PROMETE.
 *
 * `POST /jobs/health-check` encola un ping y devuelve `{ jobId }`. NO HAY
 * ENDPOINT PARA LEER EL RESULTADO: el procesador escribe una linea en el
 * registro del servidor, que quien esta en el mostrador no ve nunca.
 *
 * Aun asi se dibuja, y la diferencia con `exclusiva`, `recuperable` y la
 * franja horaria de la Fase 10 es que aquellos no hacian NADA: si Redis esta
 * caido, este POST falla. O sea que encolar SI demuestra algo verdadero —que
 * la API alcanza la cola— y mas chico que «todo funciona». La respuesta a eso
 * no es esconderlo, es nombrarlo bien.
 */
const TEXTO_DEL_BOTON = 'Probar que la API alcanza la cola';

/**
 * EL EXITO DICE LO QUE SE PROBO Y, EN LA MISMA FRASE, LO QUE NO.
 *
 * La aclaracion no es una nota al pie ni una ayuda escondida: un «funciona»
 * suelto delante del mostrador se lee como «los emails estan saliendo», que es
 * justo lo que este boton NO puede afirmar.
 */
const TEXTO_DEL_EXITO =
  'La API alcanzo la cola: el ping quedo encolado. Esto NO confirma que el trabajo se haya ' +
  'procesado — el resultado solo queda en el registro del servidor y no hay forma de leerlo ' +
  'desde aca.';

/** Lo que se dice cuando el POST falla. El mensaje de la API va TAL CUAL. */
const PRINCIPIO_DEL_FALLO = 'No se pudo encolar el ping: ';

/**
 * El bloque de la cola. Vive aqui dentro y no en la raiz del modulo por lo de
 * siempre: `page.tsx` no puede exportar nada mas que el `default`.
 */
function LaColaDeTrabajos() {
  const encolar = useEncolarHealthCheck();

  /**
   * `jobId` ES OPCIONAL Y PUEDE NO LLEGAR SIQUIERA.
   *
   * `JSON.stringify({ jobId: undefined })` es `{}`, asi que la respuesta buena
   * puede venir sin la clave. No se inventa un «—» ni un «desconocido» en su
   * lugar: la linea entera no se dibuja. Un hueco con forma de dato es peor
   * que no tener el dato.
   */
  const numeroDeTrabajo = encolar.data?.jobId;

  return (
    <section data-bloque="cola" className="flex flex-col items-start gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        La cola de trabajos
      </h2>

      <p className="text-sm text-slate-600">
        Los emails y los avisos salen por una cola. Esto encola un trabajo de prueba: si la cola no
        contesta, falla aca y no en silencio tres dias despues.
      </p>

      <Boton onClick={() => encolar.mutate()} cargando={encolar.isPending}>
        {TEXTO_DEL_BOTON}
      </Boton>

      {/* `alerta` porque el resultado aparece DESPUES de pulsar y en otro sitio
          de la pantalla: sin el, quien usa un lector de pantalla pulsa y para
          el no pasa nada. */}
      {encolar.isSuccess && (
        <Aviso tono="exito" alerta>
          <span data-resultado="exito">{TEXTO_DEL_EXITO}</span>
        </Aviso>
      )}

      {/* El numero va FUERA del nodo del mensaje: dentro, la igualdad exacta
          del spec tendria que llevarlo escrito y dejaria de leerse contra un
          texto fijo. */}
      {numeroDeTrabajo !== undefined && (
        <p className="text-xs text-slate-500">
          Numero de trabajo: <span data-numero-de-trabajo>{numeroDeTrabajo}</span>
        </p>
      )}

      {/* UN FALLO NO SE PARECE A UN EXITO, y se distingue por un atributo
          propio y no por el color: el `data-resultado` es lo que permite
          afirmarlo sin buscar subcadenas. El mensaje de la API va tal cual
          —«Redis no contesta» dice que pasa; un «hubo un problema» no—. */}
      {encolar.isError && (
        <Aviso tono="error">
          <span data-resultado="error">
            {PRINCIPIO_DEL_FALLO}
            {encolar.error.message}
          </span>
        </Aviso>
      )}
    </section>
  );
}

/** El indice ya pasado el rol. Aqui dentro viven TODOS los hooks que piden. */
function IndiceDeConfiguracion() {
  const { slug } = useParams<{ slug: string }>();

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-slate-900">Configuracion</h1>
      <p className="text-sm text-slate-600">
        Lo que el gimnasio decide una vez y casi no vuelve a tocar: la web publica, el correo y el
        check-in. Es tambien donde se mira que dice el gimnasio en los ajustes que las salas
        heredan.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {LAS_SECCIONES.map((seccion) => (
          <div
            key={seccion.ruta}
            className="flex flex-col gap-1 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            {/* El enlace lleva SOLO el titulo y la descripcion queda fuera: el
                nombre accesible de un enlace que envuelva al parrafo entero
                seria el parrafo entero. */}
            <h2 className="text-base font-semibold text-slate-900">
              <Link href={`/${slug}/admin/configuracion/${seccion.ruta}`} className="underline">
                {seccion.titulo}
              </Link>
            </h2>
            <p className="text-sm text-slate-600">{seccion.descripcion}</p>
          </div>
        ))}
      </div>

      <LaColaDeTrabajos />
    </section>
  );
}

/**
 * LA PUERTA, Y NADA MAS QUE LA PUERTA.
 *
 * Un solo hook —leer el contexto— y despues un `return null`. Todo lo que pide
 * algo esta del otro lado.
 */
export default function PaginaDeConfiguracion() {
  const rol = useRolDeQuienMira();

  if (rol === null || !rolAlcanza(rol, 'ADMIN_SALON')) return null;

  return <IndiceDeConfiguracion />;
}
