import type { CSSProperties } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type {
  PackEnLanding,
  PreguntaPublica,
  SalonPublico,
  TestimonioPublico,
  TurnoLibrePublico,
} from '@boxadmin/shared';
import { urlDeApi } from '@/lib/api-url';
import {
  COLOR_PRIMARIO_POR_DEFECTO,
  COLOR_SECUNDARIO_POR_DEFECTO,
  colorSeguro,
} from '@/lib/color-seguro';
import {
  enlaceDeInstagram,
  enlaceDeWhatsapp,
  urlHttps,
  usuarioDeInstagram,
} from '@/lib/enlaces-del-salon';
import { estaEnBlanco, sinFilasIncompletas, sinTextosEnBlanco } from '@/lib/texto-en-blanco';

/**
 * LA LANDING PUBLICA DEL GIMNASIO. La cara que ve alguien que todavia no es
 * alumno.
 *
 * VA SSR Y NO EN CLIENTE. Es la unica superficie del sistema donde el SEO
 * importa: un buscador tiene que encontrar el nombre, el tagline y los planes
 * en el HTML que llega, no despues de que un `useEffect` los pida. Por eso no
 * hay aqui ni `use client`, ni TanStack Query, ni estado.
 *
 * Y ES LA PRIMERA VEZ EN EL PROYECTO que texto escrito por un usuario se
 * muestra en una pagina publica. Todo lo que escribe el admin se renderiza
 * como TEXTO: React escapa por defecto y la regla es no salirse de ese camino.
 * No hay —ni puede haber— un solo `dangerouslySetInnerHTML` en este archivo.
 */

/** Cada peticion se sirve en el momento: la landing cambia cuando el admin la edita. */
export const dynamic = 'force-dynamic';

/**
 * La misma forma de slug que exige `PublicoController` en la API.
 *
 * Se comprueba aqui tambien para que un slug imposible no llegue siquiera a
 * salir a la red, y para que el 404 lo decida esta pagina en vez de depender
 * de que el otro lado lo decida igual.
 */
const FORMA_DEL_SLUG = /^[a-z0-9-]{2,60}$/;

/**
 * Trae el salon publico.
 *
 * ⚠️ SIN SESION, Y TIENE QUE SEGUIR SIENDO ASI.
 *
 * Se llama a la API DIRECTAMENTE y no al proxy `/api/bx`. El proxy existe para
 * el navegador: es quien añade el token desde la cookie httpOnly, y sin cookie
 * responde 401 — que es exactamente lo que le pasaria a un visitante que no es
 * alumno de nadie. Aqui estamos en el servidor, dentro de la red de la API, y
 * la ruta es publica: el proxy no aporta nada y si estorba. `urlDeApi` es el
 * mismo cortafuegos que usa el proxy, asi que el destino se valida igual.
 *
 * `credentials: 'omit'` es redundante en el servidor —no hay tarro de cookies—
 * y se escribe igual: deja la intencion a la vista y hay un test que la fija.
 */
async function traerSalon(slug: string): Promise<SalonPublico> {
  if (!FORMA_DEL_SLUG.test(slug)) notFound();

  // Si `API_URL` falta, `urlDeApi` lanza. Eso es un despliegue mal
  // configurado, no un gimnasio que no existe: se deja subir.
  const url = urlDeApi(['public', 'salon', slug], '');

  const respuesta = await fetch(url, {
    credentials: 'omit',
    headers: { accept: 'application/json' },
    cache: 'no-store',
  });

  // Los cuatro caminos de "no hay web" dan el mismo 404 en la API y aqui se
  // tratan como uno solo, que es el sentido de que sean indistinguibles.
  if (respuesta.status === 404) notFound();

  // Una averia NO es un not-found. Decirle a quien entra que el gimnasio no
  // existe mientras la API esta caida es mentir, y encima lo deja indexado
  // como inexistente.
  if (!respuesta.ok) {
    throw new Error(`La API respondio ${respuesta.status} en /public/salon/${slug}`);
  }

  const salon = (await respuesta.json()) as SalonPublico;

  // Un campo en blanco es un campo que no vino. Se normaliza AQUI, de una vez
  // y en el unico sitio por donde entra la respuesta, para que ninguna seccion
  // tenga que acordarse de la regla.
  const limpio = sinTextosEnBlanco(salon);

  // Y las filas incompletas se van ANTES de que nadie decida si hay seccion:
  // si al filtrar no queda ninguna, la seccion no se renderiza por la regla de
  // siempre —lista vacia es lista que no vino—. Al reves quedaria el
  // encabezado con el hueco debajo, que es justo lo que se intenta evitar.
  //
  // El `...(x === undefined ? {} : {...})` es el mismo patron que usa
  // `publico.service.ts` al armar la respuesta: una clave ausente tiene que
  // seguir ausente, no reaparecer valiendo `undefined`.
  return {
    ...limpio,
    // Manda el NOMBRE, y solo el nombre: `precio: null` es legitimo —sale
    // "Consultanos"— asi que exigir precio descartaria packs que estan
    // perfectos. Sin nombre no hay plan que ofrecer por mucho que haya cifra,
    // y encima la insignia de destacado le da aire de intencional a lo que es
    // un error de carga.
    ...(limpio.packs === undefined ? {} : { packs: sinFilasIncompletas(limpio.packs, ['nombre']) }),
    // LOS CUATRO. `fecha` y `horaInicio` no las escribe el admin: si llegan en
    // blanco es que algo se rompio aguas arriba, y un `"/"` en la pantalla
    // —que es lo que devuelve `diaYMes('')`— se lee como un detalle de
    // maquetacion y no lo reporta nadie nunca.
    ...(limpio.turnosLibres === undefined
      ? {}
      : {
          turnosLibres: sinFilasIncompletas(limpio.turnosLibres, [
            'fecha',
            'horaInicio',
            'clase',
            'salaNombre',
          ]),
        }),
    // Manda el TEXTO. Sin texto no hay testimonio por mucho que haya nombre;
    // con texto y sin nombre se queda, porque un testimonio anonimo sirve.
    ...(limpio.testimonios === undefined
      ? {}
      : { testimonios: sinFilasIncompletas(limpio.testimonios, ['texto']) }),
    // Aqui mandan LOS DOS: una pregunta sin respuesta no es media pregunta.
    ...(limpio.preguntas === undefined
      ? {}
      : { preguntas: sinFilasIncompletas(limpio.preguntas, ['pregunta', 'respuesta']) }),
  };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  // Son dos llamadas a `traerSalon` por visita —esta y la de la pagina— que
  // Next convierte en una sola peticion: memoiza los `fetch` GET dentro de la
  // misma solicitud. Aunque no lo hiciera, serian dos llamadas a una ruta
  // publica y barata, y es mejor eso que un titulo generico.
  const salon = await traerSalon(slug);

  // Sin esto, los veinte gimnasios comparten el titulo "BoxAdmin" del layout
  // raiz, y la pagina para la que el SSR existe no se distingue de ninguna
  // otra en un resultado de busqueda.
  return {
    title: salon.nombre,
    ...(salon.tagline === null ? {} : { description: salon.tagline }),
  };
}

/** `2026-10-05` → `05/10`. Corte de cadena, sin `Date`: ni zonas ni sorpresas. */
function diaYMes(fecha: string): string {
  return `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`;
}

/**
 * Una seccion con su encabezado.
 *
 * El `aria-labelledby` no es decoracion: es lo que convierte al `<section>` en
 * una `region` con nombre para un lector de pantalla —y de paso lo que permite
 * auditarlas desde los tests—.
 */
function Seccion({
  id,
  titulo,
  children,
}: {
  id: string;
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4 px-6 py-10">
      <h2 id={id} className="text-xl font-semibold text-slate-900">
        {titulo}
      </h2>
      {children}
    </section>
  );
}

function Planes({ packs }: { packs: PackEnLanding[] }) {
  return (
    <Seccion id="planes" titulo="Planes">
      <ul className="grid gap-3 sm:grid-cols-2">
        {packs.map((pack, indice) => (
          <li
            // El indice y no el nombre: dos packs pueden llamarse igual, y una
            // clave repetida hace que React se coma una de las dos filas.
            key={indice}
            className={
              `flex flex-col gap-1 rounded-xl border p-4 ` +
              (pack.destacado ? 'border-2 border-[var(--salon-primario)]' : 'border-slate-200')
            }
          >
            <h3 className="font-medium text-slate-900">{pack.nombre}</h3>
            {/* Un pack sin precio cargado no se esconde: se ofrece igual, pero
                sin inventar una cifra. */}
            <p className="text-slate-700">
              {pack.precio === null ? 'Consultanos' : `$${pack.precio}`}
            </p>
            {pack.destacado && (
              <p className="text-xs font-semibold uppercase text-[var(--salon-primario)]">
                Recomendado
              </p>
            )}
          </li>
        ))}
      </ul>
    </Seccion>
  );
}

function TurnosLibres({ turnos }: { turnos: TurnoLibrePublico[] }) {
  return (
    <Seccion id="turnos-libres" titulo="Turnos libres">
      <ul className="flex flex-col gap-2">
        {turnos.map((turno, indice) => (
          <li key={indice} className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
            {diaYMes(turno.fecha)} · {turno.horaInicio} · {turno.clase} · {turno.salaNombre}
          </li>
        ))}
      </ul>
    </Seccion>
  );
}

function Testimonios({ testimonios }: { testimonios: TestimonioPublico[] }) {
  return (
    <Seccion id="testimonios" titulo="Testimonios">
      <ul className="flex flex-col gap-3">
        {testimonios.map((testimonio, indice) => (
          <li
            // Dos alumnas pueden llamarse igual y escribir lo mismo: el indice
            // es lo unico que distingue de verdad una fila de otra.
            key={indice}
            className="rounded-xl border border-slate-200 p-4"
          >
            <blockquote className="text-slate-700">{testimonio.texto}</blockquote>
            {/* Un testimonio anonimo se publica igual; lo que no puede quedar
                es la firma vacia colgando debajo. La definicion de "en blanco"
                es la misma de siempre y vive en un solo sitio. */}
            {!estaEnBlanco(testimonio.nombre) && (
              <p className="mt-2 text-sm font-medium text-slate-500">{testimonio.nombre}</p>
            )}
          </li>
        ))}
      </ul>
    </Seccion>
  );
}

function Preguntas({ preguntas }: { preguntas: PreguntaPublica[] }) {
  return (
    <Seccion id="preguntas" titulo="Preguntas frecuentes">
      <ul className="flex flex-col gap-3">
        {preguntas.map((pregunta, indice) => (
          <li key={indice} className="border-b border-slate-200 pb-3">
            <h3 className="font-medium text-slate-900">{pregunta.pregunta}</h3>
            <p className="mt-1 text-slate-700">{pregunta.respuesta}</p>
          </li>
        ))}
      </ul>
    </Seccion>
  );
}

/**
 * El pie con las redes.
 *
 * Los tres destinos los ARMA `enlaces-del-salon.ts` a partir de lo que escribio
 * el admin; lo que se enseña es el texto suyo y lo que se enlaza es lo que esa
 * pieza aprobo. Un valor que no pase no deja un enlace roto: no deja nada.
 */
function Contacto({ salon }: { salon: SalonPublico }) {
  const whatsapp = salon.whatsapp === null ? null : enlaceDeWhatsapp(salon.whatsapp);
  const instagram = salon.instagram === null ? null : enlaceDeInstagram(salon.instagram);
  const extra = salon.linkExtra === null ? null : urlHttps(salon.linkExtra);

  if (whatsapp === null && instagram === null && extra === null) return null;

  // `nofollow` porque el destino lo escribe un usuario: sin eso, la landing de
  // cualquier gimnasio sirve para repartir reputacion a donde sea.
  const enlace = {
    className: 'font-medium text-[var(--salon-primario)] underline',
    target: '_blank',
    rel: 'noopener noreferrer nofollow',
  };

  return (
    <Seccion id="contacto" titulo="Contacto">
      <ul className="flex flex-wrap gap-4 text-sm">
        {whatsapp !== null && (
          <li>
            <a href={whatsapp} {...enlace}>
              WhatsApp
            </a>
          </li>
        )}
        {instagram !== null && (
          <li>
            <a href={instagram} {...enlace}>
              {usuarioDeInstagram(instagram)}
            </a>
          </li>
        )}
        {extra !== null && (
          <li>
            <a href={extra} {...enlace}>
              Más información
            </a>
          </li>
        )}
      </ul>
    </Seccion>
  );
}

/**
 * Una bandera apagada deja el campo FUERA del JSON. Y una lista vacia se ve
 * desde la calle igual que una ausente —un encabezado con nada debajo—, asi
 * que las dos cosas significan lo mismo: la seccion no se renderiza.
 */
function hay<T>(lista: T[] | undefined): lista is T[] {
  return Array.isArray(lista) && lista.length > 0;
}

export default async function PaginaDeSalon({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const salon = await traerSalon(slug);

  /**
   * ⚠️ LOS COLORES VAN POR VARIABLES CSS, NO PEGADOS EN UN STRING.
   *
   * React pone esto por CSSOM (`style.setProperty`), no construyendo texto, y
   * ademas los dos valores pasan por la lista blanca de `color-seguro.ts`. Si
   * algun dia hiciera falta una etiqueta `<style>` de verdad, esa validacion
   * dejaria de ser una red y pasaria a ser la unica defensa — razon de sobra
   * para no hacerlo.
   */
  const colores = {
    '--salon-primario': colorSeguro(salon.colorPrimario, COLOR_PRIMARIO_POR_DEFECTO),
    '--salon-secundario': colorSeguro(salon.colorSecundario, COLOR_SECUNDARIO_POR_DEFECTO),
  } as CSSProperties;

  const imagen = salon.imagenPrincipalUrl === null ? null : urlHttps(salon.imagenPrincipalUrl);

  return (
    <main style={colores} className="mx-auto w-full max-w-3xl bg-white">
      <header className="flex flex-col gap-3 px-6 pb-6 pt-10">
        {imagen !== null && (
          // Un `<img>` y no `next/image`: la URL es externa y arbitraria, y
          // `next/image` exige declarar cada host en `remotePatterns`. Un
          // gimnasio nuevo con su CDN propio no puede depender de un
          // despliegue nuestro para que se le vea la foto.
          <img
            src={imagen}
            alt={salon.nombre}
            className="aspect-video w-full rounded-xl object-cover"
          />
        )}
        <h1 className="text-3xl font-bold text-[var(--salon-primario)]">
          {salon.tituloPrincipal ?? salon.nombre}
        </h1>
        {salon.tagline !== null && <p className="text-lg text-slate-600">{salon.tagline}</p>}
      </header>

      {salon.sobreElSalon !== null && (
        <Seccion id="sobre-el-salon" titulo="Sobre el salón">
          {/* `whitespace-pre-line` respeta los saltos de linea que escribio el
              admin SIN interpretar nada: es la alternativa a convertirlos en
              <br> con innerHTML, que es por donde entra el XSS. */}
          <p className="whitespace-pre-line text-slate-700">{salon.sobreElSalon}</p>
        </Seccion>
      )}

      {hay(salon.packs) && <Planes packs={salon.packs} />}
      {hay(salon.turnosLibres) && <TurnosLibres turnos={salon.turnosLibres} />}
      {hay(salon.testimonios) && <Testimonios testimonios={salon.testimonios} />}
      {hay(salon.preguntas) && <Preguntas preguntas={salon.preguntas} />}

      <Contacto salon={salon} />
    </main>
  );
}
