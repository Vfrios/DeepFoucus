import assert from 'node:assert/strict';
import test from 'node:test';
import { validateRecipe } from '../backend/src/lib/shopping';

test('validates and normalizes a recipe in the strict JSON contract', () => {
  const recipe = validateRecipe({
    ingredientesDisponiveis: [{ item: '  Peito de frango ', quantidade: ' 500 g ' }],
    ingredientesFaltantes: [{ item: 'Creme de leite', quantidade: '1 caixa' }],
    instrucoes: [' Corte   o frango. ', 'Cozinhe e sirva.'],
  }, 'Strogonoff de frango');

  assert.deepEqual(recipe, {
    prato: 'Strogonoff de frango',
    ingredientesDisponiveis: [{ item: 'Peito de frango', quantidade: '500 g' }],
    ingredientesFaltantes: [{ item: 'Creme de leite', quantidade: '1 caixa' }],
    instrucoes: ['Corte o frango.', 'Cozinhe e sirva.'],
  });
});

test('rejects loose ingredient formats and alternate property names', () => {
  assert.throws(() => validateRecipe({
    ingredientesQueTem: ['Frango'],
    ingredientesQueFaltam: [],
    instrucoes: ['Cozinhe.'],
  }, 'Strogonoff'), /recipe_invalid_ingredients/);
});

test('rejects an ingredient appearing as both available and missing', () => {
  assert.throws(() => validateRecipe({
    ingredientesDisponiveis: [{ item: 'Limão', quantidade: '1 unidade' }],
    ingredientesFaltantes: [{ item: 'limao', quantidade: '1 unidade' }],
    instrucoes: ['Misture.'],
  }, 'Limonada'), /recipe_invalid_ingredient_conflict/);
});
