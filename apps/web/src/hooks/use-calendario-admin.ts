'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import type { MesCalendarioPublico, PlanDeMes, PublicacionEncolada } from '@boxadmin/shared';
import { type ErrorDeApi, pedir } from '@/lib/cliente';

export interface MesElegido {
  salaId: string;
  anio: number;
  mes: number;
}

/** `/calendario/:salaId/:anio/:mes` */
function base({ salaId, anio, mes }: MesElegido): string {
  return `/calendario/${salaId}/${anio}/${mes}`;
}

/**
 * Las claves de cache, en un solo sitio.
 *
 * Mismo motivo que en `use-calendario` y en `use-usuarios`: una clave escrita a
 * mano en dos archivos se desincroniza y aparece como "publique y la pantalla
 * sigue mostrando lo viejo".
 */
export const clavesDelCalendario = {
  plan: (m: MesElegido) => ['plan-del-mes', m.salaId, m.anio, m.mes] as const,
  mes: (m: MesElegido) => ['mes-calendario', m.salaId, m.anio, m.mes] as const,
};

/**
 * La previsualizacion.
 *
 * Es un POST que no escribe: el servicio lo dice —«es sincrono a proposito: no
 * hay razon para mandar a una cola una operacion de solo lectura que el admin
 * esta esperando en pantalla»— y por eso se consume con `useQuery` y no con
 * `useMutation`. Es funcion pura de (sala, anio, mes), que es lo que permite
 * que esta pantalla no tenga estado propio.
 *
 * Los conflictos NO se piden aparte. `GET .../conflictos` devuelve exactamente
 * `plan.conflictos`, que ya viene dentro de esta respuesta: una segunda
 * peticion para un dato que ya esta, y dos respuestas que pueden discrepar.
 */
export function usePlanDelMes(elegido: MesElegido | null) {
  return useQuery({
    queryKey: elegido === null ? ['plan-del-mes', 'nada'] : clavesDelCalendario.plan(elegido),
    queryFn: () =>
      pedir<PlanDeMes>(`${base(elegido as MesElegido)}/previsualizar`, { metodo: 'POST' }),
    enabled: elegido !== null,
    // Sin `refetchInterval`: la previsualizacion no cambia sola. Sondearla
    // seria mandar un POST cada tres segundos a una ruta que recalcula el mes
    // entero para devolver lo mismo.
  });
}

/**
 * Cuanto se espera entre consultas mientras el trabajo corre.
 *
 * Segundos y no decimas: esto no es una barra de progreso, es saber si el
 * trabajo termino.
 */
export const ESPERA_DEL_SONDEO = 3000;

/** Los dos estados en los que el trabajo ya no se mueve. */
export const ESTADOS_FINALES = ['terminado', 'fallido'] as const;

export function useMesDelCalendario(elegido: MesElegido | null) {
  return useQuery({
    queryKey: elegido === null ? ['mes-calendario', 'nada'] : clavesDelCalendario.mes(elegido),
    queryFn: () => pedir<MesCalendarioPublico>(base(elegido as MesElegido)),
    enabled: elegido !== null,
    /**
     * SE DEJA DE CONSULTAR cuando el trabajo termino o fallo. Un sondeo que no
     * para es una peticion cada tres segundos para siempre en la maquina del
     * mostrador.
     *
     * `publicacion` puede venir `null` Y existe el estado `sin_job`: son dos
     * formas de decir "no hay trabajo", y las dos tienen que parar el sondeo.
     */
    refetchInterval: (consulta) => {
      const estado = consulta.state.data?.publicacion?.estado;
      if (estado === undefined) return false;
      if (estado === 'sin_job') return false;
      return (ESTADOS_FINALES as readonly string[]).includes(estado) ? false : ESPERA_DEL_SONDEO;
    },
  });
}

export function usePublicarMes(elegido: MesElegido) {
  return useMutation<PublicacionEncolada, ErrorDeApi, void>({
    mutationFn: () => pedir<PublicacionEncolada>(`${base(elegido)}/publicar`, { metodo: 'POST' }),
    // Como en todas las mutaciones del panel: la respuesta no se queda cinco
    // minutos en el QueryClient de toda la aplicacion. `reset()` de TanStack no
    // limpia nada, solo desengancha al observador y programa el recolector con
    // el `gcTime` que haya.
    gcTime: 0,
  });
}
