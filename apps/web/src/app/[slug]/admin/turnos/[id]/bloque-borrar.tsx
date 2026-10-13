'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { TurnoPublico } from '@boxadmin/shared';
import { Confirmar } from '@/componentes/confirmar';
import { Aviso, Boton, Tarjeta } from '@/componentes/ui';
import { queryDeTurnos, useBorrarTurno } from '@/hooks/use-turnos';
import { filtrosDeLaBusqueda } from '../filtros';
import { mensajeDeFallo } from '../../usuarios/[id]/errores';

/**
 * Borrar el turno. `DELETE /turnos/:id`.
 *
 * El borrado es FISICO, a diferencia de las bajas logicas de salas, packs y
 * personas: el turno desaparece. Y la API lo permite SOLO si no queda nadie
 * anotado —«El turno tiene N reserva(s) activa(s). Cancelalas antes de
 * borrarlo.»—, porque borrarlo con gente dentro seria decidir por ellos.
 *
 * DE AHI LAS DOS MITADES DE ESTE BLOQUE:
 *
 * 1. Con anotados NO SE OFRECE. La regla se sabe de antemano y esta en la
 *    respuesta que ya tenemos cargada (`reservasActivas`). Ofrecer el boton,
 *    abrir el dialogo, pedir confirmacion y recien entonces contestar con el
 *    409 convierte una regla conocida en un error, y deja al admin creyendo
 *    que borro el turno hasta que lee el cartel. Y no se "deshabilita": un
 *    boton deshabilitado sigue en el DOM.
 *
 * 2. Y AUN ASI SE MANEJA EL 409. El recuento es el de la ultima lectura: entre
 *    esa lectura y la confirmacion, alguien se anota desde su telefono. Sin
 *    esto, el dialogo se cerraria y el admin daria por borrado un turno vivo.
 */
export function BloqueDeBorrar({ turno, slug }: { turno: TurnoPublico; slug: string }) {
  const borrar = useBorrarTurno(turno.id);
  const router = useRouter();
  const parametros = useSearchParams();

  const [confirmando, setConfirmando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);

  const hayAnotados = turno.reservasActivas > 0;

  async function borrarlo(): Promise<void> {
    setFallo(null);

    try {
      await borrar.mutateAsync();

      /**
       * La ficha que estaba abierta ya no existe: quedarse aqui dejaria la
       * pantalla pidiendo un turno borrado y contestando 404. Se vuelve al
       * listado, que es de donde se vino — Y CON LOS FILTROS CON LOS QUE SE
       * VINO.
       *
       * El listado los guarda en la URL y la ficha los arrastra, asi que aqui
       * estan: volver al listado pelado le deja al admin la lista entera del
       * gimnasio donde tenia el jueves de la sala chica, y la unica forma de
       * recuperarla es volver a armarla a mano.
       *
       * Pasan por `filtrosDeLaBusqueda` y `queryDeTurnos` —las dos del
       * listado— y no en crudo: asi viajan los filtros y SOLO los filtros. Lo
       * que la URL de la ficha lleve por su cuenta (un `volverA` del login, por
       * ejemplo) no significa nada en el listado y no tiene por que aparecer en
       * la barra de direcciones de nadie.
       */
      router.push(`/${slug}/admin/turnos${queryDeTurnos(filtrosDeLaBusqueda(parametros))}`);
    } catch (error) {
      setFallo(mensajeDeFallo(error, 'ADMIN_OPERATIVO'));
    }
  }

  return (
    <Tarjeta>
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Borrar</h2>

        {hayAnotados ? (
          /* El mismo numero y las mismas palabras que daria la API, pero ANTES
             de intentarlo. Y dice que hacer: el bloque de anotados, que esta
             justo arriba, es donde se cancelan esas reservas. */
          <Aviso tono="error">
            No se puede borrar: el turno tiene {turno.reservasActivas} reserva(s) activa(s).
            Cancelalas antes de borrarlo.
          </Aviso>
        ) : confirmando ? (
          <Confirmar
            /* LA PREGUNTA NOMBRA EL TURNO ENTERO: el nombre no alcanza. Un
               gimnasio tiene "Flow" los lunes, los miercoles y los viernes, y
               la ficha pudo quedar abierta en una pestaña de ayer. */
            pregunta={`Borrar ${turno.nombre} del ${turno.fecha} de ${turno.horaInicio} a ${turno.horaFin}`}
            detalle="El turno desaparece del calendario. Esto no se puede deshacer."
            textoDeConfirmar="Borrar turno"
            cargando={borrar.isPending}
            error={fallo ?? undefined}
            alConfirmar={() => void borrarlo()}
            alCancelar={() => {
              setConfirmando(false);
              setFallo(null);
            }}
          />
        ) : (
          <div>
            <Boton type="button" tono="peligro" onClick={() => setConfirmando(true)}>
              Borrar turno
            </Boton>
          </div>
        )}
      </div>
    </Tarjeta>
  );
}
