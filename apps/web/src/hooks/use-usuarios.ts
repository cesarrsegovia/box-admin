'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AltaUsuarioRespuesta,
  ResetPasswordRespuesta,
  TipoUsuarioNegocio,
  UsuarioDetalle,
  UsuarioResumen,
} from '@boxadmin/shared';
import { type ErrorDeApi, pedir } from '@/lib/cliente';

export interface FiltrosDeUsuarios {
  tipo?: TipoUsuarioNegocio;
  salaId?: string;
  activo?: boolean;
  autoRegistrado?: boolean;
}

/** Las claves, en un solo sitio, como en `use-calendario`. */
export const clavesDeUsuarios = {
  lista: (filtros: FiltrosDeUsuarios) => ['usuarios', filtros] as const,
  uno: (id: string) => ['usuario', id] as const,
};

/**
 * Los filtros viajan como query y SOLO los que tienen valor.
 *
 * Mandar `activo=` vacio no es lo mismo que no mandarlo: el `ParseBoolPipe` de
 * la API lo rechazaria con un 400.
 */
export function queryDeFiltros(filtros: FiltrosDeUsuarios): string {
  const partes = new URLSearchParams();

  if (filtros.tipo !== undefined) partes.set('tipo', filtros.tipo);
  if (filtros.salaId !== undefined && filtros.salaId !== '') partes.set('salaId', filtros.salaId);
  if (filtros.activo !== undefined) partes.set('activo', String(filtros.activo));
  if (filtros.autoRegistrado !== undefined)
    partes.set('autoRegistrado', String(filtros.autoRegistrado));

  const texto = partes.toString();
  return texto === '' ? '' : `?${texto}`;
}

export function useUsuarios(filtros: FiltrosDeUsuarios) {
  return useQuery({
    queryKey: clavesDeUsuarios.lista(filtros),
    queryFn: () => pedir<UsuarioResumen[]>(`/usuarios${queryDeFiltros(filtros)}`),
  });
}

export function useUsuario(id: string) {
  return useQuery({
    queryKey: clavesDeUsuarios.uno(id),
    queryFn: () => pedir<UsuarioDetalle>(`/usuarios/${id}`),
  });
}

/** Tras cualquier escritura hay que invalidar la ficha Y la lista. */
function useInvalidar() {
  const cliente = useQueryClient();

  return (id: string) => {
    void cliente.invalidateQueries({ queryKey: clavesDeUsuarios.uno(id) });
    void cliente.invalidateQueries({ queryKey: ['usuarios'] });
  };
}

export function useActualizarUsuario(id: string) {
  const invalidar = useInvalidar();

  return useMutation<UsuarioDetalle, ErrorDeApi, Record<string, unknown>>({
    mutationFn: (datos) =>
      pedir<UsuarioDetalle>(`/usuarios/${id}`, { metodo: 'PATCH', cuerpo: datos }),
    onSuccess: () => invalidar(id),
    gcTime: 0,
  });
}

export function useActualizarSalas(id: string) {
  const invalidar = useInvalidar();

  return useMutation<UsuarioDetalle, ErrorDeApi, string[]>({
    mutationFn: (salaIds) =>
      pedir<UsuarioDetalle>(`/usuarios/${id}/salas`, { metodo: 'PATCH', cuerpo: { salaIds } }),
    onSuccess: () => invalidar(id),
    gcTime: 0,
  });
}

export interface EstadoDePago {
  alDia: boolean;
  cubreHasta?: string;
  nota?: string;
}

export function useFijarEstadoDePago(id: string) {
  const invalidar = useInvalidar();

  return useMutation<UsuarioDetalle, ErrorDeApi, EstadoDePago>({
    mutationFn: (datos) =>
      pedir<UsuarioDetalle>(`/usuarios/${id}/estado-pago`, { metodo: 'PATCH', cuerpo: datos }),
    onSuccess: () => invalidar(id),
    gcTime: 0,
  });
}

export function useDarDeBaja(id: string) {
  const invalidar = useInvalidar();

  return useMutation<UsuarioDetalle, ErrorDeApi, void>({
    mutationFn: () => pedir<UsuarioDetalle>(`/usuarios/${id}`, { metodo: 'DELETE' }),
    onSuccess: () => invalidar(id),
    gcTime: 0,
  });
}

/**
 * Devuelve la contraseña nueva. Se ve UNA vez. Y SOLO UNA.
 *
 * `gcTime: 0`, como todas las mutaciones de este archivo. Por defecto TanStack
 * conserva cada mutacion cinco minutos despues de que su componente se
 * desmonte, con lo que se MANDO (`variables`) y lo que VOLVIO (`data`) dentro.
 * El `QueryClient` es uno solo para toda la aplicacion y dura lo que dura la
 * pestaña: sin esto, la contrasena temporal de la ultima persona reseteada —y
 * el texto de la ultima ficha medica editada— siguen en memoria despues de
 * cerrar la ficha, legibles desde la consola de la maquina del mostrador.
 *
 * No lo veia ningun test: los de la cache miraban la de CONSULTAS, que es otro
 * almacen.
 *
 * El tipo es el del contrato (`ResetPasswordRespuesta`), no uno recortado a
 * mano: un subconjunto estructural compila hoy y miente mañana, porque el dia
 * que el contrato gane un campo este hook no se entera y nadie compara las dos
 * listas estando una escondida aqui.
 */
export function useResetearPassword(id: string) {
  return useMutation<ResetPasswordRespuesta, ErrorDeApi, void>({
    mutationFn: () =>
      pedir<ResetPasswordRespuesta>(`/usuarios/${id}/reset-password`, { metodo: 'POST' }),
    gcTime: 0,
  });
}

/**
 * El alta devuelve `passwordTemporal` DENTRO de la respuesta, y se ve una vez.
 *
 * `gcTime: 0` por el mismo motivo que `useResetearPassword`, y aqui ademas es
 * la unica defensa posible: `mutacion.reset()` NO vacia nada —solo desengancha
 * al observador y programa el recolector con el `gcTime` que haya—, asi que sin
 * esto la respuesta entera se queda cinco minutos en la cache de mutaciones del
 * `QueryClient` de toda la aplicacion.
 *
 * Va en el HOOK y no en la pantalla a proposito: limpiar desde quien llama
 * protege a un solo llamador, y esto lo van a usar las otras areas del panel
 * cuando lleguen. Una limpieza que vive lejos del sitio que ensucia es una que
 * el proximo llamador no copia.
 */
export function useCrearPersona(tipo: TipoUsuarioNegocio) {
  const cliente = useQueryClient();

  return useMutation<AltaUsuarioRespuesta, ErrorDeApi, Record<string, unknown>>({
    mutationFn: (datos) =>
      pedir<AltaUsuarioRespuesta>(`/usuarios/${tipo === 'alumno' ? 'alumnos' : 'profesores'}`, {
        metodo: 'POST',
        cuerpo: datos,
      }),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['usuarios'] }),
    gcTime: 0,
  });
}
