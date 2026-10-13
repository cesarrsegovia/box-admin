'use client';

import { useId, useState } from 'react';
import type {
  Advertencia,
  OrigenReserva,
  ReservaEnTurno,
  TipoCancelacion,
  TurnoPublico,
} from '@boxadmin/shared';
import { Tabla, type ColumnaDeTabla } from '@/componentes/tabla';
import { Aviso, Boton, Tarjeta } from '@/componentes/ui';
import { ErrorDeApi } from '@/lib/cliente';
import {
  useAnotar,
  useCancelar,
  useReasignar,
  useReservasDelTurno,
  useTurnos,
} from '@/hooks/use-turnos';
import { useUsuarios } from '@/hooks/use-usuarios';
import { mensajeDeFallo } from '../../usuarios/[id]/errores';

/**
 * QUIEN ESTA ANOTADO EN EL TURNO, y las tres cosas que se pueden hacer con eso:
 * anotar a alguien, cancelar una reserva y moverla a otro turno.
 *
 * Es el bloque de la ficha que maneja DATOS DE PERSONAS, y el unico que pide
 * una segunda lista: `GET /turnos/:id/reservas`. Esa lista viene ENTERA —las
 * activas y las canceladas— y separarlas es trabajo de esta pantalla: un admin
 * que cuenta filas para saber si entra alguien mas no puede estar contando a
 * quien ya no viene.
 *
 * LOS DOS CATALOGOS SE PIDEN AL ABRIR LO QUE LOS NECESITA, no al montar. El
 * padron de personas y el de turnos de la sala son dos listas grandes que casi
 * ninguna visita a esta ficha usa, y la ficha se abre todo el dia. Se consigue
 * montando el formulario —que es quien llama al hook— solo cuando hace falta:
 * un hook que no esta montado no pide nada, y asi no hay ningun `enabled` que
 * alguien pueda invertir sin querer.
 */

// ---------------------------------------------------------------------------
// Como se lee un fallo de estas tres acciones
// ---------------------------------------------------------------------------

/**
 * El UNICO 403 del panel que de verdad habla de roles: el del guard.
 *
 * `RolesGuard` tira `ForbiddenException('Sin permisos para esta operacion')` y
 * ningun otro sitio usa esa frase. Se compara contra ELLA y no contra "¿habla
 * de salas?" a proposito: asi, el dia que la API invente un tercer 403, la
 * pantalla ensena SU mensaje en vez de inventarse uno de roles. Si algun dia
 * cambia la frase del guard, lo que se pierde es la traduccion —se vera el
 * texto crudo del guard—, no la verdad.
 */
const MENSAJE_DE_ROL = 'Sin permisos para esta operacion';

/**
 * El UNICO 409 reintentable.
 *
 * `conReintentoDeCupo` lo tira cuando Postgres aborta la transaccion
 * Serializable del cupo por solape y se agotan los cinco intentos del servidor.
 * Los demas 409 de reservas piden OTRA ACCION —cancela antes de borrar, crea
 * una nueva en vez de reasignar, el turno esta lleno—; este pide LO MISMO MAS
 * TARDE, y es el unico donde ofrecer "reintentar" no es invitar a repetir un
 * fallo seguro.
 */
const MENSAJE_REINTENTABLE =
  'Otra peticion esta tocando este turno ahora mismo; reintenta en unos segundos.';

interface FalloLeido {
  mensaje: string;
  /** Si tiene sentido volver a mandar LO MISMO sin cambiar nada. */
  sePuedeReintentar: boolean;
}

/**
 * Los fallos de anotar, cancelar y reasignar, leidos para quien esta en el
 * mostrador.
 *
 * Dos excepciones al tratamiento del resto del panel, y las dos son de fondo:
 *
 * 1. EL 403 DE SALA NO ES EL 403 DE ROL. «El usuario no tiene acceso a la sala
 *    del turno destino» lo tira el service, no el guard: el admin tiene el rol
 *    de sobra —si no, no habria llegado a la ficha—; el que no tiene acceso es
 *    el ALUMNO. Traducirlo a «hace falta ser administrador operativo» manda al
 *    admin a pedir permisos que ya tiene, en vez de abrir la ficha del alumno y
 *    asignarle la sala.
 *
 * 2. EL 409 DE CONCURRENCIA SE REINTENTA. Ver `MENSAJE_REINTENTABLE`.
 */
function leerFallo(error: unknown): FalloLeido {
  if (error instanceof ErrorDeApi) {
    if (error.estado === 403 && error.message !== MENSAJE_DE_ROL) {
      return { mensaje: error.message, sePuedeReintentar: false };
    }

    if (error.estado === 409 && error.message === MENSAJE_REINTENTABLE) {
      return { mensaje: error.message, sePuedeReintentar: true };
    }
  }

  return { mensaje: mensajeDeFallo(error, 'ADMIN_OPERATIVO'), sePuedeReintentar: false };
}

/** El cartel de un fallo, con el boton SOLO cuando reintentar sirve de algo. */
function CartelDeFallo({ fallo, alReintentar }: { fallo: FalloLeido; alReintentar: () => void }) {
  return (
    <div className="flex flex-col items-start gap-2">
      <Aviso tono="error">{fallo.mensaje}</Aviso>
      {fallo.sePuedeReintentar && (
        <Boton type="button" tono="secundario" onClick={alReintentar}>
          Reintentar
        </Boton>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Como se lee una reserva
// ---------------------------------------------------------------------------

/**
 * EL NOMBRE, Y NUNCA UN IDENTIFICADOR DE RESPALDO.
 *
 * `ReservaEnTurno` trae `nombreCompleto` resuelto justamente para que esta
 * pantalla no tenga que pintar ids. Un `?? reserva.perfilId` de cortesia no se
 * nota mientras todas las filas tengan nombre, y el dia que una no lo tenga
 * pone un `clv8x...` delante del mostrador: no le sirve a nadie, parece una
 * averia y es el dato con el que se cruzan tablas entre gimnasios.
 */
function nombreQueSeVe(reserva: ReservaEnTurno): string {
  return reserva.nombreCompleto.trim() === '' ? 'Sin nombre' : reserva.nombreCompleto;
}

/** Como llego cada quien, en palabras y no en mayusculas de base de datos. */
const ORIGEN_LEGIBLE: Record<OrigenReserva, string> = {
  ADMIN: 'La anoto el admin',
  ALUMNO: 'Se anoto en la app',
  RUTINA: 'Por su rutina semanal',
  PRUEBA: 'Clase de prueba',
  LISTA_ESPERA: 'Salio de la lista de espera',
  EXTRA: 'Clase extra',
};

/**
 * QUE LE PASO A LA CLASE, que es lo unico que el tipo de cancelacion significa.
 *
 * `ConsumoDePack` cuenta como consumidas «las no canceladas y las canceladas
 * como DEFINITIVA». Es decir: una definitiva le GASTA la clase al alumno y una
 * recuperable se la DEVUELVE. La sigla no se ensena en ningun lado: obliga a
 * saberse esa tabla de memoria para leer una lista.
 */
const QUE_PASO_CON_LA_CLASE: Record<TipoCancelacion, string> = {
  RECUPERABLE: 'Se le devolvio la clase',
  DEFINITIVA: 'Se le gasto la clase',
};

/** Las dos opciones del momento de cancelar, dichas por su CONSECUENCIA. */
const OPCIONES_DE_CANCELACION: readonly { tipo: TipoCancelacion; texto: string }[] = [
  {
    tipo: 'RECUPERABLE',
    texto: 'Se la devolvemos: vuelve a su pack y la puede usar en otro turno.',
  },
  {
    tipo: 'DEFINITIVA',
    texto: 'Se la gastamos: la pierde igual que si hubiera venido.',
  },
];

// ---------------------------------------------------------------------------
// El bloque
// ---------------------------------------------------------------------------

/**
 * Una accion a la vez, y SIEMPRE con la reserva encima.
 *
 * La reserva viaja DENTRO de la accion y no en un estado aparte: asi "que
 * estoy haciendo" y "a quien se lo estoy haciendo" no se pueden desincronizar,
 * que es como se cancela la reserva de la fila de al lado.
 */
type AccionEnCurso =
  | { tipo: 'anotar' }
  | { tipo: 'cancelar'; reserva: ReservaEnTurno }
  | { tipo: 'reasignar'; reserva: ReservaEnTurno }
  | null;

export function BloqueDeAnotados({ turno }: { turno: TurnoPublico }) {
  const { data: reservas, isPending, error, refetch } = useReservasDelTurno(turno.id);

  const [accion, setAccion] = useState<AccionEnCurso>(null);
  const [advertencias, setAdvertencias] = useState<Advertencia[]>([]);

  const cerrar = (): void => setAccion(null);

  const activas = (reservas ?? []).filter((reserva) => reserva.canceladaEn === null);
  const canceladas = (reservas ?? []).filter((reserva) => reserva.canceladaEn !== null);

  const columnasDeActivas: readonly ColumnaDeTabla<ReservaEnTurno>[] = [
    { encabezado: 'Quien', celda: nombreQueSeVe },
    { encabezado: 'Como llego', celda: (reserva) => ORIGEN_LEGIBLE[reserva.origen] },
    {
      encabezado: 'Acciones',
      celda: (reserva) => (
        <span className="flex gap-2">
          {/* El nombre accesible lleva A QUIEN, aunque el boton diga solo
              "Cancelar": una lista de diez botones identicos no se puede
              recorrer con un lector de pantalla. */}
          <Boton
            type="button"
            tono="peligro"
            aria-label={`Cancelar la reserva de ${nombreQueSeVe(reserva)}`}
            onClick={() => setAccion({ tipo: 'cancelar', reserva })}
          >
            Cancelar
          </Boton>
          <Boton
            type="button"
            tono="secundario"
            aria-label={`Reasignar la reserva de ${nombreQueSeVe(reserva)}`}
            onClick={() => setAccion({ tipo: 'reasignar', reserva })}
          >
            Reasignar
          </Boton>
        </span>
      ),
    },
  ];

  const columnasDeCanceladas: readonly ColumnaDeTabla<ReservaEnTurno>[] = [
    { encabezado: 'Quien', celda: nombreQueSeVe },
    {
      encabezado: 'Que paso con la clase',
      celda: (reserva) =>
        reserva.cancelacionTipo === null
          ? 'Sin registrar'
          : QUE_PASO_CON_LA_CLASE[reserva.cancelacionTipo],
    },
  ];

  return (
    <Tarjeta>
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Anotados</h2>

        {isPending && <p className="text-sm text-slate-500">Cargando anotados…</p>}

        {error !== null && (
          <div className="flex flex-col items-start gap-2">
            <Aviso tono="error">{error.message}</Aviso>
            <Boton type="button" tono="secundario" onClick={() => void refetch()}>
              Reintentar
            </Boton>
          </div>
        )}

        {/* LAS ADVERTENCIAS NO SON ERRORES: la reserva SE CREO y ademas hay algo
            que mirar. Sobreviven al cierre del formulario porque el dato que
            traen —«ya tiene 8 de 8 clases de su pack»— es lo que el gimnasio
            cobra o no cobra, y se perderia justo cuando el formulario se cierra
            solo. `alerta` para que un lector de pantalla lo anuncie: aparece en
            el sitio del control que la persona acaba de usar. */}
        {advertencias.length > 0 && (
          <Aviso alerta>
            <p className="font-medium">La reserva se creo, pero mira esto:</p>
            <ul className="list-disc pl-4">
              {advertencias.map((advertencia) => (
                <li key={advertencia.codigo}>{advertencia.mensaje}</li>
              ))}
            </ul>
          </Aviso>
        )}

        {accion === null ? (
          <div>
            {/* SE OFRECE AUNQUE EL TURNO ESTE LLENO, al reves que el boton de
                borrar. Alli la regla es definitiva y se sabe de antemano; aqui
                el recuento es el de la ultima lectura y entre esa lectura y el
                clic alguien pudo cancelar. Adivinar el 409 le negaria al admin
                un alta que la API SI aceptaria. */}
            <Boton type="button" onClick={() => setAccion({ tipo: 'anotar' })}>
              Anotar a alguien
            </Boton>
          </div>
        ) : accion.tipo === 'anotar' ? (
          <FormularioDeAnotar
            turno={turno}
            alAnotar={(creada) => {
              setAdvertencias(creada);
              cerrar();
            }}
            alVolver={cerrar}
          />
        ) : accion.tipo === 'cancelar' ? (
          <PanelDeCancelar turno={turno} reserva={accion.reserva} alVolver={cerrar} />
        ) : (
          <PanelDeReasignar turno={turno} reserva={accion.reserva} alVolver={cerrar} />
        )}

        <Tabla
          etiqueta="Anotados"
          columnas={columnasDeActivas}
          filas={activas}
          claveDeFila={(reserva) => reserva.id}
          vacio={
            isPending || error !== null ? null : (
              <Aviso>Todavia no hay nadie anotado en este turno.</Aviso>
            )
          }
        />

        {canceladas.length > 0 && (
          <div className="flex flex-col gap-2">
            {/* APARTE, Y DICIENDO QUE SON. Mezcladas con las activas, el admin
                cuenta gente que ya no viene y busca dos veces el mismo nombre. */}
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Canceladas
            </h3>
            <Tabla
              etiqueta="Canceladas"
              columnas={columnasDeCanceladas}
              filas={canceladas}
              claveDeFila={(reserva) => reserva.id}
              vacio={null}
            />
          </div>
        )}
      </div>
    </Tarjeta>
  );
}

// ---------------------------------------------------------------------------
// Cancelar
// ---------------------------------------------------------------------------

/**
 * CANCELAR EXIGE ELEGIR, y la eleccion no es tecnica.
 *
 * `DELETE /reservas/:id?tipo=recuperable|definitiva`. El DTO no tiene valor por
 * defecto y esta pantalla tampoco: una definitiva le GASTA la clase al alumno y
 * una recuperable se la DEVUELVE, asi que elegir por el admin es decidir en
 * nombre de otra persona sobre algo que esa persona pago. Con un defecto, el
 * camino de menor resistencia —abrir y confirmar— mueve el saldo del pack de
 * alguien sin que nadie lo haya decidido, y no se nota en ninguna pantalla.
 */
function PanelDeCancelar({
  turno,
  reserva,
  alVolver,
}: {
  turno: TurnoPublico;
  reserva: ReservaEnTurno;
  alVolver: () => void;
}) {
  const cancelar = useCancelar(turno.id);

  const [elegido, setElegido] = useState<TipoCancelacion | null>(null);
  const [fallo, setFallo] = useState<FalloLeido | null>(null);
  const [falta, setFalta] = useState(false);

  const idPregunta = useId();
  // El `name` del grupo de radios sale de `useId`, NO del id de la reserva: lo
  // que se mete en un atributo viaja al navegador y queda en el marcado.
  const nombreDelGrupo = useId();

  async function confirmar(): Promise<void> {
    if (elegido === null) {
      setFalta(true);
      return;
    }

    setFallo(null);

    try {
      await cancelar.mutateAsync({ id: reserva.id, tipo: elegido });
      alVolver();
    } catch (error) {
      setFallo(leerFallo(error));
    }
  }

  return (
    <div
      role="group"
      aria-label={`Cancelar la reserva de ${nombreQueSeVe(reserva)}`}
      className="flex flex-col gap-3 rounded-xl border border-slate-300 bg-white p-4 shadow-md"
    >
      <p className="text-sm font-medium text-slate-900">
        Cancelar la reserva de {nombreQueSeVe(reserva)}
      </p>

      <div role="radiogroup" aria-labelledby={idPregunta} className="flex flex-col gap-2">
        <p id={idPregunta} className="text-sm text-slate-700">
          ¿Que pasa con la clase?
        </p>

        {OPCIONES_DE_CANCELACION.map((opcion) => (
          <label key={opcion.tipo} className="flex items-start gap-2 text-sm text-slate-700">
            <input
              type="radio"
              name={nombreDelGrupo}
              value={opcion.tipo}
              checked={elegido === opcion.tipo}
              onChange={() => {
                setElegido(opcion.tipo);
                setFalta(false);
              }}
            />
            {opcion.texto}
          </label>
        ))}
      </div>

      {falta && <Aviso tono="error">Elegi que pasa con la clase antes de cancelar.</Aviso>}

      {fallo !== null && <CartelDeFallo fallo={fallo} alReintentar={() => void confirmar()} />}

      <div className="flex gap-2">
        <Boton
          type="button"
          tono="peligro"
          cargando={cancelar.isPending}
          onClick={() => void confirmar()}
        >
          Confirmar la cancelacion
        </Boton>
        <Boton type="button" tono="secundario" onClick={alVolver}>
          Volver
        </Boton>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reasignar
// ---------------------------------------------------------------------------

/**
 * MOVER LA RESERVA A OTRO TURNO. `PATCH /reservas/:id/reasignar`.
 *
 * El cuerpo lleva `turnoId` y es el DESTINO: el origen sale de la propia
 * reserva.
 *
 * LOS DESTINOS SE ACOTAN A LA SALA DEL TURNO ACTUAL. Quien ya esta anotado aqui
 * tiene acceso a esta sala, asi que cualquier turno de la misma sala le sirve;
 * ofrecerle los de otras es ofrecerle un 403 cuya causa —que salas tiene
 * asignadas ese alumno— no se ve en esta pantalla. Y el turno actual no se
 * ofrece: reasignar a donde ya esta es el 409 de «ya tiene una reserva activa
 * en el turno destino».
 */
function PanelDeReasignar({
  turno,
  reserva,
  alVolver,
}: {
  turno: TurnoPublico;
  reserva: ReservaEnTurno;
  alVolver: () => void;
}) {
  const reasignar = useReasignar(turno.id);
  const { data: turnos, isPending, error } = useTurnos({ salaId: turno.salaId });

  const [destino, setDestino] = useState('');
  const [fallo, setFallo] = useState<FalloLeido | null>(null);

  const idControl = useId();

  const posibles = (turnos ?? []).filter((candidato) => candidato.id !== turno.id);

  async function confirmar(): Promise<void> {
    if (destino === '') return;

    setFallo(null);

    try {
      await reasignar.mutateAsync({ id: reserva.id, destinoId: destino });
      alVolver();
    } catch (error) {
      setFallo(leerFallo(error));
    }
  }

  return (
    <div
      role="group"
      aria-label={`Reasignar la reserva de ${nombreQueSeVe(reserva)}`}
      className="flex flex-col gap-3 rounded-xl border border-slate-300 bg-white p-4 shadow-md"
    >
      <p className="text-sm font-medium text-slate-900">
        Reasignar la reserva de {nombreQueSeVe(reserva)}
      </p>

      {error !== null && <Aviso tono="error">{error.message}</Aviso>}

      <div className="flex flex-col gap-1">
        {/* `htmlFor` y no una etiqueta que envuelva al select: envolviendolo, el
            nombre accesible se lleva por delante el texto de las opciones. */}
        <label htmlFor={idControl} className="text-sm font-medium text-slate-700">
          Turno destino
        </label>
        <select
          id={idControl}
          value={destino}
          onChange={(evento) => setDestino(evento.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
        >
          <option value="">Elegi el turno destino</option>
          {posibles.map((candidato) => (
            // La ocupacion va EN LA OPCION: el 409 de «el turno destino esta
            // completo» se evita mirando, no leyendolo despues de mandarlo.
            <option key={candidato.id} value={candidato.id}>
              {candidato.fecha} {candidato.horaInicio} · {candidato.nombre} (
              {candidato.reservasActivas}/{candidato.cupo})
            </option>
          ))}
        </select>
      </div>

      {isPending && <p className="text-sm text-slate-500">Buscando turnos de la sala…</p>}

      {fallo !== null && <CartelDeFallo fallo={fallo} alReintentar={() => void confirmar()} />}

      <div className="flex gap-2">
        <Boton type="button" cargando={reasignar.isPending} onClick={() => void confirmar()}>
          Confirmar la reasignacion
        </Boton>
        <Boton type="button" tono="secundario" onClick={alVolver}>
          Volver
        </Boton>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Anotar
// ---------------------------------------------------------------------------

/**
 * ANOTAR A ALGUIEN. `POST /turnos/:id/reservas`.
 *
 * EL CUERPO LLEVA `perfilId` Y NADA MAS. El DTO lo dice con todas las letras:
 * «El id del Perfil, no el del Usuario. Los listados de usuarios devuelven
 * `perfilId` justamente para esto». Y nada mas porque el ValidationPipe global
 * lleva `forbidNonWhitelisted`: una clave de sobra no se ignora, tira la
 * peticion entera con un 400.
 *
 * EL PADRON SE PIDE ACOTADO A LA SALA Y SOLO ACTIVOS. `GET /usuarios` filtra
 * por `salaId` con «tiene acceso a esa sala», que es exactamente la condicion
 * que la API exige para anotar a alguien aqui. Traer el padron entero seria
 * traerse al navegador los datos de gente que no se puede anotar, y ofrecer un
 * 403 cuya causa no se ve en esta pantalla.
 *
 * LO QUE NO SE FILTRA ES A QUIEN YA ESTA ANOTADO, y la diferencia con lo
 * anterior es de fondo: eso SI se ve: esta en la lista de aqui abajo. Quitarlo
 * del selector dejaria al admin buscando a alguien que no aparece sin saber por
 * que; dejarlo, en el peor caso, le da un 409 que lo dice con palabras.
 */
function FormularioDeAnotar({
  turno,
  alAnotar,
  alVolver,
}: {
  turno: TurnoPublico;
  alAnotar: (advertencias: Advertencia[]) => void;
  alVolver: () => void;
}) {
  const anotar = useAnotar(turno.id);
  const { data: personas, isPending, error } = useUsuarios({ salaId: turno.salaId, activo: true });

  const [elegido, setElegido] = useState('');
  const [fallo, setFallo] = useState<FalloLeido | null>(null);

  const idControl = useId();

  async function enviar(): Promise<void> {
    if (elegido === '') return;

    setFallo(null);

    try {
      const creada = await anotar.mutateAsync(elegido);
      alAnotar(creada.advertencias);
    } catch (error) {
      setFallo(leerFallo(error));
    }
  }

  return (
    <div
      role="group"
      aria-label="Anotar a alguien"
      className="flex flex-col gap-3 rounded-xl border border-slate-300 bg-white p-4 shadow-md"
    >
      {error !== null && (
        <Aviso tono="error">No pudimos traer a las personas con acceso a esta sala.</Aviso>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor={idControl} className="text-sm font-medium text-slate-700">
          Persona a anotar
        </label>
        <select
          id={idControl}
          value={elegido}
          onChange={(evento) => setElegido(evento.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
        >
          <option value="">Elegi a alguien</option>
          {(personas ?? []).map((persona) => (
            // EL `perfilId`, no el `id`. Son dos identificadores distintos de la
            // misma persona y este endpoint pide el del perfil.
            <option key={persona.perfilId} value={persona.perfilId}>
              {persona.nombreCompleto}
            </option>
          ))}
        </select>
      </div>

      {isPending && <p className="text-sm text-slate-500">Buscando personas…</p>}

      {fallo !== null && <CartelDeFallo fallo={fallo} alReintentar={() => void enviar()} />}

      <div className="flex gap-2">
        <Boton type="button" cargando={anotar.isPending} onClick={() => void enviar()}>
          Anotar
        </Boton>
        <Boton type="button" tono="secundario" onClick={alVolver}>
          Volver
        </Boton>
      </div>
    </div>
  );
}
