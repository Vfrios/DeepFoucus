import { expect, test } from '@playwright/test';

test('mostra a tela de login quando não existe sessão', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Wall Dashboard' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Entrar com o Google' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
