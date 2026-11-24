import assert from 'node:assert/strict';
import test from 'node:test';
import { isItemInDispensa, validateRecipe } from '../backend/src/lib/shopping';
import {
  checkoutConfirmationMode,
  reviewShoppingCheckout,
} from '../frontend/src/lib/shoppingCheckout';

test('separates cart-confirmed items from pending shopping-list entries', () => {
  const review = reviewShoppingCheckout(
    [
      { item: 'Leite', quantidade: '2' },
      { item: 'Ovos', quantidade: '1 dúzia' },
      { item: 'Arroz', quantidade: '0' },
    ],
    [
      { item: 'Leite', quantidadeNoCarrinho: 3, quantidade: '3' },
      { item: 'Feijão', quantidadeNoCarrinho: 0, quantidade: '2' },
    ]
  );

  assert.deepEqual(review, {
    confirmados: [{ nome: 'Leite', quantidade: 3 }],
    pendentes: [{ nome: 'Ovos', quantidade: 1 }],
  });
});

test('shows the return-to-list option only when pending entries remain', () => {
  assert.equal(checkoutConfirmationMode([{ nome: 'Ovos', quantidade: 1 }]), 'warn');
  assert.equal(checkoutConfirmationMode([]), 'confirm');
});

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

test('does not keep a zero-quantity pantry item visible', () => {
  assert.equal(isItemInDispensa({
    item: 'Leite',
    quantidade: '0',
    status: 'dispensa',
    quantidadeEmCasa: 0,
    naDispensa: true,
    criadoEm: new Date(),
  }), false);
});

