import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { SalonPublico } from '@boxadmin/shared';
import { getTenantContext } from '../common/tenant/tenant-context';
import { aplicarScopeDeTenant } from '../common/tenant/tenant-scoped.extension';
import { PublicoController } from './publico.controller';
import { PublicoService } from './publico.service';

/**
 * El doble ordena de verdad. Esta copiada y no importada de
 * `web-salon.service.spec.ts` a proposito: importar un archivo de tests desde
 * otro lo EJECUTA, y los `describe` del primero se registrarian dos veces.
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

const AHORA = new Date('2026-10-05T12:00:00.000Z');

/**
 * El id del gimnasio, elegido PARA QUE BUSCARLO EN EL CUERPO NO DE RUIDO.
 *
 * Era `'t1'`, una aguja de dos caracteres: hoy no habia falsos positivos de
 * casualidad, pero el dia que un fixture diga "Pilates t1" o una URL lleve
 * `t1`, el caso que comprueba que el tenantId NO sale se vuelve ruido y alguien
 * lo borra por molesto. Una cadena que no puede aparecer por accidente hace que
 * el unico motivo posible de que salte sea el de verdad.
 */
const TENANT_ID = 'tenant-id-que-no-debe-salir';

/**
 * Las reservas de un turno TAL Y COMO VIVEN EN LA BASE, no su cuenta.
 *
 * Una reserva nunca se borra: se cancela, poniendole fecha a `canceladaEn`, y
 * desde ese momento deja de ocupar lugar. Sembrar las filas y no el `_count`
 * es lo que permite que el doble calcule la cuenta interpretando el `where`
 * anidado, y por tanto lo que hace observable ese filtro.
 */
function reservasDe(vivas: number, canceladas = 0): Record<string, unknown>[] {
  return [
    ...Array.from({ length: vivas }, (_, i) => ({ id: `re-viva-${i}`, canceladaEn: null })),
    ...Array.from({ length: canceladas }, (_, i) => ({
      id: `re-cancelada-${i}`,
      canceladaEn: new Date('2026-10-01T09:00:00.000Z'),
    })),
  ];
}

/** La configuracion de un gimnasio con la web encendida y todo apagado. */
const CONFIG_BASE = {
  activa: true,
  colorPrimario: '#101010',
  colorSecundario: '#f0f0f0',
  // Distinto del nombre del gimnasio a proposito: si los dos dijeran "Studio
  // Fuego", un mapeo que cruzara `nombre` y `tituloPrincipal` pasaria el
  // `toEqual` del cuerpo entero.
  tituloPrincipal: 'Tu primera clase es gratis',
  tagline: 'Entrena con nosotras',
  sobreElSalon: 'Pilates y funcional',
  imagenPrincipalUrl: 'https://cdn.test/portada.jpg',
  whatsapp: '+5491100000000',
  instagram: '@studiofuego',
  linkExtra: 'https://studiofuego.test',
  mostrarPrecios: false,
  mostrarTestimonios: false,
  mostrarFAQ: false,
  mostrarTurnosLibres: false,
  planDestacadoId: null as string | null,
};

interface Semilla {
  tenant?: { id: string; nombre: string; activo: boolean; slug: string } | null;
  config?: (Partial<typeof CONFIG_BASE> & { activa?: boolean }) | null;
  packs?: Record<string, unknown>[];
  testimonios?: Record<string, unknown>[];
  preguntas?: Record<string, unknown>[];
  turnos?: Record<string, unknown>[];
}

/**
 * Los dobles devuelven LA FILA ENTERA, no solo lo que pide el `select`.
 *
 * Es a proposito y es la mitad del valor de este archivo: asi, el dia en que
 * alguien devuelva `findMany` tal cual en vez de mapear campo a campo, el
 * `id`, el `tenantId` y el nombre de la profesora aparecen en el cuerpo y los
 * casos que miran las claves exactas caen. Un doble que respetara el `select`
 * esconderia justo el fallo que este endpoint existe para no tener.
 *
 * Cada llamada ademas pasa por `aplicarScopeDeTenant` —el nucleo real de la
 * extension— y anota en que contexto llego.
 */
function crearServicio(semilla: Semilla = {}) {
  const contextos: { consulta: string; contexto: string }[] = [];

  function anotar(consulta: string): void {
    contextos.push({ consulta, contexto: getTenantContext()?.kind ?? 'sin-contexto' });
  }

  function lista(modelo: string, consulta: string, filas: Record<string, unknown>[]) {
    return jest.fn((args: Record<string, unknown>) => {
      anotar(consulta);
      // EL DOBLE HONRA EL `take`, y no es un detalle: `turnosLibres` lee un
      // pool (`TURNOS_LEIDOS`) mas grande que el tope que publica
      // (`MAXIMO_TURNOS`) justo porque el filtro de "tiene lugar" se hace en
      // memoria. Con un doble que ignorara el `take`, bajar el pool al tope no
      // cambiaria ni un resultado y la razon de que sean dos numeros seria
      // invisible.
      const { where, orderBy, take, select } = aplicarScopeDeTenant(modelo, 'findMany', args) as {
        where: Record<string, unknown>;
        orderBy?: Record<string, string>[];
        take?: number;
        select?: Record<string, unknown>;
      };

      const visibles = filas.filter((fila) => coincide(fila, where));
      const ordenadas = ordenar(visibles, orderBy);
      const recortadas = take === undefined ? ordenadas : ordenadas.slice(0, take);

      return Promise.resolve(recortadas.map((fila) => conCuentas(fila, select)));
    });
  }

  /** Una fila contra un `where` de Prisma, escalares y filtros compuestos. */
  function coincide(fila: Record<string, unknown>, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([clave, valor]) => {
      // Los filtros compuestos (`fecha: { gte, lt }`, `sala: { activa }`) los
      // resuelve `coincideComplejo`; los escalares, la igualdad.
      if (valor !== null && typeof valor === 'object') return coincideComplejo(fila, clave, valor);
      return fila[clave] === valor;
    });
  }

  /**
   * EL DOBLE CALCULA EL `_count`, INTERPRETANDO SU `where`, en vez de que la
   * semilla lo escriba ya cocinado.
   *
   * Es lo que hace observable el filtro de reservas canceladas de
   * `turnosLibres`: una reserva nunca se borra, se cancela, asi que
   * `_count: { reservas: true }` contaria las canceladas como si ocuparan
   * lugar y un turno de diez cupos con ocho reservas vivas y dos canceladas
   * desapareceria de la landing por lleno. Con el `_count` sembrado a mano ese
   * cambio es invisible POR CONSTRUCCION: el doble devuelve el numero que le
   * dieron y la semantica del `where` anidado no la mira nadie.
   *
   * No es una excepcion fabricada para salvar un test: el doble ya interpreta
   * `where` con `gte`/`lt` y relaciones anidadas, `orderBy` y `take`. Un
   * `_count` con `where` es la misma familia, y reusa el mismo `coincide`.
   *
   * Las filas hijas se quedan EN LA FILA que se devuelve, igual que el resto
   * de columnas que el `select` no pidio: si alguien devolviera el `findMany`
   * tal cual, las reservas enteras saldrian en el cuerpo y los casos que miran
   * las claves exactas caerian.
   */
  function conCuentas(
    fila: Record<string, unknown>,
    select: Record<string, unknown> | undefined,
  ): Record<string, unknown> {
    const pedido = (select?._count as { select?: Record<string, unknown> } | undefined)?.select;
    if (pedido === undefined) return fila;

    const cuentas: Record<string, number> = {};

    for (const [relacion, criterio] of Object.entries(pedido)) {
      const hijas = (fila[relacion] as Record<string, unknown>[] | undefined) ?? [];
      const filtro = (criterio as { where?: Record<string, unknown> }).where;

      cuentas[relacion] =
        criterio === true || filtro === undefined
          ? hijas.length
          : hijas.filter((hija) => coincide(hija, filtro)).length;
    }

    return { ...fila, _count: cuentas };
  }

  function coincideComplejo(
    fila: Record<string, unknown>,
    clave: string,
    filtro: Record<string, unknown> | object,
  ): boolean {
    return Object.entries(filtro as Record<string, unknown>).every(([operador, valor]) => {
      const propia = fila[clave];
      switch (operador) {
        case 'gte':
          return (propia as Date).getTime() >= (valor as Date).getTime();
        case 'lt':
          return (propia as Date).getTime() < (valor as Date).getTime();
        default:
          // Relacion anidada: `sala: { activa: true, visibleAlumnos: true }`.
          return (propia as Record<string, unknown>)[operador] === valor;
      }
    });
  }

  const db = {
    tenant: {
      findUnique: jest.fn((args: Record<string, unknown>) => {
        anotar('tenant');
        aplicarScopeDeTenant('Tenant', 'findUnique', args);
        const { where } = args as { where: { slug: string } };
        const tenant = semilla.tenant ?? null;
        return Promise.resolve(tenant !== null && tenant.slug === where.slug ? tenant : null);
      }),
    },
    webSalonConfig: {
      findFirst: jest.fn((args: Record<string, unknown>) => {
        anotar('config');
        aplicarScopeDeTenant('WebSalonConfig', 'findFirst', args);
        return Promise.resolve(
          semilla.config === null || semilla.config === undefined
            ? null
            : { ...CONFIG_BASE, ...semilla.config },
        );
      }),
    },
    pack: { findMany: lista('Pack', 'packs', semilla.packs ?? []) },
    testimonio: { findMany: lista('Testimonio', 'testimonios', semilla.testimonios ?? []) },
    preguntaFrecuente: {
      findMany: lista('PreguntaFrecuente', 'preguntas', semilla.preguntas ?? []),
    },
    turno: { findMany: lista('Turno', 'turnos', semilla.turnos ?? []) },
  };

  return { servicio: new PublicoService({ db } as never), db, contextos };
}

/** El cuerpo tal y como viaja: JSON, con las claves `undefined` ya fuera. */
async function cuerpoDe(semilla: Semilla, slug = 'studio-fuego'): Promise<SalonPublico> {
  const { servicio } = crearServicio(semilla);
  return JSON.parse(JSON.stringify(await servicio.salon(slug, AHORA))) as SalonPublico;
}

const TENANT = { id: TENANT_ID, nombre: 'Studio Fuego', activo: true, slug: 'studio-fuego' };

/** Qué le pasó a una llamada: el código y el cuerpo, sin nada más. */
async function respuestaDe(semilla: Semilla, slug = 'studio-fuego') {
  const { servicio } = crearServicio(semilla);

  try {
    return { estado: 200, cuerpo: await servicio.salon(slug, AHORA) };
  } catch (error) {
    const fallo = error as NotFoundException;
    return { estado: fallo.getStatus(), cuerpo: fallo.getResponse() };
  }
}

describe('PublicoService: los cuatro caminos al mismo 404', () => {
  it('un slug que no existe da 404', async () => {
    const respuesta = await respuestaDe({ tenant: null }, 'no-existe');

    expect(respuesta.estado).toBe(404);
  });

  it('una web APAGADA da exactamente el mismo 404', async () => {
    // Mismo codigo y mismo cuerpo que el anterior. Distinguirlos convierte el
    // endpoint en un directorio de gimnasios: cualquiera prueba nombres y
    // averigua cuales existen. Se comparan las dos respuestas ENTERAS.
    const inexistente = await respuestaDe({ tenant: null }, 'no-existe');
    const apagada = await respuestaDe({ tenant: TENANT, config: { activa: false } });

    expect(apagada).toEqual(inexistente);
  });

  it('un gimnasio sin fila de configuracion da el mismo 404', async () => {
    const inexistente = await respuestaDe({ tenant: null }, 'no-existe');
    const sinFila = await respuestaDe({ tenant: TENANT, config: null });

    expect(sinFila).toEqual(inexistente);
  });

  it('un tenant desactivado da el mismo 404 aunque su web este encendida', async () => {
    // El cuarto camino, y el mas facil de olvidar: la fila dice `activa: true`
    // pero el gimnasio ya no opera.
    const inexistente = await respuestaDe({ tenant: null }, 'no-existe');
    const inactivo = await respuestaDe({ tenant: { ...TENANT, activo: false }, config: {} });

    expect(inactivo).toEqual(inexistente);
  });

  it('un slug con una forma imposible no llega ni a la base, y da el MISMO 404', async () => {
    // El `:slug` viene de la URL y no pasa por el ValidationPipe. Y da el
    // mismo 404, no un 400: dos respuestas distintas ya estrechan la lista de
    // slugs posibles.
    const publico = { salon: jest.fn() };
    const controller = new PublicoController(publico as never);
    const inexistente = await respuestaDe({ tenant: null }, 'no-existe');

    let capturado: unknown = null;
    try {
      void controller.salon('../../etc/passwd');
    } catch (error) {
      capturado = error;
    }

    expect(capturado).toBeInstanceOf(NotFoundException);
    expect((capturado as NotFoundException).getStatus()).toBe(inexistente.estado);
    expect((capturado as NotFoundException).getResponse()).toEqual(inexistente.cuerpo);
    expect(publico.salon).not.toHaveBeenCalled();
  });
});

describe('PublicoService: las banderas se honran OMITIENDO el dato', () => {
  const PACKS = [
    {
      id: 'p-1',
      tenantId: TENANT_ID,
      nombre: 'Mensual 8',
      precio: new Prisma.Decimal('8500'),
      activo: true,
    },
    {
      id: 'p-2',
      tenantId: TENANT_ID,
      nombre: 'Libre',
      precio: new Prisma.Decimal('9900'),
      activo: false,
    },
  ];

  it('con mostrarPrecios apagado, el cuerpo NO CONTIENE el precio', async () => {
    // No es que venga con una bandera en false: es que la clave `packs` no
    // existe en el JSON. Se afirma sobre el cuerpo SERIALIZADO, porque es lo
    // que acaba en el HTML, en la cache del navegador y en el primer "ver
    // codigo fuente".
    const cuerpo = await cuerpoDe({
      tenant: TENANT,
      config: { mostrarPrecios: false },
      packs: PACKS,
    });

    expect(JSON.stringify(cuerpo)).not.toContain('8500');
    expect(cuerpo).not.toHaveProperty('packs');
  });

  it('con la bandera apagada el dato NI SE LEE de la base', async () => {
    // La defensa de verdad: no se trae para despues filtrarlo.
    const { servicio, db } = crearServicio({
      tenant: TENANT,
      config: { mostrarPrecios: false, mostrarTestimonios: false, mostrarFAQ: false },
      packs: PACKS,
    });

    await servicio.salon('studio-fuego', AHORA);

    expect(db.pack.findMany).not.toHaveBeenCalled();
    expect(db.testimonio.findMany).not.toHaveBeenCalled();
    expect(db.preguntaFrecuente.findMany).not.toHaveBeenCalled();
    expect(db.turno.findMany).not.toHaveBeenCalled();
  });

  it('solo salen los packs activos', async () => {
    // Dos packs, uno activo: 8500 y 9900 inactivo.
    const cuerpo = await cuerpoDe({
      tenant: TENANT,
      config: { mostrarPrecios: true },
      packs: PACKS,
    });

    expect(JSON.stringify(cuerpo)).toContain('8500');
    expect(JSON.stringify(cuerpo)).not.toContain('9900');
  });

  it('el precio sale con dos decimales y como string, no como float', async () => {
    const cuerpo = await cuerpoDe({
      tenant: TENANT,
      config: { mostrarPrecios: true },
      packs: [{ ...PACKS[0]!, precio: new Prisma.Decimal('12500.5') }],
    });

    expect(cuerpo.packs?.[0]?.precio).toBe('12500.50');
  });

  it('un pack sin precio sale con null, no se esconde', async () => {
    // "A consultar" es una respuesta valida; que el plan desaparezca de la
    // landing por no tener precio cargado, no.
    const cuerpo = await cuerpoDe({
      tenant: TENANT,
      config: { mostrarPrecios: true },
      packs: [{ ...PACKS[0]!, precio: null }],
    });

    expect(cuerpo.packs).toHaveLength(1);
    expect(cuerpo.packs?.[0]?.precio).toBeNull();
  });

  it('el pack destacado se marca, y solo ese', async () => {
    const cuerpo = await cuerpoDe({
      tenant: TENANT,
      config: { mostrarPrecios: true, planDestacadoId: 'p-1' },
      packs: [PACKS[0]!, { ...PACKS[1]!, activo: true }],
    });

    // Se mira por nombre y no por posicion: el orden lo fija el `orderBy`, y
    // lo que este caso mide es el destacado.
    expect(cuerpo.packs?.map((p) => [p.nombre, p.destacado])).toEqual(
      expect.arrayContaining([
        ['Mensual 8', true],
        ['Libre', false],
      ]),
    );
  });

  it('cada bandera manda SOBRE LO SUYO y nada mas', async () => {
    // Con las cuatro encendidas a la vez, intercambiar dos banderas en el
    // service no lo notaria nadie.
    const cuerpo = await cuerpoDe({
      tenant: TENANT,
      config: { mostrarFAQ: true },
      packs: PACKS,
      testimonios: [{ id: 'te-1', tenantId: TENANT_ID, nombre: 'Ana', texto: 'Genial', orden: 0 }],
      preguntas: [
        { id: 'pf-1', tenantId: TENANT_ID, pregunta: 'Hay duchas?', respuesta: 'Si', orden: 0 },
      ],
    });

    expect(cuerpo).toHaveProperty('preguntas');
    expect(cuerpo).not.toHaveProperty('testimonios');
    expect(cuerpo).not.toHaveProperty('packs');
    expect(cuerpo).not.toHaveProperty('turnosLibres');
  });

  it('los testimonios salen en el orden que puso el admin', async () => {
    // Tres con orden 2, 0, 1 creados en ese mismo orden: salen 0, 1, 2. Sin el
    // orderBy saldrian por orden de creacion y el test pasaria con uno de los
    // tres en su sitio.
    const cuerpo = await cuerpoDe({
      tenant: TENANT,
      config: { mostrarTestimonios: true },
      testimonios: [
        { id: 'te-c', tenantId: TENANT_ID, nombre: 'Tercera', texto: 'c', orden: 2 },
        { id: 'te-a', tenantId: TENANT_ID, nombre: 'Primera', texto: 'a', orden: 0 },
        { id: 'te-b', tenantId: TENANT_ID, nombre: 'Segunda', texto: 'b', orden: 1 },
      ],
    });

    expect(cuerpo.testimonios?.map((t) => t.nombre)).toEqual(['Primera', 'Segunda', 'Tercera']);
  });
});

describe('PublicoService: se audita por lo que NO manda', () => {
  const RUIDO = {
    tenant: TENANT,
    config: {
      mostrarPrecios: true,
      mostrarTestimonios: true,
      mostrarFAQ: true,
      mostrarTurnosLibres: true,
    },
    packs: [
      {
        id: 'pack-secreto',
        tenantId: TENANT_ID,
        salaId: 'sala-secreta',
        nombre: 'Mensual 8',
        precio: new Prisma.Decimal('8500'),
        activo: true,
      },
    ],
    testimonios: [
      { id: 'testimonio-secreto', tenantId: TENANT_ID, nombre: 'Ana', texto: 'Genial', orden: 0 },
    ],
    preguntas: [
      {
        id: 'pregunta-secreta',
        tenantId: TENANT_ID,
        pregunta: 'Hay duchas?',
        respuesta: 'Si',
        orden: 0,
      },
    ],
    turnos: [
      {
        id: 'turno-secreto',
        tenantId: TENANT_ID,
        nombre: 'Pilates',
        fecha: new Date('2026-10-06T00:00:00.000Z'),
        horaInicio: '18:00',
        cupo: 10,
        profesor: { id: 'perfil-secreto', nombre: 'Fati', email: 'fati@gym.test' },
        sala: { activa: true, visibleAlumnos: true, nombre: 'Sala Roja' },
        reservas: reservasDe(2),
      },
    ],
  } satisfies Semilla;

  it('el cuerpo no lleva ni un email, ni un id de perfil', async () => {
    // Un endpoint publico se audita por lo que NO manda. Se siembra un alumno
    // con email conocido —aqui, la profesora del turno— y se busca en el
    // cuerpo, junto con los ids de todas las filas que el endpoint toca.
    const serializado = JSON.stringify(await cuerpoDe(RUIDO));

    for (const secreto of [
      'fati@gym.test',
      'perfil-secreto',
      'Fati',
      'pack-secreto',
      'sala-secreta',
      'testimonio-secreto',
      'pregunta-secreta',
      'turno-secreto',
      TENANT_ID,
    ]) {
      expect(serializado).not.toContain(secreto);
    }
  });

  it('las claves del cuerpo son EXACTAMENTE las del contrato', async () => {
    // El contrato se audita por ausencia, y la ausencia no se comprueba
    // nombrando secretos de uno en uno: se comprueba fijando la lista entera.
    // Cualquier campo nuevo que alguien cuele en el mapeo hace caer este caso,
    // que es justo lo que tiene que pasar antes de que salga a una pagina
    // indexada.
    const cuerpo = await cuerpoDe(RUIDO);

    expect(Object.keys(cuerpo).sort()).toEqual(
      [
        'colorPrimario',
        'colorSecundario',
        'imagenPrincipalUrl',
        'instagram',
        'linkExtra',
        'nombre',
        'packs',
        'preguntas',
        'sobreElSalon',
        'tagline',
        'testimonios',
        'tituloPrincipal',
        'turnosLibres',
        'whatsapp',
      ].sort(),
    );
  });

  it('las CUATRO secciones salen con sus valores exactos, no solo con sus claves', async () => {
    // FIJAR LAS CLAVES NO PROTEGE DE UNA FUGA DENTRO DE UN VALOR LEGITIMO.
    //
    // La leccion del repaso, y por eso esta aqui y no en una sola seccion: con
    // los lugares libres metidos dentro del nombre de la clase —"Pilates (8
    // lugares libres)"— las claves siguen siendo identicas, y el caso que busca
    // las subcadenas 'cupo' y 'reservas' tampoco lo ve. Lo unico que lo atrapa
    // es comparar el objeto ENTERO contra un valor esperado escrito a mano.
    //
    // Lo mismo vale para un mapeo cruzado: `pregunta` y `respuesta` son dos
    // strings del mismo tipo, y el compilador no distingue uno del otro.
    const cuerpo = await cuerpoDe(RUIDO);

    expect(cuerpo.packs).toEqual([{ nombre: 'Mensual 8', precio: '8500.00', destacado: false }]);
    expect(cuerpo.testimonios).toEqual([{ nombre: 'Ana', texto: 'Genial' }]);
    expect(cuerpo.preguntas).toEqual([{ pregunta: 'Hay duchas?', respuesta: 'Si' }]);
    expect(cuerpo.turnosLibres).toEqual([
      {
        fecha: '2026-10-06',
        horaInicio: '18:00',
        clase: 'Pilates',
        salaNombre: 'Sala Roja',
      },
    ]);
  });

  it('no sale el cupo ni cuantos lugares quedan', async () => {
    // "Cuan vacio esta el gimnasio" es exactamente lo que el checklist pide no
    // publicar de mas: la cuenta se usa para filtrar y se descarta.
    const serializado = JSON.stringify(await cuerpoDe(RUIDO));

    expect(serializado).not.toContain('cupo');
    expect(serializado).not.toContain('reservas');
  });
});

describe('PublicoService: el runUnscoped envuelve UNA sola consulta', () => {
  it('las consultas de contenido corren CON contexto de gimnasio', async () => {
    // El runUnscoped envuelve solo la resolucion del slug. Se comprueba con un
    // doble que registra en que contexto llego cada consulta: la del tenant en
    // 'unscoped', y las de packs, testimonios, preguntas y turnos en 'tenant'.
    const { servicio, contextos } = crearServicio({
      tenant: TENANT,
      config: {
        mostrarPrecios: true,
        mostrarTestimonios: true,
        mostrarFAQ: true,
        mostrarTurnosLibres: true,
      },
    });

    await servicio.salon('studio-fuego', AHORA);

    expect(contextos).toEqual([
      { consulta: 'tenant', contexto: 'unscoped' },
      { consulta: 'config', contexto: 'tenant' },
      { consulta: 'packs', contexto: 'tenant' },
      { consulta: 'testimonios', contexto: 'tenant' },
      { consulta: 'preguntas', contexto: 'tenant' },
      { consulta: 'turnos', contexto: 'tenant' },
    ]);
  });

  it('exactamente UNA consulta corre fuera del aislamiento', async () => {
    // Dicho al reves, que es como se lee la regla: ensanchar la ventana es
    // desactivar el aislamiento para el endpoint publico entero.
    const { servicio, contextos } = crearServicio({
      tenant: TENANT,
      config: { mostrarPrecios: true },
    });

    await servicio.salon('studio-fuego', AHORA);

    expect(contextos.filter((c) => c.contexto === 'unscoped')).toHaveLength(1);
  });
});

describe('PublicoService: los turnos con lugar', () => {
  function turno(extra: Record<string, unknown>) {
    return {
      id: `tu-${String(extra.horaInicio ?? '00:00')}`,
      tenantId: TENANT_ID,
      nombre: 'Pilates',
      fecha: new Date('2026-10-06T00:00:00.000Z'),
      horaInicio: '18:00',
      cupo: 10,
      sala: { activa: true, visibleAlumnos: true, nombre: 'Sala Roja' },
      reservas: [],
      ...extra,
    };
  }

  it('un turno lleno no sale', async () => {
    const cuerpo = await cuerpoDe({
      tenant: TENANT,
      config: { mostrarTurnosLibres: true },
      turnos: [
        turno({ horaInicio: '18:00', cupo: 10, reservas: reservasDe(10) }),
        turno({ horaInicio: '19:00', cupo: 10, reservas: reservasDe(9) }),
      ],
    });

    expect(cuerpo.turnosLibres?.map((t) => t.horaInicio)).toEqual(['19:00']);
  });

  it('los de una sala apagada o no visible tampoco', async () => {
    const cuerpo = await cuerpoDe({
      tenant: TENANT,
      config: { mostrarTurnosLibres: true },
      turnos: [
        turno({ horaInicio: '08:00', sala: { activa: false, visibleAlumnos: true, nombre: 'X' } }),
        turno({ horaInicio: '09:00', sala: { activa: true, visibleAlumnos: false, nombre: 'Y' } }),
        turno({ horaInicio: '10:00' }),
      ],
    });

    expect(cuerpo.turnosLibres?.map((t) => t.horaInicio)).toEqual(['10:00']);
  });

  it('los de ayer no salen, y los de dentro de un mes tampoco', async () => {
    const cuerpo = await cuerpoDe({
      tenant: TENANT,
      config: { mostrarTurnosLibres: true },
      turnos: [
        turno({ horaInicio: '07:00', fecha: new Date('2026-10-04T00:00:00.000Z') }),
        turno({ horaInicio: '08:00', fecha: new Date('2026-10-05T00:00:00.000Z') }),
        turno({ horaInicio: '09:00', fecha: new Date('2026-11-05T00:00:00.000Z') }),
      ],
    });

    expect(cuerpo.turnosLibres?.map((t) => t.horaInicio)).toEqual(['08:00']);
  });

  it('`clase` sale de Turno.nombre y la fecha como YYYY-MM-DD', async () => {
    const cuerpo = await cuerpoDe({
      tenant: TENANT,
      config: { mostrarTurnosLibres: true },
      turnos: [turno({ nombre: 'Funcional' })],
    });

    expect(cuerpo.turnosLibres?.[0]).toEqual({
      fecha: '2026-10-06',
      horaInicio: '18:00',
      clase: 'Funcional',
      salaNombre: 'Sala Roja',
    });
  });

  /** `HH:MM` correlativos desde las 00:00, para sembrar muchos turnos ordenables. */
  function horaDe(indice: number): string {
    const hh = String(Math.floor(indice / 60)).padStart(2, '0');
    const mm = String(indice % 60).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  function turnos(cuantos: number, desde: number, extra: Record<string, unknown>) {
    return Array.from({ length: cuantos }, (_, i) =>
      turno({ horaInicio: horaDe(desde + i), ...extra }),
    );
  }

  it('SE LEEN MAS TURNOS DE LOS QUE SE PUBLICAN: cien llenos no vacian la agenda', async () => {
    // El motivo de que `TURNOS_LEIDOS` (500) y `MAXIMO_TURNOS` (100) sean dos
    // numeros y no uno, escrito como caso. El filtro de "tiene lugar" se hace
    // en memoria porque Prisma no sabe comparar una cuenta de relacion contra
    // otra columna dentro del `where`; si el pool que se lee fuera igual al
    // tope que se publica, un gimnasio cuyos primeros cien turnos esten llenos
    // publicaria una agenda VACIA teniendo lugares libres el viernes.
    //
    // Nada impide que alguien unifique los dos numeros "porque son iguales":
    // esto es lo que se lo impide.
    const cuerpo = await cuerpoDe({
      tenant: TENANT,
      config: { mostrarTurnosLibres: true },
      turnos: [
        ...turnos(100, 0, { cupo: 10, reservas: reservasDe(10) }),
        ...turnos(20, 100, { cupo: 10, reservas: [] }),
      ],
    });

    expect(cuerpo.turnosLibres).toHaveLength(20);
    expect(cuerpo.turnosLibres?.[0]?.horaInicio).toBe(horaDe(100));
  });

  it('nunca se publican mas de cien turnos, aunque haya lugar en ciento cincuenta', async () => {
    // Una landing no pagina: sin tope, un gimnasio con ocho salas mete
    // cientos de filas en una pagina publica y sin sesion. Se comprueba
    // ademas que los cien que salen son los PRIMEROS de la agenda y no cien
    // cualesquiera, que es lo util para quien mira la pagina.
    const cuerpo = await cuerpoDe({
      tenant: TENANT,
      config: { mostrarTurnosLibres: true },
      turnos: turnos(150, 0, { cupo: 10, reservas: [] }),
    });

    expect(cuerpo.turnosLibres).toHaveLength(100);
    expect(cuerpo.turnosLibres?.[0]?.horaInicio).toBe(horaDe(0));
    expect(cuerpo.turnosLibres?.[99]?.horaInicio).toBe(horaDe(99));
  });
});
