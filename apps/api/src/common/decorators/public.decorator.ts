import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Excluye la ruta del JwtAuthGuard global. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
