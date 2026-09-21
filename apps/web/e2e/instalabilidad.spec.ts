import { expect, test } from '@playwright/test';

test.describe('la aplicacion es instalable', () => {
  test('el manifest se sirve y sus iconos EXISTEN', async ({ page, request }) => {
    await page.goto('/');

    const enlace = page.locator('link[rel="manifest"]');
    await expect(enlace).toHaveCount(1);

    const manifest = await request.get('/manifest.json');
    expect(manifest.status()).toBe(200);

    const datos = (await manifest.json()) as {
      name: string;
      display: string;
      icons: { src: string; sizes: string }[];
    };
    expect(datos.display).toBe('standalone');
    expect(datos.icons.length).toBeGreaterThanOrEqual(2);

    // Lo que de verdad importa: que los archivos existan. Un manifest que
    // apunta a iconos inexistentes no hace la app instalable, y Chrome no lo
    // dice — simplemente no ofrece instalar.
    for (const icono of datos.icons) {
      const respuesta = await request.get(icono.src);
      expect(respuesta.status(), `${icono.src} no se sirve`).toBe(200);
      expect(respuesta.headers()['content-type']).toContain('image/png');
      const cuerpo = await respuesta.body();
      expect(cuerpo.length, `${icono.src} esta vacio`).toBeGreaterThan(500);
    }
  });

  test('el service worker se registra de verdad', async ({ page }) => {
    await page.goto('/');

    // jsdom no puede hacer esto, y por eso esta prueba existe.
    const registrado = await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      const registro = await navigator.serviceWorker.getRegistration();
      return registro !== undefined;
    });

    expect(registrado).toBe(true);
  });
});
