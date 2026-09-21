import { expect, type Page } from '@playwright/test';

/**
 * Deja a la vista la semana que contiene el turno de prueba.
 *
 * El calendario abre en la semana de hoy y el turno de prueba es de mañana, que
 * cae en la misma semana salvo que hoy sea domingo. En vez de hacer aritmetica
 * de calendario en el test, se avanza hasta encontrarlo: ademas ejercita la
 * navegacion entre semanas, que si no no la probaria nadie.
 */
export async function buscarElTurno(page: Page, nombre = 'Pilates'): Promise<void> {
  for (let intento = 0; intento < 3; intento++) {
    if (await page.getByText(nombre).first().isVisible()) return;
    await page.getByRole('button', { name: /siguiente/i }).click();
    await page.waitForTimeout(400);
  }

  await expect(page.getByText(nombre).first()).toBeVisible();
}
