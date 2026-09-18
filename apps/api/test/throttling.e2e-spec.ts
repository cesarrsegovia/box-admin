/**
 * El throttler, ejercitado de verdad.
 *
 * Este archivo baja el limite ANTES de importar nada de la aplicacion, y por
 * eso los imports van dentro de los tests en vez de arriba: `@Throttle` es
 * metadata estatica que se evalua al definir la clase del controller, asi que
 * las constantes de `common/throttling.ts` tienen que leer el `process.env` ya
 * modificado. Un import normal arriba del archivo se adelantaria.
 *
 * Vive aparte de los demas e2e porque el resto necesita justo lo contrario: un
 * limite altisimo, para que treinta logins seguidos desde la misma IP no
 * empiecen a dar 429.
 */
process.env.THROTTLE_AUTH_LIMIT = '3';
process.env.THROTTLE_AUTH_TTL = '60000';

import type { INestApplication } from '@nestjs/common';
import * as request from 'supertest';

describe('Throttling de las rutas publicas de auth', () => {
  let app: INestApplication;
  let cerrar: () => Promise<void>;

  beforeAll(async () => {
    const { crearAppDeTest, limpiarBaseDeDatos } = await import('./helpers');
    const entorno = await crearAppDeTest();
    app = entorno.app;
    cerrar = () => entorno.app.close();
    await limpiarBaseDeDatos(entorno.prisma);
  });

  afterAll(async () => {
    await cerrar();
  });

  it('el limite configurado llega efectivamente a las rutas de auth', async () => {
    const { LIMITE_AUTH } = await import('../src/common/throttling');

    // Si esto falla, el resto del archivo no prueba nada: significaria que la
    // constante se evaluo antes de que se cambiara el entorno.
    expect(LIMITE_AUTH).toBe(3);
  });

  it('pasado el limite, el auto-registro devuelve 429', async () => {
    const servidor = app.getHttpServer();
    const cuerpo = {
      tenantSlug: 'inexistente',
      codigo: 'f'.repeat(32),
      nombreCompleto: 'Quien Sea',
      email: 'fuerza@bruta.test',
      password: 'Password123!',
    };

    const estados: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await request(servidor).post('/auth/auto-registro').send(cuerpo);
      estados.push(r.status);
    }

    // Los tres primeros llegan al servicio y fallan por clave invalida; del
    // cuarto en adelante ni siquiera se ejecuta el handler.
    expect(estados.slice(0, 3)).toEqual([401, 401, 401]);
    expect(estados.slice(3)).toEqual([429, 429]);
  });

  it('el login tambien esta limitado, que desde la Fase 0 no lo estaba', async () => {
    const servidor = app.getHttpServer();
    const cuerpo = { tenantSlug: 'inexistente', email: 'a@b.test', password: 'Password123!' };

    const estados: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await request(servidor).post('/auth/login').send(cuerpo);
      estados.push(r.status);
    }

    expect(estados).toContain(429);
  });
});
