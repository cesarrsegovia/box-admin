import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import * as qrcode from 'qrcode';
import {
  CONFIG_CHECKIN_POR_DEFECTO,
  ConfigCheckInService,
  urlDeCheckIn,
} from './config-checkin.service';
import { firmarTenant, verificarFirma } from './firma-qr';

const CLAVE = 'a'.repeat(64);
const ACTOR = { sub: 'admin-1', tenantId: 't1', rol: 'ADMIN_SALON' } as never;

interface OpcionesDelDoble {
  fila?: { tenantId: string; minutosAntes: number; minutosDespues: number } | null;
  tenant?: { slug: string } | null;
  webOrigin?: string | undefined;
}

function crearServicio(opciones: OpcionesDelDoble = {}) {
  let fila = opciones.fila ?? null;

  const db = {
    configCheckInQR: {
      findFirst: jest.fn().mockImplementation(() => Promise.resolve(fila)),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        fila = data as never;
        return Promise.resolve(fila);
      }),
      update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        fila = { ...(fila as object), ...data } as never;
        return Promise.resolve(fila);
      }),
    },
    tenant: {
      // `findFirst` Y NO `findUnique`: dentro de un contexto de tenant la
      // extension de aislamiento rechaza las operaciones de `where` unico. El
      // doble solo tiene el metodo que el service puede usar de verdad, que es
      // lo que hace que cambiarlo por el prohibido falle aqui tambien y no solo
      // contra Postgres.
      findFirst: jest
        .fn()
        .mockResolvedValue(opciones.tenant === undefined ? { slug: 'mi-box' } : opciones.tenant),
    },
    $transaction: jest.fn().mockImplementation((fn: (cliente: unknown) => unknown) => fn(db)),
  };

  const entorno: Record<string, string | undefined> = {
    APP_ENCRYPTION_KEY: CLAVE,
    WEB_ORIGIN: 'webOrigin' in opciones ? opciones.webOrigin : 'https://app.boxadmin.io',
  };

  const config = {
    get: jest.fn((clave: string) => entorno[clave]),
    getOrThrow: jest.fn((clave: string) => entorno[clave]),
  };

  return { servicio: new ConfigCheckInService({ db } as never, config as never), db };
}

describe('ConfigCheckInService.ver', () => {
  it('sin fila, los quince minutos por defecto', async () => {
    // La ausencia de configuracion no puede ser un check-in roto.
    const { servicio } = crearServicio({ fila: null });

    await expect(servicio.ver()).resolves.toEqual({ minutosAntes: 15, minutosDespues: 15 });
  });

  it('los valores por defecto son los MISMOS que el @default del schema', () => {
    // Si divergieran, el gimnasio veria una ventana en la pantalla y tendria
    // otra en la practica hasta el primer guardado.
    expect(CONFIG_CHECKIN_POR_DEFECTO).toEqual({ minutosAntes: 15, minutosDespues: 15 });
  });

  it('con fila, la del gimnasio', async () => {
    const { servicio } = crearServicio({
      fila: { tenantId: 't1', minutosAntes: 30, minutosDespues: 5 },
    });

    await expect(servicio.ver()).resolves.toEqual({ minutosAntes: 30, minutosDespues: 5 });
  });
});

describe('ConfigCheckInService.guardar', () => {
  it('la primera vez crea, con el tenantId del actor', async () => {
    const { servicio, db } = crearServicio({ fila: null });

    await servicio.guardar(ACTOR, { minutosAntes: 20, minutosDespues: 10 });

    expect(db.configCheckInQR.create).toHaveBeenCalledWith({
      data: { tenantId: 't1', minutosAntes: 20, minutosDespues: 10 },
    });
    expect(db.configCheckInQR.update).not.toHaveBeenCalled();
  });

  it('guardar dos veces actualiza, no duplica', async () => {
    // Es el camino findFirst + create/update: `upsert` esta bloqueado por la
    // extension de aislamiento (UnsafeUniqueOperationError).
    const { servicio, db } = crearServicio({ fila: null });

    await servicio.guardar(ACTOR, { minutosAntes: 20, minutosDespues: 10 });
    const segunda = await servicio.guardar(ACTOR, { minutosAntes: 5, minutosDespues: 5 });

    expect(db.configCheckInQR.create).toHaveBeenCalledTimes(1);
    expect(db.configCheckInQR.update).toHaveBeenCalledTimes(1);
    expect(segunda).toEqual({ minutosAntes: 5, minutosDespues: 5 });
  });

  it('el `data` del update NO lleva tenantId', async () => {
    // Con el tenantId dentro, la extension lo lee como un intento de mover la
    // fila a otro gimnasio y lanza ReasignacionDeTenantError.
    const { servicio, db } = crearServicio({
      fila: { tenantId: 't1', minutosAntes: 15, minutosDespues: 15 },
    });

    await servicio.guardar(ACTOR, { minutosAntes: 0, minutosDespues: 0 });

    expect(db.configCheckInQR.update.mock.calls[0]![0].data).not.toHaveProperty('tenantId');
  });

  it('escribe dentro de una transaccion', async () => {
    const { servicio, db } = crearServicio({ fila: null });

    await servicio.guardar(ACTOR, { minutosAntes: 1, minutosDespues: 1 });

    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe('ConfigCheckInService.imagenQr', () => {
  it('devuelve un PNG de verdad', async () => {
    const { servicio } = crearServicio();

    const png = await servicio.imagenQr(ACTOR);

    // Los ocho bytes de cabecera de un PNG.
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  /**
   * LO QUE EL CARTEL LLEVA CODIFICADO DENTRO, que es lo unico del PNG que
   * ningun otro test mira.
   *
   * `urlDeCheckIn` esta probada como funcion pura, y el resto de los casos de
   * `imagenQr` solo comprueban que lo que vuelve es un PNG. Entre las dos cosas
   * queda un hueco: lo que `imagenQr` le pasa de verdad al codificador.
   * Agregarle algo a esa URL —el `tenantId` del gimnasio, por ejemplo— pasaba
   * los 1290 unitarios y los 204 e2e, y el dato acababa impreso en un cartel
   * colgado en una pared, en el historial del navegador de cada alumno y en el
   * log de accesos del front. Un e2e no puede verlo: haria falta decodificar el
   * PNG. Aqui si.
   */
  it('EL PNG CODIFICA EXACTAMENTE la URL de check-in, sin nada de mas', async () => {
    const { servicio } = crearServicio();
    const espia = jest.spyOn(qrcode, 'toBuffer');

    await servicio.imagenQr(ACTOR);

    expect(espia.mock.calls[0][0]).toBe(
      `https://app.boxadmin.io/mi-box/checkin?f=${firmarTenant('t1', CLAVE)}`,
    );

    espia.mockRestore();
  });

  it('pide el slug de SU gimnasio, no de uno de la URL', async () => {
    const { servicio, db } = crearServicio();

    await servicio.imagenQr(ACTOR);

    expect(db.tenant.findFirst).toHaveBeenCalledWith({
      where: { id: 't1' },
      select: { slug: true },
    });
  });

  it('sin WEB_ORIGIN no inventa una URL: 503 con el motivo', async () => {
    // WEB_ORIGIN es opcional en el entorno, asi que esto es alcanzable. Un QR
    // apuntando a "undefined/mi-box/checkin" seria peor que no darlo.
    const { servicio } = crearServicio({ webOrigin: undefined });

    await expect(servicio.imagenQr(ACTOR)).rejects.toThrow(ServiceUnavailableException);
  });

  it('si el gimnasio no existe, 404', async () => {
    const { servicio } = crearServicio({ tenant: null });

    await expect(servicio.imagenQr(ACTOR)).rejects.toThrow(NotFoundException);
  });
});

describe('urlDeCheckIn', () => {
  it('apunta a la pantalla de check-in del slug, con la firma en `f`', () => {
    const firma = firmarTenant('t1', CLAVE);

    expect(urlDeCheckIn('https://app.boxadmin.io', 'mi-box', firma)).toBe(
      `https://app.boxadmin.io/mi-box/checkin?f=${firma}`,
    );
  });

  it('un WEB_ORIGIN con barra final no produce una barra doble', () => {
    // Con '//' en el medio Next resuelve otra ruta, y el cartel impreso
    // llevaria una URL que no existe.
    expect(urlDeCheckIn('https://app.boxadmin.io/', 'mi-box', 'xyz')).toBe(
      'https://app.boxadmin.io/mi-box/checkin?f=xyz',
    );
  });

  it('la firma que viaja en la URL es la que el check-in acepta', () => {
    const url = urlDeCheckIn('https://app.boxadmin.io', 'mi-box', firmarTenant('t1', CLAVE));
    const firma = new URL(url).searchParams.get('f') as string;

    expect(verificarFirma('t1', firma, CLAVE)).toBe(true);
    // Y el cartel de este gimnasio no sirve en otro.
    expect(verificarFirma('t2', firma, CLAVE)).toBe(false);
  });
});
