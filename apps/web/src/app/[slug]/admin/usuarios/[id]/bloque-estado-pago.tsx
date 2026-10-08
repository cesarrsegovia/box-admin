'use client';

import { useState } from 'react';
import { PATRON_FECHA, type UsuarioDetalle } from '@boxadmin/shared';
import { Campo } from '@/componentes/formulario';
import { Aviso, Boton, Tarjeta } from '@/componentes/ui';
import { ErrorDeApi } from '@/lib/cliente';
import { type EstadoDePago, useFijarEstadoDePago } from '@/hooks/use-usuarios';
import { mensajeDeFallo } from './errores';

/**
 * El override del admin sobre el estado de pago. `PATCH /usuarios/:id/estado-pago`.
 *
 * `cubreHasta` ES OBLIGATORIO CUANDO `alDia` ES TRUE, PERO LO COMPRUEBA EL
 * SERVICIO Y NO EL DTO. Eso cambia como se siente el olvido: no vuelve un error
 * de validacion que señale un campo, vuelve un 400 suelto ("Para ponerlo al dia
 * hace falta cubreHasta") que la pantalla no sabria donde colgar. Por eso la
 * comprobacion esta aqui y la peticion ni sale.
 *
 * `pagoAlDia` del usuario es DERIVADO (hay un pago vigente que cubre hoy), no
 * una columna: marcar "al dia" no la escribe, crea una cortesia de importe cero
 * que cubre hasta la fecha indicada.
 */
export function BloqueDeEstadoDePago({ usuario }: { usuario: UsuarioDetalle }) {
  const guardar = useFijarEstadoDePago(usuario.id);

  const [alDia, setAlDia] = useState(usuario.pagoAlDia);
  const [cubreHasta, setCubreHasta] = useState('');
  const [nota, setNota] = useState('');
  const [errorDeFecha, setErrorDeFecha] = useState<string | undefined>(undefined);
  const [aviso, setAviso] = useState<string | null>(null);

  async function enviar(): Promise<void> {
    setAviso(null);
    setErrorDeFecha(undefined);

    if (alDia && cubreHasta === '') {
      setErrorDeFecha('Para ponerlo al dia hace falta la fecha hasta la que queda cubierto.');
      return;
    }

    if (alDia && !PATRON_FECHA.test(cubreHasta)) {
      setErrorDeFecha('La fecha va como YYYY-MM-DD.');
      return;
    }

    /**
     * El cuerpo lleva lo que TIENE EFECTO y nada mas.
     *
     * `cubreHasta` con `alDia: false` no seria un 400 —esta en el DTO— pero el
     * servicio lo ignora al anular las cortesias: dejarlo en el cuerpo seria
     * mandar una fecha que el admin escribio y que no va a hacer nada.
     */
    const cuerpo: EstadoDePago = { alDia };
    if (alDia) cuerpo.cubreHasta = cubreHasta;
    if (nota !== '') cuerpo.nota = nota;

    try {
      await guardar.mutateAsync(cuerpo);
    } catch (fallo) {
      if (!(fallo instanceof ErrorDeApi)) throw fallo;
      setAviso(mensajeDeFallo(fallo, 'ADMIN_OPERATIVO'));
    }
  }

  return (
    <Tarjeta>
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Estado de pago
        </h2>

        <p className="text-sm text-slate-700">Hoy: {usuario.pagoAlDia ? 'al dia' : 'debe'}.</p>

        {aviso !== null && <Aviso tono="error">{aviso}</Aviso>}

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={alDia} onChange={() => setAlDia((antes) => !antes)} />
          Al dia
        </label>

        <Campo
          etiqueta="Cubre hasta"
          placeholder="YYYY-MM-DD"
          value={cubreHasta}
          error={errorDeFecha}
          onChange={(evento) => setCubreHasta(evento.target.value)}
        />

        <Campo etiqueta="Nota" value={nota} onChange={(evento) => setNota(evento.target.value)} />

        <div>
          <Boton type="button" cargando={guardar.isPending} onClick={() => void enviar()}>
            Guardar estado
          </Boton>
        </div>
      </div>
    </Tarjeta>
  );
}
