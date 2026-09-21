import { expect, test } from '@playwright/test';
import { buscarElTurno } from './navegar';
import { prepararGimnasio } from './preparar';

async function registrarse(
  page: import('@playwright/test').Page,
  slug: string,
  codigo: string,
  email: string,
): Promise<void> {
  await page.goto(`/${slug}/registro`);
  await page.getByLabel(/nombre/i).fill('Ana Prueba');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/clave/i).fill(codigo);
  await page.getByLabel(/contrase/i).fill('Password123!');
  await page.getByRole('button', { name: /crear mi cuenta/i }).click();
}

test('un alumno se registra, reserva y cancela sin tocar la API a mano', async ({ page }) => {
  const gym = await prepararGimnasio();

  await registrarse(page, gym.slug, gym.codigo, `ciclo-${Date.now()}@test.io`);
  await expect(page).toHaveURL(new RegExp(`/${gym.slug}/calendario`));

  // El turno del mes publicado tiene que aparecer.
  await buscarElTurno(page);

  await page
    .getByRole('button', { name: /^reservar$/i })
    .first()
    .click();
  await expect(page.getByText(/ya tenes tu lugar reservado/i)).toBeVisible();

  // El pack refleja el consumo.
  await page.getByRole('link', { name: /mi pack/i }).click();
  await expect(page.getByRole('heading', { name: /tu pack/i })).toBeVisible();

  // Cancelar devuelve el turno a reservable.
  //
  // Hay que volver a buscar la semana: al navegar entre pantallas el
  // calendario se remonta y vuelve a abrir en la de hoy.
  await page.getByRole('link', { name: /calendario/i }).click();
  await buscarElTurno(page);
  await page
    .getByRole('button', { name: /cancelar/i })
    .first()
    .click();
  await expect(
    page
      .getByRole('button', { name: /^reservar$/i })
      .first(),
  ).toBeVisible();

  // Cerrar sesion devuelve al login.
  await page.getByRole('link', { name: /perfil/i }).click();
  await page.getByRole('button', { name: /cerrar sesion/i }).click();
  await expect(page).toHaveURL(new RegExp(`/${gym.slug}/login`));
});

test('el slug de otro gimnasio no deja entrar con la sesion propia', async ({ page }) => {
  const gym = await prepararGimnasio();
  const otro = await prepararGimnasio();

  await registrarse(page, gym.slug, gym.codigo, `slug-${Date.now()}@test.io`);
  await expect(page).toHaveURL(new RegExp(`/${gym.slug}/calendario`));

  // Con la cookie del gimnasio A, abrir el calendario de B.
  await page.goto(`/${otro.slug}/calendario`);

  // Sin la comprobacion del slug, la API respondria con los datos de A bajo la
  // URL de B, porque el JWT lleva su propio tenantId.
  await expect(page).toHaveURL(new RegExp(`/${otro.slug}/login`));
});
