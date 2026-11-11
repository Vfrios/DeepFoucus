import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getItemEmoji } from '../backend/src/lib/icons';

test('prefers custom Brazilian grocery emojis and normalizes accents and plurals', () => {
  assert.equal(getItemEmoji('Papel Higiênico'), '🧻');
  assert.equal(getItemEmoji('ARROZ'), '🍚');
  assert.equal(getItemEmoji('feijões'), '🫘');
  assert.equal(getItemEmoji('frangos'), '🍗');
  assert.equal(getItemEmoji('papel higienicos'), '🧻');
});

test('looks up exact emoji dictionary words and uses a box for unknown items', () => {
  assert.equal(getItemEmoji('apple'), '🍎');
  assert.equal(getItemEmoji('produto sem correspondencia'), '📦');
  assert.equal(getItemEmoji(''), '📦');
});
