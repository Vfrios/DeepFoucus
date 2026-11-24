import { expect, test } from '@playwright/test';

test('rotas protegidas rejeitam chamadas sem token e health responde', async ({ request }) => {
  const protectedResponse = await request.get('/api/tasks');
  expect(protectedResponse.status()).toBe(401);
  expect(await protectedResponse.json()).toEqual({ error: 'unauthorized' });

  const healthResponse = await request.get('http://localhost:3001/healthz');
  expect(healthResponse.status()).toBe(200);
  expect(await healthResponse.text()).toBe('ok');
});
