'use client';

import { useEffect, useId, useState } from 'react';
import type { Advertencia } from '@boxadmin/shared';
import { Boton } from '@/componentes/ui';

/**
 * LA UNICA PANTALLA DEL SISTEMA QUE MUESTRA ALGO UNA SOLA VEZ.
 *
 * `POST /usuarios/alumnos` devuelve `passwordTemporal` en la respuesta del alta
 * y no hay forma de releerla: no existe un `GET` que la devuelva, y el unico
 * camino de vuelta es `POST /usuarios/:id/reset-password`, que pide
 * `ADMIN_SALON`. El alta, en cambio, la hace `ADMIN_OPERATIVO`.
 *
 * O sea: quien da de alta y pierde la clave NO PUEDE REPARARLO SOLO. Tiene que
 * ir a buscar al dueño del gimnasio. El costo de perderla lo paga otra persona,
 * y por eso esta pantalla es incomoda a proposito:
 *
 * - no se cierra con Escape (`Confirmar` si lo hace; aqui seria perderla);
 * - no se cierra haciendo clic afuera;
 * - no se puede seguir sin marcar "ya la anote";
 * - avisa antes de que un F5 se la lleve por delante.
 *
 * Y la clave NO SALE DE AQUI: no viaja en la URL, no se guarda en
 * `localStorage` ni en `sessionStorage`, y no se copia sola al portapapeles.
 * Copiar es una accion que se pide; el portapapeles del sistema sobrevive al
 * cierre del navegador y la maquina del mostrador la usan cuatro personas.
 */
export function ClaveTemporal({
  nombre,
  clave,
  advertencias,
  alTerminar,
}: {
  /** De quien es, con nombre y apellido: el admin suele dar de alta en tanda. */
  nombre: string;
  clave: string;
  /**
   * Lo que salio bien pero conviene mirar (`SIN_SALAS`, `SIN_PACK`).
   *
   * Van AQUI y no en un cartel que se desvanece: esta es la unica pantalla de
   * la fase donde el admin esta obligado a detenerse. Un aviso de tres segundos
   * sobre alguien que esta copiando una contraseña no lo lee nadie.
   */
  advertencias: Advertencia[];
  alTerminar: () => void;
}) {
  const idTitulo = useId();
  const [anotada, setAnotada] = useState(false);
  const [copia, setCopia] = useState<'sin-pedir' | 'hecha' | 'fallo'>('sin-pedir');

  /**
   * Un F5 con la clave en pantalla la borra sin decir nada, y el alumno ya esta
   * creado. `beforeunload` es lo unico que el navegador ofrece para frenarlo.
   *
   * Se quita en cuanto marca que la anoto: a partir de ahi molestar es ruido, y
   * el aviso que aparece siempre es el que se aprende a ignorar.
   */
  useEffect(() => {
    if (anotada) return undefined;

    function alSalir(evento: BeforeUnloadEvent): void {
      evento.preventDefault();
    }

    window.addEventListener('beforeunload', alSalir);
    return () => window.removeEventListener('beforeunload', alSalir);
  }, [anotada]);

  async function copiar(): Promise<void> {
    try {
      await navigator.clipboard.writeText(clave);
      setCopia('hecha');
    } catch {
      // Sin HTTPS, o sin permiso, `writeText` rechaza. Decirlo importa: el
      // admin se iria creyendo que la tiene en el portapapeles.
      setCopia('fallo');
    }
  }

  return (
    // `role="dialog"` SIN cierre: ni `onClick` en un fondo, ni listener de
    // Escape. Es un dialogo porque interrumpe, no porque se pueda descartar.
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby={idTitulo}
      className="flex flex-col gap-4 rounded-xl border-2 border-amber-400 bg-amber-50 p-5"
    >
      <h2 id={idTitulo} className="text-lg font-semibold text-slate-900">
        Contraseña temporal de {nombre}
      </h2>

      <p className="text-sm text-slate-800">
        Anotala o copiala ahora:{' '}
        <strong className="font-semibold">no vas a poder verla de nuevo.</strong> Para darle otra
        hace falta un admin del salon.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        {/* La clave, sola en su nodo de texto y en monoespaciada: se lee en voz
            alta por telefono y se transcribe a mano. */}
        <code className="rounded-lg border border-slate-300 bg-white px-4 py-3 font-mono text-2xl tracking-wider text-slate-900 select-all">
          {clave}
        </code>

        <Boton type="button" tono="secundario" onClick={() => void copiar()}>
          Copiar
        </Boton>

        {/* `aria-live` y no `role="status"`: ese rol lo tiene el bloque de
            advertencias, y hay un test que exige que no haya ninguno cuando no
            hay advertencias. */}
        <span aria-live="polite" className="text-sm text-slate-700">
          {copia === 'hecha' && 'Copiada'}
          {copia === 'fallo' && 'No se pudo copiar. Anotala a mano.'}
        </span>
      </div>

      {/* El hueco NO se dibuja cuando no hay nada que decir: un recuadro vacio
          permanente se vuelve invisible y el dia que traiga algo tampoco se ve. */}
      {advertencias.length > 0 && (
        <div
          // `status` y no `alert`: el alta SI se hizo. `alert` interrumpe al
          // lector de pantalla y suena a que fallo algo.
          role="status"
          className="flex flex-col gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
        >
          <p className="font-medium">El alta se hizo, pero revisa esto:</p>
          <ul className="list-disc pl-5">
            {advertencias.map((advertencia) => (
              <li key={advertencia.codigo}>{advertencia.mensaje}</li>
            ))}
          </ul>
        </div>
      )}

      <label className="flex items-center gap-2 text-sm font-medium text-slate-900">
        <input
          type="checkbox"
          checked={anotada}
          onChange={(evento) => setAnotada(evento.target.checked)}
          className="h-4 w-4"
        />
        Ya la anote
      </label>

      <div>
        <Boton type="button" disabled={!anotada} onClick={alTerminar}>
          Listo
        </Boton>
      </div>
    </section>
  );
}
