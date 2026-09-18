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
