/**
 * Los meses que la pantalla puede ofrecer.
 *
 * El pasado queda fuera porque la API lo rechaza con 400: regenerar un mes que
 * ya paso crearia reservas para clases que ya ocurrieron. Ofrecerlo seria un
 * 400 garantizado, y un selector que ofrece lo que el servidor no acepta es una
 * forma de mentir.
 *
 * El reloj entra por parametro para poder probarlo sin congelar el global.
 */
export interface MesOfrecido {
  anio: number;
  mes: number;
}

/** Un ano por delante: mas que eso es planificar sobre rutinas que van a cambiar. */
const CUANTOS = 12;

export function mesesOfrecidos(ahora: Date): MesOfrecido[] {
  const salida: MesOfrecido[] = [];
  const base = ahora.getUTCFullYear() * 12 + ahora.getUTCMonth();

  for (let i = 0; i < CUANTOS; i++) {
    const corrido = base + i;
    salida.push({ anio: Math.floor(corrido / 12), mes: (corrido % 12) + 1 });
  }

  return salida;
}
