import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { RolUsuario } from '@boxadmin/shared';
import { destinoPorRol } from '@/lib/destino-por-rol';
import { rutaPedida } from '@/lib/ruta-pedida';
import { leerRol, leerSesion, sesionValidaPara } from '@/lib/sesion';
// El boton vive en el area del alumno porque ahi nacio, y se importa en vez de
// copiarse: son veinte lineas, pero una de ellas es el `catch` que deja salir a
// quien no puede hablar con la API, y una copia sin ese `catch` dejaria a la
// profesora encerrada justamente el dia que la red falla.
import { BotonDeSalir } from '../(alumno)/perfil/boton-de-salir';

// El layout raiz dice "Tus clases, en tu bolsillo", que es del alumno: las
// clases de las que habla son las que TOMA, no las que da.
export const metadata: Metadata = { title: 'Mis clases · BoxAdmin' };

/** La entrada del area: a donde se vuelve del login cuando no hay nada mejor. */
const ENTRADA = (slug: string): string => `/${slug}/mis-clases`;

/**
 * COMO SE LLAMA, CON PALABRAS, EL SITIO AL QUE SE LE OFRECE IR.
 *
 * Esto NO duplica `destinoPorRol`: la URL sale de alli y de ningun otro sitio.
 * Lo que vive aqui son las PALABRAS, y hacen falta porque «Ir a donde si tenes
 * algo» no le dice a nadie adonde va — y un enlace que no dice adonde lleva es
 * media pantalla de error.
 *
 * `FANTASMA` no esta, y no por olvido: ese rol no tiene ningun sitio, y su
 * ausencia del tipo es lo que hace que agregar un rol nuevo al enum rompa la
 * compilacion aqui en vez de pintar un enlace sin texto.
 */
const COMO_SE_LLAMA_SU_SITIO: Record<Exclude<RolUsuario, 'PROFESOR' | 'FANTASMA'>, string> = {
  SUPERADMIN: 'Ir al panel',
  ADMIN_SALON: 'Ir al panel',
  ADMIN_OPERATIVO: 'Ir al panel',
  ALUMNO: 'Ir a tu calendario',
};

/**
 * LA PUERTA DEL AREA DE LA PROFESORA.
 *
 * Es el molde de `(alumno)/layout.tsx` con un rol distinto, y eso es
 * deliberado: la puerta del alumno ya resolvio las cuatro decisiones de aqui
 * —el orden de las comprobaciones, el `volverA` que conserva la pagina, la
 * igualdad de rol en vez de la jerarquia y la salida hacia donde esa persona SI
 * tiene algo— y cada una de ellas se pago una vez.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTA PUERTA EXISTE RECIEN AHORA.
 *
 * `PROFESOR` es un rol entero que, desde la Fase 4, no tenia NINGUN sitio
 * adonde ir. Sus tres endpoints existen —`@Controller('mis-clases')`, los tres
 * metodos con `@Roles('PROFESOR')`— y `destinoPorRol` la mandaba al calendario,
 * cuyo layout exige `rol === 'ALUMNO'`. O sea: una profesora que ponia bien su
 * contraseña aterrizaba en «Esta no es tu area». Entrar correctamente la
 * echaba. Esta puerta y el arreglo de `destinoPorRol` son la misma reparacion
 * partida en dos archivos, y por eso la comprobacion de que encajan vive en el
 * spec de aqui y no en el de la funcion: una ruta correcta hacia una puerta
 * cerrada es lo que habia antes.
 *
 * ---------------------------------------------------------------------------
 * CORRE EN EL SERVIDOR, que es lo unico que la hace una puerta y no un cartel.
 *
 * Lee las cookies httpOnly, asi que la comprobacion no se puede saltar desde el
 * navegador. Las tres condiciones van en este orden y no en otro:
 *
 *  1. HAY SESION Y ES DE ESTE GIMNASIO. El JWT lleva su propio `tenantId`: sin
 *     comparar el slug, alguien con sesion en `/gym-a` que abriera
 *     `/gym-b/mis-clases` veria la agenda de A bajo la URL de B.
 *  2. EL TOKEN VALE. `null` de `/auth/me` es token invalido o caducado, y eso
 *     SI se arregla volviendo a entrar.
 *  3. EL ROL ES EL SUYO. Y aqui la jerarquia NO vale, por lo mismo que en el
 *     area del alumno: con `rolAlcanza(rol, 'PROFESOR')` entrarian los tres
 *     roles de admin, y la agenda de una profesora no es «lo que ve un admin
 *     con menos permisos». Ademas, el endpoint tampoco los dejaria: el service
 *     resuelve el perfil del ACTOR, asi que un admin sin perfil de profesora se
 *     comeria el 404 de «Este usuario no tiene perfil de profesora» encima de
 *     una pantalla que le habia dicho que pasara.
 *
 * ---------------------------------------------------------------------------
 * PENSADA PARA UN TELEFONO, Y NO COMO ADORNO.
 *
 * Quien pasa lista esta de pie en la sala con nueve personas esperando y el
 * telefono en una mano. `max-w-md` —el mismo ancho que el area del alumno— y
 * nada de barra lateral: el area tiene UNA pantalla y una lista por clase, asi
 * que una navegacion seria un menu de un solo elemento ocupando el sitio de los
 * nombres.
 */
export default async function LayoutDeProfesor({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const sesion = await leerSesion();

  /**
   * El destino que se conserva es LA PAGINA DONDE ESTABA, no la entrada del
   * area: a la profesora a la que se le vence la sesion dentro de la lista de
   * una clase, el login la devuelve a ESA clase —que es la que tiene delante—
   * y no a la agenda, donde tendria que volver a buscarla de pie.
   *
   * La ruta la trae `rutaPedida` de una cabecera que pone el middleware, porque
   * un layout del App Router no la recibe. Y la trae YA VALIDADA: esa cabecera
   * puede venir del cliente.
   */
  const volverA = await rutaPedida(slug, ENTRADA(slug));
  const alLogin = `/${slug}/login?volverA=${encodeURIComponent(volverA)}`;

  if (!sesionValidaPara(sesion, slug)) {
    redirect(alLogin);
  }

  // `sesionValidaPara` ya garantizo que `access` existe.
  const yo = await leerRol(sesion.access as string);

  // Null es token invalido o caducado: eso SI se arregla volviendo a entrar.
  if (yo === null) redirect(alLogin);

  if (yo.rol !== 'PROFESOR') {
    /**
     * A QUIEN NO ES PROFESORA NO SE LO MANDA AL LOGIN: volver a autenticarse no
     * cambia el rol, asi que seria un bucle. Se le dibuja una pantalla con UNA
     * salida, y la salida sale de `destinoPorRol` —la MISMA funcion que decide
     * donde aterriza esa persona al entrar— en vez de una lista de ramas
     * escrita aqui. Dos ideas de «donde tiene algo esta persona» es lo que se
     * separa con el tiempo, y la que se quedaria vieja es esta.
     *
     * EL FANTASMA ES LA EXCEPCION, Y NO SE PUEDE DELEGAR. `destinoPorRol` lo
     * manda al calendario porque es el respaldo de todo lo que no es admin ni
     * profesor, pero el calendario tambien lo rechaza: es un rol tecnico
     * —usuario de relleno que nunca se loguea, rango 0 en `JERARQUIA_ROLES`— y
     * no tiene area ninguna. Ofrecerle un enlace seria mandarlo a una puerta
     * que ya sabemos cerrada, que es exactamente el bug que esta fase vino a
     * arreglar para la profesora. Lo unico que de verdad lo saca de aqui es
     * cerrar sesion.
     */
    const suSitio = yo.rol === 'FANTASMA' ? null : COMO_SE_LLAMA_SU_SITIO[yo.rol];

    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-4 p-6">
        <h1 className="text-2xl font-semibold text-slate-900">Esta no es tu area</h1>
        <p className="text-slate-600">
          Tu cuenta no es de profesora, asi que aca no hay ninguna clase tuya.
        </p>
        {suSitio === null ? (
          <BotonDeSalir slug={slug} />
        ) : (
          <Link
            data-salida
            href={destinoPorRol(yo.rol, slug)}
            className="font-medium text-slate-900 underline"
          >
            {suSitio}
          </Link>
        )}
      </main>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-slate-50">
      <main className="flex-1 p-4">{children}</main>
    </div>
  );
}
