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

test('mobile usa MobileShell, sem lock mode e com navegação compartilhada', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/api/tasks')) await route.fulfill({ json: [] });
    else if (url.includes('/api/calendar/lists')) await route.fulfill({ json: [] });
    else if (url.includes('/api/calendar/events')) await route.fulfill({ json: [] });
    else if (url.endsWith('/api/health/water')) await route.fulfill({ json: { waterToday: 0, waterGoalMl: 2500 } });
    else if (url.endsWith('/api/stats/summary')) await route.fulfill({ json: { streakDias: 0 } });
    else await route.fulfill({ json: {} });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.evaluate((token) => localStorage.setItem('wd:jwt', token), ownerToken());
  await page.goto('/?view=mobile');

  await expect(page.locator('.shell-mobile')).toBeVisible();
  await expect(page.locator('.lock-btn')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toBeVisible();

  await page.getByRole('button', { name: 'Compras' }).click();
  await expect(page).toHaveURL(/page=shopping/);
});
