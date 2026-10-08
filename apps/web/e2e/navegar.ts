import { expect, type Page } from '@playwright/test';

/**
 * Lo que se le da a CADA semana para que aparezca su turno.
 *
 * Acotado a proposito: el helper avanza de semana cuando no lo encuentra, asi
 * que esperar aqui el timeout entero de Playwright convertiria "esta semana no
 * tiene turnos" en un test de treinta segundos. Con el turno sembrado los datos
 * llegan sobre los 350 ms; cuatro segundos dejan margen de sobra para un
 * arranque frio sin volver lento el caso negativo.
 */
const ESPERA_POR_SEMANA = 4_000;

/**
 * Deja a la vista la semana que contiene el turno de prueba.
 *
 * El calendario abre en la semana de hoy y el turno de prueba es de mañana, que
 * cae en la misma semana salvo que hoy sea domingo. En vez de hacer aritmetica
 * de calendario en el test, se avanza hasta encontrarlo: ademas ejercita la
 * navegacion entre semanas, que si no no la probaria nadie.
 *
 * ⚠️ La espera es de VERDAD (`waitFor`), no un `isVisible()`.
 *
 * `isVisible()` consulta el DOM y contesta: no espera. La primera mirada caia
 * siempre ANTES de que llegaran los datos (~218 ms contra ~337 ms), asi que el
 * helper se iba a la semana siguiente sin mirar de verdad la de hoy y tres
 * clics despues fallaba sobre una semana que legitimamente no tiene turnos. No
 * era mala suerte: lo unico que decidia si pasaba era si el fetch alcanzaba a
 * completarse durante la ida y vuelta de Playwright, y por eso cualquier
 * latencia nueva lo inclinaba.
 */
export async function buscarElTurno(page: Page, nombre = 'Pilates'): Promise<void> {
  for (let intento = 0; intento < 3; intento++) {
    try {
      await page
        .getByText(nombre)
        .first()
        .waitFor({ state: 'visible', timeout: ESPERA_POR_SEMANA });
      return;
    } catch {
      // Esta semana no lo tiene (o tardo demasiado): a la siguiente. El fallo
      // de verdad lo da el `expect` de abajo, con su mensaje y su captura.
    }

    await page.getByRole('button', { name: /siguiente/i }).click();

    // La semana anterior sigue pintada mientras llega la nueva, asi que sin
    // esta pausa el `waitFor` de la vuelta siguiente podria dar por buena la
    // semana que acabamos de dejar atras.
    await page.waitForTimeout(400);
  }

  await expect(page.getByText(nombre).first()).toBeVisible({ timeout: ESPERA_POR_SEMANA });
}
