'use client';

import { useState } from 'react';
import type { SalaPublica, UsuarioDetalle } from '@boxadmin/shared';
import { Aviso, Boton, Tarjeta } from '@/componentes/ui';
import { ErrorDeApi } from '@/lib/cliente';
import { useSalas } from '@/hooks/use-catalogos';
import { useActualizarSalas } from '@/hooks/use-usuarios';
import { mensajeDeFallo } from './errores';

/**
 * Las salas de la persona. `PATCH /usuarios/:id/salas`.
 *
 * El cuerpo es el CONJUNTO FINAL, no un agregado: la API borra las relaciones y
 * las vuelve a crear con lo que llegue. Por eso el control natural es una lista
 * de casillas sobre el catalogo entero y no un "agregar sala".
 *
 * VACIO NO SE MANDA. El DTO lo rechaza con un 400 y un mensaje largo; avisarlo
 * aqui ahorra el viaje y, sobre todo, dice la alternativa de verdad: quien vacia
 * las salas casi siempre queria dar de baja a la persona.
 */

const SIN_SALAS =
  'Un usuario sin salas no puede reservar nada. Marca al menos una sala, o da de baja ' +
  'a la persona si es eso lo que querias.';

export function BloqueDeSalas({ usuario }: { usuario: UsuarioDetalle }) {
  const guardar = useActualizarSalas(usuario.id);
  const { data: catalogo } = useSalas();
  const [elegidas, setElegidas] = useState<readonly string[]>(usuario.salaIds);
  const [aviso, setAviso] = useState<string | null>(null);

  /**
   * El catalogo del gimnasio, o lo que la persona ya tiene si no llego.
   *
   * `UsuarioDetalle.salas` trae SOLO las suyas: con esa lista se puede quitar
   * pero no agregar. Degradar a "solo quitar" es peor que no pintar nada, asi
   * que se avisa.
   */
  const salas: readonly SalaPublica[] = catalogo ?? usuario.salas;

  function alternar(id: string): void {
    setAviso(null);
    setElegidas((antes) =>
      antes.includes(id) ? antes.filter((otra) => otra !== id) : [...antes, id],
    );
  }

  async function enviar(): Promise<void> {
    setAviso(null);

    // El orden sale del CATALOGO y no del orden en que se fueron marcando: asi
    // dos guardados con las mismas salas mandan el mismo cuerpo.
    const salaIds = salas.map((sala) => sala.id).filter((id) => elegidas.includes(id));

    if (salaIds.length === 0) {
      setAviso(SIN_SALAS);
      return;
    }

    try {
      await guardar.mutateAsync(salaIds);
    } catch (fallo) {
      if (!(fallo instanceof ErrorDeApi)) throw fallo;
      setAviso(mensajeDeFallo(fallo, 'ADMIN_OPERATIVO'));
    }
  }

  return (
    <Tarjeta>
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Salas</h2>

        {catalogo === undefined && (
          <Aviso>No pudimos traer el catalogo de salas: solo se ven las que ya tiene.</Aviso>
        )}

        {aviso !== null && <Aviso tono="error">{aviso}</Aviso>}

        <ul aria-label="Salas" className="flex flex-col gap-1">
          {salas.map((sala) => (
            <li key={sala.id}>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={elegidas.includes(sala.id)}
                  onChange={() => alternar(sala.id)}
                />
                {sala.nombre}
              </label>
            </li>
          ))}
        </ul>

        <div>
          <Boton type="button" cargando={guardar.isPending} onClick={() => void enviar()}>
            Guardar salas
          </Boton>
        </div>
      </div>
    </Tarjeta>
  );
}
