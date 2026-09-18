import { CONFIG_DEL_SISTEMA, resolverConfiguracion } from './configuracion';
import type { ConfigHeredable } from './selfservice.contracts';

const TODO_NULL: ConfigHeredable = {
  minMinutosCancelar: null,
  minMinutosAnotarse: null,
  listaEsperaHabilitada: null,
};

describe('resolverConfiguracion', () => {
  it('la sala manda sobre el tenant', () => {
    const sala: ConfigHeredable = {
      minMinutosCancelar: 120,
      minMinutosAnotarse: 30,
      listaEsperaHabilitada: true,
    };
    const tenant: ConfigHeredable = {
      minMinutosCancelar: 999,
      minMinutosAnotarse: 999,
      listaEsperaHabilitada: false,
    };

    expect(resolverConfiguracion(sala, tenant)).toEqual({
      minMinutosCancelar: 120,
      minMinutosAnotarse: 30,
      listaEsperaHabilitada: true,
    });
  });

  it('con la sala en null hereda del tenant, campo por campo', () => {
    const sala: ConfigHeredable = {
      minMinutosCancelar: null,
      minMinutosAnotarse: 15,
      listaEsperaHabilitada: null,
    };
    const tenant: ConfigHeredable = {
      minMinutosCancelar: 240,
      minMinutosAnotarse: 999,
      listaEsperaHabilitada: true,
    };

    expect(resolverConfiguracion(sala, tenant)).toEqual({
      // De tenant: la sala no opina.
      minMinutosCancelar: 240,
      // De sala: la sala opina, aunque el tenant tambien.
      minMinutosAnotarse: 15,
      listaEsperaHabilitada: true,
    });
  });

  it('con sala y tenant en null cae al valor del sistema', () => {
    expect(resolverConfiguracion(TODO_NULL, TODO_NULL)).toEqual(CONFIG_DEL_SISTEMA);
  });

  it('el valor del sistema es sin ventana y sin lista de espera', () => {
    expect(CONFIG_DEL_SISTEMA).toEqual({
      minMinutosCancelar: 0,
      minMinutosAnotarse: 0,
      listaEsperaHabilitada: false,
    });
  });

  // Este test existe por una razon concreta: con `||` en vez de `??`, un cero
  // configurado a proposito en la sala ("sin ventana en esta sala, aunque el
  // tenant tenga dos horas") se caeria al valor del tenant. Es el bug clasico
  // de esta forma de codigo y no lo veria nadie hasta que un alumno se quejara.
  it('un cero explicito en la sala NO se cae al tenant', () => {
    const sala: ConfigHeredable = {
      minMinutosCancelar: 0,
      minMinutosAnotarse: 0,
      listaEsperaHabilitada: null,
    };
    const tenant: ConfigHeredable = {
      minMinutosCancelar: 240,
      minMinutosAnotarse: 180,
      listaEsperaHabilitada: null,
    };

    expect(resolverConfiguracion(sala, tenant)).toEqual({
      minMinutosCancelar: 0,
      minMinutosAnotarse: 0,
      listaEsperaHabilitada: false,
    });
  });

  // Mismo razonamiento con el booleano: `false` es un valor, no una ausencia.
  it('un false explicito en la sala NO se cae al tenant', () => {
    const sala: ConfigHeredable = { ...TODO_NULL, listaEsperaHabilitada: false };
    const tenant: ConfigHeredable = { ...TODO_NULL, listaEsperaHabilitada: true };

    expect(resolverConfiguracion(sala, tenant).listaEsperaHabilitada).toBe(false);
  });
});
