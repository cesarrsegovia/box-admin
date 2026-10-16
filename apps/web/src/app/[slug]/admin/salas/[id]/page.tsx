'use client';

import { useEffect, useState } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { aFechaISO, rolAlcanza, type SalaPublica } from '@boxadmin/shared';
import { Confirmar } from '@/componentes/confirmar';
import { Campo } from '@/componentes/formulario';
import { Aviso, Boton, Tarjeta } from '@/componentes/ui';
import { ErrorDeApi } from '@/lib/cliente';
import { SIN_QUERY, destinoDeLoginDesde } from '@/lib/destino-de-login';
import { useActualizarSala, useBorrarSala, useSala } from '@/hooks/use-salas-admin';
import { useTurnos } from '@/hooks/use-turnos';
import { mensajeDeFallo, repartirPorCampo } from '../../usuarios/[id]/errores';
import { useRolDeQuienMira } from '../../rol-del-panel';
import {
  AjusteHeredable,
  textoDeAjuste,
  type FormaDelAjuste,
  type ValorHeredable,
} from '../ajuste-heredable';

/**
 * LA FICHA DE UNA SALA: sus OCHO ajustes, y ni uno mas.
 *
 * `SalaPublica` trae NUEVE campos editables y aqui se dibujan ocho. El que
 * falta es `exclusiva`, y falta a proposito: es un campo MUERTO. Se escribe en
 * el alta (`salas.service.ts`, `exclusiva: dto.exclusiva ?? false`), se mapea
 * al contrato (`aSalaPublica`) y ahi se acaba — ninguna regla del sistema lo
 * lee: ni la disponibilidad, ni el planificador del mes, ni los packs, ni la
 * visibilidad. Un interruptor que no cambia nada es peor que no tenerlo: el
 * admin lo activa creyendo que reserva la sala para alguien y no pasa
 * absolutamente nada. Cuando el campo signifique algo, se dibuja.
 *
 * LOS OCHO SE GUARDAN POR SEPARADO, en vez de con un «Guardar» unico. No es
 * estetica: los cuatro heredables tienen un `null` con significado, y un
 * formulario unico manda SIEMPRE las ocho claves. Guardar el nombre pisaria con
 * los valores que esta pantalla cargo hace cinco minutos la herencia que otro
 * admin acaba de configurar — y lo haria en silencio, porque el PATCH devuelve
 * 200. Ver la cabecera de `ajuste-heredable.tsx`.
 */

/** Los cuatro ajustes que admiten `null`, con lo que ese `null` significa. */
const HEREDABLES = [
  {
    campo: 'cupoBase',
    etiqueta: 'Cupo base',
    accion: 'Guardar cupo base',
    tipo: 'numero',
    // `@Min(1)` en el DTO: un cupo de cero no es «sala sin limite», es una sala
    // donde no entra nadie, y la API lo rechaza con un 400.
    minimo: 1,
    ayuda:
      'Con cuantos lugares nace cada turno que se genere en esta sala. Sin definir, el planificador no puede generar los turnos y los reporta como conflicto.',
    forma: { textoDeNulo: 'Sin definir' },
  },
  {
    campo: 'minMinutosCancelar',
    etiqueta: 'Minutos para cancelar',
    accion: 'Guardar minutos para cancelar',
    tipo: 'numero',
    minimo: 0,
    ayuda:
      'Cuanta antelacion necesita un alumno para cancelar. Cero significa «hasta el ultimo minuto», que no es lo mismo que heredar.',
    forma: { textoDeNulo: 'Hereda del gimnasio', unidad: 'minutos' },
  },
  {
    campo: 'minMinutosAnotarse',
    etiqueta: 'Minutos para anotarse',
    accion: 'Guardar minutos para anotarse',
    tipo: 'numero',
    minimo: 0,
    ayuda:
      'Cuanta antelacion necesita un alumno para anotarse. Cero significa «hasta que empiece», que no es lo mismo que heredar.',
    forma: { textoDeNulo: 'Hereda del gimnasio', unidad: 'minutos' },
  },
  {
    campo: 'listaEsperaHabilitada',
    etiqueta: 'Lista de espera',
    accion: 'Guardar lista de espera',
    tipo: 'booleano',
    ayuda: 'Si un turno lleno acepta anotados en espera.',
    forma: { textoDeNulo: 'Hereda del gimnasio' },
  },
] as const satisfies readonly {
  campo: 'cupoBase' | 'minMinutosCancelar' | 'minMinutosAnotarse' | 'listaEsperaHabilitada';
  etiqueta: string;
  accion: string;
  tipo: 'numero' | 'booleano';
  minimo?: number;
  ayuda: string;
  forma: FormaDelAjuste;
}[];

/** Los CUATRO del bloque de datos. Ni uno mas: lo de mas es un 400. */
const CAMPOS_DE_DATOS = ['nombre', 'activa', 'visibleAlumnos', 'soloCuposLiberados'] as const;

type CampoDeDatos = (typeof CAMPOS_DE_DATOS)[number];

interface DatosEditables {
  nombre: string;
  activa: boolean;
  visibleAlumnos: boolean;
  soloCuposLiberados: boolean;
}

function datosDe(sala: SalaPublica): DatosEditables {
  return {
    nombre: sala.nombre,
    activa: sala.activa,
    visibleAlumnos: sala.visibleAlumnos,
    soloCuposLiberados: sala.soloCuposLiberados,
  };
}

// ---------------------------------------------------------------------------
// Los cuatro ajustes que no heredan
// ---------------------------------------------------------------------------

/**
 * EL INTERRUPTOR DE `activa` VIVE AQUI, y abajo hay ademas un bloque de baja.
 *
 * No es una duplicacion por descuido: son las DOS PUERTAS que la API tiene a la
 * misma baja, y las dos estan abiertas. `salas.service.ts` lo dice por escrito:
 * «Un PATCH con activa:false da de baja la sala igual que el DELETE, asi que
 * pasa por la misma proteccion y se audita igual». Quitar el interruptor no
 * cerraria esa puerta —cualquiera puede mandar el PATCH— y ademas dejaria sin
 * forma de REACTIVAR una sala, que es lo unico que el DELETE no sabe hacer.
 *
 * Lo que si hace falta es que esta puerta maneje el MISMO 409 que la otra: el
 * recuento de turnos futuros lo comprueba la API en las dos.
 */
function BloqueDeDatos({ sala }: { sala: SalaPublica }) {
  const guardar = useActualizarSala(sala.id);

  const [valores, setValores] = useState<DatosEditables>(() => datosDe(sala));
  const [porCampo, setPorCampo] = useState<Partial<Record<CampoDeDatos, string>>>({});
  const [aviso, setAviso] = useState<string | null>(null);

  /**
   * SOLO LO QUE CAMBIO, comparado contra la sala cargada.
   *
   * Se compara contra el dato y no contra un «esto lo toque»: un campo escrito
   * y vuelto a dejar como estaba no viaja.
   */
  function cambios(): Partial<DatosEditables> {
    const original = datosDe(sala);
    const resultado: Partial<DatosEditables> = {};

    if (valores.nombre !== original.nombre) resultado.nombre = valores.nombre;
    if (valores.activa !== original.activa) resultado.activa = valores.activa;
    if (valores.visibleAlumnos !== original.visibleAlumnos) {
      resultado.visibleAlumnos = valores.visibleAlumnos;
    }
    if (valores.soloCuposLiberados !== original.soloCuposLiberados) {
      resultado.soloCuposLiberados = valores.soloCuposLiberados;
    }

    return resultado;
  }

  async function enviar(): Promise<void> {
    setAviso(null);
    setPorCampo({});

    const aMandar = cambios();
    if (Object.keys(aMandar).length === 0) {
      setAviso('No cambiaste nada.');
      return;
    }

    try {
      await guardar.mutateAsync(aMandar);
    } catch (error) {
      if (!(error instanceof ErrorDeApi)) throw error;

      // El 403 se traduce ANTES de repartir: «Forbidden» no nombra ningun
      // campo y acabaria en el cartel tal cual, en ingles y sin decir que hacer.
      if (error.estado === 403) {
        setAviso(mensajeDeFallo(error, 'ADMIN_SALON'));
        return;
      }

      /**
       * EL 409 DE LA BAJA LLEGA TAMBIEN POR AQUI.
       *
       * «La sala tiene N turno(s) de hoy en adelante. Borralos o reasignalos
       * antes de darla de baja.» no nombra ningun campo del DTO, asi que
       * `repartirPorCampo` lo deja suelto y acaba en el cartel, con su numero
       * exacto. Tragarselo dejaria al admin creyendo que dio de baja la sala.
       */
      const repartido = repartirPorCampo(error, CAMPOS_DE_DATOS);
      setPorCampo(repartido.porCampo);
      setAviso(repartido.sueltas.length === 0 ? null : repartido.sueltas.join(' '));
    }
  }

  return (
    <Tarjeta>
      <form
        aria-label="Datos de la sala"
        onSubmit={(evento) => {
          evento.preventDefault();
          void enviar();
        }}
        className="flex flex-col gap-3"
        noValidate
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Datos</h2>

        {aviso !== null && <Aviso tono="error">{aviso}</Aviso>}

        <Campo
          etiqueta="Nombre"
          value={valores.nombre}
          error={porCampo.nombre}
          onChange={(evento) => setValores({ ...valores, nombre: evento.target.value })}
        />

        <SiONo
          etiqueta="Activa"
          ayuda="Una sala de baja no acepta turnos nuevos. La baja es logica: la sala sigue existiendo."
          valor={valores.activa}
          error={porCampo.activa}
          alCambiar={(activa) => setValores({ ...valores, activa })}
        />

        <SiONo
          etiqueta="Visible para alumnos"
          ayuda="Los profesores la ven igual aunque este apagada."
          valor={valores.visibleAlumnos}
          error={porCampo.visibleAlumnos}
          alCambiar={(visibleAlumnos) => setValores({ ...valores, visibleAlumnos })}
        />

        <SiONo
          etiqueta="Solo cupos liberados"
          ayuda="La sala solo admite reservas sobre lugares que alguien cancelo."
          valor={valores.soloCuposLiberados}
          error={porCampo.soloCuposLiberados}
          alCambiar={(soloCuposLiberados) => setValores({ ...valores, soloCuposLiberados })}
        />

        <div>
          <Boton type="submit" cargando={guardar.isPending}>
            Guardar datos
          </Boton>
        </div>
      </form>
    </Tarjeta>
  );
}

/** Un booleano que NO admite null: dos estados de verdad, y se dicen los dos. */
function SiONo({
  etiqueta,
  ayuda,
  valor,
  error,
  alCambiar,
}: {
  etiqueta: string;
  ayuda: string;
  valor: boolean;
  error?: string | undefined;
  alCambiar: (valor: boolean) => void;
}) {
  const id = etiqueta.toLowerCase().replace(/\s+/g, '-');
  const idAyuda = `${id}-ayuda`;
  const idError = `${id}-error`;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        {etiqueta}
      </label>
      <p id={idAyuda} className="text-xs text-slate-500">
        {ayuda}
      </p>
      <select
        id={id}
        value={valor ? 'true' : 'false'}
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? idAyuda : idError}
        onChange={(evento) => alCambiar(evento.target.value === 'true')}
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
      >
        <option value="true">Sí</option>
        <option value="false">No</option>
      </select>
      {error !== undefined && (
        <p id={idError} className="text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Los cuatro que si heredan
// ---------------------------------------------------------------------------

/**
 * Un ajuste heredable CON SU PROPIA MUTACION.
 *
 * Una mutacion compartida por los cuatro pondria los cuatro botones en
 * «guardando» a la vez y enseñaria el fallo de uno debajo de los otros tres.
 */
function AjusteDeLaSala({
  sala,
  definicion,
}: {
  sala: SalaPublica;
  definicion: (typeof HEREDABLES)[number];
}) {
  const guardar = useActualizarSala(sala.id);
  const [fallo, setFallo] = useState<string | null>(null);

  async function alGuardar(valor: ValorHeredable): Promise<void> {
    setFallo(null);

    try {
      // UNA SOLA CLAVE EN EL CUERPO. Lo que no viaja, no se pisa.
      await guardar.mutateAsync({ [definicion.campo]: valor });
    } catch (error) {
      setFallo(mensajeDeFallo(error, 'ADMIN_SALON'));
    }
  }

  return (
    <AjusteHeredable
      etiqueta={definicion.etiqueta}
      ayuda={definicion.ayuda}
      accion={definicion.accion}
      tipo={definicion.tipo}
      minimo={'minimo' in definicion ? definicion.minimo : 0}
      valor={sala[definicion.campo]}
      forma={definicion.forma}
      guardando={guardar.isPending}
      error={fallo}
      alGuardar={(valor) => void alGuardar(valor)}
    />
  );
}

function BloqueDeAjustes({ sala }: { sala: SalaPublica }) {
  return (
    <Tarjeta>
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Ajustes heredables
        </h2>

        {HEREDABLES.map((definicion) => (
          <AjusteDeLaSala key={definicion.campo} sala={sala} definicion={definicion} />
        ))}
      </div>
    </Tarjeta>
  );
}

// ---------------------------------------------------------------------------
// La baja
// ---------------------------------------------------------------------------

/**
 * Dar de baja la sala. `DELETE /salas/:id`, baja LOGICA.
 *
 * Las dos mitades son las mismas que el bloque de borrar un turno:
 *
 * 1. CON TURNOS FUTUROS NO SE OFRECE. La regla la sabe la API —«La sala tiene N
 *    turno(s) de hoy en adelante. Borralos o reasignalos antes de darla de
 *    baja.»— y se puede saber ANTES: se cuentan con `GET /turnos` filtrando por
 *    esta sala desde hoy, que es el mismo endpoint y el mismo recorte que usa
 *    el service. Ofrecer el boton, pedir confirmacion y recien entonces
 *    contestar con el 409 convierte una regla conocida en un error.
 *
 * 2. Y AUN ASI SE MANEJA EL 409. El recuento es el de la ultima lectura: entre
 *    esa lectura y la confirmacion, alguien publica el mes que viene desde el
 *    calendario y la sala pasa de cero turnos a treinta.
 *
 * TRAS LA BAJA NO SE NAVEGA A NINGUN SITIO, al reves que con un turno. Alli el
 * borrado es fisico y quedarse dejaria la pantalla pidiendo un 404; aqui la
 * fila sobrevive con `activa: false` y la ficha sigue siendo la de esa sala.
 * Por eso `useBorrarSala` invalida tambien la ficha: lo que cambio es
 * justamente el campo que se acaba de tocar.
 */
function BloqueDeBaja({ sala }: { sala: SalaPublica }) {
  const borrar = useBorrarSala(sala.id);

  /**
   * Los turnos de HOY EN ADELANTE de esta sala, que es exactamente lo que
   * cuenta `exigirSinTurnosFuturos` con `comienzoDeHoyUtc()`. Se usa
   * `aFechaISO` —la misma funcion de `@boxadmin/shared` sobre la que esta
   * escrito `comienzoDeHoyUtc`— y no una fecha armada a mano, que en cualquier
   * maquina al oeste de Greenwich seria el dia equivocado.
   */
  const turnos = useTurnos({ salaId: sala.id, desde: aFechaISO(new Date()) });

  const [confirmando, setConfirmando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);

  if (!sala.activa) {
    return (
      <Tarjeta>
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Baja</h2>
          <p className="text-sm text-slate-600">
            Esta sala ya esta de baja. Para reactivarla, pone «Activa» en «Sí» en los datos y
            guarda.
          </p>
        </div>
      </Tarjeta>
    );
  }

  const futuros = turnos.data?.length ?? 0;

  async function darDeBaja(): Promise<void> {
    setFallo(null);

    try {
      await borrar.mutateAsync();
      setConfirmando(false);
    } catch (error) {
      setFallo(mensajeDeFallo(error, 'ADMIN_SALON'));
    }
  }

  return (
    <Tarjeta>
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Baja</h2>

        {turnos.isPending ? (
          // Mientras no se sabe, no se ofrece: ofrecer y retirar el boton medio
          // segundo despues es como se pulsa el que no era.
          <p className="text-sm text-slate-500">Comprobando si tiene turnos futuros…</p>
        ) : futuros > 0 ? (
          /* El mismo numero y las mismas palabras que daria la API, pero ANTES
             de intentarlo. Y dice que hacer con ellos. */
          <Aviso tono="error">
            No se puede dar de baja: la sala tiene {futuros} turno(s) de hoy en adelante. Borralos o
            reasignalos antes de darla de baja.
          </Aviso>
        ) : (
          <>
            {turnos.error !== null && (
              // No se pudo contar. Se ofrece igual porque la API protege de
              // todos modos, pero se dice que la comprobacion previa falto.
              <Aviso tono="error">
                No se pudo comprobar si la sala tiene turnos futuros. Si los tiene, la baja va a
                fallar.
              </Aviso>
            )}

            {confirmando ? (
              <Confirmar
                /* LA PREGUNTA NOMBRA LA SALA. Una ficha abierta en una pestaña
                   vieja es como se da de baja la que no era. */
                pregunta={`Dar de baja la sala ${sala.nombre}`}
                detalle="Deja de aceptar turnos nuevos y desaparece para los alumnos. La sala no se borra: se puede reactivar."
                textoDeConfirmar="Dar de baja"
                cargando={borrar.isPending}
                error={fallo ?? undefined}
                alConfirmar={() => void darDeBaja()}
                alCancelar={() => {
                  setConfirmando(false);
                  setFallo(null);
                }}
              />
            ) : (
              <div>
                <Boton type="button" tono="peligro" onClick={() => setConfirmando(true)}>
                  Dar de baja la sala
                </Boton>
              </div>
            )}
          </>
        )}
      </div>
    </Tarjeta>
  );
}

// ---------------------------------------------------------------------------
// Lo que ve quien no puede escribir
// ---------------------------------------------------------------------------

/**
 * LA FICHA EN SOLO LECTURA, para un `ADMIN_OPERATIVO`.
 *
 * Las cuatro escrituras de salas piden `ADMIN_SALON`, asi que para un operativo
 * no hay NI UN boton de escritura. Y no se dibujan los formularios con los
 * botones quitados: unos campos editables que no se pueden guardar son una
 * promesa falsa, y un control deshabilitado sigue en el DOM.
 *
 * Lo que si se enseña es el VALOR, con sus tres estados en palabras: un
 * operativo necesita saber por que una sala no genera turnos.
 */
function ResumenDeLaSala({ sala }: { sala: SalaPublica }) {
  return (
    <Tarjeta>
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Ajustes</h2>

        <p className="text-sm text-slate-600">
          Para cambiar cualquiera de estos hace falta ser administrador del salon.
        </p>

        <dl className="flex flex-col gap-2 text-sm">
          <Dato nombre="Activa" valor={sala.activa ? 'Sí' : 'No'} />
          <Dato nombre="Visible para alumnos" valor={sala.visibleAlumnos ? 'Sí' : 'No'} />
          <Dato nombre="Solo cupos liberados" valor={sala.soloCuposLiberados ? 'Sí' : 'No'} />

          {HEREDABLES.map((definicion) => (
            <Dato
              key={definicion.campo}
              nombre={definicion.etiqueta}
              valor={textoDeAjuste(sala[definicion.campo], definicion.forma)}
            />
          ))}
        </dl>
      </div>
    </Tarjeta>
  );
}

function Dato({ nombre, valor }: { nombre: string; valor: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-500">{nombre}</dt>
      <dd className="font-medium text-slate-900">{valor}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// La pantalla
// ---------------------------------------------------------------------------

export default function PaginaDeFichaDeSala() {
  const { slug, id } = useParams<{ slug: string; id: string }>();
  const ruta = usePathname();
  const router = useRouter();
  const rol = useRolDeQuienMira();

  const { data: sala, isPending, error, refetch } = useSala(id);

  // Sin proveedor de rol, `null`: no alcanza para nada. Fallar hacia el lado
  // que no da permisos de mas es lo unico seguro cuando falta la informacion.
  const puedeEscribir = rol !== null && rolAlcanza(rol, 'ADMIN_SALON');

  const sesionCaducada = error instanceof ErrorDeApi && error.esSesionCaducada;

  useEffect(() => {
    if (!sesionCaducada) return;

    // `SIN_QUERY` es una decision con nombre: esta ficha no tiene query que
    // conservar porque el listado de salas no tiene filtros.
    router.push(destinoDeLoginDesde(ruta, SIN_QUERY, slug));
  }, [sesionCaducada, router, ruta, slug]);

  if (isPending) return <p className="text-sm text-slate-500">Cargando…</p>;

  if (error !== null) {
    return (
      <div className="flex flex-col items-start gap-2">
        <Aviso tono="error">{error.message}</Aviso>
        {/* Sin sesion, reintentar es volver a fallar. */}
        {!sesionCaducada && (
          <Boton tono="secundario" onClick={() => void refetch()}>
            Reintentar
          </Boton>
        )}
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-slate-900">{sala.nombre}</h1>
        {/* La baja es logica y la ficha sigue abierta: si no se dice, no se ve. */}
        {!sala.activa && <p className="text-sm text-red-700">Esta sala esta de baja.</p>}
      </header>

      {puedeEscribir ? (
        <>
          <BloqueDeDatos sala={sala} />
          <BloqueDeAjustes sala={sala} />
          <BloqueDeBaja sala={sala} />
        </>
      ) : (
        <ResumenDeLaSala sala={sala} />
      )}
    </section>
  );
}
