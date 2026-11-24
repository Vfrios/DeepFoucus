import { expect, request, test, type Page } from '@playwright/test';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const jwtSecret = process.env.JWT_SECRET;

function ownerToken(): string {
  if (!jwtSecret) throw new Error('JWT_SECRET não configurada');
  return jwt.sign(
    { email: 'finance-e2e@example.com', name: 'Finance E2E', role: 'owner' },
    jwtSecret,
    { algorithm: 'HS256', expiresIn: '1h' }
  );
}

async function apiCall(method: 'GET' | 'POST' | 'DELETE', path: string, body?: object) {
  const context = await request.newContext({
    baseURL: 'http://localhost:3001',
    extraHTTPHeaders: { Authorization: `Bearer ${ownerToken()}` },
  });
  try {
    const response = await context.fetch(`/api/finance${path}`, {
      method,
      data: body,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
    });
    const text = await response.text();
    let json: any;
    try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }
    return { response, status: response.status(), json };
  } finally {
    await context.dispose();
  }
}

async function openFinancePage(page: Page) {
  await page.goto('/');
  await page.evaluate((token) => localStorage.setItem('wd:jwt', token), ownerToken());
  await page.goto('/?view=web&page=finance');
  await expect(page.locator('.finance-page')).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

test('categorize reutiliza Mercado e Sorveteria sem chamar a IA', async () => {
  const picole = await apiCall('POST', '/categorize', { descricao: 'picolé' });
  expect(picole.status).toBe(200);
  expect(picole.json).toMatchObject({ categoria: 'Sorveteria', existente: true });

  const supermarket = await apiCall('POST', '/categorize', { descricao: 'supermercado' });
  expect(supermarket.status).toBe(200);
  expect(supermarket.json).toMatchObject({ categoria: 'Mercado', existente: true });
});

test('cria e retorna a categoria sugerida para loja de fogos', async () => {
  const result = await apiCall('POST', '/categorize', { descricao: 'loja de fogos' });
  expect(result.status).toBe(200);
  test.skip(result.json?.confianca === 0, 'IA indisponível: o fallback é coberto pelos testes unitários');
  expect(result.json).toMatchObject({ categoria: 'Loja de Fogos', existente: expect.any(Boolean) });
  expect(result.json.categoriaId).toBeTruthy();

  const repeated = await apiCall('POST', '/categorize', { descricao: 'loja de fogos' });
  expect(repeated.status).toBe(200);
  expect(repeated.json).toMatchObject({
    categoria: 'Loja de Fogos',
    categoriaId: result.json.categoriaId,
    existente: true,
  });
});

test('pré-seleciona picolé, respeita a troca manual e salva a categoria final', async ({ page }) => {
  await openFinancePage(page);
  await page.getByRole('button', { name: 'Novo Gasto' }).click();
  const modal = page.getByRole('dialog');
  const categoryInput = modal.getByLabel('Categoria');
  const establishment = `picolé E2E ${Date.now()}`;
  let expenseId = '';

  try {
    await modal.getByLabel('Estabelecimento').fill(establishment);
    await expect(categoryInput).toHaveValue('Sorveteria');
    await expect(page.getByText('Sugerido pela IA')).toBeVisible();

    await categoryInput.fill('Outros');
    await expect(categoryInput).toHaveValue('Outros');
    await modal.getByLabel('Valor').fill('12,50');

    const saveResponse = page.waitForResponse((response) =>
      response.url().endsWith('/api/finance/add') && response.request().method() === 'POST'
    );
    await modal.getByRole('button', { name: 'Salvar' }).click();
    const saved = await (await saveResponse).json();
    expenseId = saved.gasto._id;
    expect(saved.gasto.categoria).toBe('Outros');
    await expect(page.locator('.finance-table').getByText(establishment, { exact: true })).toBeVisible();
  } finally {
    if (expenseId) await apiCall('DELETE', `/${encodeURIComponent(expenseId)}`);
  }
});

test('mantém o lançamento funcional com Outros quando a categorização falha', async ({ page }) => {
  await page.route('**/api/finance/categorize', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'ai_unavailable' }),
    })
  );
  await openFinancePage(page);
  await page.getByRole('button', { name: 'Novo Gasto' }).click();
  const modal = page.getByRole('dialog');
  const establishment = `Estabelecimento sem IA ${Date.now()}`;
  let expenseId = '';

  try {
    await modal.getByLabel('Estabelecimento').fill(establishment);
    await expect(modal.getByLabel('Categoria')).toHaveValue('Outros');
    await expect(page.getByText('IA indisponível · Outros')).toBeVisible();
    await modal.getByLabel('Valor').fill('1,00');

    const saveResponse = page.waitForResponse((response) =>
      response.url().endsWith('/api/finance/add') && response.request().method() === 'POST'
    );
    await modal.getByRole('button', { name: 'Salvar' }).click();
    const savedResponse = await saveResponse;
    expect(savedResponse.status()).toBe(201);
    const saved = await savedResponse.json();
    expenseId = saved.gasto._id;
    expect(saved.gasto.categoria).toBe('Outros');
  } finally {
    if (expenseId) await apiCall('DELETE', `/${encodeURIComponent(expenseId)}`);
  }
});
