'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { ClaveInvitacionPublica } from '@boxadmin/shared';
import { Confirmar } from '@/componentes/confirmar';
import { Tabla, type ColumnaDeTabla } from '@/componentes/tabla';
import { Aviso, Boton } from '@/componentes/ui';
import { ErrorDeApi } from '@/lib/cliente';
import { useCambiarActiva, useInvitaciones } from '@/hooks/use-invitaciones';
import { mensajeDeFallo } from '../usuarios/[id]/errores';
import {
  ETIQUETAS_DE_ESTADO,
  TONOS_DE_ESTADO,
  estadoDeLaClave,
  textoDeUsos,
  textoDeVencimiento,
} from './estado';
import { FormularioDeClave } from './formulario';

/**
 * El codigo, con su boton de copiar.
 *
 * Son 32 caracteres hexadecimales de `randomBytes`: nadie los transcribe a mano
 * sin equivocarse, asi que el boton no es un lujo. Pero se COPIA CUANDO SE
 * PIDE: el portapapeles del sistema sobrevive al cierre del navegador y la
 * maquina del mostrador la usan cuatro personas por turno.
 *
 * `aria-label` nombra la clave porque en la tabla hay un "Copiar" por fila, y
 * diez botones que se llaman todos igual no le sirven a quien navega con lector
 * de pantalla.
 */
function CodigoDeClave({ clave }: { clave: ClaveInvitacionPublica }) {
  const [copia, setCopia] = useState<'sin-pedir' | 'hecha' | 'fallo'>('sin-pedir');

  async function copiar(): Promise<void> {
    try {
      await navigator.clipboard.writeText(clave.codigo);
      setCopia('hecha');
    } catch {
      // Sin HTTPS o sin permiso, `writeText` rechaza. Callarlo dejaria al admin
      // creyendo que tiene el codigo en el portapapeles.
      setCopia('fallo');
    }
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <code className="font-mono text-xs tracking-wide text-slate-900 select-all">
        {clave.codigo}
      </code>
      <button
        type="button"
        aria-label={`Copiar el codigo de ${clave.nombre}`}
        onClick={() => void copiar()}
        className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
      >
        Copiar
      </button>
      <span aria-live="polite" className="text-xs text-slate-600">
        {copia === 'hecha' && 'Copiado'}
        {copia === 'fallo' && 'No se pudo copiar'}
      </span>
    </span>
  );
}

function Insignia({ clave, ahora }: { clave: ClaveInvitacionPublica; ahora: Date }) {
  const estado = estadoDeLaClave(clave, ahora);

  return (
    <span
      // `data-estado` para que el test pueda leer el conjunto ENTERO de estados
      // de la tabla sin depender de como se escriben las etiquetas. No es un
      // dato de nadie: es el estado que ya se ve al lado, en letras.
      data-estado={estado}
      className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${TONOS_DE_ESTADO[estado]}`}
    >
      {ETIQUETAS_DE_ESTADO[estado]}
    </span>
  );
}

/**
 * Las columnas, declaradas y cerradas.
 *
 * `ClaveInvitacionPublica` trae ademas `id`, `tenantId`, `packId` y `salaIds`.
 * Ninguno esta aqui: `tenantId` es justo el dato que la Fase 0 se ocupo de que
 * no cruzara entre gimnasios, y lo que se pinta viaja al navegador aunque este
 * tapado por CSS. Hay un test que compara el conjunto entero.
 *
 * Es una funcion y no una constante porque las acciones necesitan los
 * manejadores de la pantalla, y `ahora` tiene que ser el mismo para toda la
 * tabla: calcularlo por fila dejaria dos filas del mismo listado juzgadas con
 * relojes distintos.
 */
function columnasDe({
  ahora,
  alEditar,
  alPedirDesactivar,
  alActivar,
}: {
  ahora: Date;
  alEditar: (clave: ClaveInvitacionPublica) => void;
  alPedirDesactivar: (clave: ClaveInvitacionPublica) => void;
  alActivar: (clave: ClaveInvitacionPublica) => void;
}): readonly ColumnaDeTabla<ClaveInvitacionPublica>[] {
  return [
    { encabezado: 'Nombre', celda: (clave) => clave.nombre },
    { encabezado: 'Codigo', celda: (clave) => <CodigoDeClave clave={clave} /> },
    { encabezado: 'Estado', celda: (clave) => <Insignia clave={clave} ahora={ahora} /> },
    { encabezado: 'Usos', celda: textoDeUsos },
    { encabezado: 'Vence', celda: textoDeVencimiento },
    {
      encabezado: 'Acciones',
      celda: (clave) => (
        <span className="flex flex-wrap gap-2">
          <Boton
            type="button"
            tono="secundario"
            aria-label={`Editar ${clave.nombre}`}
            onClick={() => alEditar(clave)}
          >
            Editar
          </Boton>

          {clave.activa ? (
            <Boton
              type="button"
              tono="peligro"
              aria-label={`Desactivar ${clave.nombre}`}
              onClick={() => alPedirDesactivar(clave)}
            >
              Desactivar
            </Boton>
          ) : (
            // Activar NO pregunta: no rompe nada y se deshace con el boton de al
            // lado. El dialogo que aparece siempre es el que se aprende a
            // confirmar sin leer, y entonces ya no protege el que importa.
            <Boton
              type="button"
              tono="secundario"
              aria-label={`Activar ${clave.nombre}`}
              onClick={() => alActivar(clave)}
            >
              Activar
            </Boton>
          )}
        </span>
      ),
    },
  ];
}

type Panel = { modo: 'crear' } | { modo: 'editar'; clave: ClaveInvitacionPublica } | null;

function ListadoDeInvitaciones() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();

  const { data, isPending, error, refetch } = useInvitaciones();
  const cambiarActiva = useCambiarActiva();

  const [panel, setPanel] = useState<Panel>(null);
  const [aDesactivar, setADesactivar] = useState<ClaveInvitacionPublica | null>(null);

  /**
   * El reloj se congela al montar.
   *
   * Si fuera `new Date()` en cada render, el servidor y el navegador podrian
   * calcular el estado de una clave que vence justo ahora con milisegundos
   * distintos, y React avisaria de una hidratacion que no cuadra.
   */
  const [ahora] = useState(() => new Date());

  const sesionCaducada = error instanceof ErrorDeApi && error.esSesionCaducada;

  useEffect(() => {
    if (!sesionCaducada) return;

    // El layout del panel mira la sesion en el servidor, pero eso pasa una vez
    // al entrar: el token puede caducar con la pantalla abierta.
    router.push(`/${slug}/login?volverA=${encodeURIComponent(`/${slug}/admin/invitaciones`)}`);
  }, [sesionCaducada, router, slug]);

  function desactivar(): void {
    if (aDesactivar === null) return;

    cambiarActiva.mutate(
      { id: aDesactivar.id, activa: false },
      { onSuccess: () => setADesactivar(null) },
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {panel === null && (
        <div>
          {/* "Nueva clave" y no "Crear clave": el boton que ENVIA el formulario
              se llama asi, y dos botones con el mismo nombre en la misma
              pantalla son dos cosas distintas que suenan igual en un lector de
              pantalla. */}
          <Boton type="button" onClick={() => setPanel({ modo: 'crear' })}>
            Nueva clave
          </Boton>
        </div>
      )}

      {panel !== null && (
        <FormularioDeClave
          // La `key` fuerza un formulario NUEVO al pasar de una clave a otra:
          // sin ella, React reaprovecha el mismo y los valores de la anterior se
          // quedan dentro, que es como se guarda sin querer encima de otra.
          key={panel.modo === 'crear' ? 'nueva' : panel.clave.id}
          {...(panel.modo === 'editar' ? { clave: panel.clave } : {})}
          alTerminar={() => setPanel(null)}
          alCancelar={() => setPanel(null)}
        />
      )}

      {isPending && <p className="text-sm text-slate-500">Cargando…</p>}

      {/* Sin sesion, reintentar es volver a fallar: no se ofrece el boton. */}
      {sesionCaducada && <Aviso tono="error">Tu sesion caduco. Te llevamos al login.</Aviso>}

      {error !== null && !sesionCaducada && (
        <div className="flex flex-col items-start gap-2">
          <Aviso tono="error">{mensajeDeFallo(error, 'ADMIN_OPERATIVO')}</Aviso>
          <Boton tono="secundario" onClick={() => void refetch()}>
            Reintentar
          </Boton>
        </div>
      )}

      {/* El fallo de prender o apagar va aqui arriba y no dentro de la fila: la
          tabla se vuelve a pintar con los datos de la API y se lo llevaria. */}
      {cambiarActiva.error !== null && aDesactivar === null && (
        <Aviso tono="error">{mensajeDeFallo(cambiarActiva.error, 'ADMIN_OPERATIVO')}</Aviso>
      )}

      {data !== undefined && (
        <Tabla
          columnas={columnasDe({
            ahora,
            alEditar: (clave) => setPanel({ modo: 'editar', clave }),
            alPedirDesactivar: setADesactivar,
            alActivar: (clave) => cambiarActiva.mutate({ id: clave.id, activa: true }),
          })}
          filas={data}
          claveDeFila={(clave) => clave.id}
          vacio={
            <Aviso>
              Todavia no hay ninguna clave de invitacion. Crea una para que los alumnos puedan darse
              de alta solos.
            </Aviso>
          }
        />
      )}

      {aDesactivar !== null && (
        <Confirmar
          // NOMBRA LA CLAVE. Sin el nombre, el admin del mostrador confirma la
          // fila de arriba creyendo que es la de abajo, y lo que apaga es el
          // alta de toda una tanda de alumnos.
          pregunta={`Desactivar la clave "${aDesactivar.nombre}"`}
          detalle="Quien tenga el codigo deja de poder darse de alta con el. Se puede volver a activar, y el codigo no cambia."
          textoDeConfirmar="Desactivar"
          cargando={cambiarActiva.isPending}
          error={
            cambiarActiva.error === null
              ? undefined
              : mensajeDeFallo(cambiarActiva.error, 'ADMIN_OPERATIVO')
          }
          alConfirmar={desactivar}
          alCancelar={() => {
            setADesactivar(null);
            cambiarActiva.reset();
          }}
        />
      )}
    </div>
  );
}

/**
 * Las claves de invitacion del gimnasio.
 *
 * No hay `useSearchParams` y por eso no hay frontera de Suspense: esta pantalla
 * no tiene filtros. Cuando los tenga, hara falta, y `next build` lo dira con
 * "missing-suspense-with-csr-bailout".
 */
export default function PaginaDeInvitaciones() {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-slate-900">Invitaciones</h1>

      <p className="max-w-2xl text-sm text-slate-600">
        Cada clave es un codigo que el alumno escribe para darse de alta solo, con las salas y el
        pack que diga la clave. El codigo no se puede cambiar: si se filtro, se desactiva y se crea
        otra.
      </p>

      <ListadoDeInvitaciones />
    </section>
  );
}
