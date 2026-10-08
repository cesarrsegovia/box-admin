'use client';

import { useEffect, useId } from 'react';
import { Aviso, Boton } from './ui';

/**
 * El dialogo que confirma una accion destructiva.
 *
 * `pregunta` es OBLIGATORIA y no tiene valor por defecto a proposito: este
 * componente no sabe decir "¿estas seguro?". Si lo supiera, una pantalla podria
 * usarlo sin nombrar a nadie y el fallo no se veria hasta que alguien diera de
 * baja a quien no era. Quien lo usa tiene que escribir la frase entera —"Dar de
 * baja a Ana Perez"— y por eso cada pantalla tiene su test de que la escribe.
 *
 * No hay portal ni fondo que bloquee la pagina: es un dialogo en linea, debajo
 * del boton que lo abrio. Un `<dialog>` nativo con `showModal()` no funciona en
 * jsdom y traeria el foco atrapado como problema nuevo sin que nadie lo pida.
 */
export function Confirmar({
  pregunta,
  detalle,
  textoDeConfirmar,
  cargando = false,
  error,
  alConfirmar,
  alCancelar,
}: {
  /** La frase entera, CON el nombre de a quien o a que afecta. */
  pregunta: string;
  /** La consecuencia que no es obvia, cuando la hay. */
  detalle?: string;
  textoDeConfirmar: string;
  cargando?: boolean;
  /** Lo que fallo al intentarlo. Se pinta aqui dentro, no detras del dialogo. */
  error?: string | undefined;
  alConfirmar: () => void;
  alCancelar: () => void;
}) {
  const idPregunta = useId();

  useEffect(() => {
    function alTeclear(evento: KeyboardEvent): void {
      if (evento.key === 'Escape') alCancelar();
    }

    document.addEventListener('keydown', alTeclear);
    return () => document.removeEventListener('keydown', alTeclear);
  }, [alCancelar]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={idPregunta}
      className="flex flex-col gap-3 rounded-xl border border-slate-300 bg-white p-4 shadow-md"
    >
      <p id={idPregunta} className="text-sm font-medium text-slate-900">
        {pregunta}
      </p>

      {detalle !== undefined && <p className="text-sm text-slate-600">{detalle}</p>}

      {error !== undefined && <Aviso tono="error">{error}</Aviso>}

      <div className="flex gap-2">
        {/* `type="button"` en los dos: el dialogo se abre desde pantallas que
            son formularios, y un boton sin tipo dentro de un `<form>` envia el
            formulario de detras. Cancelar enviando es lo contrario de cancelar. */}
        {/* El foco arranca en CANCELAR. Con el foco en la accion destructiva,
            quien venia pulsando con el teclado la confirma con un Enter de
            inercia. */}
        {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
        <Boton autoFocus type="button" tono="secundario" onClick={alCancelar}>
          Cancelar
        </Boton>
        <Boton type="button" tono="peligro" cargando={cargando} onClick={alConfirmar}>
          {textoDeConfirmar}
        </Boton>
      </div>
    </div>
  );
}
