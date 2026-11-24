import { expect, test } from '@playwright/test';

function ownerToken(): string {
  const encoded = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encoded({ alg: 'HS256', typ: 'JWT' })}.${encoded({
    email: 'owner@example.com',
    name: 'Owner',
    role: 'owner',
  })}.signature`;
}

test('desktop web shell carrega calendário e persiste lock entre reloads', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/api/tasks')) {
      await route.fulfill({ json: [] });
      return;
    }
    if (url.includes('/api/calendar/lists')) {
      await route.fulfill({ json: [] });
      return;
    }
    if (url.includes('/api/calendar/events')) {
      await route.fulfill({ json: [] });
      return;
    }
    if (url.endsWith('/api/health/water')) {
      await route.fulfill({ json: { waterToday: 0, waterGoalMl: 2500 } });
      return;
    }
    if (url.endsWith('/api/stats/summary')) {
      await route.fulfill({ json: { streakDias: 3 } });
      return;
    }
    await route.fulfill({ json: {} });
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.evaluate((token) => localStorage.setItem('wd:jwt', token), ownerToken());
  await page.goto('/?view=web');

  await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Calendário', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Travar no calendário' }).click();
  await expect(page.locator('.shell.is-locked')).toBeVisible();

  await page.reload();
  await expect(page.locator('.shell.is-locked')).toBeVisible();

  const surface = page.getByLabel('Mantenha pressionado para destravar');
  await surface.hover();
  await page.mouse.down();
  await page.waitForTimeout(850);
  await page.mouse.up();
  await expect(page.locator('.shell.is-locked')).toHaveCount(0);
});
