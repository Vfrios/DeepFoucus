import { expect, request, test, type Page } from '@playwright/test';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const API_TOKEN_SECRET = process.env.JWT_SECRET;

function ownerToken(): string {
  if (!API_TOKEN_SECRET) throw new Error('JWT_SECRET não configurada');
  return jwt.sign(
    { email: 'shopping-e2e@example.com', name: 'Shopping E2E', role: 'owner' },
    API_TOKEN_SECRET,
    { algorithm: 'HS256', expiresIn: '1h' }
  );
}

function key(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

async function callApi(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: object) {
  const context = await request.newContext({
    baseURL: 'http://localhost:3001',
    extraHTTPHeaders: { Authorization: `Bearer ${ownerToken()}` },
  });
  try {
    const response = await context.fetch(`/api/shopping${path}`, {
      method,
      data: body,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
    });
    const text = await response.text();
    let json: any = undefined;
    try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }
    return { response, status: response.status(), json };
  } finally {
    await context.dispose();
  }
}

async function addItem(item: string, status: 'dispensa' | 'carrinho', quantidade: string) {
  const result = await callApi('POST', '/add', { item, status, quantidade });
  expect(result.status).toBe(201);
  return result.json;
}

async function listItems() {
  const result = await callApi('GET', '/list');
  expect(result.status).toBe(200);
  return result.json as { dispensa: any[]; carrinho: any[] };
}

async function findInList(item: string) {
  const lists = await listItems();
  const requested = key(item);
  return {
    lists,
    pantry: lists.dispensa.find((entry) => {
      const candidate = key(entry.item);
      return candidate === requested || candidate.includes(requested) || requested.includes(candidate);
    }),
    cart: lists.carrinho.find((entry) => {
      const candidate = key(entry.item);
      return candidate === requested || candidate.includes(requested) || requested.includes(candidate);
    }),
  };
}

async function removeItemFromBoth(item: string) {
  const found = await findInList(item);
  if (!found.pantry && !found.cart) return;
  if (found.cart) await callApi('DELETE', `/${found.cart._id}?contexto=carrinho`);
  if (found.pantry) await callApi('DELETE', `/${found.pantry._id}?contexto=dispensa`);
  const remaining = await findInList(item);
  if (remaining.cart) await callApi('DELETE', `/${remaining.cart._id}`);
  if (remaining.pantry) await callApi('DELETE', `/${remaining.pantry._id}`);
}

async function openShoppingPage(page: Page) {
  await page.goto('/');
  await page.evaluate((token) => localStorage.setItem('wd:jwt', token), ownerToken());
  await page.goto('/?view=web&page=shopping');
  await expect(page.locator('.shopping-page')).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

test('dispensa e carrinho existem simultaneamente com quantidades independentes', async () => {
  const name = 'Leite E2E Simultaneo';
  await removeItemFromBoth(name);
  await addItem(name, 'dispensa', '2');
  await addItem(name, 'carrinho', '1');

  const found = await findInList(name);
  expect(found.pantry).toBeTruthy();
  expect(found.cart).toBeTruthy();
  expect(found.pantry.quantidadeEmCasa).toBe(2);
  expect(found.cart.quantidadeNoCarrinho).toBe(1);

  await removeItemFromBoth(name);
});

test('consumir a dispensa até zero preserva o carrinho', async () => {
  const name = 'Queijo E2E Zero';
  await removeItemFromBoth(name);
  await addItem(name, 'dispensa', '2');
  await addItem(name, 'carrinho', '1');

  const before = await findInList(name);
  const result = await callApi('PATCH', '/adjust', {
    itemId: before.pantry._id,
    delta: -2,
    contexto: 'dispensa',
  });
  expect(result.status).toBe(200);

  const after = await findInList(name);
  expect(after.pantry).toBeUndefined();
  expect(after.cart).toBeTruthy();
  expect(after.cart.quantidadeNoCarrinho).toBe(1);

  await removeItemFromBoth(name);
});

test('checkout soma o carrinho na dispensa e zera o carrinho', async () => {
  const name = 'Arroz E2E Checkout';
  await removeItemFromBoth(name);
  const added = await addItem(name, 'carrinho', '3');
  const persistedName = added.item || name;

  const result = await callApi('POST', '/checkout');
  expect(result.status).toBe(200);
  expect(result.json.ok).toBe(true);

  const after = await findInList(persistedName);
  expect(after.cart).toBeUndefined();
  expect(after.pantry).toBeTruthy();
  expect(after.pantry.quantidadeEmCasa).toBe(3);

  await removeItemFromBoth(persistedName);
});

test('receita separa ingredientes existentes e faltantes', async () => {
  const available = 'Peito de frango';
  const missing = 'Creme de leite';
  await removeItemFromBoth(available);
  await removeItemFromBoth(missing);
  await addItem(available, 'dispensa', '600');

  const result = await callApi('POST', '/recipe', { prato: 'Strogonoff de frango' });
  expect(result.status).toBe(201);
  expect(Array.isArray(result.json.ingredientesDisponiveis)).toBe(true);
  expect(Array.isArray(result.json.ingredientesFaltantes)).toBe(true);

  expect(result.json.ingredientesDisponiveis.some((entry: any) => key(entry.item).includes('frango'))).toBe(true);
  expect(result.json.ingredientesFaltantes.some((entry: any) => key(entry.item).includes('creme'))).toBe(true);

  const remaining = await findInList(available);
  if (remaining.pantry) {
    expect(remaining.pantry.quantidadeEmCasa).toBeLessThan(600);
  }

  const cartResult = await findInList(missing);
  expect(cartResult.cart).toBeTruthy();

  await removeItemFromBoth(available);
  await removeItemFromBoth(missing);
});

test('adicionar o mesmo item duas vezes cria um único registro', async () => {
  const name = 'Café E2E Duplicado';
  await removeItemFromBoth(name);
  await addItem(name, 'carrinho', '1');
  await addItem(name, 'carrinho', '1');

  const lists = await listItems();
  const records = [...lists.dispensa, ...lists.carrinho].filter((entry) => key(entry.item) === key(name));
  expect(records.length).toBe(1);
  expect(records[0].quantidadeNoCarrinho).toBe(2);

  await removeItemFromBoth(name);
});

test('checkout mostra rascunhos pendentes e permite voltar à lista sem finalizar', async ({ page }) => {
  const name = `Item checkout voltar ${Date.now()}`;
  const added = await addItem(name, 'carrinho', '2');
  const cartName = added.item || name;
  const pendingName = `Item ainda não adicionado ${Date.now()}`;
  let checkoutRequests = 0;

  try {
    await openShoppingPage(page);
    page.on('request', (requestEvent) => {
      if (requestEvent.url().endsWith('/api/shopping/checkout') && requestEvent.method() === 'POST') {
        checkoutRequests += 1;
      }
    });
    const listInput = page.getByLabel('Novo item do carrinho');
    await listInput.fill(pendingName);
    await page.getByRole('button', { name: 'Concluir compra' }).click();

    const dialog = page.getByRole('dialog', { name: 'Revisar compra' });
    await expect(dialog.getByText(cartName, { exact: true })).toBeVisible();
    await expect(dialog.getByText('Qtd. 2')).toBeVisible();
    await expect(dialog.getByText(pendingName, { exact: true })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Itens ainda na lista (não confirmados)' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Voltar à lista de compras' }).click();
    await expect(dialog).toBeHidden();
    await expect(listInput).toBeFocused();
    expect(checkoutRequests).toBe(0);
  } finally {
    await removeItemFromBoth(cartName);
  }
});

test('sem pendências, confirmar executa checkout e atualiza a dispensa', async ({ page }) => {
  const name = `Item checkout confirmar ${Date.now()}`;
  const added = await addItem(name, 'carrinho', '2');
  const cartName = added.item || name;

  try {
    await openShoppingPage(page);
    await page.getByRole('button', { name: 'Concluir compra' }).click();

    const dialog = page.getByRole('dialog', { name: 'Revisar compra' });
    await expect(dialog.getByText(cartName, { exact: true })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Itens ainda na lista (não confirmados)' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Confirmar', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Confirmar mesmo assim' })).toHaveCount(0);

    const checkoutResponse = page.waitForResponse((response) =>
      response.url().endsWith('/api/shopping/checkout') && response.request().method() === 'POST'
    );
    await dialog.getByRole('button', { name: 'Confirmar', exact: true }).click();
    const result = await (await checkoutResponse).json();
    expect(result.ok).toBe(true);
    expect(result.movidos).toBeGreaterThanOrEqual(1);
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('status')).toContainText(
      `Compra concluída: ${result.movidos} ${result.movidos === 1 ? 'item adicionado' : 'itens adicionados'} à dispensa`
    );

    const after = await findInList(cartName);
    expect(after.cart).toBeUndefined();
    expect(after.pantry).toBeTruthy();
    expect(after.pantry.quantidadeEmCasa).toBe(2);
  } finally {
    await removeItemFromBoth(cartName);
  }
});

test('confirmar mesmo assim compra somente itens do carrinho', async ({ page }) => {
  const name = `Item checkout parcial ${Date.now()}`;
  const added = await addItem(name, 'carrinho', '3');
  const cartName = added.item || name;
  const pendingName = `Item pendente não enviado ${Date.now()}`;

  try {
    await openShoppingPage(page);
    const listInput = page.getByLabel('Novo item do carrinho');
    await listInput.fill(pendingName);
    await page.getByRole('button', { name: 'Concluir compra' }).click();

    const dialog = page.getByRole('dialog', { name: 'Revisar compra' });
    await expect(dialog.getByText(pendingName, { exact: true })).toBeVisible();
    const checkoutResponse = page.waitForResponse((response) =>
      response.url().endsWith('/api/shopping/checkout') && response.request().method() === 'POST'
    );
    await dialog.getByRole('button', { name: 'Confirmar mesmo assim' }).click();
    const result = await (await checkoutResponse).json();
    expect(result.ok).toBe(true);
    expect(result.movidos).toBeGreaterThanOrEqual(1);
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('status')).toContainText(
      `Compra concluída: ${result.movidos} ${result.movidos === 1 ? 'item adicionado' : 'itens adicionados'} à dispensa`
    );

    const after = await findInList(cartName);
    expect(after.cart).toBeUndefined();
    expect(after.pantry).toBeTruthy();
    expect(after.pantry.quantidadeEmCasa).toBe(3);
    expect(await findInList(pendingName).cart).toBeUndefined();
    await expect(listInput).toHaveValue(pendingName);
  } finally {
    await removeItemFromBoth(cartName);
  }
});
