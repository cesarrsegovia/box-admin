import { BadRequestException, NotFoundException } from '@nestjs/common';
import { runWithTenant } from '../common/tenant/tenant-context';
import { aplicarScopeDeTenant } from '../common/tenant/tenant-scoped.extension';
import { cifrar, claveDesdeHex } from './cifrado';
import { ConfigEmailService, motivoSeguro } from './config-email.service';

const ACTOR = { sub: 'admin-1', tenantId: 't1', rol: 'ADMIN_SALON' } as never;
const HEX = 'a'.repeat(64);
const CLAVE = claveDesdeHex(HEX);
const AHORA = new Date('2026-09-22T00:00:00.000Z');

const ALTA = {
  host: 'smtp.test',
  puerto: 587,
  usuario: 'u',
  clave: 'la-secreta',
  emailOrigen: 'gym@test.io',
} as never;

/**
 * El doble de la base guarda estado en vez de devolver siempre lo mismo:
 * `guardarSmtp` escribe y despues relee con `verSmtp`, asi que un `findFirst`
 * que devolviera `null` fijo haria fallar el guardado con un 404 que no tiene
 * nada que ver con lo que el test mide.
 */
function crearServicio(estado: { config?: Record<string, unknown> | null } = {}) {
  let fila = estado.config ?? null;
  const plantillas: Record<string, unknown>[] = [];

  const db = {
    configuracionSMTP: {
      findFirst: jest.fn().mockImplementation(() => Promise.resolve(fila)),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        fila = { ...data, updatedAt: AHORA };
        return Promise.resolve(fila);
      }),
      update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        fila = { ...(fila ?? {}), ...data, updatedAt: AHORA };
        return Promise.resolve(fila);
      }),
    },
    plantillaEmail: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: { where: { tipo: string } }) =>
          Promise.resolve(plantillas.find((p) => p.tipo === where.tipo) ?? null),
        ),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        const creada = { id: `pl-${plantillas.length}`, ...data };
        plantillas.push(creada);
        return Promise.resolve(creada);
      }),
      update: jest
        .fn()
        .mockImplementation(
          ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
            const fila = plantillas.find((p) => p.id === where.id);
            if (fila === undefined) return Promise.resolve(null);
            Object.assign(fila, data);
            return Promise.resolve(fila);
          },
        ),
    },
    $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(db)),
  };
  const envios = { enviar: jest.fn(), verificar: jest.fn().mockResolvedValue(undefined) };
  const historial = { registrar: jest.fn().mockResolvedValue(undefined) };
  const config = { get: jest.fn().mockReturnValue(HEX) };

  return {
    servicio: new ConfigEmailService(
      { db } as never,
      historial as never,
      envios as never,
      config as never,
    ),
    db,
    envios,
    historial,
    plantillas,
  };
}

describe('ConfigEmailService.guardarSmtp', () => {
  it('guarda la clave CIFRADA, nunca en claro', async () => {
    const { servicio, db } = crearServicio();

    await servicio.guardarSmtp(ACTOR, ALTA);

    const guardado = db.configuracionSMTP.create.mock.calls[0]![0].data.claveCifrada as string;
    expect(guardado).not.toContain('la-secreta');
    expect(guardado.startsWith('v1:')).toBe(true);
  });

  it('verifica la conexion ANTES de guardar', async () => {
    const { servicio, db, envios } = crearServicio();
    envios.verificar.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(servicio.guardarSmtp(ACTOR, ALTA)).rejects.toThrow(BadRequestException);
    // Lo importante: no se guardo nada.
    expect(db.configuracionSMTP.create).not.toHaveBeenCalled();
    expect(db.configuracionSMTP.update).not.toHaveBeenCalled();
  });

  it('el error de conexion llega con el motivo', async () => {
    const { servicio, envios } = crearServicio();
    envios.verificar.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(servicio.guardarSmtp(ACTOR, ALTA)).rejects.toThrow(/ECONNREFUSED/);
  });

  it('actualiza la fila existente en vez de crear una segunda', async () => {
    const { servicio, db } = crearServicio({
      config: {
        tenantId: 't1',
        host: 'viejo.test',
        puerto: 465,
        seguro: true,
        usuario: 'viejo',
        claveCifrada: cifrar('vieja', CLAVE),
        emailOrigen: 'viejo@test.io',
        emailDestino: null,
        updatedAt: AHORA,
      },
    });

    await servicio.guardarSmtp(ACTOR, ALTA);

    expect(db.configuracionSMTP.create).not.toHaveBeenCalled();
    expect(db.configuracionSMTP.update).toHaveBeenCalledTimes(1);
    // El `data` de un update NUNCA puede llevar tenantId: la extension lo lee
    // como un intento de mover la fila a otro gimnasio y lanza.
    expect(db.configuracionSMTP.update.mock.calls[0]![0].data).not.toHaveProperty('tenantId');
  });

  it('el detalle del historial lleva host y usuario, jamas la clave', async () => {
    const { servicio, historial } = crearServicio();

    await servicio.guardarSmtp(ACTOR, ALTA);

    const entrada = historial.registrar.mock.calls[0]![0];
    expect(entrada.detalle).toEqual({ host: 'smtp.test', usuario: 'u' });
    expect(JSON.stringify(entrada)).not.toContain('la-secreta');
    expect(JSON.stringify(entrada)).not.toContain('v1:');
  });

  it('lo que devuelve tras guardar tampoco lleva la clave', async () => {
    const { servicio } = crearServicio();

    const publica = await servicio.guardarSmtp(ACTOR, ALTA);

    expect(JSON.stringify(publica)).not.toContain('la-secreta');
    expect(JSON.stringify(publica)).not.toContain('v1:');
    expect(publica.tieneClave).toBe(true);
  });
});

/**
 * La cuarta puerta por la que la credencial podia escaparse, y la menos obvia:
 * el motivo del 400. `verify()` de nodemailer arma el EAUTH como
 * `Invalid login: <respuesta literal del servidor>`, y un servidor que
 * reimprime la linea que recibio devuelve el base64 de la contrasena.
 *
 * El test viejo ('el error de conexion llega con el motivo') solo comprobaba
 * que el motivo LLEGA. Estos comprueban lo otro: que llega sin la clave. Los
 * tres primeros rompen si se quita el saneado.
 */
describe('ConfigEmailService.guardarSmtp: el motivo del 400 no puede llevar la clave', () => {
  const CLAVE_EN_CLARO = 'la-secreta';
  const USUARIO = 'u';
  const b64 = (claro: string): string => Buffer.from(claro, 'utf8').toString('base64');

  async function motivoDe(mensaje: string, code?: string): Promise<string> {
    const { servicio, envios } = crearServicio();
    const fallo = new Error(mensaje) as Error & { code?: string };
    if (code !== undefined) fallo.code = code;
    envios.verificar.mockRejectedValue(fallo);

    try {
      await servicio.guardarSmtp(ACTOR, ALTA);
    } catch (error) {
      return (error as Error).message;
    }
    throw new Error('guardarSmtp tenia que haber lanzado');
  }

  it('la clave EN CLARO dentro del mensaje del servidor no sale en el 400', async () => {
    const motivo = await motivoDe(`Invalid login: 535 5.7.8 rechazado para ${CLAVE_EN_CLARO}`);

    expect(motivo).not.toContain(CLAVE_EN_CLARO);
  });

  it('el base64 de la clave sola (AUTH LOGIN) no sale en el 400', async () => {
    const eco = b64(CLAVE_EN_CLARO);
    const motivo = await motivoDe(`Invalid login: 500 5.5.2 Error: command not recognized: ${eco}`);

    expect(motivo).not.toContain(eco);
    // Y lo que importa de verdad: que de lo que queda no se pueda sacar la
    // clave descodificando.
    expect(Buffer.from(motivo, 'base64').toString('utf8')).not.toContain(CLAVE_EN_CLARO);
  });

  it('el base64 de AUTH PLAIN (\\0usuario\\0clave) no sale en el 400', async () => {
    const eco = b64(`\0${USUARIO}\0${CLAVE_EN_CLARO}`);
    const motivo = await motivoDe(`Invalid login: 535 5.7.8 rechazado: AUTH PLAIN ${eco}`);

    expect(motivo).not.toContain(eco);
    expect(Buffer.from(motivo, 'base64').toString('utf8')).not.toContain(CLAVE_EN_CLARO);
  });

  it('sanear no convierte el motivo en "hubo un error": ECONNREFUSED sigue llegando', async () => {
    await expect(motivoDe('connect ECONNREFUSED 127.0.0.1:587')).resolves.toMatch(/ECONNREFUSED/);
    await expect(motivoDe('lo que sea', 'ECONNREFUSED')).resolves.toMatch(/ECONNREFUSED/);
    await expect(motivoDe('lo que sea', 'ETIMEDOUT')).resolves.toMatch(/ETIMEDOUT/);
  });

  it('el code gana al mensaje, que es el caso real de nodemailer', async () => {
    const motivo = await motivoDe(`Invalid login: ${b64(CLAVE_EN_CLARO)}`, 'EAUTH');

    expect(motivo).toContain('EAUTH');
    expect(motivo).not.toContain(b64(CLAVE_EN_CLARO));
  });
});

describe('motivoSeguro: la red de seguridad', () => {
  it('redacta cualquier token que parezca base64 largo, no solo los conocidos', () => {
    // Ni es la clave ni ninguna de sus codificaciones: es la forma lo que lo
    // condena. Es el caso que no supimos imaginar.
    const desconocido = 'Zm9ybWF0b1F1ZU5vSW1hZ2luYW1vcw==';

    const motivo = motivoSeguro(new Error(`raro: ${desconocido}`), 'otra-clave', 'otro-usuario');

    expect(motivo).not.toContain(desconocido);
    expect(motivo).toContain('raro:');
  });

  it('el base64 sin relleno tambien, que no todo el mundo conserva los "="', () => {
    const clave = 'contrasena-larguisima-del-gimnasio';
    const sinRelleno = Buffer.from(clave, 'utf8').toString('base64').replace(/=+$/, '');

    const motivo = motivoSeguro(new Error(`eco: ${sinRelleno}`), clave, 'admin@gym.io');

    expect(motivo).not.toContain(sinRelleno);
  });
});

/**
 * El agujero que encontro el repaso de seguridad: `borrar` es exacto y contiguo
 * y `PARECE_BASE64` exige un run contiguo de dieciseis, asi que UN solo caracter
 * fuera de esas clases metido en el medio del secreto lo parte en dos trozos que
 * no agarra ninguna de las dos defensas.
 *
 * Y no es un caso de laboratorio: nodemailer@10.0.10 une las lineas de
 * continuacion de una respuesta SMTP multilinea con un '\n' literal
 * (dist/cjs/smtp-connection/index.js:747) y ese texto va tal cual a
 * `err.message`. Un 535 contestado en varias lineas por un servidor que ecoa lo
 * que recibio produce exactamente esto.
 */
describe('motivoSeguro: el secreto partido en trozos', () => {
  // Treinta caracteres partidos 15/15: cada mitad se queda POR DEBAJO del
  // umbral de dieciseis de PARECE_BASE64, que es lo que hace al caso peligroso.
  const MITAD_A = 'Kx7mQp2vLw9dTr4';
  const MITAD_B = 'Hn6sZb1cYj8fGu3';
  const CLAVE_LARGA = `${MITAD_A}${MITAD_B}`;
  const USUARIO = 'u';
  const b64 = (claro: string): string => Buffer.from(claro, 'utf8').toString('base64');

  it('una clave partida por un salto de linea tampoco sale', () => {
    const motivo = motivoSeguro(
      new Error(`550 detalle: ${MITAD_A}\n${MITAD_B}`),
      CLAVE_LARGA,
      USUARIO,
    );

    expect(motivo).not.toContain(MITAD_A);
    expect(motivo).not.toContain(MITAD_B);
    // Y la clave reconstruida quitandole el salto: es asi como se recupera.
    expect(motivo.replace(/\n/g, '')).not.toContain(CLAVE_LARGA);
    // Exacto, no solo "no contiene": el tramo se borra del primer caracter al
    // ultimo INCLUSIVE, y un off-by-one dejaria suelto el ultimo del secreto.
    expect(motivo).toBe('550 detalle: [redactado]');
  });

  it('una clave partida por un guion tampoco sale', () => {
    const motivo = motivoSeguro(
      new Error(`550 detalle: ${MITAD_A}-${MITAD_B}`),
      CLAVE_LARGA,
      USUARIO,
    );

    expect(motivo).not.toContain(MITAD_A);
    expect(motivo).not.toContain(MITAD_B);
    expect(motivo.replace(/-/g, '')).not.toContain(CLAVE_LARGA);
    expect(motivo).toBe('550 detalle: [redactado]');
  });

  it('el base64 de la clave partido por un salto de linea tampoco sale', () => {
    // En trozos de catorce y no en dos mitades de veinte a proposito: con veinte
    // los agarraria PARECE_BASE64 por si solo y el test no probaria nada.
    const trozos = b64(CLAVE_LARGA).match(/.{1,14}/g) as string[];
    const eco = trozos.join('\n');

    const motivo = motivoSeguro(new Error(`550 detalle: ${eco}`), CLAVE_LARGA, USUARIO);

    for (const trozo of trozos) expect(motivo).not.toContain(trozo);
    expect(Buffer.from(motivo.replace(/\n/g, ''), 'base64').toString('utf8')).not.toContain(
      CLAVE_LARGA,
    );
    expect(motivo).toBe('550 detalle: [redactado]');
  });

  it('una clave con enie devuelta en NFD se redacta igual', () => {
    // Identica a la vista, distintos code points: la 'n~' descompuesta no
    // coincide con ninguna aguja y sus caracteres tampoco entran en la clase de
    // PARECE_BASE64. Lo que las hace coincidir es normalizar los dos lados.
    const clave = 'nina-secreta-2026'.replace('nina', 'niña');
    const eco = clave.normalize('NFD');

    const motivo = motivoSeguro(new Error(`535 5.7.8 rechazado para ${eco}`), clave, USUARIO);

    expect(motivo).not.toContain(clave);
    expect(motivo.normalize('NFC')).not.toContain(clave.normalize('NFC'));
    expect(motivo.normalize('NFD')).not.toContain(clave.normalize('NFD'));
    expect(motivo).toBe('535 5.7.8 rechazado para [redactado]');
  });

  it('el base64url de la clave se redacta', () => {
    // '-' y '_' no estan en PARECE_BASE64, y a proposito: meterlos ahi
    // redactaria palabras normales con guion bajo. Lo que lo cubre es el
    // aplanado, que tira '+', '/', '=', '-' y '_' de los DOS lados, asi que el
    // base64 estandar y el base64url del mismo secreto aplanan al mismo string.
    const clave = 'gym>secreta>2026';
    const url = b64(clave).replace(/\+/g, '-').replace(/\//g, '_');

    const motivo = motivoSeguro(new Error(`550 detalle: ${url}`), clave, USUARIO);

    expect(motivo).not.toContain(url);
    expect(
      Buffer.from(motivo.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    ).not.toContain(clave);
  });
});

describe('motivoSeguro: la entrada, que viene de un catch y puede ser cualquier cosa', () => {
  const CLAVE_EN_CLARO = 'la-secreta';
  const USUARIO = 'u';

  it('un code que no tiene forma de code no se devuelve', () => {
    // Lo que se valida es la FORMA, no el tipo: devolver cualquier string tal
    // cual era el bypass entero el dia que el `code` deje de venir de
    // nodemailer (un wrapper, un reintento, otro adaptador).
    const motivo = motivoSeguro(
      { code: `EAUTH: clave=${CLAVE_EN_CLARO}`, message: '535 rechazado' },
      CLAVE_EN_CLARO,
      USUARIO,
    );

    expect(motivo).not.toContain(CLAVE_EN_CLARO);
    expect(motivo).toContain('rechazado');
  });

  it('un code legitimo se sigue devolviendo tal cual', () => {
    expect(
      motivoSeguro({ code: 'ECONNREFUSED', message: 'lo que sea' }, CLAVE_EN_CLARO, USUARIO),
    ).toBe('ECONNREFUSED');
  });

  it('un error null no lanza', () => {
    // Antes reventaba con un TypeError leyendo `.code` de null y el 400
    // esperado se convertia en un 500 sin control.
    expect(() => motivoSeguro(null, CLAVE_EN_CLARO, USUARIO)).not.toThrow();
    expect(motivoSeguro(null, CLAVE_EN_CLARO, USUARIO)).toBe('null');
    expect(() => motivoSeguro(undefined, CLAVE_EN_CLARO, USUARIO)).not.toThrow();
    expect(() => motivoSeguro('se cayo y ya', CLAVE_EN_CLARO, USUARIO)).not.toThrow();
  });

  it('el motivo sigue siendo util: lo legitimo llega sin una sola redaccion', () => {
    // Este test es el que impide que el saneado se pase de celoso. Si algun dia
    // falla, el arreglo esta rompiendo el motivo que el admin necesita leer.
    const utiles = [
      'ECONNREFUSED',
      'Invalid greeting. response=553 mailserver rechaza conexiones anonimas',
      '535 5.7.8 Error: authentication failed',
    ];

    for (const mensaje of utiles) {
      expect(motivoSeguro(new Error(mensaje), CLAVE_EN_CLARO, USUARIO)).toBe(mensaje);
    }

    // Y con una clave CORTA con separador, que es justo lo que protege el
    // umbral del paso fragmentado: 'ai-l' aplana a 'ail', que esta dentro de
    // 'failed'. Sin umbral, este mensaje saldria mutilado por casualidad.
    expect(motivoSeguro(new Error('535 5.7.8 Error: authentication failed'), 'ai-l', USUARIO)).toBe(
      '535 5.7.8 Error: authentication failed',
    );
  });
});

describe('ConfigEmailService.verSmtp', () => {
  it('NO devuelve la contrasena, ni cifrada', async () => {
    const { servicio } = crearServicio({
      config: {
        tenantId: 't1',
        host: 'smtp.test',
        puerto: 587,
        seguro: true,
        usuario: 'u',
        claveCifrada: cifrar('la-secreta', CLAVE),
        emailOrigen: 'gym@test.io',
        emailDestino: null,
        updatedAt: new Date(),
      },
    });

    const publica = await servicio.verSmtp();

    expect(JSON.stringify(publica)).not.toContain('la-secreta');
    expect(JSON.stringify(publica)).not.toContain('v1:');
    expect(publica.tieneClave).toBe(true);
  });

  it('404 si el gimnasio no configuro nada', async () => {
    const { servicio } = crearServicio({ config: null });

    await expect(servicio.verSmtp()).rejects.toThrow(NotFoundException);
  });
});

describe('ConfigEmailService.datosDeEnvio', () => {
  it('descifra la clave para los processors', async () => {
    const { servicio } = crearServicio({
      config: {
        tenantId: 't1',
        host: 'smtp.test',
        puerto: 587,
        seguro: false,
        usuario: 'u',
        claveCifrada: cifrar('la-secreta', CLAVE),
        emailOrigen: 'gym@test.io',
        emailDestino: 'copia@test.io',
        updatedAt: AHORA,
      },
    });

    const datos = await servicio.datosDeEnvio();

    expect(datos!.smtp.clave).toBe('la-secreta');
    expect(datos!.copia).toBe('copia@test.io');
  });

  it('null si el gimnasio no configuro SMTP: no se manda nada', async () => {
    const { servicio } = crearServicio({ config: null });

    await expect(servicio.datosDeEnvio()).resolves.toBeNull();
  });
});

describe('ConfigEmailService.listarPlantillas', () => {
  it('devuelve las cinco, marcando cuales son del codigo', async () => {
    const { servicio, db } = crearServicio();
    db.plantillaEmail.findMany.mockResolvedValue([
      { tipo: 'CONFIRMACION', asunto: 'Mia', cuerpoHtml: '<p>mia</p>' },
    ]);

    const todas = await servicio.listarPlantillas();

    expect(todas).toHaveLength(5);
    expect(todas.find((p) => p.tipo === 'CONFIRMACION')).toMatchObject({
      asunto: 'Mia',
      esPorDefecto: false,
    });
    expect(todas.find((p) => p.tipo === 'CANCELACION')!.esPorDefecto).toBe(true);
  });
});

describe('ConfigEmailService.guardarPlantilla', () => {
  it('crea la fila la primera vez', async () => {
    const { servicio, db } = crearServicio();

    await servicio.guardarPlantilla(ACTOR, 'CANCELACION', {
      asunto: 'Nuevo',
      cuerpoHtml: '<p>x</p>',
    });

    expect(db.plantillaEmail.create).toHaveBeenCalledTimes(1);
    expect(db.plantillaEmail.update).not.toHaveBeenCalled();
  });

  it('la segunda vez actualiza la que ya existe', async () => {
    const { servicio, db } = crearServicio();

    await servicio.guardarPlantilla(ACTOR, 'CANCELACION', {
      asunto: 'Nuevo',
      cuerpoHtml: '<p>x</p>',
    });
    await servicio.guardarPlantilla(ACTOR, 'CANCELACION', {
      asunto: 'Otro',
      cuerpoHtml: '<p>y</p>',
    });

    expect(db.plantillaEmail.create).toHaveBeenCalledTimes(1);
    expect(db.plantillaEmail.update).toHaveBeenCalledTimes(1);
    expect(db.plantillaEmail.update.mock.calls[0]![0].data).not.toHaveProperty('tenantId');
  });

  it('rechaza una plantilla mal formada ANTES de guardarla', async () => {
    const { servicio, db } = crearServicio();

    // Sin esta validacion la fila se guarda sin chistar y revienta recien al
    // renderizar, o sea dentro del processor, o sea en bucle porque los jobs se
    // reintentan. Mismo criterio que 'verifica la conexion ANTES de guardar'.
    //
    // MUTACION QUE TIENE QUE ROMPER ESTE TEST: quitar la comprobacion de
    // `motivoDePlantillaInvalida` de `guardarPlantilla`.
    await expect(
      servicio.guardarPlantilla(ACTOR, 'CANCELACION', {
        asunto: 'Nuevo',
        cuerpoHtml: '<p>{{#if alumno}}sin cerrar</p>',
      } as never),
    ).rejects.toThrow(BadRequestException);

    // Lo importante: no se guardo nada.
    expect(db.plantillaEmail.create).not.toHaveBeenCalled();
    expect(db.plantillaEmail.update).not.toHaveBeenCalled();
  });

  it('tambien mira el asunto, no solo el cuerpo', async () => {
    const { servicio, db } = crearServicio();

    await expect(
      servicio.guardarPlantilla(ACTOR, 'CANCELACION', {
        asunto: 'Hola {{alumno',
        cuerpoHtml: '<p>x</p>',
      } as never),
    ).rejects.toThrow(BadRequestException);

    expect(db.plantillaEmail.create).not.toHaveBeenCalled();
  });

  it('el 400 lleva el motivo de Handlebars, para que el admin pueda corregirlo', async () => {
    const { servicio } = crearServicio();

    await expect(
      servicio.guardarPlantilla(ACTOR, 'CANCELACION', {
        asunto: 'Hola {{alumno',
        cuerpoHtml: '<p>x</p>',
      } as never),
    ).rejects.toThrow(/Parse error/);
  });
});

/**
 * Este bloque no prueba el servicio: fija la RAZON por la que su codigo es un
 * `findFirst` seguido de `create` o `update` y no el `upsert` de una sola
 * llamada que pediria el cuerpo. El dia que alguien lo "simplifique", esto
 * falla y explica por que.
 */
describe('por que aqui no hay upsert', () => {
  it('la extension de aislamiento bloquea upsert sobre los dos modelos', () => {
    runWithTenant('t1', () => {
      expect(() =>
        aplicarScopeDeTenant('ConfiguracionSMTP', 'upsert', { where: { tenantId: 't1' } }),
      ).toThrow(/no admite el filtro de tenant/);

      expect(() =>
        aplicarScopeDeTenant('PlantillaEmail', 'upsert', {
          where: { tenantId_tipo: { tenantId: 't1', tipo: 'CONFIRMACION' } },
        }),
      ).toThrow(/no admite el filtro de tenant/);
    });
  });
});
