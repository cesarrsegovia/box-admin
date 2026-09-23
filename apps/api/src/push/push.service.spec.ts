import { BadRequestException, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { ResultadoPush } from '../comunicacion/envios.interface';
import { PushService } from './push.service';

const ANA = { sub: 'u-ana', tenantId: 't1', rol: 'ALUMNO' } as never;
const BETO = { sub: 'u-beto', tenantId: 't1', rol: 'ALUMNO' } as never;

const MENSAJE = { titulo: 'Tu clase', cuerpo: 'Empieza en una hora', url: '/mi-calendario' };

interface FilaSuscripcion {
  id: string;
  tenantId: string;
  perfilId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Las filas de partida: Ana con dos dispositivos y Beto con uno. Beto no esta
 * de decoracion — esta para que un doble que ignorase el filtro por `perfilId`
 * se delatara mandandole o borrandole a el lo que era de Ana.
 */
function filasPorDefecto(): FilaSuscripcion[] {
  return [
    {
      id: 's1',
      tenantId: 't1',
      perfilId: 'p-ana',
      endpoint: 'https://push/ana-movil',
      p256dh: 'k1',
      auth: 'a1',
    },
    {
      id: 's2',
      tenantId: 't1',
      perfilId: 'p-ana',
      endpoint: 'https://push/ana-pc',
      p256dh: 'k2',
      auth: 'a2',
    },
    {
      id: 's3',
      tenantId: 't1',
      perfilId: 'p-beto',
      endpoint: 'https://push/beto-movil',
      p256dh: 'k3',
      auth: 'a3',
    },
  ];
}

/**
 * El doble de la base FILTRA de verdad, no devuelve siempre la tabla entera.
 * Es la diferencia entre probar el aislamiento y escenificarlo: con un
 * `findMany` que ignorase el `where`, borrar el filtro por `perfilId` del
 * servicio dejaria estos tests igual de verdes.
 */
function coincide(fila: FilaSuscripcion, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(
    ([campo, valor]) => fila[campo as keyof FilaSuscripcion] === valor,
  );
}

function crearServicio(
  opciones: {
    habilitado?: boolean;
    filas?: FilaSuscripcion[];
    resultado?: (endpoint: string) => ResultadoPush;
  } = {},
) {
  const habilitado = opciones.habilitado ?? true;
  const filas = opciones.filas ?? filasPorDefecto();
  const resultado = opciones.resultado ?? ((): ResultadoPush => 'ENVIADO');

  // El perfil se busca por `usuarioId` en vez de darse por supuesto: si el
  // servicio dejara de resolverlo, el doble devolveria null y se notaria.
  const perfilesPorUsuario: Record<string, string> = { 'u-ana': 'p-ana', 'u-beto': 'p-beto' };

  // Monotono a proposito: con `filas.length` un create que sigue a un
  // deleteMany reutilizaria un id ya vivo y el doble mentiria.
  let siguienteId = filas.length;

  const db = {
    perfil: {
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: { where: { usuarioId: string } }) =>
          Promise.resolve(
            perfilesPorUsuario[where.usuarioId] === undefined
              ? null
              : { id: perfilesPorUsuario[where.usuarioId] },
          ),
        ),
    },
    suscripcionPush: {
      findMany: jest
        .fn()
        .mockImplementation(({ where }: { where: Record<string, unknown> }) =>
          Promise.resolve(filas.filter((f) => coincide(f, where))),
        ),
      create: jest.fn().mockImplementation(({ data }: { data: Omit<FilaSuscripcion, 'id'> }) => {
        siguienteId += 1;
        const creada = { id: `s${siguienteId}`, ...data };
        filas.push(creada);
        return Promise.resolve(creada);
      }),
      deleteMany: jest.fn().mockImplementation(({ where }: { where: Record<string, unknown> }) => {
        const condenadas = filas.filter((f) => coincide(f, where));
        for (const fila of condenadas) filas.splice(filas.indexOf(fila), 1);
        return Promise.resolve({ count: condenadas.length });
      }),
    },
    // El doble ejecuta el callback contra si mismo, como el de auto-registro:
    // aqui no se prueba el aislamiento de la transaccion, sino que el borrado y
    // la creacion de `suscribir` van dentro de una.
    $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(db)),
  };

  const envios = {
    habilitado,
    enviar: jest
      .fn()
      .mockImplementation(({ endpoint }: { endpoint: string }) =>
        Promise.resolve(resultado(endpoint)),
      ),
  };

  return { servicio: new PushService({ db } as never, envios), db, envios, filas };
}

/** Los endpoints que quedan vivos, para leer las aserciones de un vistazo. */
const endpointsDe = (filas: FilaSuscripcion[], perfilId: string): string[] =>
  filas.filter((f) => f.perfilId === perfilId).map((f) => f.endpoint);

describe('PushService.suscribir', () => {
  it('sin VAPID responde 503, no 400: el cliente no manda nada mal', async () => {
    const { servicio, db } = crearServicio({ habilitado: false });

    await expect(
      servicio.suscribir(ANA, { endpoint: 'https://push/nuevo', p256dh: 'k', auth: 'a' }),
    ).rejects.toThrow(ServiceUnavailableException);
    // Y no llega a tocar la base: el despliegue no tiene la capacidad, no es
    // que el guardado falle a medias.
    expect(db.suscripcionPush.create).not.toHaveBeenCalled();
  });

  it('suscribirse dos veces con el mismo endpoint no duplica', async () => {
    const { servicio, filas } = crearServicio();
    const dto = { endpoint: 'https://push/ana-tablet', p256dh: 'k9', auth: 'a9' };

    await servicio.suscribir(ANA, dto);
    await servicio.suscribir(ANA, dto);

    // El segundo intento es el mismo navegador resuscribiendose, no un
    // dispositivo nuevo: borrar-y-crear es idempotente.
    expect(filas.filter((f) => f.endpoint === dto.endpoint)).toHaveLength(1);
    expect(endpointsDe(filas, 'p-ana')).toHaveLength(3);
  });

  it('el endpoint de otro alumno se le quita: un navegador es de quien se suscribio ultimo', async () => {
    const { servicio, filas } = crearServicio();

    // Ana se suscribio en el navegador del gimnasio, cerro sesion, y ahora
    // entra Beto. Sin el borrado previo el dispositivo recibiria las dos.
    await servicio.suscribir(BETO, {
      endpoint: 'https://push/ana-movil',
      p256dh: 'k9',
      auth: 'a9',
    });

    const conEseEndpoint = filas.filter((f) => f.endpoint === 'https://push/ana-movil');
    expect(conEseEndpoint).toHaveLength(1);
    expect(conEseEndpoint[0]!.perfilId).toBe('p-beto');
    expect(endpointsDe(filas, 'p-ana')).toEqual(['https://push/ana-pc']);
  });

  it('pero no toca los endpoints DISTINTOS de otros alumnos', async () => {
    const { servicio, filas } = crearServicio();

    await servicio.suscribir(BETO, {
      endpoint: 'https://push/beto-tablet',
      p256dh: 'k9',
      auth: 'a9',
    });

    // El arreglo borra filas ajenas, asi que hay que acotar cuanto: solo las
    // que comparten el mismo navegador.
    expect(endpointsDe(filas, 'p-ana')).toEqual(['https://push/ana-movil', 'https://push/ana-pc']);
    expect(endpointsDe(filas, 'p-beto')).toEqual([
      'https://push/beto-movil',
      'https://push/beto-tablet',
    ]);
  });

  it('el borrado y la creacion son atomicos', async () => {
    const { servicio, db } = crearServicio();

    await servicio.suscribir(BETO, { endpoint: 'https://push/nuevo', p256dh: 'k', auth: 'a' });

    // Lo que mide es ATOMICIDAD ANTE FALLO: que no quede la fila vieja borrada
    // sin la nueva creada, porque eso deja al navegador sin push y en silencio.
    // NO mide la carrera de dos suscripciones simultaneas: el $transaction no
    // la cierra (ver el comentario largo del servicio).
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe('PushService.desuscribir', () => {
  it('sin endpoint borra todas las de ese alumno, y solo las suyas', async () => {
    const { servicio, db, filas } = crearServicio();

    await servicio.desuscribir(ANA, undefined);

    // Sin `endpoint` en el `where`: quien pulsa "desactivar" no sabe que su
    // navegador tiene una suscripcion por dispositivo.
    expect(db.suscripcionPush.deleteMany.mock.calls[0]![0].where).not.toHaveProperty('endpoint');
    expect(endpointsDe(filas, 'p-ana')).toEqual([]);
    // Lo que de verdad mide este test: las de Beto siguen ahi.
    expect(endpointsDe(filas, 'p-beto')).toEqual(['https://push/beto-movil']);
  });

  it('un alumno no puede desuscribir a otro pasando su endpoint', async () => {
    const { servicio, filas } = crearServicio();

    await servicio.desuscribir(BETO, 'https://push/ana-movil');

    // El perfilId del `where` sale de `perfilDelActor`, no del query string, asi
    // que Beto solo borra lo suyo — y no tiene nada con ese endpoint.
    expect(endpointsDe(filas, 'p-ana')).toEqual(['https://push/ana-movil', 'https://push/ana-pc']);
    expect(endpointsDe(filas, 'p-beto')).toEqual(['https://push/beto-movil']);
  });

  it('un endpoint presente pero vacio es 400, no "borralas todas"', async () => {
    const { servicio, db, filas } = crearServicio();

    // `?endpoint=` y `?endpoint=%20`: la cadena vacia es falsy, asi que sin el
    // 400 caeria en la rama de "todas" y borraria de mas.
    await expect(servicio.desuscribir(ANA, '')).rejects.toThrow(BadRequestException);
    await expect(servicio.desuscribir(ANA, '   ')).rejects.toThrow(BadRequestException);
    expect(db.suscripcionPush.deleteMany).not.toHaveBeenCalled();
    expect(endpointsDe(filas, 'p-ana')).toHaveLength(2);
  });
});

describe('PushService.notificar', () => {
  it('manda a los dos dispositivos del alumno, y a ninguno de otro', async () => {
    const { servicio, db, envios } = crearServicio();

    const enviados = await servicio.notificar(db as never, 'p-ana', MENSAJE);

    expect(enviados).toBe(2);
    expect(envios.enviar.mock.calls.map((c) => (c[0] as { endpoint: string }).endpoint)).toEqual([
      'https://push/ana-movil',
      'https://push/ana-pc',
    ]);
  });

  it('una suscripcion CADUCADA se borra sola', async () => {
    const { servicio, db, filas } = crearServicio({
      resultado: (endpoint) => (endpoint === 'https://push/ana-pc' ? 'CADUCADA' : 'ENVIADO'),
    });

    const enviados = await servicio.notificar(db as never, 'p-ana', MENSAJE);

    // 404 o 410: ese navegador ya no tiene la suscripcion. Sin borrarla, la
    // tabla se llena de endpoints muertos a los que se reintenta cada dia.
    expect(enviados).toBe(1);
    expect(db.suscripcionPush.deleteMany).toHaveBeenCalledTimes(1);
    expect(db.suscripcionPush.deleteMany.mock.calls[0]![0].where).toEqual({ id: 's2' });
    expect(endpointsDe(filas, 'p-ana')).toEqual(['https://push/ana-movil']);
  });

  it('sin VAPID no manda nada y NO lanza: el email del mismo job tiene que salir', async () => {
    const { servicio, db, envios } = crearServicio({ habilitado: false });

    await expect(servicio.notificar(db as never, 'p-ana', MENSAJE)).resolves.toBe(0);
    expect(envios.enviar).not.toHaveBeenCalled();
    expect(db.suscripcionPush.findMany).not.toHaveBeenCalled();
  });

  /**
   * La promesa de "nunca lanza" tiene que cumplirla `notificar`, no el
   * adaptador de rebote: el processor que la llama manda tambien el email, y
   * una base caida no puede llevarse por delante ese email.
   */
  describe('nunca lanza, y lo garantiza ella misma', () => {
    // El Logger escupiria el warn en la salida de Jest y ensuciaria la suite
    // entera; lo que se comprueba es el valor devuelto, no el log.
    beforeEach(() => jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined));
    afterEach(() => jest.restoreAllMocks());

    it('si la base falla al leer las suscripciones, resuelve en 0', async () => {
      const { servicio, db } = crearServicio();
      db.suscripcionPush.findMany.mockRejectedValue(new Error('Connection terminated'));

      await expect(servicio.notificar(db as never, 'p-ana', MENSAJE)).resolves.toBe(0);
    });

    it('si falla el envio a un dispositivo, los demas siguen recibiendo', async () => {
      const { servicio, db, envios } = crearServicio();
      envios.enviar.mockRejectedValueOnce(new Error('ETIMEDOUT'));

      // El primero revienta, el segundo sale: por eso el try va dentro del
      // bucle y no envolviendolo.
      await expect(servicio.notificar(db as never, 'p-ana', MENSAJE)).resolves.toBe(1);
      expect(envios.enviar).toHaveBeenCalledTimes(2);
    });

    it('si falla el borrado de una caducada, tampoco propaga', async () => {
      const { servicio, db } = crearServicio({ resultado: () => 'CADUCADA' });
      db.suscripcionPush.deleteMany.mockRejectedValue(new Error('Connection terminated'));

      await expect(servicio.notificar(db as never, 'p-ana', MENSAJE)).resolves.toBe(0);
    });
  });
});
