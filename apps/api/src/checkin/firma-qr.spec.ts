import { createHmac } from 'node:crypto';
import { firmarTenant, verificarFirma } from './firma-qr';

describe('firmarTenant / verificarFirma', () => {
  const CLAVE = 'a'.repeat(64);

  it('lo que se firma se verifica', () => {
    const firma = firmarTenant('gym-1', CLAVE);

    expect(verificarFirma('gym-1', firma, CLAVE)).toBe(true);
  });

  it('la firma de un gimnasio NO sirve para otro', () => {
    const firma = firmarTenant('gym-1', CLAVE);

    expect(verificarFirma('gym-2', firma, CLAVE)).toBe(false);
  });

  it('una firma inventada no pasa', () => {
    expect(verificarFirma('gym-1', 'cualquiercosa', CLAVE)).toBe(false);
  });

  it('con otra clave de aplicacion no pasa', () => {
    const firma = firmarTenant('gym-1', CLAVE);

    expect(verificarFirma('gym-1', firma, 'b'.repeat(64))).toBe(false);
  });

  it('la firma es estable: el mismo gimnasio da siempre la misma', () => {
    // El QR se imprime y se pega en la pared. Si la firma cambiara entre
    // reinicios, el cartel impreso dejaria de servir.
    expect(firmarTenant('gym-1', CLAVE)).toBe(firmarTenant('gym-1', CLAVE));
  });

  it('una firma vacia o de otro largo no pasa', () => {
    expect(verificarFirma('gym-1', '', CLAVE)).toBe(false);
    expect(verificarFirma('gym-1', 'abc', CLAVE)).toBe(false);
  });

  /**
   * EL CASO QUE EL PLAN PEDIA ESCRIBIR. Ninguno de los de arriba cae si se
   * quita el `PROPOSITO`: todos comparan firmas de esta misma funcion contra si
   * misma, asi que el prefijo se cancela en los dos lados. Este fija el valor
   * desde fuera.
   *
   * Lo que protege: la misma APP_ENCRYPTION_KEY cifra las credenciales SMTP
   * desde la Fase 5B. Sin separador de dominio, un HMAC de esa clave sobre un
   * texto elegido por otro subsistema seria indistinguible de una firma de QR.
   */
  it('lleva separador de dominio: no es el HMAC pelado del tenantId', () => {
    const pelada = createHmac('sha256', CLAVE).update('gym-1').digest('base64url');

    expect(firmarTenant('gym-1', CLAVE)).not.toBe(pelada);
  });

  it('la firma es base64url: entra en una URL sin escapar nada', () => {
    const firma = firmarTenant('gym-1', CLAVE);

    // Ni '+', ni '/', ni '=': los tres se escaparian al meterlos en un query
    // string, y el QR impreso llevaria una URL que no es la que firmamos.
    expect(firma).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encodeURIComponent(firma)).toBe(firma);
  });
});
