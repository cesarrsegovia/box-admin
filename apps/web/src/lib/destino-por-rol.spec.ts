import { describe, expect, it } from 'vitest';
import { ROLES_USUARIO } from '@boxadmin/shared';
import { destinoPorRol } from './destino-por-rol';

describe('destinoPorRol', () => {
  it('un ADMIN_OPERATIVO va al panel', () => {
    expect(destinoPorRol('ADMIN_OPERATIVO', 'mi-gym')).toBe('/mi-gym/admin');
  });

  it('un ADMIN_SALON tambien, porque los roles son jerarquicos', () => {
    expect(destinoPorRol('ADMIN_SALON', 'mi-gym')).toBe('/mi-gym/admin');
  });

  it('un SUPERADMIN tambien', () => {
    expect(destinoPorRol('SUPERADMIN', 'mi-gym')).toBe('/mi-gym/admin');
  });

  it('un ALUMNO va al calendario', () => {
    expect(destinoPorRol('ALUMNO', 'mi-gym')).toBe('/mi-gym/calendario');
  });

  /**
   * EL CASO QUE LA FASE 13 EXISTE PARA ARREGLAR.
   *
   * Hasta ahora esta linea decia «va al calendario, porque no tiene pantalla
   * propia todavia» y pasaba en verde describiendo un callejon sin salida: el
   * layout de `(alumno)` exige `rol === 'ALUMNO'`, asi que el calendario
   * recibia a la profesora con «Esta no es tu area».
   *
   * SE AFIRMA EN LAS DOS DIRECCIONES. La igualdad sola se puede satisfacer
   * desde un sitio equivocado —una funcion que devolviera `mis-clases` para
   * TODO el mundo la pasaria—, y el `not.toBe` solo dice adonde NO va. Hacen
   * falta las dos, y aun asi este par es la mitad floja de la comprobacion: la
   * otra mitad —que a ese destino la dejen entrar— esta en el spec de la
   * puerta, que monta el layout en la ruta que sale de aqui.
   */
  it('un PROFESOR va a SU area y NO al calendario, que la echaria', () => {
    expect(destinoPorRol('PROFESOR', 'mi-gym')).toBe('/mi-gym/mis-clases');
    expect(destinoPorRol('PROFESOR', 'mi-gym')).not.toBe('/mi-gym/calendario');
  });

  it('un FANTASMA va al calendario y NO al panel', () => {
    expect(destinoPorRol('FANTASMA', 'mi-gym')).toBe('/mi-gym/calendario');
    expect(destinoPorRol('FANTASMA', 'mi-gym')).not.toBe('/mi-gym/admin');
  });

  /**
   * NINGUN ADMIN ATERRIZA EN LA AGENDA DE UNA PROFESORA.
   *
   * Los tres roles de arriba de la jerarquia alcanzan a `PROFESOR` en
   * `JERARQUIA_ROLES`, asi que un `rolAlcanza(rol, 'PROFESOR')` escrito en la
   * segunda comprobacion —la forma obvia, y la que parece simetrica con la
   * primera— los mandaria a todos a `mis-clases` en cuanto alguien reordenara
   * las dos lineas. Los tres tests de arriba NO lo verian si el reordenado
   * tambien cambiara el panel; este mira el otro lado.
   */
  it('ningun rol que no sea PROFESOR cae en el area de la profesora', () => {
    const intrusos = ROLES_USUARIO.filter((rol) => rol !== 'PROFESOR').filter(
      (rol) => destinoPorRol(rol, 'mi-gym') === '/mi-gym/mis-clases',
    );

    expect(intrusos).toEqual([]);
  });

  /**
   * EL SLUG SE RESPETA EN LOS TRES DESTINOS.
   *
   * Un destino con el gimnasio cableado manda a la persona al gimnasio de otro,
   * donde su sesion no vale y la puerta la devuelve al login en bucle. Se
   * barren TODOS los roles porque cada uno sale por una rama distinta y la
   * rama nueva es justamente la que nadie habia escrito nunca.
   */
  it('ningun destino se olvida del gimnasio', () => {
    for (const rol of ROLES_USUARIO) {
      expect(destinoPorRol(rol, 'otro-gym'), `con rol ${rol}`).toMatch(/^\/otro-gym\//);
    }
  });
});
