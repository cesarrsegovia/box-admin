import { NotFoundException } from '@nestjs/common';
import type { JwtPayload } from '@boxadmin/shared';
import { idDelPerfilDelActor } from './perfil-del-actor';

const ACTOR = { sub: 'usuario-7' } as JwtPayload;
/**
 * Un texto que no usa ningun servicio: una funcion que ignorara `siNoTiene` y
 * devolviera el mensaje de alguno de ellos no puede pasar.
 */
const SIN_PERFIL = 'texto-del-404-de-prueba';

function unCliente(perfil: { id: string } | null) {
  return { perfil: { findFirst: jest.fn().mockResolvedValue(perfil) } };
}

describe('idDelPerfilDelActor', () => {
  it('devuelve el id del perfil de quien llama', async () => {
    const cliente = unCliente({ id: 'perfil-3' });

    await expect(idDelPerfilDelActor(cliente as never, ACTOR, SIN_PERFIL)).resolves.toBe(
      'perfil-3',
    );
  });

  /**
   * EL PERFIL SALE DEL TOKEN, NUNCA DE LA PETICION. Se mira la consulta
   * entera: un `where` con otra clave, o sin `select`, traeria otro perfil o
   * el perfil entero.
   */
  it('lo busca por el usuario del token, y trae solo el id', async () => {
    const cliente = unCliente({ id: 'perfil-3' });

    await idDelPerfilDelActor(cliente as never, ACTOR, SIN_PERFIL);

    expect(cliente.perfil.findFirst).toHaveBeenCalledWith({
      where: { usuarioId: 'usuario-7' },
      select: { id: true },
    });
  });

  it('sin perfil, un 404 con el texto que le pasaron, letra por letra', async () => {
    const intento = idDelPerfilDelActor(unCliente(null) as never, ACTOR, SIN_PERFIL);

    await expect(intento).rejects.toBeInstanceOf(NotFoundException);
    await expect(intento).rejects.toThrow(new NotFoundException(SIN_PERFIL));
  });
});
