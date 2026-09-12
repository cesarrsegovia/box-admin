import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ROLES_USUARIO,
  rolAlcanza,
  type RolAsignable,
  type RolUsuario,
} from '@boxadmin/shared';
import { RolesGuard } from './roles.guard';

function contextoCon(user: { rol: RolUsuario } | undefined): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function guardQueExige(roles: RolAsignable[] | undefined): RolesGuard {
  const reflector = { getAllAndOverride: () => roles } as unknown as Reflector;
  return new RolesGuard(reflector);
}

describe('RolesGuard', () => {
  it('deja pasar cuando la ruta no declara roles', () => {
    expect(guardQueExige(undefined).canActivate(contextoCon({ rol: 'ALUMNO' }))).toBe(true);
  });

  it('deja pasar cuando el rol coincide exactamente', () => {
    expect(
      guardQueExige(['ADMIN_SALON']).canActivate(contextoCon({ rol: 'ADMIN_SALON' })),
    ).toBe(true);
  });

  it('deja pasar cuando el rol es superior en la jerarquia', () => {
    expect(
      guardQueExige(['ADMIN_OPERATIVO']).canActivate(contextoCon({ rol: 'ADMIN_SALON' })),
    ).toBe(true);
  });

  it('bloquea a un ALUMNO en una ruta de ADMIN_SALON', () => {
    expect(() =>
      guardQueExige(['ADMIN_SALON']).canActivate(contextoCon({ rol: 'ALUMNO' })),
    ).toThrow(ForbiddenException);
  });

  it('bloquea siempre a FANTASMA, que es un rol tecnico sin login', () => {
    expect(() =>
      guardQueExige(['ALUMNO']).canActivate(contextoCon({ rol: 'FANTASMA' })),
    ).toThrow(ForbiddenException);
  });

  it('bloquea si no hay usuario en la request', () => {
    expect(() => guardQueExige(['ALUMNO']).canActivate(contextoCon(undefined))).toThrow(
      ForbiddenException,
    );
  });

  // Con un solo rol requerido, some() y every() son indistinguibles: estos dos
  // casos exigen DOS roles para que una mutación some -> every quede al
  // descubierto (con every, ADMIN_OPERATIVO no alcanzaria SUPERADMIN y la ruta
  // quedaria bloqueada por error).
  it('deja pasar con dos roles requeridos cuando el usuario alcanza uno de ellos', () => {
    expect(
      guardQueExige(['SUPERADMIN', 'ADMIN_OPERATIVO']).canActivate(
        contextoCon({ rol: 'ADMIN_OPERATIVO' }),
      ),
    ).toBe(true);
  });

  it('bloquea con dos roles requeridos cuando el usuario no alcanza ninguno', () => {
    expect(() =>
      guardQueExige(['SUPERADMIN', 'ADMIN_OPERATIVO']).canActivate(
        contextoCon({ rol: 'ALUMNO' }),
      ),
    ).toThrow(ForbiddenException);
  });
});

// El guard delega toda la decisión en rolAlcanza, así que la matriz completa se
// prueba aquí, sobre la función pura: es donde vive la lógica de autorización.
describe('rolAlcanza (matriz completa)', () => {
  const REALES: RolAsignable[] = [
    'SUPERADMIN',
    'ADMIN_SALON',
    'ADMIN_OPERATIVO',
    'PROFESOR',
    'ALUMNO',
  ];

  it('un rol alcanza su propio nivel y todos los inferiores, ninguno superior', () => {
    REALES.forEach((rol, i) => {
      REALES.forEach((minimo, j) => {
        // El array va de mayor a menor rango: i <= j significa "rol manda igual o mas".
        expect(rolAlcanza(rol, minimo)).toBe(i <= j);
      });
    });
  });

  it('FANTASMA como usuario no alcanza ningun nivel', () => {
    REALES.forEach((minimo) => {
      expect(rolAlcanza('FANTASMA', minimo)).toBe(false);
    });
  });

  it('FANTASMA como umbral no deja pasar a nadie', () => {
    // Si esto fallara, una ruta @Roles('FANTASMA') quedaria abierta a cualquiera:
    // su rango es 0 y todos los demas son >= 0. Los tipos ya lo impiden, pero un
    // consumidor en JavaScript plano se los saltaria.
    ROLES_USUARIO.forEach((rol) => {
      expect(rolAlcanza(rol, 'FANTASMA' as RolAsignable)).toBe(false);
    });
  });
});
