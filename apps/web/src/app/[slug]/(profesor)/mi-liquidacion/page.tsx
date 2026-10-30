import type { Metadata } from 'next';
import { PantallaDeMiLiquidacion } from './pantalla';

// Titulo propio: el del layout dice «Mis clases», y si no cambia al navegar el
// anunciador de rutas del App Router no avisa de que la pantalla es otra.
// `page.tsx` exporta SOLO `default` y `metadata`: Next 15 no admite nada mas.
export const metadata: Metadata = { title: 'Mi liquidación · BoxAdmin' };

export default function PaginaDeMiLiquidacion() {
  return <PantallaDeMiLiquidacion />;
}
