import Link from 'next/link';
import { PagosPendientes } from './pagos-pendientes';

/**
 * LA PORTADA DEL PANEL, QUE AHORA TIENE UN TRABAJO.
 *
 * Era un parrafo y un enlace. Lleva la lista de a quien hay que llamar hoy
 * porque es donde aterriza todo el mundo al entrar —sin un clic de por medio y
 * sin tener que decidir ir— y porque es la unica pantalla del panel que habla
 * de HOY: Analisis elige un mes, la asistencia elige un rango, la ficha elige
 * una persona. El razonamiento entero, con lo que se descarto y por que, esta
 * en el docblock de `pagos-pendientes.tsx`.
 *
 * Este archivo sigue siendo un componente de SERVIDOR y no exporta nada mas
 * que el `default`: Next 15 lo prohibe, y el error habla de `OmitWithTag` sin
 * parecerse a la causa. El bloque es un componente de cliente aparte, con sus
 * dos consultas dentro.
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

      <Link href={`/${slug}/admin/usuarios`} className="w-fit font-medium text-slate-900 underline">
        Ver las personas
      </Link>
    </section>
  );
}
