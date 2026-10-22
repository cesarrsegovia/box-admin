import Link from 'next/link';
import type { RolUsuario } from '@boxadmin/shared';
import { destinoPorRol } from '@/lib/destino-por-rol';
// El boton vive en el area del alumno porque ahi nacio, y se importa en vez de
// copiarse: son veinte lineas, pero una de ellas es el `catch` que deja salir a
// quien no puede hablar con la API.
import { BotonDeSalir } from '../(alumno)/perfil/boton-de-salir';

const NOMBRE_DEL_ROL: Record<RolUsuario, string> = {
  SUPERADMIN: 'superadministrador',
  ADMIN_SALON: 'administrador del salon',
  ADMIN_OPERATIVO: 'administrador operativo',
  PROFESOR: 'profesor',
  ALUMNO: 'alumno',
  FANTASMA: 'sin acceso',
};

/**
 * COMO SE LLAMA, CON PALABRAS, EL SITIO AL QUE SE LE OFRECE IR.
 *
 * Esto NO duplica `destinoPorRol`: la URL sale de alli y de ningun otro sitio.
 * Lo que vive aqui son las PALABRAS, y hacen falta porque un enlace que no dice
 * adonde lleva es media pantalla de error.
 *
 * Los tres roles de admin no pueden llegar a esta pantalla —la puerta los deja
 * pasar— pero estan en el tipo, asi que estan aqui. `FANTASMA` no esta, y no
 * por olvido: ver abajo.
 */
const COMO_SE_LLAMA_SU_SITIO: Record<Exclude<RolUsuario, 'FANTASMA'>, string> = {
  SUPERADMIN: 'Ir al panel',
  ADMIN_SALON: 'Ir al panel',
  ADMIN_OPERATIVO: 'Ir al panel',
  PROFESOR: 'Ir a tus clases',
  ALUMNO: 'Ir a tu calendario',
};

/**
 * El 403 del panel.
 *
 * NO es un redirect al login, y eso es lo primero importante de este archivo:
 * mandar aqui al login seria un bucle sin salida, porque volver a autenticarse
 * no cambia el rol. Se dice que rol hace falta, que es lo que convierte un
 * reclamo en una conversacion con el dueño.
 *
 * ---------------------------------------------------------------------------
 * LA SALIDA SALE DE `destinoPorRol`, Y HASTA LA FASE 13 NO SALIA.
 *
 * Este `href` estaba cableado a `/${slug}/calendario` para CUALQUIER rol
 * rechazado, `PROFESOR` incluido. O sea: una profesora que abria una URL del
 * panel —un enlace que le pasaron, un favorito viejo— salia de aqui hacia el
 * calendario, cuyo layout exige `rol === 'ALUMNO'`, y aterrizaba en «Esta no es
 * tu area». Es exactamente el bug que esta fase arreglo del otro lado del
 * mostrador: un destino cableado hacia una puerta que ya sabemos cerrada.
 *
 * Dos ideas de «donde tiene algo esta persona» es lo que se separa con el
 * tiempo, y la que se quedaria vieja es esta. Por eso la URL la decide la MISMA
 * funcion que decide donde aterriza esa persona al entrar.
 *
 * ---------------------------------------------------------------------------
 * EL FANTASMA ES LA EXCEPCION, Y NO SE PUEDE DELEGAR.
 *
 * `destinoPorRol` lo manda al calendario porque es el respaldo de todo lo que
 * no es admin ni profesor, pero el calendario TAMBIEN lo rechaza: es un rol
 * tecnico —usuario de relleno que nunca se loguea, rango 0 en
 * `JERARQUIA_ROLES`— y no tiene area ninguna. Ofrecerle el enlace seria repetir
 * el mismo bug con otro rol. Lo unico que de verdad lo saca de aqui es cerrar
 * sesion.
 *
 * Que `FANTASMA` falte en `COMO_SE_LLAMA_SU_SITIO` es lo que hace que agregar
 * un rol nuevo al enum rompa la compilacion aqui, en vez de pintar un enlace
 * sin texto.
 */
export function SinPermiso({ rol, slug }: { rol: RolUsuario; slug: string }) {
  const suSitio = rol === 'FANTASMA' ? null : COMO_SE_LLAMA_SU_SITIO[rol];

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold text-slate-900">No tenes permiso para entrar aca</h1>
      <p className="text-slate-600">
        El panel pide ser <strong>administrador operativo</strong> como minimo, y tu cuenta es de{' '}
        <strong>{NOMBRE_DEL_ROL[rol]}</strong>. Si creés que es un error, hablalo con quien
        administra el gimnasio.
      </p>
      {suSitio === null ? (
        <BotonDeSalir slug={slug} />
      ) : (
        <Link
          data-salida
          href={destinoPorRol(rol, slug)}
          className="font-medium text-slate-900 underline"
        >
          {suSitio}
        </Link>
      )}
    </main>
  );
}
