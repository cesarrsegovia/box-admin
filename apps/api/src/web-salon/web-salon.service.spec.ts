import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { RolUsuario } from '@boxadmin/shared';
import { RolesGuard } from '../common/guards/roles.guard';
import { runWithTenant } from '../common/tenant/tenant-context';
import { aplicarScopeDeTenant } from '../common/tenant/tenant-scoped.extension';
import { CrearFaqDto } from './dto/crear-faq.dto';
import { CrearTestimonioDto } from './dto/crear-testimonio.dto';
import { GuardarWebSalonDto } from './dto/guardar-web-salon.dto';
import { WebSalonController } from './web-salon.controller';
import { WebSalonService } from './web-salon.service';

const ACTOR = { sub: 'admin-1', tenantId: 't1', rol: 'ADMIN_SALON' } as never;

/** Las cuatro banderas de privacidad, en un solo sitio para poder recorrerlas. */
const BANDERAS = [
  'mostrarPrecios',
  'mostrarTestimonios',
  'mostrarFAQ',
  'mostrarTurnosLibres',
] as const;

interface FilaConTenant {
  id: string;
  tenantId: string;
  [clave: string]: unknown;
}

/**
 * El doble ORDENA de verdad, siguiendo el `orderBy` que le llega.
 *
 * Sin esto, el caso del orden de los testimonios pasaria con cualquier
 * implementacion —incluida una sin `orderBy`— porque el doble los devolveria en
 * orden de insercion, que en ese test coincide a medias con el correcto.
 */
function ordenar<T extends Record<string, unknown>>(
  filas: T[],
  orderBy: Record<string, string>[] | undefined,
): T[] {
  if (orderBy === undefined) return filas;

  return [...filas].sort((a, b) => {
    for (const criterio of orderBy) {
      const [campo] = Object.keys(criterio);
      if (campo === undefined) continue;
      const izquierda = a[campo] as string | number;
      const derecha = b[campo] as string | number;
      if (izquierda < derecha) return criterio[campo] === 'desc' ? 1 : -1;
      if (izquierda > derecha) return criterio[campo] === 'desc' ? -1 : 1;
    }
    return 0;
  });
}

/**
 * El doble de la base pasa cada llamada por `aplicarScopeDeTenant`, que es el
 * nucleo REAL de la extension de aislamiento.
 *
 * No es ceremonia: es lo que hace que estos tests comprueben el aislamiento de
 * verdad y no una imitacion. Un `data` con `tenantId` en un `update` lanza aqui
 * igual que en produccion, un `deleteMany` recibe el filtro inyectado de
 * verdad, y un `upsert` seria rechazado. Con un `jest.fn()` pelado, la fila de
 * otro gimnasio se borraria y el test pasaria igual.
 */
function crearServicio(
  estado: {
    testimonios?: FilaConTenant[];
    preguntas?: FilaConTenant[];
    packs?: FilaConTenant[];
    config?: Record<string, unknown> | null;
  } = {},
) {
  let config: Record<string, unknown> | null = estado.config ?? null;
  let testimonios: FilaConTenant[] = estado.testimonios ?? [];
  let preguntas: FilaConTenant[] = estado.preguntas ?? [];
  const packs: FilaConTenant[] = estado.packs ?? [];
  let siguienteId = 0;

  const coincide = (fila: FilaConTenant, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([clave, valor]) => fila[clave] === valor);

  function coleccion(
    modelo: string,
    leer: () => FilaConTenant[],
    escribir: (f: FilaConTenant[]) => void,
  ) {
    return {
      findMany: jest.fn((args: Record<string, unknown>) => {
        const { where, orderBy } = aplicarScopeDeTenant(modelo, 'findMany', args) as {
          where: Record<string, unknown>;
          orderBy?: Record<string, string>[];
        };
        return Promise.resolve(
          ordenar(
            leer().filter((fila) => coincide(fila, where)),
            orderBy,
          ),
        );
      }),
      create: jest.fn((args: Record<string, unknown>) => {
        const { data } = aplicarScopeDeTenant(modelo, 'create', args) as {
          data: Record<string, unknown>;
        };
        siguienteId += 1;
        const fila = { id: `${modelo}-${siguienteId}`, ...data } as FilaConTenant;
        escribir([...leer(), fila]);
        return Promise.resolve(fila);
      }),
      deleteMany: jest.fn((args: Record<string, unknown>) => {
        const { where } = aplicarScopeDeTenant(modelo, 'deleteMany', args) as {
          where: Record<string, unknown>;
        };
        const quedan = leer().filter((fila) => !coincide(fila, where));
        const count = leer().length - quedan.length;
        escribir(quedan);
        return Promise.resolve({ count });
      }),
    };
  }

  const db = {
    webSalonConfig: {
      findFirst: jest.fn((args: Record<string, unknown>) => {
        aplicarScopeDeTenant('WebSalonConfig', 'findFirst', args);
        return Promise.resolve(config);
      }),
      create: jest.fn((args: Record<string, unknown>) => {
        const { data } = aplicarScopeDeTenant('WebSalonConfig', 'create', args) as {
          data: Record<string, unknown>;
        };
        config = { ...data };
        return Promise.resolve(config);
      }),
      update: jest.fn((args: Record<string, unknown>) => {
        const { data } = aplicarScopeDeTenant('WebSalonConfig', 'update', args) as {
          data: Record<string, unknown>;
        };
        config = { ...(config ?? {}), ...data };
        return Promise.resolve(config);
      }),
    },
    testimonio: coleccion(
      'Testimonio',
      () => testimonios,
      (f) => {
        testimonios = f;
      },
    ),
    preguntaFrecuente: coleccion(
      'PreguntaFrecuente',
      () => preguntas,
      (f) => {
        preguntas = f;
      },
    ),
    pack: {
      findFirst: jest.fn((args: Record<string, unknown>) => {
        const { where } = aplicarScopeDeTenant('Pack', 'findFirst', args) as {
          where: Record<string, unknown>;
        };
        return Promise.resolve(packs.find((fila) => coincide(fila, where)) ?? null);
      }),
    },
    $transaction: jest.fn((fn: (tx: unknown) => unknown): unknown => fn(db)),
  };

  return {
    servicio: new WebSalonService({ db } as never),
    db,
    filas: {
      get testimonios() {
        return testimonios;
      },
      get preguntas() {
        return preguntas;
      },
    },
  };
}

/** Las dos formas de pedir validacion que usa el ValidationPipe de main.ts. */
function erroresDe(dto: object): string[] {
  return validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).map((e) => e.property);
}

describe('GuardarWebSalonDto', () => {
  it('una URL de imagen que no es https es 400', () => {
    // Los dos, no uno guardado y otro rechazado. Un `javascript:` en el `src`
    // de una imagen de una pagina publica es XSS almacenado; un `http://` en
    // una pagina servida por https es contenido mixto que el navegador bloquea
    // sin avisar al gimnasio. El 400 lo produce el ValidationPipe global a
    // partir de estos errores.
    expect(
      erroresDe(
        plainToInstance(GuardarWebSalonDto, { imagenPrincipalUrl: 'http://gym.io/foto.jpg' }),
      ),
    ).toContain('imagenPrincipalUrl');

    expect(
      erroresDe(plainToInstance(GuardarWebSalonDto, { imagenPrincipalUrl: 'javascript:alert(1)' })),
    ).toContain('imagenPrincipalUrl');
  });

  it('una URL https si pasa', () => {
    // Sin este caso, un validador que rechazara TODO dejaria el test anterior
    // en verde y la funcionalidad rota.
    expect(
      erroresDe(
        plainToInstance(GuardarWebSalonDto, { imagenPrincipalUrl: 'https://gym.io/f.jpg' }),
      ),
    ).toEqual([]);
  });

  it('el link extra se valida igual que la imagen', () => {
    // Tambien sale en un `href` de la pagina publica.
    expect(
      erroresDe(plainToInstance(GuardarWebSalonDto, { linkExtra: 'javascript:alert(1)' })),
    ).toContain('linkExtra');
  });

  it('un color que no es hexadecimal es 400', () => {
    // Estos dos valores acaban en una variable CSS de una pagina publica.
    expect(
      erroresDe(plainToInstance(GuardarWebSalonDto, { colorPrimario: 'red; background: url(x)' })),
    ).toContain('colorPrimario');
  });

  it('un testimonio sin texto es 400', () => {
    expect(erroresDe(plainToInstance(CrearTestimonioDto, { nombre: 'Ana', texto: '' }))).toContain(
      'texto',
    );
  });

  it('una pregunta sin respuesta es 400', () => {
    expect(
      erroresDe(plainToInstance(CrearFaqDto, { pregunta: 'Hay duchas?', respuesta: '' })),
    ).toContain('respuesta');
  });
});

describe('WebSalonService.guardar', () => {
  it('guardar dos veces actualiza, no duplica', async () => {
    // Es el camino findFirst + create/update, porque `upsert` esta bloqueado
    // por la extension de aislamiento (UnsafeUniqueOperationError).
    const { servicio, db } = crearServicio();

    await runWithTenant('t1', async () => {
      await servicio.guardar(ACTOR, { tituloPrincipal: 'Primero' });
      await servicio.guardar(ACTOR, { tituloPrincipal: 'Segundo' });
    });

    expect(db.webSalonConfig.create).toHaveBeenCalledTimes(1);
    expect(db.webSalonConfig.update).toHaveBeenCalledTimes(1);

    const leido = await runWithTenant('t1', () => servicio.ver());
    expect(leido.tituloPrincipal).toBe('Segundo');
  });

  it('el data del update NO lleva tenantId', async () => {
    // Con el, la extension lo lee como un intento de mover la fila a otro
    // gimnasio y lanza ReasignacionDeTenantError. El doble corre el mismo
    // `aplicarScopeDeTenant` que produccion, asi que este caso cae de verdad si
    // alguien copia el `data` del `create` sobre el del `update`.
    const { servicio, db } = crearServicio();

    await runWithTenant('t1', async () => {
      await servicio.guardar(ACTOR, {});
      await servicio.guardar(ACTOR, {});
    });

    const data = db.webSalonConfig.update.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(Object.keys(data.data)).not.toContain('tenantId');
  });

  it('el PUT es un reemplazo: lo que no viene se borra', async () => {
    // Es lo que permite que el admin vacie el tagline mandando el formulario
    // sin el. Con semantica de parche no habria forma de borrarlo.
    const { servicio } = crearServicio();

    const resultado = await runWithTenant('t1', async () => {
      await servicio.guardar(ACTOR, { tagline: 'Entrena con nosotras', activa: true });
      return await servicio.guardar(ACTOR, { activa: true });
    });

    expect(resultado.tagline).toBeNull();
    expect(resultado.activa).toBe(true);
  });

  it('sin fila, la web esta APAGADA y no "a medio configurar"', async () => {
    const { servicio } = crearServicio();

    const config = await runWithTenant('t1', () => servicio.ver());

    expect(config.activa).toBe(false);
    expect(config.testimonios).toEqual([]);
  });

  it('cada bandera se guarda EN SU columna, no en la de al lado', async () => {
    // Intercambiar dos banderas en `guardar` no lo nota nadie si los tests
    // solo miran `tagline` y `activa`: las cuatro son booleanos del mismo
    // tipo y el compilador no distingue una de otra. En produccion eso es que
    // el admin apaga "publicar la agenda", el servidor apaga las preguntas
    // frecuentes, y la agenda y cuan vacio esta el gimnasio siguen en internet.
    //
    // Se prueba una vuelta por bandera, con esa encendida y las otras tres
    // apagadas: asi cualquier intercambio ENTRE DOS CUALESQUIERA cae, porque en
    // la vuelta de una de las dos el valor viaja a la columna equivocada.
    for (const encendida of BANDERAS) {
      const { servicio } = crearServicio();
      const dto: GuardarWebSalonDto = Object.fromEntries(
        BANDERAS.map((bandera) => [bandera, bandera === encendida]),
      );

      const guardado = await runWithTenant('t1', () => servicio.guardar(ACTOR, dto));

      expect(BANDERAS.filter((bandera) => guardado[bandera])).toEqual([encendida]);
    }
  });

  it('omitir las banderas las devuelve a SU valor por defecto', async () => {
    // El otro lado de lo mismo: el `?? WEB_SALON_POR_DEFECTO.loQueSea` tambien
    // se puede cruzar. `mostrarPrecios` viene encendida por defecto y las otras
    // tres apagadas, y publicar la agenda por defecto no es un detalle de
    // presentacion.
    const { servicio } = crearServicio();

    const guardado = await runWithTenant('t1', () => servicio.guardar(ACTOR, {}));

    expect({
      mostrarPrecios: guardado.mostrarPrecios,
      mostrarTestimonios: guardado.mostrarTestimonios,
      mostrarFAQ: guardado.mostrarFAQ,
      mostrarTurnosLibres: guardado.mostrarTurnosLibres,
    }).toEqual({
      mostrarPrecios: true,
      mostrarTestimonios: false,
      mostrarFAQ: false,
      mostrarTurnosLibres: false,
    });
  });

  it('un plan destacado de otro gimnasio es 400, no un 500 de Postgres', async () => {
    // La FK compuesta ya lo impide en la base, pero su violacion sale como un
    // error que nadie traduce.
    const { servicio } = crearServicio({ packs: [{ id: 'p-ajeno', tenantId: 't2' }] });

    await expect(
      runWithTenant('t1', () => servicio.guardar(ACTOR, { planDestacadoId: 'p-ajeno' })),
    ).rejects.toThrow(BadRequestException);
  });

  it('un plan destacado propio si se guarda', async () => {
    const { servicio } = crearServicio({ packs: [{ id: 'p-1', tenantId: 't1' }] });

    const config = await runWithTenant('t1', () =>
      servicio.guardar(ACTOR, { planDestacadoId: 'p-1' }),
    );

    expect(config.planDestacadoId).toBe('p-1');
  });
});

describe('WebSalonService: testimonios y preguntas', () => {
  it('un testimonio de otro gimnasio no se puede borrar', async () => {
    // El deleteMany lleva el tenantId inyectado; el de otro gimnasio no
    // aparece y el borrado no afecta a nadie. Se comprueba que la fila ajena
    // SIGUE existiendo, no solo que la respuesta fue 404.
    const { servicio, filas } = crearServicio({
      testimonios: [{ id: 'te-ajeno', tenantId: 't2', nombre: 'Otra', texto: 'x', orden: 0 }],
    });

    await expect(runWithTenant('t1', () => servicio.borrarTestimonio('te-ajeno'))).rejects.toThrow(
      NotFoundException,
    );

    expect(filas.testimonios).toHaveLength(1);
    expect(filas.testimonios[0]!.id).toBe('te-ajeno');
  });

  it('el propio si se borra', async () => {
    // Sin este caso, un `borrarTestimonio` que no borrara NADA dejaria el test
    // anterior en verde.
    const { servicio, filas } = crearServicio({
      testimonios: [{ id: 'te-1', tenantId: 't1', nombre: 'Ana', texto: 'x', orden: 0 }],
    });

    await runWithTenant('t1', () => servicio.borrarTestimonio('te-1'));

    expect(filas.testimonios).toHaveLength(0);
  });

  it('borrar un testimonio borra ESE y no los demas del mismo gimnasio', async () => {
    // EL CASO QUE FALTABA, y el agujero mas grave del modulo: con un solo
    // testimonio sembrado, "borro el suyo" y "borro TODOS los suyos" dan el
    // mismo resultado, asi que un `deleteMany({ where: {} })` pasa los dos
    // casos de arriba —el del id ajeno sobrevive porque el filtro de tenant
    // sigue inyectado— y se lleva por delante la pagina entera del gimnasio.
    // Hacen falta DOS filas propias para notar la diferencia.
    const { servicio, filas } = crearServicio({
      testimonios: [
        { id: 'te-1', tenantId: 't1', nombre: 'Ana', texto: 'a', orden: 0 },
        { id: 'te-2', tenantId: 't1', nombre: 'Bea', texto: 'b', orden: 1 },
        { id: 'te-ajeno', tenantId: 't2', nombre: 'Otra', texto: 'x', orden: 0 },
      ],
    });

    await runWithTenant('t1', () => servicio.borrarTestimonio('te-1'));

    expect(filas.testimonios.map((f) => f.id).sort()).toEqual(['te-2', 'te-ajeno']);
  });

  it('borrar una pregunta borra ESA y no las demas del mismo gimnasio', async () => {
    // El mismo agujero, identico, en `borrarPregunta`. Van por separado porque
    // son dos llamadas distintas y una puede mutar sin la otra.
    const { servicio, filas } = crearServicio({
      preguntas: [
        { id: 'pf-1', tenantId: 't1', pregunta: 'Hay duchas?', respuesta: 'Si', orden: 0 },
        { id: 'pf-2', tenantId: 't1', pregunta: 'Hay parking?', respuesta: 'No', orden: 1 },
        { id: 'pf-ajena', tenantId: 't2', pregunta: 'Ajena', respuesta: 'x', orden: 0 },
      ],
    });

    await runWithTenant('t1', () => servicio.borrarPregunta('pf-1'));

    expect(filas.preguntas.map((f) => f.id).sort()).toEqual(['pf-2', 'pf-ajena']);
  });

  it('una pregunta de otro gimnasio tampoco', async () => {
    const { servicio } = crearServicio();

    await expect(runWithTenant('t1', () => servicio.borrarPregunta('pf-ajena'))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('los testimonios salen en el orden que puso el admin', async () => {
    // Creados 2, 0, 1; salen 0, 1, 2. Sin el orderBy saldrian por orden de
    // creacion.
    const { servicio } = crearServicio();

    const config = await runWithTenant('t1', async () => {
      await servicio.crearTestimonio(ACTOR, { nombre: 'Tercera', texto: 'c', orden: 2 });
      await servicio.crearTestimonio(ACTOR, { nombre: 'Primera', texto: 'a', orden: 0 });
      await servicio.crearTestimonio(ACTOR, { nombre: 'Segunda', texto: 'b', orden: 1 });
      return await servicio.ver();
    });

    expect(config.testimonios.map((t) => t.nombre)).toEqual(['Primera', 'Segunda', 'Tercera']);
  });

  it('con el MISMO orden desempata por id, para que la pagina no cambie sola', async () => {
    // El segundo criterio de `ORDEN_DE_CONTENIDO` no sobra: con dos filas del
    // mismo `orden` —y el admin pone 0 en todas mientras no toca nada—
    // Postgres puede devolverlas en cualquier orden y en cualquier corrida, y
    // la landing cambiaria sola entre recargas.
    //
    // Las filas se SIEMBRAN con los ids al reves de como entran, no se crean:
    // creandolas, el id que inventa el doble crece con la insercion y el
    // desempate daria el mismo resultado que no tenerlo.
    const { servicio } = crearServicio({
      testimonios: [
        { id: 'te-b', tenantId: 't1', nombre: 'Bea', texto: 'b', orden: 0 },
        { id: 'te-a', tenantId: 't1', nombre: 'Ana', texto: 'a', orden: 0 },
      ],
      preguntas: [
        { id: 'pf-b', tenantId: 't1', pregunta: 'B?', respuesta: 'b', orden: 0 },
        { id: 'pf-a', tenantId: 't1', pregunta: 'A?', respuesta: 'a', orden: 0 },
      ],
    });

    const config = await runWithTenant('t1', () => servicio.ver());

    expect(config.testimonios.map((t) => t.id)).toEqual(['te-a', 'te-b']);
    expect(config.preguntas.map((p) => p.id)).toEqual(['pf-a', 'pf-b']);
  });
});

describe('WebSalonService.ver: el contrato del lado admin', () => {
  /**
   * Una fila como la devolveria la base EL DIA QUE ALGUIEN ENSANCHE EL SELECT
   * para depurar algo: las columnas del contrato mas las que nunca salieron.
   *
   * El doble no respeta el `select` a proposito, igual que el del lado publico:
   * un doble que lo respetara escondería justo el fallo que se busca.
   */
  const FILA_ANCHA = {
    tenantId: 't1',
    creadoEn: new Date('2026-01-01T00:00:00.000Z'),
    actualizadoEn: new Date('2026-02-02T00:00:00.000Z'),
    activa: true,
    colorPrimario: '#101010',
    colorSecundario: '#f0f0f0',
    tituloPrincipal: 'Studio Fuego',
    tagline: 'Entrena con nosotras',
    sobreElSalon: 'Pilates y funcional',
    imagenPrincipalUrl: 'https://cdn.test/portada.jpg',
    whatsapp: '+5491100000000',
    instagram: '@studiofuego',
    linkExtra: 'https://studiofuego.test',
    mostrarPrecios: true,
    mostrarTestimonios: false,
    mostrarFAQ: true,
    mostrarTurnosLibres: false,
    planDestacadoId: 'p-1',
  };

  it('la respuesta de ver() es EXACTAMENTE el contrato, valor por valor', async () => {
    // Un `toEqual` del objeto entero y no una lista de claves: fijar las claves
    // no protege de que el mapeo cruce dos valores del mismo tipo —los dos
    // colores, las cuatro banderas— ni de que una columna que nadie decidio
    // publicar se cuele por un spread de la fila de base.
    const { servicio } = crearServicio({
      config: FILA_ANCHA,
      testimonios: [{ id: 'te-1', tenantId: 't1', nombre: 'Ana', texto: 'Genial', orden: 3 }],
      preguntas: [
        { id: 'pf-1', tenantId: 't1', pregunta: 'Hay duchas?', respuesta: 'Si', orden: 7 },
      ],
    });

    const vista = await runWithTenant('t1', () => servicio.ver());

    expect(vista).toEqual({
      activa: true,
      colorPrimario: '#101010',
      colorSecundario: '#f0f0f0',
      tituloPrincipal: 'Studio Fuego',
      tagline: 'Entrena con nosotras',
      sobreElSalon: 'Pilates y funcional',
      imagenPrincipalUrl: 'https://cdn.test/portada.jpg',
      whatsapp: '+5491100000000',
      instagram: '@studiofuego',
      linkExtra: 'https://studiofuego.test',
      mostrarPrecios: true,
      mostrarTestimonios: false,
      mostrarFAQ: true,
      mostrarTurnosLibres: false,
      planDestacadoId: 'p-1',
      testimonios: [{ id: 'te-1', nombre: 'Ana', texto: 'Genial', orden: 3 }],
      preguntas: [{ id: 'pf-1', pregunta: 'Hay duchas?', respuesta: 'Si', orden: 7 }],
    });
  });

  it('lo creado tampoco devuelve la fila entera', async () => {
    // Mismo contrato en el POST que en el GET: `crearTestimonio` y
    // `crearPregunta` devuelven lo que acaban de escribir, y el `data` que les
    // llega SI lleva el tenantId.
    const { servicio } = crearServicio();

    const { testimonio, pregunta } = await runWithTenant('t1', async () => ({
      testimonio: await servicio.crearTestimonio(ACTOR, { nombre: 'Ana', texto: 'Genial' }),
      pregunta: await servicio.crearPregunta(ACTOR, { pregunta: 'Hay duchas?', respuesta: 'Si' }),
    }));

    expect(Object.keys(testimonio).sort()).toEqual(['id', 'nombre', 'orden', 'texto']);
    expect(Object.keys(pregunta).sort()).toEqual(['id', 'orden', 'pregunta', 'respuesta']);
  });

  it('ver() pide un select explicito con las columnas del contrato', async () => {
    // La otra mitad de la disciplina, y la que el mapeo no puede comprobar: sin
    // `select`, la consulta se trae la fila entera de la base aunque despues no
    // se publique. Si el modelo crece, la columna nueva entra aqui porque
    // alguien lo decide, no porque sea `SELECT *`.
    const { servicio, db } = crearServicio({ config: FILA_ANCHA });

    await runWithTenant('t1', () => servicio.ver());

    const args = db.webSalonConfig.findFirst.mock.calls[0]![0] as {
      select?: Record<string, boolean>;
    };

    expect(Object.keys(args.select ?? {}).sort()).toEqual(
      [
        'activa',
        'colorPrimario',
        'colorSecundario',
        'tituloPrincipal',
        'tagline',
        'sobreElSalon',
        'imagenPrincipalUrl',
        'whatsapp',
        'instagram',
        'linkExtra',
        'mostrarPrecios',
        'mostrarTestimonios',
        'mostrarFAQ',
        'mostrarTurnosLibres',
        'planDestacadoId',
      ].sort(),
    );
  });
});

describe('Los roles de /config/web-salon', () => {
  const guard = new RolesGuard(new Reflector());

  function contexto(handler: (...args: never[]) => unknown, rol: RolUsuario): ExecutionContext {
    return {
      getHandler: () => handler,
      getClass: () => WebSalonController,
      switchToHttp: () => ({ getRequest: () => ({ user: { rol } }) }),
    } as unknown as ExecutionContext;
  }

  it('ADMIN_OPERATIVO no puede tocar la configuracion de la web', () => {
    // Lo que se decide en estos endpoints es que sale a internet con el nombre
    // del gimnasio: la bandera `activa` publica el sitio entero y
    // `mostrarPrecios` pone la lista de precios en una pagina indexable.
    expect(() =>
      guard.canActivate(contexto(WebSalonController.prototype.guardar, 'ADMIN_OPERATIVO')),
    ).toThrow(ForbiddenException);

    expect(() =>
      guard.canActivate(contexto(WebSalonController.prototype.crearTestimonio, 'ADMIN_OPERATIVO')),
    ).toThrow(ForbiddenException);
  });

  it('ADMIN_SALON si puede', () => {
    // Sin este caso, el 403 de arriba podria ser porque el rol declarado no
    // existe y nadie pasa nunca.
    expect(guard.canActivate(contexto(WebSalonController.prototype.guardar, 'ADMIN_SALON'))).toBe(
      true,
    );
    expect(
      guard.canActivate(contexto(WebSalonController.prototype.crearTestimonio, 'ADMIN_SALON')),
    ).toBe(true);
  });

  it('los seis endpoints piden ADMIN_SALON, ninguno se quedo sin decorar', () => {
    const handlers = [
      WebSalonController.prototype.ver,
      WebSalonController.prototype.guardar,
      WebSalonController.prototype.crearTestimonio,
      WebSalonController.prototype.borrarTestimonio,
      WebSalonController.prototype.crearPregunta,
      WebSalonController.prototype.borrarPregunta,
    ];

    for (const handler of handlers) {
      expect(() => guard.canActivate(contexto(handler, 'ADMIN_OPERATIVO'))).toThrow(
        ForbiddenException,
      );
    }
  });
});
