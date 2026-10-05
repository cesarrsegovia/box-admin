'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CheckInRechazado, MotivoDeRechazoDeCheckIn, PresenteMarcado } from '@boxadmin/shared';
import { Aviso, Boton, Tarjeta } from '@/componentes/ui';
import { ErrorDeApi, pedir } from '@/lib/cliente';

/**
 * Los cinco estados de la pantalla, como union y no como tres booleanos
 * sueltos: asi no existe el "cargando y rechazado a la vez".
 *
 * `error` es deliberadamente distinto de `rechazado`. Un rechazo es una
 * RESPUESTA del sistema —el alumno sabe que paso y que hacer—; un error es la
 * AUSENCIA de respuesta, y lo unico que cabe hacer es reintentar.
 */
type Estado =
  | { tipo: 'sin-firma' }
  | { tipo: 'marcando' }
  | { tipo: 'marcado'; datos: PresenteMarcado }
  | { tipo: 'rechazado'; datos: CheckInRechazado }
  | { tipo: 'error'; mensaje: string };

/**
 * Los cuatro motivos del contrato, como objeto y no como array.
 *
 * Es un `Record` sobre la union: el dia que el contrato tenga un quinto
 * motivo, a este objeto le faltara una clave y TypeScript no compilara. Es la
 * red que impide que un motivo nuevo caiga en silencio en el cajon de
 * "error raro".
 */
const MOTIVOS_CONOCIDOS: Record<MotivoDeRechazoDeCheckIn, true> = {
  'sin-reserva': true,
  'fuera-de-ventana': true,
  'ya-marcada': true,
  'lista-ya-pasada': true,
};

/**
 * Un 409 del check-in, o null si lo que vino no es uno.
 *
 * El `motivo` llega de la red como `unknown`: un 409 de otra capa (o de un
 * despliegue mas nuevo de la API) no puede colarse como si fuera uno de los
 * cuatro.
 */
function rechazoDeCheckIn(error: ErrorDeApi): CheckInRechazado | null {
  if (error.estado !== 409) return null;

  const cuerpo = error.cuerpo;
  if (typeof cuerpo !== 'object' || cuerpo === null) return null;

  const { motivo } = cuerpo as { motivo?: unknown };
  if (typeof motivo !== 'string') return null;
  if (!Object.hasOwn(MOTIVOS_CONOCIDOS, motivo)) return null;

  return cuerpo as CheckInRechazado;
}

/** La clase de la que se esta hablando. Viaja en todos los motivos menos `sin-reserva`. */
function DatosDeLaClase({ datos }: { datos: CheckInRechazado }) {
  if (datos.clase === undefined) return null;

  return (
    <p className="mt-2 text-sm text-slate-700">
      <strong>{datos.clase}</strong>
      {datos.horaInicio !== undefined && <> · {datos.horaInicio}</>}
      {datos.fecha !== undefined && <> · {datos.fecha}</>}
    </p>
  );
}

/**
 * El ramificado sobre los cuatro motivos.
 *
 * Cada uno con su mensaje porque cada uno manda al alumno a hacer una cosa
 * distinta. El `never` del final es lo que hace que un quinto motivo rompa la
 * compilacion en vez de caer en un `else` mudo.
 */
function Rechazo({ datos }: { datos: CheckInRechazado }) {
  switch (datos.motivo) {
    case 'sin-reserva':
      return (
        <Tarjeta>
          <h1 className="text-lg font-semibold text-slate-900">
            No encontramos una reserva tuya para ahora
          </h1>
          {/* Es el unico motivo sin clase de la que hablar: no hay candidata. */}
          <p className="mt-2 text-sm text-slate-700">{datos.message}</p>
          <p className="mt-2 text-sm text-slate-500">
            Fijate en tu calendario si la reserva quedo hecha.
          </p>
        </Tarjeta>
      );

    case 'fuera-de-ventana':
      return (
        <Tarjeta>
          <h1 className="text-lg font-semibold text-slate-900">
            Estas fuera del horario de marcado
          </h1>
          {/* Sin decir CUAL era la clase y a que hora, el alumno no sabe si
              llego pronto, tarde, o si marco el QR del dia equivocado. */}
          <DatosDeLaClase datos={datos} />
          <p className="mt-2 text-sm text-slate-700">{datos.message}</p>
        </Tarjeta>
      );

    case 'ya-marcada':
      return (
        <Tarjeta>
          <h1 className="text-lg font-semibold text-slate-900">Ya estabas marcado</h1>
          <DatosDeLaClase datos={datos} />
          <p className="mt-2 text-sm text-slate-700">{datos.message}</p>
          <p className="mt-2 text-sm text-slate-500">No hace falta que hagas nada mas.</p>
        </Tarjeta>
      );

    case 'lista-ya-pasada':
      return (
        <Tarjeta>
          <h1 className="text-lg font-semibold text-slate-900">
            Tu profesora ya paso lista en esa clase
          </h1>
          <DatosDeLaClase datos={datos} />
          <p className="mt-2 text-sm text-slate-700">{datos.message}</p>
          {/* NO es lo mismo que `ya-marcada`: a este alumno no lo marcaron, y
              quien puede corregirlo es su profesora, no esta pantalla. */}
          <p className="mt-2 text-sm text-slate-500">
            Hablalo con tu profesora: es quien puede corregirlo.
          </p>
        </Tarjeta>
      );

    default: {
      // Si algun dia esto deja de compilar, es que el contrato tiene un motivo
      // nuevo y esta pantalla todavia no sabe que decirle al alumno.
      //
      // En ejecucion es inalcanzable: `rechazoDeCheckIn` ya filtro los motivos
      // que no estan en el contrato. No se pinta el motivo crudo porque un
      // identificador tecnico no le dice nada al alumno.
      const motivoNoContemplado: never = datos.motivo;
      void motivoNoContemplado;
      return null;
    }
  }
}

export function PantallaDeCheckIn({ slug, firma }: { slug: string; firma: string | null }) {
  // El estado inicial lo decide la firma: con firma ya se esta marcando
  // —el POST sale en el efecto de abajo— y sin firma no hay nada que mandar.
  const [estado, setEstado] = useState<Estado>(
    firma === null ? { tipo: 'sin-firma' } : { tipo: 'marcando' },
  );

  const marcar = useCallback(async (laFirma: string) => {
    setEstado({ tipo: 'marcando' });

    try {
      const datos = await pedir<PresenteMarcado>('/checkin', {
        metodo: 'POST',
        cuerpo: { firma: laFirma },
      });
      setEstado({ tipo: 'marcado', datos });
    } catch (error) {
      if (error instanceof ErrorDeApi) {
        const rechazo = rechazoDeCheckIn(error);
        if (rechazo !== null) {
          setEstado({ tipo: 'rechazado', datos: rechazo });
          return;
        }
        setEstado({ tipo: 'error', mensaje: error.message });
        return;
      }
      setEstado({ tipo: 'error', mensaje: 'Error inesperado' });
    }
  }, []);

  // El POST sale UNA vez por firma. El guardia no es decorativo: en
  // desarrollo React monta dos veces, y sin el, el segundo intento convertiria
  // un check-in bueno en un `ya-marcada` que el alumno no entenderia.
  const firmaYaEnviada = useRef<string | null>(null);

  useEffect(() => {
    if (firma === null) return;
    if (firmaYaEnviada.current === firma) return;

    firmaYaEnviada.current = firma;
    void marcar(firma);
  }, [firma, marcar]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-4 p-6">
      {estado.tipo === 'marcando' && (
        <Tarjeta>
          {/* `role="status"` y no solo texto: el alumno llega aqui desde la
              camara, y quien usa lector de pantalla tiene que oir que algo
              esta pasando. */}
          <p role="status" className="text-sm text-slate-700">
            Marcando tu asistencia…
          </p>
        </Tarjeta>
      )}

      {estado.tipo === 'marcado' && (
        <Tarjeta>
          <h1 className="text-lg font-semibold text-slate-900">¡Listo, quedaste presente!</h1>
          <p className="mt-2 text-sm text-slate-700">
            <strong>{estado.datos.clase}</strong> · {estado.datos.horaInicio} · {estado.datos.fecha}
          </p>
        </Tarjeta>
      )}

      {estado.tipo === 'rechazado' && <Rechazo datos={estado.datos} />}

      {estado.tipo === 'sin-firma' && (
        <Tarjeta>
          <h1 className="text-lg font-semibold text-slate-900">Falta la firma del QR</h1>
          {/* No se llama a la API: no hay nada que mandar. Quien llega aqui
              escribio la direccion a mano o guardo la pagina en favoritos. */}
          <p className="mt-2 text-sm text-slate-700">
            Escanea el codigo que esta en la pared del gimnasio.
          </p>
        </Tarjeta>
      )}

      {estado.tipo === 'error' && (
        <>
          <Aviso tono="error">No pudimos marcar tu asistencia. {estado.mensaje}</Aviso>
          {/* Reintentar y no "volve a escanear": la firma sigue en la URL, y
              el alumno ya guardo el telefono. */}
          <Boton type="button" onClick={() => firma !== null && void marcar(firma)}>
            Reintentar
          </Boton>
        </>
      )}

      <Link href={`/${slug}/calendario`} className="text-center text-sm text-slate-500 underline">
        Ir a tu calendario
      </Link>
    </main>
  );
}
