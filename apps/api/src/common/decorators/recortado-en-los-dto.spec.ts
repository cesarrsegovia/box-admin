import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { AutoRegistroDto } from '../../auth/dto/auto-registro.dto';
import { CreateTenantDto } from '../../auth/dto/create-tenant.dto';
import { RegisterDto } from '../../auth/dto/register.dto';
import { CrearAusenciaDto } from '../../ausencias/dto/crear-ausencia.dto';
import { AprobarComprobanteDto } from '../../comprobantes/dto/aprobar-comprobante.dto';
import { RevisarComprobanteDto } from '../../comprobantes/dto/revisar-comprobante.dto';
import { GuardarPlantillaDto } from '../../comunicacion/dto/guardar-plantilla.dto';
import { ActualizarInvitacionDto } from '../../invitaciones/dto/actualizar-invitacion.dto';
import { CrearInvitacionDto } from '../../invitaciones/dto/crear-invitacion.dto';
import { ActualizarPackDto } from '../../packs/dto/actualizar-pack.dto';
import { CrearPackDto } from '../../packs/dto/crear-pack.dto';
import { CrearPagoDto } from '../../pagos/dto/crear-pago.dto';
import { EstadoPagoDto } from '../../pagos/dto/estado-pago.dto';
import { ActualizarRutinaDto } from '../../rutinas/dto/actualizar-rutina.dto';
import { CrearRutinaDto } from '../../rutinas/dto/crear-rutina.dto';
import { ActualizarSalaDto } from '../../salas/dto/actualizar-sala.dto';
import { CrearSalaDto } from '../../salas/dto/crear-sala.dto';
import { ActualizarTurnoDto } from '../../turnos/dto/actualizar-turno.dto';
import { CrearTurnoDto } from '../../turnos/dto/crear-turno.dto';
import { ActualizarUsuarioDto } from '../../usuarios/dto/actualizar-usuario.dto';
import { CrearAlumnoDto } from '../../usuarios/dto/crear-alumno.dto';
import { CrearProfesorDto } from '../../usuarios/dto/crear-profesor.dto';
import { CrearVacacionDto } from '../../vacaciones/dto/crear-vacacion.dto';
import { CrearFaqDto } from '../../web-salon/dto/crear-faq.dto';
import { CrearTestimonioDto } from '../../web-salon/dto/crear-testimonio.dto';
import { GuardarWebSalonDto } from '../../web-salon/dto/guardar-web-salon.dto';

/**
 * LOS CAMPOS DE TEXTO LIBRE CONTRA EL PIPE DE VERDAD.
 *
 * Un `@Recortado()` olvidado en un DTO no rompe nada que se vea: el nombre
 * se guarda con sus espacios, se muestra con ellos y se ordena mal (los
 * `orderBy nombreCompleto` de `usuarios.service.ts` y `mis-clases.service.ts`
 * lo ponen primero). Por eso hay una fila por campo y no una muestra.
 *
 * Las opciones estan copiadas de `app.useGlobalPipes(...)` en
 * `apps/api/src/main.ts`.
 */
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

async function porElPipe(metatype: new () => object, cuerpo: Record<string, unknown>) {
  return (await pipe.transform(cuerpo, { type: 'body', metatype })) as Record<string, unknown>;
}

interface Campo {
  dto: new () => object;
  campo: string;
  /** Un cuerpo VALIDO sin el campo, para que el unico motivo de un 400 sea el campo. */
  base: Record<string, unknown>;
  /**
   * El campo rechaza el vacio (`@IsNotEmpty()` o un largo minimo): solo
   * espacios tiene que dar 400. Vale tambien para los `@IsOptional()` de las
   * ediciones: `@IsOptional()` solo deja pasar `null`/`undefined`, no un `''`.
   */
  obligatorio: boolean;
}

const FECHA = '2026-11-20';
const EMAIL = 'ana@example.com';

const CAMPOS: Campo[] = [
  // --- La tabla del plan: 23 campos ---
  { dto: CreateTenantDto, campo: 'nombre', base: { slug: 'gym-uno' }, obligatorio: true },
  { dto: CrearSalaDto, campo: 'nombre', base: {}, obligatorio: true },
  { dto: ActualizarSalaDto, campo: 'nombre', base: {}, obligatorio: true },
  { dto: CrearPackDto, campo: 'nombre', base: { tipo: 'MENSUAL' }, obligatorio: true },
  { dto: ActualizarPackDto, campo: 'nombre', base: {}, obligatorio: true },
  {
    dto: CrearTurnoDto,
    campo: 'nombre',
    base: { salaId: 'sala-1', fecha: FECHA, horaInicio: '08:00', horaFin: '09:00', cupo: 10 },
    obligatorio: true,
  },
  { dto: ActualizarTurnoDto, campo: 'nombre', base: {}, obligatorio: true },
  {
    dto: CrearRutinaDto,
    campo: 'nombre',
    base: {
      perfilId: 'perfil-1',
      salaId: 'sala-1',
      diaSemana: 1,
      horaInicio: '08:00',
      horaFin: '09:00',
      desde: FECHA,
    },
    obligatorio: true,
  },
  { dto: ActualizarRutinaDto, campo: 'nombre', base: {}, obligatorio: true },
  { dto: CrearInvitacionDto, campo: 'nombre', base: { salaIds: ['sala-1'] }, obligatorio: true },
  { dto: ActualizarInvitacionDto, campo: 'nombre', base: {}, obligatorio: true },
  { dto: CrearTestimonioDto, campo: 'nombre', base: { texto: 'Muy bueno' }, obligatorio: true },
  { dto: CrearTestimonioDto, campo: 'texto', base: { nombre: 'Ana' }, obligatorio: true },
  { dto: CrearFaqDto, campo: 'pregunta', base: { respuesta: 'Si' }, obligatorio: true },
  { dto: CrearFaqDto, campo: 'respuesta', base: { pregunta: 'Hay duchas?' }, obligatorio: true },
  { dto: GuardarWebSalonDto, campo: 'tagline', base: {}, obligatorio: false },
  {
    dto: GuardarPlantillaDto,
    campo: 'asunto',
    base: { cuerpoHtml: '<p>Hola</p>' },
    obligatorio: true,
  },
  {
    dto: CrearPagoDto,
    campo: 'nota',
    base: {
      perfilId: 'perfil-1',
      monto: '8500.00',
      metodo: 'EFECTIVO',
      cubreDesde: '2026-11-01',
      cubreHasta: '2026-11-30',
    },
    obligatorio: false,
  },
  { dto: EstadoPagoDto, campo: 'nota', base: { alDia: true }, obligatorio: false },
  {
    dto: AprobarComprobanteDto,
    campo: 'nota',
    base: { monto: '8500.00', cubreHasta: '2026-11-30' },
    obligatorio: false,
  },
  { dto: RevisarComprobanteDto, campo: 'nota', base: {}, obligatorio: false },
  {
    dto: CrearAusenciaDto,
    campo: 'motivo',
    base: { desde: FECHA, hasta: FECHA },
    obligatorio: false,
  },
  {
    dto: CrearVacacionDto,
    campo: 'motivo',
    base: { perfilId: 'perfil-1', desde: FECHA, hasta: FECHA },
    obligatorio: false,
  },

  // --- Los que encontro la busqueda del plan y no estaban en la tabla ---
  {
    dto: AutoRegistroDto,
    campo: 'nombreCompleto',
    base: {
      tenantSlug: 'gym-uno',
      codigo: '0123456789abcdef0123456789abcdef',
      email: EMAIL,
      password: 'clave-segura-1',
    },
    obligatorio: true,
  },
  {
    dto: RegisterDto,
    campo: 'nombreCompleto',
    base: { tenantSlug: 'gym-uno', email: EMAIL, password: 'clave-segura-1' },
    obligatorio: true,
  },
  {
    dto: CrearAlumnoDto,
    campo: 'nombreCompleto',
    base: { email: EMAIL, salaIds: [] },
    obligatorio: true,
  },
  {
    dto: CrearAlumnoDto,
    campo: 'telefono',
    base: { nombreCompleto: 'Ana', email: EMAIL, salaIds: [] },
    obligatorio: false,
  },
  {
    dto: CrearAlumnoDto,
    campo: 'fichaMedica',
    base: { nombreCompleto: 'Ana', email: EMAIL, salaIds: [] },
    obligatorio: false,
  },
  {
    dto: CrearProfesorDto,
    campo: 'nombreCompleto',
    base: { email: EMAIL, salaIds: [] },
    obligatorio: true,
  },
  {
    dto: CrearProfesorDto,
    campo: 'telefono',
    base: { nombreCompleto: 'Ana', email: EMAIL, salaIds: [] },
    obligatorio: false,
  },
  { dto: ActualizarUsuarioDto, campo: 'nombreCompleto', base: {}, obligatorio: true },
  { dto: ActualizarUsuarioDto, campo: 'telefono', base: {}, obligatorio: false },
  { dto: ActualizarUsuarioDto, campo: 'fichaMedica', base: {}, obligatorio: false },
  { dto: GuardarWebSalonDto, campo: 'tituloPrincipal', base: {}, obligatorio: false },
  { dto: GuardarWebSalonDto, campo: 'sobreElSalon', base: {}, obligatorio: false },
  { dto: GuardarWebSalonDto, campo: 'whatsapp', base: {}, obligatorio: false },
  { dto: GuardarWebSalonDto, campo: 'instagram', base: {}, obligatorio: false },
];

describe('@Recortado en los DTO', () => {
  /**
   * CANDADO DEL NUMERO DE FILAS: si alguien saca una fila de `CAMPOS`, esto
   * falla. NO detecta un campo nuevo sin `@Recortado()`: eso no lo ve ningun
   * test, lo cubre la regla del README («Como se suma un campo nuevo»).
   */
  it('candado: siguen las 37 filas (23 de la tabla y 14 de la busqueda)', () => {
    expect(CAMPOS).toHaveLength(37);
  });

  describe.each(CAMPOS.map((c) => [`${c.dto.name}.${c.campo}`, c] as const))('%s', (_nombre, c) => {
    it('llega sin los espacios de los bordes', async () => {
      const dto = await porElPipe(c.dto, { ...c.base, [c.campo]: '  Box 2  ' });

      expect(dto[c.campo]).toBe('Box 2');
    });

    if (c.obligatorio) {
      it('solo espacios da el 400 de un vacio', async () => {
        await expect(porElPipe(c.dto, { ...c.base, [c.campo]: '   ' })).rejects.toBeInstanceOf(
          BadRequestException,
        );
      });
    } else {
      it('solo espacios llega vacio, no con sus espacios', async () => {
        const dto = await porElPipe(c.dto, { ...c.base, [c.campo]: '   ' });

        expect(dto[c.campo]).toBe('');
      });
    }
  });
});
