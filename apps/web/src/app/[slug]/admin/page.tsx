import Link from 'next/link';
import { ComprobantesPendientes } from './comprobantes-pendientes';
import { PagosPendientes } from './pagos-pendientes';

/**
 * LA PORTADA DEL PANEL, QUE AHORA TIENE DOS TRABAJOS.
 *
 * Era un parrafo y un enlace. Lleva la lista de a quien hay que llamar hoy
 * porque es donde aterriza todo el mundo al entrar —sin un clic de por medio y
 * sin tener que decidir ir— y porque es la unica pantalla del panel que habla
 * de HOY: Analisis elige un mes, la asistencia elige un rango, la ficha elige
 * una persona. El razonamiento entero, con lo que se descarto y por que, esta
 * en el docblock de `pagos-pendientes.tsx`.
 *
 * Y AL LADO, LA COLA DE COMPROBANTES, por el MISMO motivo medido en la Fase
 * 11: una cola enterrada en una pantalla propia se visita menos. Son las dos
 * listas de trabajo del dia y se leen juntas —a quien hay que llamar porque no
 * pago, y quien ya pago y esta esperando que se lo reconozcan—; separarlas en
 * dos sitios es garantizar que se mire una. El razonamiento entero, y por que
 * aprobar un comprobante es registrar un cobro, esta en el docblock de
 * `comprobantes-pendientes.tsx`.
 *
 * EL ORDEN NO ES CASUAL: primero lo que el gimnasio tiene que reclamar y
 * despues lo que el gimnasio le debe a alguien. La cola de comprobantes la
 * mira el admin despues de saber a quien llamar, y ademas aprobar uno cambia
 * la otra lista —acuña un pago— pero no al reves.
 *
 * Este archivo sigue siendo un componente de SERVIDOR y no exporta nada mas
 * que el `default`: Next 15 lo prohibe, y el error habla de `OmitWithTag` sin
 * parecerse a la causa. Los dos bloques son componentes de cliente aparte, con
 * sus consultas dentro.
 */
export default async function InicioDelPanel({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-slate-900">Panel</h1>
      <p className="text-slate-600">
        Desde aca se administran las personas del gimnasio y las claves de invitacion.
      </p>

      <PagosPendientes />

      <ComprobantesPendientes />

      <Link href={`/${slug}/admin/usuarios`} className="w-fit font-medium text-slate-900 underline">
        Ver las personas
      </Link>
    </section>
  );
}
