'use client';

import { useId, useState } from 'react';
import type { TurnoPublico } from '@boxadmin/shared';
import { Aviso, Boton, Tarjeta } from '@/componentes/ui';
import { useAsignarProfesor } from '@/hooks/use-turnos';
import { useUsuarios } from '@/hooks/use-usuarios';
import { mensajeDeFallo } from '../../usuarios/[id]/errores';

/**
 * La profesora del turno. `PATCH /turnos/:id/profesor`.
 *
 * Es la SUPLENCIA: cambia quien da ESTE turno sin tocar el patron semanal de
 * nadie. Por eso es su propio bloque y su propio endpoint, y no un campo mas
 * del formulario de datos —`ActualizarTurnoDto` ni siquiera acepta
 * `profesorId`—.
 *
 * EL CATALOGO SE PIDE AL ABRIR EL SELECTOR, NO AL MONTAR. De las tres acciones
 * de esta ficha, cambiar la profesora es la mas rara: traer el padron entero de
 * profesoras cada vez que alguien abre un turno es una peticion que casi nunca
 * se usa, en una pantalla que se abre todo el dia. Se consigue montando el
 * selector —que es quien llama a `useUsuarios`— solo cuando hace falta: un
 * hook que no esta montado no pide nada, y asi no hay ningun `enabled` que
 * alguien pueda invertir sin querer.
 */
export function BloqueDeProfesora({ turno }: { turno: TurnoPublico }) {
  const [cambiando, setCambiando] = useState(false);

  return (
    <Tarjeta>
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Profesora</h2>

        <p className="text-sm text-slate-700">
          {turno.profesor === null ? 'Sin profesora asignada.' : turno.profesor.nombreCompleto}
        </p>

        {cambiando ? (
          <SelectorDeProfesora turno={turno} alTerminar={() => setCambiando(false)} />
        ) : (
          <div>
            <Boton type="button" tono="secundario" onClick={() => setCambiando(true)}>
              Cambiar profesora
            </Boton>
          </div>
        )}
      </div>
    </Tarjeta>
  );
}

/**
 * El selector, que es TAMBIEN quien pide el catalogo.
 *
 * Que las dos cosas vivan en el mismo componente no es casualidad: mientras el
 * hook este aqui dentro, "se pide el catalogo" y "hay donde elegir" son el
 * mismo hecho, y no se pueden separar por accidente.
 */
function SelectorDeProfesora({
  turno,
  alTerminar,
}: {
  turno: TurnoPublico;
  alTerminar: () => void;
}) {
  const asignar = useAsignarProfesor(turno.id);
  const { data: profesoras, isPending, error } = useUsuarios({ tipo: 'profesor' });

  /**
   * `TurnoPublico.profesor.id` ES UN `perfilId`, no el id del usuario.
   *
   * `aTurnoPublico` lo arma con `id: turno.profesorId`, y esa columna
   * referencia a `Perfil`. Por eso sembrar el selector con el, y por eso cada
   * `<option>` lleva el `perfilId` de su profesora y no el `id` de su usuario:
   * si los dos lados no hablaran el mismo idioma, el valor inicial no casaria
   * con ninguna opcion y el desplegable arrancaria en cualquier otra cosa.
   */
  const [elegida, setElegida] = useState(turno.profesor?.id ?? '');
  const [fallo, setFallo] = useState<string | null>(null);

  const idControl = useId();

  /**
   * Las que se pueden poner, mas la que YA ESTA aunque no se pueda poner.
   *
   * Una profesora dada de baja no se ofrece: ofrecerla seria ofrecer algo que
   * el gimnasio ya decidio que no. Pero si es la que esta puesta tiene que
   * figurar igual, porque si no el selector arrancaria en "sin profesora" para
   * un turno que SI tiene una, y guardar cualquier otra cosa seria guardar
   * encima de una pantalla que miente.
   */
  const asignables = (profesoras ?? []).filter((profesora) => profesora.activo);
  const puesta = turno.profesor;
  // CONTRA EL `perfilId`, que es el espacio de id del que sale `puesta.id`.
  // Comparado contra `profesora.id` —el del usuario— esto cruza los dos
  // espacios y da SIEMPRE `true`: cualquier turno con profesora asignada
  // mostraria una opcion duplicada «(dada de baja)» aunque este activa.
  const faltaLaPuesta =
    puesta !== null && !asignables.some((profesora) => profesora.perfilId === puesta.id);

  const opciones = [
    // "Sin profesora" SIEMPRE: quitarla es una accion legitima del turno, no la
    // ausencia de una eleccion. Ver `guardar`.
    { valor: '', texto: 'Sin profesora' },
    ...(faltaLaPuesta
      ? [{ valor: puesta.id, texto: `${puesta.nombreCompleto} (dada de baja)` }]
      : []),
    // El `perfilId`, que es lo que `AsignarProfesorDto.profesorId` nombra: el
    // service lo valida con `perfil.findFirst({ where: { id: profesorId } })`.
    // Con el id del usuario, asignar una suplencia contesta 404 «Perfil
    // inexistente» para una profesora que el admin acaba de elegir del
    // desplegable.
    ...asignables.map((profesora) => ({
      valor: profesora.perfilId,
      texto: profesora.nombreCompleto,
    })),
  ];

  async function guardar(): Promise<void> {
    setFallo(null);

    try {
      /**
       * `null` EXPLICITO, nunca `undefined`.
       *
       * `AsignarProfesorDto` usa `@ValidateIf` y no `@IsOptional` a proposito:
       * `profesorId: null` es un valor legitimo —quitar la profesora— y la API
       * tiene que poder distinguirlo de "no vino la clave". Si esto mandara
       * `undefined`, `JSON.stringify` borraria la clave del cuerpo, el DTO la
       * daria por ausente y el turno se quedaria con la profesora que tenia:
       * un 200 que no hizo nada, en verde, sin que nadie se entere hasta que
       * la profesora que ya no da esa clase aparezca en su agenda.
       */
      await asignar.mutateAsync(elegida === '' ? null : elegida);
      alTerminar();
    } catch (error) {
      setFallo(mensajeDeFallo(error, 'ADMIN_OPERATIVO'));
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {error !== null && (
        <Aviso>No pudimos traer el padron de profesoras: solo se puede quitar la que esta.</Aviso>
      )}

      {fallo !== null && <Aviso tono="error">{fallo}</Aviso>}

      <div className="flex flex-col gap-1">
        {/* `htmlFor` y no una etiqueta que envuelva al select: envolviendolo, el
            nombre accesible se lleva por delante el texto de las opciones. */}
        <label htmlFor={idControl} className="text-sm font-medium text-slate-700">
          Profesora a cargo
        </label>
        <select
          id={idControl}
          value={elegida}
          onChange={(evento) => setElegida(evento.target.value)}
          aria-invalid={fallo !== null}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
        >
          {opciones.map((opcion) => (
            <option key={opcion.valor} value={opcion.valor}>
              {opcion.texto}
            </option>
          ))}
        </select>
      </div>

      {isPending && <p className="text-sm text-slate-500">Buscando profesoras…</p>}

      <div className="flex gap-2">
        <Boton type="button" cargando={asignar.isPending} onClick={() => void guardar()}>
          Guardar profesora
        </Boton>
        <Boton type="button" tono="secundario" onClick={alTerminar}>
          Cancelar
        </Boton>
      </div>
    </div>
  );
}
