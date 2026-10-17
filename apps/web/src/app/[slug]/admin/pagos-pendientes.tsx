'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import type { PagoPendiente, UsuarioResumen } from '@boxadmin/shared';
import { Tabla, type ColumnaDeTabla } from '@/componentes/tabla';
import { Aviso, Boton } from '@/componentes/ui';
import { ErrorDeApi } from '@/lib/cliente';
import { SIN_QUERY, destinoDeLoginDesde } from '@/lib/destino-de-login';
import { usePagosPendientes } from '@/hooks/use-stats';
import { useUsuarios, type FiltrosDeUsuarios } from '@/hooks/use-usuarios';
// La ORTOGRAFIA del dinero, en un solo sitio. Ver el comentario de `elTotal`.
import { textoDeCentavos } from './analisis/caja';

/**
 * A QUIEN HAY QUE LLAMAR HOY. `GET /stats/pagos-pendientes`.
 *
 * ===========================================================================
 * POR QUE VIVE EN LA PORTADA DEL PANEL Y NO EN ANALISIS NI EN PERSONAS
 * ===========================================================================
 *
 * No es un reporte para leer: es una LISTA DE TRABAJO. La spec de la fase ya
 * decidio que no va en Analisis —enterrada en una seccion de reportes no la
 * mira nadie, porque recepcion no entra ahi—. Lo que decide esta tarea es el
 * sitio concreto, y la hipotesis del plan era el listado de personas. No es
 * ahi, y el motivo se mide en el propio codigo:
 *
 * 1. ESTE REPORTE NO ACEPTA NINGUN FILTRO, Y EL LISTADO DE PERSONAS ES UNA
 *    BARRA DE FILTROS. `ConsultaPagosPendientesDto` esta VACIO a proposito,
 *    para que el ValidationPipe conteste 400 ante un `?salaId=` en vez de
 *    ignorarlo en silencio. Debajo de los tres `<select>` de
 *    `usuarios/filtros.tsx` —tipo, estado y alta, que escriben la URL— esta
 *    lista seguiria enseñando exactamente lo mismo con «Profesores» puesto, o
 *    con «Dados de baja». Dos listas de personas en la misma pantalla, una que
 *    obedece a los controles y otra que los ignora sin que se vea por que, es
 *    la misma clase de mentira que el `/stats/caja?salaId=` de la 6A: validaba
 *    la sala y devolvia los numeros de todas, con codigo 200. Un reporte sin
 *    parametros pide una pantalla sin parametros.
 *
 * 2. Y ADEMAS CHOCARIA CON LA COLUMNA «Pago al dia» QUE YA HAY AHI. Esa
 *    columna es `UsuarioResumen.pagoAlDia` y cubre a TODO el mundo: profesores
 *    incluidos, y alumnos sin pack contratado. Este reporte sale de
 *    `perfilesConPack()`, que filtra `rol: 'ALUMNO'`, `activo: true` y
 *    `packId: { not: null }`. O sea que hay gente que el listado marca «Debe»
 *    y que en esta lista no esta, y las dos respuestas son correctas para su
 *    pregunta. Pegadas en la misma pantalla se leen como un bug.
 *
 * 3. LA PORTADA DEL PANEL NO TENIA NINGUN TRABAJO. Era un parrafo y un enlace
 *    a Personas. Y es donde aterriza TODO el mundo al entrar —`destinoPorRol`
 *    manda ahi a los admins—, sin un clic de por medio y sin tener que decidir
 *    ir. Es tambien la unica pantalla del panel que habla de HOY: Analisis
 *    elige un mes, la asistencia elige un rango, la ficha elige una persona.
 *    Este reporte se evalua con la fecha de hoy y el service lo dice por
 *    escrito: «contesta a quien le reclamo AHORA, que es una pregunta del
 *    presente y no de un periodo». Una lista de llamadas del dia se mira una
 *    vez al dia, y entrar al panel es exactamente una vez al dia.
 *
 * 4. NO HACE FALTA UNA ENTRADA NUEVA EN LA NAVEGACION. «Inicio» ya esta en
 *    `ENLACES_DEL_PANEL`, es la primera, y pide `ADMIN_OPERATIVO` — que es
 *    justo el rol de este endpoint. Una entrada propia seria un sitio mas al
 *    que hay que decidir ir, que es el problema que esta decision existe para
 *    evitar.
 *
 * NO LLEVA PUERTA DE ROL, y es una decision y no un olvido — el mismo
 * razonamiento que `BloqueDeComposicion`. `/stats/pagos-pendientes` pide
 * `ADMIN_OPERATIVO`, que es el rol MINIMO con el que el layout deja entrar al
 * panel: cualquiera que vea esta pantalla puede pedir este reporte, y una
 * comprobacion que nunca puede fallar es ruido que el proximo lector
 * confundiria con una defensa. El controller lo discute y lo deja escrito:
 * aqui hay importes, pero son el precio de lista que recepcion ya canta por
 * telefono, no lo que factura el gimnasio.
 *
 * ===========================================================================
 * LA SEGUNDA PETICION, QUE NO ES UN CAPRICHO
 * ===========================================================================
 *
 * `PagoPendiente` trae `perfilId`, Y LA FICHA DE UNA PERSONA SE ABRE CON EL ID
 * DEL USUARIO, QUE ES OTRO. Verificado y no deducido: la ruta es
 * `/{slug}/admin/usuarios/[id]`, que llama a `useUsuario(id)` →
 * `GET /usuarios/:id`, y ahi `UsuariosService.obtener` compara `actor.sub`
 * —el id de Usuario del token— contra ese `id` y luego lee `datos.perfil.id`
 * por separado. En `UsuarioResumen` los dos campos existen y son distintos:
 * `id` y `perfilId`.
 *
 * O sea que CON LA RESPUESTA DE ESTE REPORTE SOLA NO SE PUEDE ENLAZAR A LA
 * FICHA DE NADIE, y una lista de a quien llamar desde la que no se puede abrir
 * a quien llamar vale la mitad. La traduccion se hace aqui, con el listado de
 * personas SIN FILTROS (`GET /usuarios`), que es el unico sitio donde los dos
 * ids viajan juntos. Es una peticion de mas y esta contada en la lista blanca
 * del spec, a proposito.
 *
 * LAS DOS CONSULTAS SON INDEPENDIENTES Y LA DE LAS PERSONAS NO PUEDE BORRAR AL
 * REPORTE. Si el directorio no contesta, las filas se pintan igual y lo unico
 * que falta es el enlace: quien no pago sigue siendo quien no pago aunque no
 * sepamos abrir su ficha. Al reves seria cambiar un reporte leido por una
 * pantalla vacia a cuenta de un dato accesorio.
 */

/**
 * SIN NINGUN FILTRO, Y ES LA MITAD DEL SENTIDO DE ESTA CONSULTA.
 *
 * Los filtros del listado de personas viven en la URL de ESA pantalla, y aqui
 * no hay ninguno que leer: hace falta la correspondencia `perfilId` → `id` de
 * TODO el mundo, porque el reporte no se puede acotar y puede nombrar a
 * cualquiera. Un `{ activo: true }` «de cortesia» dejaria sin enlace a quien
 * cambie de estado entre las dos peticiones.
 *
 * Es una constante de modulo y no un `{}` escrito en la llamada para que la
 * clave de TanStack sea LA MISMA que la del listado de personas sin filtros:
 * entrar al panel y pinchar «Ver las personas» es entonces una peticion, no
 * dos.
 */
const TODAS_LAS_PERSONAS: FiltrosDeUsuarios = {};

/**
 * QUE ES ESTE NUMERO, DICHO ANTES DE LA TABLA Y SIN LA PALABRA QUE NO ES.
 *
 * El contrato de `PagoPendiente.pendienteEstimado` lo dice por escrito: «Es un
 * ESTIMADO y por eso se llama asi: el sistema no lleva cuenta corriente, asi
 * que esto es lo que costaria ponerse al dia con un pack, no una deuda
 * calculada».
 *
 * LA FRASE NO USA ESA PALABRA NI PARA NEGARLA, y eso es deliberado. Alguien va
 * a leer este numero por telefono a un alumno. «No es una deuda» deja la
 * palabra en la pantalla, y quien la cruza de reojo —o quien copia la frase a
 * un mensaje— se queda con ella. Se dice lo que el numero ES y de donde sale,
 * y la palabra no aparece en ningun sitio de esta pantalla. Hay un test que lo
 * fija buscandola en el marcado.
 */
export const ES_UN_ESTIMADO =
  'Es un ESTIMADO y sale del precio de lista del pack que esa persona tiene contratado: es lo ' +
  'que costaria ponerse al dia con ese pack. El sistema no lleva cuenta corriente, asi que ' +
  'detras de este numero no hay ningun saldo acumulado ni nada que el sistema haya ido sumando.';

/**
 * SE EVALUA CON LA FECHA DE HOY, Y NO SE PUEDE PEDIR DE OTRO DIA.
 *
 * Lo dice `StatsService.pagosPendientes`: «LA FECHA DE EVALUACION ES HOY, Y
 * ESTA ESCRITO AQUI A PROPOSITO». Importa decirlo porque el mismo concepto
 * aparece en la caja de Analisis —`CajaDelMes.pendienteEstimado`— evaluado al
 * cierre del mes pedido, y los dos numeros pueden no coincidir al centavo sin
 * que ninguno este mal. Sin esta frase, el primero que compare las dos
 * pantallas abre un bug que no existe.
 */
export const SE_MIRA_HOY =
  'Es la foto de hoy: quien no tiene un pago que cubra el dia de hoy. No se puede pedir la de ' +
  'otra fecha, y por eso puede no cuadrar al centavo con el pendiente estimado de la caja del ' +
  'mes, que se evalua al cerrar ese mes.';

/**
 * LO QUE SE LEE CUANDO `packNombre` ES `null`, QUE AQUI SIGNIFICA UNA SOLA COSA.
 *
 * Y NO ES LO MISMO QUE EN LA COMPOSICION, aunque el campo se parezca. Alli
 * —`ComposicionPorPack`— el nombre colapsa TRES casos, porque el service hace
 * `packId === null ? SIN_PACK : (packs.get(packId)?.nombre ?? SIN_PACK)`: sin
 * plan, pack borrado y un pack de verdad que se llame «Sin pack» se escriben
 * igual. Por eso aquella pantalla se ramifica por el `packId` y nunca por el
 * nombre.
 *
 * AQUI NO PASA ESO, y se midio en el service en vez de suponerlo:
 * `perfilesConPack()` filtra `packId: { not: null }`, asi que TODA fila de este
 * reporte tiene pack contratado; y el mapeo es `packs.get(...)?.nombre ?? null`
 * —`null`, no una cadena—, con el comentario al lado: «Un pack borrado deja al
 * alumno con un nombre que no existe. `null` y no `''`: "no se sabe cual" y "se
 * llama vacio" son cosas distintas». O sea que `null` aqui quiere decir
 * EXACTAMENTE «su pack ya no esta en la tabla de packs», y nunca «no tiene
 * plan»: quien no tiene plan no entra en esta lista.
 *
 * De ahi que esta pantalla pueda decirlo con palabras en vez de inventarse un
 * «Sin pack» que chocaria con un pack de verdad llamado asi. Lo que NO puede
 * pasar es que se pinte vacio: una celda en blanco en la columna del pack se
 * lee como «todavia no cargaron el dato», que es otra cosa.
 */
export const PACK_QUE_YA_NO_ESTA = 'Su pack ya no existe';

/**
 * UN CERO AQUI NO QUIERE DECIR «NO DEBE NADA», Y ES EL AVISO MAS CARO DE ESTA
 * PANTALLA DESPUES DEL DE ARRIBA.
 *
 * `pendientesDe` pone `centavos: 0` cuando el pack del alumno no tiene precio
 * con el que estimar —`precioPack === null`, que es tanto «a consultar» como
 * «el pack ya no esta»—, y el service lo deja escrito: «Un pack sin precio ("a
 * consultar") aporta cero y no un NaN: no saber cuanto debe alguien no es lo
 * mismo que romper el reporte entero». Correcto para el reporte, y una trampa
 * en una pantalla desde la que se llama por telefono: un «0.00» al lado de un
 * nombre se lee «no debes nada», cuando la persona esta en esta lista
 * justamente porque no tiene un pago que cubra hoy.
 *
 * La frase esta redactada para ser verdad TAMBIEN si el pack cuesta cero de
 * verdad: desde esta respuesta los dos casos son el mismo numero y no hay
 * forma de distinguirlos. Lo que se afirma —que estar en la lista no depende
 * del importe— vale en los dos.
 */
export const UN_CERO_NO_ES_ESTAR_AL_DIA =
  'Un 0.00 no quiere decir que esta persona este al dia: esta en esta lista porque no tiene un ' +
  'pago que cubra hoy. Quiere decir que con el precio de su pack no sale ningun importe que ' +
  'estimar.';

/** Lo que se lee cuando la lista contestada viene vacia. */
export const NADIE_PENDIENTE =
  'Hoy no hay nadie a quien llamar: todos los alumnos con pack tienen un pago que cubre hoy. La ' +
  'pregunta se contesto y la respuesta esta vacia.';

/**
 * El indice `perfilId` → id de usuario, para poder abrir una ficha.
 *
 * Se arma del listado entero y no al reves porque la clave que tenemos es la
 * del perfil. Un `Map` y no un `find` por fila: con mil alumnos, `find` dentro
 * de la celda recorre la lista una vez por fila.
 */
function indiceDeFichas(personas: readonly UsuarioResumen[] | undefined): Map<string, string> {
  return new Map((personas ?? []).map((persona) => [persona.perfilId, persona.id]));
}

/**
 * EL TOTAL SE SUMA EN `centavos`, Y ES LA UNICA CUENTA DE ESTE ARCHIVO.
 *
 * `Importe` trae `centavos` —entero, la verdad— y `texto` —para mostrar—, y el
 * contrato dice por que no hay un tercer campo con pesos como float: «un float
 * de dinero es una suma mal hecha esperando a ocurrir, y tenerlo disponible
 * garantiza que alguien lo use». Aqui la regla es la misma que en la caja: lo
 * que se PINTA sale de `texto` tal cual, y lo que se CALCULA sale de
 * `centavos`. `Number(importe.texto)` no aparece en este archivo.
 *
 * `textoDeCentavos` se IMPORTA de `analisis/caja` en vez de copiarse. Esa
 * funcion ya es una copia deliberada de `aTexto` de la API —`@boxadmin/shared`
 * no la exporta y esta fase no toca `packages/shared`—, y una copia estaba
 * justificada; una tercera grafia del mismo numero, en la pantalla donde se
 * lee el importe por telefono, no lo esta.
 */
function totalEnCentavos(filas: readonly PagoPendiente[]): number {
  return filas.reduce((total, fila) => total + fila.pendienteEstimado.centavos, 0);
}

/**
 * Las columnas. El nombre primero, y es el que lleva a la ficha.
 *
 * El enlace va DENTRO de la celda y no por `enlaceDeFila` de la `Tabla`, que
 * es todo o nada: aqui puede haber filas que no sepamos enlazar —ver el
 * docblock de arriba— y una fila con un `href` inventado es peor que una fila
 * sin enlace. Quien no se pueda resolver se pinta igual, con su nombre en
 * texto.
 */
function columnas(
  fichas: Map<string, string>,
  slug: string,
): readonly ColumnaDeTabla<PagoPendiente>[] {
  return [
    {
      encabezado: 'Persona',
      celda: (fila) => {
        const idDeFicha = fichas.get(fila.perfilId);

        return (
          // `data-persona` con el `perfilId`: es el enganche con el que el spec
          // encuentra LA fila de alguien sin buscarla por su nombre ni por su
          // posicion. Una busqueda por nombre ata el test a la ortografia y un
          // indice ata el test al orden.
          <span data-persona={fila.perfilId}>
            {idDeFicha === undefined ? (
              fila.nombreCompleto
            ) : (
              <Link
                data-ficha
                href={`/${slug}/admin/usuarios/${idDeFicha}`}
                className="font-medium text-slate-900 underline underline-offset-2"
              >
                {fila.nombreCompleto}
              </Link>
            )}
          </span>
        );
      },
    },
    {
      // El correo esta porque es con lo que se contacta. El telefono NO viaja
      // en este reporte —`PagoPendiente` no lo trae— y no se va a buscar a
      // otro endpoint: esta en la ficha, que es a donde lleva la fila.
      encabezado: 'Email',
      celda: (fila) => <span data-email>{fila.email}</span>,
    },
    {
      encabezado: 'Pack',
      celda: (fila) =>
        fila.packNombre === null ? (
          <span data-pack data-pack-borrado="si" className="text-amber-700">
            {PACK_QUE_YA_NO_ESTA}
          </span>
        ) : (
          // Sin `data-pack-borrado`: un pack que de verdad se llame «Sin pack»
          // —nada lo impide— tiene que distinguirse del que ya no existe, y la
          // diferencia no puede depender del texto.
          <span data-pack>{fila.packNombre}</span>
        ),
    },
    {
      encabezado: 'Pendiente estimado',
      celda: (fila) => (
        <span className="flex flex-col">
          {/* El importe TAL CUAL sale de `texto`: es el campo que el contrato
              trae para mostrar. Y en un atributo propio, para que el spec
              pueda afirmar por IGUALDAD EXACTA: «100.00» esta dentro de
              «1100.00» y un `toContain` pasaria en verde sobre el numero
              equivocado. El signo de pesos va fuera del nodo marcado. */}
          <span>
            $ <span data-importe>{fila.pendienteEstimado.texto}</span>
          </span>

          {/* La comparacion es con `centavos` —el entero— y nunca con el
              texto: `texto === '0.00'` seria una decision tomada sobre una
              cadena formateada. */}
          {fila.pendienteEstimado.centavos === 0 && (
            <span data-cero-sin-estimar className="text-xs text-amber-700">
              {UN_CERO_NO_ES_ESTAR_AL_DIA}
            </span>
          )}
        </span>
      ),
    },
    {
      // Esta en el reporte porque es la conversacion: quien cancela mucho y no
      // paga no es el mismo caso que quien viene y no paga.
      encabezado: 'Cancelaciones del mes',
      celda: (fila) => <span data-cancelaciones>{fila.cancelacionesDelMes}</span>,
    },
  ];
}

/** La lista ya leida, con su total. */
function LaLista({
  filas,
  fichas,
  slug,
}: {
  filas: readonly PagoPendiente[];
  fichas: Map<string, string>;
  slug: string;
}) {
  return (
    <>
      <Tabla
        etiqueta="A quien hay que llamar"
        columnas={columnas(fichas, slug)}
        filas={filas}
        claveDeFila={(fila) => fila.perfilId}
        vacio={
          <div data-sin-pendientes>
            <Aviso>{NADIE_PENDIENTE}</Aviso>
          </div>
        }
      />

      {filas.length > 0 && (
        <p className="text-sm text-slate-700">
          Suma de los estimados: ${' '}
          <span data-total-estimado>{textoDeCentavos(totalEnCentavos(filas))}</span>
        </p>
      )}
    </>
  );
}

/**
 * El bloque entero, con sus cuatro estados.
 *
 * UNA LISTA VACIA NO SE PARECE A UN FALLO AL LEER, y es la distincion mas cara
 * de esta pantalla despues de la palabra que no se usa. «Nadie debe nada» y
 * «no pude preguntar» llevan a decisiones opuestas: la primera cierra el dia y
 * la segunda obliga a volver a mirar. Un 500 dibujado como una tabla sin filas
 * diria lo primero. Se dice QUE paso, se ofrece reintentar, y no se pinta ni
 * una fila; los dos casos tienen marcas distintas en el DOM y textos
 * distintos.
 */
export function PagosPendientes() {
  const { slug } = useParams<{ slug: string }>();
  const ruta = usePathname();
  const router = useRouter();

  const pendientes = usePagosPendientes();
  const personas = useUsuarios(TODAS_LAS_PERSONAS);

  const sesionCaducada =
    pendientes.error instanceof ErrorDeApi && pendientes.error.esSesionCaducada;

  useEffect(() => {
    if (!sesionCaducada) return;

    // La puerta del panel mira la sesion en el SERVIDOR, y eso pasa una vez al
    // entrar: el token puede caducar con la pantalla abierta, y entonces el
    // unico que se entera es este 401. `SIN_QUERY` es una decision con nombre
    // y no un `''` suelto: esta pantalla no tiene filtros que conservar.
    router.push(destinoDeLoginDesde(ruta, SIN_QUERY, slug));
  }, [sesionCaducada, router, ruta, slug]);

  return (
    <section data-bloque="pagos-pendientes" className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        A quien hay que llamar
      </h2>

      {/* Las dos frases van FUERA de todas las ramas: se leen tambien mientras
          carga y tambien cuando el reporte falla. La frase que explica un
          numero no puede depender de que el numero haya llegado. */}
      <p data-es-un-estimado className="text-sm text-slate-600">
        {ES_UN_ESTIMADO}
      </p>
      <p data-se-mira-hoy className="text-sm text-slate-600">
        {SE_MIRA_HOY}
      </p>

      {pendientes.isPending && <p className="text-sm text-slate-500">Cargando…</p>}

      {/* Sin sesion no se enseña el «Unauthorized» crudo de la API, que no le
          dice nada a nadie, y tampoco se ofrece reintentar: seria volver a
          fallar mientras la pantalla ya se esta yendo al login. */}
      {sesionCaducada && <Aviso tono="error">Tu sesion caduco. Te llevamos al login.</Aviso>}

      {pendientes.error !== null && !sesionCaducada && (
        <div data-fallo-al-leer className="flex flex-col items-start gap-2">
          <Aviso tono="error">
            No se pudo leer quien tiene pagos pendientes: {pendientes.error.message}
          </Aviso>
          <Boton tono="secundario" onClick={() => void pendientes.refetch()}>
            Reintentar
          </Boton>
        </div>
      )}

      {pendientes.data !== undefined && (
        <LaLista filas={pendientes.data} fichas={indiceDeFichas(personas.data)} slug={slug} />
      )}
    </section>
  );
}
