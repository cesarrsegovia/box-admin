import type { RolUsuario } from './roles';

/** Payload firmado en el access token. */
export interface JwtPayload {
  sub: string;
  tenantId: string;
  rol: RolUsuario;
  iat?: number;
  exp?: number;
}

/** Usuario tal como lo ve el cliente. Nunca incluye passwordHash. */
export interface UsuarioPublico {
  id: string;
  tenantId: string;
  nombreCompleto: string;
  email: string;
  rol: RolUsuario;
  activo: boolean;
}

export interface TenantPublico {
  id: string;
  nombre: string;
  slug: string;
  activo: boolean;
}

export interface TokensRespuesta {
  accessToken: string;
  refreshToken: string;
}

export interface LoginRespuesta extends TokensRespuesta {
  usuario: UsuarioPublico;
}

/** Respuesta de GET /auth/me: el usuario y el gimnasio al que pertenece. */
export interface MeRespuesta extends UsuarioPublico {
  tenant: TenantPublico;
}
