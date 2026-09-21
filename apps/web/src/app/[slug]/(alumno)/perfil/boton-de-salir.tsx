'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Boton } from '@/componentes/ui';

export function BotonDeSalir({ slug }: { slug: string }) {
  const router = useRouter();
  const [saliendo, setSaliendo] = useState(false);

  async function salir() {
    setSaliendo(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // La API puede estar caida y el alumno sigue teniendo derecho a salir.
      // Un logout que lo deja "dentro" porque fallo la red es peor que uno que
      // no revoca: el navegador queda limpio igual.
    }
    router.push(`/${slug}/login`);
  }

  return (
    <Boton tono="peligro" cargando={saliendo} onClick={() => void salir()}>
      Cerrar sesion
    </Boton>
  );
}
