'use client';

import { Suspense, useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import type { RolUsuario, UsuarioResumen } from '@boxadmin/shared';
import { Tabla, type ColumnaDeTabla } from '@/componentes/tabla';
import { Aviso, Boton } from '@/componentes/ui';
import { ErrorDeApi } from '@/lib/cliente';
import { useUsuarios } from '@/hooks/use-usuarios';
import { FiltrosDePersonas, filtrosDeLaBusqueda } from './filtros';

/** El enum es del contrato, no de la pantalla. */
const ROLES_LEGIBLES: Record<RolUsuario, string> = {
  SUPERADMIN: 'Superadmin',
  ADMIN_SALON: 'Admin del salon',
  ADMIN_OPERATIVO: 'Admin operativo',
  PROFESOR: 'Profesor',
  ALUMNO: 'Alumno',
  FANTASMA: 'Fantasma',
};

/**
 * Las columnas, declaradas y cerradas.
 *
 * `UsuarioResumen` trae ademas `tenantId`, `perfilId`, `telefono`, `packId` y
 * `salaIds`. Ninguno esta aqui y ninguno tiene que acabar en el DOM: lo que se
 * pinta viaja al navegador aunque este oculto por CSS, y el `tenantId` es
 * justamente el dato que la Fase 0 se ocupo de que no cruzara entre gimnasios.
 * Hay un test que compara el HTML entero contra esos cinco valores.
 */
const COLUMNAS: readonly ColumnaDeTabla<UsuarioResumen>[] = [
  { encabezado: 'Nombre', celda: (usuario) => usuario.nombreCompleto },
  { encabezado: 'Email', celda: (usuario) => usuario.email },
  { encabezado: 'Rol', celda: (usuario) => ROLES_LEGIBLES[usuario.rol] },
  { encabezado: 'Estado', celda: (usuario) => (usuario.activo ? 'Activo' : 'Dado de baja') },
  { encabezado: 'Pago al dia', celda: (usuario) => (usuario.pagoAlDia ? 'Al dia' : 'Debe') },
];

/**
 * El listado de personas.
 *
 * NO HAY PAGINACION, y es a proposito: `GET /usuarios` devuelve la lista entera
 * y la API no la tiene. Paginar en el cliente daria la ilusion de una capacidad
 * que no existe —"pagina 2 de 7" sobre datos que ya estan todos en memoria— y
 * taparia el dia en que un gimnasio con mil alumnos haga la pantalla inusable.
 * Es un limite conocido y anotado, no un descuido.
 */
function ListadoDePersonas() {
  const { slug } = useParams<{ slug: string }>();
  const parametros = useSearchParams();
  const router = useRouter();

  const filtros = filtrosDeLaBusqueda(parametros);
  const { data, isPending, error, refetch } = useUsuarios(filtros);

  const sesionCaducada = error instanceof ErrorDeApi && error.esSesionCaducada;

  useEffect(() => {
    if (!sesionCaducada) return;

    // El layout del panel ya mira la sesion en el servidor, pero eso pasa una
    // vez al entrar: el token puede caducar con la pantalla abierta, y entonces
    // el unico que se entera es este 401.
    router.push(`/${slug}/login?volverA=${encodeURIComponent(`/${slug}/admin/usuarios`)}`);
  }, [sesionCaducada, router, slug]);

  const hayFiltros = Object.keys(filtros).length > 0;

  return (
    <div className="flex flex-col gap-4">
      <FiltrosDePersonas />

      {isPending && <p className="text-sm text-slate-500">Cargando…</p>}

      {/* Sin sesion, reintentar es volver a fallar: no se ofrece el boton. */}
      {sesionCaducada && <Aviso tono="error">Tu sesion caduco. Te llevamos al login.</Aviso>}

      {error !== null && !sesionCaducada && (
        <div className="flex flex-col items-start gap-2">
          <Aviso tono="error">{error.message}</Aviso>
          {/* Un fallo de red se arregla solo cuando vuelve la red, y quien esta
              en el mostrador necesita poder volver a intentarlo sin recargar y
              perder los filtros. */}
          <Boton tono="secundario" onClick={() => void refetch()}>
            Reintentar
          </Boton>
        </div>
      )}

      {data !== undefined && (
        <Tabla
          columnas={COLUMNAS}
          filas={data}
          claveDeFila={(usuario) => usuario.id}
          enlaceDeFila={(usuario) => `/${slug}/admin/usuarios/${usuario.id}`}
          vacio={
            <Aviso>
              {hayFiltros
                ? 'No hay nadie que coincida con estos filtros.'
                : 'Todavia no hay nadie cargado en el gimnasio.'}
            </Aviso>
          }
        />
      )}
    </div>
  );
}

/**
 * `useSearchParams` obliga a una frontera de Suspense.
 *
 * Sin ella, `next build` falla en cuanto algo deje esta ruta prerenderizable, y
 * el error ("missing-suspense-with-csr-bailout") aparece lejos de aqui y cuesta
 * de ubicar. El encabezado queda FUERA para que no parpadee.
 */
export default function PaginaDePersonas() {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-slate-900">Personas</h1>

      <Suspense fallback={<p className="text-sm text-slate-500">Cargando…</p>}>
        <ListadoDePersonas />
      </Suspense>
    </section>
  );
}
