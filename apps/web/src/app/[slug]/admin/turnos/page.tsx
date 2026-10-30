'use client';

import { Suspense, useEffect } from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { SalaPublica, TurnoPublico } from '@boxadmin/shared';
import { Tabla, type ColumnaDeTabla } from '@/componentes/tabla';
import { Aviso, Boton } from '@/componentes/ui';
import { ErrorDeApi } from '@/lib/cliente';
import { destinoDeLoginDesde } from '@/lib/destino-de-login';
import { useSalas } from '@/hooks/use-catalogos';
import { useTurnos } from '@/hooks/use-turnos';
import { FiltrosDelListado, filtrosDeLaBusqueda } from './filtros';

/**
 * El nombre de la sala, NUNCA su id.
 *
 * El turno trae `salaId` y no el nombre, asi que hay que cruzarlo con el
 * catalogo. Cuando el catalogo todavia no llego —o cuando la sala no esta en
 * el— se dice que falta: caer en pintar el identificador seria enseñarle un
 * `clv8x...` a quien esta en el mostrador, que no le sirve de nada y encima
 * parece un error de la pantalla.
 */
function nombreDeSala(salas: readonly SalaPublica[] | undefined, salaId: string): string {
  return salas?.find((sala) => sala.id === salaId)?.nombre ?? 'Sala desconocida';
}

/**
 * LA OCUPACION, DE UN VISTAZO.
 *
 * `7/10` y no "quedan 3": el admin necesita las dos cifras para decidir si
 * mete a alguien mas, y "quedan 3" obliga a sumar para saber de cuanto. El
 * lleno se dice ADEMAS con una palabra y no solo con que los dos numeros
 * coincidan: leer `10/10` y `9/10` en una lista de treinta filas es comparar
 * digito a digito, y el turno lleno es justo el que hay que ver sin leer.
 *
 * Se usa `lugaresLibres` y no `cupo - reservasActivas`: el calculo es de la
 * API, que es la que sabe si las reservas canceladas cuentan.
 */
function ocupacionDelTurno(turno: TurnoPublico): string {
  const cifras = `${turno.reservasActivas}/${turno.cupo}`;
  return turno.lugaresLibres <= 0 ? `${cifras} · Lleno` : cifras;
}

/**
 * Las columnas, declaradas y cerradas.
 *
 * `TurnoPublico` trae ademas `tenantId`, `salaId`, `lugaresLibres` y el `id` de
 * la profesora. Ninguno esta aqui y ninguno tiene que acabar en el DOM: lo que
 * se pinta viaja al navegador aunque este oculto por CSS, y el `tenantId` es
 * justamente el dato que la Fase 0 se ocupo de que no cruzara entre gimnasios.
 * Hay un test que compara los encabezados contra estos seis y otro que compara
 * el contenido de cada fila.
 *
 * Es una funcion y no una constante porque la columna de sala necesita el
 * catalogo, que llega por red.
 */
function columnasDeTurnos(
  salas: readonly SalaPublica[] | undefined,
): readonly ColumnaDeTabla<TurnoPublico>[] {
  return [
    { encabezado: 'Fecha', celda: (turno) => turno.fecha },
    { encabezado: 'Hora', celda: (turno) => `${turno.horaInicio} a ${turno.horaFin}` },
    { encabezado: 'Clase', celda: (turno) => turno.nombre },
    { encabezado: 'Sala', celda: (turno) => nombreDeSala(salas, turno.salaId) },
    {
      encabezado: 'Profesora',
      // Una celda en blanco se lee como "no cargo la pantalla", no como "falta
      // asignarla", y poner suplencias es justo lo que recepcion viene a hacer.
      celda: (turno) => turno.profesor?.nombreCompleto ?? 'Sin profesora',
    },
    { encabezado: 'Ocupación', celda: ocupacionDelTurno },
  ];
}

/**
 * EL LISTADO DE TURNOS: la puerta a la ficha de cada uno.
 *
 * NO TIENE ESTADO PROPIO. Los cinco filtros viven en la URL, como en el
 * listado de personas y en el calendario: asi el enlace se comparte por chat,
 * sobrevive al boton de atras, y la barra de direcciones y la pantalla no
 * pueden decir cosas distintas.
 *
 * NO HAY PAGINACION, y es a proposito: `GET /turnos` devuelve la lista entera y
 * la API no la tiene. Paginar en el cliente daria la ilusion de una capacidad
 * que no existe sobre datos que ya estan todos en memoria. Es un limite
 * conocido y anotado, no un descuido; lo que si hay son filtros de fecha, que
 * es lo que de verdad acota la lista.
 */
function ListadoDeTurnos() {
  const { slug } = useParams<{ slug: string }>();
  const parametros = useSearchParams();
  const ruta = usePathname();
  const router = useRouter();

  const filtros = filtrosDeLaBusqueda(parametros);
  const turnos = useTurnos(filtros);

  // Tal como esta en la barra de direcciones, para que la ficha se la lleve.
  const consulta = parametros.toString();

  // El MISMO catalogo que dibuja el selector de salas. Es una sola peticion
  // porque la clave es la misma; pedirlo aqui por separado seria una segunda.
  const { data: salas, error: errorDeSalas } = useSalas();

  /**
   * LAS CONSULTAS PUEDEN TRAER EL 401, no solo la de la lista.
   *
   * Un solo booleano y un solo efecto: si cada consulta empujara por su cuenta,
   * una sesion caducada con las tres fallando mandaria al login tres veces y
   * dejaria dos entradas basura en el historial. El catalogo de profesoras lo
   * pide el componente de filtros y su error no llega aqui; las dos de esta
   * pantalla, si.
   */
  const sesionCaducada =
    (turnos.error instanceof ErrorDeApi && turnos.error.esSesionCaducada) ||
    (errorDeSalas instanceof ErrorDeApi && errorDeSalas.esSesionCaducada);

  useEffect(() => {
    if (!sesionCaducada) return;

    // El layout del panel ya mira la sesion en el servidor, pero eso pasa una
    // vez al entrar: el token puede caducar con la pantalla abierta, y entonces
    // el unico que se entera es este 401.
    // El destino se arma en `lib/destino-de-login` y no aqui: conserva los
    // filtros, que viven en la URL. Volver del login al listado entero es
    // perder el rango de fechas y la sala que la persona acababa de armar.
    router.push(destinoDeLoginDesde(ruta, parametros.toString(), slug));
  }, [sesionCaducada, router, ruta, parametros, slug]);

  const hayFiltros = Object.keys(filtros).length > 0;

  return (
    <div className="flex flex-col gap-4">
      <FiltrosDelListado />

      {turnos.isPending && <p className="text-sm text-slate-500">Cargando…</p>}

      {/* Sin sesion no se enseña el mensaje crudo de la API: «Unauthorized»
          delante del mostrador no le dice nada a nadie, y encima la pantalla ya
          se esta yendo al login. Y reintentar sin sesion es volver a fallar:
          por eso tampoco se ofrece el boton. */}
      {sesionCaducada && <Aviso tono="error">Tu sesion caduco. Te llevamos al login.</Aviso>}

      {turnos.error !== null && !sesionCaducada && (
        <div className="flex flex-col items-start gap-2">
          <Aviso tono="error">{turnos.error.message}</Aviso>
          {/* Un fallo de red se arregla solo cuando vuelve la red, y quien esta
              en el mostrador necesita poder volver a intentarlo sin recargar y
              perder los filtros. */}
          <Boton tono="secundario" onClick={() => void turnos.refetch()}>
            Reintentar
          </Boton>
        </div>
      )}

      {turnos.data !== undefined && (
        <Tabla
          etiqueta="Turnos"
          columnas={columnasDeTurnos(salas)}
          filas={turnos.data}
          claveDeFila={(turno) => turno.id}
          /* LA FICHA SE LLEVA LOS FILTROS PUESTOS.
             No es decoracion de la URL: es lo que permite que el volver desde
             la ficha —tras borrar el turno, o tras pasar por el login— lleve a
             ESTA lista y no a la del gimnasio entero. Sin esto, el admin que
             tenia el jueves de la sala chica la pierde en cuanto entra en un
             turno, y la unica forma de recuperarla es armarla a mano otra vez. */
          enlaceDeFila={(turno) =>
            `/${slug}/admin/turnos/${turno.id}${consulta === '' ? '' : `?${consulta}`}`
          }
          vacio={
            <Aviso>
              {hayFiltros
                ? 'No hay turnos que coincidan con estos filtros.'
                : 'Todavia no hay turnos cargados en el gimnasio.'}
            </Aviso>
          }
        />
      )}
    </div>
  );
}

/**
 * `useSearchParams` obliga a una frontera de Suspense.
 *
 * Sin ella, `next build` falla en cuanto algo deje esta ruta prerenderizable, y
 * el error ("missing-suspense-with-csr-bailout") aparece lejos de aqui y cuesta
 * de ubicar. El encabezado queda FUERA para que no parpadee.
 */
export default function PaginaDeTurnos() {
  const { slug } = useParams<{ slug: string }>();

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold text-slate-900">Turnos</h1>
        {/* El panel entero ya exige ADMIN_OPERATIVO: el enlace no necesita una
            puerta propia. */}
        <Link
          href={`/${slug}/admin/turnos/nuevo`}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Nuevo turno
        </Link>
      </div>

      <Suspense fallback={<p className="text-sm text-slate-500">Cargando…</p>}>
        <ListadoDeTurnos />
      </Suspense>
    </section>
  );
}
