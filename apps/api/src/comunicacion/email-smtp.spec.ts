import { createTransport, type SendMailOptions, type Transporter } from 'nodemailer';
import { EmailPorSmtp } from './email-smtp';
import type { DatosSmtp } from './envios.interface';

// El unico jest.mock del repositorio, y a proposito. La decision D1 de la spec
// rechaza atar los tests a la libreria, pero eso vale para el resto del codigo:
// este archivo es justamente la pieza cuyo trabajo es hablar con nodemailer,
// asi que mockearlo aca no prueba un detalle de implementacion, prueba el unico
// contrato que el adaptador tiene.
jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

/**
 * Los tres metodos que el adaptador usa del transporte. El `satisfies` los ata
 * a la forma real de nodemailer: si un dia `Transporter` deja de tener alguno,
 * este archivo no compila en vez de seguir probando contra un doble inventado.
 */
const METODOS_USADOS = [
  'sendMail',
  'verify',
  'close',
] as const satisfies readonly (keyof Transporter)[];

const SMTP: DatosSmtp = {
  host: 'smtp.test',
  puerto: 587,
  seguro: true,
  usuario: 'u',
  clave: 'secreta',
  emailOrigen: 'gym@test.io',
};

const crearTransporte = jest.mocked(createTransport);

// Tipados uno a uno en vez de `jest.fn()` a secas: asi las opciones que recibe
// `sendMail` son `SendMailOptions` de verdad y las aserciones de mas abajo se
// comprueban en tiempo de compilacion, no solo en tiempo de ejecucion.
let sendMail: jest.Mock<Promise<void>, [SendMailOptions]>;
let verify: jest.Mock<Promise<true>, []>;
let close: jest.Mock<void, []>;

/** Las opciones con las que se llamo a `sendMail` la primera vez. */
function opcionesDelEnvio(): SendMailOptions {
  const [opciones] = sendMail.mock.calls[0] ?? [];
  if (!opciones) throw new Error('No se llamo a sendMail.');

  return opciones;
}

beforeEach(() => {
  sendMail = jest.fn<Promise<void>, [SendMailOptions]>().mockResolvedValue(undefined);
  verify = jest.fn<Promise<true>, []>().mockResolvedValue(true);
  close = jest.fn<void, []>();

  // El doble solo tiene los tres metodos que el adaptador usa. El cast es
  // inevitable —`Transporter` es una interfaz enorme que hereda de
  // EventEmitter— y es seguro justamente porque el adaptador no toca nada mas.
  crearTransporte.mockReturnValue({ sendMail, verify, close } as unknown as Transporter);
});

afterEach(() => {
  crearTransporte.mockReset();
});

describe('EmailPorSmtp', () => {
  it('el doble imita los metodos reales del transporte', () => {
    const doble = crearTransporte({});

    for (const metodo of METODOS_USADOS) {
      expect(typeof doble[metodo]).toBe('function');
    }
  });

  describe('la copia interna', () => {
    it('va en bcc y NUNCA en cc', async () => {
      // Es privacidad, no estilo: con `cc`, el alumno que abre el email ve la
      // direccion interna del gimnasio en su cliente de correo. Se asertan las
      // dos cosas porque comprobar solo `bcc` dejaria pasar una implementacion
      // que mandara las dos y filtrara igual.
      await new EmailPorSmtp().enviar(SMTP, {
        para: 'ana@x.io',
        copia: 'salon@test.io',
        asunto: 'Hola',
        html: '<p>hey</p>',
      });

      expect(opcionesDelEnvio().bcc).toBe('salon@test.io');
      expect(opcionesDelEnvio()).not.toHaveProperty('cc');
    });

    it('sin copia configurada no manda ni bcc ni cc', async () => {
      // Ni siquiera como `bcc: null`. Un destinatario vacio colado en las
      // opciones es la clase de cosa que algunos servidores SMTP rechazan.
      await new EmailPorSmtp().enviar(SMTP, {
        para: 'ana@x.io',
        copia: null,
        asunto: 'Hola',
        html: '<p>hey</p>',
      });

      expect(opcionesDelEnvio()).not.toHaveProperty('bcc');
      expect(opcionesDelEnvio()).not.toHaveProperty('cc');
    });
  });

  it('pasa los tres timeouts a createTransport', async () => {
    // Si alguien los borra "porque nodemailer ya trae defaults", esto lo para:
    // los defaults son de dos minutos, y dos minutos cuelgan el PUT /config/smtp
    // o bloquean un worker de BullMQ contra un host que hace blackhole.
    await new EmailPorSmtp().enviar(SMTP, {
      para: 'ana@x.io',
      copia: null,
      asunto: 'Hola',
      html: '<p>hey</p>',
    });

    expect(crearTransporte).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 10_000,
      }),
    );
  });

  it('cierra el transporte aunque sendMail lance, y propaga el error', async () => {
    // El `finally`. Sin el, un SMTP que falla en bucle deja un socket abierto
    // por intento hasta quedarse sin descriptores.
    sendMail.mockRejectedValue(new Error('conexion rechazada'));

    await expect(
      new EmailPorSmtp().enviar(SMTP, {
        para: 'ana@x.io',
        copia: null,
        asunto: 'Hola',
        html: '<p>hey</p>',
      }),
    ).rejects.toThrow('conexion rechazada');

    expect(close).toHaveBeenCalledTimes(1);
  });

  describe('verificar', () => {
    it('cierra el transporte cuando el verify sale bien', async () => {
      await new EmailPorSmtp().verificar(SMTP);

      expect(verify).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);
    });

    it('cierra el transporte y propaga el motivo cuando el verify falla', async () => {
      // El motivo no se puede tragar: PUT /config/smtp lo necesita para
      // responder un 400 que diga que host o que credencial esta mal.
      verify.mockRejectedValue(new Error('auth invalida'));

      await expect(new EmailPorSmtp().verificar(SMTP)).rejects.toThrow('auth invalida');

      expect(close).toHaveBeenCalledTimes(1);
    });
  });
});
