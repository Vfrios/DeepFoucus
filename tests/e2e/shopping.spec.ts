import { expect, request, test, type Page } from '@playwright/test';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const API_TOKEN_SECRET = process.env.JWT_SECRET;

function ownerToken(email = process.env.EMAIL_VITOR || 'shopping-e2e@example.com'): string {
  if (!API_TOKEN_SECRET) throw new Error('JWT_SECRET não configurada');
  return jwt.sign(
    { email, name: 'Shopping E2E', role: 'owner' },
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

async function seedCartItem(item: string, quantidade: string) {
  await removeItemFromBoth(item);
  const imported = await callApi('POST', '/pantry/import', {
    itens: [{ item, quantidade: '1' }],
  });
  expect(imported.status).toBe(200);
  const lists = await listItems();
  const pantryItem = lists.dispensa.find((entry) => key(entry.item) === key(item));
  expect(pantryItem).toBeTruthy();

  const removedFromPantry = await callApi('PATCH', '/adjust', {
    itemId: pantryItem._id,
    delta: -1,
    contexto: 'dispensa',
  });
  expect(removedFromPantry.status).toBe(200);
  const addedToCart = await callApi('PATCH', '/adjust', {
    itemId: pantryItem._id,
    delta: Number(quantidade),
    contexto: 'carrinho',
  });
  expect(addedToCart.status).toBe(200);
  return addedToCart.json;
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

test('pareia um celular e mostra a captura de nota na dispensa', async ({ page, browser }) => {
  await openShoppingPage(page);
  await expect(page.getByRole('button', { name: 'Conectar celular' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Abrir menu' }).click();
  await page.getByRole('dialog', { name: 'Menu lateral' }).getByRole('button', { name: 'Conectar celular' }).click();
  const pairingCode = await page.locator('.shopping-pairing-code').textContent();
  expect(pairingCode).toBeTruthy();

  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 564 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    const mobilePage = await mobileContext.newPage();
    await mobilePage.goto('/');
    await mobilePage.getByLabel('Já gerou um código no computador?').fill(pairingCode || '');
    await mobilePage.getByRole('button', { name: 'Conectar' }).click();
    await expect(mobilePage.locator('.shopping-page')).toBeVisible();
    await mobilePage.getByRole('button', { name: /Dispensa/ }).click();
    await expect(mobilePage.getByRole('button', { name: 'Escanear nota' })).toBeVisible();
    await expect(mobilePage.locator('input[type="file"]')).toHaveAttribute('capture', 'environment');
  } finally {
    await mobileContext.close();
  }
});

test('esconde o pareamento de outro owner e a API responde 403', async ({ page }) => {
  const otherOwnerEmail = 'another-owner@example.com';
  const permissionsResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/auth/permissions'
  );
  await page.goto('/');
  await page.evaluate((token) => localStorage.setItem('wd:jwt', token), ownerToken(otherOwnerEmail));
  await page.goto('/?view=web&page=shopping');
  expect((await permissionsResponse.then((response) => response.json())).isPrimaryOwner).toBe(false);

  await page.getByRole('button', { name: 'Abrir menu' }).click();
  const sidebar = page.getByRole('dialog', { name: 'Menu lateral' });
  await expect(sidebar.getByRole('button', { name: 'Conectar celular' })).toHaveCount(0);

  const context = await request.newContext({
    baseURL: 'http://localhost:3001',
    extraHTTPHeaders: { Authorization: `Bearer ${ownerToken(otherOwnerEmail)}` },
  });
  try {
    const response = await context.post('/api/auth/device-pairing/start');
    expect(response.status()).toBe(403);
  } finally {
    await context.dispose();
  }
});

test('menu lateral cabe na tela estreita sem rolagem', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 564 });
  await openShoppingPage(page);
  await page.getByRole('button', { name: 'Abrir menu' }).click();

  const sidebar = page.getByRole('dialog', { name: 'Menu lateral' });
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByRole('heading', { name: 'Preferências' })).toBeVisible();
  await expect(sidebar.getByRole('button', { name: 'Conectar celular' })).toBeVisible();
  await expect(sidebar.getByText(/iPhone\/iPad/)).toHaveCount(0);
  expect(await sidebar.locator('.sidebar-nav').evaluate((element) =>
    getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).length
  )).toBe(1);
  expect(await sidebar.locator('.sidebar-section').evaluate((element) =>
    getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).length
  )).toBe(1);
  expect(await sidebar.getByRole('group', { name: 'Modo de exibição' }).evaluate((element) =>
    getComputedStyle(element).flexDirection
  )).toBe('column');

  for (const height of [564, 480]) {
    await page.setViewportSize({ width: 390, height });
    const dimensions = await sidebar.evaluate((element) => ({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      sectionScrollHeight: element.querySelector('.sidebar-section')?.scrollHeight ?? 0,
      sectionClientHeight: element.querySelector('.sidebar-section')?.clientHeight ?? 0,
    }));
    expect(dimensions.scrollHeight <= dimensions.clientHeight, `Menu overflows at ${height}px: ${JSON.stringify(dimensions)}`).toBe(true);
    expect(
      dimensions.sectionScrollHeight <= dimensions.sectionClientHeight,
      `Preferences overflow at ${height}px: ${JSON.stringify(dimensions)}`
    ).toBe(true);
  }
});

test('adiciona ao carrinho antes da resposta lenta e sincroniza o ID real', async ({ page }) => {
  const name = `Item otimista lento ${Date.now()}`;
  const realId = '65f000000000000000000001';
  let releaseResponse: () => void = () => undefined;
  let notifyIntercepted: () => void = () => undefined;
  const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve; });
  const intercepted = new Promise<void>((resolve) => { notifyIntercepted = resolve; });

  await openShoppingPage(page);
  await page.route('**/api/shopping/add', async (route) => {
    notifyIntercepted();
    await responseGate;
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        _id: realId,
        item: name,
        emoji: '📦',
        quantidade: '1',
        status: 'carrinho',
        quantidadeEmCasa: 0,
        quantidadeNoCarrinho: 1,
        criadoEm: new Date().toISOString(),
      }),
    });
  });

  try {
    const input = page.getByLabel('Novo item do carrinho');
    await input.fill(name);
    await page.getByRole('button', { name: 'Adicionar' }).click();
    await intercepted;

    const row = page.locator('.shopping-item').filter({ hasText: name });
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('data-shopping-item-id', /^temp-/);
    await expect(input).toHaveValue('');

    await input.fill('Outro item enquanto salva');
    await expect(page.getByRole('button', { name: 'Adicionar' })).toBeEnabled();

    releaseResponse();
    await expect(row).toHaveAttribute('data-shopping-item-id', realId);
  } finally {
    releaseResponse();
    await page.unroute('**/api/shopping/add');
  }
});

test('adiciona à dispensa imediatamente e sincroniza o ID', async ({ page }) => {
  const name = `Item otimista dispensa ${Date.now()}`;
  const realId = '65f000000000000000000003';
  let releaseResponse: () => void = () => undefined;
  let notifyIntercepted: () => void = () => undefined;
  const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve; });
  const intercepted = new Promise<void>((resolve) => { notifyIntercepted = resolve; });

  await openShoppingPage(page);
  await page.getByRole('button', { name: /^Dispensa/ }).click();
  await page.route('**/api/shopping/add', async (route) => {
    notifyIntercepted();
    await responseGate;
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        _id: realId,
        item: name,
        quantidade: '2',
        status: 'dispensa',
        quantidadeEmCasa: 2,
        quantidadeNoCarrinho: 0,
        criadoEm: new Date().toISOString(),
      }),
    });
  });

  try {
    await page.getByLabel('Novo item do dispensa').fill(name);
    await page.getByLabel('Quantidade para dispensa').fill('2');
    await page.getByRole('button', { name: 'Adicionar' }).click();
    await intercepted;

    const row = page.locator('.shopping-item').filter({ hasText: name });
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('data-shopping-item-id', /^temp-/);
    releaseResponse();
    await expect(row).toHaveAttribute('data-shopping-item-id', realId);
  } finally {
    releaseResponse();
    await page.unroute('**/api/shopping/add');
  }
});

test('reverte e avisa quando a inclusão otimista falha', async ({ page }) => {
  const name = `Item otimista falha ${Date.now()}`;
  let releaseResponse: () => void = () => undefined;
  let notifyIntercepted: () => void = () => undefined;
  const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve; });
  const intercepted = new Promise<void>((resolve) => { notifyIntercepted = resolve; });

  await openShoppingPage(page);
  await page.route('**/api/shopping/add', async (route) => {
    notifyIntercepted();
    await responseGate;
    await route.fulfill({ status: 503, body: 'temporarily unavailable' });
  });

  try {
    await page.getByLabel('Novo item do carrinho').fill(name);
    await page.getByRole('button', { name: 'Adicionar' }).click();
    await intercepted;

    const item = page.locator('.shopping-item-name').filter({ hasText: name });
    await expect(item).toBeVisible();
    releaseResponse();
    await expect(item).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveText('Não foi possível adicionar o item. Tente novamente.');
  } finally {
    releaseResponse();
    await page.unroute('**/api/shopping/add');
  }
});

test('reverte ajuste e exclusão otimistas se a API falhar', async ({ page }) => {
  const name = `Item otimista estoque ${Date.now()}`;
  await removeItemFromBoth(name);
  const imported = await callApi('POST', '/pantry/import', { itens: [{ item: name, quantidade: '2' }] });
  expect(imported.status).toBe(200);
  await openShoppingPage(page);
  await page.getByRole('button', { name: /^Dispensa/ }).click();

  const row = page.locator('.shopping-item').filter({ hasText: name });
  const quantity = page.getByRole('textbox', { name: `Quantidade em casa de ${name}` });
  await expect(quantity).toHaveValue('2');
  let releaseResponse: () => void = () => undefined;
  let notifyIntercepted: () => void = () => undefined;
  let responseGate = new Promise<void>((resolve) => { releaseResponse = resolve; });
  let intercepted = new Promise<void>((resolve) => { notifyIntercepted = resolve; });

  try {
    await page.route('**/api/shopping/adjust', async (route) => {
      notifyIntercepted();
      await responseGate;
      await route.fulfill({ status: 503, body: 'temporarily unavailable' });
    });
    await page.getByRole('button', { name: `Aumentar quantidade de ${name}` }).click();
    await intercepted;
    await expect(quantity).toHaveValue('3');
    releaseResponse();
    await expect(quantity).toHaveValue('2');
    await expect(page.getByRole('alert')).toHaveText('Não foi possível ajustar a quantidade. Tente novamente.');
    await page.unroute('**/api/shopping/adjust');

    const id = await row.getAttribute('data-shopping-item-id');
    if (!id) throw new Error('Item sem ID para validar a exclusão.');
    releaseResponse = () => undefined;
    responseGate = new Promise<void>((resolve) => { releaseResponse = resolve; });
    intercepted = new Promise<void>((resolve) => { notifyIntercepted = resolve; });
    await page.route('**/api/shopping/**', async (route) => {
      const requestUrl = new URL(route.request().url());
      if (route.request().method() !== 'DELETE' || requestUrl.pathname !== `/api/shopping/${id}`) {
        await route.continue();
        return;
      }
      notifyIntercepted();
      await responseGate;
      await route.fulfill({ status: 503, body: 'temporarily unavailable' });
    });

    await page.getByRole('button', { name: `Excluir ${name}` }).click();
    await intercepted;
    await expect(row).toHaveCount(0);
    releaseResponse();
    await expect(row).toBeVisible();
    await expect(page.getByRole('alert')).toHaveText('Não foi possível excluir o item. Tente novamente.');
  } finally {
    releaseResponse();
    await page.unrouteAll({ behavior: 'wait' });
    await removeItemFromBoth(name);
  }
});

test('reverte quantidade digitada no carrinho quando o PATCH falha', async ({ page }) => {
  const name = `Item otimista quantidade ${Date.now()}`;
  const id = '65f000000000000000000002';

  try {
    await openShoppingPage(page);
    await page.route('**/api/shopping/add', async (route) => {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          _id: id,
          item: name,
          quantidade: '2',
          status: 'carrinho',
          quantidadeEmCasa: 0,
          quantidadeNoCarrinho: 2,
          criadoEm: new Date().toISOString(),
        }),
      });
    });
    await page.getByLabel('Novo item do carrinho').fill(name);
    await page.getByLabel('Quantidade para carrinho').fill('2');
    const addResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/shopping/add'
    );
    await page.getByRole('button', { name: 'Adicionar' }).click();
    expect((await addResponse).status()).toBe(201);
    const row = page.locator('.shopping-item').filter({ hasText: name });
    await expect(row).toHaveAttribute('data-shopping-item-id', id);
    await page.unroute('**/api/shopping/add');

    const quantity = page.getByRole('textbox', { name: `Quantidade de ${name}` });

    let releaseResponse: () => void = () => undefined;
    let notifyIntercepted: () => void = () => undefined;
    const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve; });
    const intercepted = new Promise<void>((resolve) => { notifyIntercepted = resolve; });
    await page.route('**/api/shopping/**', async (route) => {
      const requestUrl = new URL(route.request().url());
      if (route.request().method() !== 'PATCH' || requestUrl.pathname !== `/api/shopping/${id}`) {
        await route.continue();
        return;
      }
      notifyIntercepted();
      await responseGate;
      await route.fulfill({ status: 503, body: 'temporarily unavailable' });
    });

    try {
      await quantity.fill('5');
      await quantity.press('Enter');
      await intercepted;
      await expect(quantity).toHaveValue('5');
      const failedPatch = page.waitForResponse((response) =>
        response.request().method() === 'PATCH'
        && new URL(response.url()).pathname === `/api/shopping/${id}`
      );
      releaseResponse();
      expect((await failedPatch).status()).toBe(503);
      await expect(quantity).toHaveValue('2');
      await expect(page.getByRole('alert')).toHaveText('Não foi possível atualizar a quantidade. Tente novamente.');
    } finally {
      releaseResponse();
      await page.unrouteAll({ behavior: 'wait' });
    }
  } finally {
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('dispensa carrega em desktop e mobile pela listagem real nas três abas', async ({ page, browser }) => {
  const name = `E2E${Date.now().toString().slice(-5)}`;
  await removeItemFromBoth(name);
  const imported = await callApi('POST', '/pantry/import', {
    itens: [{ item: name, quantidade: '2' }],
  });
  expect(imported.status).toBe(200);
  const persistedName = name;
  const detailGets: string[] = [];
  const notFoundShoppingRoutes: string[] = [];

  const trackShoppingRequests = (target: Page) => {
    target.on('request', (requestEvent) => {
      const url = new URL(requestEvent.url());
      if (requestEvent.method() === 'GET' && /^\/api\/shopping\/[a-f\d]{24}$/i.test(url.pathname)) {
        detailGets.push(`${requestEvent.method()} ${url.pathname}`);
      }
    });
    target.on('response', (response) => {
      const url = new URL(response.url());
      if (response.status() === 404 && url.pathname.startsWith('/api/shopping/')) {
        notFoundShoppingRoutes.push(`${response.request().method()} ${url.pathname}`);
      }
    });
  };

  try {
    trackShoppingRequests(page);
    const desktopListResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/shopping/list' && response.request().method() === 'GET'
    );
    await page.setViewportSize({ width: 1280, height: 800 });
    await openShoppingPage(page);
    const desktopLists = await desktopListResponse.then((response) => response.json());
    expect(desktopLists.dispensa.some((entry: { item: string }) => key(entry.item) === key(persistedName))).toBe(true);

    await page.getByRole('button', { name: /^Carrinho/ }).click();
    await page.getByRole('button', { name: /^Dispensa/ }).click();
    await expect(page.locator('.shopping-item-name').filter({ hasText: persistedName })).toBeVisible();
    await page.getByRole('button', { name: /^Receitas/ }).click();
    await expect(page.getByRole('heading', { name: 'Cozinhe com o que você tem' })).toBeVisible();

    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 564 },
      isMobile: true,
      hasTouch: true,
    });
    try {
      const mobilePage = await mobileContext.newPage();
      trackShoppingRequests(mobilePage);
      await mobilePage.goto('/');
      await mobilePage.evaluate((token) => localStorage.setItem('wd:jwt', token), ownerToken());
      const mobileListResponse = mobilePage.waitForResponse((response) =>
        new URL(response.url()).pathname === '/api/shopping/list' && response.request().method() === 'GET'
      );
      await mobilePage.goto('/?view=mobile&page=shopping');
      const mobileLists = await mobileListResponse.then((response) => response.json());
      expect(mobileLists.dispensa.some((entry: { item: string }) => key(entry.item) === key(persistedName))).toBe(true);

      await mobilePage.getByRole('button', { name: /^Carrinho/ }).click();
      await mobilePage.getByRole('button', { name: /^Dispensa/ }).click();
      const pantryItem = mobilePage.locator('.shopping-item-name').filter({ hasText: persistedName });
      await expect(pantryItem).toBeVisible();
      await expect(pantryItem).toBeInViewport({ ratio: 1 });
      await mobilePage.getByRole('button', { name: /^Receitas/ }).click();
      await expect(mobilePage.getByRole('heading', { name: 'Cozinhe com o que você tem' })).toBeVisible();

      const narrowWebListResponse = mobilePage.waitForResponse((response) =>
        new URL(response.url()).pathname === '/api/shopping/list' && response.request().method() === 'GET'
      );
      await mobilePage.goto('/?view=web&page=shopping');
      await narrowWebListResponse;
      await mobilePage.getByRole('button', { name: /^Dispensa/ }).click();
      const narrowWebPantryItem = mobilePage.locator('.shopping-item-name').filter({ hasText: persistedName });
      await expect(narrowWebPantryItem).toBeInViewport({ ratio: 1 });
    } finally {
      await mobileContext.close();
    }

    expect(detailGets).toEqual([]);
    expect(notFoundShoppingRoutes).toEqual([]);
  } finally {
    await removeItemFromBoth(persistedName);
  }
});

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
  const added = await seedCartItem(name, '2');
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
    const confirmedRow = dialog.getByRole('listitem').filter({ hasText: cartName });
    await expect(confirmedRow.getByText(cartName, { exact: true })).toBeVisible();
    await expect(confirmedRow.getByText('Qtd. 2')).toBeVisible();
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
  const added = await seedCartItem(name, '2');
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
  const added = await seedCartItem(name, '3');
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
