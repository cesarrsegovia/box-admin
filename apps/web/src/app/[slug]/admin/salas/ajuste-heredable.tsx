'use client';

import { useId, useState } from 'react';
import { Aviso, Boton } from '@/componentes/ui';

/**
 * EL CONTROL DE TRES ESTADOS de los ajustes que una sala puede NO definir.
 *
 * Cuatro de los ajustes de una sala admiten `null` y ese `null` SIGNIFICA algo:
 *
 * - `minMinutosCancelar`, `minMinutosAnotarse` y `listaEsperaHabilitada`:
 *   «hereda del gimnasio». La herencia es REAL, no decorativa:
 *   `disponibilidad.service.ts` resuelve la cascada `Sala ?? Tenant ?? sistema`
 *   con `resolverConfiguracion`, y el Tenant tiene esas tres columnas.
 * - `cupoBase`: «sin definir». Y aqui NO hay herencia, aunque el campo sea
 *   igual de nullable: el modelo `Tenant` dice por escrito que `cupoBase` no se
 *   agrega alli «aunque Sala lo tenga», porque el planificador de la Fase 2
 *   reporta `SALA_SIN_CUPO_BASE` como conflicto y un fallback del gimnasio
 *   cambiaria ese detector en silencio. Por eso el texto del estado nulo es un
 *   PARAMETRO y no una constante de este archivo: llamar «hereda del gimnasio»
 *   a un `cupoBase` en null seria mentir en pantalla sobre lo que va a pasar al
 *   publicar el mes.
 *
 * SON TRES ESTADOS Y NO DOS. Un interruptor de dos estados obligaria a elegir
 * entre dos mentiras: pintar «apagado» lo que en realidad hereda, o perder la
 * herencia en cuanto alguien guarde cualquier otra cosa. Y el valor propio
 * puede ser CERO —`minMinutosCancelar: 0` es «se puede cancelar hasta el
 * ultimo minuto», comprobado contra el DTO: `@Min(0)` lo acepta—, asi que
 * «heredar» y «cero» tampoco se pueden representar con el mismo hueco vacio.
 *
 * VOLVER A HEREDAR MANDA `null` EXPLICITO. Comprobado contra el ValidationPipe
 * real del repo (`whitelist`, `forbidNonWhitelisted`, `transform`): un
 * `{ cupoBase: null }` lo atraviesa entero —`@IsOptional()` salta la validacion
 * cuando el valor es null o undefined, y el whitelist conserva la clave porque
 * la propiedad SI esta decorada— y llega al `data: { ...dto }` del service, que
 * la escribe. Omitir la clave seria el PATCH de «no toques esto», que es lo
 * contrario de lo que la persona acaba de pedir.
 */

/** Lo que vale un ajuste heredable: un valor propio, o nada. */
export type ValorHeredable = number | boolean | null;

export interface FormaDelAjuste {
  /** Que se pinta cuando el valor es `null`. NO tiene valor por defecto. */
  textoDeNulo: string;
  /** Lo que se escribe detras de un numero propio («minutos»). */
  unidad?: string;
}

/**
 * Un ajuste, en palabras. Para el listado y para quien no puede editarlo.
 *
 * Un hueco en blanco se lee como «no cargo la pantalla», no como «hereda», y
 * un `0` pelado al lado de un hueco en blanco no se distingue de el de un
 * vistazo. Los tres estados se dicen con palabras distintas o no se dicen.
 */
export function textoDeAjuste(valor: ValorHeredable, forma: FormaDelAjuste): string {
  if (valor === null) return forma.textoDeNulo;
  if (typeof valor === 'boolean') return valor ? 'Sí' : 'No';

  return forma.unidad === undefined ? String(valor) : `${valor} ${forma.unidad}`;
}

type Origen = 'heredado' | 'propio';

export function AjusteHeredable({
  etiqueta,
  ayuda,
  accion,
  tipo,
  minimo = 0,
  valor,
  forma,
  guardando = false,
  error,
  alGuardar,
}: {
  /** El nombre del ajuste. Etiqueta el selector de origen y es UNICO en la pagina. */
  etiqueta: string;
  /** Que cambia de verdad al tocarlo, en una frase. */
  ayuda: string;
  /**
   * El texto del boton, entero y escrito por quien llama.
   *
   * Cuatro botones que pongan «Guardar» son cuatro controles indistinguibles
   * para quien navega con lector de pantalla o con la voz, y tambien para un
   * test que quiera pulsar uno concreto.
   */
  accion: string;
  tipo: 'numero' | 'booleano';
  /** El minimo que acepta el DTO. `cupoBase` es 1; los dos de minutos, 0. */
  minimo?: number;
  valor: ValorHeredable;
  forma: FormaDelAjuste;
  guardando?: boolean;
  /** Lo que fallo al guardar ESTE ajuste, no los otros tres. */
  error?: string | null;
  alGuardar: (valor: ValorHeredable) => void;
}) {
  const base = useId();
  const idOrigen = `${base}-origen`;
  const idValor = `${base}-valor`;
  const idAyuda = `${base}-ayuda`;

  /**
   * El estado arranca del valor cargado y NO se vuelve a sincronizar.
   *
   * Es la misma decision que el bloque de datos de la ficha de un turno, que
   * usa `defaultValues`: pisarle lo escrito a quien esta editando porque la
   * consulta se refresco por detras es peor que enseñar un valor de hace un
   * minuto.
   */
  const [origen, setOrigen] = useState<Origen>(valor === null ? 'heredado' : 'propio');
  const [propio, setPropio] = useState<string>(valor === null ? '' : String(valor));
  const [falloLocal, setFalloLocal] = useState<string | null>(null);

  function enviar(): void {
    setFalloLocal(null);

    if (origen === 'heredado') {
      // `null` EXPLICITO, no «no mandes la clave». Ver la cabecera del archivo.
      alGuardar(null);
      return;
    }

    if (tipo === 'booleano') {
      alGuardar(propio === 'true');
      return;
    }

    const escrito = propio.trim();

    /**
     * El vacio NO se convierte en `null` ni en cero.
     *
     * Con «valor propio» elegido y el campo en blanco no se sabe que quiso
     * decir la persona, y las dos adivinanzas posibles son justamente los dos
     * estados que este control existe para distinguir. Se pregunta.
     */
    if (!/^\d+$/.test(escrito) || Number(escrito) < minimo) {
      setFalloLocal(`Un numero entero, de ${minimo} para arriba.`);
      return;
    }

    alGuardar(Number(escrito));
  }

  return (
    <div className="flex flex-col gap-1 border-t border-slate-100 pt-3 first:border-0 first:pt-0">
      <label htmlFor={idOrigen} className="text-sm font-medium text-slate-700">
        {etiqueta}
      </label>
      <p id={idAyuda} className="text-xs text-slate-500">
        {ayuda}
      </p>

      <select
        id={idOrigen}
        aria-describedby={idAyuda}
        value={origen}
        onChange={(evento) => {
          setOrigen(evento.target.value as Origen);
          setFalloLocal(null);
        }}
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
      >
        <option value="heredado">{forma.textoDeNulo}</option>
        <option value="propio">Valor propio</option>
      </select>

      {origen === 'propio' && (
        <>
          <label htmlFor={idValor} className="mt-1 text-sm font-medium text-slate-700">
            {etiqueta} (valor propio)
          </label>

          {tipo === 'numero' ? (
            <input
              id={idValor}
              inputMode="numeric"
              value={propio}
              aria-invalid={falloLocal !== null}
              onChange={(evento) => setPropio(evento.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          ) : (
            <select
              id={idValor}
              value={propio === 'true' ? 'true' : 'false'}
              onChange={(evento) => setPropio(evento.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="true">Sí</option>
              <option value="false">No</option>
            </select>
          )}
        </>
      )}

      {falloLocal !== null && <Aviso tono="error">{falloLocal}</Aviso>}
      {error !== null && error !== undefined && <Aviso tono="error">{error}</Aviso>}

      <div className="mt-1">
        <Boton type="button" cargando={guardando} onClick={enviar}>
          {accion}
        </Boton>
      </div>
    </div>
  );
}
