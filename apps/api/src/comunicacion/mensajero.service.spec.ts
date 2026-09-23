import { Logger } from '@nestjs/common';
import { MensajeroService, type Destinatario } from './mensajero.service';
import type { ConfigEmailService } from './config-email.service';
import type { DatosSmtp, EnviosDeEmail } from './envios.interface';
import type { PrismaService } from '../prisma/prisma.service';
import type { PushService } from '../push/push.service';

const CLAVE = 'laClaveDelGimnasio';

const SMTP: DatosSmtp = {
  host: 'smtp.gimnasio.test',
  puerto: 587,
  seguro: false,
  usuario: 'avisos@gimnasio.test',
  clave: CLAVE,
  emailOrigen: 'avisos@gimnasio.test',
};

const DESTINATARIO: Destinatario = {
  perfilId: 'perfil-1',
  email: 'alumna@correo.test',
  nombre: 'Ana',
};

function crearMensajero() {
  const db = {};
  const prisma = { db } as unknown as PrismaService;

  const config = {
    plantillaDe: jest.fn().mockResolvedValue(null),
    datosDeEnvio: jest.fn().mockResolvedValue({ smtp: SMTP, copia: 'salon@gimnasio.test' }),
  };

  const push = { notificar: jest.fn().mockResolvedValue(1) };
  const envios = { enviar: jest.fn().mockResolvedValue(undefined), verificar: jest.fn() };

  return {
    mensajero: new MensajeroService(
      prisma,
      config as unknown as ConfigEmailService,
      push as unknown as PushService,
      envios as unknown as EnviosDeEmail,
    ),
    config,
    push,
    envios,
    db,
  };
}

describe('MensajeroService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('resuelve la plantilla y manda email y push', async () => {
    const { mensajero, envios, push, db } = crearMensajero();

    await mensajero.avisar(
      DESTINATARIO,
      'CONFIRMACION',
      { alumno: 'Ana', clase: 'Pilates', fecha: '17/10', hora: '18:00', gimnasio: 'Box' },
      '/mi-calendario',
    );

    expect(envios.enviar).toHaveBeenCalledTimes(1);
    const [smtpUsado, mensaje] = envios.enviar.mock.calls[0] as [DatosSmtp, Record<string, string>];
    expect(smtpUsado).toBe(SMTP);
    expect(mensaje.para).toBe('alumna@correo.test');
    expect(mensaje.copia).toBe('salon@gimnasio.test');
    expect(mensaje.asunto).toBe('Reservaste Pilates para el 17/10');
    expect(mensaje.html).toContain('Pilates');

    // El push recibe el cliente de Prisma del mensajero, no uno propio.
    expect(push.notificar).toHaveBeenCalledWith(db, 'perfil-1', {
      titulo: 'Reservaste Pilates para el 17/10',
      cuerpo: 'Hola Ana',
      url: '/mi-calendario',
    });
  });

  it('usa la plantilla propia del gimnasio cuando la hay', async () => {
    const { mensajero, config, envios } = crearMensajero();
    config.plantillaDe.mockResolvedValue({
      asunto: 'Anotada en {{clase}}',
      cuerpoHtml: '<p>{{alumno}}</p>',
    });

    await mensajero.avisar(DESTINATARIO, 'CONFIRMACION', { alumno: 'Ana', clase: 'Yoga' }, '/x');

    const [, mensaje] = envios.enviar.mock.calls[0] as [DatosSmtp, Record<string, string>];
    expect(mensaje.asunto).toBe('Anotada en Yoga');
  });

  it('sin SMTP configurado no manda email, pero si push', async () => {
    const { mensajero, config, envios, push } = crearMensajero();
    config.datosDeEnvio.mockResolvedValue(null);

    await mensajero.avisar(DESTINATARIO, 'CONFIRMACION', { alumno: 'Ana' }, '/x');

    expect(envios.enviar).not.toHaveBeenCalled();
    expect(push.notificar).toHaveBeenCalledTimes(1);
  });

  it('un fallo del SMTP no escribe la clave en el log', async () => {
    // El error imita al de nodemailer: el EAUTH se arma como
    // `Invalid login: <respuesta literal del servidor>`, y un servidor verboso
    // reimprime ahi el base64 de la contrasena que acaba de recibir.
    //
    // MUTACION QUE TIENE QUE ROMPER ESTE TEST: volver el log del catch de
    // `porEmail` a `(error as Error).message`. Si no rompe, el test esta
    // mirando al sitio equivocado.
    const enBase64 = Buffer.from(CLAVE).toString('base64');
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const { mensajero, envios } = crearMensajero();
    // Sin `code`, para que `motivoSeguro` no corte en el paso 1 y tenga que
    // sanear el mensaje entero: es el camino que de verdad se quiere proteger.
    envios.enviar.mockRejectedValue(new Error(`Invalid login: 535 5.7.8 ${enBase64}`));

    await expect(
      mensajero.avisar(DESTINATARIO, 'CONFIRMACION', { alumno: 'Ana' }, '/x'),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    const logueado = String(warn.mock.calls[0]?.[0]);
    expect(logueado).not.toContain(CLAVE);
    expect(logueado).not.toContain(enBase64);
    expect(logueado).toContain('[redactado]');
  });

  it('un fallo del SMTP no impide el push', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { mensajero, envios, push } = crearMensajero();
    envios.enviar.mockRejectedValue(new Error('ECONNREFUSED'));

    await mensajero.avisar(DESTINATARIO, 'CONFIRMACION', { alumno: 'Ana' }, '/x');

    expect(push.notificar).toHaveBeenCalledTimes(1);
  });

  it('NO lanza aunque falle el push', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { mensajero, push } = crearMensajero();
    push.notificar.mockRejectedValue(new Error('base caida'));

    await expect(
      mensajero.avisar(DESTINATARIO, 'CONFIRMACION', { alumno: 'Ana' }, '/x'),
    ).resolves.toBeUndefined();
  });

  it('NO lanza si la plantilla no se puede leer', async () => {
    // `plantillaDe` va a Postgres. Sin el try de `avisar`, la primera
    // instruccion del metodo rompe la promesa de la clase.
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { mensajero, config, envios, push } = crearMensajero();
    config.plantillaDe.mockRejectedValue(new Error('base caida'));

    await expect(
      mensajero.avisar(DESTINATARIO, 'CONFIRMACION', { alumno: 'Ana' }, '/x'),
    ).resolves.toBeUndefined();

    // Sin mensaje no hay nada que mandar por ninguna de las dos vias.
    expect(envios.enviar).not.toHaveBeenCalled();
    expect(push.notificar).not.toHaveBeenCalled();
  });

  it('NO lanza con una plantilla mal formada guardada en la base', async () => {
    // El caso que `guardarPlantilla` ya rechaza con un 400, pero que sigue vivo
    // en las filas guardadas antes de que esa validacion existiera. Revienta al
    // RENDERIZAR, no al compilar.
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { mensajero, config, envios } = crearMensajero();
    config.plantillaDe.mockResolvedValue({
      asunto: 'x',
      cuerpoHtml: '{{#if alumno}}sin cerrar',
    });

    await expect(
      mensajero.avisar(DESTINATARIO, 'CONFIRMACION', { alumno: 'Ana' }, '/x'),
    ).resolves.toBeUndefined();

    expect(envios.enviar).not.toHaveBeenCalled();
  });

  it('el log de "sin SMTP" no arrastra el nombre del alumno', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const { mensajero, config } = crearMensajero();
    config.datosDeEnvio.mockResolvedValue(null);

    await mensajero.avisar(
      DESTINATARIO,
      'CONFIRMACION',
      { alumno: 'Ana Perez', clase: 'Pilates', fecha: '17/10' },
      '/x',
    );

    const logueado = String(log.mock.calls[0]?.[0]);
    expect(logueado).toContain('CONFIRMACION');
    expect(logueado).not.toContain('Ana Perez');
  });

  it('si falla la propia lectura del SMTP tampoco lanza ni filtra', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { mensajero, config, push } = crearMensajero();
    // `envio` se queda en null: `motivoSeguro` se queda sin agujas y tiene que
    // degradar a la red de base64 sin romperse por los `?? ''`.
    config.datosDeEnvio.mockRejectedValue(
      new Error(`fallo al descifrar ${Buffer.from(CLAVE).toString('base64')}`),
    );

    await expect(
      mensajero.avisar(DESTINATARIO, 'CONFIRMACION', { alumno: 'Ana' }, '/x'),
    ).resolves.toBeUndefined();

    expect(String(warn.mock.calls[0]?.[0])).not.toContain(Buffer.from(CLAVE).toString('base64'));
    expect(push.notificar).toHaveBeenCalledTimes(1);
  });
});
