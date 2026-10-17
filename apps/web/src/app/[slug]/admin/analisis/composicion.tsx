'use client';

import type { ComposicionAlumnos, ComposicionPorPack, ConsumoDeAlumno } from '@boxadmin/shared';
import { Tabla, type ColumnaDeTabla } from '@/componentes/tabla';
import { Aviso, Boton } from '@/componentes/ui';
import { ErrorDeApi } from '@/lib/cliente';
import { useComposicionAlumnos, type Mes } from '@/hooks/use-stats';
import { textoDelMes } from './filtros';

/**
 * LA COMPOSICION DE ALUMNOS: en que pack esta cada uno y cuantas clases tomo.
 *
 * ESTE BLOQUE NO LLEVA PUERTA DE ROL, y es una decision y no un olvido.
 * `/stats/composicion-alumnos` pide `ADMIN_OPERATIVO`, que es el rol MINIMO con
 * el que se entra al panel: cualquiera que vea esta pantalla puede pedir este
 * reporte, y una comprobacion que nunca puede fallar es ruido que el proximo
 * lector confundiria con una defensa. La puerta de verdad es la de la caja, y
 * vive en `page.tsx`.
 *
 * ---------------------------------------------------------------------------
 * `packId: null` NO ES UN PACK QUE SE LLAME «Sin pack».
 *
 * El service agrupa a los alumnos sin plan contratado bajo el nombre
 * `'Sin pack'`, y ADEMAS le pone ese mismo nombre al pack borrado cuyo id ya no
 * esta en la tabla (`packs.get(packId)?.nombre ?? SIN_PACK`). O sea que el
 * NOMBRE no distingue tres situaciones distintas, y nada impide que un gimnasio
 * llame «Sin pack» a un plan de verdad.
 *
 * Quien distingue es `packId`: `null` es «no tiene plan contratado» y cualquier
 * otra cosa es un plan —existente o borrado—. Esta pantalla se ramifica por el
 * ID y nunca por el nombre, y lo dice tambien con palabras al lado de la fila:
 * «no tienen ningun plan contratado» es informacion para quien mira, no un
 * detalle de implementacion. Mezclarlos haria que el grupo de los que no pagan
 * nada se escondiera dentro de un plan que si se cobra.
 */

/** Lo que se le dice a quien mira cuando una fila es la de los que no tienen plan. */
export const SIN_PLAN_CONTRATADO = 'no tienen ningun plan contratado';

/**
 * LA LIMITACION QUE EL SERVICE DECLARA, DICHA EN LA PANTALLA.
 *
 * El reparto por pack es la foto de HOY aunque el consumo sea del mes pedido:
 * el sistema no guarda historial de packs —`Perfil.packId` es el actual y
 * punto—. Sin esta frase, la composicion de marzo del año pasado se lee como
 * «asi estaban repartidos en marzo», que es falso y no hay forma de notarlo
 * mirando la tabla.
 */
export const NOTA_DE_LA_FOTO =
  'El reparto por pack es la foto de hoy, aunque las clases tomadas sean las del mes elegido: el ' +
  'sistema no guarda historial de packs.';

/** Las clases SALEN DE LAS RESERVAS VIVAS: una cancelada no es una clase tomada. */
export const NOTA_DEL_CONSUMO =
  'Las clases tomadas son las reservas vivas del mes: una reserva cancelada no es una clase ' +
  'tomada.';

/**
 * Las columnas del reparto por pack.
 *
 * EL PORCENTAJE ES EL DEL SERVIDOR y aqui no se divide nada, igual que en los
 * cinco porcentajes del operativo. `alumnos / totalAlumnos` calculado desde
 * este lado seria una segunda implementacion del mismo numero, y el dia que las
 * dos discrepen nadie sabria cual creer. Ademas este porcentaje tiene un
 * denominador que el servidor conoce mejor: cuenta sobre los alumnos ACTIVOS,
 * que no son necesariamente las filas que se ven.
 */
function columnasDelReparto(): readonly ColumnaDeTabla<ComposicionPorPack>[] {
  return [
    {
      encabezado: 'Pack',
      celda: (fila) => (
        <span
          // Dos atributos y no uno: el id vacio distingue al grupo sin plan de
          // cualquier pack, y `data-sin-pack` lo dice sin que haya que saber
          // que una cadena vacia significa eso.
          data-pack-id={fila.packId ?? ''}
          data-sin-pack={fila.packId === null ? 'si' : undefined}
        >
          {fila.packNombre}
          {fila.packId === null && <span className="text-slate-500"> — {SIN_PLAN_CONTRATADO}</span>}
        </span>
      ),
    },
    { encabezado: 'Alumnos', celda: (fila) => <span data-alumnos>{fila.alumnos}</span> },
    {
      encabezado: 'Parte del total',
      celda: (fila) => <span data-porcentaje>{fila.porcentaje}%</span>,
    },
  ];
}

function columnasDelConsumo(): readonly ColumnaDeTabla<ConsumoDeAlumno>[] {
  return [
    {
      encabezado: 'Alumno',
      celda: (fila) => <span data-alumno={fila.perfilId}>{fila.nombreCompleto}</span>,
    },
    {
      encabezado: 'Clases tomadas',
      celda: (fila) => <span data-clases>{fila.clasesTomadas}</span>,
    },
  ];
}

/** La composicion ya leida. El mes sale de la RESPUESTA, no del selector. */
function ComposicionLeida({ composicion }: { composicion: ComposicionAlumnos }) {
  return (
    <>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        Los alumnos de {textoDelMes(composicion)}
      </h2>

      <p className="text-sm text-slate-700">
        Alumnos activos: <span data-total-alumnos>{composicion.totalAlumnos}</span>
      </p>

      <p className="text-xs text-slate-500">{NOTA_DE_LA_FOTO}</p>

      <Tabla
        etiqueta="Los alumnos por pack"
        columnas={columnasDelReparto()}
        filas={composicion.porPack}
        claveDeFila={(fila) => fila.packId ?? 'sin-pack'}
        vacio={<Aviso>Todavia no hay alumnos activos en el gimnasio.</Aviso>}
      />

      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        Las clases que tomo cada alumno
      </h3>
      <p className="text-xs text-slate-500">{NOTA_DEL_CONSUMO}</p>

      <Tabla
        etiqueta="Las clases que tomo cada alumno"
        columnas={columnasDelConsumo()}
        filas={composicion.consumo}
        claveDeFila={(fila) => fila.perfilId}
        vacio={<Aviso>Ningun alumno tomo clases este mes.</Aviso>}
      />
    </>
  );
}

/**
 * El bloque entero, con sus tres estados.
 *
 * La sesion caducada no se dibuja aqui, por el mismo motivo que en la caja: el
 * panel ya lo dice una vez y un 401 solo puede ser global.
 */
export function BloqueDeComposicion({ mes }: { mes: Mes }) {
  const composicion = useComposicionAlumnos(mes);

  if (composicion.error instanceof ErrorDeApi && composicion.error.esSesionCaducada) return null;

  return (
    <section data-bloque="composicion" className="flex flex-col gap-2">
      {composicion.isPending && <p className="text-sm text-slate-500">Cargando los alumnos…</p>}

      {composicion.error !== null && (
        <div className="flex flex-col items-start gap-2">
          <Aviso tono="error">No se pudo leer la composicion: {composicion.error.message}</Aviso>
          <Boton tono="secundario" onClick={() => void composicion.refetch()}>
            Reintentar los alumnos
          </Boton>
        </div>
      )}

      {composicion.data !== undefined && <ComposicionLeida composicion={composicion.data} />}
    </section>
  );
}
