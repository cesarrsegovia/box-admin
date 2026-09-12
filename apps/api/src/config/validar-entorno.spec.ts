import { validarEntorno } from './validar-entorno';

const ENTORNO_COMPLETO = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'secreto_jwt',
  JWT_EXPIRES_IN: '15m',
  JWT_REFRESH_SECRET: 'secreto_refresh',
  JWT_REFRESH_EXPIRES_IN: '30d',
  BOOTSTRAP_KEY: 'clave_bootstrap',
};

const VARIABLES_REQUERIDAS = [
  'DATABASE_URL',
  'REDIS_URL',
  'JWT_SECRET',
  'JWT_EXPIRES_IN',
  'JWT_REFRESH_SECRET',
  'JWT_REFRESH_EXPIRES_IN',
  'BOOTSTRAP_KEY',
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
