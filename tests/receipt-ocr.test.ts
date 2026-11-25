import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseReceiptCandidates } from '../frontend/src/lib/receiptOcr';

test('extracts distinct product lines and ignores totals and receipt identifiers', () => {
  assert.deepEqual(parseReceiptCandidates([
    'MERCADO BOM PREÇO',
    'CNPJ: 00.000.000/0001-00',
    '001234 ARROZ TIPO 1 5KG 28,90',
    'LEITE INTEGRAL 1L 6,99',
    'TOTAL R$ 35,89',
    'PIX 35,89',
    'LEITE INTEGRAL 1L 6,99',
  ].join('\n')), [
    'MERCADO BOM PREÇO',
    'ARROZ TIPO 1 5KG',
    'LEITE INTEGRAL 1L',
  ]);
});

test('returns no candidates for a receipt containing only totals', () => {
  assert.deepEqual(parseReceiptCandidates('TOTAL 20,00\nPIX 20,00\n12/03/2026'), []);
});
