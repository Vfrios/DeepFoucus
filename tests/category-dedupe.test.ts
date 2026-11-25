import assert from 'node:assert/strict';
import test from 'node:test';
import { planCategoryDedupe } from '../backend/src/lib/categoryDedupe';

test('keeps the oldest normalized category and merges unique synonyms', () => {
  const plan = planCategoryDedupe([
    {
      _id: 'newer',
      nome: 'Mercados',
      criadoEm: '2025-02-01T00:00:00.000Z',
      sinonimos: ['supermercado', 'Feira'],
    },
    {
      _id: 'older',
      nome: 'Mercado',
      criadoEm: '2024-01-01T00:00:00.000Z',
      sinonimos: ['feira', 'mercearia'],
    },
    { _id: 'unique', nome: 'Farmácia', sinonimos: [] },
  ]);

  assert.deepEqual(plan, [{
    survivorId: 'older',
    nomeNormalizado: 'mercado',
    sinonimos: ['feira', 'mercearia', 'supermercado'],
    duplicateIds: ['newer'],
  }]);
});
