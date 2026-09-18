import type { ConfigHeredable, ConfiguracionEfectiva } from './selfservice.contracts';

/**
 * El ultimo escalon de la cascada: lo que rige cuando ni la sala ni el gimnasio
 * dicen nada. Sin ventanas (se puede reservar y cancelar hasta el ultimo
 * segundo) y sin lista de espera.
 *
 * Los dos valores son los conservadores: una ventana inventada rechazaria
 * operaciones legitimas, y una lista de espera encendida por defecto crearia
 * reservas que nadie pidio.
 */
export const CONFIG_DEL_SISTEMA: ConfiguracionEfectiva = {
  minMinutosCancelar: 0,
  minMinutosAnotarse: 0,
  listaEsperaHabilitada: false,
};

/**
 * Resuelve la cascada `Sala ?? Tenant ?? sistema`, campo por campo.
 *
 * OJO: `??` y no `||`. Son distintos y aqui la diferencia es un bug de negocio:
 * `0` y `false` son valores configurados a proposito ("en esta sala no hay
 * ventana", "en esta sala no hay lista de espera"), no ausencias. Con `||` se
 * caerian al nivel siguiente y la configuracion explicita de la sala se
 * ignoraria en silencio.
 *
 * Verificado por mutacion: cambiar estos `??` por `||` hace fallar los dos
 * tests de "un cero/false explicito NO se cae al tenant".
 */
export function resolverConfiguracion(
  sala: ConfigHeredable,
  tenant: ConfigHeredable,
): ConfiguracionEfectiva {
  return {
    minMinutosCancelar:
      sala.minMinutosCancelar ?? tenant.minMinutosCancelar ?? CONFIG_DEL_SISTEMA.minMinutosCancelar,
    minMinutosAnotarse:
      sala.minMinutosAnotarse ?? tenant.minMinutosAnotarse ?? CONFIG_DEL_SISTEMA.minMinutosAnotarse,
    listaEsperaHabilitada:
      sala.listaEsperaHabilitada ??
      tenant.listaEsperaHabilitada ??
      CONFIG_DEL_SISTEMA.listaEsperaHabilitada,
  };
}
