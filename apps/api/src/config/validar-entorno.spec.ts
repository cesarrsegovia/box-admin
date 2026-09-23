import { validarEntorno } from './validar-entorno';

const ENTORNO_COMPLETO = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'secreto_jwt',
  JWT_EXPIRES_IN: '15m',
  JWT_REFRESH_SECRET: 'secreto_refresh',
  JWT_REFRESH_EXPIRES_IN: '30d',
  BOOTSTRAP_KEY: 'clave_bootstrap',
  // Anadida en la Fase 3A: sin ella no se sabe donde guardar los comprobantes.
  ALMACEN_TIPO: 'local',
  // Anadidas en la Fase 5B. La clave son 32 bytes en hexadecimal.
  APP_ENCRYPTION_KEY: '0'.repeat(64),
  EMAIL_TIPO: 'memoria',
  PUSH_TIPO: 'memoria',
};

const VARIABLES_REQUERIDAS = [
  'DATABASE_URL',
  'REDIS_URL',
  'JWT_SECRET',
  'JWT_EXPIRES_IN',
  'JWT_REFRESH_SECRET',
  'JWT_REFRESH_EXPIRES_IN',
  'BOOTSTRAP_KEY',
  'ALMACEN_TIPO',
  'APP_ENCRYPTION_KEY',
  'EMAIL_TIPO',
  'PUSH_TIPO',
];

describe('validarEntorno', () => {
  it('pasa y devuelve el config cuando el entorno esta completo', () => {
    expect(validarEntorno({ ...ENTORNO_COMPLETO })).toEqual(ENTORNO_COMPLETO);
  });

  it.each(VARIABLES_REQUERIDAS)('lanza si falta %s', (variable) => {
    const entorno = { ...ENTORNO_COMPLETO } as Record<string, unknown>;
    delete entorno[variable];
    expect(() => validarEntorno(entorno)).toThrow();
  });

  it.each(VARIABLES_REQUERIDAS)('lanza si %s esta vacia', (variable) => {
    const entorno = { ...ENTORNO_COMPLETO, [variable]: '' };
    expect(() => validarEntorno(entorno)).toThrow();
  });

  it.each(VARIABLES_REQUERIDAS)('lanza si %s solo tiene espacios', (variable) => {
    const entorno = { ...ENTORNO_COMPLETO, [variable]: '   ' };
    expect(() => validarEntorno(entorno)).toThrow();
  });

  it.each(VARIABLES_REQUERIDAS)('el mensaje de error nombra la variable %s faltante', (variable) => {
    const entorno = { ...ENTORNO_COMPLETO } as Record<string, unknown>;
    delete entorno[variable];
    expect(() => validarEntorno(entorno)).toThrow(new RegExp(variable));
  });
});

describe('validarEntorno — almacen de archivos', () => {
  const CON_S3 = {
    S3_ENDPOINT: 'https://s3.example.com',
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'comprobantes',
    S3_ACCESS_KEY_ID: 'clave',
    S3_SECRET_ACCESS_KEY: 'secreto',
  };

  it('acepta ALMACEN_TIPO=local sin ninguna variable de S3', () => {
    // Es lo que permite que desarrollo y los tests corran sin credenciales.
    expect(() => validarEntorno({ ...ENTORNO_COMPLETO, ALMACEN_TIPO: 'local' })).not.toThrow();
  });

  it('rechaza un ALMACEN_TIPO que no sea local ni s3', () => {
    expect(() => validarEntorno({ ...ENTORNO_COMPLETO, ALMACEN_TIPO: 'dropbox' })).toThrow(
      /ALMACEN_TIPO/,
    );
  });

  it('con ALMACEN_TIPO=s3 y todas sus variables, pasa', () => {
    expect(() =>
      validarEntorno({ ...ENTORNO_COMPLETO, ALMACEN_TIPO: 's3', ...CON_S3 }),
    ).not.toThrow();
  });

  it.each(Object.keys(CON_S3))('con ALMACEN_TIPO=s3, lanza si falta %s', (variable) => {
    const entorno = { ...ENTORNO_COMPLETO, ALMACEN_TIPO: 's3', ...CON_S3 } as Record<
      string,
      unknown
    >;
    delete entorno[variable];

    expect(() => validarEntorno(entorno)).toThrow(new RegExp(variable));
  });

  it('el mensaje de una variable de S3 que falta explica que solo aplica a s3', () => {
    const entorno = { ...ENTORNO_COMPLETO, ALMACEN_TIPO: 's3', ...CON_S3, S3_BUCKET: '' };

    expect(() => validarEntorno(entorno)).toThrow(/ALMACEN_TIPO=s3/);
  });
});

describe('validarEntorno — origen del frontend', () => {
  it('WEB_ORIGIN es opcional: sin el, no se habilita CORS', () => {
    const entorno = { ...ENTORNO_COMPLETO } as Record<string, unknown>;
    delete entorno.WEB_ORIGIN;

    // Un despliegue solo-API no tiene frontend al que abrirle la puerta.
    expect(() => validarEntorno(entorno)).not.toThrow();
  });

  it('WEB_ORIGIN, si esta, tiene que ser un origen valido', () => {
    expect(() => validarEntorno({ ...ENTORNO_COMPLETO, WEB_ORIGIN: 'no-es-una-url' })).toThrow(
      /WEB_ORIGIN/,
    );
  });

  it('acepta un origen con puerto', () => {
    expect(() =>
      validarEntorno({ ...ENTORNO_COMPLETO, WEB_ORIGIN: 'http://localhost:3001' }),
    ).not.toThrow();
  });

  it('acepta https sin puerto', () => {
    expect(() =>
      validarEntorno({ ...ENTORNO_COMPLETO, WEB_ORIGIN: 'https://app.boxadmin.io' }),
    ).not.toThrow();
  });

  it('una cadena vacia se trata como ausente, no como error', () => {
    // Es lo que deja un `.env` con la clave escrita y el valor sin rellenar.
    expect(() => validarEntorno({ ...ENTORNO_COMPLETO, WEB_ORIGIN: '' })).not.toThrow();
  });
});

describe('validarEntorno — comunicacion', () => {
  it('lanza si falta APP_ENCRYPTION_KEY', () => {
    const entorno = { ...ENTORNO_COMPLETO } as Record<string, unknown>;
    delete entorno.APP_ENCRYPTION_KEY;

    expect(() => validarEntorno(entorno)).toThrow(/APP_ENCRYPTION_KEY/);
  });

  it('rechaza una APP_ENCRYPTION_KEY de longitud equivocada', () => {
    // 32 caracteres son 16 bytes, la mitad de lo que exige aes-256-gcm.
    // Se asierta contra /hexadecimal/ y no contra /APP_ENCRYPTION_KEY/: el
    // segundo lo cumple tambien el mensaje generico de "variable ausente", con
    // lo que el test pasaria sin que esta validacion existiera.
    expect(() =>
      validarEntorno({ ...ENTORNO_COMPLETO, APP_ENCRYPTION_KEY: '0'.repeat(32) }),
    ).toThrow(/hexadecimal \(64 caracteres\)/);
  });

  it('rechaza una APP_ENCRYPTION_KEY con caracteres no hexadecimales', () => {
    // Longitud correcta, alfabeto equivocado: solo lo caza la expresion regular.
    const clave = 'z'.repeat(64);

    expect(() => validarEntorno({ ...ENTORNO_COMPLETO, APP_ENCRYPTION_KEY: clave })).toThrow(
      /hexadecimal \(64 caracteres\)/,
    );
  });

  it('acepta una APP_ENCRYPTION_KEY en mayusculas', () => {
    // `randomBytes(...).toString('hex')` da minusculas, pero un despliegue puede
    // haberla pegado en mayusculas y sigue siendo la misma clave.
    expect(() =>
      validarEntorno({ ...ENTORNO_COMPLETO, APP_ENCRYPTION_KEY: 'A'.repeat(64) }),
    ).not.toThrow();
  });

  it('rechaza un EMAIL_TIPO que no sea memoria ni smtp', () => {
    expect(() => validarEntorno({ ...ENTORNO_COMPLETO, EMAIL_TIPO: 'sendgrid' })).toThrow(
      /EMAIL_TIPO/,
    );
  });

  it('acepta EMAIL_TIPO=smtp', () => {
    expect(() => validarEntorno({ ...ENTORNO_COMPLETO, EMAIL_TIPO: 'smtp' })).not.toThrow();
  });

  it('rechaza un PUSH_TIPO que no sea memoria ni web-push', () => {
    expect(() => validarEntorno({ ...ENTORNO_COMPLETO, PUSH_TIPO: 'firebase' })).toThrow(
      /PUSH_TIPO/,
    );
  });

  it('acepta PUSH_TIPO=web-push', () => {
    expect(() => validarEntorno({ ...ENTORNO_COMPLETO, PUSH_TIPO: 'web-push' })).not.toThrow();
  });

  it('las VAPID ausentes NO impiden arrancar ni con PUSH_TIPO=web-push', () => {
    // D4. El caso que importa es justo este: con PUSH_TIPO=web-push y sin claves
    // VAPID, la aplicacion TIENE que arrancar igual — el push se desactiva y el
    // email sigue saliendo. A diferencia de la clave de cifrado, las VAPID son
    // una capacidad del despliegue, no un estado roto.
    //
    // ENTORNO_COMPLETO no define ninguna VAPID, asi que este entorno ya es "sin
    // VAPID"; borrarlas seria un no-op y dejaria el test sin morder.
    expect(() => validarEntorno({ ...ENTORNO_COMPLETO, PUSH_TIPO: 'web-push' })).not.toThrow();

    // Y el caso que deja de verdad un .env: la clave escrita y el valor sin
    // rellenar, que llega como cadena vacia y no como ausente.
    expect(() =>
      validarEntorno({
        ...ENTORNO_COMPLETO,
        PUSH_TIPO: 'web-push',
        VAPID_PUBLIC_KEY: '',
        VAPID_PRIVATE_KEY: '',
      }),
    ).not.toThrow();
  });
});
