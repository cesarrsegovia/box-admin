import { redirect } from 'next/navigation';
import { leerSesion, sesionValidaPara } from '@/lib/sesion';
import { PantallaDeCheckIn } from './pantalla-de-check-in';

/**
 * A donde lleva el QR de la pared: `/{slug}/checkin?f=<firma>`.
 *
 * ESTA PAGINA VIVE FUERA DEL GRUPO `(alumno)` A PROPOSITO. La URL es la misma
 * —los grupos entre parentesis no cuentan en la ruta—, pero el layout de
 * alumno redirige al login SIN conservar a donde iba el usuario, y en el App
 * Router un layout no recibe `searchParams`, asi que desde alli no hay forma
 * de salvar el `?f=`. El alumno acabaria en el calendario con la firma
 * perdida, parado frente a la pared, teniendo que escanear otra vez.
 *
 * Al estar fuera del grupo, la puerta la abre esta pagina —que si recibe
 * `searchParams`— y el destino viaja en `volverA`.
 */
export default async function PaginaDeCheckIn({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ f?: string | string[] }>;
}) {
  const { slug } = await params;
  const { f } = await searchParams;

  // `?f=a&f=b` llega como array. Dos firmas no son una firma: no se elige una.
  const firma = typeof f === 'string' && f !== '' ? f : null;

  const sesion = await leerSesion();

  if (!sesionValidaPara(sesion, slug)) {
    // La misma comprobacion que hace el layout de alumno, con la diferencia
    // que justifica toda esta pagina: el destino se conserva.
    const volverA =
      firma === null ? `/${slug}/checkin` : `/${slug}/checkin?f=${encodeURIComponent(firma)}`;

    redirect(`/${slug}/login?volverA=${encodeURIComponent(volverA)}`);
  }

  return <PantallaDeCheckIn slug={slug} firma={firma} />;
}
