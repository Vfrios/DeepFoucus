import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanReceiptItems, isReceiptImageDataUrl } from '../backend/src/lib/receiptAi';

test('cleans the AI receipt response: trims, dedupes, keeps integer quantities and drops invalid entries', () => {
  assert.deepEqual(
    cleanReceiptItems({
      itens: [
        '  Leite ', 'queijo', 'QUEIJO', '', 'a', 42, null, 'Molho  de   Tomate',
        { nome: 'Cerveja Bruss Gold 473ml', quantidade: '8' },
        { nome: 'Cebola Amarela', quantidade: '0,895' },
        { nome: 'Detergente em Pó Omo 1kg', quantidade: 3 },
        { item: 'Arroz', quantidade: 2.5 },
      ],
    }),
    [
      { nome: 'Leite', quantidade: '1' },
      { nome: 'queijo', quantidade: '1' },
      { nome: 'Molho de Tomate', quantidade: '1' },
      { nome: 'Cerveja Bruss Gold 473ml', quantidade: '8' },
      { nome: 'Cebola Amarela', quantidade: '1' },
      { nome: 'Detergente em Pó Omo 1kg', quantidade: '3' },
      { nome: 'Arroz', quantidade: '1' },
    ]
  );
  assert.equal(cleanReceiptItems({ itens: Array.from({ length: 80 }, (_, i) => `Produto ${i}`) }).length, 40);
});

test('returns no items for a malformed AI receipt response', () => {
  assert.deepEqual(cleanReceiptItems(null), []);
  assert.deepEqual(cleanReceiptItems({ itens: 'leite' }), []);
  assert.deepEqual(cleanReceiptItems({}), []);
});

test('accepts only reasonably sized base64 image data URLs for receipt scans', () => {
  assert.equal(isReceiptImageDataUrl('data:image/jpeg;base64,/9j/4AAQSkZJRg=='), true);
  assert.equal(isReceiptImageDataUrl('data:text/html;base64,PGgxPg=='), false);
  assert.equal(isReceiptImageDataUrl('https://example.com/a.jpg'), false);
  assert.equal(isReceiptImageDataUrl(`data:image/jpeg;base64,${'A'.repeat(3_600_000)}`), false);
});
