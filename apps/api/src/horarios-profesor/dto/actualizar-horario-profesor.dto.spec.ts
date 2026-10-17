import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ActualizarHorarioProfesorDto } from './actualizar-horario-profesor.dto';

/**
 * EL DTO CONTRA EL PIPE DE VERDAD, no contra `validate()` suelto.
 *
 * Lo que decide si `hasta: null` llega entero al service no son los decoradores
 * por su cuenta: es la combinacion de `whitelist` + `forbidNonWhitelisted` +
 * `transform` que monta `main.ts`. El whitelist BORRA cualquier clave que no
 * este decorada, asi que un decorador mal elegido no se manifiesta como un 400
 * sino como un null que desaparece por el camino y un PATCH que contesta 200
 * sin haber hecho nada.
 *
 * Las opciones estan copiadas de `app.useGlobalPipes(...)` en
 * `apps/api/src/main.ts`. Si alli cambian, este spec deja de hablar del pipe
 * real; por eso se nombra el archivo aqui.
 */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

async function porElPipe(cuerpo: Record<string, unknown>): Promise<ActualizarHorarioProfesorDto> {
  return (await pipe.transform(cuerpo, {
    type: 'body',
    metatype: ActualizarHorarioProfesorDto,
  })) as ActualizarHorarioProfesorDto;
}

describe('ActualizarHorarioProfesorDto: los tres estados de `hasta`', () => {
  /**
   * EL NULL SOBREVIVE AL WHITELIST.
   *
   * Es el que sostiene la reactivacion entera: sin el, «volve a dejar la
   * vigencia indefinida» no tiene forma de viajar.
   */
  it('`hasta: null` pasa la validacion y LLEGA como null', async () => {
    const dto = await porElPipe({ activo: true, hasta: null });

    expect(dto.hasta).toBeNull();
    // Y no por haberse colado en un objeto sin filtrar: el whitelist corrio.
    expect(dto.activo).toBe(true);
  });

  /**
   * LA CLAVE AUSENTE SE DISTINGUE DEL NULL, y esta es la mitad del par.
   *
   * Con `hasta: null` solo, «llego null» y «no llego nada» son indistinguibles:
   * los dos valdrian `undefined` si el pipe se comiera el null.
   */
  it('sin la clave, `hasta` queda en undefined y no en null', async () => {
    const dto = await porElPipe({ activo: true });

    expect(dto.hasta).toBeUndefined();
    expect(dto.hasta).not.toBeNull();
  });

  it('una fecha pasa tal cual', async () => {
    const dto = await porElPipe({ hasta: '2026-12-31' });

    expect(dto.hasta).toBe('2026-12-31');
  });

  /**
   * Y ACEPTAR EL NULL NO ABRE LA PUERTA A CUALQUIER COSA.
   *
   * `@ValidateIf` solo salta la validacion para null y para undefined. Un
   * `'manana'` o un `''` siguen siendo 400: si no, la reactivacion habria
   * costado el formato de la fecha.
   */
  it.each(['manana', '', 0, false])('%p sigue siendo 400', async (basura) => {
    await expect(porElPipe({ hasta: basura })).rejects.toThrow(BadRequestException);
  });

  /**
   * LO QUE EL DTO *NO* ATAJA, dicho para que nadie lo de por hecho: el patron
   * es `\d{4}-\d{2}-\d{2}` y un `2026-13-01` lo cumple. Quien lo rechaza es
   * `desdeFechaISO` en el service, que valida el ida y vuelta —y lo hace con
   * una `FechaInvalidaError` que nadie traduce, o sea un 500, exactamente el
   * agujero que `consulta-rango.dto.ts` ya tiene documentado para los otros
   * diez DTOs con fechas del repo—. Dejar aqui una asercion de que esto es un
   * 400 seria un test verde que describe una defensa que no existe.
   */
  it('un mes 13 pasa el patron del DTO: lo rechaza el service, no esto', async () => {
    await expect(porElPipe({ hasta: '2026-13-01' })).resolves.toMatchObject({
      hasta: '2026-13-01',
    });
  });
});
