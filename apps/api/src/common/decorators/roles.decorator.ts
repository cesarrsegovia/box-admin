import { SetMetadata } from '@nestjs/common';
import type { RolAsignable } from '@boxadmin/shared';

export const ROLES_KEY = 'roles';

/** Exige que el rol del usuario alcance al menos uno de los indicados. */
export const Roles = (...roles: RolAsignable[]) => SetMetadata(ROLES_KEY, roles);
