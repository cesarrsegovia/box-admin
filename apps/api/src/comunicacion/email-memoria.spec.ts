import { EmailEnMemoria } from './email-memoria';

const SMTP = {
  host: 'smtp.test',
  puerto: 587,
  seguro: true,
  usuario: 'u',
  clave: 'secreta',
  emailOrigen: 'gym@test.io',
};

describe('EmailEnMemoria', () => {
  it('guarda lo enviado con su destinatario y su cuerpo', async () => {
    const envios = new EmailEnMemoria();

    await envios.enviar(SMTP, {
      para: 'ana@x.io',
      copia: null,
      asunto: 'Hola',
      html: '<p>hey</p>',
    });

    expect(envios.enviados).toHaveLength(1);
    expect(envios.enviados[0]).toMatchObject({ para: 'ana@x.io', asunto: 'Hola' });
  });

  it('NO guarda la contrasena del SMTP', async () => {
    // El adaptador de memoria existe para los tests, y un test que guardara la
    // credencial la acabaria imprimiendo en el primer fallo.
    const envios = new EmailEnMemoria();

    await envios.enviar(SMTP, { para: 'a@x.io', copia: null, asunto: 'x', html: 'y' });

    expect(JSON.stringify(envios.enviados)).not.toContain('secreta');
  });

  it('limpiar vacia la bandeja', async () => {
    const envios = new EmailEnMemoria();
    await envios.enviar(SMTP, { para: 'a@x.io', copia: null, asunto: 'x', html: 'y' });

    envios.limpiar();

    expect(envios.enviados).toEqual([]);
  });

  it('verificar siempre resuelve: no hay contra que conectar', async () => {
    await expect(new EmailEnMemoria().verificar(SMTP)).resolves.toBeUndefined();
  });
});
