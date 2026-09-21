import { expect, test } from '@playwright/test';
import { buscarElTurno } from './navegar';
import { prepararGimnasio } from './preparar';

test('el calendario ya cargado sobrevive a quedarse sin red', async ({ page, context }) => {
  const gym = await prepararGimnasio();

  await page.goto(`/${gym.slug}/registro`);
  await page.getByLabel(/nombre/i).fill('Ana Offline');
  await page.getByLabel(/email/i).fill(`ana-${Date.now()}@test.io`);
  await page.getByLabel(/clave/i).fill(gym.codigo);
  await page.getByLabel(/contrase/i).fill('Password123!');
  await page.getByRole('button', { name: /crear mi cuenta/i }).click();

  await expect(page).toHaveURL(new RegExp(`/${gym.slug}/calendario`));
  await buscarElTurno(page);

  // El service worker necesita estar activo para servir de la cache.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await buscarElTurno(page);

  await context.setOffline(true);
  await page.reload();

  // Punto del checklist del PDF: "funciona razonablemente offline para la vista
  // de mi calendario ya cacheada".
  await expect(page.getByText(/sin conexion/i)).toBeVisible({ timeout: 15_000 });

  await context.setOffline(false);
});
