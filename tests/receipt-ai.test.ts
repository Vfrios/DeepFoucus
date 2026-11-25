import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanReceiptItems, isReceiptImageDataUrl } from '../backend/src/lib/receiptAi';

test('cleans the AI receipt response: trims, dedupes, drops invalid entries and caps at 30', () => {
  assert.deepEqual(
    cleanReceiptItems({ itens: ['  Leite ', 'queijo', 'QUEIJO', '', 'a', 42, null, 'Molho  de   Tomate'] }),
    ['Leite', 'queijo', 'Molho de Tomate']
  );
  assert.deepEqual(cleanReceiptItems({ itens: Array.from({ length: 50 }, (_, i) => `Produto ${i}`) }).length, 30);
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
