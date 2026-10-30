import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { JwtPayload } from '@boxadmin/shared';
import type { EntradaLiquidacion } from './calcular-liquidacion';
import type { LiquidacionDatos } from './liquidacion.datos';
import { LiquidacionService } from './liquidacion.service';

// Los ids del usuario y del perfil son DISTINTOS a proposito: con el mismo
// valor, mandar `actor.sub` como `profesorId` pasaria en verde.
const actor = { sub: 'usuario-fati', tenantId: 'tenant-1', rol: 'PROFESOR' } as JwtPayload;

function entrada(): EntradaLiquidacion {
  return {
    profesorId: 'perfil-de-fati',
    profesorNombre: 'Fati Gomez',
    anio: 2099,
    mes: 9,
    horarios: [],
    turnos: [],
    ausencias: [],
    tarifaDelTenant: '1200.00',
  };
}

function montar() {
  const datos = {
    perfilDeLaProfesora: jest.fn().mockResolvedValue('perfil-de-fati'),
    cargar: jest.fn().mockResolvedValue(entrada()),
  };
  const servicio = new LiquidacionService(datos as unknown as LiquidacionDatos);
  return { datos, servicio };
}

describe('LiquidacionService.deLaProfesora', () => {
  it('pide la liquidacion del perfil DEL ACTOR', async () => {
    const { datos, servicio } = montar();

    await servicio.deLaProfesora(actor, 2099, 9);

    expect(datos.perfilDeLaProfesora).toHaveBeenCalledWith(actor);
    expect(datos.cargar).toHaveBeenCalledTimes(1);
    expect(datos.cargar).toHaveBeenCalledWith(actor, 'perfil-de-fati', 2099, 9);
  });

  it('un usuario sin perfil recibe 404 y NO se carga nada', async () => {
    const { datos, servicio } = montar();
    datos.perfilDeLaProfesora.mockRejectedValue(new NotFoundException('sin perfil'));

    await expect(servicio.deLaProfesora(actor, 2099, 9)).rejects.toBeInstanceOf(NotFoundException);
    expect(datos.cargar).not.toHaveBeenCalled();
  });

  it('valida anio y mes ANTES de buscar el perfil', async () => {
    const { datos, servicio } = montar();

    await expect(servicio.deLaProfesora(actor, 2099, 13)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(servicio.deLaProfesora(actor, 1999, 9)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(datos.perfilDeLaProfesora).not.toHaveBeenCalled();
    expect(datos.cargar).not.toHaveBeenCalled();
  });
});

describe('LiquidacionService.delMes', () => {
  it('valida anio y mes ANTES de cargar nada', async () => {
    const { datos, servicio } = montar();

    await expect(servicio.delMes(actor, 'perfil-de-fati', 2099, 13)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(datos.cargar).not.toHaveBeenCalled();
  });
});
