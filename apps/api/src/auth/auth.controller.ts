import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { LIMITE_AUTH, TTL_AUTH } from '../common/throttling';
import type {
  JwtPayload,
  LoginRespuesta,
  MeRespuesta,
  TenantPublico,
  TokensRespuesta,
  UsuarioPublico,
} from '@boxadmin/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { BootstrapKeyGuard } from '../common/guards/bootstrap-key.guard';
import { AuthService } from './auth.service';
import { AutoRegistroDto } from './dto/auto-registro.dto';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @UseGuards(BootstrapKeyGuard)
  @Post('tenants')
  crearTenant(@Body() dto: CreateTenantDto): Promise<TenantPublico> {
    return this.auth.crearTenant(dto);
  }

  @Public()
  @UseGuards(BootstrapKeyGuard)
  @Post('register')
  register(@Body() dto: RegisterDto): Promise<UsuarioPublico> {
    return this.auth.register(dto);
  }

  // Publico y SIN BootstrapKeyGuard, a diferencia de /auth/register: quien se
  // registra aqui es un alumno con una clave que le dio su gimnasio, no alguien
  // montando un tenant. El freno contra fuerza bruta lo pone el throttler.
  @Public()
  @Throttle({ default: { ttl: TTL_AUTH, limit: LIMITE_AUTH } })
  @Post('auto-registro')
  autoRegistro(@Body() dto: AutoRegistroDto): Promise<LoginRespuesta> {
    return this.auth.autoRegistro(dto);
  }

  @Public()
  @Throttle({ default: { ttl: TTL_AUTH, limit: LIMITE_AUTH } })
  @HttpCode(200)
  @Post('login')
  login(@Body() dto: LoginDto): Promise<LoginRespuesta> {
    return this.auth.login(dto);
  }

  @Public()
  @Throttle({ default: { ttl: TTL_AUTH, limit: LIMITE_AUTH } })
  @HttpCode(200)
  @Post('refresh')
  refresh(@Body() dto: RefreshDto): Promise<TokensRespuesta> {
    return this.auth.refresh(dto.refreshToken);
  }

  @HttpCode(204)
  @Post('logout')
  async logout(@CurrentUser() user: JwtPayload, @Body() dto: RefreshDto): Promise<void> {
    await this.auth.logout(user.sub, dto.refreshToken);
  }

  @Get('me')
  me(@CurrentUser() user: JwtPayload): Promise<MeRespuesta> {
    return this.auth.usuarioActual(user);
  }

  /** Endpoint de prueba del checklist: verifica que RolesGuard bloquea a un ALUMNO. */
  @Roles('ADMIN_SALON')
  @Get('admin-only')
  soloAdmin(@CurrentUser() user: JwtPayload): { ok: true; rol: JwtPayload['rol'] } {
    return { ok: true, rol: user.rol };
  }
}
